"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { NamePun, PunVote } from "@/lib/types";

const VOTED_KEY = "dca_pun_votes_v0";
const REQUESTED_KEY = "dca_pun_requests_v0";

function getVotedMap(): Record<string, PunVote> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VOTED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PunVote>) : {};
  } catch {
    return {};
  }
}

function saveVote(id: string, vote: PunVote) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOTED_KEY, JSON.stringify({ ...getVotedMap(), [id]: vote }));
}

function punScore(p: NamePun): number {
  return p.worked - p.notWorked;
}

export default function NamePunDirectory({ defaultQuery = "" }: { defaultQuery?: string }) {
  const [query, setQuery] = useState(defaultQuery);
  const [puns, setPuns] = useState<NamePun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voted, setVoted] = useState<Record<string, PunVote>>({});
  const [newName, setNewName] = useState("");
  const [newPun, setNewPun] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestedNames, setRequestedNames] = useState<string[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const punInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVoted(getVotedMap());
    try {
      const raw = window.localStorage.getItem(REQUESTED_KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      if (Array.isArray(parsed)) setRequestedNames(parsed);
    } catch {
      // ignore corrupt storage
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = query.trim() ? `?search=${encodeURIComponent(query.trim())}` : "";
        const res = await fetch(`/api/puns${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Couldn't load puns.");
        setPuns(data.puns as NamePun[]);
        if (query.trim()) trackEvent("pun_searched", { query: query.trim() });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Group puns by name (case-insensitive); puns within a group sorted by
  // vote score, groups sorted alphabetically.
  const groups = useMemo(() => {
    const map = new Map<string, { displayName: string; puns: NamePun[] }>();
    for (const p of puns) {
      const key = p.name.trim().toLowerCase();
      const group = map.get(key) ?? { displayName: p.name.trim(), puns: [] };
      group.puns.push(p);
      map.set(key, group);
    }
    for (const group of map.values()) {
      group.puns.sort((a, b) => punScore(b) - punScore(a) || b.worked - a.worked);
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [puns]);

  async function handleVote(id: string, vote: PunVote) {
    if (voted[id]) return; // one vote per pun per browser, keeps signal clean
    // Optimistic update so the tap feels instant; rolled back on failure.
    const prev = puns;
    setPuns((list) =>
      list.map((p) =>
        p.id === id
          ? { ...p, worked: p.worked + (vote === "worked" ? 1 : 0), notWorked: p.notWorked + (vote === "notWorked" ? 1 : 0) }
          : p
      )
    );
    setVoted((map) => ({ ...map, [id]: vote }));
    try {
      const res = await fetch("/api/puns/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, vote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't record your vote.");
      setPuns((list) => list.map((p) => (p.id === id ? (data.pun as NamePun) : p)));
      saveVote(id, vote);
      trackEvent("pun_voted", { vote });
    } catch (err) {
      setPuns(prev);
      setVoted((map) => {
        const next = { ...map };
        delete next[id];
        return next;
      });
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  function handleAddForName(name: string) {
    setNewName(name);
    setFormError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // Focus after scroll starts so the keyboard opens on the pun field.
    setTimeout(() => punInputRef.current?.focus(), 350);
  }

  async function handleRequestPun() {
    const name = query.trim();
    if (!name || requesting) return;
    const key = name.toLowerCase();
    if (requestedNames.includes(key)) return;
    setRequesting(true);
    setRequestError(null);
    try {
      const res = await fetch("/api/puns/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't record your request.");
      const next = [...requestedNames, key];
      setRequestedNames(next);
      window.localStorage.setItem(REQUESTED_KEY, JSON.stringify(next));
      trackEvent("pun_requested", { name });
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRequesting(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newPun.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/puns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), pun: newPun.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't add your pun.");
      const entry = data.pun as NamePun;
      setPuns((prev) => [entry, ...prev]);
      setNewName("");
      setNewPun("");
      trackEvent("pun_added", { name: entry.name });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a name… e.g. Priya"
        className="w-full rounded-lg border border-gray-300 p-2.5 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
      />

      {loading && <p className="text-xs text-gray-400">Loading puns…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {!loading && !error && groups.length === 0 && query.trim() && (
        <div className="space-y-2 text-center">
          <p className="text-xs text-gray-400">No puns for that name yet —</p>
          {requestedNames.includes(query.trim().toLowerCase()) ? (
            <p className="text-xs font-medium text-green-600">
              Requested ✓ — we&apos;ll add one soon.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleRequestPun}
              disabled={requesting}
              className="rounded-full bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {requesting ? "Requesting…" : `Request Pun for "${query.trim()}"`}
            </button>
          )}
          {requestError && <p className="text-xs text-red-600">{requestError}</p>}
        </div>
      )}

      {!loading && !error && groups.length === 0 && !query.trim() && (
        <p className="text-xs text-gray-400">
          No puns here yet — search a name above, or add the first one below! 👇
        </p>
      )}

      <div className="space-y-2">
        {groups.map((group) => (
          <div
            key={group.displayName.toLowerCase()}
            className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">{group.displayName}</p>
              <button
                type="button"
                onClick={() => handleAddForName(group.displayName)}
                className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                + Add Pun
              </button>
            </div>
            <div className="mt-1.5 space-y-1.5">
              {group.puns.map((p) => (
                <div key={p.id} className="flex items-start gap-2">
                  <p className="flex-1 text-sm leading-relaxed text-gray-700">{p.pun}</p>
                  <div className="flex shrink-0 items-center gap-1 pt-0.5">
                    <button
                      type="button"
                      aria-label="This worked for me"
                      title="This worked for me"
                      onClick={() => handleVote(p.id, "worked")}
                      disabled={!!voted[p.id]}
                      className={`rounded-md px-1 py-0.5 text-base leading-none transition ${
                        voted[p.id] === "worked"
                          ? "opacity-100"
                          : "opacity-40 hover:opacity-80"
                      } disabled:cursor-default`}
                    >
                      👍
                    </button>
                    <span className="min-w-4 text-center text-xs text-gray-500">{p.worked}</span>
                    <button
                      type="button"
                      aria-label="This didn't work for me"
                      title="This didn't work for me"
                      onClick={() => handleVote(p.id, "notWorked")}
                      disabled={!!voted[p.id]}
                      className={`rounded-md px-1 py-0.5 text-base leading-none transition ${
                        voted[p.id] === "notWorked"
                          ? "opacity-100"
                          : "opacity-40 hover:opacity-80"
                      } disabled:cursor-default`}
                    >
                      👎
                    </button>
                    <span className="min-w-4 text-center text-xs text-gray-500">{p.notWorked}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <form
        ref={formRef}
        onSubmit={handleAdd}
        className="space-y-2 rounded-xl border border-dashed border-gray-300 p-3"
      >
        <p className="text-sm font-medium text-gray-700">Know a good one? Add it 👇</p>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name — e.g. Arjun"
          maxLength={40}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
        />
        <input
          ref={punInputRef}
          type="text"
          value={newPun}
          onChange={(e) => setNewPun(e.target.value)}
          placeholder="Pun opener — e.g. No charioteer needed, Arjun…"
          maxLength={200}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
        />
        {formError && <p className="text-xs text-red-600">{formError}</p>}
        <button
          type="submit"
          disabled={!newName.trim() || !newPun.trim() || submitting}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add pun"}
        </button>
      </form>
    </div>
  );
}
