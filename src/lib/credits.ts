// Credits stored in Cloudflare KV for persistence across deploys
// Balance stored in cents to support $0.50 and $2.00 charges
// Key format: "credits:{userId}" -> JSON { freeUsed, balanceCents }

import { getCloudflareContext } from "@opennextjs/cloudflare";

declare global {
  interface CloudflareEnv {
    RATE_LIMIT: KVNamespace;
  }
}

interface CreditEntry {
  freeUsed: number; // how many free generations used (max 5)
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
  if (!kv) return { freeUsed: 0, balanceCents: 0 };

  const data = await kv.get(key(sessionId), "json");
  if (!data) return { freeUsed: 0, balanceCents: 0 };

  const entry = data as Record<string, unknown>;

  // Migrate from old boolean freeUsed format
  if (typeof entry.freeUsed === "boolean") {
    const migrated: CreditEntry = {
      freeUsed: entry.freeUsed ? 5 : 0,
      balanceCents: (entry.balanceCents as number) || 0,
    };
    // Also handle old paidCredits format
    if ("paidCredits" in entry) {
      migrated.balanceCents = ((entry.paidCredits as number) || 0) * 200;
    }
    await kv.put(key(sessionId), JSON.stringify(migrated));
    return migrated;
  }

  // Handle old paidCredits format
  if ("paidCredits" in entry) {
    const migrated: CreditEntry = {
      freeUsed: (entry.freeUsed as number) || 0,
      balanceCents: ((entry.paidCredits as number) || 0) * 200,
    };
    await kv.put(key(sessionId), JSON.stringify(migrated));
    return migrated;
  }

  return data as CreditEntry;
}

export async function useFreeCredits(sessionId: string, count: number): Promise<void> {
  const kv = await getKV();
  if (!kv) return;

  const entry = await getCredits(sessionId);
  entry.freeUsed += count;
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
