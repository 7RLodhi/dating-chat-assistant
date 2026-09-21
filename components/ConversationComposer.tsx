"use client";

import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { ConversationRow } from "@/lib/conversationRows";

export default function ConversationComposer({
  rows,
  onRowsChange,
  onClearChat,
}: {
  rows: ConversationRow[];
  onRowsChange: (rows: ConversationRow[]) => void;
  onClearChat: () => void;
}) {
  const [theirDraft, setTheirDraft] = useState("");
  const [yourDraft, setYourDraft] = useState("");
  const [pastingSpeaker, setPastingSpeaker] = useState<"MATCH" | "USER" | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  function addRow(speaker: "MATCH" | "USER", text: string) {
    if (!text.trim()) return;
    onRowsChange([...rows, { speaker, text: text.trim() }]);
  }

  async function handlePasteClick(speaker: "MATCH" | "USER") {
    setPasteError(null);
    setPastingSpeaker(speaker);
    try {
      const raw = await navigator.clipboard.readText();
      const cleaned = raw.replace(/\s+/g, " ").trim();
      if (!cleaned) {
        setPasteError("Clipboard is empty — copy a message first, then tap paste.");
        return;
      }
      addRow(speaker, cleaned);
      trackEvent("clipboard_pasted", { speaker });
    } catch {
      setPasteError(
        "Couldn't read the clipboard — allow paste access, copy the message again, and retry."
      );
    } finally {
      setPastingSpeaker(null);
    }
  }

  function removeRow(index: number) {
    onRowsChange(rows.filter((_, i) => i !== index));
  }

  function updateRowText(index: number, text: string) {
    onRowsChange(rows.map((r, i) => (i === index ? { ...r, text } : r)));
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
          {rows.map((row, i) => {
            const isMatch = row.speaker === "MATCH";
            return (
              <div key={i} className={`flex ${isMatch ? "justify-start" : "justify-end"}`}>
                <div className="flex w-3/4 items-center gap-2">
                  {isMatch && (
                    <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                      They
                    </span>
                  )}
                  <RowEditor
                    value={row.text}
                    onChange={(text) => updateRowText(i, text)}
                  />
                  {!isMatch && (
                    <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700">
                      You
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label="Remove message"
                    className="shrink-0 text-gray-300 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClearChat}
            className="text-xs font-medium text-red-500 hover:text-red-700"
          >
            Clear chat
          </button>
        </div>
      )}

      <div className="w-3/4 space-y-1.5">
        <ComposeField
          value={theirDraft}
          onChange={setTheirDraft}
          onSubmit={(text) => {
            addRow("MATCH", text);
            setTheirDraft("");
          }}
        />
        <div className="flex items-center justify-start gap-2">
          <button
            type="button"
            onClick={() => handlePasteClick("MATCH")}
            disabled={pastingSpeaker !== null}
            className="rounded-full border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-60"
          >
            {pastingSpeaker === "MATCH" ? "Pasting…" : "📋 They said"}
          </button>
          {rows.length === 0 && pastingSpeaker === null && (
            <span className="animate-bounce rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-white shadow">
              👈 tap here to paste
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto w-3/4 space-y-1.5">
        <ComposeField
          value={yourDraft}
          onChange={setYourDraft}
          onSubmit={(text) => {
            addRow("USER", text);
            setYourDraft("");
          }}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => handlePasteClick("USER")}
            disabled={pastingSpeaker !== null}
            className="rounded-full bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pastingSpeaker === "USER" ? "Pasting…" : "You said 📋"}
          </button>
        </div>
      </div>

      {pasteError && <p className="text-xs text-red-600">{pasteError}</p>}
    </div>
  );
}

// Auto-growing textarea so long messages wrap onto 2nd/3rd lines instead
// of being cut off in a single-line input.
function RowEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-h-24 min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-gray-200 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
    />
  );
}

function ComposeField({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit(value);
        }
      }}
      placeholder="Type a message and press Enter…"
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
    />
  );
}
