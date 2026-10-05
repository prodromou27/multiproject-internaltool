import { fmtDate } from './Shared';
import { ToneBadge } from './EnterpriseUI';

// How far the report owed for the last complete period has got.
const LABELS = { not_started: 'Not started', draft: 'Draft', in_review: 'In review', approved: 'Approved', final: 'Ready to send', sent: 'Sent' };

export function reportDueTone(due) {
  if (!due || due.status === 'not_yet_due') return 'neutral';
  if (due.status === 'sent') return 'success';
  if (due.overdue) return 'danger';
  return ['not_started', 'draft'].includes(due.status) ? 'warning' : 'info';
}

export function reportDueLabel(due) {
  if (!due) return 'No reporting frequency';
  if (due.status === 'not_yet_due') return `First report: ${due.next?.label || 'next period'}`;
  return `${LABELS[due.status] || due.status}${due.overdue ? ', overdue' : ''}`;
}

/** Badge plus "September 2026 · due 10 Oct 2026", for tables and banners. */
export function ReportDueBadge({ due }) {
  if (!due) return <span className="text-muted text-sm">No reporting frequency</span>;
  return <div className="report-due">
    <ToneBadge tone={reportDueTone(due)}>{reportDueLabel(due)}</ToneBadge>
    {due.status !== 'not_yet_due' && <span className="text-muted text-sm">{due.label} · due {fmtDate(due.due_date)}</span>}
  </div>;
}
