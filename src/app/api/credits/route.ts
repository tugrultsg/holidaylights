import { NextRequest, NextResponse } from "next/server";
import { getCredits, addCredits } from "@/lib/credits";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const credits = await getCredits(sessionId);
  return NextResponse.json({
    freeUsed: credits.freeUsed,
    paidCredits: credits.paidCredits,
  });
}

export async function POST(req: NextRequest) {
  const { sessionId, stripeSessionId } = (await req.json()) as { sessionId: string; stripeSessionId: string };
  if (!sessionId || !stripeSessionId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-02-25.clover",
  });

  try {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    if (session.payment_status === "paid" && session.metadata?.sessionId === sessionId) {
      const credits = parseInt(session.metadata?.credits || "1", 10);
      await addCredits(sessionId, credits);
      const updated = await getCredits(sessionId);
      return NextResponse.json({
        freeUsed: updated.freeUsed,
        paidCredits: updated.paidCredits,
      });
    }
    return NextResponse.json({ error: "Payment not verified" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Could not verify payment" }, { status: 400 });
  }
}
