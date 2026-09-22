"use client";

import { useEffect, useState } from "react";
import { summarizeTaste } from "@/lib/tasteProfile";

// One-liner proving votes matter: appears once enough 👍/👎 have
// crystallized into a taste profile. Re-read on every vote via refreshKey.
export default function TasteHint({ refreshKey }: { refreshKey: number }) {
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    setHighlight(summarizeTaste()?.highlight ?? null);
  }, [refreshKey]);

  if (!highlight) return null;

  return <p className="text-xs text-brand-700">✨ {highlight}</p>;
}
