import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/** Shown by the app when there is no connection and the page was not saved for offline reading. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="mt-2 text-sm text-muted-foreground">This page is not saved on this device. Your portal, attendance, results, fees, courses and ID card open offline once you have viewed them while connected.</p>
    </main>
  );
}
