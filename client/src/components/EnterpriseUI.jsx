import { cloneElement, isValidElement, useId } from 'react';
import { sentenceCase } from './Shared';
import './EnterpriseUI.css';

// `label` names a section for assistive technology without a visible header
// (filter toolbars explain themselves).
export function Surface({ title,description,label,actions,children,className='',as:Tag='section' }) {
  return <Tag className={`ui-surface${className ? ` ${className}` : ''}`} aria-label={label}>
    {(title || description || actions) && <header className="ui-surface-header"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions && <div className="ui-surface-actions">{actions}</div>}</header>}
    {children}
  </Tag>;
}

/* One quiet bar of figures. The note explains a figure on hover rather than as
   another line of text; zero recedes so the figures that matter stand out. */
export function MetricStrip({ items,className='' }) {
  return <div className={`ui-metric-strip${className ? ` ${className}` : ''}`}>{items.map(item => <article key={item.key || item.label} title={item.note || undefined} className={`ui-metric${item.tone ? ` is-${item.tone}` : ''}${Number(item.value)===0 ? ' is-zero' : ''}`}>
    <span>{item.label}</span><strong>{item.value ?? 0}</strong>
  </article>)}</div>;
}

// Text badges read in sentence case ("High risk"); anything else is shown as given.
export function ToneBadge({ tone='neutral',children }) { return <span className={`ui-badge is-${tone}`}><i aria-hidden="true" />{typeof children === 'string' ? sentenceCase(children) : children}</span>; }

export function DataTable({ columns,rows,rowKey='id',loading=false,error='',empty='No records found.',emptyAction,onRetry,caption,rowProps }) {
  if (error) return <div className="ui-async-state is-error" role="alert"><strong>Unable to load this view</strong><span>{error}</span>{onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>}</div>;
  if (loading && !rows.length) return <div className="ui-table-skeleton" aria-label="Loading results"><span /><span /><span /></div>;
  if (!rows.length) return <div className="ui-async-state"><strong>{empty}</strong>{emptyAction}</div>;
  return <div className="ui-table-frame"><table aria-busy={loading}>{caption && <caption className="sr-only">{caption}</caption>}<thead><tr>{columns.map(column => <th key={column.key} className={column.numeric?'is-numeric':''}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={typeof rowKey==='function'?rowKey(row):row[rowKey]} {...(rowProps?.(row) || {})}>{columns.map(column => {
    const className=[column.numeric?'is-numeric':'',typeof column.className==='function'?column.className(row):column.className || ''].filter(Boolean).join(' ');
    return <td key={column.key} data-label={typeof column.label === 'string' ? column.label : (column.mobileLabel || '')} className={className || undefined}>{column.render?column.render(row):row[column.key] ?? '—'}</td>;
  })}</tr>)}</tbody></table></div>;
}

// One tab pattern for every tab bar (review I09; W3C APG tabs): the open tab is the
// only one in the Tab order, the arrow keys (and Home/End) move between tabs and open
// them, and each tab names the panel it controls. `variant` keeps a page's look:
// 'ui' (segmented), 'line' (.tabs underline), 'pill' (filter pills), 'button'.
const TAB_LOOK = {
  ui: { list: 'ui-tabs', tab: () => '', active: 'is-active' },
  line: { list: 'tabs', tab: () => 'tab', active: 'active' },
  pill: { list: 'filter-bar', tab: () => 'filter-pill', active: 'active' },
  button: { list: 'tab-buttons', tab: active => `btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`, active: '' },
};
const tabsId = label => `tabs-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export function Tabs({ items,value,onChange,label='Sections',id,variant='ui',className='' }) {
  const base = id || tabsId(label), look = TAB_LOOK[variant] || TAB_LOOK.ui;
  function onKeyDown(event,index) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key==='Home' ? 0 : event.key==='End' ? items.length-1 : (index+(event.key==='ArrowRight' ? 1 : -1)+items.length)%items.length;
    onChange(items[next].key);
    document.getElementById(`${base}-tab-${items[next].key}`)?.focus();
  }
  return <div className={`${look.list}${className ? ` ${className}` : ''}`} role="tablist" aria-label={label}>{items.map((item,index) => {
    const active = value===item.key;
    return <button key={item.key} id={`${base}-tab-${item.key}`} type="button" role="tab" aria-selected={active} aria-controls={`${base}-panel`} tabIndex={active ? 0 : -1}
      className={[look.tab(active), active && look.active].filter(Boolean).join(' ')} onKeyDown={event => onKeyDown(event,index)} onClick={() => onChange(item.key)}>
      {item.icon}{item.label}{item.count!==undefined && <span>{item.count}</span>}
    </button>;
  })}</div>;
}

/** The panel of a Tabs bar: give it the same `label` (or `id`) and the open tab. */
export function TabPanel({ label='Sections',id,value,children,className }) {
  const base = id || tabsId(label);
  return <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${value}`} className={className}>{children}</div>;
}

export function Pagination({ page,total,pageSize,onPageChange,loading=false,label='Result pages',summary }) {
  const pages=Math.max(1,Math.ceil(total/pageSize));
  if (pages===1 && total<=pageSize) return null;
  return <nav className="ui-pagination" aria-label={label}><span>{summary || `${total} total · Page ${page} of ${pages}`}</span><div><button className="btn btn-ghost btn-sm" disabled={loading || page<=1} onClick={() => onPageChange(page-1)}>Previous</button><button className="btn btn-ghost btn-sm" disabled={loading || page>=pages} onClick={() => onPageChange(page+1)}>Next</button></div></nav>;
}

// The input is told about its help or error (aria-describedby, aria-invalid), so a
// screen reader reads the error with the field, not only when it appears.
export function Field({ label,help,error,required,children,className='' }) {
  const id = useId(), noteId = `${id}-note`, note = error || help;
  const control = isValidElement(children) ? cloneElement(children, { 'aria-invalid': error ? true : children.props['aria-invalid'], 'aria-describedby': note ? [children.props['aria-describedby'], noteId].filter(Boolean).join(' ') : children.props['aria-describedby'], 'aria-required': required || children.props['aria-required'] }) : children;
  return <label className={`ui-field${error?' has-error':''}${className?` ${className}`:''}`}><span>{label}{required && <b aria-hidden="true"> *</b>}</span>{control}{help && !error && <small id={noteId}>{help}</small>}{error && <small id={noteId} role="alert">{error}</small>}</label>;
}
