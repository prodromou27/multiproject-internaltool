import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCheck, Download, FileCheck2, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { PageHeader } from '../components/PageLayout';
import { Modal, PriorityBadge, StatusBadge, fmtDate, fmtDateTime } from '../components/Shared';
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

function ReportReviewDialog({ report, onClose, onReviewed }) {
  const toast=useToast();
  const [decision,setDecision]=useState(report.status==='approved' ? 'finalize' : 'approve');
  const [comment,setComment]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [conflict,setConflict]=useState(false);
  async function submit(event) {
    event.preventDefault();
    if (saving || conflict) return;
    setSaving(true);setError('');
    try {
      await api.updateManagedReportReview(report.id,{ action:decision,version:report.workflow_version,comment });
      toast.success(decision==='approve' ? 'Report approved' : decision==='reject' ? 'Report returned for changes' : 'Report finalized');
      onReviewed();
    } catch(failure) {
      setError(failure.message || 'Unable to save this report decision');setConflict(failure.status===409);
    } finally { setSaving(false); }
  }
  return <Modal title="Review Managed Report" onClose={saving ? () => {} : onClose}>
    <form onSubmit={submit}>
      <p className="approval-review-title">{report.customer_name}</p>
      <p className="text-muted text-sm">{report.original_name} · {fmtDate(report.period_start)} to {fmtDate(report.period_end)} · Version {report.report_version}</p>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <div className="form-group"><label htmlFor="report-decision">Decision</label>
        <select id="report-decision" value={decision} onChange={event => setDecision(event.target.value)} disabled={saving || conflict}>
          {report.status==='in_review' ? <><option value="approve">Approve report</option><option value="reject">Return for changes</option></> : <option value="finalize">Finalize report</option>}
        </select>
      </div>
      <div className="form-group"><label htmlFor="report-comment">{decision==='reject' ? 'Required changes *' : 'Review comment (optional)'}</label>
        <textarea id="report-comment" rows={4} maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} required={decision==='reject'} disabled={saving} />
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>Cancel</button>
        {conflict ? <button type="button" className="btn btn-primary" onClick={onReviewed}>Reload queue</button>
          : <button type="submit" className="btn btn-primary" disabled={saving || (decision==='reject' && !comment.trim())}>{saving ? 'Saving...' : decision==='approve' ? 'Approve report' : decision==='reject' ? 'Return for changes' : 'Finalize report'}</button>}
      </div>
    </form>
  </Modal>;
}

function Pagination({ page,total,pageSize,onPage }) {
  return <nav className="approval-pagination" aria-label="Approval pages">
    <button className="btn btn-ghost btn-sm" disabled={page===1} onClick={() => onPage(page-1)}>Previous</button>
    <span>Page {page} of {Math.max(1,Math.ceil(total/pageSize))}</span>
    <button className="btn btn-ghost btn-sm" disabled={page*pageSize>=total} onClick={() => onPage(page+1)}>Next</button>
  </nav>;
}

