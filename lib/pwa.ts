"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "./analytics";

// Central PWA install plumbing. The beforeinstallprompt event fires once per
// page load (if at all), so the module captures it globally at import time
// and the hook below just subscribes — any component can then offer an
// install button without racing the event.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isAndroidDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

if (typeof window !== "undefined") {
  installedFlag = isStandalone();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedFlag = true;
    trackEvent("app_installed");
    emit();
  });
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export function usePwaInstall() {
  const [, forceUpdate] = useState(0);
  const [isAndroid] = useState(isAndroidDevice);

  useEffect(() => {
    const rerender = () => forceUpdate((n) => n + 1);
    listeners.add(rerender);
    // Re-check standalone in case the event fired before listeners attached.
    if (isStandalone() && !installedFlag) {
      installedFlag = true;
      emit();
    }
    return () => {
      listeners.delete(rerender);
    };
  }, []);

  async function promptInstall(): Promise<InstallOutcome> {
    const promptEvent = deferredPrompt;
    if (!promptEvent) {
      trackEvent("install_unavailable", { isAndroid });
      return "unavailable";
    }
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    trackEvent(outcome === "accepted" ? "install_accepted" : "install_dismissed");
    if (outcome === "accepted") {
      deferredPrompt = null;
      installedFlag = true;
      emit();
    }
    return outcome;
  }

  return {
    isAndroid,
    isInstalled: installedFlag,
    canInstall: deferredPrompt !== null && !installedFlag,
    promptInstall,
  };
}
