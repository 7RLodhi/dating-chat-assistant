"use client";

import { UserGender } from "@/lib/types";

const OPTIONS: { value: UserGender; label: string }[] = [
  { value: "unspecified", label: "Skip for now" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

export default function GenderSelector({
  value,
  onChange,
}: {
  value: UserGender;
  onChange: (gender: UserGender) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        I am…
      </label>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => (
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
      {value !== "unspecified" && (
        <p className="mt-1 text-xs text-gray-400">
          Replies will use {value === "male" ? "masculine" : "feminine"} verb forms
          for your own lines, no matter how your match writes.
        </p>
      )}
    </div>
  );
}
