import { Hono } from "hono";
import {
  getWeeklyMileage,
  getGradePyramid,
  getSorenessTrend,
  getAdherence,
  aggregatePyramid,
} from "@smart-trainer/core";

export const metricsRouter = new Hono();

metricsRouter.get("/weekly-mileage", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const weeks = parseInt(c.req.query("weeks") ?? "12", 10);
  return c.json(await getWeeklyMileage(db, userId, weeks));
});

metricsRouter.get("/grade-pyramid", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const months = parseInt(c.req.query("months") ?? "3", 10);
  const environment = c.req.query("environment");
  const rows = await getGradePyramid(db, userId, { months, environment });
  return c.json({ rows, aggregated: Object.fromEntries(aggregatePyramid(rows)) });
});

metricsRouter.get("/soreness-trend", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const days = parseInt(c.req.query("days") ?? "30", 10);
  return c.json(await getSorenessTrend(db, userId, days));
});

metricsRouter.get("/adherence", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  return c.json(await getAdherence(db, userId));
});
