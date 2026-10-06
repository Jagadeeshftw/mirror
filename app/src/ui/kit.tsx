// Mirror UI kit. Mirrors design/app-proposal/styles.css. No motion anywhere: no ripples,
// no animated values, no spinners (static progress states instead).
import { router } from "expo-router";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Rect } from "react-native-svg";
import { Icon, type IconName } from "./icons";
import { fonts, useColors, type Colors } from "./theme";

// ---------------------------------------------------------------- text
type Weight = 400 | 500 | 600 | 700;
export interface TProps {
  children?: React.ReactNode;
  size?: number;
  w?: Weight;
  mono?: boolean;
  color?: keyof Colors | string;
  style?: StyleProp<TextStyle>;
  center?: boolean;
  lines?: number;
  upper?: boolean;
  testID?: string;
  selectable?: boolean;
  lh?: number;
}
export function fontFor(mono: boolean | undefined, w: Weight = 400) {
  if (mono) return w >= 600 ? fonts.monoSemi : w >= 500 ? fonts.monoMedium : fonts.mono;
  return w >= 700 ? fonts.uiBold : w >= 600 ? fonts.uiSemi : w >= 500 ? fonts.uiMedium : fonts.ui;
}
export function T({ children, size = 14, w = 400, mono, color = "tx", style, center, lines, upper, testID, selectable, lh }: TProps) {
  const c = useColors();
  const col = (c as any)[color] ?? color;
  return (
    <Text
      testID={testID}
      numberOfLines={lines}
      selectable={selectable}
      style={[
        {
          fontFamily: fontFor(mono, w),
          fontSize: size,
          lineHeight: lh ?? Math.round(size * (size >= 22 ? 1.15 : 1.4)),
          color: col,
          fontVariant: ["tabular-nums"],
          letterSpacing: mono ? -0.01 * size : 0,
          includeFontPadding: false,
        },
        center && { textAlign: "center" },
        upper && { textTransform: "uppercase", letterSpacing: 0.04 * size },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
/** Uppercase label (.lbl) */
export function Lbl({ children, color = "mu", style, center }: { children: React.ReactNode; color?: keyof Colors; style?: StyleProp<TextStyle>; center?: boolean }) {
  return (
    <T size={12} w={500} color={color} upper style={style} center={center}>
      {children}
    </T>
  );
}

// ---------------------------------------------------------------- layout
export function Row({ children, gap = 8, style, align = "center", justify, testID }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle>; align?: ViewStyle["alignItems"]; justify?: ViewStyle["justifyContent"]; testID?: string }) {
  return <View testID={testID} style={[{ flexDirection: "row", alignItems: align, gap, justifyContent: justify }, style]}>{children}</View>;
}
export function Col({ children, gap = 0, style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}
export const Grow = () => <View style={{ flex: 1 }} />;

export function Screen({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return <View testID={testID} style={[{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }, style]}>{children}</View>;
}

export function Scroll({ children, contentStyle, testID, ...rest }: ScrollViewProps & { contentStyle?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return (
    <ScrollView
      testID={testID}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[{ gap: 16, paddingBottom: 24 }, contentStyle]}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, testID, onPress, list, dashed, borderColor }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string; onPress?: () => void; list?: boolean; dashed?: boolean; borderColor?: string }) {
  const c = useColors();
  const base: ViewStyle = { backgroundColor: c.sf, borderColor: borderColor ?? c.bd, borderWidth: borderColor ? 2 : 1, borderRadius: 16, borderStyle: dashed ? "dashed" : "solid", overflow: "hidden" };
  const kids = list ? React.Children.toArray(children).filter(Boolean) : null;
  const content = list
    ? kids!.map((k, i) => (
        <View key={i} style={i < kids!.length - 1 ? { borderBottomWidth: 1, borderBottomColor: c.bd } : undefined}>
          {k}
        </View>
      ))
    : children;
  if (onPress)
    return (
      <Press testID={testID} onPress={onPress} style={[base, style]}>
        {content}
      </Press>
    );
  return (
    <View testID={testID} style={[base, style]}>
      {content}
    </View>
  );
}

/** Pressable with an instant pressed state (no ripple, no animation). */
export function Press({ children, style, pressedStyle, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; pressedStyle?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return (
    <Pressable android_disableSound={false} {...rest} style={({ pressed }) => [style, pressed && (pressedStyle ?? { opacity: 0.6 })]}>
      {children}
    </Pressable>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: 1, backgroundColor: c.bd }} />;
}

// ---------------------------------------------------------------- buttons
type BtnKind = "pri" | "ton" | "out" | "txt" | "dng" | "dngO" | "dis";
export function Button({
  title,
  kind = "pri",
  icon,
  onPress,
  size = "lg",
  testID,
  disabled,
  style,
  flex,
}: {
  title?: string;
  kind?: BtnKind;
  icon?: IconName;
  onPress?: () => void;
  size?: "lg" | "md" | "sm";
  testID?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  flex?: boolean;
}) {
  const c = useColors();
  const k = disabled ? "dis" : kind;
  const bg = { pri: c.ac, ton: c.acs, out: c.sf, txt: "transparent", dng: c.neg, dngO: "transparent", dis: c.sf2 }[k];
  const fg = { pri: c.onAc, ton: c.ac, out: c.tx, txt: c.ac, dng: c.onNeg, dngO: c.neg, dis: c.mu }[k];
  const h = size === "lg" ? (k === "txt" ? 44 : 52) : size === "md" ? 44 : 36;
  return (
    <Press
      testID={testID}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[
        {
          height: h,
          borderRadius: 999,
          backgroundColor: bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingHorizontal: size === "sm" ? 14 : 20,
          borderWidth: k === "out" || k === "dngO" ? 1 : 0,
          borderColor: k === "dngO" ? c.neg : c.bd,
        },
        flex && { flex: 1 },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 16 : 20} color={fg} /> : null}
      {title ? (
        <T size={size === "lg" ? 15 : size === "md" ? 14 : 13} w={600} color={fg}>
          {title}
        </T>
      ) : null}
    </Press>
  );
}

export function IconButton({ name, onPress, testID, small, color }: { name: IconName; onPress?: () => void; testID?: string; small?: boolean; color?: string }) {
  const c = useColors();
  const s = small ? 32 : 44;
  return (
    <Press testID={testID} onPress={onPress} accessibilityRole="button" style={{ width: s, height: s, borderRadius: 999, alignItems: "center", justifyContent: "center" }}>
      <Icon name={name} size={small ? 16 : 24} color={color ?? (small ? c.mu : c.tx)} />
    </Press>
  );
}

export function Link({ title, onPress, testID, icon, size = 13 }: { title: string; onPress?: () => void; testID?: string; icon?: IconName; size?: number }) {
  const c = useColors();
  return (
    <Press testID={testID} onPress={onPress} hitSlop={8}>
      <Row gap={2}>
        <T size={size} w={600} color="ac">
          {title}
        </T>
        {icon ? <Icon name={icon} size={14} color={c.ac} /> : null}
      </Row>
    </Press>
  );
}

// ---------------------------------------------------------------- chips, pills, segments
export function Chip({ label, on, onPress, icon, testID, mono, dot, trailing, height = 34 }: { label: string; on?: boolean; onPress?: () => void; icon?: IconName; testID?: string; mono?: boolean; dot?: boolean; trailing?: IconName; height?: number }) {
  const c = useColors();
  return (
    <Press
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={{
        height,
        paddingHorizontal: mono ? 11 : 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? "transparent" : c.bd,
        backgroundColor: on ? c.acs : c.sf,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={on ? c.ac : c.tx} /> : null}
      <T size={13} w={500} mono={mono} color={on ? c.ac : c.tx}>
        {label}
      </T>
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: on ? c.ac : c.tx, opacity: on ? 1 : 0.7, marginLeft: -2 }} /> : null}
      {trailing ? <Icon name={trailing} size={14} color={on ? c.ac : c.tx} /> : null}
    </Press>
  );
}

export function ChipS({ label, tone = "neutral", icon, testID }: { label: string; tone?: "neutral" | "neg" | "wrn" | "ok" | "ac"; icon?: IconName; testID?: string }) {
  const c = useColors();
  const bg = { neutral: c.sf2, neg: c.negS, wrn: c.wrnS, ok: c.posS, ac: c.acs }[tone];
  const fg = { neutral: c.tx, neg: c.neg, wrn: c.wrnI, ok: c.posI, ac: c.ac }[tone];
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: bg, alignSelf: "flex-start" }}>
      {icon ? <Icon name={icon} size={13} color={fg} /> : null}
      <T size={12} w={500} color={fg}>
        {label}
      </T>
    </View>
  );
}

