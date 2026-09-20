"use client";

import { useEffect, useRef, useState } from "react";
import ToneSelector from "./ToneSelector";
import GoalSelector from "./GoalSelector";
import MoodBadge from "./MoodBadge";
import SuggestionCard from "./SuggestionCard";
import PaywallModal from "./PaywallModal";
import StylePanel from "./StylePanel";
import ScreenshotUpload from "./ScreenshotUpload";
import { trackEvent } from "@/lib/analytics";
import {
  getDailyLimit,
  getUsageToday,
  hasRemainingUsage,
  incrementUsage,
} from "@/lib/rateLimit";
import { extractImageFromClipboard, useScreenshotUpload } from "@/lib/useScreenshotUpload";
import { Goal, SuggestResponse, Tone } from "@/lib/types";

type Mode = "reply" | "opener";

export default function AssistantApp() {
  const [mode, setMode] = useState<Mode>("reply");
  const [conversationText, setConversationText] = useState("");
  const [profileText, setProfileText] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [tone, setTone] = useState<Tone>("witty");
  const [goal, setGoal] = useState<Goal>("get_a_reply");
  const [styleExamples, setStyleExamples] = useState("");
  const [viaScreenshot, setViaScreenshot] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestResponse | null>(null);

  const [usageToday, setUsageToday] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    setUsageToday(getUsageToday());
  }, []);

  const conversationUpload = useScreenshotUpload((text) => {
    setConversationText(text);
    setViaScreenshot(true);
  }, "conversation");

  const profileUpload = useScreenshotUpload((text) => {
    setProfileText(text);
    setViaScreenshot(true);
  }, "profile");

  // Lets you paste (Ctrl+V) a screenshot anywhere on the page, not just while
  // focused in a specific textarea — routed to whichever mode is active.
  // Refs avoid re-subscribing the listener on every keystroke re-render.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const conversationUploadRef = useRef(conversationUpload);
  conversationUploadRef.current = conversationUpload;
  const profileUploadRef = useRef(profileUpload);
  profileUploadRef.current = profileUpload;

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const file = extractImageFromClipboard(e.clipboardData);
      if (!file) return; // no image in clipboard — let normal text paste happen
      e.preventDefault();
      if (modeRef.current === "reply") {
        conversationUploadRef.current.processFile(file, "paste");
      } else {
        profileUploadRef.current.processFile(file, "paste");
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const dailyLimit = getDailyLimit();
  const inputText = mode === "reply" ? conversationText : profileText;
  const canSubmit = inputText.trim().length > 0 && !loading;

  async function handleGenerate() {
    if (!inputText.trim()) return;

    if (!hasRemainingUsage()) {
      setShowPaywall(true);
      trackEvent("paywall_shown", { usageToday, dailyLimit });
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    trackEvent("generate_requested", { mode, tone, goal });

    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          conversationText: mode === "reply" ? conversationText : undefined,
          profileText: mode === "opener" ? profileText : undefined,
          extraContext,
          tone,
          goal,
          styleExamples: styleExamples.trim() || undefined,
          viaScreenshot,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Something went wrong.");
      }

      setResult(data as SuggestResponse);
      const newCount = incrementUsage();
      setUsageToday(newCount);
      trackEvent("generate_succeeded", { mode, tone, goal });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      trackEvent("generate_failed", { mode, tone, goal, message });
    } finally {
      setLoading(false);
    }
  }

  async function handleVote(
    suggestionText: string,
    suggestionTone: string,
    approach: string,
    vote: "up" | "down"
  ) {
    trackEvent("suggestion_voted", { vote, tone: suggestionTone, approach });
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionText,
          tone: suggestionTone,
          approach,
          vote,
          generationId: result?.id,
        }),
      });
    } catch {
      // Best-effort logging; don't disrupt the user experience.
    }
  }

  const remaining = Math.max(dailyLimit - usageToday, 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Chat Assist</h1>
        <p className="mt-1 text-sm text-gray-500">
          Paste your conversation, pick a tone and goal, get suggestions to send yourself.
          Nothing is sent automatically.
        </p>
      </header>

      <div className="mb-6 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => setMode("reply")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            mode === "reply" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
          }`}
        >
          Reply to a conversation
        </button>
        <button
          type="button"
          onClick={() => setMode("opener")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            mode === "opener" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
          }`}
        >
          Write an opener
        </button>
      </div>

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {mode === "reply" ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Paste the conversation
              </label>
              <ScreenshotUpload
                uploading={conversationUpload.uploading}
                error={conversationUpload.error}
                onFileSelected={(file) => conversationUpload.processFile(file, "upload")}
              />
            </div>
            <textarea
              value={conversationText}
              onChange={(e) => {
                setConversationText(e.target.value);
                setViaScreenshot(false);
              }}
              rows={6}
              placeholder={"[MATCH]: hey! how's your week going\n[USER]: pretty good, just got back from a trip\n[MATCH]: ooh where'd you go?"}
              className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-brand-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-400">
              Tip: label lines [MATCH] and [USER] if you can — it helps the suggestions stay accurate.
              Or paste (Ctrl+V) a screenshot anywhere on this page and we'll transcribe it for you
              (review it before generating).
            </p>
          </div>
        ) : (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Describe their profile / bio
              </label>
              <ScreenshotUpload
                uploading={profileUpload.uploading}
                error={profileUpload.error}
                onFileSelected={(file) => profileUpload.processFile(file, "upload")}
              />
            </div>
            <textarea
              value={profileText}
              onChange={(e) => {
                setProfileText(e.target.value);
                setViaScreenshot(false);
              }}
              rows={4}
              placeholder="e.g. Bio says she loves hiking and bad puns. Prompt answer: 'my simple pleasures' -> 'iced coffee in winter'."
              className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-brand-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-400">
              Tip: you can also paste (Ctrl+V) a profile screenshot anywhere on this page.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Anything else worth knowing? (optional)
          </label>
          <input
            type="text"
            value={extraContext}
            onChange={(e) => setExtraContext(e.target.value)}
            placeholder="e.g. we already agreed to get coffee next week"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>

        <ToneSelector value={tone} onChange={setTone} />
        <GoalSelector value={goal} onChange={setGoal} />
        <StylePanel onExamplesChange={setStyleExamples} />

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canSubmit}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Thinking..." : "Get suggestions"}
        </button>

        <p className="text-center text-xs text-gray-400">
          {remaining > 0
            ? `${remaining} of ${dailyLimit} free suggestions left today`
            : "Free limit reached for today"}
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          {result.conversation_read && <MoodBadge read={result.conversation_read} />}
          <div className="space-y-3">
            {result.suggestions.map((s, i) => (
              <SuggestionCard
                key={i}
                suggestion={s}
                onVote={(vote) => handleVote(s.text, String(s.tone), s.approach, vote)}
              />
            ))}
          </div>
        </div>
      )}

      <footer className="mt-10 text-center text-xs text-gray-400">
        This is a validation prototype. Conversation text is sent to an AI provider to
        generate suggestions and is not stored beyond what's needed to do that. You always
        choose what to send — nothing is sent on your behalf.
      </footer>

      <PaywallModal open={showPaywall} onClose={() => setShowPaywall(false)} />
    </div>
  );
}
