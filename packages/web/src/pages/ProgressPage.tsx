import { useState } from "react";
import { metersToKm } from "@smart-trainer/core";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  useWeeklyMileage,
  useGradePyramid,
  useAdherence,
  useSorenessTrend,
  useClimbProgression,
  useClimbSendRate,
  useClimbVolume,
  useClimbByAngle,
  useClimbByCharacter,
} from "../lib/hooks.ts";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl p-4 space-y-2">
      <p className="text-muted text-xs uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-muted text-sm">{msg}</p>;
}

// ─── Existing cards ───────────────────────────────────────────────────────────

function MileageCard() {
  const { data, isLoading } = useWeeklyMileage(12);
  if (isLoading) return <Card title="Weekly mileage"><Empty msg="Loading…" /></Card>;
  const rows = data ?? [];
  const latest = rows[rows.length - 1];
  if (!latest) {
    return <Card title="Weekly mileage"><Empty msg="No runs logged yet" /></Card>;
  }
  const ramp = latest.ramp_pct;
  const rampColor = ramp == null ? "text-muted" : ramp > 10 ? "text-warning" : "text-success";
  return (
    <Card title="Weekly mileage (this week)">
      <p className="text-3xl font-bold">{metersToKm(latest.distance_m)} km</p>
      <p className={`text-sm ${rampColor}`}>
        {ramp == null ? "First tracked week" : `${ramp > 0 ? "+" : ""}${ramp}% vs last week`}
        {ramp != null && ramp > 10 && " — watch the ramp"}
      </p>
    </Card>
  );
}