export default function Approvals() {
  const { user }=useAuth();
  const canReviewClosures=user?.role==='manager';
  const canReviewReports=!!user?.permissions?.['managed_reports.review'];
  const canViewCustomers=user?.role==='manager' || !!user?.permissions?.['managed_customers.view'];
  const [searchParams,setSearchParams]=useSearchParams();
  const requestedView=searchParams.get('view');
  const initialView=requestedView==='reports' && canReviewReports ? 'reports' : canReviewClosures ? 'closures' : 'reports';
  const [view,setViewState]=useState(initialView);
  const [reportStatus,setReportStatus]=useState('all');
  const [rows,setRows]=useState([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [reviewing,setReviewing]=useState(null);
  const [refresh,setRefresh]=useState(0);
  const pageSize=25;
  const reload=useCallback(() => setRefresh(value => value+1),[]);
  const setView=next => { setViewState(next);setPage(1);setRows([]);setSearchParams(next==='reports' ? { view:'reports' } : {},{ replace:true }); };
  useEffect(() => {
    const controller=new AbortController();
    setLoading(true);setError('');
    const request=view==='reports'
      ? api.managedReportReviews({ page,page_size:pageSize,status:reportStatus },{ signal:controller.signal })
      : api.closureApprovals({ page,page_size:pageSize },{ signal:controller.signal });
    request.then(data => {
      if (controller.signal.aborted) return;
      const lastPage=Math.max(1,Math.ceil(data.total/pageSize));
      if (page>lastPage) { setPage(lastPage);return; }
      setRows(data.rows);setTotal(data.total);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message || 'Unable to load approvals'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[page,refresh,reportStatus,view]);
  async function downloadReport(report) {
    setError('');
    try {
      const blob=await api.managedReportReviewDownload(report.id),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=report.original_name;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch(failure) { setError(failure.message || 'Unable to download the report'); }
  }
  const heading=view==='reports' ? 'Managed reports' : 'Project closure';
  return <div className="page">
    <PageHeader eyebrow="Management" title="Approvals" description="Review operational decisions from one permission-aware workspace. The oldest requests appear first."
      actions={<button className="btn btn-ghost" disabled={loading} onClick={reload}><RefreshCw size={15} /> Refresh</button>} />
    {canReviewClosures && canReviewReports && <div className="tabs" role="tablist" aria-label="Approval type">
      <button className={`tab ${view==='closures'?'active':''}`} role="tab" aria-selected={view==='closures'} onClick={() => setView('closures')}>Project closures</button>
      <button className={`tab ${view==='reports'?'active':''}`} role="tab" aria-selected={view==='reports'} onClick={() => setView('reports')}>Managed reports</button>
    </div>}
    {view==='reports' && <div className="approval-filters" aria-label="Report review filters">
      <label htmlFor="report-review-status">Status</label><select id="report-review-status" value={reportStatus} onChange={event => { setReportStatus(event.target.value);setPage(1); }}><option value="all">All active reviews</option><option value="in_review">Awaiting decision</option><option value="approved">Ready to finalize</option></select>
    </div>}
    {error && <div className="error-msg" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={reload}>Retry</button></div>}
    <section className="card" aria-label={`${heading} backlog`} aria-busy={loading}>
      <div className="approval-backlog-heading">{view==='reports' ? <FileCheck2 size={20} aria-hidden="true" /> : <CheckCheck size={20} aria-hidden="true" />}<h2>{heading}</h2><span>{error ? 'Unavailable' : loading ? 'Loading...' : `${total} awaiting action`}</span></div>
      {!loading && !error && !rows.length && <p className="approval-empty">No {view==='reports' ? 'managed reports' : 'project closure requests'} are waiting for review.</p>}
      {!loading && !error && rows.length>0 && <>
        {view==='closures' ? <div className="table-wrap"><table>
          <caption className="sr-only">Projects awaiting management closure approval</caption>
          <thead><tr><th scope="col">Project</th><th scope="col">Customer</th><th scope="col">Priority</th><th scope="col">Requested by</th><th scope="col">Requested</th><th scope="col">Deadline</th><th scope="col">Action</th></tr></thead>
          <tbody>{rows.map(project => <tr key={project.id}><td><Link to={`/projects/${project.id}`}>{project.title}</Link></td><td>{project.customer_name || 'Internal'}</td><td><PriorityBadge p={project.priority} /></td><td>{project.requested_by_name || 'Not recorded'}</td><td>{fmtDateTime(project.closure_requested_at)}</td><td>{fmtDate(project.deadline)}</td><td><button className="btn btn-primary btn-sm" onClick={() => setReviewing(project)} aria-label={`Review closure for ${project.title}`}>Review</button></td></tr>)}</tbody>
        </table></div> : <div className="table-wrap"><table>
          <caption className="sr-only">Managed reports awaiting review or finalization</caption>
          <thead><tr><th scope="col">Customer / report</th><th scope="col">Period</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Submitted</th><th scope="col">Actions</th></tr></thead>
          <tbody>{rows.map(report => <tr key={report.id}><td>{canViewCustomers ? <Link to={`/managed-customers/${report.customer_id}`}>{report.customer_name}</Link> : <strong>{report.customer_name}</strong>}<div className="text-muted text-sm">{report.original_name}</div></td><td>{fmtDate(report.period_start)} – {fmtDate(report.period_end)}</td><td>{report.output_format.toUpperCase()} · v{report.report_version}</td><td><StatusBadge s={report.status} /></td><td>{fmtDateTime(report.submitted_at || report.generated_at)}<div className="text-muted text-sm">{report.submitted_by_name || report.generated_by_name || 'Not recorded'}</div></td><td><div className="approval-actions"><button className="btn btn-ghost btn-sm" onClick={() => downloadReport(report)}><Download size={14} /> Download</button><button className="btn btn-primary btn-sm" onClick={() => setReviewing(report)}>{report.status==='approved' ? 'Finalize' : 'Review'}</button></div></td></tr>)}</tbody>
        </table></div>}
        <Pagination page={page} total={total} pageSize={pageSize} onPage={setPage} />
      </>}
    </section>
    {reviewing && (view==='reports' ? <ReportReviewDialog report={reviewing} onClose={() => setReviewing(null)} onReviewed={() => { setReviewing(null);reload(); }} /> : <ReviewDialog project={reviewing} onClose={() => setReviewing(null)} onReviewed={() => { setReviewing(null);reload(); }} />)}
  </div>;
}
