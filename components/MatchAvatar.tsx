"use client";

const PALETTE = [
  "bg-pink-500",
  "bg-purple-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function colorFor(name: string): string {
  const sum = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return PALETTE[sum % PALETTE.length];
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[1]?.[0] ?? "" : "";
  return (first + second).toUpperCase();
}

export default function MatchAvatar({
  name,
  age,
  active,
  onClick,
}: {
  name: string;
  age?: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-16 flex-shrink-0 flex-col items-center gap-1"
    >
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold text-white ${colorFor(
          name
        )} ${active ? "ring-2 ring-gray-900 ring-offset-2" : ""}`}
      >
        {initialsFor(name)}
      </span>
      <span className="w-full truncate text-center text-xs text-gray-600">
        {name}
        {age ? `, ${age}` : ""}
      </span>
    </button>
  );
}
