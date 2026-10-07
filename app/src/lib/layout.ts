// Phone vs laptop composition. Android is always the phone layout; the web app switches to the
// laptop shell (sidebar, tables, side panels) at 1024 px and wider.
export const LAPTOP_MIN_WIDTH = 1024;
export type LayoutKind = "phone" | "laptop";

export function layoutFor(width: number, platform: string): LayoutKind {
  return platform === "web" && width >= LAPTOP_MIN_WIDTH ? "laptop" : "phone";
}
