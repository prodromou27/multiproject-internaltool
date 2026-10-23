// Business calendar and visit scheduling checks (review I10).
const { test, assert, api, db, ids, bcrypt } = require('./lib/activityFixture');
const calendar = require('../businessCalendar');
const appTime = require('../appTime');
const pgOnly = { skip: !process.env.TEST_DATABASE_URL && 'needs PostgreSQL' };

const setCalendar = body => api('/api/settings/business-calendar', { method: 'PUT', token: ids.tokenManager, body });

test('working days skip weekends and holidays (one-off or every year); 24x7 counts every day', () => {
  const cal = { working_days: [1, 2, 3, 4, 5], holidays: [{ date: '2026-12-25', name: 'Christmas Day', yearly: true }, { date: '2027-04-30', name: 'Easter Friday', yearly: false }], travel_buffer_minutes: 30 };
  // Mon 21 Dec 2026 → Mon 28 Dec: 22, 23, 24, (25 holiday), 28 → 4 working days.
  assert.equal(calendar.workingDaysBetween('2026-12-21', '2026-12-28', cal), 4);
  assert.equal(calendar.workingDaysBetween('2028-12-21', '2028-12-28', cal), 4, 'a yearly holiday every year (Mon 25 Dec 2028 skipped)');
  assert.equal(calendar.workingDaysBetween('2026-12-21', '2026-12-28', cal, { allDays: true }), 7);
  assert.deepEqual(calendar.dayOff('2027-04-30', cal), { kind: 'holiday', name: 'Easter Friday' });
  assert.deepEqual(calendar.dayOff('2028-04-30', cal), { kind: 'non_working_day', name: null }, 'a one-off holiday is that year only (a Sunday here)');
  assert.equal(calendar.dayOff('2027-05-03', cal), null);
  assert.equal(calendar.defaultMode('24x7'), 'all_days');
  assert.equal(calendar.defaultMode('8x5'), 'business');
});

test('managers set the calendar; everyone reads it', async () => {
  assert.deepEqual((await api('/api/settings/business-calendar', { token: ids.tokenEnabled })).data.working_days, [1, 2, 3, 4, 5], 'Monday to Friday until changed');
  assert.equal((await api('/api/settings/business-calendar', { method: 'PUT', token: ids.tokenEnabled, body: { working_days: [1] } })).status, 403);
  assert.equal((await setCalendar({ working_days: [] })).status, 400);
  assert.equal((await setCalendar({ working_days: [1, 2, 3, 4, 5], holidays: [{ date: '2027-03-25', name: '' }] })).status, 400);
  assert.equal((await setCalendar({ working_days: [1, 2, 3, 4, 5], holidays: [{ date: '2027-03-25', name: 'A' }, { date: '2027-03-25', name: 'B' }] })).status, 400, 'a date once');
  const saved = await setCalendar({ working_days: [1, 2, 3, 4, 5], holidays: [{ date: '2027-03-03', name: 'Green Monday' }, { date: '2026-12-25', name: 'Christmas Day', yearly: true }], travel_buffer_minutes: 45 });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.holidays.map(h => h.name), ['Christmas Day', 'Green Monday']);
  assert.equal(saved.data.travel_buffer_minutes, 45);
});

test('visit planning never offers a holiday, and says why a day is blocked', async () => {
  const res = await api(`/api/visit-planning/availability?from=2027-03-01&to=2027-03-07&customer_id=${ids.customer}`, { token: ids.tokenManager });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.days.find(d => d.date === '2027-03-03'), { date: '2027-03-03', weekend: false, working: false, holiday: 'Green Monday' });
  const cell = date => res.data.engineers[0].cells.find(c => c.date === date);
  assert.equal(cell('2027-03-03').free, false);
  assert.equal(cell('2027-03-03').blocked_reason, 'Public holiday: Green Monday');
  assert.equal(cell('2027-03-06').blocked_reason, 'Not a working day');
  assert.ok(!res.data.suggestions.some(s => s.date === '2027-03-03'), 'no holiday slots');
  const first = res.data.suggestions[0];
  assert.ok(first.engineers[0].reasons.length > 0, 'each suggestion explains itself');
});

