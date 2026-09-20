"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

type Source = "upload" | "paste";

/**
 * Shared logic behind both the "Upload screenshot" button and pasting an
 * image directly (Ctrl+V). Keeping this in one hook means the button shows
 * "Reading screenshot..." regardless of which path triggered it.
 */
export function useScreenshotUpload(
  onTranscribed: (text: string) => void,
  kind: "conversation" | "profile" = "conversation"
) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function processFile(file: File, source: Source = "upload") {
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use a PNG, JPEG, or WebP screenshot.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Image too large (max 5MB). Try cropping the screenshot.");
      return;
    }

    setUploading(true);
    trackEvent("screenshot_uploaded", { sizeBytes: file.size, type: file.type, kind, source });

    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type, kind }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Couldn't read that screenshot.");
      }
      onTranscribed(data.text as string);
      trackEvent("screenshot_transcribed", { chars: (data.text as string).length, source });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setUploading(false);
    }
  }

  return { uploading, error, processFile };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:image/png;base64," prefix
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Pulls the first pasted image out of a clipboard event, if any. */
export function extractImageFromClipboard(
  clipboardData: DataTransfer | null | undefined
): File | null {
  if (!clipboardData) return null;
  for (let i = 0; i < clipboardData.items.length; i++) {
    const item = clipboardData.items[i];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}
