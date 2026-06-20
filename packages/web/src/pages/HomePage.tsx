import { useNavigate } from "react-router-dom";
import { useSkeleton, useLatestCheckin, useInjuryFlags } from "../lib/hooks.ts";

const SPORT_LABEL: Record<string, string> = {
  run: "🏃 Run",
  climb: "🧗 Climb",
  strength: "💪 Strength",
  mobility: "🧘 Mobility",
  rest: "😴 Rest",
  cross_train: "🚴 Cross-train",
};

export function HomePage() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // 0 = Mon … 6 = Sun (skeleton convention)
  const dow = (new Date().getDay() + 6) % 7;
  const { data: skeleton, isLoading } = useSkeleton();
  const { data: latestCheckin } = useLatestCheckin();
  const { data: injuryFlags } = useInjuryFlags();

  const todaySlots = (skeleton?.skeleton_slots ?? [])
    .filter((s) => s.day_of_week === dow)
    .sort((a, b) => a.order_in_day - b.order_in_day);

  const activeFlags = injuryFlags ?? [];

  return (
    <div className="p-4 space-y-4">
      <div className="pt-2">
        <p className="text-muted text-sm">{today}</p>
        <h1 className="text-2xl font-bold">Today</h1>
      </div>

      {/* Today's planned session(s) from the week skeleton */}
      <div className="bg-surface rounded-2xl p-4 space-y-1">
        <p className="text-muted text-xs uppercase tracking-wider">Today's plan</p>
        {isLoading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : todaySlots.length === 0 ? (
          <>
            <p className="text-lg font-semibold">Rest / open day</p>
            <p className="text-muted text-sm">Set up your week skeleton in Plan</p>
          </>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {todaySlots.map((s) => (
              <span key={s.id} className="px-3 py-1.5 rounded-lg bg-surface2 text-sm font-medium">
                {SPORT_LABEL[s.sport] ?? s.sport}
                {s.hint ? <span className="text-muted"> · {s.hint}</span> : null}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Quick log buttons */}
      <div>
        <p className="text-muted text-xs uppercase tracking-wider mb-2">Quick log</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "🏃 Run", path: "/log?type=run" },
            { label: "🧗 Climb", path: "/log?type=climb" },
            { label: "💪 Strength", path: "/log?type=strength" },
            { label: "✅ Check-in", path: "/log?type=checkin" },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="bg-surface rounded-xl p-4 text-left font-medium active:bg-surface2 transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Readiness card */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-2">Readiness</p>
        {latestCheckin ? (
          <div className="flex items-end gap-2">
            <span className="text-4xl font-bold">{latestCheckin.readiness ?? "–"}</span>
            <span className="text-muted text-lg mb-1">/10</span>
            <span className="text-muted text-xs mb-1.5 ml-auto">
              {new Date(latestCheckin.check_in_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        ) : (
          <p className="text-muted text-sm">Log a check-in to see your readiness score</p>
        )}
      </div>

      {/* Injury flags */}
      {activeFlags.length > 0 && (
        <div className="bg-surface rounded-2xl p-4">
          <p className="text-muted text-xs uppercase tracking-wider mb-2">Active flags</p>
          <div className="flex flex-wrap gap-2">
            {activeFlags.map((flag) => (
              <span
                key={flag.id}
                className={`px-3 py-1.5 rounded-lg bg-surface2 text-sm font-medium ${
                  flag.severity != null && flag.severity >= 4
                    ? "text-danger"
                    : flag.severity != null && flag.severity >= 2
                      ? "text-warning"
                      : ""
                }`}
              >
                {flag.body_part}
                {flag.side && flag.side !== "bilateral" ? ` (${flag.side})` : ""}
                {" · "}
                {flag.status}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
