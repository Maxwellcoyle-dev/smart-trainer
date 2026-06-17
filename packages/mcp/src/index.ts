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
  setWeekSkeleton,
  logRun,
  logClimbSession,
  logStrength,
  logCheckin,
  resolveProposal,
} from "@smart-trainer/core";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const USER_ID = process.env.TRAINER_USER_ID ?? "";

if (!SUPABASE_URL || !SUPABASE_KEY || !USER_ID) {
  console.error("Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TRAINER_USER_ID");
  process.exit(1);
}

const db = createSupabaseClient(SUPABASE_URL, SUPABASE_KEY);

const server = new McpServer({
  name: "smart-trainer",
  version: "0.0.0",
});

// ─── Read tools ───────────────────────────────────────────────────────────────

server.tool("get_profile", "Get the athlete profile", {}, async () => {
  const data = await getProfile(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_goals", "Get active training goals", {}, async () => {
  const data = await getGoals(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_current_plan", "Get the active training plan with phases", {}, async () => {
  const data = await getCurrentPlan(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_week_skeleton", "Get the user-owned weekly training skeleton", {}, async () => {
  const data = await getWeekSkeleton(db, USER_ID);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool(
  "get_sessions",
  "Get logged training sessions in a date range",
  {
    from: z.string().describe("ISO date string, e.g. 2026-06-01"),
    to: z.string().describe("ISO date string, e.g. 2026-06-30"),
    sport: z.enum(["run", "climb", "strength"]).optional().describe("Filter by sport"),
  },
  async ({ from, to, sport }) => {
    const data = await getSessions(db, USER_ID, { from, to, sport });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_checkins",
  "Get daily check-ins in a date range",
  {
    from: z.string().describe("ISO date string"),
    to: z.string().describe("ISO date string"),
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
  "Get the history of all plan changes and their source",
  { limit: z.number().int().min(1).max(200).optional().default(50) },
  async ({ limit }) => {
    const data = await getAdaptationLog(db, USER_ID, limit);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Write tools (propose | apply) ────────────────────────────────────────────

server.tool(
  "set_week_skeleton",
  "Set the user's weekly training skeleton. Use mode='propose' to queue for approval, 'apply' to apply directly.",
  {
    slots: z.record(z.string(), z.string().nullable()).describe("day → sport mapping"),
    mode: z.enum(["propose", "apply"]).default("apply"),
  },
  async ({ slots, mode }) => {
    const data = await setWeekSkeleton(db, USER_ID, slots as any, mode, "desktop-mcp");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "log_run",
  "Log a run session",
  {
    distance_km: z.number().positive(),
    duration_seconds: z.number().int().positive(),
    surface: z.enum(["trail", "road", "track", "treadmill"]),
    logged_at: z.string().describe("ISO datetime"),
    rpe: z.number().int().min(1).max(10).optional().nullable(),
    notes: z.string().optional().nullable(),
    mode: z.enum(["propose", "apply"]).default("apply"),
  },
  async ({ mode, ...payload }) => {
    const data = await logRun(db, USER_ID, { prescribed_session_id: null, ...payload, rpe: payload.rpe ?? null, notes: payload.notes ?? null }, mode, "desktop-mcp");
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
    return { content: [{ type: "text", text: `Proposal ${proposal_id} ${resolution}` }] };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
