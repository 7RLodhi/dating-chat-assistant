"use client";

import { LANGUAGE_OPTIONS } from "@/lib/prompts";
import { Language } from "@/lib/types";

export default function LanguageSelector({
  value,
  onChange,
}: {
  value: Language;
  onChange: (language: Language) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        Language
      </label>
      <div className="flex flex-wrap gap-2">
        {LANGUAGE_OPTIONS.map((opt) => (
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
      {value === "auto" && (
        <p className="mt-1 text-xs text-gray-400">
          We'll match whatever language the conversation is already in (English, Hindi, or
          Hinglish) — override above if you want to force one.
        </p>
      )}
    </div>
  );
}
