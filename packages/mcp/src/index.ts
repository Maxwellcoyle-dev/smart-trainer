#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createSupabaseClient,
  getProfile,
  getGoals,
  getCurrentPlan,
  getWeekSkeleton,
  getSessions,
  getCheckins,
  getInjuryFlags,
  getPendingProposals,
  getAdaptationLog,
  getWeeklyMileage,
  getGradePyramid,
  getSorenessTrend,
  getAdherence,
  setWeekSkeleton,
  createPlan,
  createGoal,
  updateGoal,
  fillWeek,
  adjustSession,
  undoAdaptation,
  logRun,
  logClimbSession,
  logStrength,
  logCheckIn,
  resolveProposal,
  RunSurfaceSchema,
  ClimbStyleSchema,
  ClimbEnvironmentSchema,
  GoalKindSchema,
  GoalStatusSchema,
  SportTypeSchema,
} from "@smart-trainer/core";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const USER_ID = process.env.TRAINER_USER_ID ?? "";

if (!SUPABASE_URL || !SUPABASE_KEY || !USER_ID) {
  console.error("Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TRAINER_USER_ID");
  process.exit(1);
}

const db = createSupabaseClient(SUPABASE_URL, SUPABASE_KEY);

const server = new McpServer({ name: "smart-trainer", version: "0.1.0" });

// ─── Read tools ───────────────────────────────────────────────────────────────

