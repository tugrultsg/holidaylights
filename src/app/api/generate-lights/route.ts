import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { getCredits, useFreeCredit, usePaidCredit } from "@/lib/credits";

fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { imageUrl, address, sessionId } = (await req.json()) as { imageUrl: string; address: string; sessionId: string };

  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
  }

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  // Check credits
  const credits = await getCredits(sessionId);

  if (!credits.freeUsed) {
    await useFreeCredit(sessionId);
  } else if (credits.paidCredits > 0) {
    await usePaidCredit(sessionId);
  } else {
    return NextResponse.json(
      {
        error: "NO_CREDITS",
        message: "You've used your free generation. Purchase credits to continue ($2 per generation).",
      },
      { status: 402 }
    );
  }

  try {
    const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
      input: {
        prompt:
          "Add beautiful, colorful Christmas holiday lights decorating the roofline, gutters, windows, and porch of this house. The lights should look realistic and festive, with warm white and multi-colored LED string lights outlining the architectural features. Remove any cars, vehicles, or automobiles parked in the driveway, street, or in front of the house — replace them with a clean, empty driveway and street. Keep the house and surroundings exactly the same otherwise, only add the Christmas lights and remove the cars. Make it look like a professional holiday light installation at nighttime or dusk with the lights glowing brightly.",
        image_urls: [imageUrl],
        num_images: 1,
        output_format: "png" as const,
      },
      logs: false,
    });

    const data = result.data as { images?: { url: string }[] };

    if (!data.images || data.images.length === 0) {
      return NextResponse.json(
        { error: "No image generated" },
        { status: 500 }
      );
    }

    const updatedCredits = await getCredits(sessionId);

    return NextResponse.json({
      originalUrl: imageUrl,
      generatedUrl: data.images[0].url,
      address,
      credits: updatedCredits.paidCredits,
      freeUsed: updatedCredits.freeUsed,
    });
  } catch (error: unknown) {
    console.error("fal.ai error:", error);
    const message = error instanceof Error ? error.message : "Image generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
