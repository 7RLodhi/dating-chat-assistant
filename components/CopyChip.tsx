"use client";

import { useState } from "react";

export default function CopyChip({
  text,
  label = "Copy",
  onCopied,
}: {
  text: string;
  label?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onCopied?.();
    } catch {
      // Clipboard can be blocked (permissions/insecure context); fail quietly.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
