import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!query || query.length < 3) {
    return NextResponse.json({ predictions: [] });
  }

  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&components=country:us&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  const predictions = (data.predictions || []).map(
    (p: { description: string; place_id: string }) => ({
      description: p.description,
      placeId: p.place_id,
    })
  );

  return NextResponse.json({ predictions });
}
