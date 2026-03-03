import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", req.url));
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokens = (await tokenRes.json()) as any;

  if (!tokens.access_token) {
    return NextResponse.redirect(new URL("/?error=token_failed", req.url));
  }

  // Get user info
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (await userRes.json()) as any;

  await createSession({
    userId: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  });

  return NextResponse.redirect(new URL("/", req.url));
}
