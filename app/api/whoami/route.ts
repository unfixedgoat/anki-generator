import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId } = await auth();
  if (userId) {
    return NextResponse.json({ identifier: userId, authed: true });
  }
  return NextResponse.json({ identifier: null, authed: false });
}
