import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

fal.config({
  credentials: process.env.FAL_KEY,
});

export const maxDuration = 60;

const DAILY_LIMIT = 10;

// In-memory rate limit store (resets on worker restart, but good enough for basic protection)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    // New day or first request
    rateLimitMap.set(ip, {
      count: 1,
      resetAt: now + 24 * 60 * 60 * 1000,
    });
    return { allowed: true, remaining: DAILY_LIMIT - 1 };
  }

  if (entry.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: DAILY_LIMIT - entry.count };
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0] ||
    "unknown";

  const { allowed, remaining } = checkRateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "Daily limit reached (10 generations per day). Please try again tomorrow." },
      {
        status: 429,
        headers: { "X-RateLimit-Remaining": "0" },
      }
    );
  }

  const { imageUrl, address } = await req.json();

  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
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

    return NextResponse.json({
      originalUrl: imageUrl,
      generatedUrl: data.images[0].url,
      address,
      remaining,
    });
  } catch (error: unknown) {
    console.error("fal.ai error:", error);
    const message = error instanceof Error ? error.message : "Image generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
