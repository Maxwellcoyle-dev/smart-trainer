import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getPendingProposals, getAdaptationLog, resolveProposal } from "@smart-trainer/core";

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
  await resolveProposal(db, userId, c.req.param("id"), resolution);
  return c.json({ ok: true });
});
