import { Platform, useWindowDimensions } from "react-native";
import { layoutFor, type LayoutKind } from "../lib/layout";

/** "laptop" on the web at 1024 px and wider (sidebar shell, tables, side panels); "phone" otherwise. */
export function useLayout(): LayoutKind {
  const { width } = useWindowDimensions();
  return layoutFor(width, Platform.OS);
}
