export interface ConversationRow {
  speaker: "MATCH" | "USER";
  text: string;
}

const LINE_PATTERN = /^\[(MATCH|USER)\]:\s?(.*)$/i;

/** Parses the "[MATCH]: ...\n[USER]: ..." string format into structured rows. */
export function parseConversationText(text: string): ConversationRow[] {
  const rows: ConversationRow[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(LINE_PATTERN);
    if (match) {
      rows.push({ speaker: match[1].toUpperCase() as "MATCH" | "USER", text: match[2].trim() });
    } else if (rows.length > 0) {
      // Continuation of a multi-line message rather than a new labeled line.
      rows[rows.length - 1] = {
        ...rows[rows.length - 1],
        text: `${rows[rows.length - 1].text} ${line}`,
      };
    }
  }
  return rows;
}

export function serializeRows(rows: ConversationRow[]): string {
  return rows.map((r) => `[${r.speaker}]: ${r.text}`).join("\n");
}
