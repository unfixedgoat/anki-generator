import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const identifier = req.headers.get("x-forwarded-for") ?? "anonymous";
  return NextResponse.json({ identifier });
}