export function Seg<K extends string>({ options, value, onChange, small, testIDPrefix }: { options: { key: K; label: string; icon?: IconName }[]; value: K; onChange: (k: K) => void; small?: boolean; testIDPrefix?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: c.bd, borderRadius: 999, padding: 3, gap: 2, backgroundColor: c.sf }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Press
            key={o.key}
            testID={testIDPrefix ? `${testIDPrefix}.${o.key}` : undefined}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ flex: small ? 0 : 1, paddingVertical: small ? 4 : 7, paddingHorizontal: 10, borderRadius: 999, backgroundColor: on ? c.acs : "transparent", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            {o.icon ? <Icon name={o.icon} size={16} color={on ? c.ac : c.mu} /> : null}
            <T size={small ? 12 : 13} w={on ? 600 : 500} color={on ? c.ac : c.mu}>
              {o.label}
            </T>
          </Press>
        );
      })}
    </View>
  );
}

export function Side({ side }: { side: "Long" | "Short" | "long" | "short" }) {
  const c = useColors();
  const long = side.toLowerCase() === "long";
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: long ? c.posS : c.negS }}>
      <T size={11} w={600} color={long ? c.posI : c.neg} style={{ letterSpacing: 0.2 }}>
        {long ? "Long" : "Short"}
      </T>
    </View>
  );
}

