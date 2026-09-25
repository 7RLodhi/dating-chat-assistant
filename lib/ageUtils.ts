import { MatchFacts } from "./types";

/**
 * Prefers computing age from a full DOB (exact, updates correctly across
 * birthdays); falls back to a directly-stated age if DOB isn't known.
 * Returns null if neither is available or parseable.
 */
export function getDisplayAge(facts?: MatchFacts | null): number | null {
  if (!facts) return null;

  if (facts.dob) {
    const dob = new Date(facts.dob);
    if (!isNaN(dob.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const hasHadBirthdayThisYear =
        today.getMonth() > dob.getMonth() ||
        (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
      if (!hasHadBirthdayThisYear) age -= 1;
      if (age >= 0 && age < 130) return age;
    }
  }

  if (facts.age) {
    const parsed = parseInt(facts.age, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 130) return parsed;
  }

  return null;
}

/**
 * Returns a human-readable reason if the match appears to be under 18
 * (known age < 18, or currently in school), else null. Used to withhold
 * adult content for that match.
 */
export function minorBlockReason(facts?: MatchFacts | null): string | null {
  const age = getDisplayAge(facts);
  if (age !== null && age < 18) {
    return `Their summary shows they're ${age}. Adult content is only for matches who are 18+.`;
  }
  if (facts?.occupationType === "student" && facts.educationLevel === "school") {
    return "Their summary shows they're still in school. Adult content is only for matches who are 18+.";
  }
  return null;
}

export function formatDob(dob: string): string {
  if (!dob) return "";
  const parsed = new Date(dob);
  if (isNaN(parsed.getTime())) return dob;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** One-line summary of student/professional status, or "" if nothing is known. */
export function formatOccupation(facts?: MatchFacts | null): string {
  if (!facts) return "";

  if (facts.occupationType === "student") {
    if (facts.educationLevel === "school") {
      const stream = facts.schoolStream ? `, ${facts.schoolStream} stream` : "";
      return facts.schoolClass ? `Student — ${facts.schoolClass} grade${stream}` : "Student";
    }
    if (facts.educationLevel === "college") {
      const parts = [facts.collegeYear, facts.degree].filter(Boolean).join(" ");
      const branch = facts.branch ? ` in ${facts.branch}` : "";
      return parts ? `Student — ${parts}${branch}` : "Student";
    }
    return "Student";
  }

  if (facts.occupationType === "professional") {
    const roleAtCompany = [facts.jobRole, facts.company && `at ${facts.company}`]
      .filter(Boolean)
      .join(" ");
    const location = facts.jobLocation ? ` (${facts.jobLocation})` : "";
    return roleAtCompany ? `${roleAtCompany}${location}` : "Working professional";
  }

  return "";
}
