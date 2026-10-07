// Static equity curve for the what-if, with the account loss stop as a dashed line.
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { fonts, useColors } from "./theme";

export function WhatIfChart({ data, stop, height = 150, labels, testID }: { data: number[]; stop?: number | null; height?: number; labels: [string, string, string]; testID?: string }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const padT = 8, padB = 18, padR = 40;
  const g = useMemo(() => {
    if (!w || data.length < 2) return null;
    const vals = stop ? [...data, stop] : data;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span0 = hi - lo || Math.max(1, hi * 0.02);
    lo -= span0 * 0.08;
    hi += span0 * 0.08;
    const X = (i: number) => (i / (data.length - 1)) * (w - padR);
    const Y = (v: number) => padT + ((hi - v) / (hi - lo)) * (height - padT - padB);
    const d = data.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
    const step = niceStep((hi - lo) / 3);
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    return { X, Y, d, area: `${d}L${X(data.length - 1).toFixed(1)} ${height - padB}L0 ${height - padB}Z`, ticks };
  }, [w, data, stop, height]);
  const up = data.length > 1 && data[data.length - 1] >= data[0];
  const col = up ? c.ac : c.neg;
  return (
    <View testID={testID} style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {g ? (
        <Svg width={w} height={height}>
          {g.ticks.map((v) => (
            <React.Fragment key={v}>
              <Line x1={0} x2={w - padR} y1={g.Y(v)} y2={g.Y(v)} stroke={c.bd} strokeWidth={1} />
              <SvgText x={w} y={g.Y(v) + 3.5} textAnchor="end" fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
                {v.toFixed(2)}
              </SvgText>
            </React.Fragment>
          ))}
          {stop ? (
            <>
              <Line x1={0} x2={w - padR} y1={g.Y(stop)} y2={g.Y(stop)} stroke={c.neg} strokeWidth={1.2} strokeDasharray="4 4" />
              <SvgText x={2} y={g.Y(stop) - 4} fontSize={10} fontFamily={fonts.monoSemi} fill={c.neg}>
                {`Loss stop ${stop.toFixed(2)}`}
              </SvgText>
            </>
          ) : null}
          <Path d={g.area} fill={col} fillOpacity={0.1} />
          <Path d={g.d} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={g.X(data.length - 1)} cy={g.Y(data[data.length - 1])} r={4} fill={col} stroke={c.sf} strokeWidth={2} />
          <SvgText x={0} y={height - 2} fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
            {labels[0]}
          </SvgText>
          <SvgText x={(w - padR) / 2} y={height - 2} textAnchor="middle" fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
            {labels[1]}
          </SvgText>
          <SvgText x={w - padR} y={height - 2} textAnchor="end" fontSize={10} fontFamily={fonts.mono} fill={c.mu}>
            {labels[2]}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}

function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x || 1)));
  const f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * p;
}
