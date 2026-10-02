"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Registers the service worker; on the sign-in page, clears pages saved for offline reading. */
export function Pwa() {
  const path = usePathname();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (path === "/login") (reg.active ?? reg.waiting ?? reg.installing)?.postMessage("clear-pages");
    }).catch(() => undefined);
  }, [path]);
  return null;
}
