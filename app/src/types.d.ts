declare module "qrcode/lib/core/qrcode" {
  export function create(text: string, opts?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): {
    modules: { size: number; data: Uint8Array | boolean[] };
    version: number;
  };
}
