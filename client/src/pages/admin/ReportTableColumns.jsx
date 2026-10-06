import { ChevronDown,ChevronUp,Plus,RotateCcw,X } from 'lucide-react';

/* Settings → Customer report templates → Table columns. For each table section of
   the template: which columns, in what order, sorting and a row limit. Without a
   choice, Word/PDF and Excel keep their usual columns (Excel shows more). The
   catalogue comes from the server (reportTables.js). */
function TableChoice({ table,choice,onChange }) {
  const labelOf=key => table.columns.find(column => column.key===key)?.label || key;
  if (!choice) return <div className="rtc-usual">
    <p className="text-muted text-sm">Usual columns: {table.columns.filter(column => column.default_document).map(column => column.label).join(', ')}. Excel adds {table.columns.filter(column => column.default_spreadsheet && !column.default_document).map(column => column.label).join(', ') || 'nothing'}.</p>
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ columns:table.columns.filter(column => column.default_document).map(column => column.key) })}>Choose columns</button>
  </div>;
  const set=patch => onChange({ ...choice,...patch });
  const move=(index,direction) => { const columns=[...choice.columns],target=index+direction;[columns[index],columns[target]]=[columns[target],columns[index]];set({ columns }); };
  const unused=table.columns.filter(column => !choice.columns.includes(column.key));
  return <div className="rtc-choice">
    <ol className="rtc-columns">{choice.columns.map((key,index) => <li key={key}>
      <span>{labelOf(key)}</span>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${labelOf(key)} earlier`} disabled={!index} onClick={() => move(index,-1)}><ChevronUp size={12} /></button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${labelOf(key)} later`} disabled={index===choice.columns.length-1} onClick={() => move(index,1)}><ChevronDown size={12} /></button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${labelOf(key)}`} disabled={choice.columns.length===1} onClick={() => set({ columns:choice.columns.filter(column => column!==key),...(choice.sort?.column===key ? { sort:undefined } : {}) })}><X size={12} /></button>
    </li>)}</ol>
    {unused.length > 0 && <div className="rtc-add">{unused.map(column => <button type="button" key={column.key} className="btn btn-ghost btn-sm" onClick={() => set({ columns:[...choice.columns,column.key] })}><Plus size={11} /> {column.label}</button>)}</div>}
    <div className="rtc-options">
      <label><span>Sort by</span><select value={choice.sort?.column || ''} onChange={event => set({ sort:event.target.value ? { column:event.target.value,direction:choice.sort?.direction || 'asc' } : undefined })}>
        <option value="">As collected</option>{table.columns.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label>
      {choice.sort?.column && <label><span>Order</span><select value={choice.sort.direction} onChange={event => set({ sort:{ ...choice.sort,direction:event.target.value } })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>}
      <label><span>Show at most</span><input type="number" min={1} max={5000} placeholder="All rows" value={choice.limit ?? ''} onChange={event => set({ limit:event.target.value ? Number(event.target.value) : undefined })} /></label>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}><RotateCcw size={12} /> Usual columns</button>
    </div>
    <p className="text-muted text-sm">These columns are used in Word, PDF and Excel. An uploaded Word layout keeps its own columns but follows the sorting and row limit.</p>
  </div>;
}

export function ReportTableColumns({ catalogue,sections,tables,onChange }) {
  const shown=sections.map(key => catalogue.find(table => table.key===key)).filter(Boolean);
  if (!shown.length) return null;
  const update=(key,choice) => { const next={ ...tables };if (choice) next[key]=choice;else delete next[key];onChange(next); };
  return <section className="rtc" aria-labelledby="rtc-title">
    <h3 id="rtc-title" className="u-999b629">Table columns</h3>
    {shown.map(table => <details key={table.key} className="rtc-table" open={!!tables[table.key]}>
      <summary>{table.title}{tables[table.key] ? <small> · {tables[table.key].columns.length} columns{tables[table.key].sort ? ', sorted' : ''}{tables[table.key].limit ? `, first ${tables[table.key].limit}` : ''}</small> : <small> · usual columns</small>}</summary>
      <TableChoice table={table} choice={tables[table.key]} onChange={choice => update(table.key,choice)} />
    </details>)}
  </section>;
}
