import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { PageHeader } from '../components/PageLayout';
import { Modal, PriorityBadge, fmtDate, fmtDateTime } from '../components/Shared';
import { useToast } from '../components/Toast';

function ReviewDialog({ project, onClose, onReviewed }) {
  const toast = useToast();
  const [decision, setDecision] = useState('approved');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (saving || conflict) return;
    setSaving(true); setError('');
    try {
      const review = { comment, request_version: project.closure_request_version };
      if (decision === 'approved') await api.approveClosure(project.id, review);
      else await api.rejectClosure(project.id, review);
      toast.success(decision === 'approved' ? 'Project closed' : 'Project returned for revision');
      onReviewed();
    } catch (failure) {
      setError(failure.message || 'Unable to save this decision');
      setConflict(failure.status === 409);
    } finally { setSaving(false); }
  }
  return <Modal title="Review Project Closure" onClose={saving ? () => {} : onClose}>
    <form onSubmit={submit}>
      <p className="approval-review-title">{project.title}</p>
      <p className="text-muted text-sm">Review the project's work and documents before deciding. Your decision is recorded and the assigned team is notified.</p>
      <Link className="approval-project-link" to={`/projects/${project.id}`}>Open project details</Link>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <div className="form-group"><label htmlFor="closure-decision">Decision</label>
        <select id="closure-decision" value={decision} onChange={event => setDecision(event.target.value)} disabled={saving || conflict}>
          <option value="approved">Approve and close</option><option value="rejected">Return for revision</option>
        </select>
      </div>
      <div className="form-group"><label htmlFor="closure-comment">{decision === 'rejected' ? 'Revision instructions *' : 'Review comment (optional)'}</label>
        <textarea id="closure-comment" rows={4} maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} required={decision === 'rejected'} disabled={saving} />
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>Cancel</button>
        {conflict ? <button type="button" className="btn btn-primary" onClick={onReviewed}>Reload backlog</button>
          : <button type="submit" className="btn btn-primary" disabled={saving || (decision === 'rejected' && !comment.trim())}>{saving ? 'Saving...' : decision === 'approved' ? 'Approve closure' : 'Return for revision'}</button>}
      </div>
    </form>
  </Modal>;
}

export default function Approvals() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const pageSize = 25;
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.closureApprovals({ page, page_size: pageSize }, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setRows(data.rows); setTotal(data.total);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message || 'Unable to load approvals'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, refresh]);
  return <div className="page">
    <PageHeader eyebrow="Management" title="Approvals" description="Review outstanding project closure requests. The oldest requests appear first."
      actions={<button className="btn btn-ghost" disabled={loading} onClick={reload}><RefreshCw size={15} /> Refresh</button>} />
    {error && <div className="error-msg" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={reload}>Retry</button></div>}
    <section className="card" aria-label="Project closure backlog" aria-busy={loading}>
      <div className="approval-backlog-heading"><CheckCheck size={20} aria-hidden="true" /><h2>Project closure</h2><span>{error ? 'Unavailable' : loading ? 'Loading...' : `${total} awaiting review`}</span></div>
      {!loading && !error && !rows.length && <p className="approval-empty">No project closure requests are waiting for review.</p>}
      {!loading && !error && rows.length > 0 && <>
        <div className="table-wrap"><table>
          <caption className="sr-only">Projects awaiting management closure approval</caption>
          <thead><tr><th scope="col">Project</th><th scope="col">Customer</th><th scope="col">Priority</th><th scope="col">Requested by</th><th scope="col">Requested</th><th scope="col">Deadline</th><th scope="col">Action</th></tr></thead>
          <tbody>{rows.map(project => <tr key={project.id}>
            <td><Link to={`/projects/${project.id}`}>{project.title}</Link></td><td>{project.customer_name || 'Internal'}</td>
            <td><PriorityBadge p={project.priority} /></td><td>{project.requested_by_name || 'Not recorded'}</td>
            <td>{fmtDateTime(project.closure_requested_at)}</td><td>{fmtDate(project.deadline)}</td>
            <td><button className="btn btn-primary btn-sm" onClick={() => setReviewing(project)} aria-label={`Review closure for ${project.title}`}>Review</button></td>
          </tr>)}</tbody>
        </table></div>
        <nav className="approval-pagination" aria-label="Approval pages">
          <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          <button className="btn btn-ghost btn-sm" disabled={page * pageSize >= total} onClick={() => setPage(value => value + 1)}>Next</button>
        </nav>
      </>}
    </section>
    {reviewing && <ReviewDialog project={reviewing} onClose={() => setReviewing(null)} onReviewed={() => { setReviewing(null); reload(); }} />}
  </div>;
}
