import { Hono } from "hono";
import {
  getSessions,
  getCheckins,
  computeWeeklyRunMetrics,
  buildGradePyramid,
  buildSorenessTrends,
} from "@smart-trainer/core";

export const metricsRouter = new Hono();

function weekBounds(date: Date): { from: string; to: string } {
  const d = new Date(date);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return {
    from: monday.toISOString(),
    to: sunday.toISOString(),
  };
}

metricsRouter.get("/weekly", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");

  const now = new Date();
  const thisWeek = weekBounds(now);
  const lastWeekDate = new Date(now);
  lastWeekDate.setDate(now.getDate() - 7);
  const lastWeek = weekBounds(lastWeekDate);

  const [current, prev] = await Promise.all([
    getSessions(db, userId, thisWeek),
    getSessions(db, userId, lastWeek),
  ]);

  const runMetrics = computeWeeklyRunMetrics(current.runs, prev.runs);

  return c.json({
    ...runMetrics,
    climb_sessions: current.climbs.length,
    strength_sessions: current.strength.length,
    week_start: thisWeek.from,
  });
});

metricsRouter.get("/grade-pyramid", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const days = parseInt(c.req.query("days") ?? "90", 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString();
  const to = new Date().toISOString();
  const sessions = await getSessions(db, userId, { from, to, sport: "climb" });
  return c.json(buildGradePyramid(sessions.climbs));
});

metricsRouter.get("/soreness-trends", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const days = parseInt(c.req.query("days") ?? "30", 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString();
  const to = new Date().toISOString();
  const checkins = await getCheckins(db, userId, { from, to });
  return c.json(buildSorenessTrends(checkins));
});
