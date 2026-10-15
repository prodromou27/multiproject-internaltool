/**
 * A calendar invitation (.ics) for one maintenance visit, for the engineer to
 * add to Outlook, Google or Apple Calendar. Visits have a date but no time, so
 * it is an all-day event. Its UID matches the calendar feed (routes/ical.js),
 * so downloading it again, or subscribing to the feed too, updates the same
 * event instead of adding a copy.
 */
const { fold } = require('./icalFold');
const { PRODUCT_NAME } = require('./product');

const esc = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dayAfter = iso => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10).replace(/-/g, ''); };

/**
 * visit: { id, title, description, notes, scheduled_date, status, updated_at }
 * customer: { name, address, location, contact_name, contact_phone, contact_email }
 * engineers: [names]; appUrl: where links point.
 */
function visitInvite({ visit, customer = {}, engineers = [], appUrl = '', now = new Date() }) {
  const date = String(visit.scheduled_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('The visit has no date');
  const cancelled = visit.status === 'cancelled';
  const link = appUrl ? `${appUrl.replace(/\/+$/, '')}/maintenance-visits?visit=${visit.id}` : '';
  const contact = [customer.contact_name, customer.contact_phone, customer.contact_email].filter(Boolean).join(', ');
  const details = [
    visit.description,
    visit.notes ? `Notes: ${visit.notes}` : '',
    engineers.length ? `Engineers: ${engineers.join(', ')}` : '',
    contact ? `Customer contact: ${contact}` : '',
    link ? `In ${PRODUCT_NAME}: ${link}` : '',
  ].filter(Boolean).join('\n\n');
  const updated = Date.parse(String(visit.updated_at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(visit.updated_at || '')) ? '' : 'Z'));
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//Odyssey Cybersecurity//${PRODUCT_NAME}//EN`, 'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:visit-${visit.id}@solutionshub`,
    `DTSTAMP:${stamp(now)}`,
    // Calendars apply a newer copy over an older one; the last change time keeps it increasing.
    `SEQUENCE:${Number.isFinite(updated) ? Math.floor(updated / 1000) % 2147483647 : 0}`,
    `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${dayAfter(date)}`,
    `SUMMARY:${esc(`Maintenance visit: ${visit.title}${customer.name ? ` (${customer.name})` : ''}`)}`,
    ...(customer.address || customer.location ? [`LOCATION:${esc(customer.address || customer.location)}`] : []),
    ...(details ? [`DESCRIPTION:${esc(details)}`] : []),
    ...(link ? [`URL:${link}`] : []),
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:TRANSPARENT', // an all-day visit should not block the whole day in free/busy
    ...(cancelled ? [] : ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Tomorrow: ${visit.title}`)}`, 'TRIGGER:-PT15H', 'END:VALARM']), // 09:00 the day before
    'END:VEVENT', 'END:VCALENDAR',
  ];
  // Not lines.map(fold): map would pass each line's index as fold's width.
  return lines.map(line => fold(line)).join('\r\n') + '\r\n';
}

/** A file name people recognise: visit-2026-10-12-quarterly-firewall-check.ics */
function inviteFileName(visit) {
  const slug = String(visit.title || 'visit').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'visit';
  return `visit-${String(visit.scheduled_date).slice(0, 10)}-${slug}.ics`;
}

module.exports = { visitInvite, inviteFileName };
