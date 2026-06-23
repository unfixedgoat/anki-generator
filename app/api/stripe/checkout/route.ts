import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { clientIp } from "@/app/lib/clientIp";

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

  // One-time $2 credit purchases are DISABLED. The live chunked generation gate
  // (app/api/deck/start) does not read or decrement credit: entries, so a
  // purchase grants nothing — the buyer is silently treated as free tier.
  // Rejected server-side (not just by hiding the UI CTA) so a crafted request
  // cannot create a charge. Re-enable only once deck/start enforces the credit
  // tier. See memory: credit-tier-dead-on-chunked-path.
  //
  // Typed string[] (not a `plan === ...` literal check) on purpose: it must NOT
  // narrow `plan`, or the retained one-time plumbing below (mode/payment branch)
  // becomes a dead comparison (TS2367). Kept in VALID_PLANS so re-enabling is a
  // one-line revert of this block.
  const DISABLED_PLANS: string[] = ["one_time", "one_time_deck"];
  if (DISABLED_PLANS.includes(plan)) {
    return NextResponse.json(
      { error: "One-time purchases are temporarily unavailable" },
      { status: 400 }
    );
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

  const realIp = clientIp(req);
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

  return NextResponse.json({ url: session.url });
}
