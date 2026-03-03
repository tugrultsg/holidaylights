// Credits stored in Cloudflare KV for persistence across deploys
// Balance stored in cents to support $0.50 and $2.00 charges
// Key format: "credits:{sessionId}" -> JSON { freeUsed, balanceCents }

import { getCloudflareContext } from "@opennextjs/cloudflare";

declare global {
  interface CloudflareEnv {
    RATE_LIMIT: KVNamespace;
  }
}

interface CreditEntry {
  freeUsed: boolean;
  balanceCents: number; // stored in cents ($2.00 = 200)
}

async function getKV(): Promise<KVNamespace | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env.RATE_LIMIT || null;
  } catch {
    return null;
  }
}

function key(sessionId: string) {
  return `credits:${sessionId}`;
}

export async function getCredits(sessionId: string): Promise<CreditEntry> {
  const kv = await getKV();
  if (!kv) return { freeUsed: false, balanceCents: 0 };

  const data = await kv.get(key(sessionId), "json");
  if (!data) return { freeUsed: false, balanceCents: 0 };

  // Handle migration from old format
  const entry = data as Record<string, unknown>;
  if ("paidCredits" in entry) {
    // Old format: convert whole credits to cents ($2 each)
    const migrated: CreditEntry = {
      freeUsed: (entry.freeUsed as boolean) || false,
      balanceCents: ((entry.paidCredits as number) || 0) * 200,
    };
    await kv.put(key(sessionId), JSON.stringify(migrated));
    return migrated;
  }

  return data as CreditEntry;
}

export async function useFreeCredit(sessionId: string): Promise<void> {
  const kv = await getKV();
  if (!kv) return;

  const entry = await getCredits(sessionId);
  entry.freeUsed = true;
  await kv.put(key(sessionId), JSON.stringify(entry));
}

export async function charge(sessionId: string, amountCents: number): Promise<boolean> {
  const kv = await getKV();
  if (!kv) return false;

  const entry = await getCredits(sessionId);
  if (entry.balanceCents < amountCents) return false;
  entry.balanceCents -= amountCents;
  await kv.put(key(sessionId), JSON.stringify(entry));
  return true;
}

export async function addBalance(sessionId: string, amountCents: number): Promise<void> {
  const kv = await getKV();
  if (!kv) return;

  const entry = await getCredits(sessionId);
  entry.balanceCents += amountCents;
  await kv.put(key(sessionId), JSON.stringify(entry));
}
