import type { MetadataRoute } from "next";

// Icons are rendered from brand/ (python3 brand/src/render.py) and synced into public/icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mirror",
    short_name: "Mirror",
    description: "Copy the best traders on Perpl with your limits enforced onchain.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0B0E",
    theme_color: "#4B3BFF",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
