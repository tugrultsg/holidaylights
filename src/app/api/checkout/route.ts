import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

export async function POST(req: NextRequest) {
  const { quantity, sessionId } = (await req.json()) as { quantity?: number; sessionId?: string };
  const credits = quantity || 1;

  const origin = req.headers.get("origin") || "https://hunsaker-holiday-lights.tt-2ec.workers.dev";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: 200, // $2.00
          product_data: {
            name: "Holiday Lights Generation Credit",
            description: "AI-powered holiday lights preview for one home",
          },
        },
        quantity: credits,
      },
    ],
    metadata: {
      sessionId: sessionId || "",
      credits: credits.toString(),
    },
    success_url: `${origin}?payment=success&credits=${credits}`,
    cancel_url: `${origin}?payment=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
