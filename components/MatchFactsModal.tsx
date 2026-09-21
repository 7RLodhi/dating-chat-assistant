"use client";

import MatchFactsPanel from "./MatchFactsPanel";
import { MatchFacts } from "@/lib/types";

export default function MatchFactsModal({
  open,
  onClose,
  matchName,
  facts,
  refreshing,
}: {
  open: boolean;
  onClose: () => void;
  matchName: string;
  facts: MatchFacts | null;
  refreshing: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
        <h3 className="text-lg font-semibold text-gray-900">📋 {matchName}'s summary</h3>
        <div className="mt-3">
          <MatchFactsPanel facts={facts} refreshing={refreshing} />
        </div>
      </div>
    </div>
  );
}
