import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Modal } from './Shared';

/**
 * A glossary for the customer/service screens that share overlapping names
 * (Customers, Managed Customers, Activity Log, Service Activity Reports,
 * Service Activity Tracking, Ticket Sync Status) plus a short setup checklist
 * for managers. Answers "what does this screen do?" without needing a
 * separate hosted docs site.
 */
const GLOSSARY = [
  { term: 'Customers', desc: 'General customer profiles, contacts and contracts.' },
  { term: 'Managed Customers', desc: 'Per-customer managed-service health, tickets and reports — for one customer at a time.' },
  { term: 'Activity Log', desc: 'Where engineers log service work as it happens.' },
  { term: 'Service Activity Reports', desc: 'Aggregated reporting over all logged service activity, across every customer.' },
  { term: 'Service Activity Tracking (Settings)', desc: 'Admin configuration for the Activity Log module — categories, technologies, and per-team setup.' },
  { term: 'Ticket Sync Status (Settings)', desc: 'Request Tracker sync health — mapped customers, ticket counts, and recent sync runs.' },
];

const MANAGER_STEPS = [
  'Create teams and add members (Settings → Teams)',
  'Enable Service Activity Tracking for a team, if it does customer service work (Settings → Teams → Tracking Enabled)',
  'Add customers and assign them to a team (Customers)',
  'Set SLA response/resolution targets per team (Settings → Teams → Targets)',
  'Configure Teams/Webex notifications and Request Tracker, if used (Settings → Integrations)',
];

export default function HelpMenu({ role }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="topbar-action" onClick={() => setOpen(true)} aria-label="Help">
        <HelpCircle size={18} />
      </button>
      {open && (
        <Modal title="Help" onClose={() => setOpen(false)} wide>
          {role === 'manager' && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>First-time setup</h3>
              <ol style={{ paddingLeft: 18, fontSize: 13, color: 'var(--gray-600)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {MANAGER_STEPS.map(step => <li key={step}>{step}</li>)}
              </ol>
            </div>
          )}
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>What's the difference between…</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {GLOSSARY.map(({ term, desc }) => (
                <div key={term}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{term}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 18, marginBottom: 0 }}>
            Press <kbd>Ctrl</kbd> <kbd>K</kbd> anywhere to jump to a page by name.
          </p>
        </Modal>
      )}
    </>
  );
}
