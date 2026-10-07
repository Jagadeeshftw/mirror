// Adversarial-leader flag from the engine: the leader exits into followers' fills or moves the book
// on the trades followers copy. Shown on the leader profile (phone and laptop panel) when flagged.
import React from "react";
import { View } from "react-native";
import { dateShort } from "../lib/format";
import type { Adversarial } from "../lib/types";
import { Icon } from "./icons";
import { Row, T } from "./kit";
import { useColors } from "./theme";

export function adversarialSentence(a: Adversarial): string {
  const parts: string[] = [];
  if (a.exitsIntoFollowers) parts.push(`exited into followers' fills ${a.exitsIntoFollowers} time${a.exitsIntoFollowers === 1 ? "" : "s"}`);
  if (a.bookMoving) parts.push(`moved the price against followers on ${a.bookMoving} copied fill${a.bookMoving === 1 ? "" : "s"}`);
  const what = parts.length ? parts.join(" and ") : "traded against followers";
  return `This leader ${what}, out of ${a.copiedFills} copied fills (score ${a.score} of 100).${a.lastSeen ? ` Last seen ${dateShort(a.lastSeen * 1000)}.` : ""} Your limits still apply; consider a tight entry filter.`;
}

export function AdversarialFlag({ a, compact, testID = "leader.adversarial" }: { a?: Adversarial | null; compact?: boolean; testID?: string }) {
  const c = useColors();
  if (!a || !a.flagged) return null;
  if (compact) {
    return (
      <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: c.negS, alignSelf: "flex-start" }}>
        <Icon name="warn" size={12} color={c.neg} />
        <T size={11} w={600} color={c.neg}>
          Flagged
        </T>
      </View>
    );
  }
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 14, borderRadius: 16, backgroundColor: c.negS }}>
      <View style={{ marginTop: 1 }}>
        <Icon name="warn" size={18} color={c.neg} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Row gap={6}>
          <T size={13} w={600} color={c.neg}>
            Flagged: trades against its followers
          </T>
        </Row>
        <T size={12} lh={17} testID={`${testID}.detail`}>
          {adversarialSentence(a)}
        </T>
        <T size={11} color="mu">
          Measured by the Mirror engine from real copies on Monad.
        </T>
      </View>
    </View>
  );
}
