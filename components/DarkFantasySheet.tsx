"use client";

import { useEffect, useState } from "react";
import CopyChip from "./CopyChip";
import { trackEvent } from "@/lib/analytics";
import { DARK_FANTASY_ITEMS, fantasyAsQuestion } from "@/lib/funContent";

const AGE_CONFIRM_KEY = "dca_18plus_confirmed_v0";

export default function DarkFantasySheet({
  open,
  onClose,
  blockedReason,
}: {
  open: boolean;
  onClose: () => void;
  /** Set when the active match appears to be under 18 — content is withheld. */
  blockedReason: string | null;
}) {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmed(window.localStorage.getItem(AGE_CONFIRM_KEY) === "yes");
    }
  }, [open]);

  if (!open) return null;

  function handleConfirm() {
    window.localStorage.setItem(AGE_CONFIRM_KEY, "yes");
    setConfirmed(true);
    trackEvent("adult_content_confirmed");
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
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              🔥 Dark Fantasy
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                18+
              </span>
            </h3>
            <p className="text-xs text-gray-500">Fantasy talk between consenting adults</p>
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

        {blockedReason ? (
          <div className="p-6 text-center">
            <p className="text-3xl">🚫</p>
            <p className="mt-2 text-sm font-medium text-gray-900">Not available for this match</p>
            <p className="mt-1 text-xs text-gray-500">{blockedReason}</p>
          </div>
        ) : !confirmed ? (
          <div className="space-y-3 p-6 text-center">
            <p className="text-sm text-gray-700">
              This section contains adult content. Only share with someone who is 18+ and has
              clearly shown they&apos;re into this kind of conversation — and respect a no.
            </p>
            <button
              type="button"
              onClick={handleConfirm}
              className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              I&apos;m 18+ — continue
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full text-xs text-gray-400 hover:text-gray-600"
            >
              Go back
            </button>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto p-4">
            <p className="px-1 text-[11px] text-gray-400">
              Tip: “Ask” copies it as a question — “Sach batao 😏 — … Haan ya na?”
            </p>
            {DARK_FANTASY_ITEMS.map((item, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl border border-gray-200 p-3">
                <p className="flex-1 text-sm text-gray-900">{item}</p>
                <CopyChip
                  text={fantasyAsQuestion(item)}
                  label="Ask"
                  onCopied={() => trackEvent("fun_item_copied", { deck: "dark_fantasy", part: "question" })}
                />
                <CopyChip
                  text={item}
                  onCopied={() => trackEvent("fun_item_copied", { deck: "dark_fantasy", part: "raw" })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
