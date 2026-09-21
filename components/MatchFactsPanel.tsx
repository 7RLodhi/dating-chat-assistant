import { formatDob, formatOccupation, getDisplayAge } from "@/lib/ageUtils";
import { MatchFacts } from "@/lib/types";

function FactRow({ label, value }: { label: string; value: string | string[] }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return (
      <div>
        <span className="text-xs font-medium text-gray-500">{label}: </span>
        <span className="text-xs text-gray-700">{value.join(", ")}</span>
      </div>
    );
  }
  if (!value.trim()) return null;
  return (
    <div>
      <span className="text-xs font-medium text-gray-500">{label}: </span>
      <span className="text-xs text-gray-700">{value}</span>
    </div>
  );
}

export default function MatchFactsPanel({
  facts,
  refreshing,
}: {
  facts: MatchFacts | null;
  refreshing: boolean;
}) {
  const age = getDisplayAge(facts);
  const occupation = formatOccupation(facts);

  const hasAnything = Boolean(
    facts &&
      (facts.summary ||
        facts.dob ||
        facts.age ||
        facts.location ||
        occupation ||
        facts.hobbies.length ||
        facts.taste.length ||
        facts.surprises ||
        facts.dreams.length ||
        facts.wishlist.length ||
        facts.fantasies.length ||
        facts.other.length)
  );

  return (
    <div className="space-y-2 rounded-lg bg-gray-50 p-3">
      {refreshing && <p className="text-xs text-gray-400">Updating summary…</p>}
      {!hasAnything && !refreshing && (
        <p className="text-xs text-gray-400">
          Nothing learned yet — as you paste more bio/conversation details and generate
          suggestions, we'll build this out automatically.
        </p>
      )}
      {facts?.summary && <p className="text-sm text-gray-800">{facts.summary}</p>}
      <div className="space-y-1">
        <FactRow label="Age" value={age ? String(age) : ""} />
        <FactRow label="Birthdate" value={facts?.dob ? formatDob(facts.dob) : ""} />
        <FactRow label="Location" value={facts?.location ?? ""} />
        <FactRow label="Occupation" value={occupation} />
        <FactRow label="Hobbies" value={facts?.hobbies ?? []} />
        <FactRow label="Taste" value={facts?.taste ?? []} />
        <FactRow label="Surprises" value={facts?.surprises ?? ""} />
        <FactRow label="Dreams" value={facts?.dreams ?? []} />
        <FactRow label="Wishlist" value={facts?.wishlist ?? []} />
        <FactRow label="Fantasies" value={facts?.fantasies ?? []} />
        <FactRow label="Other" value={facts?.other ?? []} />
      </div>
      {facts?.updatedAt && (
        <p className="text-[10px] text-gray-400">
          Last updated {new Date(facts.updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
