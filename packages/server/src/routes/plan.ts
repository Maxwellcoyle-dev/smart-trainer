import { Hono } from "hono";
import {
  getCurrentPlan,
  getGoals,
  getWeekSkeleton,
  setWeekSkeleton,
} from "@smart-trainer/core";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { DayOfWeekSchema, SportSlotSchema } from "@smart-trainer/core";

export const planRouter = new Hono();

planRouter.get("/current", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const [plan, goals] = await Promise.all([
    getCurrentPlan(db, userId),
    getGoals(db, userId),
  ]);
  return c.json({ plan, goals });
});

planRouter.get("/skeleton", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const skeleton = await getWeekSkeleton(db, userId);
  return c.json(skeleton);
});

const SkeletonBody = z.object({
  slots: z.record(DayOfWeekSchema, SportSlotSchema.nullable()),
});

planRouter.put("/skeleton", zValidator("json", SkeletonBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const { slots } = c.req.valid("json");
  const result = await setWeekSkeleton(db, userId, slots);
  return c.json(result);
});
