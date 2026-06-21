import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import {
  getProfile,
  getGoals,
  getCurrentPlan,
  getWeekSkeleton,
  getSessions,
  getInjuryFlags,
  getCheckins,
  getWeeklyMileage,
  getGradePyramid,
  getSorenessTrend,
  getAdherence,
  fillWeek,
  adjustSession,
  type SupabaseClient,
} from "@smart-trainer/core";

export const coachRouter = new Hono();

function buildSystemPrompt(context: Record<string, unknown>): string {
  return `You are the smart-trainer coach for a runner and climber. You have full access to the athlete's training data and can act through tools.

Current context (already loaded — don't re-fetch unless you need older data):
${JSON.stringify(context, null, 2)}

Tools:
- get_sessions / get_metrics: pull more or older data than the context above.
- fill_week, adjust_session: PLAN CHANGES. These always run in *propose* mode — they create a proposal the athlete approves in the app; they do NOT change the plan directly. After proposing, tell the athlete what you queued and why.

Be concise, specific, and data-driven. Reference actual numbers from their data. When you propose a change, give a one-line rationale.`;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: "get_sessions",
    description: "Get logged training sessions in a date range (with run/climb/strength detail).",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO datetime, e.g. 2026-05-01T00:00:00Z" },
        to: { type: "string", description: "ISO datetime" },
        sport: { type: "string", enum: ["run", "climb", "strength", "mobility", "rest"] },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_metrics",
    description: "Get computed training metrics: weekly mileage + ramp, grade pyramid, adherence, soreness trend.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "fill_week",
    description:
      "Propose filling a plan week's prescribed sessions from the active week skeleton. Runs in propose mode (approval required).",
    input_schema: {
      type: "object",
      properties: { plan_week_id: { type: "string", description: "uuid of the plan_week to fill" } },
      required: ["plan_week_id"],
    },
  },
  {
    name: "adjust_session",
    description:
      "Propose an edit to a single prescribed session (e.g. scale distance, change sport, swap prescription). Runs in propose mode.",
    input_schema: {
      type: "object",
      properties: {
        prescribed_session_id: { type: "string", description: "uuid of the prescribed_session" },
        changes: {
          type: "object",
          description: "Partial prescribed_sessions columns to change, e.g. { prescription: {...}, status: 'modified' }",
        },
        rationale: { type: "string", description: "One line on why" },
      },
      required: ["prescribed_session_id", "changes"],
    },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────

async function runTool(
  db: SupabaseClient,
  userId: string,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "get_sessions":
      return getSessions(db, userId, {
        from: String(input.from),
        to: String(input.to),
        sport: input.sport ? String(input.sport) : undefined,
      });
    case "get_metrics": {
      const [mileage, pyramid, adherence, soreness] = await Promise.all([
        getWeeklyMileage(db, userId, 8),
        getGradePyramid(db, userId),
        getAdherence(db, userId),
        getSorenessTrend(db, userId),
      ]);
      return { weekly_mileage: mileage, grade_pyramid: pyramid, adherence, soreness_trend: soreness };
    }
    case "fill_week":
      return fillWeek(db, userId, String(input.plan_week_id), "propose", "app_coach");
    case "adjust_session":
      return adjustSession(
        db,
        userId,
        String(input.prescribed_session_id),
        (input.changes ?? {}) as Record<string, unknown>,
        "propose",
        "app_coach",
        input.rationale ? String(input.rationale) : null
      );
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

const MAX_TOOL_TURNS = 5;

coachRouter.post("/chat", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const { messages } = await c.req.json<{ messages: Anthropic.MessageParam[] }>();

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const now = new Date().toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [profile, goals, plan, skeleton, sessions, checkins, flags, mileage] = await Promise.all([
    getProfile(db, userId).catch(() => null),
    getGoals(db, userId),
    getCurrentPlan(db, userId),
    getWeekSkeleton(db, userId),
    getSessions(db, userId, { from: thirtyDaysAgo, to: now }),
    getCheckins(db, userId, { from: thirtyDaysAgo, to: now }),
    getInjuryFlags(db, userId),
    getWeeklyMileage(db, userId, 4),
  ]);

  const context = {
    profile,
    goals,
    plan,
    skeleton,
    recent_sessions: sessions,
    recent_checkins: checkins,
    injury_flags: flags,
    weekly_mileage_last4: mileage,
  };
  const system = buildSystemPrompt(context);

  const convo: Anthropic.MessageParam[] = [...messages];

  // Tool-use loop: let the model read more / propose changes, executing tools
  // server-side and feeding results back until it produces a final answer.
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system,
      tools,
      messages: convo,
    });

    if (response.stop_reason !== "tool_use") {
      return c.json(response);
    }

    convo.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        let result: unknown;
        try {
          result = await runTool(db, userId, block.name, block.input as Record<string, unknown>);
        } catch (e) {
          result = { error: (e as Error).message };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }
    convo.push({ role: "user", content: toolResults });
  }

  // Hit the tool-turn cap: ask once more without tools for a closing answer.
  const final = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system,
    messages: convo,
  });
  return c.json(final);
});
