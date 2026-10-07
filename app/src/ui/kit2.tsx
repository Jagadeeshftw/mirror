// Small pieces added with design proposal 2: team-run and simulation labels, live dot, deviation
// chip, skeleton blocks, step tabs. Static only: no motion.
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./icons";
import { Row, T } from "./kit";
import { useColors } from "./theme";

export function TeamBadge({ label = "Team-run", testID }: { label?: string; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.wrnS, alignSelf: "flex-start" }}>
      <Icon name="users" size={12} color={c.wrnI} />
      <T size={11} w={600} color={c.wrnI}>
        {label}
      </T>
    </View>
  );
}

export function SimPill({ label = "Simulation, not a promise", testID }: { label?: string; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderStyle: "dashed", borderColor: c.wrn, alignSelf: "flex-start" }}>
      <Icon name="info" size={13} color={c.wrnI} />
      <T size={11} w={600} color={c.wrnI}>
        {label}
      </T>
    </View>
  );
}

export function LiveDot({ on = true, label, testID }: { on?: boolean; label?: string; testID?: string }) {
  const c = useColors();
  return (
    <Row gap={5} testID={testID}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? c.pos : c.mu }} />
      <T size={12} w={600} color={on ? "posI" : "mu"}>
        {label ?? (on ? "Live" : "Offline")}
      </T>
    </Row>
  );
}

export function SmallChip({ label, testID, mono = true }: { label: string; testID?: string; mono?: boolean }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: c.sf2 }}>
      <T size={11} w={500} mono={mono}>
        {label}
      </T>
    </View>
  );
}

/** Grey placeholder block (no shimmer: the app has no motion). */
export function Skel({ w = "100%", h = 14, card, style }: { w?: number | `${number}%`; h?: number; card?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ width: w, height: h, borderRadius: card ? 16 : h / 2, backgroundColor: card ? c.sf : c.sf2, borderWidth: card ? 1 : 0, borderColor: c.bd }, style]} />;
}

/** "1 Set limits · 2 What if · 3 Review" with a bar over each step. */
export function StepTabs({ steps, current, testIDPrefix }: { steps: string[]; current: number; testIDPrefix?: string }) {
  const c = useColors();
  return (
    <Row gap={6}>
      {steps.map((s, i) => (
        <View key={s} testID={testIDPrefix ? `${testIDPrefix}.${i}` : undefined} style={{ flex: 1, paddingTop: 6, borderTopWidth: 3, borderTopColor: i < current ? c.pos : i === current ? c.ac : c.sf2 }}>
          <T size={12} w={500} color={i === current ? "tx" : "mu"}>
            {`${i + 1} ${s}`}
          </T>
        </View>
      ))}
    </Row>
  );
}

/** Section header used across the new screens: title on the left, a note or link on the right. */
export function SecHead({ title, right, style }: { title: React.ReactNode; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Row justify="space-between" style={style}>
      {typeof title === "string" ? (
        <T size={16} w={600}>
          {title}
        </T>
      ) : (
        title
      )}
      {typeof right === "string" ? (
        <T size={12} color="mu">
          {right}
        </T>
      ) : (
        right
      )}
    </Row>
  );
}

/** Check row used in the slow-backend card and the demo cycle card. */
export function CheckRow({ state, title, sub, extra, testID, last }: { state: "done" | "now" | "blk" | "pending"; title: string; sub?: string; extra?: React.ReactNode; testID?: string; last?: boolean }) {
  const c = useColors();
  const icon: IconName | null = state === "done" ? "check" : state === "blk" ? "ban" : null;
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.bd }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          marginTop: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: state === "done" ? c.posS : state === "blk" ? c.negS : "transparent",
          borderWidth: state === "now" || state === "pending" ? 2 : 0,
          borderColor: state === "now" ? c.ac : c.bd,
        }}
      >
        {icon ? <Icon name={icon} size={14} color={state === "blk" ? c.neg : c.posI} /> : null}
        {state === "now" ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ac }} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={13} w={600} color={state === "pending" ? "mu" : state === "blk" ? "neg" : "tx"}>
          {title}
        </T>
        {sub ? (
          <T size={12} color="mu">
            {sub}
          </T>
        ) : null}
        {extra ? <Row gap={8} style={{ flexWrap: "wrap", marginTop: 4 }}>{extra}</Row> : null}
      </View>
    </View>
  );
}
