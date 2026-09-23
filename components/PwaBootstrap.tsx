"use client";

import { useEffect } from "react";
import "./../lib/pwa"; // registers beforeinstallprompt/appinstalled listeners

// Mounted once in the root layout: ensures install-event listeners attach on
// every page load, and registers the service worker in production only
// (registering in dev causes stale-bundle confusion while iterating).
export default function PwaBootstrap() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      typeof window !== "undefined" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal — the app works fine without a worker.
      });
    }
  }, []);

  // Mobile keyboards cover the focused field (e.g. pun search on directory
  // open). After the keyboard finishes opening, bring any focused
  // input/textarea into view. Touch devices only — desktop tabbing through
  // fields must not trigger scroll jumps.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function handleFocusIn(e: FocusEvent) {
      const target = e.target as HTMLElement | null;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Skip if focus already moved on (e.g. quick tab-through).
        if (document.activeElement !== target) return;
        try {
          target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch {
          // Non-fatal — field just stays where it is.
        }
      }, 350);
    }
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
