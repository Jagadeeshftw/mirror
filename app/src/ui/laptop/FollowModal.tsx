// Laptop follow modal: limits on the left, the live what-if on the right, actions in the footer.
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useColors } from "../theme";
import { T } from "../kit";
import { BUILDER_ID, FEE_PCT } from "../../lib/fees";

export function FollowModal({ header, side, footer, children, onClose }: { header: React.ReactNode; side?: React.ReactNode; footer: React.ReactNode; children: React.ReactNode; onClose: () => void }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.scrim, alignItems: "center", justifyContent: "center", padding: 32 }}>
      <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} testID="follow.modal.scrim" accessibilityLabel="Close" />
      <View testID="follow.sheet" style={{ width: "100%", maxWidth: side ? 1180 : 640, height: "100%", maxHeight: 860, backgroundColor: c.sf, borderRadius: 24, overflow: "hidden" }}>
        <View testID="follow.modal" style={{ paddingHorizontal: 24, paddingTop: 18, borderBottomWidth: 1, borderBottomColor: c.bd }}>
          {header}
        </View>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <ScrollView testID="follow.scroll" style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 20 }}>
            {children}
          </ScrollView>
          {side ? (
            <ScrollView testID="follow.whatif.panel" style={{ flex: 1, backgroundColor: c.bg, borderLeftWidth: 1, borderLeftColor: c.bd }} contentContainerStyle={{ padding: 24 }}>
              {side}
            </ScrollView>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 24, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.bd }}>
          <T size={12} color="mu" style={{ flex: 1 }} testID="follow.modal.fee">
            {`Limits are written to your account contract and checked on every copy. Mirror fee: ${FEE_PCT} of opening size (builder ${BUILDER_ID}), never on closes, capped by your contract.`}
          </T>
          <View style={{ minWidth: 320 }}>{footer}</View>
        </View>
      </View>
    </View>
  );
}
