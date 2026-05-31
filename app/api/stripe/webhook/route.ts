// Stripe dashboard webhook events: checkout.session.completed, customer.subscription.deleted, charge.refunded, invoice.payment_succeeded
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Redis } from "@upstash/redis";
import { clerkClient } from "@clerk/nextjs/server";
import { getPostHogClient } from "@/app/lib/posthog-server";

export const runtime = "nodejs";

const PRO_TTL = 31 * 24 * 60 * 60; // 31 days in seconds

export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const rawBody = Buffer.from(await req.arrayBuffer());
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${msg}` },
      { status: 400 }
    );
  }

  const redis = Redis.fromEnv();

  // Idempotency: Stripe retries deliveries. Record event.id with NX (3-day TTL)
  // so each event is processed once; a repeat short-circuits before any grant.
  if ((await redis.set(`evt:${event.id}`, 1, { nx: true, ex: 259200 })) === null) {
    return new Response(null, { status: 200 });
  }

  const posthog = getPostHogClient();

  // Process inside try/catch so a throw doesn't leave the evt: dedupe key set.
  // The SET NX above still dedupes a SUCCESSFUL delivery that Stripe retries;
  // but if processing FAILS we must release the key (below) and return non-2xx,
  // or the grant/credit write is lost permanently while Stripe's retry 200-skips.
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const identifier = session.client_reference_id ?? session.metadata?.identifier;
      if (identifier) {
        if (session.mode === "subscription") {
          await redis.set(`pro:${identifier}`, "1", { ex: PRO_TTL });
          // Only the monthly subscription grants Pro status. The one-time credit
          // path must NOT set plan: "pro", or credit buyers keep a Pro badge.
          if (identifier.startsWith("user_")) {
            const client = await clerkClient();
            await client.users.updateUserMetadata(identifier, {
              publicMetadata: { plan: "pro" },
            });
          }
        } else {
          // One-time $2 purchase: grant 3 credit-backed generations (300k cap),
          // not permanent Pro. Decremented/enforced in app/api/generate/route.ts.
          await redis.incrby(`credit:${identifier}`, 3);
        }
        posthog.capture({
          distinctId: identifier,
          event: "payment_completed",
          properties: {
            mode: session.mode,
            amount_total: session.amount_total,
            currency: session.currency,
          },
        });
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const identifier = subscription.metadata?.identifier;
      if (identifier) {
        await redis.del(`pro:${identifier}`);
        if (identifier.startsWith("user_")) {
          const client = await clerkClient();
          await client.users.updateUserMetadata(identifier, {
            publicMetadata: { plan: null },
          });
        }
        posthog.capture({
          distinctId: identifier,
          event: "subscription_cancelled",
          properties: {
            cancel_at_period_end: subscription.cancel_at_period_end,
          },
        });
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const identifier = subscription.metadata?.identifier;
      if (identifier) {
        const status = subscription.status;
        // Only `status` drives revoke/grant — never cancel_at_period_end, which is
        // true on a sub that is canceling but still paid through the current period.
        const revokeStatuses = ["past_due", "unpaid", "canceled", "incomplete_expired", "paused"];
        if (revokeStatuses.includes(status)) {
          await redis.del(`pro:${identifier}`);
          if (identifier.startsWith("user_")) {
            const client = await clerkClient();
            await client.users.updateUserMetadata(identifier, {
              publicMetadata: { plan: null },
            });
          }
        } else if (status === "active" || status === "trialing") {
          await redis.set(`pro:${identifier}`, "1", { ex: PRO_TTL });
          if (identifier.startsWith("user_")) {
            const client = await clerkClient();
            await client.users.updateUserMetadata(identifier, {
              publicMetadata: { plan: "pro" },
            });
          }
        }
        posthog.capture({
          distinctId: identifier,
          event: "subscription_updated",
          properties: {
            status,
            cancel_at_period_end: subscription.cancel_at_period_end,
          },
        });
      }
    } else if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      let identifier: string | undefined;
      const subDetails = invoice.parent?.subscription_details;
      if (subDetails) {
        identifier = subDetails.metadata?.identifier ?? undefined;
        if (!identifier && subDetails.subscription) {
          const subId =
            typeof subDetails.subscription === "string"
              ? subDetails.subscription
              : (subDetails.subscription as Stripe.Subscription).id;
          const sub = await stripe.subscriptions.retrieve(subId);
          identifier = sub.metadata?.identifier;
        }
      }
      if (!identifier) {
        console.warn("[stripe webhook] invoice.payment_succeeded: no identifier found, skipping");
      } else {
        await redis.set(`pro:${identifier}`, "1", { ex: PRO_TTL });
        if (identifier.startsWith("user_")) {
          const client = await clerkClient();
          await client.users.updateUserMetadata(identifier, {
            publicMetadata: { plan: "pro" },
          });
        }
        console.log(`[stripe webhook] refreshed pro key for ${identifier}, expires in 31d`);
      }
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const identifier = charge.metadata?.identifier;
      if (identifier) {
        await redis.del(`pro:${identifier}`);
        posthog.capture({
          distinctId: identifier,
          event: "charge_refunded",
          properties: {
            amount_refunded: charge.amount_refunded,
            currency: charge.currency,
          },
        });
      }
    }

    await posthog.shutdown();

    return NextResponse.json({ received: true });
  } catch (err) {
    // Processing failed AFTER the dedupe key was set. Release the key so Stripe's
    // retry can reprocess, and return non-2xx so Stripe actually retries — never
    // swallow into a 200, or the lost grant/credit becomes permanent.
    //
    // Residual edge: two truly-simultaneous deliveries of the same event can still
    // race — one wins SET NX, the other 200-skips at the guard. If the winner then
    // fails, that event is lost. Acceptable: Stripe spaces its retries, so a retry
    // won't collide with the original delivery. Documenting, not solving.
    await redis.del(`evt:${event.id}`);
    console.error("[stripe-webhook] failed", { eventId: event.id, type: event.type, err });
    // Queryable error log in Upstash (last 100) — no Sentry required.
    await redis.lpush(
      `webhook:errors`,
      JSON.stringify({ id: event.id, type: event.type, msg: String(err), ts: Date.now() })
    );
    await redis.ltrim(`webhook:errors`, 0, 99);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
