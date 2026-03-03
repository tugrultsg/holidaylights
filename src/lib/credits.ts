// Shared credit store — tracks free usage and paid credits per session
// Key: sessionId, Value: { freeUsed: boolean, paidCredits: number }

interface CreditEntry {
  freeUsed: boolean;
  paidCredits: number;
}

const store = new Map<string, CreditEntry>();

export function getCredits(sessionId: string): CreditEntry {
  return store.get(sessionId) || { freeUsed: false, paidCredits: 0 };
}

export function useFreeCredit(sessionId: string): void {
  const entry = getCredits(sessionId);
  entry.freeUsed = true;
  store.set(sessionId, entry);
}

export function usePaidCredit(sessionId: string): boolean {
  const entry = getCredits(sessionId);
  if (entry.paidCredits <= 0) return false;
  entry.paidCredits--;
  store.set(sessionId, entry);
  return true;
}

export function addCredits(sessionId: string, amount: number): void {
  const entry = getCredits(sessionId);
  entry.paidCredits += amount;
  store.set(sessionId, entry);
}
