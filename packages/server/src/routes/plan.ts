import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getCurrentPlan,
  getGoals,
  getWeekSkeleton,
  setWeekSkeleton,
  SportTypeSchema,
} from "@smart-trainer/core";

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
  return c.json(await getWeekSkeleton(db, userId));
});

const SkeletonBody = z.object({
  name: z.string().optional(),
  slots: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    sport: SportTypeSchema,
    order_in_day: z.number().int().optional(),
    hint: z.string().optional().nullable(),
  })),
});

planRouter.put("/skeleton", zValidator("json", SkeletonBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const { name, slots } = c.req.valid("json");
  const result = await setWeekSkeleton(db, userId, slots, name);
  return c.json(result);
});