export function MarketBadge({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: c.sf2, borderWidth: 1, borderColor: c.bd, alignItems: "center", justifyContent: "center" }}>
      <T size={symbol.length > 3 ? 8.5 : 9.5} w={600} mono>
        {symbol}
      </T>
    </View>
  );
}

export function NansenLabel({ label }: { label: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: c.bd, backgroundColor: c.sf, alignSelf: "flex-start" }}>
      <Icon name="tag" size={12} color={c.ac} />
      <T size={11} w={500}>
        {label}
      </T>
    </View>
  );
}

export function TeamRunBadge() {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.wrnS, alignSelf: "flex-start" }}>
      <Icon name="info" size={12} color={c.wrnI} />
      <T size={11} w={600} color={c.wrnI}>
        Team-run demo account
      </T>
    </View>
  );
}

export function LatencyPill({ ms, label = "Copied in", testID }: { ms?: number; label?: string; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.sf2, paddingLeft: 7, paddingRight: 9, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" }}>
      <Icon name="feed" size={14} color={c.ac} />
      <T size={12} w={500} mono>
        {label} {ms !== undefined ? (ms / 1000).toFixed(2) + " s" : ""}
      </T>
    </View>
  );
}

const COMMIT = ["proposed", "voted", "finalized"] as const;
export function CommitTrack({ state }: { state: string }) {
  const c = useColors();
  const k = Math.max(0, COMMIT.indexOf(state as any));
  return (
    <Row gap={3} style={{ alignSelf: "flex-start" }}>
      {COMMIT.map((s, i) => {
        const done = i <= k;
        const cur = i === k;
        const fill = cur && i < 2 ? c.wrn : done ? c.pos : "transparent";
        return (
          <Row key={s} gap={4}>
            <View style={{ width: cur && i === 2 ? 8 : 7, height: cur && i === 2 ? 8 : 7, borderRadius: 999, borderWidth: 1.5, borderColor: done ? (cur && i < 2 ? c.wrn : c.pos) : c.mu, backgroundColor: fill }} />
            {cur ? (
              <T size={11} w={600} color={c.tx}>
                {s[0].toUpperCase() + s.slice(1)}
              </T>
            ) : null}
          </Row>
        );
      })}
    </Row>
  );
}

