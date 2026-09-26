"use client";

import { useEffect, useRef, useState } from "react";
import ToneSelector from "./ToneSelector";
import GoalSelector from "./GoalSelector";
import LanguageSelector from "./LanguageSelector";
import MoodBadge from "./MoodBadge";
import SuggestionCard from "./SuggestionCard";
import PaywallModal from "./PaywallModal";
import StylePanel from "./StylePanel";
import ConversationComposer from "./ConversationComposer";
import MatchAvatar from "./MatchAvatar";
import NewMatchModal from "./NewMatchModal";
import BioModal from "./BioModal";
import EditMatchModal from "./EditMatchModal";
import MatchFactsModal from "./MatchFactsModal";
import NamePunDirectory from "./NamePunDirectory";
import SideMenu, { SideMenuItem } from "./SideMenu";
import DoubleMeaningSheet from "./DoubleMeaningSheet";
import DarkFantasySheet from "./DarkFantasySheet";
import { trackEvent } from "@/lib/analytics";
import OutcomeNudge from "./OutcomeNudge";
import TasteHint from "./TasteHint";
import { recordTasteVote, summarizeTaste } from "@/lib/tasteProfile";
import {
  enqueueOutcome,
  getDueOutcomes,
  resolveOutcome,
  snoozeOutcomeForVisit,
} from "@/lib/outcomes";
import {
  SAMPLE_MATCH_BIO,
  SAMPLE_MATCH_CONVERSATION,
  SAMPLE_MATCH_NAME,
} from "@/lib/sampleMatch";
import { getDisplayAge, minorBlockReason } from "@/lib/ageUtils";
import { ConversationRow, parseConversationText, serializeRows } from "@/lib/conversationRows";
import { Match, addMatch, deleteMatch, getMatches, updateMatch } from "@/lib/matches";
import {
  getDailyLimit,
  getUsageToday,
  hasRemainingUsage,
  incrementUsage,
  resetUsage,
} from "@/lib/rateLimit";
import {
  extractImageFromClipboard,
  readClipboardContent,
  useScreenshotUpload,
} from "@/lib/useScreenshotUpload";
import { usePwaInstall } from "@/lib/pwa";
import { APP_VERSION } from "@/lib/version";
import { FactsResponse, Goal, Language, MatchFacts, Mode, PendingOutcome, SuggestResponse, Tone } from "@/lib/types";

