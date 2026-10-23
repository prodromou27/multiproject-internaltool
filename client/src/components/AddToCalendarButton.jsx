import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { saveDownload } from '../api';
import { useToast } from './Toast';

/* Downloads a maintenance visit as a calendar invitation (.ics) for Outlook,
   Google or Apple Calendar (server: GET /maintenance-visits/:id/calendar.ics).
   `compact` shows just the icon, for table rows. */
export default function AddToCalendarButton({ visitId, title = 'this visit', compact = false, className = 'btn btn-ghost btn-sm' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function download(event) {
    event.stopPropagation();
    setBusy(true);
    try {
      await saveDownload(`/maintenance-visits/${visitId}/calendar.ics`, `visit-${visitId}.ics`);
      toast.success('Calendar invitation downloaded. Open it to add the visit to your calendar.');
    } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  return <button type="button" className={`${className} inline-flex items-center gap-4`} disabled={busy} onClick={download}
    aria-label={`Add ${title} to your calendar`} title="Add to calendar">
    <CalendarPlus size={13} aria-hidden="true" />{compact ? null : ' Add to calendar'}
  </button>;
}
