"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Pwa } from "@/components/pwa";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={250}>
          {children}
          <Pwa />
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
