"use client";

import { useRef } from "react";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export default function ScreenshotUpload({
  uploading,
  error,
  onFileSelected,
}: {
  uploading: boolean;
  error: string | null;
  onFileSelected: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClick() {
    inputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (file) onFileSelected(file);
  }

  return (
    <div>
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
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-400 disabled:opacity-60"
      >
        {uploading ? "Reading screenshot..." : "📷 Upload or paste screenshot"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
