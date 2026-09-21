"use client";

import { useState } from "react";
import ScreenshotIconButton from "./ScreenshotIconButton";
import { trackEvent } from "@/lib/analytics";
import { ConversationRow } from "@/lib/conversationRows";

export default function ConversationComposer({
  rows,
  onRowsChange,
  screenshotUploading,
  onScreenshotFile,
}: {
  rows: ConversationRow[];
  onRowsChange: (rows: ConversationRow[]) => void;
  screenshotUploading: boolean;
  onScreenshotFile: (file: File) => void;
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
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  row.speaker === "MATCH"
                    ? "bg-gray-200 text-gray-700"
                    : "bg-brand-100 text-brand-700"
                }`}
              >
                {row.speaker === "MATCH" ? "They" : "You"}
              </span>
              <input
                value={row.text}
                onChange={(e) => updateRowText(i, e.target.value)}
                className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="Remove message"
                className="shrink-0 text-gray-300 hover:text-red-500"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <ComposeField
          value={theirDraft}
          onChange={setTheirDraft}
          onSubmit={(text) => {
            addRow("MATCH", text);
            setTheirDraft("");
          }}
          screenshotUploading={screenshotUploading}
          onScreenshotFile={onScreenshotFile}
          onTextPasted={(text) => addRow("MATCH", text)}
        />
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => handlePasteClick("MATCH")}
            disabled={pastingSpeaker !== null}
            className="rounded-full border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-60"
          >
            {pastingSpeaker === "MATCH" ? "Pasting…" : "📋 They said"}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <ComposeField
          value={yourDraft}
          onChange={setYourDraft}
          onSubmit={(text) => {
            addRow("USER", text);
            setYourDraft("");
          }}
          screenshotUploading={screenshotUploading}
          onScreenshotFile={onScreenshotFile}
          onTextPasted={(text) => addRow("USER", text)}
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

function ComposeField({
  value,
  onChange,
  onSubmit,
  screenshotUploading,
  onScreenshotFile,
  onTextPasted,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  screenshotUploading: boolean;
  onScreenshotFile: (file: File) => void;
  onTextPasted: (text: string) => void;
}) {
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
        placeholder="Type a message and press Enter…"
        className="w-full rounded-md border border-gray-300 py-2 pl-3 pr-9 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
      />
      <ScreenshotIconButton
        uploading={screenshotUploading}
        onFileSelected={onScreenshotFile}
        onTextSelected={onTextPasted}
        className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2"
      />
    </div>
  );
}
