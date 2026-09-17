export type ChartRow = { t: number; [key: `s${number}`]: number | null };

/** One row per timestamp; series are keyed s0, s1… so resource names never collide with `t`. */
export function mergeSeriesRows(series: readonly { timestamps: number[]; values: number[] }[]): ChartRow[] {
  const rows = new Map<number, ChartRow>();
  series.forEach((s, index) => {
    s.timestamps.forEach((t, i) => {
      let row = rows.get(t);
      if (!row) {
        row = { t };
        series.forEach((_, j) => (row![`s${j}`] = null));
        rows.set(t, row);
      }
      row[`s${index}`] = s.values[i];
    });
  });
  return [...rows.values()].sort((a, b) => a.t - b.t);
}
