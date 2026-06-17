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
} from "@smart-trainer/core";

export const coachRouter = new Hono();

function buildSystemPrompt(context: Record<string, unknown>): string {
  return `You are the smart-trainer coach. You have full access to the athlete's training data.

Current context:
${JSON.stringify(context, null, 2)}

You can read training data and propose plan changes. All plan writes go through the proposal queue (mode: propose).
Be concise, specific, and training-focused. Reference actual numbers from their data.`;
}

coachRouter.post("/chat", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const { messages } = await c.req.json<{ messages: Anthropic.MessageParam[] }>();

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build context for Claude
  const now = new Date().toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [profile, goals, plan, skeleton, sessions, checkins, flags] = await Promise.all([
    getProfile(db, userId).catch(() => null),
    getGoals(db, userId),
    getCurrentPlan(db, userId),
    getWeekSkeleton(db, userId),
    getSessions(db, userId, { from: thirtyDaysAgo, to: now }),
    getCheckins(db, userId, { from: thirtyDaysAgo, to: now }),
    getInjuryFlags(db, userId),
  ]);

  const context = { profile, goals, plan, skeleton, recent_sessions: sessions, recent_checkins: checkins, injury_flags: flags };

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: buildSystemPrompt(context),
    messages,
  });

  return c.json(response);
});
