"use client";

import { TONE_OPTIONS } from "@/lib/prompts";
import { Tone } from "@/lib/types";

export default function ToneSelector({
  value,
  onChange,
}: {
  value: Tone | null;
  onChange: (tone: Tone) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        Tone
      </label>
      <div className="flex flex-wrap gap-2">
        {TONE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              value === opt.value
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-gray-300 bg-white text-gray-700 hover:border-brand-400"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
