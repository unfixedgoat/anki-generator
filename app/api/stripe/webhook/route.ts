import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Redis } from "@upstash/redis";

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const identifier = session.client_reference_id ?? session.metadata?.identifier;
    if (identifier) {
      if (session.mode === "subscription") {
        await redis.set(`pro:${identifier}`, "1", { ex: PRO_TTL });
      } else {
        await redis.set(`pro:${identifier}`, "1");
      }
    }
  } else if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const identifier = subscription.metadata?.identifier;
    if (identifier) {
      await redis.del(`pro:${identifier}`);
    }
  }

  return NextResponse.json({ received: true });
}
