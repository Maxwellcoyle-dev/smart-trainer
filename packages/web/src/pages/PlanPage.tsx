import { useState } from "react";
import type { DayOfWeek, SportSlot } from "@smart-trainer/core";

const DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};
const SPORTS: { value: SportSlot | null; label: string; color: string }[] = [
  { value: null, label: "Rest", color: "text-muted" },
  { value: "run", label: "Run", color: "text-blue-400" },
  { value: "climb", label: "Climb", color: "text-green-400" },
  { value: "strength", label: "Strength", color: "text-orange-400" },
];

export function PlanPage() {
  const [skeleton, setSkeleton] = useState<Partial<Record<DayOfWeek, SportSlot | null>>>({});
  const [editing, setEditing] = useState<DayOfWeek | null>(null);

  function pick(day: DayOfWeek, sport: SportSlot | null) {
    setSkeleton((s) => ({ ...s, [day]: sport }));
    setEditing(null);
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold pt-2">Plan</h1>

      {/* Week skeleton editor */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-3">Week skeleton</p>
        <div className="space-y-2">
          {DAYS.map((day) => {
            const sport = skeleton[day] ?? null;
            const sportInfo = SPORTS.find((s) => s.value === sport) ?? SPORTS[0];
            return (
              <div key={day} className="flex items-center justify-between">
                <span className="text-sm w-8 text-muted">{DAY_LABELS[day]}</span>
                <button
                  onClick={() => setEditing(editing === day ? null : day)}
                  className={`flex-1 ml-3 text-left px-3 py-2 rounded-lg bg-surface2 text-sm font-medium ${sportInfo.color}`}
                >
                  {sportInfo.label}
                </button>
              </div>
            );
          })}
        </div>

        {editing && (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {SPORTS.map((s) => (
              <button
                key={String(s.value)}
                onClick={() => pick(editing, s.value)}
                className={`py-2 rounded-lg bg-surface2 text-sm font-medium ${s.color} active:opacity-70`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <button
          className="mt-4 w-full py-3 rounded-xl bg-accent text-white font-semibold active:opacity-80"
          onClick={() => alert("Save skeleton — backend not connected yet")}
        >
          Save skeleton
        </button>
      </div>

      {/* Goals placeholder */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-2">Goals</p>
        <p className="text-muted text-sm">No active goals — connect backend to add goals</p>
      </div>

      {/* Proposals placeholder */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-2">Pending proposals</p>
        <p className="text-muted text-sm">No pending proposals</p>
      </div>
    </div>
  );
}
