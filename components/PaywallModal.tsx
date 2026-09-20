"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";

export default function PaywallModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    trackEvent("paywall_clicked", { email_provided: true });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed to join waitlist.");
      trackEvent("waitlist_joined");
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        {submitted ? (
          <>
            <h3 className="text-lg font-semibold text-gray-900">You're on the list 🎉</h3>
            <p className="mt-2 text-sm text-gray-600">
              We'll email you when unlimited suggestions are ready. Thanks for
              trying this out.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-gray-900">
              You've hit today's free limit
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Get unlimited suggestions and every tone for{" "}
              <span className="font-medium text-gray-900">$6.99/mo</span> —
              coming soon. Leave your email for early access.
            </p>
            <form onSubmit={handleSubmit} className="mt-4 space-y-2">
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {submitting ? "Joining..." : "Get early access"}
              </button>
            </form>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 w-full text-center text-xs text-gray-400 hover:text-gray-600"
            >
              Maybe tomorrow
            </button>
          </>
        )}
      </div>
    </div>
  );
}
