import { NextResponse } from "next/server";
import { getCredits } from "@/lib/credits";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const credits = await getCredits(session.userId);
  return NextResponse.json({
    freeUsed: credits.freeUsed,
    balanceCents: credits.balanceCents,
  });
}
