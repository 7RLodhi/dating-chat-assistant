"use client";

import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { NamePun, PunVote } from "@/lib/types";

const VOTED_KEY = "dca_pun_votes_v0";

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setVoted(getVotedMap());
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

  async function handleVote(id: string, vote: PunVote) {
    if (voted[id]) return; // one vote per pun per browser, keeps signal clean
    try {
      const res = await fetch("/api/puns/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, vote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't record your vote.");
      setPuns((prev) => prev.map((p) => (p.id === id ? (data.pun as NamePun) : p)));
      const next = { ...voted, [id]: vote };
      setVoted(next);
      saveVote(id, vote);
      trackEvent("pun_voted", { vote });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
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

      {!loading && !error && puns.length === 0 && (
        <p className="text-xs text-gray-400">
          No puns for that name yet — add the first one below! 👇
        </p>
      )}

      <div className="space-y-2">
        {puns.map((p) => (
          <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-gray-900">{p.name}</p>
            <p className="mt-0.5 text-sm text-gray-700">{p.pun}</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleVote(p.id, "worked")}
                disabled={!!voted[p.id]}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  voted[p.id] === "worked"
                    ? "bg-green-600 text-white"
                    : "bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                }`}
              >
                ✓ Worked ({p.worked})
              </button>
              <button
                type="button"
                onClick={() => handleVote(p.id, "notWorked")}
                disabled={!!voted[p.id]}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  voted[p.id] === "notWorked"
                    ? "border-gray-500 bg-gray-200 text-gray-700"
                    : "border-gray-300 text-gray-500 hover:border-red-400 hover:text-red-600 disabled:opacity-60"
                }`}
              >
                ✗ Didn&apos;t work for me ({p.notWorked})
              </button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleAdd} className="space-y-2 rounded-xl border border-dashed border-gray-300 p-3">
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
