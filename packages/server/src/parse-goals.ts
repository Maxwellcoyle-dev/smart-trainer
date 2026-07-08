/**
 * Natural-language goal intake (roadmap phase 1).
 *
 * Free text ("send V6 by fall, lose 10 lb, keep running 3×/week") → structured
 * goal drafts constrained to supported sports and the GoalTarget metric set.
 * Drafts are returned to the client for review/edit — nothing is saved here.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  GoalKindSchema,
  SportTypeSchema,
  GoalMetricSchema,
} from "@smart-trainer/core";

const MODEL = "claude-sonnet-4-6";

export const GoalDraftSchema = z.object({
  kind: GoalKindSchema,
  title: z.string().min(1),
  sport: SportTypeSchema.nullable(),
  target_date: z.string().nullable(), // YYYY-MM-DD
  priority: z.number().int().min(1).max(5),
  target: z
    .object({
      metric: GoalMetricSchema,
      value: z.union([z.number(), z.string()]),
      unit: z.string().optional(),
      baseline: z.union([z.number(), z.string()]).optional(),
      by_date: z.string().optional(),
    })
    .nullable(),
  notes: z.string().nullable(),
});
export type GoalDraft = z.infer<typeof GoalDraftSchema>;

export const ParseGoalsResultSchema = z.object({
  drafts: z.array(GoalDraftSchema),
  /** Anything in the input that couldn't be mapped to a supported goal. */
  unmapped: z.array(z.string()),
});
export type ParseGoalsResult = z.infer<typeof ParseGoalsResultSchema>;

const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_goal_drafts",
  description: "Submit the structured goal drafts parsed from the athlete's text.",
  input_schema: {
    type: "object",
    properties: {
      drafts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["event", "grade", "process", "metric"] },
            title: { type: "string", description: "Short, specific restatement of the goal" },
            sport: {
              type: ["string", "null"],
              enum: ["run", "climb", "strength", "mobility", "cross_train", null],
            },
            target_date: {
              type: ["string", "null"],
              description: "YYYY-MM-DD if the athlete gave or implied a deadline, else null",
            },
            priority: { type: "integer", minimum: 1, maximum: 5, description: "1 = most important" },
            target: {
              type: ["object", "null"],
              properties: {
                metric: {
                  type: "string",
                  enum: [
                    "distance", "grade", "pace", "duration", "adherence",
                    "bodyweight", "strength_load", "frequency", "custom",
                  ],
                },
                value: { type: ["number", "string"] },
                unit: { type: "string" },
                baseline: { type: ["number", "string"] },
                by_date: { type: "string" },
              },
              required: ["metric", "value"],
            },
            notes: { type: ["string", "null"] },
          },
          required: ["kind", "title", "sport", "target_date", "priority", "target", "notes"],
        },
      },
      unmapped: {
        type: "array",
        items: { type: "string" },
        description: "Parts of the input that can't map to a supported goal (e.g. unsupported sports)",
      },
    },
    required: ["drafts", "unmapped"],
  },
};

function buildSystem(today: string): string {
  return `You turn an athlete's free-text goals into structured training-goal drafts for a coaching app.

Today is ${today}.

Rules:
- Supported sports: run, climb, strength, mobility, cross_train. Map "lifting"/"weights"/"gym" to strength. Map hiking/cycling/swimming etc. to cross_train with a note. Goals with no single sport (e.g. weight loss) get sport=null.
- kind: "event" = a dated race/trip/competition; "grade" = climbing grade target; "metric" = a measurable target (weight, lift load, pace, distance, frequency); "process" = habit/consistency goals ("run 3×/week" → process with target.metric="frequency").
- metric choices: distance (m), grade (climbing grade string), pace (s/km), duration (s), adherence (%), bodyweight (kg or lb — keep athlete's unit), strength_load (kg or lb), frequency (sessions/week), custom.
- Resolve vague deadlines to concrete dates: "by fall" → ${today.slice(0, 4)}-10-01, "end of year" → ${today.slice(0, 4)}-12-31, "in 3 months" → today + 3 months. No deadline stated → target_date=null.
- Include baseline in target when the athlete states a current value ("I'm 82 kg, want 75" → baseline 82, value 75).
- priority: 1 for the goal that seems most important to them (dated events usually), 2-3 for the rest. Split compound sentences into separate goals.
- Anything unsupported or ambiguous beyond repair goes in "unmapped" verbatim.
- Always call submit_goal_drafts exactly once.`;
}

export class ParseGoalsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ParseGoalsError";
  }
}

export async function parseGoals(text: string, today: string): Promise<ParseGoalsResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ParseGoalsError(501, "Goal parsing is not available on this server (no AI key configured).");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: buildSystem(today),
    tools: [SUBMIT_TOOL],
    tool_choice: { type: "tool", name: "submit_goal_drafts" },
    messages: [{ role: "user", content: text }],
  });

  const toolUse = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_goal_drafts"
  );
  if (!toolUse) {
    throw new ParseGoalsError(502, "The AI did not return structured goals. Try rephrasing.");
  }

  const parsed = ParseGoalsResultSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new ParseGoalsError(502, "The AI returned goals in an unexpected shape. Try again.");
  }
  if (parsed.data.drafts.length === 0 && parsed.data.unmapped.length === 0) {
    throw new ParseGoalsError(422, "Couldn't find any goals in that text. Try being more specific.");
  }
  return parsed.data;
}
