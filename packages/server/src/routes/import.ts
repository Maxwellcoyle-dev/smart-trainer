/**
 * Activity import (roadmap phase 2): POST /import/file with a multipart
 * FIT/TCX/GPX file → parse → normalize → core ingest (dedupe + session).
 */
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { ingestImportedActivity, ImportedActivitySchema } from "@smart-trainer/core";
import { parseActivityFile, ActivityParseError } from "../parsers/activity-file.js";

export const importRouter = new Hono();

const MAX_FILE_BYTES = 25 * 1024 * 1024;

importRouter.post("/file", async (c) => {
  const db = c.get("supabase");
  const userId = c.get("userId");

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "Attach a .fit, .tcx, or .gpx file in the 'file' field." }, 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return c.json({ error: "File too large (max 25 MB)." }, 413);
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseActivityFile(buf, file.name);
  } catch (e) {
    if (e instanceof ActivityParseError) return c.json({ error: e.message }, 422);
    return c.json({ error: `Couldn't parse ${file.name} — is it a valid activity file?` }, 422);
  }

  const activity = ImportedActivitySchema.parse({
    provider: "file_upload",
    external_id: createHash("sha256").update(buf).digest("hex"),
    sport: parsed.sport,
    occurred_at: parsed.occurred_at,
    duration_s: parsed.duration_s,
    distance_m: parsed.distance_m,
    elevation_gain_m: parsed.elevation_gain_m,
    avg_hr: parsed.avg_hr,
    title: parsed.title,
    raw: { ...parsed.raw, filename: file.name },
  });

  const result = await ingestImportedActivity(db, userId, activity);
  return c.json({ ...result, parsed }, result.status === "imported" ? 201 : 200);
});
