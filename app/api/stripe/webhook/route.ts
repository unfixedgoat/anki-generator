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

  const posthog = getPostHogClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const identifier = session.client_reference_id ?? session.metadata?.identifier;
    if (identifier) {
      if (session.mode === "subscription") {
        await redis.set(`pro:${identifier}`, "1", { ex: PRO_TTL });
      } else {
        await redis.set(`pro:${identifier}`, "1");
      }
      if (identifier.startsWith("user_")) {
        const client = await clerkClient();
        await client.users.updateUserMetadata(identifier, {
          publicMetadata: { plan: "pro" },
        });
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
  } else if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    let identifier = invoice.subscription_details?.metadata?.identifier;
    if (!identifier && invoice.subscription) {
      const subId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      identifier = sub.metadata?.identifier;
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
}
