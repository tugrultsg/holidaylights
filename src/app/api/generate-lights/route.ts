import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { getCredits, useFreeCredit, charge } from "@/lib/credits";
import { getSession } from "@/lib/auth";

fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 120;

const PROMPT =
  "Add beautiful, colorful Christmas holiday lights decorating the roofline, gutters, windows, and porch of this house. The lights should look realistic and festive, with warm white and multi-colored LED string lights outlining the architectural features. Remove any cars, vehicles, or automobiles parked in the driveway, street, or in front of the house — replace them with a clean, empty driveway and street. Keep the house and surroundings exactly the same otherwise, only add the Christmas lights and remove the cars. Make it look like a professional holiday light installation at nighttime or dusk with the lights glowing brightly.";

interface NeighborInput {
  imageUrl: string;
  address: string;
}

async function generateOne(neighbor: NeighborInput) {
  try {
    const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
      input: {
        prompt: PROMPT,
        image_urls: [neighbor.imageUrl],
        num_images: 1,
        output_format: "png" as const,
      },
      logs: false,
    });

    const data = result.data as { images?: { url: string }[] };

    if (!data.images || data.images.length === 0) {
      return { address: neighbor.address, originalUrl: neighbor.imageUrl, generatedUrl: null, error: "No image generated" };
    }

    return {
      address: neighbor.address,
      originalUrl: neighbor.imageUrl,
      generatedUrl: data.images[0].url,
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return { address: neighbor.address, originalUrl: neighbor.imageUrl, generatedUrl: null, error: message };
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { neighbors } = (await req.json()) as { neighbors: NeighborInput[] };

  if (!neighbors || neighbors.length === 0) {
    return NextResponse.json({ error: "neighbors are required" }, { status: 400 });
  }

  const userId = session.userId;
  const isBatch = neighbors.length > 1;
  const costCents = isBatch ? 200 : 50;

  const credits = await getCredits(userId);

  if (!credits.freeUsed && isBatch) {
    await useFreeCredit(userId);
  } else if (credits.balanceCents >= costCents) {
    const charged = await charge(userId, costCents);
    if (!charged) {
      return NextResponse.json(
        { error: "NO_CREDITS", message: isBatch ? "Not enough balance. All 5 neighbors cost $2.00." : "Not enough balance. Single generation costs $0.50." },
        { status: 402 }
      );
    }
  } else {
    return NextResponse.json(
      { error: "NO_CREDITS", message: isBatch ? "You've used your free search. All 5 neighbors cost $2.00, or generate one at a time for $0.50 each." : "Not enough balance. Single generation costs $0.50. Add funds to continue." },
      { status: 402 }
    );
  }

  const results = await Promise.all(neighbors.map(generateOne));
  const updatedCredits = await getCredits(userId);

  return NextResponse.json({
    results,
    balanceCents: updatedCredits.balanceCents,
    freeUsed: updatedCredits.freeUsed,
  });
}