export function TxLink({ hash, onPress, testID }: { hash: string; onPress?: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Press testID={testID} onPress={onPress} hitSlop={8}>
      <Row gap={3}>
        <T size={12} mono color="ac">
          {`${hash.slice(0, 6)}…${hash.slice(-4)}`}
        </T>
        <Icon name="ext" size={13} color={c.ac} />
      </Row>
    </Press>
  );
}

// ---------------------------------------------------------------- identity marks
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      {/* Brand mark (brand/svg/mark.svg): fixed colours in both themes. */}
      <Rect width={32} height={32} rx={9} fill="#4B3BFF" />
      <Path d="M15 7.5 6.5 24.5H15z" fill="#FFFFFF" />
      <Path d="M17 7.5l8.5 17H17z" fill="#FFFFFF" fillOpacity={0.45} />
    </Svg>
  );
}

function hash32(s: string) {
  let h = 2166136261;
  for (const ch of s.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function Identicon({ seed, size = 36 }: { seed: string; size?: number }) {
  const c = useColors();
  const h = hash32(seed || "0x");
  const rects: React.ReactNode[] = [];
  for (let r = 0; r < 5; r++)
    for (let col = 0; col < 3; col++) {
      if ((h >> (r * 3 + col)) & 1) {
        rects.push(<Rect key={`${r}-${col}`} x={col} y={r} width={1.02} height={1.02} />);
        if (col < 2) rects.push(<Rect key={`${r}-${col}m`} x={4 - col} y={r} width={1.02} height={1.02} />);
      }
    }
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: c.acs, alignItems: "center", justifyContent: "center" }}>
      <Svg viewBox="-1 -1 7 7" width={size * 0.72} height={size * 0.72} fill={c.ac}>
        {rects}
      </Svg>
    </View>
  );
}

export function Coin({ size = 24 }: { size?: number }) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: c.tx, alignItems: "center", justifyContent: "center" }}>
      <T size={size * 0.5} w={700} color={c.bg} lh={size * 0.6}>
        A
      </T>
    </View>
  );
}

