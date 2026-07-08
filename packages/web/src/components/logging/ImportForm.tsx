import { useRef, useState } from "react";
import { useImportFile, type ImportFileResult } from "../../lib/hooks.ts";

function fmtDuration(s: number | null): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function ResultCard({ r }: { r: ImportFileResult }) {
  const p = r.parsed;
  const date = new Date(p.occurred_at).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return (
    <div
      className={`rounded-xl p-3 space-y-1 ${
        r.status === "imported" ? "bg-success/10 border border-success/40" : "bg-surface2"
      }`}
    >
      <p className="text-sm font-semibold">
        {r.status === "imported" ? "✓ Imported" : "Already logged"}
        <span className="font-normal text-muted"> — {p.sport} · {date}</span>
      </p>
      <p className="text-sm text-muted">
        {p.distance_m ? `${(p.distance_m / 1000).toFixed(2)} km · ` : ""}
        {fmtDuration(p.duration_s)}
        {p.elevation_gain_m ? ` · ${p.elevation_gain_m} m↑` : ""}
        {p.avg_hr ? ` · ${p.avg_hr} bpm avg` : ""}
      </p>
      {r.status === "duplicate" && (
        <p className="text-xs text-muted">
          {r.duplicate_of === "external_id"
            ? "This exact file was imported before."
            : "A session of the same sport already exists around this time."}
        </p>
      )}
    </div>
  );
}

export function ImportForm() {
  const importFile = useImportFile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<ImportFileResult[]>([]);

  function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    importFile.mutate(file, {
      onSuccess: (r) => setResults((rs) => [r, ...rs]),
      onSettled: () => {
        if (inputRef.current) inputRef.current.value = "";
      },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-muted text-sm">
        Import a workout recorded on your watch. Export the activity as a FIT, TCX,
        or GPX file (Garmin Connect → activity → ⚙ → Export), then upload it here.
        Duplicates are detected automatically.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".fit,.tcx,.gpx"
        className="hidden"
        onChange={(e) => onPick(e.target.files)}
      />
      <button
        type="button"
        disabled={importFile.isPending}
        onClick={() => inputRef.current?.click()}
        className="w-full py-8 rounded-2xl border-2 border-dashed border-border text-muted text-sm font-medium disabled:opacity-50 active:opacity-80"
      >
        {importFile.isPending ? "Importing…" : "📂 Choose a .fit / .tcx / .gpx file"}
      </button>

      {importFile.isError && (
        <p className="text-danger text-sm text-center">
          {(importFile.error as Error).message}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <ResultCard key={i} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
