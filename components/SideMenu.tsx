"use client";

import { useState } from "react";
import { usePwaInstall } from "@/lib/pwa";

export type SideMenuItem = "doubleMeaning" | "darkFantasy";

export default function SideMenu({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: SideMenuItem) => void;
}) {
  const { isAndroid, isInstalled, promptInstall } = usePwaInstall();
  const [installing, setInstalling] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);

  if (!open) return null;

  async function handleInstall() {
    if (isInstalled || installing) return;
    setInstalling(true);
    try {
      const outcome = await promptInstall();
      // No native prompt available (already handled inside promptInstall):
      // fall back to manual instructions instead of doing nothing.
      setShowManualHint(outcome === "unavailable");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <nav
        className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="Side menu"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Chat Assist</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-2">
          <li>
            <button
              type="button"
              onClick={() => onSelect("doubleMeaning")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              <span className="text-lg">😜</span>
              Double Meaning Questions
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => onSelect("darkFantasy")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              <span className="text-lg">🔥</span>
              Dark Fantasy
              <span className="ml-auto rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                18+
              </span>
            </button>
          </li>
          <li>
            {isInstalled ? (
              <div className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-green-700">
                <span className="text-lg">✓</span>
                Lite App Installed
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleInstall}
                  disabled={installing}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-60"
                >
                  <span className="text-lg">📲</span>
                  {installing ? "Installing…" : "Install Lite App"}
                </button>
                {showManualHint && (
                  <p className="px-3 pt-1 text-[11px] text-gray-500">
                    {isAndroid
                      ? "Tap Chrome's ⋮ menu → “Add to Home screen” to install."
                      : "Open this page in Chrome on your Android phone, then use ⋮ → “Add to Home screen”."}
                  </p>
                )}
              </>
            )}
          </li>
        </ul>
      </nav>
    </div>
  );
}
