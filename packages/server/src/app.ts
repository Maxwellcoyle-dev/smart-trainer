import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { logsRouter } from "./routes/logs.js";
import { metricsRouter } from "./routes/metrics.js";
import { planRouter } from "./routes/plan.js";
import { coachRouter } from "./routes/coach.js";
import { proposalsRouter } from "./routes/proposals.js";
import { wellnessRouter } from "./routes/wellness.js";
import { profileRouter } from "./routes/profile.js";
import { importRouter } from "./routes/import.js";
import { getSupabase } from "./middleware/supabase.js";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: process.env.ALLOWED_ORIGIN ?? "*" }));
app.use("*", getSupabase);

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }));

app.route("/logs", logsRouter);
app.route("/metrics", metricsRouter);
app.route("/plan", planRouter);
app.route("/coach", coachRouter);
app.route("/proposals", proposalsRouter);
app.route("/wellness", wellnessRouter);
app.route("/profile", profileRouter);
app.route("/import", importRouter);

export default app;
