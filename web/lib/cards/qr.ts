/** QR code as one SVG path (dark modules) for the share cards. Uses the `qrcode` package; error correction M. */
import QRCode from "qrcode";

export interface QrPath {
  size: number;
  d: string;
}

export function qrPath(text: string): QrPath {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  let d = "";
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && data[y * size + x]) x++;
      d += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  }
  return { size, d };
}
