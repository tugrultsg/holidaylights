import { NextRequest, NextResponse } from "next/server";
import { getCredits, addBalance } from "@/lib/credits";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const credits = await getCredits(sessionId);
  return NextResponse.json({
    freeUsed: credits.freeUsed,
    balanceCents: credits.balanceCents,
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
      const amountCents = parseInt(session.metadata?.amountCents || "0", 10);
      if (amountCents > 0) {
        await addBalance(sessionId, amountCents);
      }
      const updated = await getCredits(sessionId);
      return NextResponse.json({
        freeUsed: updated.freeUsed,
        balanceCents: updated.balanceCents,
      });
    }
    return NextResponse.json({ error: "Payment not verified" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Could not verify payment" }, { status: 400 });
  }
}
