import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getCurrentPlan,
  getGoals,
  getWeekSkeleton,
  setWeekSkeleton,
  fillWeek,
  adjustSession,
  createPlan,
  createGoal,
  updateGoal,
  deleteGoal,
  SportTypeSchema,
  GoalKindSchema,
  GoalStatusSchema,
} from "@smart-trainer/core";

export const planRouter = new Hono();

const CreatePlanBody = z.object({
  name: z.string().min(1),
  start_date: z.string(),            // YYYY-MM-DD
  n_weeks: z.number().int().min(1).max(52),
  intent: z.string().optional().nullable(),
});

planRouter.post("/create", zValidator("json", CreatePlanBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  return c.json(await createPlan(db, userId, c.req.valid("json")), 201);
});

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

// Expand the active skeleton into prescribed sessions for a plan week.
// In-app default is 'propose' → lands in the approval queue.
const FillWeekBody = z.object({
  plan_week_id: z.string().uuid(),
  mode: z.enum(["propose", "apply"]).optional().default("propose"),
});

planRouter.post("/fill-week", zValidator("json", FillWeekBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const { plan_week_id, mode } = c.req.valid("json");
  return c.json(await fillWeek(db, userId, plan_week_id, mode, "app_coach"));
});

const AdjustSessionBody = z.object({
  prescribed_session_id: z.string().uuid(),
  changes: z.record(z.string(), z.unknown()),
  mode: z.enum(["propose", "apply"]).optional().default("propose"),
  rationale: z.string().optional().nullable(),
});

planRouter.post("/adjust-session", zValidator("json", AdjustSessionBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const { prescribed_session_id, changes, mode, rationale } = c.req.valid("json");
  return c.json(
    await adjustSession(db, userId, prescribed_session_id, changes, mode, "app_coach", rationale ?? null)
  );
});

// ─── Goals ────────────────────────────────────────────────────────────────────

const CreateGoalBody = z.object({
  kind: GoalKindSchema,
  title: z.string().min(1),
  sport: SportTypeSchema.nullable().optional(),
  target_date: z.string().nullable().optional(),
  target: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
  notes: z.string().nullable().optional(),
});

planRouter.post("/goals", zValidator("json", CreateGoalBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  return c.json(await createGoal(db, userId, c.req.valid("json")), 201);
});

const UpdateGoalBody = z.object({
  title: z.string().min(1).optional(),
  sport: SportTypeSchema.nullable().optional(),
  target_date: z.string().nullable().optional(),
  target: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
  status: GoalStatusSchema.optional(),
  notes: z.string().nullable().optional(),
});

planRouter.patch("/goals/:id", zValidator("json", UpdateGoalBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const goalId = c.req.param("id");
  return c.json(await updateGoal(db, userId, goalId, c.req.valid("json")));
});

planRouter.delete("/goals/:id", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const goalId = c.req.param("id");
  return c.json(await deleteGoal(db, userId, goalId));
});
