import { getLocaleConfig } from './locale.js';

/* Three kinds of date (review I02):
   - business dates (deadlines, visit days, "today" for overdue, report periods):
     the organisation's calendar date, in its time zone (Settings → Time & region),
     the same for everyone wherever they are, and the same as the server's;
   - instants (created_at…): shown in that time zone by formatDateTime;
   - a person's own reminder times: entered in their browser's time.
   A date-only value (2026-09-22) is never converted as an instant. */

/** The calendar date of a Date in the browser's own time zone (for date arithmetic
 *  on dates made with T12:00, and for personal reminder entry). */
export const localDateISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Today's business date (YYYY-MM-DD) in the organisation's time zone. */
export function businessToday(now = new Date(), timeZone = getLocaleConfig()?.timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Asia/Nicosia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return localDateISO(now); // an unknown zone: the browser's date rather than nothing
  }
}

/** A Date at noon on today's business date, for code that works out weeks, months
 *  and quarters with getFullYear/getMonth/getDate. */
export const businessNow = (now = new Date()) => new Date(`${businessToday(now)}T12:00:00`);
