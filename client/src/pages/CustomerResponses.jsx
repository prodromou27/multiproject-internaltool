import React, { useState } from 'react';
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
    <div className="card" style={{ marginBottom: 16, borderLeft: `3px solid ${tpl.color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: tpl.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--gray-900)' }}>{tpl.title}</span>
        </div>
        <button
          onClick={copy}
          className="btn btn-sm"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: copied ? '#f0fdf4' : 'var(--gray-50)',
            color: copied ? '#16a34a' : 'var(--gray-600)',
            border: `1px solid ${copied ? '#bbf7d0' : 'var(--gray-200)'}`,
            transition: 'all .15s',
          }}
        >
          {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
        </button>
      </div>
      <pre style={{
        background: tpl.bg,
        border: `1px solid ${tpl.color}22`,
        borderRadius: 8,
        padding: '12px 14px',
        fontSize: 13,
        color: 'var(--gray-700)',
        lineHeight: 1.65,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'inherit',
        margin: 0,
      }}>
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

      <div style={{ maxWidth: 720 }}>
        {TEMPLATES.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} />)}
      </div>
    </div>
  );
}