function PyramidCard() {
  const { data, isLoading } = useGradePyramid(3);
  if (isLoading) return <Card title="Grade pyramid"><Empty msg="Loading…" /></Card>;
  const groups = data?.aggregated ?? {};
  const entries = Object.entries(groups).filter(([, rows]) => rows.length > 0);
  if (entries.length === 0) {
    return <Card title="Grade pyramid (last 90 days)"><Empty msg="No climbs logged yet" /></Card>;
  }
  return (
    <Card title="Grade pyramid (last 90 days)">
      <div className="space-y-4">
        {entries.map(([env, rows]) => {
          const maxSends = Math.max(1, ...rows.map((r) => r.sends));
          const sorted = [...rows].sort((a, b) => b.grade_value - a.grade_value);
          return (
            <div key={env} className="space-y-1.5">
              <p className="text-xs text-muted capitalize">{env.replace(":", " · ")}</p>
              {sorted.map((r) => (
                <div key={r.grade_value} className="flex items-center gap-2">
                  <span className="w-12 text-xs font-mono text-right">{r.grade_label}</span>
                  <div className="flex-1 bg-surface2 rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full flex items-center justify-end pr-2"
                      style={{ width: `${Math.max(8, (r.sends / maxSends) * 100)}%` }}
                    >
                      <span className="text-[10px] font-semibold text-white">{r.sends}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AdherenceCard() {
  const { data, isLoading } = useAdherence();
  if (isLoading) return <Card title="Adherence"><Empty msg="Loading…" /></Card>;
  const latest = data?.[0];
  if (!latest || latest.prescribed === 0) {
    return <Card title="Adherence"><Empty msg="No active plan week yet" /></Card>;
  }
  return (
    <Card title="Adherence (latest week)">
      <p className="text-3xl font-bold">{latest.adherence_pct}%</p>
      <p className="text-muted text-sm">
        {latest.completed} of {latest.prescribed} sessions completed
      </p>
    </Card>
  );
}

function SorenessCard() {
  const { data, isLoading } = useSorenessTrend(30);
  if (isLoading) return <Card title="Soreness"><Empty msg="Loading…" /></Card>;
  const rows = data ?? [];
  const latestByPart = new Map<string, { date: string; severity: number }>();
  for (const r of rows) {
    const prev = latestByPart.get(r.body_part);
    if (!prev || r.check_in_date > prev.date) {
      latestByPart.set(r.body_part, { date: r.check_in_date, severity: r.severity });
    }
  }
  const active = [...latestByPart.entries()].filter(([, v]) => v.severity > 0);
  if (active.length === 0) {
    return <Card title="Soreness watch"><Empty msg="Nothing sore — nice." /></Card>;
  }
  const color = (v: number) => (v <= 3 ? "text-warning" : "text-danger");
  return (
    <Card title="Soreness watch (latest)">
      <div className="space-y-1">
        {active
          .sort((a, b) => b[1].severity - a[1].severity)
          .map(([part, v]) => (
            <div key={part} className="flex justify-between text-sm">
              <span className="capitalize">{part}</span>
              <span className={`font-semibold ${color(v.severity)}`}>{v.severity}/10</span>
            </div>
          ))}
      </div>
    </Card>
  );
}

// ─── P24 climb cards ──────────────────────────────────────────────────────────

type Env = "all" | "indoor" | "outdoor";

function GradeProgressionCard() {
  const [env, setEnv] = useState<Env>("all");
  const { data, isLoading } = useClimbProgression(12, env === "all" ? undefined : env);
  if (isLoading) return <Card title="Grade progression"><Empty msg="Loading…" /></Card>;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <Card title="Grade progression"><Empty msg="No climbs logged yet" /></Card>;
  }

  // Group by discipline for multiple lines
  const disciplines = [...new Set(rows.map((r) => r.discipline ?? "unknown"))];
  const byMonth: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const d = r.discipline ?? "unknown";
    if (!byMonth[r.month]) byMonth[r.month] = {};
    byMonth[r.month][d] = Math.max(byMonth[r.month][d] ?? 0, r.max_grade_value);
  }
  const chartData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, vals]) => ({
      month: month.slice(0, 7),
      ...vals,
    }));

  const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444"];

  return (
    <Card title="Grade progression (highest sent per month)">
      <div className="flex gap-1 mb-3">
        {(["all", "indoor", "outdoor"] as Env[]).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEnv(e)}
            className={`flex-1 py-1 rounded-lg text-xs font-medium transition-colors ${
              env === e ? "bg-accent text-white" : "bg-surface2 text-muted"
            }`}
          >
            {e === "all" ? "All" : e === "indoor" ? "Indoor" : "Outdoor"}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #333)" />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} />
          <YAxis tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} />
          <Tooltip
            contentStyle={{ background: "var(--color-surface2, #222)", border: "none", fontSize: 12 }}
            labelStyle={{ color: "var(--color-text, #fff)" }}
          />
          {disciplines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {disciplines.map((d, i) => (
            <Line
              key={d}
              type="monotone"
              dataKey={d}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function SendRateCard() {
  const [env, setEnv] = useState<Env>("all");
  const { data, isLoading } = useClimbSendRate(12, env === "all" ? undefined : env);
  if (isLoading) return <Card title="Send rate"><Empty msg="Loading…" /></Card>;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <Card title="Send rate"><Empty msg="No climbs logged yet" /></Card>;
  }

  const chartData = rows.map((r) => ({
    month: r.month.slice(0, 7),
    "Onsight": r.onsight_count,
    "Flash": r.flash_count,
    "Redpoint": r.redpoint_count,
    "Hung": r.hung_count,
    "DNF": r.dnf_count,
    send_rate: r.send_rate_pct ?? 0,
  }));

  return (
    <Card title="Result mix (per month)">
      <div className="flex gap-1 mb-3">
        {(["all", "indoor", "outdoor"] as Env[]).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEnv(e)}
            className={`flex-1 py-1 rounded-lg text-xs font-medium transition-colors ${
              env === e ? "bg-accent text-white" : "bg-surface2 text-muted"
            }`}
          >
            {e === "all" ? "All" : e === "indoor" ? "Indoor" : "Outdoor"}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #333)" />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} />
          <YAxis tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} />
          <Tooltip
            contentStyle={{ background: "var(--color-surface2, #222)", border: "none", fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Onsight" stackId="r" fill="#22c55e" />
          <Bar dataKey="Flash" stackId="r" fill="#3b82f6" />
          <Bar dataKey="Redpoint" stackId="r" fill="#6366f1" />
          <Bar dataKey="Hung" stackId="r" fill="#f59e0b" />
          <Bar dataKey="DNF" stackId="r" fill="#4b5563" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function VolumeCard() {
  const { data, isLoading } = useClimbVolume(16);
  if (isLoading) return <Card title="Climbing volume"><Empty msg="Loading…" /></Card>;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <Card title="Climbing volume"><Empty msg="No climbs logged yet" /></Card>;
  }

  const chartData = rows.map((r) => ({
    week: r.week_start.slice(5, 10),
    Climbs: r.climbs,
    Attempts: r.total_attempts,
  }));

  return (
    <Card title="Climbing volume (per week)">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #333)" />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} />
          <YAxis tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} />
          <Tooltip
            contentStyle={{ background: "var(--color-surface2, #222)", border: "none", fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Climbs" fill="#6366f1" radius={[2, 2, 0, 0]} />
          <Bar dataKey="Attempts" fill="#a78bfa" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function AngleCharacterCard() {
  const { data: angleData, isLoading: angleLoading } = useClimbByAngle();
  const { data: charData, isLoading: charLoading } = useClimbByCharacter();

  const angleRows = angleData ?? [];
  const charRows = charData ?? [];
  const hasData = angleRows.length > 0 || charRows.length > 0;

  if (angleLoading || charLoading) {
    return <Card title="By angle & character"><Empty msg="Loading…" /></Card>;
  }
  if (!hasData) {
    return <Card title="By angle & character"><Empty msg="Log climbs with angle/character to see breakdown" /></Card>;
  }

  const angleChart = angleRows.map((r) => ({
    name: r.angle,
    "Send rate %": r.send_rate_pct ?? 0,
    Climbs: r.climb_count,
  }));

  const charChart = charRows.map((r) => ({
    name: r.tag,
    "Send rate %": r.send_rate_pct ?? 0,
    Climbs: r.climb_count,
  }));

  return (
    <Card title="What to train (send rate by angle & character)">
      {angleRows.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-muted mb-1">Angle</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={angleChart} layout="vertical" margin={{ top: 0, right: 8, left: 40, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} domain={[0, 100]} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} />
              <Tooltip
                contentStyle={{ background: "var(--color-surface2, #222)", border: "none", fontSize: 12 }}
              />
              <Bar dataKey="Send rate %" fill="#6366f1" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {charRows.length > 0 && (
        <div>
          <p className="text-xs text-muted mb-1">Character</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={charChart} layout="vertical" margin={{ top: 0, right: 8, left: 56, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} domain={[0, 100]} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--color-muted, #888)" }} />
              <Tooltip
                contentStyle={{ background: "var(--color-surface2, #222)", border: "none", fontSize: 12 }}
              />
              <Bar dataKey="Send rate %" fill="#22c55e" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ProgressPage() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold pt-2">Progress</h1>
      <MileageCard />
      <PyramidCard />
      <GradeProgressionCard />
      <SendRateCard />
      <VolumeCard />
      <AngleCharacterCard />
      <AdherenceCard />
      <SorenessCard />
    </div>
  );
}
