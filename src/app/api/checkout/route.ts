import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSession } from "@/lib/auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
  httpClient: Stripe.createFetchHttpClient(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { amountCents } = (await req.json()) as { amountCents: number };

  if (!amountCents || amountCents < 200) {
    return NextResponse.json({ error: "Minimum purchase is $2.00" }, { status: 400 });
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded",
      locale: "en",
      adaptive_pricing: { enabled: false },
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
        userId: session.userId,
        amountCents: amountCents.toString(),
      },
      customer_email: session.email,
      redirect_on_completion: "never",
      payment_intent_data: {
        statement_descriptor: "HOLIDAYLIGHTSON",
      },
    });

    return NextResponse.json({ clientSecret: checkoutSession.client_secret });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Stripe checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
