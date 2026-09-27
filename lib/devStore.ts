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

/** Reads every JSON object from a local .data/*.jsonl file (skips bad lines). */
export async function readJSONLines<T = Record<string, unknown>>(
  fileName: string
): Promise<T[]> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, fileName), "utf-8");
    const out: T[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // Skip corrupt lines — logging must never break reads either.
      }
    }
    return out;
  } catch {
    return [];
  }
}
