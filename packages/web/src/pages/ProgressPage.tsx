export function ProgressPage() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold pt-2">Progress</h1>

      <div className="bg-surface rounded-2xl p-4 space-y-2">
        <p className="text-muted text-xs uppercase tracking-wider">Weekly mileage</p>
        <p className="text-3xl font-bold">—</p>
        <p className="text-muted text-sm">No runs logged yet</p>
      </div>

      <div className="bg-surface rounded-2xl p-4 space-y-2">
        <p className="text-muted text-xs uppercase tracking-wider">Grade pyramid (last 90 days)</p>
        <p className="text-muted text-sm">No climbs logged yet</p>
      </div>

      <div className="bg-surface rounded-2xl p-4 space-y-2">
        <p className="text-muted text-xs uppercase tracking-wider">Adherence</p>
        <p className="text-muted text-sm">No plan active yet</p>
      </div>

      <div className="bg-surface rounded-2xl p-4 space-y-2">
        <p className="text-muted text-xs uppercase tracking-wider">Soreness trend</p>
        <p className="text-muted text-sm">No check-ins logged yet</p>
      </div>
    </div>
  );
}