// ---------------------------------------------------------------- inputs
export function Field({ children, big, style, error }: { children: React.ReactNode; big?: boolean; style?: StyleProp<ViewStyle>; error?: boolean }) {
  const c = useColors();
  return (
    <View
      style={[
        { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: big ? 2 : 1, borderColor: error ? c.neg : big ? c.ac : c.bd, borderRadius: 12, paddingHorizontal: big ? 13 : 14, paddingVertical: big ? 8 : 10, backgroundColor: c.sf },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function NumInput({ value, onChangeText, size = 17, testID, placeholder, ...rest }: TextInputProps & { size?: number }) {
  const c = useColors();
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      keyboardType="decimal-pad"
      placeholder={placeholder}
      placeholderTextColor={c.mu}
      cursorColor={c.ac}
      selectionColor={c.acs}
      style={{ fontFamily: fonts.monoMedium, fontSize: size, color: c.tx, padding: 0, minWidth: 40, flexShrink: 1, fontVariant: ["tabular-nums"] }}
      {...rest}
    />
  );
}

export function Switch({ on, onChange, testID, disabled }: { on: boolean; onChange?: (v: boolean) => void; testID?: string; disabled?: boolean }) {
  const c = useColors();
  return (
    <Press
      testID={testID}
      onPress={disabled ? undefined : () => onChange?.(!on)}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      hitSlop={8}
      style={{ width: 52, height: 32, borderRadius: 999, borderWidth: 2, borderColor: on ? c.ac : c.mu, backgroundColor: on ? c.ac : c.sf2, opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={
          on
            ? { position: "absolute", width: 24, height: 24, borderRadius: 999, top: 2, left: 22, backgroundColor: c.onAc }
            : { position: "absolute", width: 16, height: 16, borderRadius: 999, top: 6, left: 6, backgroundColor: c.mu }
        }
      />
    </Press>
  );
}

/**
 * Discrete slider over `steps` (no animation: the handle jumps to the touched step).
 * Tap or drag anywhere on the track.
 */
export function Slider({ steps, index, onChange, ticks, testID }: { steps: number; index: number; onChange: (i: number) => void; ticks?: { label: string; at: number }[]; testID?: string }) {
  const c = useColors();
  const [w, setW] = React.useState(0);
  const frac = steps <= 1 ? 0 : index / (steps - 1);
  const pick = (x: number) => {
    if (!w) return;
    const f = Math.min(1, Math.max(0, x / w));
    const i = Math.round(f * (steps - 1));
    if (i !== index) onChange(i);
  };
  return (
    <View style={{ marginHorizontal: 10 }}>
      <View
        testID={testID}
        accessibilityRole="adjustable"
        accessibilityValue={{ min: 0, max: steps - 1, now: index }}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        style={{ height: 32, justifyContent: "center" }}
      >
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.sf2, overflow: "hidden" }} pointerEvents="none">
          <View style={{ height: 6, width: `${frac * 100}%`, backgroundColor: c.ac }} />
        </View>
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: `${frac * 100}%`, marginLeft: -11, top: 5, width: 22, height: 22, borderRadius: 999, backgroundColor: c.ac, borderWidth: 4, borderColor: c.sf }}
        />
      </View>
      {ticks ? (
        <View style={{ height: 16, marginTop: -2 }}>
          {ticks.map((t, i) => (
            <T
              key={t.label}
              size={11}
              mono
              color="mu"
              style={{
                position: "absolute",
                left: `${t.at * 100}%`,
                transform: [{ translateX: i === 0 ? -8 : i === ticks.length - 1 ? -30 : -14 }],
                width: i === ticks.length - 1 ? 38 : 30,
                textAlign: i === 0 ? "left" : i === ticks.length - 1 ? "right" : "center",
              }}
            >
              {t.label}
            </T>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- notes, kv
export function Note({ children, icon = "info", tone = "plain", testID }: { children: React.ReactNode; icon?: IconName; tone?: "plain" | "warn" | "ac" | "neg"; testID?: string }) {
  const c = useColors();
  const bg = { plain: "transparent", warn: c.wrnS, ac: c.acs, neg: c.negS }[tone];
  const ic = { plain: c.mu, warn: c.wrnI, ac: c.ac, neg: c.neg }[tone];
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: bg, padding: tone === "plain" ? 0 : 12, borderRadius: 12 }}>
      <View style={{ marginTop: 1 }}>
        <Icon name={icon} size={16} color={ic} />
      </View>
      <View style={{ flex: 1 }}>{typeof children === "string" ? <T size={13} color={tone === "plain" ? "mu" : "tx"} lh={19}>{children}</T> : children}</View>
    </View>
  );
}

export function Hint({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: warn ? c.wrnS : c.sf2, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 }}>
      {warn ? (
        <View style={{ marginTop: 1 }}>
          <Icon name="warn" size={14} color={c.wrnI} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>{typeof children === "string" ? <T size={12} color={warn ? "tx" : "mu"} lh={17}>{children}</T> : children}</View>
    </View>
  );
}

export function KV({ k, v, testID, last, vMono = true }: { k: string; v: React.ReactNode; testID?: string; last?: boolean; vMono?: boolean }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.bd }}>
      <T size={13} color="mu">
        {k}
      </T>
      <View style={{ flexShrink: 1, alignItems: "flex-end" }}>
        {typeof v === "string" ? (
          <T size={13} mono={vMono} style={{ textAlign: "right" }}>
            {v}
          </T>
        ) : (
          v
        )}
      </View>
    </View>
  );
}

export function Meter({ parts, height = 8 }: { parts: { frac: number; color: string; opacity?: number }[]; height?: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 2, height, borderRadius: height / 2, backgroundColor: c.sf2, overflow: "hidden" }}>
      {parts.map((p, i) => (
        <View key={i} style={{ width: `${Math.max(0, Math.min(1, p.frac)) * 100}%`, backgroundColor: p.color, opacity: p.opacity ?? 1 }} />
      ))}
    </View>
  );
}

export function Steps2({ step, labels }: { step: 0 | 1; labels: [string, string] }) {
  const c = useColors();
  return (
    <Row gap={8}>
      {labels.map((l, i) => {
        const on = i === step;
        const done = i < step;
        return (
          <View key={l} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: on ? c.acs : c.sf2 }}>
            <View style={{ width: 20, height: 20, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.ac : done ? c.posS : c.bd }}>
              {done ? <Icon name="check" size={12} color={c.posI} /> : <T size={11} mono color={on ? c.onAc : c.tx}>{i + 1}</T>}
            </View>
            <T size={13} w={500} color={on ? c.ac : c.mu} lines={1} style={{ flexShrink: 1 }}>
              {l}
            </T>
          </View>
        );
      })}
    </Row>
  );
}

