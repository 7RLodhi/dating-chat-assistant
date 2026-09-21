"use client";

import { useEffect, useRef, useState } from "react";
import ToneSelector from "./ToneSelector";
import GoalSelector from "./GoalSelector";
import LanguageSelector from "./LanguageSelector";
import MoodBadge from "./MoodBadge";
import SuggestionCard from "./SuggestionCard";
import PaywallModal from "./PaywallModal";
import StylePanel from "./StylePanel";
import ScreenshotUpload from "./ScreenshotUpload";
import MatchAvatar from "./MatchAvatar";
import NewMatchModal from "./NewMatchModal";
import MatchFactsModal from "./MatchFactsModal";
import { trackEvent } from "@/lib/analytics";
import { getDisplayAge } from "@/lib/ageUtils";
import { Match, addMatch, getMatches, updateMatch } from "@/lib/matches";
import {
  getDailyLimit,
  getUsageToday,
  hasRemainingUsage,
  incrementUsage,
} from "@/lib/rateLimit";
import { extractImageFromClipboard, useScreenshotUpload } from "@/lib/useScreenshotUpload";
import { FactsResponse, Goal, Language, MatchFacts, Mode, SuggestResponse, Tone } from "@/lib/types";

export default function AssistantApp() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [showNewMatchModal, setShowNewMatchModal] = useState(false);
  const [showBio, setShowBio] = useState(false);
  const [showFactsModal, setShowFactsModal] = useState(false);
  const [factsRefreshing, setFactsRefreshing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [bio, setBio] = useState("");
  const [conversationText, setConversationText] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [tone, setTone] = useState<Tone>("witty");
  const [goal, setGoal] = useState<Goal>("get_a_reply");
  const [language, setLanguage] = useState<Language>("auto");
  const [styleExamples, setStyleExamples] = useState("");
  const [viaScreenshot, setViaScreenshot] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestResponse | null>(null);

  const [usageToday, setUsageToday] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);

  const activeMatch = matches.find((m) => m.id === activeMatchId) ?? null;
  // No conversation yet -> opener mode (using their bio). Once there's an
  // actual back-and-forth pasted in, switch to reply mode automatically —
  // this replaces the old manual mode tabs.
  const effectiveMode: Mode = conversationText.trim() ? "reply" : "opener";

  useEffect(() => {
    setUsageToday(getUsageToday());
    const loaded = getMatches();
    setMatches(loaded);
    if (loaded.length > 0) {
      const mostRecent = loaded[loaded.length - 1];
      setActiveMatchId(mostRecent.id);
      setBio(mostRecent.bio);
      setConversationText(mostRecent.conversationText);
    }
  }, []);

  function handleBioChange(value: string) {
    setBio(value);
    setViaScreenshot(false);
    if (activeMatchId) updateMatch(activeMatchId, { bio: value });
  }

  function handleConversationChange(value: string) {
    setConversationText(value);
    setViaScreenshot(false);
    if (activeMatchId) updateMatch(activeMatchId, { conversationText: value });
  }

  const conversationUpload = useScreenshotUpload((text) => {
    handleConversationChange(text);
    setViaScreenshot(true);
  }, "conversation");

  const profileUpload = useScreenshotUpload((text) => {
    handleBioChange(text);
    setViaScreenshot(true);
  }, "profile");

  // Lets you paste (Ctrl+V) a screenshot anywhere on the page, not just while
  // focused in a specific textarea — routed based on effective mode. Refs
  // avoid re-subscribing the listener on every keystroke re-render.
  const effectiveModeRef = useRef(effectiveMode);
  effectiveModeRef.current = effectiveMode;
  const activeMatchIdRef = useRef(activeMatchId);
  activeMatchIdRef.current = activeMatchId;
  const showNewMatchModalRef = useRef(showNewMatchModal);
  showNewMatchModalRef.current = showNewMatchModal;
  const conversationUploadRef = useRef(conversationUpload);
  conversationUploadRef.current = conversationUpload;
  const profileUploadRef = useRef(profileUpload);
  profileUploadRef.current = profileUpload;

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (showNewMatchModalRef.current) return; // the modal handles its own paste
      if (!activeMatchIdRef.current) return; // nowhere to put it yet
      const file = extractImageFromClipboard(e.clipboardData);
      if (!file) return; // no image in clipboard — let normal text paste happen
      e.preventDefault();
      if (effectiveModeRef.current === "reply") {
        conversationUploadRef.current.processFile(file, "paste");
      } else {
        profileUploadRef.current.processFile(file, "paste");
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const dailyLimit = getDailyLimit();
  const inputText = effectiveMode === "reply" ? conversationText : bio;
  const canSubmit = Boolean(activeMatch) && inputText.trim().length > 0 && !loading;

  async function runGenerate(params: {
    mode: Mode;
    conversationText?: string;
    profileText?: string;
    matchName?: string;
  }) {
    const text = params.mode === "reply" ? params.conversationText : params.profileText;
    if (!text || !text.trim()) return;

    if (!hasRemainingUsage()) {
      setShowPaywall(true);
      trackEvent("paywall_shown", { usageToday, dailyLimit });
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    trackEvent("generate_requested", { mode: params.mode, tone, goal, language });

    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: params.mode,
          conversationText: params.mode === "reply" ? params.conversationText : undefined,
          profileText: params.mode === "opener" ? params.profileText : undefined,
          matchName: params.mode === "opener" ? params.matchName : undefined,
          extraContext,
          tone,
          goal,
          language,
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
      trackEvent("generate_succeeded", { mode: params.mode, tone, goal, language });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      trackEvent("generate_failed", { mode: params.mode, tone, goal, language, message });
    } finally {
      setLoading(false);
    }
  }

  // Runs alongside generation (not sequentially after it) to keep a living
  // fact sheet about the match — see MatchFactsPanel and app/api/facts.
  // Best-effort: failures here never surface as the main error banner.
  async function refreshFacts(matchId: string, bioText: string, conversationTextValue: string) {
    if (!bioText.trim() && !conversationTextValue.trim()) return;

    const existing = matches.find((m) => m.id === matchId)?.facts;
    const previousFacts: FactsResponse | undefined = existing
      ? (() => {
          const { updatedAt, ...rest } = existing;
          return rest;
        })()
      : undefined;

    setFactsRefreshing(true);
    try {
      const res = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: bioText, conversationText: conversationTextValue, previousFacts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Facts extraction failed.");

      const updatedFacts: MatchFacts = { ...(data as FactsResponse), updatedAt: new Date().toISOString() };
      updateMatch(matchId, { facts: updatedFacts });
      setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, facts: updatedFacts } : m)));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("refreshFacts failed:", err);
    } finally {
      setFactsRefreshing(false);
    }
  }

  function handleGenerateClick() {
    runGenerate({
      mode: effectiveMode,
      conversationText,
      profileText: bio,
      matchName: activeMatch?.name,
    });
    if (activeMatchId) {
      refreshFacts(activeMatchId, bio, conversationText);
    }
  }

  function handleSelectMatch(match: Match) {
    setActiveMatchId(match.id);
    setBio(match.bio);
    setConversationText(match.conversationText);
    setResult(null);
    setError(null);
    setShowBio(false);
  }

  function handleCreateMatch(name: string, matchBio: string) {
    const match = addMatch(name, matchBio);
    setMatches((prev) => [...prev, match]);
    setActiveMatchId(match.id);
    setBio(matchBio);
    setConversationText("");
    setResult(null);
    setError(null);
    setShowBio(false);
    setShowNewMatchModal(false);
    runGenerate({ mode: "opener", profileText: matchBio, matchName: name });
    refreshFacts(match.id, matchBio, "");
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
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Chat Assist</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pick a match, get suggestions to send yourself. Nothing is sent automatically.
        </p>
      </header>

      <div className="mb-6 flex items-center gap-3 overflow-x-auto pb-1">
        {matches.map((m) => (
          <MatchAvatar
            key={m.id}
            name={m.name}
            age={getDisplayAge(m.facts)}
            active={m.id === activeMatchId}
            onClick={() => handleSelectMatch(m)}
          />
        ))}
        <button
          type="button"
          onClick={() => setShowNewMatchModal(true)}
          className="flex w-16 flex-shrink-0 flex-col items-center gap-1"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-xl text-gray-400 hover:border-brand-400 hover:text-brand-500">
            +
          </span>
          <span className="text-xs text-gray-500">New</span>
        </button>
      </div>

      {!activeMatch ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Add your first match with "+ New" to get started — we'll ask for their name and bio
          and generate opening lines right away.
        </div>
      ) : (
        <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setShowBio((v) => !v)}
                  className="flex items-center gap-1 text-sm font-medium text-gray-700"
                >
                  {activeMatch.name}'s bio
                  <span className="text-xs text-gray-400">{showBio ? "▲ Hide" : "▼ Show"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFactsModal(true)}
                  className="flex items-center gap-1 text-sm font-medium text-gray-700"
                >
                  📋 Summary
                  {factsRefreshing && <span className="text-xs text-gray-400">⏳</span>}
                </button>
              </div>
              {showBio && (
                <ScreenshotUpload
                  uploading={profileUpload.uploading}
                  error={profileUpload.error}
                  onFileSelected={(file) => profileUpload.processFile(file, "upload")}
                />
              )}
            </div>
            {showBio && (
              <textarea
                value={bio}
                onChange={(e) => handleBioChange(e.target.value)}
                rows={3}
                placeholder="Paste their bio, prompts/answers, or describe their photos"
                className="mt-1.5 w-full rounded-lg border border-gray-300 p-3 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
              />
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Conversation (leave blank to get an opener from their bio)
              </label>
              <ScreenshotUpload
                uploading={conversationUpload.uploading}
                error={conversationUpload.error}
                onFileSelected={(file) => conversationUpload.processFile(file, "upload")}
              />
            </div>
            <textarea
              value={conversationText}
              onChange={(e) => handleConversationChange(e.target.value)}
              rows={6}
              placeholder={"[MATCH]: hey! how's your week going\n[USER]: pretty good, just got back from a trip\n[MATCH]: ooh where'd you go?"}
              className="w-full rounded-lg border border-gray-300 p-3 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-400">
              Tip: Paste a screenshot, or type and label lines like [MATCH]: and [USER]:
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Anything else worth knowing? (optional)
            </label>
            <input
              type="text"
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              placeholder="e.g. we already agreed to get coffee next week"
              className="w-full rounded-lg border border-gray-300 p-2.5 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
            />
          </div>

          <ToneSelector value={tone} onChange={setTone} />

          <div className="rounded-lg border border-gray-200">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700"
            >
              <span>⚙️ Advanced settings</span>
              <span className="text-xs text-gray-400">{showAdvanced ? "▲ Hide" : "▼ Show"}</span>
            </button>
            {showAdvanced && (
              <div className="space-y-4 border-t border-gray-200 p-3">
                <GoalSelector value={goal} onChange={setGoal} />
                <LanguageSelector value={language} onChange={setLanguage} />
                <StylePanel onExamplesChange={setStyleExamples} />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleGenerateClick}
            disabled={!canSubmit}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Thinking..." : "Generate reply suggestions"}
          </button>

          <p className="text-center text-xs text-gray-400">
            {remaining > 0
              ? `${remaining} of ${dailyLimit} free suggestions left today`
              : "Free limit reached for today"}
          </p>
        </div>
      )}

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
      <NewMatchModal
        open={showNewMatchModal}
        onClose={() => setShowNewMatchModal(false)}
        onCreate={handleCreateMatch}
      />
      {activeMatch && (
        <MatchFactsModal
          open={showFactsModal}
          onClose={() => setShowFactsModal(false)}
          matchName={activeMatch.name}
          facts={activeMatch.facts ?? null}
          refreshing={factsRefreshing}
        />
      )}
    </div>
  );
}
