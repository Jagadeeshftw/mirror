// Static SVG charts (never animated). Port of the design's chart() helper.
// Core encoder only (no canvas/fs renderers), works on Hermes.
import { create as qrCreate } from "qrcode/lib/core/qrcode";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { fonts, useColors } from "./theme";

export interface LineChartProps {
  data: number[];
  height: number;
  color?: string;
  area?: boolean;
  padT?: number;
  padB?: number;
  padL?: number;
  padR?: number;
  min?: number;
  max?: number;
  yTicks?: [number, string][];
  xTicks?: [number, string, ("start" | "middle" | "end")?][];
  band?: { from: number; to: number; label: string } | null;
  endDot?: boolean;
  testID?: string;
}

export function LineChart({ data, height, color, area = true, padT = 6, padB = 6, padL = 0, padR = 0, min, max, yTicks = [], xTicks = [], band, endDot = true, testID }: LineChartProps) {
  const c = useColors();
  const [w, setW] = useState(0);
  const col = color ?? c.pos;
  const body = useMemo(() => {
    if (!w || data.length < 2) return null;
    const lo = min ?? Math.min(...data);
    const hi = max ?? Math.max(...data);
    const span = hi - lo || 1;
    const X = (i: number) => padL + (i / (data.length - 1)) * (w - padL - padR);
    const Y = (v: number) => padT + ((hi - v) / span) * (height - padT - padB);
    const d = data.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
    const ar = `${d}L${X(data.length - 1).toFixed(1)} ${height - padB}L${X(0).toFixed(1)} ${height - padB}Z`;
    return { X, Y, d, ar };
  }, [w, data, height, padT, padB, padL, padR, min, max]);
  return (
    <View testID={testID} style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {body ? (
        <Svg width={w} height={height}>
          {yTicks.map(([v, lab]) => (
            <React.Fragment key={`y${v}`}>
              <Line x1={padL} x2={w - padR} y1={body.Y(v)} y2={body.Y(v)} stroke={c.bd} strokeWidth={1} />
              {lab ? (
                <SvgText x={w} y={body.Y(v) + 3.5} textAnchor="end" fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
                  {lab}
                </SvgText>
              ) : null}
            </React.Fragment>
          ))}
          {xTicks.map(([i, lab, anchor = "middle"]) => (
            <SvgText key={`x${i}`} x={body.X(i)} y={height - 1} textAnchor={anchor} fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
              {lab}
            </SvgText>
          ))}
          {band ? (
            <>
              <Rect x={body.X(band.from)} y={padT} width={Math.max(1, body.X(band.to) - body.X(band.from))} height={height - padT - padB} fill={c.neg} fillOpacity={0.08} />
              <Line x1={body.X(band.from)} x2={body.X(band.from)} y1={body.Y(data[band.from])} y2={body.Y(data[band.to])} stroke={c.neg} strokeWidth={1} />
              <SvgText x={(body.X(band.from) + body.X(band.to)) / 2} y={padT - 4} textAnchor="middle" fontSize={10} fontFamily={fonts.monoSemi} fill={c.neg}>
                {band.label}
              </SvgText>
            </>
          ) : null}
          {area ? <Path d={body.ar} fill={col} fillOpacity={0.1} /> : null}
          <Path d={body.d} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {band ? <Circle cx={body.X(band.to)} cy={body.Y(data[band.to])} r={3.5} fill={c.neg} stroke={c.sf} strokeWidth={2} /> : null}
          {endDot ? <Circle cx={body.X(data.length - 1)} cy={body.Y(data[data.length - 1])} r={4} fill={col} stroke={c.sf} strokeWidth={2} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

export function Spark({ data, positive }: { data: number[]; positive: boolean }) {
  const c = useColors();
  if (data.length < 2) return <View style={{ width: 64, height: 28 }} />;
  const w = 64,
    h = 28,
    padT = 4,
    padB = 4,
    padR = 4;
  const lo = Math.min(...data),
    hi = Math.max(...data),
    span = hi - lo || 1;
  const X = (i: number) => (i / (data.length - 1)) * (w - padR);
  const Y = (v: number) => padT + ((hi - v) / span) * (h - padT - padB);
  const d = data.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const col = positive ? c.pos : c.neg;
  return (
    <Svg width={w} height={h}>
      <Path d={`${d}L${X(data.length - 1)} ${h - padB}L0 ${h - padB}Z`} fill={col} fillOpacity={0.1} />
      <Path d={d} fill="none" stroke={col} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={X(data.length - 1)} cy={Y(data[data.length - 1])} r={2.6} fill={col} stroke={c.sf} strokeWidth={1.5} />
    </Svg>
  );
}

/** Trades-per-day columns with an optional highlighted range. */
export function Columns({ values, highlight, labels }: { values: number[]; highlight?: [number, number]; labels: [string, string, string?] }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const h = 64;
  const mx = Math.max(...values, 1) * 1.1;
  const n = values.length;
  const bw = 7;
  const gap = n > 1 ? (w - n * bw) / (n - 1) : 0;
  return (
    <View style={{ height: h + 14 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w ? (
        <Svg width={w} height={h + 14}>
          <Line x1={0} x2={w} y1={h} y2={h} stroke={c.bd} strokeWidth={1} />
          {values.map((v, i) => {
            const bh = Math.max(3, (v / mx) * h);
            const x = i * (bw + gap);
            const on = highlight ? i >= highlight[0] && i <= highlight[1] : false;
            return <Path key={i} d={`M${x} ${h}V${(h - bh + 3).toFixed(1)}q0-3 3-3h1q3 0 3 3V${h}z`} fill={c.ac} fillOpacity={on || !highlight ? (highlight ? 1 : 0.7) : 0.55} />;
          })}
          <SvgText x={0} y={h + 12} fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
            {labels[0]}
          </SvgText>
          <SvgText x={w} y={h + 12} textAnchor="end" fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
            {labels[1]}
          </SvgText>
          {labels[2] && highlight ? (
            <SvgText x={highlight[0] * (bw + gap)} y={h + 12} fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
              {labels[2]}
            </SvgText>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** Real QR encoding (qrcode lib, error correction M) rendered as one SVG path. */
export function QR({ value, size = 186, testID }: { value: string; size?: number; testID?: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrCreate(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const data = qr.modules.data;
    let d = "";
    for (let r = 0; r < n; r++)
      for (let col = 0; col < n; col++) {
        if (data[r * n + col]) d += `M${col} ${r}h1v1h-1z`;
      }
    return { path: d, count: n };
  }, [value]);
  return (
    <View testID={testID} accessibilityLabel={`QR code for ${value}`} style={{ padding: 6, borderRadius: 16, backgroundColor: "#FFFFFF" }}>
      <Svg width={size} height={size} viewBox={`-2 -2 ${count + 4} ${count + 4}`}>
        <Rect x={-2} y={-2} width={count + 4} height={count + 4} fill="#FFFFFF" />
        <Path d={path} fill="#0E0F12" />
      </Svg>
    </View>
  );
}
