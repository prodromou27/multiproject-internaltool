
/* ── Engineer multi-picker ───────────────────────────────── */
export default function EngineerPicker({ engineers, selected, onChange }) {
  return (
    <div className="flex flex-wrap gap-6 mt-4">
      {engineers.map(e => {
        const active = selected.includes(e.id);
        return (
          <label key={e.id} className={["u-7ed4f50", (active ? 'u-4c55566' : 'u-d994785'), (active ? 'u-8b7de93' : 'u-52e7996')].filter(Boolean).join(' ')}>
            <input type="checkbox" checked={active}
              onChange={() => onChange(active ? selected.filter(x => x !== e.id) : [...selected, e.id])}
              className="u-30e741d" />
            {e.name}
          </label>
        );
      })}
      {engineers.length === 0 && <span className="text-muted text-sm">No engineers available</span>}
    </div>
  );
}
