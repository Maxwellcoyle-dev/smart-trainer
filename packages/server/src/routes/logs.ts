import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  logRun,
  logClimbSession,
  logStrength,
  logCheckIn,
  getClimbPlaces,
  runAdaptation,
  runDailyChecks,
  type RunAdaptationResult,
  RunSurfaceSchema,
  ClimbStyleSchema,
  ClimbEnvironmentSchema,
  ClimbAngleSchema,
  ClimbCharacterSchema,
  ClimbResultSchema,
  BodyPartSchema,
  BodySideSchema,
  type SupabaseClient,
  type AdaptationEvent,
  type InjuryFlag,
} from "@smart-trainer/core";

export const logsRouter = new Hono();

/** Compact summary of what the adaptation hook did, for the client to surface. */
interface AdaptationSummary {
  outcome: "applied" | "proposed" | "skipped";
  action_type: string;
  tier: string;
  notify?: string;
  log_id?: string;
  proposal_id?: string;
}

/**
 * Fire the adaptation hook after a write (design §5: runs after the log).
 * Error-isolated — a hook failure must never fail the log it followed.
 */
async function fireAdaptation(
  db: SupabaseClient,
  userId: string,
  event: AdaptationEvent
): Promise<AdaptationSummary | null> {
  try {
    const r = await runAdaptation(db, userId, event);
    return {
      outcome: r.outcome,
      action_type: r.decision.action_type,
      tier: r.decision.tier,
      notify: r.notify,
      log_id: r.log_id,
      proposal_id: r.proposal?.id,
    };
  } catch {
    return null;
  }
}

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
    // P23 fields
    angle: ClimbAngleSchema.optional().nullable(),
    character_tags: z.array(ClimbCharacterSchema).optional(),
    length_ft: z.number().int().min(1).max(5000).optional().nullable(),
    effort: z.number().int().min(1).max(10).optional().nullable(),
    result: ClimbResultSchema.optional().nullable(),
    climb_notes: z.string().optional().nullable(),
    wall: z.string().optional().nullable(),
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
  const body = c.req.valid("json");
  const result = await logRun(db, userId, body);
  const adaptation = await fireAdaptation(db, userId, {
    type: "session.logged",
    prescribed_session_id: body.prescribed_session_id ?? null,
    logged: { sport: "run", session_rpe: body.session_rpe ?? null },
  });
  return c.json({ ...result, adaptation }, 201);
});

logsRouter.post("/climb", zValidator("json", ClimbBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const body = c.req.valid("json");
  const result = await logClimbSession(db, userId, body);
  const adaptation = await fireAdaptation(db, userId, {
    type: "session.logged",
    prescribed_session_id: body.prescribed_session_id ?? null,
    logged: { sport: "climb", session_rpe: body.session_rpe ?? null },
  });
  return c.json({ ...result, adaptation }, 201);
});

logsRouter.post("/strength", zValidator("json", StrengthBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const body = c.req.valid("json");
  const result = await logStrength(db, userId, body);
  const adaptation = await fireAdaptation(db, userId, {
    type: "session.logged",
    prescribed_session_id: body.prescribed_session_id ?? null,
    logged: { sport: "strength", session_rpe: body.session_rpe ?? null },
  });
  return c.json({ ...result, adaptation }, 201);
});

logsRouter.post("/checkin", zValidator("json", CheckInBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const result = await logCheckIn(db, userId, c.req.valid("json"));
  // Flags newly raised/escalated this check-in drive the adaptation hook.
  const raised: InjuryFlag[] = result.raised_flags ?? [];
  const adaptation =
    raised.length > 0
      ? await fireAdaptation(db, userId, { type: "checkin.submitted", raised_flags: raised })
      : null;
  // G5/P29: the daily check-in is the system's heartbeat (no scheduler in v1).
  // One plan load drives all rollover detectors — missed sessions, week
  // completed, phase ending — each once-per-entity (ai_job_runs dedupe) and
  // error-isolated: a detector failure never fails the check-in.
  let daily: {
    missed: AdaptationSummary[];
    week_completed: AdaptationSummary | null;
    phase_ending: AdaptationSummary | null;
  } = { missed: [], week_completed: null, phase_ending: null };
  try {
    const r = await runDailyChecks(db, userId);
    daily = {
      missed: r.missed.map(summarize),
      week_completed: r.week_completed ? summarize(r.week_completed) : null,
      phase_ending: r.phase_ending ? summarize(r.phase_ending) : null,
    };
  } catch {
    /* isolated */
  }
  return c.json({ ...result, adaptation, daily }, 201);
});

/** Compact an adaptation run for the client. */
function summarize(r: RunAdaptationResult): AdaptationSummary {
  return {
    outcome: r.outcome,
    action_type: r.decision.action_type,
    tier: r.decision.tier,
    notify: r.notify ?? r.decision.rationale,
    log_id: r.log_id,
    proposal_id: r.proposal?.id,
  };
}

logsRouter.get("/climb/places", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const places = await getClimbPlaces(db, userId);
  return c.json(places);
});
