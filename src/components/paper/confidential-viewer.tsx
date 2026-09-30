"use client";

import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";

/**
 * Screenshot/print deterrence for confidential views. Browsers cannot prevent screenshots; this
 * blurs content when the window loses focus, blocks the context menu, copy and browser printing,
 * and relies on per-viewer watermarks + audit logging for traceability.
 */
export function ConfidentialViewer({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const hide = () => setHidden(true);
    const show = () => setHidden(document.visibilityState !== "visible");
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === "p" || k === "s" || k === "c")) {
        e.preventDefault();
        toast.info("Use the authorised PDF export. Browser printing and copying are disabled for confidential papers.");
      }
      if (k === "printscreen") {
        setHidden(true);
        toast.warning("Screen capture is not permitted for confidential papers. This view is watermarked with your identity.");
      }
    };
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    document.addEventListener("visibilitychange", show);
    window.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      document.removeEventListener("visibilitychange", show);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
    };
  }, []);
  return (
    <div className={hidden ? "confidential-blur relative" : "relative"}>
      {children}
      {hidden && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-background/40 backdrop-blur-sm" onClick={() => setHidden(false)}>
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-[var(--shadow-float)]">
            <EyeOff className="size-4" /> Confidential content hidden while the window is inactive. Click to continue.
          </div>
        </div>
      )}
    </div>
  );
}
