import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/site";

export const alt = `${BRAND}: copy the best onchain traders, keep your limits`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#F6F6F3",
          padding: "72px 80px",
          fontFamily: "sans-serif",
          color: "#0E0F12",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="7" fill="#4B3BFF" />
            <path d="M11 6.5a5.5 5.5 0 0 0 0 11V6.5Z" fill="#fff" />
            <path d="M13 6.5a5.5 5.5 0 0 1 0 11V6.5Z" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{BRAND}</span>
          <span
            style={{
              marginLeft: 12,
              fontSize: 22,
              color: "#4B3BFF",
              background: "#ECEAFF",
              padding: "6px 16px",
              borderRadius: 999,
            }}
          >
            Beta · Android
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 76, fontWeight: 700, letterSpacing: -3, lineHeight: 1.04 }}>
            Copy the best onchain traders.
          </span>
          <span style={{ fontSize: 76, fontWeight: 700, letterSpacing: -3, lineHeight: 1.04, color: "#4B3BFF" }}>
            Keep your limits.
          </span>
          <span style={{ marginTop: 28, fontSize: 30, color: "#5B606B", maxWidth: 940, lineHeight: 1.35 }}>
            Your own contract on Monad checks your rules on every copied Perpl order. It can trade for you. It can never
            withdraw.
          </span>
        </div>
        <div style={{ display: "flex", gap: 28, fontSize: 24, color: "#5B606B" }}>
          <span>Built on Monad</span>
          <span>·</span>
          <span>Trades on Perpl</span>
          <span>·</span>
          <span>Balance in AUSD</span>
          <span>·</span>
          <span>Passkeys by Mera</span>
        </div>
      </div>
    ),
    size
  );
}
