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
  logRun,
  logClimbSession,
  logStrength,
  logCheckIn,
  resolveProposal,
  RunSurfaceSchema,
  ClimbStyleSchema,
  ClimbEnvironmentSchema,
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
  "Approve or reject a pending plan-change proposal",
  {
    proposal_id: z.string().uuid(),
    resolution: z.enum(["approved", "rejected"]),
  },
  async ({ proposal_id, resolution }) => {
    await resolveProposal(db, USER_ID, proposal_id, resolution);
    return { content: [{ type: "text", text: `Proposal ${proposal_id} ${resolution}.` }] };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
