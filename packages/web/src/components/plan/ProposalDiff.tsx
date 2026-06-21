import { useState } from "react";
import type { AdaptationDiff } from "@smart-trainer/core";

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v || "—";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
}

function humanizeEntityType(s: string): string {
  return s
    .split("+")
    .map((part) =>
      part
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    )
    .join(" + ");
}

const OP_BADGE: Record<string, string> = {
  create: "bg-emerald-800 text-emerald-200",
  update: "bg-amber-800 text-amber-200",
  delete: "bg-red-900 text-red-200",
  replace_subtree: "bg-purple-900 text-purple-200",
};

function SingleDiff({ diff }: { diff: AdaptationDiff }) {
  const fieldKeys =
    diff.fields && diff.fields.length > 0
      ? diff.fields
      : Array.from(
          new Set([
            ...Object.keys(diff.before ?? {}),
            ...Object.keys(diff.after ?? {}),
          ])
        );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${OP_BADGE[diff.op] ?? "bg-surface text-muted"}`}
        >
          {diff.op.replace("_", " ")}
        </span>
        <span className="text-xs text-muted">{humanizeEntityType(diff.entity_type)}</span>
      </div>
      {fieldKeys.length > 0 && (
        <div className="space-y-1 pl-1">
          {fieldKeys.map((field) => {
            const before = diff.before?.[field];
            const after = diff.after?.[field];
            return (
              <div key={field} className="text-xs flex flex-wrap gap-x-1 items-baseline">
                <span className="text-muted font-mono">{field}:</span>
                {diff.op === "create" && (
                  <span className="text-emerald-300" title={formatValue(after)}>
                    {formatValue(after)}
                  </span>
                )}
                {diff.op === "delete" && (
                  <span className="text-red-300 line-through" title={formatValue(before)}>
                    {formatValue(before)}
                  </span>
                )}
                {(diff.op === "update" || diff.op === "replace_subtree") && (
                  <>
                    <span className="text-muted line-through" title={formatValue(before)}>
                      {formatValue(before)}
                    </span>
                    <span className="text-muted">→</span>
                    <span title={formatValue(after)}>{formatValue(after)}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Props {
  diff: AdaptationDiff | AdaptationDiff[];
}

export function ProposalDiff({ diff }: Props) {
  const diffs = Array.isArray(diff) ? diff : [diff];
  const [expanded, setExpanded] = useState(false);

  if (diffs.length === 1) {
    return <SingleDiff diff={diffs[0]} />;
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors"
      >
        <span className="font-semibold">{diffs.length} changes</span>
        <span>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="space-y-3 border-l border-border pl-3">
          {diffs.map((d, i) => (
            <SingleDiff key={`${d.entity_id ?? "null"}-${i}`} diff={d} />
          ))}
        </div>
      )}
    </div>
  );
}
