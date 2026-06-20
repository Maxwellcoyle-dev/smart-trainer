import { Hono } from "hono";
import { getInjuryFlags, getCheckins } from "@smart-trainer/core";

export const wellnessRouter = new Hono();

wellnessRouter.get("/injury-flags", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  return c.json(await getInjuryFlags(db, userId));
});

wellnessRouter.get("/latest-checkin", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 14 * 86400_000).toISOString();
  const rows = await getCheckins(db, userId, { from, to });
  return c.json(rows.at(-1) ?? null);
});
