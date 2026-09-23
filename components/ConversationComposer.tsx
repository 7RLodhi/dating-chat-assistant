"use client";

import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { ConversationRow } from "@/lib/conversationRows";

// Replies get noticeably better with a few messages of context; below this
// we nudge the user to add more instead of generating from almost nothing.
const MIN_CONTEXT_ROWS = 4;

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
  const listRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(rows.length);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // Follow new messages as they arrive so the latest is always visible.
  // Only scrolls when rows are added, never while typing or deleting.
  useEffect(() => {
    if (rows.length > prevCountRef.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
    prevCountRef.current = rows.length;
  }, [rows.length]);

  function updateScrollButton() {
    const el = listRef.current;
    if (!el) return;
    setShowScrollBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 24);
  }

  // Keep the chevron state correct as rows grow, shrink, or re-render.
  useEffect(() => {
    updateScrollButton();
  });

  function scrollToBottom() {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }

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

  function toggleSpeaker(index: number) {
    const row = rows[index];
    if (!row) return;
    const next = row.speaker === "MATCH" ? "USER" : "MATCH";
    onRowsChange(rows.map((r, i) => (i === index ? { ...r, speaker: next } : r)));
    trackEvent("speaker_swapped", { to: next });
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="relative">
          <div
            ref={listRef}
            onScroll={updateScrollButton}
            className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2"
          >
          {rows.map((row, i) => {
            const isMatch = row.speaker === "MATCH";
            return (
              <div key={i} className={`flex ${isMatch ? "justify-start" : "justify-end"}`}>
                <div className="flex w-3/4 items-center gap-2">
                  {isMatch && (
                    <button
                      type="button"
                      onClick={() => toggleSpeaker(i)}
                      title="Tap to swap: mark as sent by you"
                      className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-700 hover:ring-1 hover:ring-gray-400"
                    >
                      They
                    </button>
                  )}
                  <RowEditor
                    value={row.text}
                    onChange={(text) => updateRowText(i, text)}
                  />
                  {!isMatch && (
                    <button
                      type="button"
                      onClick={() => toggleSpeaker(i)}
                      title="Tap to swap: mark as sent by them"
                      className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700 hover:ring-1 hover:ring-brand-400"
                    >
                      You
                    </button>
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
          {showScrollBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label="Scroll to latest message"
              className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-500 shadow-md hover:text-brand-600"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
        </div>
      )}

      {rows.length > 0 && rows.length < MIN_CONTEXT_ROWS && (
        <p className="text-center text-xs text-gray-400">
          Add {MIN_CONTEXT_ROWS - rows.length} more{" "}
          {MIN_CONTEXT_ROWS - rows.length === 1 ? "message" : "messages"} for better replies ✨
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-400">Tap They / You to swap sides</p>
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
      className="no-scrollbar max-h-24 min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-gray-200 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
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
  // Mobile keyboards show Tab instead of Enter on single-line inputs, so the
  // explicit Add button is the primary submit path on phones (Enter keydown
  // still works on desktop hardware keyboards).
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          }
        }}
        placeholder="Type a message and tap + to add…"
        className="w-full rounded-md border border-gray-300 py-2 pl-3 pr-11 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onSubmit(value)}
        disabled={!value.trim()}
        aria-label="Add to chat"
        title="Add to chat"
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-brand-600 text-lg font-medium leading-none text-white hover:bg-brand-700 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
