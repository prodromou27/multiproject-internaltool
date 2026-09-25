
/* ── Engineer multi-picker ───────────────────────────────── */
export default function EngineerPicker({ engineers, selected, onChange }) {
  return (
    <div className="flex flex-wrap gap-6 mt-4">
      {engineers.map(e => {
        const active = selected.includes(e.id);
        return (
          <label key={e.id} className="u-7ed4f50" style={{ background: active ? '#dbeafe' : 'var(--gray-100)', border: active ? '1px solid #93c5fd' : '1px solid transparent' }}>
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
