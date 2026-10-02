import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** Installable app (Android, iOS "Add to Home Screen", desktop). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — ${BRAND.tagline}`,
    short_name: BRAND.tagline,
    description: BRAND.description,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f9fafc",
    theme_color: "#2f4fb8",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My portal", url: "/portal" },
      { name: "ID card", url: "/id-card" },
      { name: "Notifications", url: "/notifications" },
    ],
  };
}
