// Minimal analytics stub. If NEXT_PUBLIC_POSTHOG_KEY is set, events are sent
// to PostHog's HTTP capture endpoint directly (no SDK dependency needed for
// v0). Otherwise events just log to the console so the funnel is still
// visible during local testing.

type EventName =
  | "generate_requested"
  | "generate_succeeded"
  | "generate_failed"
  | "suggestion_copied"
  | "suggestion_voted"
  | "paywall_shown"
  | "paywall_clicked"
  | "waitlist_joined"
  | "screenshot_uploaded"
  | "screenshot_transcribed"
  | "style_saved"
  | "style_cleared"
  | "style_analyzed"
  | "clipboard_pasted"
  | "limit_reset"
  | "chat_cleared"
  | "speaker_swapped"
  | "match_renamed"
  | "match_deleted"
  | "pun_searched"
  | "pun_added"
  | "pun_voted"
  | "outcome_prompt_shown"
  | "outcome_recorded"
  | "sample_match_created";

export function trackEvent(name: EventName, props: Record<string, unknown> = {}) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com";

  if (!key) {
    // eslint-disable-next-line no-console
    console.log(`[analytics] ${name}`, props);
    return;
  }

  const distinctId = getOrCreateDistinctId();

  fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event: name,
      distinct_id: distinctId,
      properties: props,
    }),
    keepalive: true,
  }).catch(() => {
    // Analytics failures should never break the product experience.
  });
}

function getOrCreateDistinctId(): string {
  if (typeof window === "undefined") return "server";
  const storageKey = "dca_distinct_id";
  let id = window.localStorage.getItem(storageKey);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(storageKey, id);
  }
  return id;
}
