"use client";

import { useState } from "react";
import CopyChip from "./CopyChip";
import { trackEvent } from "@/lib/analytics";
import { DOUBLE_MEANING_QUESTIONS } from "@/lib/funContent";

export default function DoubleMeaningSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  if (!open) return null;

  function reveal(i: number) {
    setRevealed((prev) => new Set(prev).add(i));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:px-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">😜 Double Meaning Questions</h3>
            <p className="text-xs text-gray-500">Send the question, let them guess, then reveal 😇</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        <div className="space-y-2 overflow-y-auto p-4">
          {DOUBLE_MEANING_QUESTIONS.map((item, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-start gap-2">
                <p className="flex-1 text-sm font-medium text-gray-900">{item.question}</p>
                <CopyChip
                  text={item.question}
                  onCopied={() => trackEvent("fun_item_copied", { deck: "double_meaning", part: "question" })}
                />
              </div>
              {revealed.has(i) ? (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-brand-50 px-2.5 py-1.5">
                  <p className="flex-1 text-sm text-brand-800">{item.answer}</p>
                  <CopyChip
                    text={item.answer}
                    label="Copy answer"
                    onCopied={() => trackEvent("fun_item_copied", { deck: "double_meaning", part: "answer" })}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => reveal(i)}
                  className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  👀 Reveal answer
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
