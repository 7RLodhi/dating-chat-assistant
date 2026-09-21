// v0 rate limiting is intentionally simple: a per-browser daily counter in
// localStorage. It's trivially bypassable (incognito, clearing storage), which
// is an acceptable tradeoff for a validation-stage product with no real
// billing yet. Before charging real money, replace this with a server-side
// counter keyed by account/device ID (e.g., Upstash Redis or a Supabase row).

const STORAGE_KEY = "dca_usage_v0";

interface UsageRecord {
  date: string; // YYYY-MM-DD
  count: number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readRecord(): UsageRecord {
  if (typeof window === "undefined") return { date: todayKey(), count: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as UsageRecord;
    if (parsed.date !== todayKey()) return { date: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

function writeRecord(record: UsageRecord) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export function getDailyLimit(): number {
  const envLimit = Number(process.env.NEXT_PUBLIC_FREE_DAILY_LIMIT);
  return Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 5;
}

export function getUsageToday(): number {
  return readRecord().count;
}

export function hasRemainingUsage(): boolean {
  return getUsageToday() < getDailyLimit();
}

export function incrementUsage(): number {
  const record = readRecord();
  const next = { date: record.date, count: record.count + 1 };
  writeRecord(next);
  return next.count;
}

export function resetUsage(): number {
  const next = { date: todayKey(), count: 0 };
  writeRecord(next);
  return next.count;
}
