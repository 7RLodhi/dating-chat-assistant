"use client";

import { useEffect, useState } from "react";
import ScreenshotIconButton from "./ScreenshotIconButton";
import { useScreenshotUpload } from "@/lib/useScreenshotUpload";

export default function BioModal({
  open,
  matchName,
  initialBio,
  onClose,
  onSave,
}: {
  open: boolean;
  matchName: string;
  initialBio: string;
  onClose: () => void;
  onSave: (bio: string, viaScreenshot: boolean) => void;
}) {
  const [draft, setDraft] = useState(initialBio);
  const [fromScreenshot, setFromScreenshot] = useState(false);

  const bioUpload = useScreenshotUpload((text) => {
    setDraft(text);
    setFromScreenshot(true);
  }, "profile");

  // Reset the draft each time it opens. Closing (X, Cancel, or outside
  // click) discards edits — only Update persists.
  useEffect(() => {
    if (open) {
      setDraft(initialBio);
      setFromScreenshot(false);
    }
  }, [open, initialBio]);

  if (!open) return null;

  const unchanged = draft === initialBio;

  function handleSave() {
    onSave(draft.trim(), fromScreenshot);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close without saving"
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
        <h3 className="text-lg font-semibold text-gray-900">{matchName}&apos;s bio</h3>
        <div className="relative mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            autoFocus
            placeholder="Paste their bio, prompts/answers, or describe their photos"
            className="w-full rounded-lg border border-gray-300 p-3 pr-9 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
          />
          <ScreenshotIconButton
            uploading={bioUpload.uploading}
            onFileSelected={(file) => bioUpload.processFile(file, "upload")}
            className="absolute bottom-2 right-2 h-7 w-7"
          />
        </div>
        {bioUpload.error && <p className="mt-1 text-xs text-red-600">{bioUpload.error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={unchanged}
            className="flex-1 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
