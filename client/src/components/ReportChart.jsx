import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';

/* Report Builder: a chart of a grouped report's preview — bars, horizontal bars,
   a line (for dates) or a pie — of one measure by the grouping fields. The table
   below keeps every row; the chart shows the first 20 groups. */
const COLORS = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)', '#7c6fd6', '#2aa198', '#d97b29', '#8a8f98'];
const TYPES = [['bar', 'Bars'], ['hbar', 'Horizontal bars'], ['line', 'Line'], ['pie', 'Pie']];
const tick = { fontSize: 11, fill: 'var(--gray-500)' };
const tooltip = { contentStyle: { fontSize: 12, borderRadius: 8, border: '1px solid var(--gray-200)' }, cursor: { fill: 'var(--gray-50)' } };
const MAX = 20;

export default function ReportChart({ columns, rows, groupKeys }) {
  const measures = columns.filter(column => column.key.startsWith('metric_'));
  const groups = columns.filter(column => groupKeys.includes(column.key));
  const [type, setType] = useState('bar'), [measure, setMeasure] = useState(measures[0]?.key);
  if (!measures.length || !rows.length) return null;
  const metric = measures.find(m => m.key === measure) || measures[0];
  const data = rows.slice(0, MAX).map(row => ({ name: groups.map(g => row[g.key] ?? '—').join(' · ') || 'All', value: Number(row[metric.key]) || 0 }));
  const height = type === 'hbar' ? Math.max(160, data.length * 28) : 280;
  return <section className="card report-chart" aria-label="Report chart">
    <header className="report-chart-head">
      <h3>{metric.label}{groups.length ? ` by ${groups.map(g => g.label).join(', ')}` : ''}</h3>
      <div className="report-chart-controls">
        {measures.length > 1 && <label>Measure<select value={metric.key} onChange={event => setMeasure(event.target.value)}>{measures.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>}
        <div className="mi-periods" role="group" aria-label="Chart type">{TYPES.map(([value, label]) => <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>)}</div>
      </div>
    </header>
    {rows.length > MAX && <p className="text-muted text-sm">Showing the first {MAX} of {rows.length} groups.</p>}
    <ResponsiveContainer width="100%" height={height}>
      {type === 'pie' ? <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={100} innerRadius={50} isAnimationActive={false} label={({ name, percent }) => `${String(name).slice(0, 18)} ${Math.round(percent * 100)}%`}>
          {data.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
        </Pie><Tooltip {...tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart> : type === 'line' ? <LineChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--gray-100)" /><XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} /><YAxis tick={tick} tickLine={false} axisLine={false} />
        <Tooltip {...tooltip} /><Line dataKey="value" name={metric.label} stroke="var(--primary)" strokeWidth={2} type="monotone" isAnimationActive={false} />
      </LineChart> : type === 'hbar' ? <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 10, bottom: 0 }}>
        <XAxis type="number" tick={tick} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="name" width={160} tick={tick} tickLine={false} axisLine={false} />
        <Tooltip {...tooltip} /><Bar dataKey="value" name={metric.label} fill="var(--primary)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
      </BarChart> : <BarChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--gray-100)" /><XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} interval={0} angle={data.length > 6 ? -25 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} height={data.length > 6 ? 60 : 30} />
        <YAxis tick={tick} tickLine={false} axisLine={false} /><Tooltip {...tooltip} /><Bar dataKey="value" name={metric.label} fill="var(--primary)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>}
    </ResponsiveContainer>
  </section>;
}
