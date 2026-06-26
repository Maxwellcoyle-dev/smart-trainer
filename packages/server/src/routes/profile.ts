import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getProfile, setAvailability, setAutonomy, AvailabilitySchema } from "@smart-trainer/core";

export const profileRouter = new Hono();

profileRouter.get("/", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  return c.json(await getProfile(db, userId));
});

// G1 intake (design §3): set default training availability.
profileRouter.put("/availability", zValidator("json", AvailabilitySchema), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const profile = await setAvailability(db, userId, c.req.valid("json"));
  return c.json(profile);
});

// G4 (design §5.3): set the adaptation autonomy level.
const AutonomyBody = z.object({ autonomy: z.enum(["conservative", "balanced"]) });

profileRouter.put("/autonomy", zValidator("json", AutonomyBody), async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");
  const profile = await setAutonomy(db, userId, c.req.valid("json").autonomy);
  return c.json(profile);
});
