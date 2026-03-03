import { NextRequest, NextResponse } from "next/server";
import { getCredits, addCredits } from "@/lib/credits";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const credits = getCredits(sessionId);
  return NextResponse.json({
    freeUsed: credits.freeUsed,
    paidCredits: credits.paidCredits,
  });
}

// POST to add credits (called after successful Stripe redirect as backup)
export async function POST(req: NextRequest) {
  const { sessionId, stripeSessionId } = await req.json();
  if (!sessionId || !stripeSessionId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  // Verify the Stripe session is actually paid
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-02-25.clover",
  });

  try {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    if (session.payment_status === "paid" && session.metadata?.sessionId === sessionId) {
      const credits = parseInt(session.metadata?.credits || "1", 10);
      addCredits(sessionId, credits);
      const updated = getCredits(sessionId);
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
