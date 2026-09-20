import { ConversationRead } from "@/lib/types";

const MOOD_STYLES: Record<string, string> = {
  high_interest: "bg-green-100 text-green-800 border-green-300",
  playful: "bg-pink-100 text-pink-800 border-pink-300",
  neutral: "bg-gray-100 text-gray-800 border-gray-300",
  cooling_off: "bg-amber-100 text-amber-800 border-amber-300",
  disengaged: "bg-red-100 text-red-800 border-red-300",
  mixed_signals: "bg-purple-100 text-purple-800 border-purple-300",
};

const MOOD_LABELS: Record<string, string> = {
  high_interest: "High interest",
  playful: "Playful",
  neutral: "Neutral",
  cooling_off: "Cooling off",
  disengaged: "Disengaged",
  mixed_signals: "Mixed signals",
};

export default function MoodBadge({ read }: { read: ConversationRead }) {
  const style = MOOD_STYLES[read.mood_label] || MOOD_STYLES.neutral;
  const label = MOOD_LABELS[read.mood_label] || read.mood_label;

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${style}`}>
      <span className="font-semibold">Read: {label}</span>
      {typeof read.confidence === "number" && (
        <span className="ml-1 opacity-70">
          ({Math.round(read.confidence * 100)}% confidence)
        </span>
      )}
      <p className="mt-0.5 font-normal opacity-90">{read.summary}</p>
    </div>
  );
}
