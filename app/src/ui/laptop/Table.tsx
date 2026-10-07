// Table for the laptop compositions: uppercase header, row separators, a selected row with an
// accent bar. Columns size by flex or fixed width.
import React from "react";
import { View, type DimensionValue } from "react-native";
import { Press, T } from "../kit";
import { useColors } from "../theme";

export interface Col<R> {
  key: string;
  label: string;
  flex?: number;
  width?: DimensionValue;
  align?: "left" | "right";
  render: (r: R, i: number) => React.ReactNode;
}

export function Table<R>({ cols, rows, rowKey, selected, onRow, testIDPrefix, rowStyle, span }: { cols: Col<R>[]; rows: R[]; rowKey: (r: R, i: number) => string; selected?: string | null; onRow?: (r: R, i: number) => void; testIDPrefix: string; rowStyle?: (r: R) => object | undefined; span?: (r: R) => { from: number; to: number; node: React.ReactNode } | null }) {
  const c = useColors();
  const cell = (col: Col<R>, content: React.ReactNode, key: string) => (
    <View key={key} style={{ flex: col.width ? undefined : (col.flex ?? 1), width: col.width, minWidth: 0, overflow: "hidden", alignItems: col.align === "right" ? "flex-end" : "flex-start", paddingHorizontal: 6 }}>
      {content}
    </View>
  );
  return (
    <View testID={testIDPrefix}>
      <View style={{ flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.bd }}>
        {cols.map((col) =>
          cell(
            col,
            <T size={11} w={500} color="mu" upper lines={1}>
              {col.label}
            </T>,
            col.key,
          ),
        )}
      </View>
      {rows.map((r, i) => {
        const k = rowKey(r, i);
        const on = selected === k;
        const sp = span?.(r) ?? null;
        const cells: React.ReactNode[] = [];
        for (let j = 0; j < cols.length; j++) {
          if (sp && j === sp.from) {
            const flex = cols.slice(sp.from, sp.to + 1).reduce((s, x) => s + (x.flex ?? 1), 0);
            cells.push(
              <View key="span" style={{ flex, minWidth: 0, paddingHorizontal: 6 }}>
                {sp.node}
              </View>,
            );
            j = sp.to;
            continue;
          }
          cells.push(cell(cols[j], cols[j].render(r, i), cols[j].key));
        }
        return (
          <Press
            key={k}
            testID={`${testIDPrefix}.row.${i}`}
            onPress={onRow ? () => onRow(r, i) : undefined}
            pressedStyle={{ opacity: 0.8 }}
            style={[{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.bd, borderLeftWidth: 3, borderLeftColor: on ? c.ac : "transparent", backgroundColor: on ? c.acs : "transparent" }, rowStyle?.(r)]}
          >
            {cells}
          </Press>
        );
      })}
    </View>
  );
}
