/* The engineers working on a task besides its assignee (the lead): picked from a
   list and shown as removable chips, like a customer's teams. */
export function OtherEngineers({ id = 'task-other-engineers', engineers = [], leadId, value = [], onChange }) {
  const lead = Number(leadId || 0);
  const chosen = value.map(Number).filter(person => person !== lead);
  const nameOf = person => engineers.find(engineer => Number(engineer.id) === person)?.name || `Engineer ${person}`;
  const available = engineers.filter(engineer => Number(engineer.id) !== lead && !chosen.includes(Number(engineer.id)));
  return <div className="form-group">
    <label htmlFor={id}>Also working on it</label>
    <select id={id} value="" onChange={event => { const person = Number(event.target.value); if (person) onChange([...chosen, person]); }} disabled={!available.length}>
      <option value="">{available.length ? (chosen.length ? 'Add another engineer…' : 'Add an engineer…') : 'No other engineers'}</option>
      {available.map(engineer => <option key={engineer.id} value={engineer.id}>{engineer.name}</option>)}
    </select>
    {chosen.length > 0 && <div className="flex gap-6 flex-wrap mt-8">
      {chosen.map(person => <span key={person} className="badge badge-open inline-flex items-center gap-4">
        {nameOf(person)}
        <button type="button" className="task-person-remove" aria-label={`Remove ${nameOf(person)}`} onClick={() => onChange(chosen.filter(other => other !== person))}>×</button>
      </span>)}
    </div>}
  </div>;
}

/** "Maria Ioannou +2" for lists; the full names in the title. */
export function TaskPeople({ task, fallback = 'Unassigned' }) {
  const others = task.engineers || [];
  const lead = task.assigned_to_name || (task.team_name ? `${task.team_name} (team)` : null);
  if (!lead && !others.length) return fallback;
  const everyone = [lead, ...others.map(person => person.name)].filter(Boolean);
  if (!others.length) return lead;
  return <span title={everyone.join(', ')}>{lead || others[0].name}{' '}
    <span className="text-muted text-sm">+{lead ? others.length : others.length - 1}</span></span>;
}
