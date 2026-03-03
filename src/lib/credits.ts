// Credits stored in Cloudflare KV for persistence across deploys
// Key format: "credits:{sessionId}" -> JSON { freeUsed, paidCredits }

import { getCloudflareContext } from "@opennextjs/cloudflare";

declare global {
  interface CloudflareEnv {
    RATE_LIMIT: KVNamespace;
  }
}

interface CreditEntry {
  freeUsed: boolean;
  paidCredits: number;
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
  if (!kv) return { freeUsed: false, paidCredits: 0 };

  const data = await kv.get(key(sessionId), "json");
  if (!data) return { freeUsed: false, paidCredits: 0 };
  return data as CreditEntry;
}

export async function useFreeCredit(sessionId: string): Promise<void> {
  const kv = await getKV();
  if (!kv) return;

  const entry = await getCredits(sessionId);
  entry.freeUsed = true;
  await kv.put(key(sessionId), JSON.stringify(entry));
}

export async function usePaidCredit(sessionId: string): Promise<boolean> {
  const kv = await getKV();
  if (!kv) return false;

  const entry = await getCredits(sessionId);
  if (entry.paidCredits <= 0) return false;
  entry.paidCredits--;
  await kv.put(key(sessionId), JSON.stringify(entry));
  return true;
}

export async function addCredits(sessionId: string, amount: number): Promise<void> {
  const kv = await getKV();
  if (!kv) return;

  const entry = await getCredits(sessionId);
  entry.paidCredits += amount;
  await kv.put(key(sessionId), JSON.stringify(entry));
}
