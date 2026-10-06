import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#4B3BFF" }}>
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none">
          <path d="M11 6.5a5.5 5.5 0 0 0 0 11V6.5Z" fill="#fff" />
          <path d="M13 6.5a5.5 5.5 0 0 1 0 11V6.5Z" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size
  );
}
