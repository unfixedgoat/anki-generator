import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getPostHogClient } from "@/app/lib/posthog-server";

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
  try {
    const body = await req.json();
    plan = body.plan;
    if (!VALID_PLANS.includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { userId } = await auth();
  let customerEmail: string | undefined;
  if (userId) {
    const user = await currentUser();
    const primary = user?.emailAddresses?.find(
      (e) => e.id === user.primaryEmailAddressId
    );
    customerEmail = primary?.emailAddress;
  }

  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const realIp = forwarded.split(",").at(-1)?.trim() || "anonymous";
  const identifier = userId ?? realIp;

  const stripe = new Stripe(secretKey);
  const isSubscription = plan !== "one_time" && plan !== "one_time_deck";
  const lookupKey = LOOKUP_KEYS[plan];

  const prices = await stripe.prices.list({ lookup_keys: [lookupKey] });
  const price = prices.data[0];
  if (!price) {
    return NextResponse.json(
      { error: "Payment configuration error" },
      { status: 400 }
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: isSubscription ? "subscription" : "payment",
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { identifier },
    ...(userId ? { client_reference_id: userId } : {}),
    ...(customerEmail ? { customer_email: customerEmail } : {}),
    ...(isSubscription
      ? { subscription_data: { metadata: { identifier } } }
      : { payment_intent_data: { metadata: { identifier } } }),
    success_url: `https://highyield.cards?session_id={CHECKOUT_SESSION_ID}&upgraded=true`,
    cancel_url: `https://highyield.cards`,
  });

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: identifier,
    event: "checkout_session_created",
    properties: {
      plan,
      mode: isSubscription ? "subscription" : "payment",
    },
  });
  await posthog.shutdown();

  return NextResponse.json({ url: session.url });
}
