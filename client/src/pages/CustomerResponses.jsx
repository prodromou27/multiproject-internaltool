import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

const TEMPLATES = [
  {
    id: 'closing',
    title: 'Closing Ticket',
    color: '#22c55e',
    bg: '#f0fdf4',
    body: `As no further actions are required, we will proceed with closing this ticket.
In case you need any further assistance, you can always reopen this ticket by replying to this email.`,
  },
  {
    id: 'chargeable',
    title: 'Chargeable Task',
    color: '#f59e0b',
    bg: '#fffbeb',
    body: `We would like to inform you that the requested service is out of the scope of our contract, thus please approve X hour in order to schedule this task.



Task Description:
Responsible engineer:
Estimated required hours:
Requested by:



Service hours will be billed on actual time spent on service and our mutually agreed rates.`,
  },
  {
    id: 'crm',
    title: 'CRM - Chargeable',
    color: '#6366f1',
    bg: '#eef2ff',
    body: `Ticket #
Requester:
Product:`,
  },
  {
    id: 'late',
    title: 'Late Response',
    color: '#ef4444',
    bg: '#fef2f2',
    body: `I hope my email finds you well. We received no response from you since our last update. We will proceed with closing this ticket per company policy. You can always reply to this email to re-open the ticket to further assist you.`,
  },
  {
    id: 'upgrade',
    title: 'Notification of Asset Upgrade',
    color: '#3b82f6',
    bg: '#eff6ff',
    body: `Subject: Notification of Asset Upgrade

Dear Team,

I am writing to inform you of an upcoming asset upgrade for the below customer, [Customer Name]. The details of the upgrade are as follows:

Project Name:\t
Asset:\t
Responsible Engineer:\t
Date:\t
Time:\t

If you have any questions or need further information, please do not hesitate to contact me.

Kind regards,`,
  },
];

function TemplateCard({ tpl }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const markDone = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tpl.body).then(markDone).catch(() => fallbackCopy(tpl.body, markDone));
    } else {
      fallbackCopy(tpl.body, markDone);
    }
  }

  function fallbackCopy(text, onDone) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); onDone(); } catch (_) {}
    document.body.removeChild(ta);
  }

  return (
    <div className="card u-87c136d" style={{ borderLeft: `3px solid ${tpl.color}` }}>
      <div className="flex items-center justify-between mb-12">
        <div className="flex-center gap-10">
          <div className="u-2dcdba7" style={{ background: tpl.color }} />
          <span className="u-e6cd714">{tpl.title}</span>
        </div>
        <button
          onClick={copy}
          className="btn btn-sm u-145410d"
          style={{ background: copied ? '#f0fdf4' : 'var(--gray-50)', color: copied ? '#16a34a' : 'var(--gray-600)', border: `1px solid ${copied ? '#bbf7d0' : 'var(--gray-200)'}` }}
        >
          {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
        </button>
      </div>
      <pre className="u-1465002" style={{ background: tpl.bg, border: `1px solid ${tpl.color}22` }}>
        {tpl.body}
      </pre>
    </div>
  );
}

export default function CustomerResponses() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Customer Responses</h1>
          <div className="page-subtitle">Ready-to-use email templates — click Copy then paste into your email</div>
        </div>
      </div>

      <div className="u-b12974c">
        {TEMPLATES.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} />)}
      </div>
    </div>
  );
}
