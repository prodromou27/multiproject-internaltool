import { useRef, useState } from 'react';

/* Edit versions (review I04). An edit form sends the version of the record it opened;
   if someone else saved in the meantime the server answers EDIT_CONFLICT with the
   record as it is now. The form keeps what was typed and shows <EditConflict>, which
   lists what the other person changed and lets this person keep their own changes
   (save again over the newer version) or take the other person's values. */
export function useEditVersion(initial) {
  const opened = useRef(initial || null);
  const version = useRef(initial?.edit_version ?? null);
  const [current, setCurrent] = useState(null);
  return {
    /** For a form that stays mounted: the record it now edits. */
    start(record) { opened.current = record; version.current = record?.edit_version ?? null; setCurrent(null); },
    /** The record as it was when the form opened. */
    get opened() { return opened.current; },
    /** The version to send with a save (undefined for a new record). */
    get version() { return opened.current?.id ? version.current ?? undefined : undefined; },
    conflict: current,
    /** True when err was an edit conflict; the panel then shows it. */
    caught(err) {
      if (err?.code !== 'EDIT_CONFLICT' || !err.current) return false;
      setCurrent(err.current);
      return true;
    },
    /** Save over the newer version: the next save is made against it. */
    keepMine() { version.current = current.edit_version; setCurrent(null); },
    /** Take the newer record: returns it so the form can load its values. */
    takeTheirs() { const theirs = current; version.current = theirs.edit_version; setCurrent(null); return theirs; },
  };
}

const shown = value => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return String(value);
};
const same = (a, b) => shown(a) === shown(b);

/** What the other person changed among `fields` ([[key, label, format?]]). */
export function changedFields(fields, opened, current, mine) {
  return fields
    .filter(([key]) => !same(opened?.[key], current?.[key]))
    .map(([key, label, format = shown]) => ({ key, label, theirs: format(current?.[key]), mine: format(mine?.[key]) }));
}

export const yesNo = value => (value ? 'Yes' : 'No');

export function EditConflict({ edit, what, fields, mine, onKeepMine, onUseTheirs }) {
  if (!edit.conflict) return null;
  const changes = changedFields(fields, edit.opened, edit.conflict, mine);
  return (
    <div className="alert alert-warning edit-conflict" role="alert" style={{ flexDirection: 'column' }}>
      <strong>Someone else saved this {what} after you opened it.</strong>
      {changes.length ? (
        <table style={{ width: '100%', margin: '8px 0', fontSize: 13 }}>
          <thead><tr><th align="left">Field</th><th align="left">Now saved</th><th align="left">Yours</th></tr></thead>
          <tbody>{changes.map(change => (
            <tr key={change.key}><td>{change.label}</td><td>{change.theirs}</td><td>{change.mine}</td></tr>
          ))}</tbody>
        </table>
      ) : <p style={{ margin: '6px 0' }}>Their changes were to details not shown in this form.</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={onKeepMine}>Keep my changes</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onUseTheirs}>Use theirs</button>
      </div>
    </div>
  );
}
