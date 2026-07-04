import type { MetadataRoute } from "next";

/**
 * PWA manifest (Feature 2). Deliberately no service worker / offline caching —
 * stale factory data is worse than an error page. `start_url` is `/` so the
 * installed app opens straight onto the combined dashboard — KPI numbers with
 * the personal task list beneath them on phones (login redirect handles
 * unauthenticated launches). Theme color is the brand-600 design token.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MoldPilot",
    short_name: "MoldPilot",
    description: "Mold trial tracker — your tasks, on your phone.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7f9",
    theme_color: "#1d4f91",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
