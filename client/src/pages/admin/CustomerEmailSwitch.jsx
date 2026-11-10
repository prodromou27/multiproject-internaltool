import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { Toggle } from './shared';

/* Settings → Email & notifications → Emails to customers. Off unless a manager turns it
   on; the server refuses any email to a customer while it is off. Nothing sends reports
   to customers on its own; today the only email to a customer is a response sent by hand. */
export function CustomerEmailSwitch() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(null), [saving, setSaving] = useState(false);
  useEffect(() => { api.customerEmailSetting().then(result => setEnabled(!!result?.enabled)).catch(() => setEnabled(null)); }, []);
  async function change(next) {
    setSaving(true);
    try { setEnabled((await api.saveCustomerEmailSetting(next)).enabled); toast.success(next ? 'Emails to customers are on' : 'Emails to customers are off'); }
    catch (failure) { toast.error(failure.message); } finally { setSaving(false); }
  }
  if (enabled === null) return null;
  return <section className="card" aria-label="Emails to customers" style={{ padding: '16px 20px', marginTop: 20 }}>
    <h3 className="settings-subheading" style={{ marginTop: 0 }}>Emails to customers</h3>
    <Toggle checked={enabled} onChange={change} disabled={saving} label={enabled ? 'On: responses can be emailed to a customer’s contact' : 'Off: nothing is emailed to customers'} />
    <p className="text-sm text-muted" style={{ marginBottom: 0 }}>No report is ever sent to a customer automatically. While this is off, responses can only be copied, not emailed, and customer reports are shared by hand.</p>
  </section>;
}
