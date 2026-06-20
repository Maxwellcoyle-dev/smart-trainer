import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getPendingProposals, getAdaptationLog, resolveProposal, undoAdaptation } from "@smart-trainer/core";

export const proposalsRouter = new Hono();

proposalsRouter.get("/", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  return c.json(await getPendingProposals(db, userId));
});

proposalsRouter.get("/history", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  return c.json(await getAdaptationLog(db, userId, limit));
});

const ResolveBody = z.object({
  resolution: z.enum(["approved", "rejected"]),
});

proposalsRouter.post("/:id/resolve", zValidator("json", ResolveBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const { resolution } = c.req.valid("json");
  const result = await resolveProposal(db, userId, c.req.param("id"), resolution);
  return c.json(result);
});

// Undo a previously applied change by its adaptation_logs id.
proposalsRouter.post("/history/:logId/undo", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  return c.json(await undoAdaptation(db, userId, c.req.param("logId")));
});
