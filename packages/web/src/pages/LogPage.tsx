import { useSearchParams } from "react-router-dom";
import { RunLogForm } from "../components/logging/RunLogForm.tsx";
import { ClimbLogForm } from "../components/logging/ClimbLogForm.tsx";
import { StrengthLogForm } from "../components/logging/StrengthLogForm.tsx";
import { CheckInForm } from "../components/logging/CheckInForm.tsx";
import { ImportForm } from "../components/logging/ImportForm.tsx";

type LogType = "run" | "climb" | "strength" | "checkin" | "import";

const TABS: { type: LogType; label: string }[] = [
  { type: "run", label: "🏃 Run" },
  { type: "climb", label: "🧗 Climb" },
  { type: "strength", label: "💪 Strength" },
  { type: "checkin", label: "✅ Check-in" },
  { type: "import", label: "⌚ Import" },
];

export function LogPage() {
  const [params, setParams] = useSearchParams();
  const type = (params.get("type") ?? "run") as LogType;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex bg-surface border-b border-border sticky top-0 z-10">
        {TABS.map((tab) => (
          <button
            key={tab.type}
            onClick={() => setParams({ type: tab.type })}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              type === tab.type
                ? "text-accent border-b-2 border-accent"
                : "text-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {type === "run" && <RunLogForm />}
        {type === "climb" && <ClimbLogForm />}
        {type === "strength" && <StrengthLogForm />}
        {type === "checkin" && <CheckInForm />}
        {type === "import" && <ImportForm />}
      </div>
    </div>
  );
}
