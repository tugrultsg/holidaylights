import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

export async function POST(req: NextRequest) {
  const { amountCents, sessionId } = (await req.json()) as { amountCents: number; sessionId?: string };

  if (!amountCents || amountCents < 200) {
    return NextResponse.json({ error: "Minimum purchase is $2.00" }, { status: 400 });
  }

  const origin = req.headers.get("origin") || "https://hunsaker-holiday-lights.tt-2ec.workers.dev";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: "Holiday Lights Balance",
            description: `$${(amountCents / 100).toFixed(2)} balance — $2/address (all 5) or $0.50/single home`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      sessionId: sessionId || "",
      amountCents: amountCents.toString(),
    },
    success_url: `${origin}?payment=success`,
    cancel_url: `${origin}?payment=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