server.tool("get_profile", "Get the athlete profile", {}, async () => {
  const data = await getProfile(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_goals", "Get active training goals", {}, async () => {
  const data = await getGoals(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_current_plan", "Get the active training plan with phases, weeks, and prescribed sessions", {}, async () => {
  const data = await getCurrentPlan(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_week_skeleton", "Get the user-owned weekly training skeleton with slots", {}, async () => {
  const data = await getWeekSkeleton(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool(
  "get_sessions",
  "Get logged training sessions in a date range. Returns sessions with their sport-specific detail (run_details, climbs, strength_sets).",
  {
    from: z.string().describe("ISO datetime, e.g. 2026-06-01T00:00:00Z"),
    to: z.string().describe("ISO datetime, e.g. 2026-06-30T23:59:59Z"),
    sport: z.enum(["run", "climb", "strength", "mobility", "rest"]).optional(),
  },
  async ({ from, to, sport }) => {
    const data = await getSessions(db, USER_ID, { from, to, sport });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_checkins",
  "Get daily check-ins with soreness entries in a date range",
  {
    from: z.string().describe("ISO date, e.g. 2026-06-01"),
    to: z.string().describe("ISO date, e.g. 2026-06-30"),
  },
  async ({ from, to }) => {
    const data = await getCheckins(db, USER_ID, { from, to });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool("get_injury_flags", "Get active injury flags", {}, async () => {
  const data = await getInjuryFlags(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_proposals", "Get pending plan-change proposals", {}, async () => {
  const data = await getPendingProposals(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool(
  "get_adaptation_log",
  "Get the full history of plan changes (what changed, when, by whom)",
  { limit: z.number().int().min(1).max(200).optional().default(50) },
  async ({ limit }) => {
    const data = await getAdaptationLog(db, USER_ID, limit);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_metrics",
  "Get training metrics: weekly mileage, grade pyramid, soreness trend, adherence",
  {
    include: z.array(z.enum(["mileage", "pyramid", "soreness", "adherence"])).optional()
      .default(["mileage", "pyramid", "soreness", "adherence"]),
  },
  async ({ include }) => {
    const results: Record<string, unknown> = {};
    await Promise.all([
      include.includes("mileage") && getWeeklyMileage(db, USER_ID, 8).then(d => { results.weekly_mileage = d; }),
      include.includes("pyramid") && getGradePyramid(db, USER_ID).then(d => { results.grade_pyramid = d; }),
      include.includes("soreness") && getSorenessTrend(db, USER_ID).then(d => { results.soreness_trend = d; }),
      include.includes("adherence") && getAdherence(db, USER_ID).then(d => { results.adherence = d; }),
    ]);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ─── Write tools (propose | apply) ────────────────────────────────────────────

server.tool(
  "set_week_skeleton",
  "Set the user's weekly training skeleton. Desktop MCP default is 'apply' (direct). Use 'propose' to send to the approval queue.",
  {
    slots: z.array(z.object({
      day_of_week: z.number().int().min(0).max(6).describe("0=Mon, 6=Sun"),
      sport: z.enum(["run", "climb", "strength", "mobility", "rest", "cross_train"]),
      order_in_day: z.number().int().optional(),
      hint: z.string().optional().nullable(),
    })),
    name: z.string().optional().default("My Week"),
    mode: z.enum(["apply", "propose"]).optional().default("apply"),
  },
  async ({ slots, name, mode }) => {
    const data = await setWeekSkeleton(db, USER_ID, slots, name, mode, "desktop_mcp");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "log_run",
  "Log a run session. Distances in meters, duration in seconds.",
  {
    occurred_at: z.string().describe("ISO datetime of when the run happened"),
    distance_m: z.number().int().positive().describe("Distance in meters"),
    duration_s: z.number().int().positive().describe("Duration in seconds"),
    surface: RunSurfaceSchema,
    elevation_gain_m: z.number().int().optional().nullable(),
    session_rpe: z.number().int().min(1).max(10).optional().nullable(),
    notes: z.string().optional().nullable(),
    mode: z.enum(["apply", "propose"]).optional().default("apply"),
  },
  async ({ mode, ...payload }) => {
    const data = await logRun(db, USER_ID, payload, mode, "desktop_mcp");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "log_climb_session",
  "Log a climbing session with individual climbs.",
  {
    occurred_at: z.string(),
    duration_s: z.number().int().optional().nullable(),
    session_rpe: z.number().int().min(1).max(10).optional().nullable(),
    notes: z.string().optional().nullable(),
    climbs: z.array(z.object({
      grade_label: z.string().describe("e.g. '5.11a', 'V4', '7a'"),
      style: ClimbStyleSchema,
      environment: ClimbEnvironmentSchema,
      attempts: z.number().int().min(1),
      sends: z.number().int().min(0),
      route_name: z.string().optional().nullable(),
    })),
    mode: z.enum(["apply", "propose"]).optional().default("apply"),
  },
  async ({ mode, ...payload }) => {
    const data = await logClimbSession(db, USER_ID, payload, mode, "desktop_mcp");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "resolve_proposal",
  "Approve or reject a pending plan-change proposal. Approving applies the change and records it in the adaptation log.",
  {
    proposal_id: z.string().uuid(),
    resolution: z.enum(["approved", "rejected"]),
  },
  async ({ proposal_id, resolution }) => {
    const result = await resolveProposal(db, USER_ID, proposal_id, resolution);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_plan",
  "Scaffold a new active training plan: one phase + N empty weekly slots (Mondays from start_date). Gives fill_week a target. Marks any prior active plan completed.",
  {
    name: z.string(),
    start_date: z.string().describe("YYYY-MM-DD, ideally a Monday"),
    n_weeks: z.number().int().min(1).max(52),
    intent: z.string().optional().nullable(),
  },
  async ({ name, start_date, n_weeks, intent }) => {
    const data = await createPlan(db, USER_ID, { name, start_date, n_weeks, intent: intent ?? null }, "desktop_mcp");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "fill_week",
  "Expand the active week skeleton into prescribed sessions for a plan week. Desktop default is 'apply' (direct); use 'propose' to route through the approval queue.",
  {
    plan_week_id: z.string().uuid(),
    mode: z.enum(["apply", "propose"]).optional().default("apply"),
  },
  async ({ plan_week_id, mode }) => {
    const data = await fillWeek(db, USER_ID, plan_week_id, mode, "desktop_mcp");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "adjust_session",
  "Edit a single prescribed session (e.g. scale load, change sport, swap prescription). `changes` is a partial set of prescribed_sessions columns. Desktop default is 'apply'.",
  {
    prescribed_session_id: z.string().uuid(),
    changes: z.record(z.string(), z.unknown()),
    mode: z.enum(["apply", "propose"]).optional().default("apply"),
    rationale: z.string().optional().nullable(),
  },
  async ({ prescribed_session_id, changes, mode, rationale }) => {
    const data = await adjustSession(
      db, USER_ID, prescribed_session_id, changes, mode, "desktop_mcp", rationale ?? null
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_goal",
  "Create a new training goal (event, grade, process, or metric). Direct apply — logged immediately in the adaptation ledger.",
  {
    kind: GoalKindSchema,
    title: z.string().min(1).describe("Short goal title"),
    sport: SportTypeSchema.optional().nullable(),
    target_date: z.string().optional().nullable().describe("YYYY-MM-DD"),
    target: z.record(z.string(), z.unknown()).optional(),
    priority: z.number().int().min(1).optional(),
    notes: z.string().optional().nullable(),
  },
  async ({ kind, title, sport, target_date, target, priority, notes }) => {
    const data = await createGoal(
      db, USER_ID,
      { kind, title, sport: sport ?? null, target_date: target_date ?? null, target, priority, notes: notes ?? null },
      "desktop_mcp"
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_goal",
  "Update an existing training goal. Pass only the fields to change. Set status to 'achieved' or 'abandoned' to close a goal.",
  {
    goal_id: z.string().uuid(),
    title: z.string().min(1).optional(),
    sport: SportTypeSchema.optional().nullable(),
    target_date: z.string().optional().nullable(),
    target: z.record(z.string(), z.unknown()).optional(),
    priority: z.number().int().min(1).optional(),
    status: GoalStatusSchema.optional(),
    notes: z.string().optional().nullable(),
  },
  async ({ goal_id, ...changes }) => {
    const data = await updateGoal(db, USER_ID, goal_id, changes, "desktop_mcp");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "undo_adaptation",
  "Undo a previously applied change by its adaptation_logs id. Applies the inverse and records the undo in the ledger.",
  { log_id: z.string().uuid() },
  async ({ log_id }) => {
    const data = await undoAdaptation(db, USER_ID, log_id);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
