"use client";

import { useEffect, useState } from "react";
import type { StatsResponse } from "@/lib/stats";

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export default function DashboardSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch("/api/stats")
      .then(async (r) => {
        if (!r.ok) throw new Error("Stats request failed.");
        setStats((await r.json()) as StatsResponse);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load stats."))
      .finally(() => setLoading(false));
  }, [open ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Match insights"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">📊 Match insights</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close insights"
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-gray-500">Crunching your numbers…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && !error && stats && (
          <>
            {stats.totals.generations === 0 && stats.totals.outcomesAsked === 0 ? (
              <p className="text-sm text-gray-500">
                No data yet — generate suggestions, vote 👍/👎, and report “did they
                reply?” to fill this in.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-2xl font-bold text-gray-900">{stats.totals.generations}</div>
                    <div className="text-xs text-gray-500">generations</div>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-2xl font-bold text-gray-900">
                      {pct(stats.totals.replyRate)}
                    </div>
                    <div className="text-xs text-gray-500">
                      reply rate ({stats.totals.outcomesReplied}/{stats.totals.outcomesAsked} reported)
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-2xl font-bold text-gray-900">
                      {stats.totals.votesUp}👍 / {stats.totals.votesDown}👎
                    </div>
                    <div className="text-xs text-gray-500">suggestion votes</div>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-2xl font-bold text-gray-900">{stats.perMatch.length}</div>
                    <div className="text-xs text-gray-500">matches tracked</div>
                  </div>
                </div>

                {stats.moodTrajectory.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">
                      Interest over time
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {stats.moodTrajectory.map((p, i) => (
                        <span
                          key={`${p.at}-${i}`}
                          title={`${p.mood} · ${p.at}`}
                          className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-800"
                        >
                          {p.mood.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {stats.perMatch.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">Per match</h3>
                    <div className="space-y-2">
                      {stats.perMatch.map((m) => (
                        <div key={m.name} className="rounded-xl border border-gray-200 p-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-gray-900">
                              {m.name}
                            </span>
                            <span className="shrink-0 text-xs text-gray-500">
                              {m.replied}/{m.asked} replies · {m.tried} lines tried
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-green-500"
                              style={{ width: `${Math.round(m.rate * 100)}%` }}
                            />
                          </div>
                          {m.moods.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {m.moods.map((p, i) => (
                                <span
                                  key={`${p.at}-${i}`}
                                  title={p.at}
                                  className="rounded-full bg-gray-100 px-1.5 py-px text-[10px] text-gray-600"
                                >
                                  {p.mood.replace(/_/g, " ")}
                                </span>
                              ))}
                            </div>
                          )}
                          {m.replyTones.length > 0 && (
                            <p className="mt-1 text-[11px] text-gray-500">
                              Replies came from:{" "}
                              {m.replyTones.map((t) => `${t.tone} (×${t.count})`).join(", ")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stats.tones.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">
                      What works (by tone)
                    </h3>
                    <div className="space-y-1.5">
                      {stats.tones.map((t) => (
                        <div
                          key={t.tone}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="font-medium capitalize text-gray-800">{t.tone}</span>
                          <span className="text-xs text-gray-500">
                            {t.up}👍 {t.down}👎
                            {t.asked > 0 && ` · ${t.replied}/${t.asked} replies (${pct(t.replied / t.asked)})`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stats.approaches.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">
                      What works (by approach)
                    </h3>
                    <div className="space-y-1.5">
                      {stats.approaches.map((a) => (
                        <div
                          key={a.approach}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="truncate font-medium text-gray-800">{a.approach}</span>
                          <span className="shrink-0 text-xs text-gray-500">
                            {a.up}👍 {a.down}👎
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