test('a visit is checked before saving: hard problems need confirmation, advisory ones are shown', async () => {
  const check = body => api('/api/maintenance-visits/check', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, ...body } });
  const save = body => api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Check visit', ...body } });
  const codes = result => result.data.warnings.map(w => `${w.code}:${w.severity}`).sort();

  // A holiday is hard; saving needs confirm_warnings.
  assert.deepEqual(codes(await check({ scheduled_date: '2027-03-03', engineer_ids: [] })), ['holiday:hard']);
  const refused = await save({ scheduled_date: '2027-03-03', engineer_ids: [ids.engineerEnabled] });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'VISIT_CHECK');
  assert.equal((await save({ scheduled_date: '2027-03-03', engineer_ids: [ids.engineerEnabled], confirm_warnings: true })).status, 200, 'saved when confirmed');

  // Times: both or neither; overlap is hard; a short gap is advisory (travel buffer 45 min).
  assert.equal((await check({ scheduled_date: '2027-03-08', start_time: '10:00' })).status, 400);
  const first = await save({ scheduled_date: '2027-03-08', start_time: '09:00', duration_minutes: 120, engineer_ids: [ids.engineerEnabled] });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.deepEqual(codes(await check({ scheduled_date: '2027-03-08', start_time: '10:30', duration_minutes: 60, engineer_ids: [ids.engineerEnabled] })), ['overlap:hard']);
  const otherCustomer = await api('/api/maintenance-visits/check', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customerUnassigned, scheduled_date: '2027-03-08', start_time: '11:20', duration_minutes: 60, engineer_ids: [ids.engineerEnabled] } });
  assert.deepEqual(codes(otherCustomer), ['travel:advisory']);
  assert.match(otherCustomer.data.warnings[0].message, /20 minutes .* travel buffer is 45 minutes/);
  assert.deepEqual(codes(await check({ scheduled_date: '2027-03-08', start_time: '12:00', duration_minutes: 60, engineer_ids: [ids.engineerEnabled] })), [], 'the same customer needs no travel');
  assert.deepEqual(codes(await check({ scheduled_date: '2027-03-08', engineer_ids: [ids.engineerEnabled] })), ['same_day:advisory'], 'an all-day visit next to a timed one');
  assert.equal((await save({ scheduled_date: '2027-03-08', engineer_ids: [ids.engineerEnabled] })).status, 200, 'advisory only: saves without confirming');

  // Time off is hard; a weekend is advisory.
  const engineer = (await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Off Person', 'off.person@test.local', ?, 'engineer')").run(bcrypt.hashSync('x', 4))).lastInsertRowid;
  await db.prepare("INSERT INTO engineer_time_off (user_id, start_date, end_date, reason) VALUES (?, '2027-03-09', '2027-03-09', 'Course')").run(engineer);
  assert.deepEqual(codes(await check({ scheduled_date: '2027-03-09', engineer_ids: [engineer] })), ['time_off:hard']);
  assert.deepEqual(codes(await check({ scheduled_date: '2027-03-13', engineer_ids: [] })), ['non_working_day:advisory']);

  // Moving a visit is checked again; other edits are not.
  const moved = await api(`/api/maintenance-visits/${first.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { scheduled_date: '2027-03-03' } });
  assert.equal(moved.status, 409);
  assert.equal((await api(`/api/maintenance-visits/${first.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { title: 'Renamed' } })).status, 200);
  const row = await db.prepare('SELECT start_time, duration_minutes FROM maintenance_visits WHERE id = ?').get(first.data.id);
  assert.deepEqual([row.start_time, Number(row.duration_minutes)], ['09:00', 120], 'times kept on other edits');
});

test('the advisory skill hint uses the skill matrix', async () => {
  const tech = (await db.prepare("INSERT INTO technologies (name, active) VALUES ('Checkpoint Quantum', 1)").run()).lastInsertRowid;
  const asset = await api(`/api/customers/${ids.customer}/assets`, { method: 'POST', token: ids.tokenManager, body: { name: 'GW-1', asset_type: 'Firewall', technology_id: tech } });
  assert.equal(asset.status, 201, JSON.stringify(asset.data));
  const check = () => api('/api/maintenance-visits/check', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, scheduled_date: '2027-03-10', engineer_ids: [ids.engineerEnabled], asset_ids: [asset.data.id] } });
  assert.ok((await check()).data.warnings.some(w => w.code === 'skills' && w.severity === 'advisory' && /Checkpoint Quantum/.test(w.message)));
  await db.prepare('INSERT INTO engineer_skills (user_id, technology_id, level) VALUES (?, ?, 4)').run(ids.engineerEnabled, tech);
  assert.ok(!(await check()).data.warnings.some(w => w.code === 'skills'));
});

