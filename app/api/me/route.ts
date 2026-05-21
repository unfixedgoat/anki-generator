import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isPro } from "@/app/lib/ratelimit";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ isPro: false, plan: "free", identifier: null });
  }
  const pro = await isPro(userId);
  return NextResponse.json({
    isPro: pro,
    plan: pro ? "pro" : "free",
    identifier: userId,
  });
}
