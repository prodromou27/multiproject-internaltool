import React from 'react';
import './EnterpriseUI.css';

export function Surface({ title,description,actions,children,className='',as:Tag='section' }) {
  return <Tag className={`ui-surface${className ? ` ${className}` : ''}`}>
    {(title || description || actions) && <header className="ui-surface-header"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions && <div className="ui-surface-actions">{actions}</div>}</header>}
    {children}
  </Tag>;
}

export function MetricStrip({ items,className='' }) {
  return <div className={`ui-metric-strip${className ? ` ${className}` : ''}`}>{items.map(item => <article key={item.key || item.label} className={`ui-metric${item.tone ? ` is-${item.tone}` : ''}`}>
    <span>{item.label}</span><strong>{item.value ?? 0}</strong>{item.note && <small>{item.note}</small>}
  </article>)}</div>;
}

export function ToneBadge({ tone='neutral',children }) { return <span className={`ui-badge is-${tone}`}><i aria-hidden="true" />{children}</span>; }

export function DataTable({ columns,rows,rowKey='id',loading=false,error='',empty='No records found.',emptyAction,onRetry,caption,rowProps }) {
  if (error) return <div className="ui-async-state is-error" role="alert"><strong>Unable to load this view</strong><span>{error}</span>{onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>}</div>;
  if (loading && !rows.length) return <div className="ui-table-skeleton" aria-label="Loading results"><span /><span /><span /></div>;
  if (!rows.length) return <div className="ui-async-state"><strong>{empty}</strong>{emptyAction}</div>;
  return <div className="ui-table-frame"><table aria-busy={loading}>{caption && <caption className="sr-only">{caption}</caption>}<thead><tr>{columns.map(column => <th key={column.key} className={column.numeric?'is-numeric':''}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={typeof rowKey==='function'?rowKey(row):row[rowKey]} {...(rowProps?.(row) || {})}>{columns.map(column => {
    const className=[column.numeric?'is-numeric':'',typeof column.className==='function'?column.className(row):column.className || ''].filter(Boolean).join(' ');
    return <td key={column.key} data-label={column.label} className={className || undefined}>{column.render?column.render(row):row[column.key] ?? '—'}</td>;
  })}</tr>)}</tbody></table></div>;
}

export function Tabs({ items,value,onChange,label='Sections' }) {
  return <div className="ui-tabs" role="tablist" aria-label={label}>{items.map(item => <button key={item.key} type="button" role="tab" aria-selected={value===item.key} className={value===item.key?'is-active':''} onClick={() => onChange(item.key)}>{item.label}{item.count!==undefined && <span>{item.count}</span>}</button>)}</div>;
}

export function Pagination({ page,total,pageSize,onPageChange,loading=false,label='Result pages',summary }) {
  const pages=Math.max(1,Math.ceil(total/pageSize));
  if (pages===1 && total<=pageSize) return null;
  return <nav className="ui-pagination" aria-label={label}><span>{summary || `${total} total · Page ${page} of ${pages}`}</span><div><button className="btn btn-ghost btn-sm" disabled={loading || page<=1} onClick={() => onPageChange(page-1)}>Previous</button><button className="btn btn-ghost btn-sm" disabled={loading || page>=pages} onClick={() => onPageChange(page+1)}>Next</button></div></nav>;
}

export function Field({ label,help,error,required,children,className='' }) {
  return <label className={`ui-field${error?' has-error':''}${className?` ${className}`:''}`}><span>{label}{required && <b aria-hidden="true"> *</b>}</span>{children}{help && !error && <small>{help}</small>}{error && <small role="alert">{error}</small>}</label>;
}
