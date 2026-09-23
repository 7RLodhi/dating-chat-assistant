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

  return null;
}
