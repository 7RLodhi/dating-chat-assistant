"use client";

import { useState } from "react";
import { Suggestion } from "@/lib/types";

export default function SuggestionCard({
  suggestion,
  onVote,
  onCopied,
}: {
  suggestion: Suggestion;
  onVote: (vote: "up" | "down") => void;
  onCopied?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [voted, setVoted] = useState<"up" | "down" | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(suggestion.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onCopied?.(suggestion.text);
    } catch {
      // Clipboard API can fail (permissions, insecure context); fail silently.
    }
  }

  function handleVote(vote: "up" | "down") {
    if (voted) return; // one vote per suggestion, keeps signal clean
    setVoted(vote);
    onVote(vote);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
          {suggestion.tone.replace("_", " ")}
        </span>
        {suggestion.approach.toLowerCase().includes("name pun") ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            🎯 name pun
          </span>
        ) : (
          <span className="text-xs text-gray-400">{suggestion.approach}</span>
        )}
      </div>
      <p className="text-[15px] leading-relaxed text-gray-900">{suggestion.text}</p>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Good suggestion"
            onClick={() => handleVote("up")}
            disabled={!!voted}
            className={`rounded-md px-2 py-1 text-lg ${
              voted === "up" ? "opacity-100" : "opacity-40 hover:opacity-80"
            } disabled:cursor-default`}
          >
            👍
          </button>
          <button
            type="button"
            aria-label="Bad suggestion"
            onClick={() => handleVote("down")}
            disabled={!!voted}
            className={`rounded-md px-2 py-1 text-lg ${
              voted === "down" ? "opacity-100" : "opacity-40 hover:opacity-80"
            } disabled:cursor-default`}
          >
            👎
          </button>
        </div>
      </div>
    </div>
  );
}