test('SLA working days skip holidays, and a 24x7 contract never pauses', pgOnly, async () => {
  const today = appTime.today();
  // A visit 14 days ago without a report: count its working days with and without a holiday in between.
  const visit = (await db.prepare("INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, 'SLA visit', ?, 'completed', ?)").run(ids.customer, appTime.addDays(today, -14), ids.manager)).lastInsertRowid;
  const daysOf = async () => (await api('/api/sla/overview', { token: ids.tokenManager })).data.mv.items.find(item => Number(item.id) === Number(visit)).working_days;
  await setCalendar({ working_days: [1, 2, 3, 4, 5], holidays: [] });
  const plain = await daysOf();
  let weekday = appTime.addDays(today, -3);
  while (calendar.dayOff(weekday, { working_days: [1, 2, 3, 4, 5], holidays: [] })) weekday = appTime.addDays(weekday, -1);
  await setCalendar({ working_days: [1, 2, 3, 4, 5], holidays: [{ date: weekday, name: 'Test holiday' }] });
  assert.equal(await daysOf(), plain - 1, 'the holiday does not consume SLA time');
  await db.prepare("INSERT INTO customer_contracts (customer_id, reference, start_date, end_date, service_level, created_by) VALUES (?, 'C-24', ?, ?, '24x7', ?)").run(ids.customer, appTime.addDays(today, -400), appTime.addDays(today, 300), ids.manager);
  assert.equal(await daysOf(), 14, 'every day counts for a 24x7 customer');
});

test('public holidays appear in the calendars: the Calendar month, the visits calendar and the calendar feed', async () => {
  const year = Number(appTime.today().slice(0, 4)) + 1;
  assert.equal((await setCalendar({ working_days: [1, 2, 3, 4, 5], holidays: [
    { date: '2020-12-25', name: 'Christmas Day', yearly: true },
    { date: `${year}-12-28`, name: 'Company day', yearly: false },
  ] })).status, 200);

  // The Calendar page's month, for anyone who can open the calendar.
  const month = (await api(`/api/calendar?month=${year}-12`, { token: ids.tokenEnabled })).data;
  assert.deepEqual(month.holidays, [{ date: `${year}-12-25`, name: 'Christmas Day' }, { date: `${year}-12-28`, name: 'Company day' }], 'a yearly one on this year\'s date');
  assert.deepEqual((await api(`/api/calendar?month=${year}-11`, { token: ids.tokenEnabled })).data.holidays, []);

  // The visits calendar asks for the days it shows.
  const range = await api(`/api/calendar/holidays?from=${year}-12-20&to=${year + 1}-01-05`, { token: ids.tokenEnabled });
  assert.deepEqual(range.data.map(h => h.date), [`${year}-12-25`, `${year}-12-28`]);
  assert.equal((await api(`/api/calendar/holidays?from=${year}-01-01&to=${year + 2}-01-01`, { token: ids.tokenEnabled })).status, 400, 'at most 400 days');
  assert.equal((await api('/api/calendar/holidays?from=soon&to=later', { token: ids.tokenEnabled })).status, 400);

  // The calendar feed (Outlook): all-day events, shown as free time. PostgreSQL only: pg-mem cannot run the feed's task query.
  if (!process.env.TEST_DATABASE_URL) return;
  const token = 'holiday-feed-token';
  await db.prepare('UPDATE users SET ical_token_hash = ? WHERE id = ?').run(require('crypto').createHash('sha256').update(token).digest('hex'), ids.manager);
  const feed = await (await fetch(`${require('./lib/activityFixture').baseUrl}/api/calendar/ical/${token}.ics`)).text();
  const nextChristmas = `${appTime.today() > `${appTime.today().slice(0, 4)}-12-25` ? year : year - 1}1225`;
  const event = ['BEGIN:VEVENT', `UID:holiday-${nextChristmas}@solutionshub`, 'SUMMARY:Christmas Day (public holiday)', `DTSTART;VALUE=DATE:${nextChristmas}`].join('\r\n');
  assert.ok(feed.includes(event), feed);
  assert.ok(feed.includes('TRANSP:TRANSPARENT'));
});
