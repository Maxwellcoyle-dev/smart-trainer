import { metersToKm } from "@smart-trainer/core";
import {
  useWeeklyMileage,
  useGradePyramid,
  useAdherence,
  useSorenessTrend,
} from "../lib/hooks.ts";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl p-4 space-y-2">
      <p className="text-muted text-xs uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

function MileageCard() {
  const { data, isLoading } = useWeeklyMileage(12);
  if (isLoading) return <Card title="Weekly mileage"><p className="text-muted text-sm">Loading…</p></Card>;
  const rows = data ?? [];
  const latest = rows[rows.length - 1];
  if (!latest) {
    return <Card title="Weekly mileage"><p className="text-muted text-sm">No runs logged yet</p></Card>;
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
  if (isLoading) return <Card title="Grade pyramid"><p className="text-muted text-sm">Loading…</p></Card>;
  const groups = data?.aggregated ?? {};
  const entries = Object.entries(groups).filter(([, rows]) => rows.length > 0);
  if (entries.length === 0) {
    return <Card title="Grade pyramid (last 90 days)"><p className="text-muted text-sm">No climbs logged yet</p></Card>;
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
  if (isLoading) return <Card title="Adherence"><p className="text-muted text-sm">Loading…</p></Card>;
  const latest = data?.[0];
  if (!latest || latest.prescribed === 0) {
    return <Card title="Adherence"><p className="text-muted text-sm">No active plan week yet</p></Card>;
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
  if (isLoading) return <Card title="Soreness"><p className="text-muted text-sm">Loading…</p></Card>;
  const rows = data ?? [];
  // Latest severity per body part
  const latestByPart = new Map<string, { date: string; severity: number }>();
  for (const r of rows) {
    const prev = latestByPart.get(r.body_part);
    if (!prev || r.check_in_date > prev.date) {
      latestByPart.set(r.body_part, { date: r.check_in_date, severity: r.severity });
    }
  }
  const active = [...latestByPart.entries()].filter(([, v]) => v.severity > 0);
  if (active.length === 0) {
    return <Card title="Soreness watch"><p className="text-muted text-sm">Nothing sore — nice.</p></Card>;
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

export function ProgressPage() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold pt-2">Progress</h1>
      <MileageCard />
      <PyramidCard />
      <AdherenceCard />
      <SorenessCard />
    </div>
  );
}
