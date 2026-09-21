"use client";

import { useEffect, useState } from "react";
import ScreenshotIconButton from "./ScreenshotIconButton";
import { extractImageFromClipboard, useScreenshotUpload } from "@/lib/useScreenshotUpload";

export default function NewMatchModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, bio: string) => void;
}) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");

  const bioUpload = useScreenshotUpload((text) => setBio(text), "profile");

  // Paste (Ctrl+V) a screenshot anywhere while this modal is open. Scoped to
  // `open` so it doesn't compete with the main page's own paste listener.
  useEffect(() => {
    if (!open) return;
    function handlePaste(e: ClipboardEvent) {
      const file = extractImageFromClipboard(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      bioUpload.processFile(file, "paste");
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), bio.trim());
    setName("");
    setBio("");
  }

  function handleClose() {
    setName("");
    setBio("");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
        <h3 className="text-lg font-semibold text-gray-900">New match</h3>
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya"
              autoFocus
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Their profile bio
            </label>
            <div className="relative">
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                placeholder="Paste their bio, prompts/answers, or click the camera icon below"
                className="w-full rounded-lg border border-gray-300 p-2.5 pr-9 text-sm placeholder:italic placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
              />
              <ScreenshotIconButton
                uploading={bioUpload.uploading}
                onFileSelected={(file) => bioUpload.processFile(file, "upload")}
                className="absolute bottom-2 right-2 h-7 w-7"
              />
            </div>
            {bioUpload.error && <p className="mt-1 text-xs text-red-600">{bioUpload.error}</p>}
          </div>
          <p className="text-xs text-gray-400">
            We'll generate opening lines right away — including a pun on their name if a natural
            one exists.
          </p>
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Create & Generate opening lines
          </button>
        </form>
      </div>
    </div>
  );
}
