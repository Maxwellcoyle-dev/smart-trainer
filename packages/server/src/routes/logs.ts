import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  logRun,
  logClimbSession,
  logStrength,
  logCheckIn,
  RunSurfaceSchema,
  ClimbStyleSchema,
  ClimbEnvironmentSchema,
  BodyPartSchema,
  BodySideSchema,
} from "@smart-trainer/core";

export const logsRouter = new Hono();

const RunBody = z.object({
  occurred_at: z.string(),
  duration_s: z.number().int().positive(),
  distance_m: z.number().int().positive(),
  surface: RunSurfaceSchema,
  elevation_gain_m: z.number().int().optional().nullable(),
  session_rpe: z.number().int().min(1).max(10).optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  prescribed_session_id: z.string().uuid().optional().nullable(),
});

const ClimbBody = z.object({
  occurred_at: z.string(),
  duration_s: z.number().int().optional().nullable(),
  session_rpe: z.number().int().min(1).max(10).optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  prescribed_session_id: z.string().uuid().optional().nullable(),
  climbs: z.array(z.object({
    grade_label: z.string(),
    grade_value: z.number().int().optional().nullable(),
    grade_id: z.string().uuid().optional().nullable(),
    style: ClimbStyleSchema,
    environment: ClimbEnvironmentSchema,
    attempts: z.number().int().min(1),
    sends: z.number().int().min(0),
    route_name: z.string().optional().nullable(),
    crag: z.string().optional().nullable(),
    order_in_session: z.number().int().optional(),
  })),
});

const StrengthBody = z.object({
  occurred_at: z.string(),
  duration_s: z.number().int().optional().nullable(),
  session_rpe: z.number().int().min(1).max(10).optional().nullable(),
  notes: z.string().optional().nullable(),
  prescribed_session_id: z.string().uuid().optional().nullable(),
  sets: z.array(z.object({
    exercise_id: z.string().uuid().optional().nullable(),
    exercise_name: z.string(),
    set_index: z.number().int(),
    reps: z.number().int().optional().nullable(),
    weight_kg: z.number().optional().nullable(),
    rpe: z.number().int().min(1).max(10).optional().nullable(),
  })),
});

const CheckInBody = z.object({
  check_in_date: z.string(),
  sleep_hours: z.number().optional().nullable(),
  sleep_quality: z.number().int().min(1).max(5).optional().nullable(),
  bodyweight_kg: z.number().optional().nullable(),
  mood: z.number().int().min(1).max(5).optional().nullable(),
  readiness: z.number().int().min(1).max(10).optional().nullable(),
  notes: z.string().optional().nullable(),
  soreness: z.array(z.object({
    body_part: BodyPartSchema,
    side: BodySideSchema.optional(),
    severity: z.number().int().min(0).max(10),
  })),
});

logsRouter.post("/run", zValidator("json", RunBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const result = await logRun(db, userId, c.req.valid("json"));
  return c.json(result, 201);
});

logsRouter.post("/climb", zValidator("json", ClimbBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const result = await logClimbSession(db, userId, c.req.valid("json"));
  return c.json(result, 201);
});

logsRouter.post("/strength", zValidator("json", StrengthBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const result = await logStrength(db, userId, c.req.valid("json"));
  return c.json(result, 201);
});

logsRouter.post("/checkin", zValidator("json", CheckInBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const result = await logCheckIn(db, userId, c.req.valid("json"));
  return c.json(result, 201);
});
