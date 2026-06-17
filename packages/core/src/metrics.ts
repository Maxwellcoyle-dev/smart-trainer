// Client-side metric helpers (complement the SQL views for cases where
// the view data needs further processing in TypeScript).

import type {
  WeeklyMileage,
  GradePyramidRow,
  SorenessTrendRow,
  BodyPart,
} from "./types.js";

/** Group grade pyramid rows by environment and grade_value, summing sends. */
export function aggregatePyramid(
  rows: GradePyramidRow[]
): Map<string, { grade_label: string; grade_value: number; sends: number; attempts: number }[]> {
  const byEnv = new Map<string, Map<number, { grade_label: string; grade_value: number; sends: number; attempts: number }>>();

  for (const row of rows) {
    const env = `${row.environment}:${row.discipline ?? "rope"}`;
    if (!byEnv.has(env)) byEnv.set(env, new Map());
    const envMap = byEnv.get(env)!;
    const existing = envMap.get(row.grade_value) ?? {
      grade_label: row.grade_label,
      grade_value: row.grade_value,
      sends: 0,
      attempts: 0,
    };
    existing.sends += row.sends;
    existing.attempts += row.attempt_rows;
    envMap.set(row.grade_value, existing);
  }

  const result = new Map<string, { grade_label: string; grade_value: number; sends: number; attempts: number }[]>();
  for (const [env, envMap] of byEnv) {
    result.set(env, [...envMap.values()].sort((a, b) => a.grade_value - b.grade_value));
  }
  return result;
}

/** Return mileage in km for display (storage is meters). */
export function metersToKm(m: number): number {
  return Math.round((m / 1000) * 10) / 10;
}

/** Format pace as mm:ss/km from distance_m + duration_s. */
export function formatPace(distance_m: number, duration_s: number): string {
  if (!distance_m || !duration_s) return "—";
  const pace_s_per_km = duration_s / (distance_m / 1000);
  const mins = Math.floor(pace_s_per_km / 60);
  const secs = Math.round(pace_s_per_km % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}/km`;
}

/** Format duration seconds as h:mm or mm:ss. */
export function formatDuration(s: number): string {
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Compute ramp % for display from two mileage values. */
export function rampDisplay(current_m: number, prev_m: number | null): string {
  if (!prev_m) return "—";
  const pct = ((current_m - prev_m) / prev_m) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

/** Group soreness trend rows by body part. */
export function groupSorenessByPart(
  rows: SorenessTrendRow[]
): Map<BodyPart, { date: string; severity: number }[]> {
  const map = new Map<BodyPart, { date: string; severity: number }[]>();
  for (const row of rows) {
    const arr = map.get(row.body_part) ?? [];
    arr.push({ date: row.check_in_date, severity: row.severity });
    map.set(row.body_part, arr);
  }
  return map;
}

/** Latest mileage week from the view results. */
export function latestWeek(rows: WeeklyMileage[]): WeeklyMileage | null {
  if (!rows.length) return null;
  return rows[rows.length - 1];
}
