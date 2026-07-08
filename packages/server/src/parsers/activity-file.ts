/**
 * Activity file parsing: FIT / TCX / GPX → a normalized summary the core
 * ingest action accepts. Summary-level only (no per-second streams yet) —
 * enough to land a session with distance, duration, elevation, and avg HR.
 *
 * TCX/GPX are parsed with targeted string extraction rather than an XML
 * library: both schemas are rigid and this keeps the server dependency-free
 * apart from fit-file-parser (FIT is binary).
 */
export interface ParsedActivity {
  sport: "run" | "climb" | "strength" | "mobility" | "cross_train";
  occurred_at: string; // ISO
  duration_s: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  title: string | null;
  raw: Record<string, unknown>;
}

export class ActivityParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityParseError";
  }
}

// ─── Sport mapping ────────────────────────────────────────────────────────────

function mapSport(s: string | undefined | null): ParsedActivity["sport"] {
  const v = (s ?? "").toLowerCase();
  if (v.includes("run")) return "run";
  if (v.includes("climb") || v.includes("boulder")) return "climb";
  if (v.includes("strength") || v.includes("training")) return "strength";
  if (v.includes("yoga") || v.includes("flexibility")) return "mobility";
  return "cross_train";
}

// ─── FIT ──────────────────────────────────────────────────────────────────────

async function parseFit(buf: Buffer): Promise<ParsedActivity> {
  // Lazy import: keeps TCX/GPX parsing working even if the FIT dependency
  // isn't installed, and defers loading the binary parser until needed.
  // Interop shim: fit-file-parser is Babel-built CJS, so under Node ESM the
  // class lands at .default.default (verified at install time).
  const mod = (await import("fit-file-parser")) as unknown as {
    default: typeof import("fit-file-parser").default | { default: typeof import("fit-file-parser").default };
  };
  const FitParser = typeof mod.default === "function" ? mod.default : mod.default.default;
  const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m" });
  const data = await new Promise<import("fit-file-parser").FitData>((resolve, reject) => {
    parser.parse(buf, (err, d) => (err ? reject(err) : resolve(d)));
  });

  const s = data.sessions?.[0];
  if (!s || !s.start_time) {
    throw new ActivityParseError("FIT file has no session summary.");
  }
  const start = s.start_time instanceof Date ? s.start_time : new Date(s.start_time);
  return {
    sport: mapSport(s.sport),
    occurred_at: start.toISOString(),
    duration_s: s.total_timer_time ? Math.round(s.total_timer_time) : null,
    distance_m: s.total_distance ? Math.round(s.total_distance) : null,
    elevation_gain_m: s.total_ascent != null ? Math.round(s.total_ascent) : null,
    avg_hr: s.avg_heart_rate != null ? Math.round(s.avg_heart_rate) : null,
    title: null,
    raw: {
      format: "fit",
      sport: s.sport ?? null,
      sub_sport: s.sub_sport ?? null,
      total_elapsed_time: s.total_elapsed_time ?? null,
    },
  };
}

// ─── TCX ──────────────────────────────────────────────────────────────────────

function firstMatch(src: string, re: RegExp): string | null {
  const m = src.match(re);
  return m ? m[1] : null;
}

function parseTcx(xml: string): ParsedActivity {
  const sportAttr = firstMatch(xml, /<Activity\s+Sport="([^"]+)"/i);
  const laps = xml.match(/<Lap\b[\s\S]*?<\/Lap>/gi) ?? [];
  if (laps.length === 0) throw new ActivityParseError("TCX file has no laps.");

  let duration = 0;
  let distance = 0;
  const hrs: number[] = [];
  for (const lap of laps) {
    // Lap-level fields precede the <Track> block; ignore trackpoint fields.
    const head = lap.split(/<Track>/i)[0];
    duration += parseFloat(firstMatch(head, /<TotalTimeSeconds>([\d.]+)</i) ?? "0");
    distance += parseFloat(firstMatch(head, /<DistanceMeters>([\d.]+)</i) ?? "0");
    const hr = firstMatch(head, /<AverageHeartRateBpm>\s*<Value>(\d+)</i);
    if (hr) hrs.push(parseInt(hr));
  }

  const startISO =
    firstMatch(xml, /<Lap\s+StartTime="([^"]+)"/i) ?? firstMatch(xml, /<Id>([^<]+)<\/Id>/i);
  if (!startISO) throw new ActivityParseError("TCX file has no start time.");

  return {
    sport: mapSport(sportAttr),
    occurred_at: new Date(startISO).toISOString(),
    duration_s: duration > 0 ? Math.round(duration) : null,
    distance_m: distance > 0 ? Math.round(distance) : null,
    elevation_gain_m: null, // not summarized at lap level in TCX
    avg_hr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    title: null,
    raw: { format: "tcx", sport: sportAttr ?? null, laps: laps.length },
  };
}

// ─── GPX ──────────────────────────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseGpx(xml: string): ParsedActivity {
  const type = firstMatch(xml, /<type>([^<]+)<\/type>/i);
  const name = firstMatch(xml, /<name>([^<]+)<\/name>/i);

  const ptRe = /<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;
  let m: RegExpExecArray | null;
  const pts: { lat: number; lon: number; ele: number | null; time: string | null }[] = [];
  while ((m = ptRe.exec(xml)) !== null) {
    pts.push({
      lat: parseFloat(m[1]),
      lon: parseFloat(m[2]),
      ele: firstMatch(m[3], /<ele>([-\d.]+)</i) ? parseFloat(firstMatch(m[3], /<ele>([-\d.]+)</i)!) : null,
      time: firstMatch(m[3], /<time>([^<]+)</i),
    });
  }
  if (pts.length < 2) throw new ActivityParseError("GPX file has fewer than 2 trackpoints.");

  let distance = 0;
  let gain = 0;
  for (let i = 1; i < pts.length; i++) {
    distance += haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    if (pts[i].ele != null && pts[i - 1].ele != null) {
      const d = pts[i].ele! - pts[i - 1].ele!;
      if (d > 0) gain += d;
    }
  }

  const t0 = pts[0].time;
  const t1 = pts[pts.length - 1].time;
  if (!t0) throw new ActivityParseError("GPX trackpoints have no timestamps.");
  const duration = t1 ? Math.round((new Date(t1).getTime() - new Date(t0).getTime()) / 1000) : null;

  return {
    sport: mapSport(type ?? "run"), // GPX rarely declares a sport; default run
    occurred_at: new Date(t0).toISOString(),
    duration_s: duration && duration > 0 ? duration : null,
    distance_m: distance > 0 ? Math.round(distance) : null,
    elevation_gain_m: gain > 0 ? Math.round(gain) : null,
    avg_hr: null,
    title: name,
    raw: { format: "gpx", type: type ?? null, points: pts.length },
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function parseActivityFile(buf: Buffer, filename: string): Promise<ParsedActivity> {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "fit":
      return parseFit(buf);
    case "tcx":
      return parseTcx(buf.toString("utf-8"));
    case "gpx":
      return parseGpx(buf.toString("utf-8"));
    default:
      throw new ActivityParseError(`Unsupported file type ".${ext}" — use .fit, .tcx, or .gpx.`);
  }
}
