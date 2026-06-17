import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  logRun,
  logClimbSession,
  logStrength,
  logCheckin,
  RunLogSchema,
  ClimbSessionSchema,
  StrengthLogSchema,
  CheckInSchema,
} from "@smart-trainer/core";

export const logsRouter = new Hono();

const RunPayload = RunLogSchema.omit({ id: true, user_id: true, pace_per_km: true });
const ClimbPayload = ClimbSessionSchema.omit({ id: true, user_id: true });
const StrengthPayload = StrengthLogSchema.omit({ id: true, user_id: true });
const CheckinPayload = CheckInSchema.omit({ id: true, user_id: true });

logsRouter.post("/run", zValidator("json", RunPayload), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const body = c.req.valid("json");
  const result = await logRun(db, userId, body);
  return c.json(result, 201);
});

logsRouter.post("/climb", zValidator("json", ClimbPayload), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const body = c.req.valid("json");
  const result = await logClimbSession(db, userId, body);
  return c.json(result, 201);
});

logsRouter.post("/strength", zValidator("json", StrengthPayload), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const body = c.req.valid("json");
  const result = await logStrength(db, userId, body);
  return c.json(result, 201);
});

logsRouter.post("/checkin", zValidator("json", CheckinPayload), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const body = c.req.valid("json");
  const result = await logCheckin(db, userId, body);
  return c.json(result, 201);
});
