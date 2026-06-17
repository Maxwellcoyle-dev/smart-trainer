import { useNavigate } from "react-router-dom";

export function HomePage() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="p-4 space-y-4">
      <div className="pt-2">
        <p className="text-muted text-sm">{today}</p>
        <h1 className="text-2xl font-bold">Today</h1>
      </div>

      {/* Today's session placeholder */}
      <div className="bg-surface rounded-2xl p-4 space-y-1">
        <p className="text-muted text-xs uppercase tracking-wider">Today's session</p>
        <p className="text-lg font-semibold">No session prescribed</p>
        <p className="text-muted text-sm">Set up your week skeleton in Plan</p>
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

      {/* Readiness / flags placeholder */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-2">Readiness</p>
        <p className="text-muted text-sm">Log a check-in to see your readiness score</p>
      </div>
    </div>
  );
}
