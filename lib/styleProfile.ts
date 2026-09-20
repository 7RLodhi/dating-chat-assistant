import { StyleAnalysis } from "./types";

// Style data lives in localStorage, same tier as rateLimit.ts — no accounts
// in v0, so it's per-browser. The raw examples are what actually get sent
// to the LLM on every generation (see AssistantApp); the cached analysis is
// purely a "here's what we noticed" display, regenerated on demand.

const EXAMPLES_KEY = "dca_style_examples_v0";
const ANALYSIS_KEY = "dca_style_analysis_v0";

export function getStyleExamples(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(EXAMPLES_KEY) || "";
}

export function saveStyleExamples(examples: string): void {
  if (typeof window === "undefined") return;
  if (examples.trim()) {
    window.localStorage.setItem(EXAMPLES_KEY, examples);
  } else {
    window.localStorage.removeItem(EXAMPLES_KEY);
  }
}

export function getCachedStyleAnalysis(): StyleAnalysis | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ANALYSIS_KEY);
    return raw ? (JSON.parse(raw) as StyleAnalysis) : null;
  } catch {
    return null;
  }
}

export function saveStyleAnalysis(analysis: StyleAnalysis): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ANALYSIS_KEY, JSON.stringify(analysis));
}

export function clearStyle(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(EXAMPLES_KEY);
  window.localStorage.removeItem(ANALYSIS_KEY);
}
