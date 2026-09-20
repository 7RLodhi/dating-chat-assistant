"use client";

import { GOAL_OPTIONS } from "@/lib/prompts";
import { Goal } from "@/lib/types";

export default function GoalSelector({
  value,
  onChange,
}: {
  value: Goal;
  onChange: (goal: Goal) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        Goal
      </label>
      <div className="flex flex-wrap gap-2">
        {GOAL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              value === opt.value
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 bg-white text-gray-700 hover:border-gray-500"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
