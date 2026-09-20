"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import {
  clearStyle,
  getCachedStyleAnalysis,
  getStyleExamples,
  saveStyleAnalysis,
  saveStyleExamples,
} from "@/lib/styleProfile";
import { StyleAnalysis } from "@/lib/types";

export default function StylePanel({
  onExamplesChange,
}: {
  onExamplesChange: (examples: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [examples, setExamples] = useState("");
  const [analysis, setAnalysis] = useState<StyleAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = getStyleExamples();
    setExamples(saved);
    setAnalysis(getCachedStyleAnalysis());
    onExamplesChange(saved);
    // Only run once on mount — this hydrates from localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSave() {
    saveStyleExamples(examples);
    onExamplesChange(examples);
    trackEvent("style_saved", { chars: examples.length });
  }

  function handleClear() {
    clearStyle();
    setExamples("");
    setAnalysis(null);
    onExamplesChange("");
    trackEvent("style_cleared");
  }

  async function handleAnalyze() {
    if (!examples.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleMessages: examples }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't analyze that.");
      setAnalysis(data as StyleAnalysis);
      saveStyleAnalysis(data as StyleAnalysis);
      trackEvent("style_analyzed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAnalyzing(false);
    }
  }

  const hasExamples = examples.trim().length > 0;

  return (
    <div className="rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700"
      >
        <span>
          🎨 Your writing style{" "}
          {hasExamples && <span className="text-xs font-normal text-green-600">(saved)</span>}
        </span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-gray-200 px-3 py-3">
          <p className="text-xs text-gray-500">
            Paste 5–10 messages you&apos;ve actually sent before (from any conversation). We&apos;ll
            use them as a voice reference so suggestions sound more like you — capitalization,
            punctuation, typical length, emoji habits, etc.
          </p>
          <textarea
            value={examples}
            onChange={(e) => setExamples(e.target.value)}
            rows={4}
            placeholder={"lol yeah that's fair\nhonestly same, no notes\nwait that's actually so real"}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-brand-500 focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasExamples}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              Save style
            </button>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!hasExamples || analyzing}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-400 disabled:opacity-50"
            >
              {analyzing ? "Analyzing..." : "What did you notice?"}
            </button>
            {hasExamples && (
              <button
                type="button"
                onClick={handleClear}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Forget style
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {analysis && (
            <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
              <p className="font-medium">What we noticed:</p>
              <p className="mt-1">{analysis.summary}</p>
              <ul className="mt-2 list-inside list-disc text-xs">
                {analysis.traits.map((trait, i) => (
                  <li key={i}>{trait}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-gray-400">
            Saved on this device only. Every generation will include your saved examples as a
            style reference — this analysis is just for your own visibility, it isn&apos;t
            required for style-matching to work.
          </p>
        </div>
      )}
    </div>
  );
}