/** Static checklist used for multi-step flows (no spinners: the current step is a half-filled ring). */
export function Checklist({ items }: { items: { key: string; title: string; sub?: React.ReactNode; state: "pending" | "now" | "done" | "failed" }[] }) {
  const c = useColors();
  return (
    <View>
      {items.map((it, i) => (
        <View key={it.key} testID={`step.${it.key}.${it.state}`} style={{ flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: c.bd }}>
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 1,
              backgroundColor: it.state === "done" ? c.posS : it.state === "failed" ? c.negS : "transparent",
              borderWidth: it.state === "now" || it.state === "pending" ? 2 : 0,
              borderColor: it.state === "now" ? c.ac : c.bd,
            }}
          >
            {it.state === "done" ? <Icon name="check" size={16} color={c.posI} /> : null}
            {it.state === "failed" ? <Icon name="close" size={14} color={c.neg} /> : null}
            {it.state === "now" ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ac }} /> : null}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={14} w={600} color={it.state === "pending" ? "mu" : "tx"}>
              {it.title}
            </T>
            {typeof it.sub === "string" ? (
              <T size={12} color="mu">
                {it.sub}
              </T>
            ) : (
              it.sub
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- overlays (no animation)
export function Sheet({ visible, onClose, children, testID, tall }: { visible: boolean; onClose: () => void; children: React.ReactNode; testID?: string; tall?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} testID={testID ? `${testID}.scrim` : undefined} />
        <View testID={testID} style={{ backgroundColor: c.sf, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: insets.bottom + 12, maxHeight: tall ? "94%" : "90%" }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.mu, opacity: 0.45, alignSelf: "center", marginTop: 10, marginBottom: 6 }} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function Dialog({ visible, onClose, children, testID }: { visible: boolean; onClose: () => void; children: React.ReactNode; testID?: string }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "center", padding: 24 }}>
        <View testID={testID} style={{ backgroundColor: c.sf, borderRadius: 28, padding: 24, gap: 14 }}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- empty / error
export function EmptyState({ title, body, action, onAction, testID, icon = "info" }: { title: string; body: string; action?: string; onAction?: () => void; testID?: string; icon?: IconName }) {
  const c = useColors();
  return (
    <Card testID={testID} style={{ paddingVertical: 24, paddingHorizontal: 20, alignItems: "center", gap: 10 }}>
      <View style={{ width: 48, height: 48, borderRadius: 999, backgroundColor: c.sf2, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={22} color={c.mu} />
      </View>
      <T size={19} w={600} center>
        {title}
      </T>
      <T size={13} color="mu" center>
        {body}
      </T>
      {action ? <Button title={action} onPress={onAction} style={{ alignSelf: "stretch", marginTop: 6 }} /> : null}
    </Card>
  );
}

export function ErrorBanner({ title, body, onRetry, testID }: { title: string; body: string; onRetry?: () => void; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={{ marginHorizontal: 16, flexDirection: "row", gap: 12, alignItems: "center", padding: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.wrnS }}>
      <Icon name="wifioff" size={20} color={c.wrnI} />
      <View style={{ flex: 1 }}>
        <T size={13} w={600}>
          {title}
        </T>
        <T size={12} style={{ opacity: 0.85 }}>
          {body}
        </T>
      </View>
      {onRetry ? <Button title="Retry" icon="refresh" kind="ton" size="sm" onPress={onRetry} testID={testID ? `${testID}.retry` : undefined} /> : null}
    </View>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  const c = useColors();
  return (
    <View style={{ padding: 32, alignItems: "center" }}>
      <T size={13} color={c.mu}>
        {label}
      </T>
    </View>
  );
}

export const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

export const styles = StyleSheet.create({
  pad20: { paddingHorizontal: 20 },
  pad16: { paddingHorizontal: 16 },
});
