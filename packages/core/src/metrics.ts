import type { RunLog, GradePyramidEntry, ClimbSession, SorenessTrend, CheckIn, BodyPart, WeeklyMetrics } from "./types.js";

export function computeWeeklyRunMetrics(
  currentWeekRuns: RunLog[],
  prevWeekRuns: RunLog[]
): Pick<WeeklyMetrics, "run_km" | "run_km_prev" | "ramp_pct"> {
  const run_km = currentWeekRuns.reduce((s, r) => s + r.distance_km, 0);
  const run_km_prev = prevWeekRuns.reduce((s, r) => s + r.distance_km, 0);
  const ramp_pct = run_km_prev === 0 ? 0 : ((run_km - run_km_prev) / run_km_prev) * 100;
  return { run_km, run_km_prev, ramp_pct };
}

export function buildGradePyramid(sessions: ClimbSession[]): GradePyramidEntry[] {
  const map = new Map<string, GradePyramidEntry>();

  for (const session of sessions) {
    for (const climb of session.climbs) {
      const key = `${climb.grade}:${climb.style}`;
      const existing = map.get(key) ?? { grade: climb.grade, style: climb.style, sends: 0, attempts: 0 };
      existing.sends += climb.sends;
      existing.attempts += climb.attempts;
      map.set(key, existing);
    }
  }

  return [...map.values()].sort((a, b) => a.grade.localeCompare(b.grade));
}

export function buildSorenessTrends(checkins: CheckIn[]): SorenessTrend[] {
  const bodyParts = new Set<BodyPart>();
  for (const c of checkins) {
    for (const part of Object.keys(c.soreness) as BodyPart[]) {
      bodyParts.add(part);
    }
  }

  return [...bodyParts].map((body_part) => ({
    body_part,
    readings: checkins
      .filter((c) => body_part in c.soreness)
      .map((c) => ({
        date: c.logged_at.slice(0, 10),
        score: c.soreness[body_part] ?? 0,
      })),
  }));
}

export function computeAdherence(prescribed: number, completed: number): number {
  if (prescribed === 0) return 100;
  return Math.round((completed / prescribed) * 100);
}
