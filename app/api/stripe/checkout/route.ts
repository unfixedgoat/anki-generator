import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

type Plan = "pro_monthly" | "pro_annual" | "one_time" | "one_time_deck";

const LOOKUP_KEYS: Record<Plan, string> = {
  pro_monthly: "pro_monthly",
  pro_annual: "pro_annual",
  one_time: "one_time_deck",
  one_time_deck: "one_time_deck",
};

const VALID_PLANS: Plan[] = ["pro_monthly", "pro_annual", "one_time", "one_time_deck"];

export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  let plan: Plan;
  let identifier: string;
  try {
    const body = await req.json();
    plan = body.plan;
    identifier = body.identifier ?? "anonymous";
    if (!VALID_PLANS.includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const stripe = new Stripe(secretKey);
  const isSubscription = plan !== "one_time" && plan !== "one_time_deck";
  const lookupKey = LOOKUP_KEYS[plan];

  const prices = await stripe.prices.list({ lookup_keys: [lookupKey] });
  const price = prices.data[0];
  if (!price) {
    return NextResponse.json(
      { error: `No price found for lookup key "${lookupKey}"` },
      { status: 400 }
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: isSubscription ? "subscription" : "payment",
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { identifier },
    ...(isSubscription ? { subscription_data: { metadata: { identifier } } } : {}),
    success_url: `https://highyield.cards?session_id={CHECKOUT_SESSION_ID}&upgraded=true`,
    cancel_url: `https://highyield.cards`,
  });

  return NextResponse.json({ url: session.url });
}
