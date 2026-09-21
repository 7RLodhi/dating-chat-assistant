"use client";

import { useRef } from "react";
import { readClipboardContent } from "@/lib/useScreenshotUpload";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * A small camera icon that replaces the old bulky "Upload or paste
 * screenshot" button. Clicking it tries the clipboard first (image, then
 * plain text if `onTextSelected` is provided) and only falls back to a
 * file picker if the clipboard has nothing usable — so both click-to-paste
 * and click-to-browse work from the same control.
 */
export default function ScreenshotIconButton({
  uploading,
  onFileSelected,
  onTextSelected,
  title = "Paste or upload a screenshot",
  className = "",
}: {
  uploading: boolean;
  onFileSelected: (file: File) => void;
  onTextSelected?: (text: string) => void;
  title?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleClick() {
    const clipboardContent = await readClipboardContent();
    if (clipboardContent?.type === "image") {
      onFileSelected(clipboardContent.file);
      return;
    }
    if (clipboardContent?.type === "text" && onTextSelected) {
      onTextSelected(clipboardContent.text);
      return;
    }
    inputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onFileSelected(file);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={uploading}
        title={title}
        aria-label={title}
        className={`flex items-center justify-center rounded-full bg-white/90 text-gray-400 shadow-sm hover:bg-gray-100 hover:text-brand-600 disabled:opacity-50 ${className}`}
      >
        {uploading ? (
          <span className="text-xs">⏳</span>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8a2 2 0 0 1 2-2h1.2a1 1 0 0 0 .86-.5l.7-1.2A1 1 0 0 1 9.6 3.8h4.8a1 1 0 0 1 .86.5l.7 1.2a1 1 0 0 0 .86.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
            />
            <circle cx="12" cy="13" r="3.2" />
          </svg>
        )}
      </button>
    </>
  );
}
