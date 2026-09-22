"use client";

import { useState } from "react";
import { PendingOutcome } from "@/lib/types";

function snippet(text: string, maxChars = 90): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > maxChars ? `${singleLine.slice(0, maxChars)}…` : singleLine;
}

export default function OutcomeNudge({
  outcome,
  onAnswer,
  onSnooze,
}: {
  outcome: PendingOutcome;
  onAnswer: (replied: boolean) => void;
  onSnooze: () => void;
}) {
  const [answering, setAnswering] = useState(false);

  async function handleAnswer(replied: boolean) {
    if (answering) return;
    setAnswering(true);
    try {
      await onAnswer(replied);
    } finally {
      setAnswering(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-brand-200 bg-brand-50 p-4 shadow-sm">
      <p className="text-sm font-medium text-gray-900">
        Did {outcome.matchName || "your match"} reply? 💬
      </p>
      <p className="mt-1 text-xs italic text-gray-500">“{snippet(outcome.suggestionText)}”</p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleAnswer(true)}
          disabled={answering}
          className="rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          👍 Yes
        </button>
        <button
          type="button"
          onClick={() => handleAnswer(false)}
          disabled={answering}
          className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:border-red-400 hover:text-red-600 disabled:opacity-60"
        >
          👎 No
        </button>
        <button
          type="button"
          onClick={onSnooze}
          disabled={answering}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 disabled:opacity-60"
        >
          Ask me later
        </button>
      </div>
    </div>
  );
}
