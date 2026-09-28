import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");

/**
 * Appends one JSON object as a line to a local file under .data/.
 * Local-dev convenience only — see callers for production caveats.
 */
export async function appendJSONLine(
  fileName: string,
  record: Record<string, unknown>
): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const filePath = path.join(DATA_DIR, fileName);
    await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    // Never let logging failures break the request.
    // eslint-disable-next-line no-console
    console.error(`Failed to write to ${fileName}:`, err);
  }
}

/**
 * Reads JSON objects from a local .data/*.jsonl file (skips bad lines).
 * Bounded by `limit`: only the first `limit` lines are even parsed, so an
 * ever-growing local log file can't make every read slower over time
 * (mirrors the ROW_LIMIT + ascending-order semantics already applied to the
 * Supabase path in lib/stats.ts — this file previously had no bound at all,
 * and appendJSONLine always appends chronologically, so "first N lines" is
 * the same "oldest N records" the Supabase query selects).
 */
export async function readJSONLines<T = Record<string, unknown>>(
  fileName: string,
  limit = 2000
): Promise<T[]> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, fileName), "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const bounded = lines.slice(0, limit);
    const out: T[] = [];
    for (const line of bounded) {
      try {
        out.push(JSON.parse(line.trim()) as T);
      } catch {
        // Skip corrupt lines — logging must never break reads either.
      }
    }
    return out;
  } catch {
    return [];
  }
}