export default function AssistantApp() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [showNewMatchModal, setShowNewMatchModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBioModal, setShowBioModal] = useState(false);
  const [showFactsModal, setShowFactsModal] = useState(false);
  const [factsRefreshing, setFactsRefreshing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPunDirectory, setShowPunDirectory] = useState(false);
  const [pasteScreenshotError, setPasteScreenshotError] = useState<string | null>(null);
  const [dueOutcomes, setDueOutcomes] = useState<PendingOutcome[]>([]);
  const [tasteVersion, setTasteVersion] = useState(0);

  const [bio, setBio] = useState("");
  const [conversationRows, setConversationRows] = useState<ConversationRow[]>([]);
  const conversationText = serializeRows(conversationRows);
  const [extraContext, setExtraContext] = useState("");
  const [tone, setTone] = useState<Tone | null>(null);
  const [goal, setGoal] = useState<Goal>("get_a_reply");
  const [language, setLanguage] = useState<Language>("auto");
  const [styleExamples, setStyleExamples] = useState("");
  const [viaScreenshot, setViaScreenshot] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestResponse | null>(null);

  const [usageToday, setUsageToday] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showSideMenu, setShowSideMenu] = useState(false);
  const [openDeck, setOpenDeck] = useState<SideMenuItem | null>(null);
  const [resetHint, setResetHint] = useState<string | null>(null);
  const { isAndroid, isInstalled, promptInstall } = usePwaInstall();

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
      const loadedRows = parseConversationText(mostRecent.conversationText);
      setConversationRows(loadedRows);
      setTone(mostRecent.tone ?? null);
      evaluateOutcomes(mostRecent.id, loadedRows.length);
    }
  }, []);

  function evaluateOutcomes(matchId: string | null, rowCount: number) {
    setDueOutcomes(getDueOutcomes(matchId, rowCount));
  }

  function refreshDueOutcomes() {
    evaluateOutcomes(activeMatchId, conversationRows.length);
  }

  const shownOutcomeId = dueOutcomes[0]?.id;
  useEffect(() => {
    if (shownOutcomeId) trackEvent("outcome_prompt_shown");
  }, [shownOutcomeId]);

  function handleSaveBio(draft: string, fromScreenshot: boolean) {
    setBio(draft);
    setViaScreenshot(fromScreenshot);
    if (activeMatchId) updateMatch(activeMatchId, { bio: draft });
    setShowBioModal(false);
  }

  function persistRows(rows: ConversationRow[], fromScreenshot: boolean) {
    setConversationRows(rows);
    setViaScreenshot(fromScreenshot);
    if (activeMatchId) updateMatch(activeMatchId, { conversationText: serializeRows(rows) });
    evaluateOutcomes(activeMatchId, rows.length);
  }

  function handleRowsChange(rows: ConversationRow[]) {
    persistRows(rows, false);
  }

  // Shared by the global Ctrl+V-anywhere listener and the Upload Chat
  // Screenshot button — both append whatever OCR finds onto the current rows.
  // OCR takes seconds, so the callback reads live refs rather than the
  // render-time closure: rows added meanwhile aren't overwritten, and if the
  // user switched matches mid-transcription the result goes to the match it
  // was started from (saved to storage) instead of landing on the wrong screen.
  const latestRowsRef = useRef(conversationRows);
  latestRowsRef.current = conversationRows;
  const latestMatchIdRef = useRef(activeMatchId);
  latestMatchIdRef.current = activeMatchId;
  const uploadMatchIdRef = useRef<string | null>(null);

  const conversationUpload = useScreenshotUpload((text) => {
    const parsed = parseConversationText(text);
    if (parsed.length === 0) return;
    const originId = uploadMatchIdRef.current;
    if (originId && originId !== latestMatchIdRef.current) {
      const origin = getMatches().find((m) => m.id === originId);
      if (origin) {
        const merged = [...parseConversationText(origin.conversationText), ...parsed];
        const serialized = serializeRows(merged);
        updateMatch(originId, { conversationText: serialized });
        setMatches((prev) =>
          prev.map((m) => (m.id === originId ? { ...m, conversationText: serialized } : m))
        );
      }
      return;
    }
    persistRows([...latestRowsRef.current, ...parsed], true);
  }, "conversation");

  function startConversationUpload(file: File, source: "upload" | "paste") {
    uploadMatchIdRef.current = latestMatchIdRef.current;
    conversationUpload.processFile(file, source);
  }



  // Lets you paste (Ctrl+V) a screenshot anywhere on the page, not just while
  // focused in a specific field. Pasted images always go to the conversation
  // as chat — bio screenshots have their own camera icon on the bio field.
  // Refs avoid re-subscribing the listener on every keystroke re-render.
  const activeMatchIdRef = useRef(activeMatchId);
  activeMatchIdRef.current = activeMatchId;
  const showNewMatchModalRef = useRef(showNewMatchModal);
  showNewMatchModalRef.current = showNewMatchModal;
  const startUploadRef = useRef(startConversationUpload);
  startUploadRef.current = startConversationUpload;
  const chatScreenshotInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (showNewMatchModalRef.current) return; // the modal handles its own paste
      if (!activeMatchIdRef.current) return; // nowhere to put it yet
      const file = extractImageFromClipboard(e.clipboardData);
      if (!file) return; // no image in clipboard — let normal text paste happen
      e.preventDefault();
      startUploadRef.current(file, "paste");
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  // The Upload button pastes straight from the clipboard when a screenshot
  // is sitting there (the common phone/Win+Shift+S flow) and only opens the
  // file picker when the clipboard has no image.
  async function handleUploadChatScreenshotClick() {
    const clipboardContent = await readClipboardContent();
    if (clipboardContent?.type === "image") {
      startConversationUpload(clipboardContent.file, "paste");
      return;
    }
    chatScreenshotInputRef.current?.click();
  }

  // Explicit paste button: same clipboard-image path, but with a clear
  // message instead of a file picker when there's nothing to paste.
  async function handlePasteScreenshotClick() {
    setPasteScreenshotError(null);
    const clipboardContent = await readClipboardContent();
    if (clipboardContent?.type === "image") {
      startConversationUpload(clipboardContent.file, "paste");
      return;
    }
    setPasteScreenshotError("No screenshot in the clipboard — copy one first, then tap again.");
  }

  const dailyLimit = getDailyLimit();
  // Openers can work from the name alone when no bio was given, so the
  // button stays usable for name-only matches instead of silently disabling.
  const inputText =
    effectiveMode === "reply" ? conversationText : bio || activeMatch?.name || "";
  const canSubmit = Boolean(activeMatch) && inputText.trim().length > 0 && !loading;

  async function runGenerate(params: {
    mode: Mode;
    conversationText?: string;
    profileText?: string;
    matchName?: string;
  }) {
    // Name-only openers: the API needs non-empty profile text, and the
    // opener prompt already handles sparse profiles gracefully.
    if (params.mode === "opener" && !params.profileText?.trim() && params.matchName?.trim()) {
      params = {
        ...params,
        profileText: `(No bio provided — the only thing known is their name: ${params.matchName.trim()})`,
      };
    }
    const text = params.mode === "reply" ? params.conversationText : params.profileText;
    if (!text || !text.trim()) return;

    if (!hasRemainingUsage()) {
      setShowPaywall(true);
      trackEvent("paywall_shown", { usageToday, dailyLimit });
      return;
    }

    // No chip selected means auto: match the conversation's own energy.
    const requestTone = tone ?? "auto";
    setLoading(true);
    setError(null);
    setResult(null);
    trackEvent("generate_requested", { mode: params.mode, tone: requestTone, goal, language });

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
          tone: requestTone,
          goal,
          language,
          styleExamples: styleExamples.trim() || undefined,
          viaScreenshot,
          tasteProfile: summarizeTaste()?.summary,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Something went wrong.");
      }

      setResult(data as SuggestResponse);
      const newCount = incrementUsage();
      setUsageToday(newCount);
      trackEvent("generate_succeeded", { mode: params.mode, tone: requestTone, goal, language });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      trackEvent("generate_failed", { mode: params.mode, tone: requestTone, goal, language, message });
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
    const selectedRows = parseConversationText(match.conversationText);
    setConversationRows(selectedRows);
    setResult(null);
    setError(null);
    setShowBioModal(false);
    setTone(match.tone ?? null);
    evaluateOutcomes(match.id, selectedRows.length);
  }

  function handleToneChange(next: Tone | null) {
    setTone(next);
    if (activeMatchId) updateMatch(activeMatchId, { tone: next });
  }

  function handleCreateMatch(name: string, matchBio: string, generate: boolean) {
    const match = addMatch(name, matchBio);
    setMatches((prev) => [...prev, match]);
    setActiveMatchId(match.id);
    setBio(matchBio);
    setConversationRows([]);
    setResult(null);
    setError(null);
    setShowBioModal(false);
    setTone(null);
    setShowNewMatchModal(false);
    if (generate) {
      runGenerate({ mode: "opener", profileText: matchBio, matchName: name });
      refreshFacts(match.id, matchBio, "");
    }
  }

  function handleSaveMatchName(newName: string) {
    if (!activeMatchId) return;
    updateMatch(activeMatchId, { name: newName });
    setMatches((prev) => prev.map((m) => (m.id === activeMatchId ? { ...m, name: newName } : m)));
    setShowEditModal(false);
    trackEvent("match_renamed");
  }

  function handleDeleteMatch(id: string = activeMatchId ?? "") {
    if (!id) return;
    deleteMatch(id);
    const remaining = matches.filter((m) => m.id !== id);
    setMatches(remaining);
    const next = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    setActiveMatchId(next ? next.id : null);
    setBio(next ? next.bio : "");
    setConversationRows(next ? parseConversationText(next.conversationText) : []);
    setResult(null);
    setError(null);
    setShowBioModal(false);
    setShowEditModal(false);
    setTone(next?.tone ?? null);
    trackEvent("match_deleted");
  }

  async function handleVote(
    suggestionText: string,
    suggestionTone: string,
    approach: string,
    vote: "up" | "down"
  ) {
    trackEvent("suggestion_voted", { vote, tone: suggestionTone, approach });
    recordTasteVote({ tone: suggestionTone, text: suggestionText, vote });
    setTasteVersion((v) => v + 1);
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

  function handleResetLimit() {
    resetUsage();
    setUsageToday(0);
    setShowPaywall(false);
    setResetHint(null);
    trackEvent("limit_reset");
  }

  // On Android the daily reset is an install reward: not installed →
  // tapping reset fires the install prompt instead of resetting.
  // Everywhere else (desktop, already installed) it just resets.
  async function handleResetClick() {
    if (isAndroid && !isInstalled) {
      const outcome = await promptInstall();
      if (outcome === "unavailable") {
        setResetHint("To reset on Android, install the app: Chrome ⋮ → “Add to Home screen”.");
      }
      return;
    }
    handleResetLimit();
  }

  function handleClearChat() {
    persistRows([], false);
    setResult(null);
    setError(null);
    trackEvent("chat_cleared");
  }

  function handleCopySuggestion(text: string) {
    if (!activeMatch) return;
    enqueueOutcome({
      generationId: result?.id,
      matchId: activeMatchId ?? undefined,
      matchName: activeMatch.name,
      suggestionText: text,
      rowsAtCopy: conversationRows.length,
    });
    trackEvent("suggestion_copied", { mode: effectiveMode });
    refreshDueOutcomes();
  }

  async function handleOutcomeAnswer(replied: boolean) {
    const outcome = dueOutcomes[0];
    if (!outcome) return;
    trackEvent("outcome_recorded", { replied });
    try {
      await fetch("/api/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationId: outcome.generationId,
          matchName: outcome.matchName,
          suggestionText: outcome.suggestionText,
          replied,
        }),
      });
    } catch {
      // Best-effort logging; the answer still counts locally.
    }
    resolveOutcome(outcome.id);
    refreshDueOutcomes();
  }

  function handleOutcomeSnooze() {
    const outcome = dueOutcomes[0];
    if (!outcome) return;
    snoozeOutcomeForVisit(outcome.id);
    refreshDueOutcomes();
  }

  function handleTrySample() {
    const existingDemo = matches.find((m) => m.demo);
    if (existingDemo) {
      handleSelectMatch(existingDemo);
      return;
    }
    const demo = addMatch(SAMPLE_MATCH_NAME, SAMPLE_MATCH_BIO, true);
    updateMatch(demo.id, { conversationText: SAMPLE_MATCH_CONVERSATION });
    const withConversation: Match = { ...demo, conversationText: SAMPLE_MATCH_CONVERSATION };
    setMatches((prev) => [...prev, withConversation]);
    setActiveMatchId(demo.id);
    setBio(SAMPLE_MATCH_BIO);
    setConversationRows(parseConversationText(SAMPLE_MATCH_CONVERSATION));
    setResult(null);
    setError(null);
    setShowBioModal(false);
    setTone(null);
    trackEvent("sample_match_created");
  }

  const remaining = Math.max(dailyLimit - usageToday, 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="relative mb-6 text-center">
        <button
          type="button"
          onClick={() => {
            setShowSideMenu(true);
            trackEvent("side_menu_opened");
          }}
          aria-label="Open menu"
          className="absolute left-0 top-0.5 flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
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

      {dueOutcomes.length > 0 && (
        <OutcomeNudge
          outcome={dueOutcomes[0]}
          onAnswer={handleOutcomeAnswer}
          onSnooze={handleOutcomeSnooze}
        />
      )}

      {activeMatch?.demo && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="text-xs text-brand-800">
            Sample conversation — try generating, then add your own match with + New.
          </p>
          <button
            type="button"
            onClick={() => handleDeleteMatch(activeMatch.id)}
            className="shrink-0 text-xs font-medium text-brand-600 hover:text-red-600"
          >
            Delete sample
          </button>
        </div>
      )}

      {!activeMatch ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Add your first match with "+ New" to get started — we'll ask for their name and bio
          and generate opening lines right away.
          <button
            type="button"
            onClick={handleTrySample}
            className="mx-auto mt-4 block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            ✨ Try a sample conversation
          </button>
        </div>
      ) : (
        <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setShowBioModal(true)}
              title="View and edit bio"
              className="flex items-center gap-1 text-sm font-medium text-gray-700"
            >
              {activeMatch.name}'s bio
            </button>
            <button
              type="button"
              onClick={() => setShowFactsModal(true)}
              className="flex items-center gap-1 text-sm font-medium text-gray-700"
            >
              📋 Summary
              {factsRefreshing && <span className="text-xs text-gray-400">⏳</span>}
            </button>
            <button
              type="button"
              onClick={() => setShowEditModal(true)}
              title="Rename or delete this match"
              aria-label="Rename or delete this match"
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              ✎
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Conversation
            </label>
            <ConversationComposer
              rows={conversationRows}
              onRowsChange={handleRowsChange}
              onClearChat={handleClearChat}
            />
            {conversationUpload.error && (
              <p className="mt-1 text-xs text-red-600">{conversationUpload.error}</p>
            )}
            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={handlePasteScreenshotClick}
                disabled={conversationUpload.uploading}
                title="Pastes the screenshot currently in your clipboard"
                className="rounded-full border border-brand-400 bg-white px-4 py-1.5 text-xs font-medium text-brand-600 hover:border-brand-600 hover:bg-brand-50 disabled:opacity-60"
              >
                📋 Paste Screenshot
              </button>
              <input
                ref={chatScreenshotInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) startConversationUpload(file, "upload");
                }}
              />
              <button
                type="button"
                onClick={handleUploadChatScreenshotClick}
                disabled={conversationUpload.uploading}
                title="Pastes the screenshot from your clipboard if there is one, otherwise lets you pick a file"
                className="rounded-full bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {conversationUpload.uploading ? "Reading screenshot…" : "📷 Upload Chat Screenshot"}
              </button>
            </div>
            {pasteScreenshotError && (
              <p className="mt-1 text-center text-xs text-red-600">{pasteScreenshotError}</p>
            )}
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

          <ToneSelector value={tone} onChange={handleToneChange} />
          <TasteHint refreshKey={tasteVersion} />

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

          <div className="sticky bottom-2 z-10 rounded-xl bg-white/85 p-1 shadow-lg backdrop-blur-sm md:static md:rounded-none md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none">
            <button
              type="button"
              onClick={handleGenerateClick}
              disabled={!canSubmit}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium leading-tight text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block">{loading ? "Thinking..." : "Generate reply suggestions"}</span>
              {remaining < dailyLimit && (
                <span className="mt-0.5 block text-xs font-normal opacity-80">
                  {remaining > 0
                    ? `${remaining} of ${dailyLimit} left today`
                    : "Free limit reached for today"}
                </span>
              )}
            </button>
          </div>

          {remaining === 0 && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              <button
                type="button"
                onClick={handleResetClick}
                title={
                  isAndroid && !isInstalled
                    ? "Install the app to unlock your daily reset"
                    : "Reset today's free limit"
                }
                className="rounded-full border border-gray-300 px-2 py-0.5 font-medium text-gray-500 hover:border-brand-400 hover:text-brand-600"
              >
                {isAndroid && !isInstalled ? "📲 Reset limit" : "Reset limit"}
              </button>
            </div>
          )}
          {resetHint && (
            <p className="mt-1 text-center text-xs text-gray-500">{resetHint}</p>
          )}
          {remaining === 0 && isAndroid && !isInstalled && !resetHint && (
            <p className="mt-1 text-center text-xs text-gray-400">
              📲 Install the app to unlock your daily reset
            </p>
          )}
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
                onCopied={(text) => handleCopySuggestion(text)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-gray-200">
        <button
          type="button"
          onClick={() => setShowPunDirectory((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700"
        >
          <span>📖 Name pun directory</span>
          <span className="text-xs text-gray-400">{showPunDirectory ? "▲ Hide" : "▼ Show"}</span>
        </button>
        {showPunDirectory && (
          <div className="border-t border-gray-200 p-3">
            <NamePunDirectory key={activeMatch?.id ?? "none"} />
          </div>
        )}
      </div>

      <footer className="mt-10 text-center text-xs text-gray-400">
        This is a validation prototype. Conversation text is sent to an AI provider to
        generate suggestions and is not stored beyond what's needed to do that. You always
        choose what to send — nothing is sent on your behalf.
        <span className="mt-1 block">{APP_VERSION}</span>
      </footer>

      <PaywallModal open={showPaywall} onClose={() => setShowPaywall(false)} />
      <SideMenu
        open={showSideMenu}
        onClose={() => setShowSideMenu(false)}
        onSelect={(item) => {
          setShowSideMenu(false);
          setOpenDeck(item);
          trackEvent("fun_deck_opened", { deck: item });
        }}
      />
      <DoubleMeaningSheet open={openDeck === "doubleMeaning"} onClose={() => setOpenDeck(null)} />
      <DarkFantasySheet
        open={openDeck === "darkFantasy"}
        onClose={() => setOpenDeck(null)}
        blockedReason={minorBlockReason(activeMatch?.facts)}
        language={language}
      />
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
      {activeMatch && (
        <EditMatchModal
          open={showEditModal}
          initialName={activeMatch.name}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveMatchName}
          onDelete={handleDeleteMatch}
        />
      )}
      {activeMatch && (
        <BioModal
          open={showBioModal}
          matchName={activeMatch.name}
          initialBio={bio}
          onClose={() => setShowBioModal(false)}
          onSave={handleSaveBio}
        />
      )}
    </div>
  );
}
