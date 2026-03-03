import { NextRequest, NextResponse } from "next/server";

interface NeighborResult {
  address: string;
  lat: number;
  lng: number;
  streetViewUrl: string;
}

export async function POST(req: NextRequest) {
  const { address } = await req.json();
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Maps API key not configured" },
      { status: 500 }
    );
  }

  // Step 1: Geocode the customer address
  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const geocodeRes = await fetch(geocodeUrl);
  const geocodeData = await geocodeRes.json();

  if (geocodeData.status !== "OK" || !geocodeData.results.length) {
    return NextResponse.json(
      { error: "Could not geocode address. Please check and try again." },
      { status: 400 }
    );
  }

  const { lat, lng } = geocodeData.results[0].geometry.location;
  const customerAddress = geocodeData.results[0].formatted_address;

  // Step 2: Find neighbors by reverse-geocoding nearby offsets
  // We offset along the street in small increments (~30m apart)
  const offsets = [
    { dlat: 0.0003, dlng: 0 },
    { dlat: -0.0003, dlng: 0 },
    { dlat: 0.0006, dlng: 0 },
    { dlat: -0.0006, dlng: 0 },
    { dlat: 0, dlng: 0.0003 },
    { dlat: 0, dlng: -0.0003 },
    { dlat: 0, dlng: 0.0006 },
    { dlat: 0, dlng: -0.0006 },
    { dlat: 0.0003, dlng: 0.0003 },
    { dlat: -0.0003, dlng: -0.0003 },
  ];

  const seenAddresses = new Set<string>();
  seenAddresses.add(customerAddress); // exclude the customer's own address
  const neighbors: NeighborResult[] = [];

  // Reverse geocode each offset point to find unique nearby addresses
  const reversePromises = offsets.map(async ({ dlat, dlng }) => {
    const nLat = lat + dlat;
    const nLng = lng + dlng;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${nLat},${nLng}&key=${apiKey}&result_type=street_address`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "OK" && data.results.length > 0) {
      return data.results[0];
    }
    return null;
  });

  const reverseResults = await Promise.all(reversePromises);

  for (const result of reverseResults) {
    if (!result || neighbors.length >= 5) continue;
    const addr = result.formatted_address;
    if (seenAddresses.has(addr)) continue;
    seenAddresses.add(addr);

    const nLat = result.geometry.location.lat;
    const nLng = result.geometry.location.lng;

    // Generate a Street View image URL pointed at this location
    // Wider image (1200x800), wider FOV (90°) to capture more of the house, slight upward pitch
    const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=1200x800&location=${nLat},${nLng}&fov=90&pitch=5&key=${apiKey}`;

    neighbors.push({
      address: addr,
      lat: nLat,
      lng: nLng,
      streetViewUrl,
    });
  }

  return NextResponse.json({
    customerAddress,
    customerLat: lat,
    customerLng: lng,
    neighbors,
  });
}
