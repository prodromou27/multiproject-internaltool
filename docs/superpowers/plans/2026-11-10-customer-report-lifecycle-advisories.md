# Customer report: lifecycle and security advisories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two optional sections to the customer report at Customer 360 → Reports: technology lifecycle and support status (grouped), and a general list of security advisories with a CVSS score above 9.

**Architecture:** A new `server/reportInsights.js` builds both sections from data already held. Two paths call it: `customerValueReport.buildValueReport` (preview, built-in PDF and Word) and `managedCustomerReportingService.buildReportModel` (the company Word template path via `managedReportDocx.templateData`). The CVE sync additionally stores CISA's vendor, product and short description, and a per-row flag on `cve_watch` marks the products that feed the advisories.

**Tech Stack:** Node/Express, PostgreSQL (pg-mem in tests), pdfkit, docx, docxtemplater, React/Vite, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-managed-report-lifecycle-advisories-design.md`

## Global Constraints

- Sections are keyed `lifecycle` and `advisories`, and are **off by default**: not in `DEFAULT_SECTIONS`.
- Lifecycle window: expired, or ending within 12 months of the **report period's end date** (`to`). Status values exactly `Expired`, `Within 90 days`, `Within 12 months`.
- Licences and contracts that expired more than 12 months before `to` are dropped. Active devices stay listed however long ago they expired. Renewed contracts (status `renewed`) are dropped.
- Advisories: CVSS score strictly `> 9`; unscored CVEs are excluded. Published in `[from, to]`, or added to CISA's list (`cve_kev.date_added`) in `[from, to]`. Only products flagged `in_advisories = 1`. Exploited first (newest `date_added` first), then highest score. At most 3 per product, 10 in all.
- Advisory notice, verbatim: `General information about significant vulnerabilities published in this period. This list is not an assessment of your environment.`
- More-than-shown line, verbatim: `Showing the 10 most significant of N.` (N = qualifying count before both caps)
- Lifecycle opening line: `N items have expired or end within the next 12 months.` (`1 item has` for one)
- Built-in headings: `Technology lifecycle and support status`, `Security advisories for awareness`. Empty messages: `Nothing has expired or ends within the next 12 months.`, `No significant security advisories were published in this period.`
- Lifecycle group titles and order: `Devices and firmware`, `Licences, subscriptions and certificates`, `Contracts`.
- Description: CISA `short_description` when the CVE is on CISA's list and it is non-empty, otherwise NVD `description`. Never shortened.
- UI keeps LIVE's look: existing classes and patterns only.
- Repo rules: work on `DEV-3`; one commit at the end after lint, client build (rebuilds `client/dist`, which is committed), full Playwright suite and full server `npm test` (server tests through the Bash tool; not concurrently with e2e). Commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push or merge to LIVE.
- Keep `.superpowers/` out of the commit.

## Review Focus

1. **A cloud or M365 customer with no assets, licences or contracts** should get the empty-lifecycle message, not an error or empty tables. Test in Task 2.
2. **A CVE listed under two flagged products** (its `products` string names both) should appear once, counted against the first matching product. Test in Task 3.
3. **A CVE scoring exactly 9.0, or unscored (`cvss_score` NULL)** should not appear, even when exploited. Test in Task 3.
4. **Malformed or time-stamped dates** (`2027-01-15 00:00:00`, `''`, `n/a`) in support, warranty or expiry fields should be read by their first 10 characters or skipped, never crash. Test in Task 2.
5. **A Word template uploaded before this change**, without the new placeholders, should still validate and render. A template **with** them, used while the sections are unticked, should show nothing for them. Test in Task 5.

---

### Task 1: CVE data — CISA fields, the advisories flag, seeded products

**Files:**
- Modify: `server/schema/migrations.js` (append after `20261130_maintenance_visit_end_date`)
- Modify: `server/cve/sync.js` (`syncKev`)
- Modify: `server/routes/vulnerabilities.js` (`GET /admin/status`, `PUT /admin/watch/:id`)
- Test: `server/test/vulnerabilities.integration.test.js`

**Interfaces:**
- Produces: columns `cve_kev.vendor`, `cve_kev.product`, `cve_kev.short_description` (TEXT); `cve_watch.in_advisories INTEGER NOT NULL DEFAULT 0`. `GET /api/vulnerabilities/admin/status` rows include `in_advisories: boolean`. `PUT /api/vulnerabilities/admin/watch/:id` accepts `{ in_advisories: boolean }`.

- [ ] **Step 1: Write the failing test** `CISA's description is kept, and managers choose which products feed customer reports`. Extend the CISA row in `fakeFetch` with `vendorProject: 'Fortinet', product: 'FortiOS', shortDescription: 'FortiOS contains a flaw.'`, run `run()`, then assert:

```js
const kev = await db.prepare("SELECT vendor, product, short_description FROM cve_kev WHERE cve_id = 'CVE-2026-1001'").get();
assert.deepEqual(kev, { vendor: 'Fortinet', product: 'FortiOS', short_description: 'FortiOS contains a flaw.' });
const status = (await api('/api/vulnerabilities/admin/status', { token: ids.tokenManager })).data;
assert.ok(status.watch.some(row => row.cpe_vendor === 'php' && row.cpe_product === 'php' && row.in_advisories === true), 'seeded');
const fortinet = status.watch.find(row => row.cpe_vendor === 'fortinet');
assert.equal(fortinet.in_advisories, false, 'asset vendors are not flagged automatically');
assert.equal((await api(`/api/vulnerabilities/admin/watch/${fortinet.id}`, { method: 'PUT', token: ids.tokenManager, body: { in_advisories: true } })).status, 200);
assert.equal((await api(`/api/vulnerabilities/admin/watch/${fortinet.id}`, { method: 'PUT', token: ids.tokenManager, body: { in_advisories: 'yes' } })).status, 400);
assert.equal((await api(`/api/vulnerabilities/admin/watch/${fortinet.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { in_advisories: false } })).status, 403);
```

- [ ] **Step 2: Run it and see it fail**

Run (Bash, from `server/`): `node --test --test-name-pattern="CISA's description" test/vulnerabilities.integration.test.js`
Expected: FAIL (column `vendor` does not exist).

- [ ] **Step 3: Add migration `20261201_report_insights`**. One `ALTER TABLE … ADD COLUMN IF NOT EXISTS` per column (pg-mem). Seed with `INSERT INTO cve_watch (cpe_vendor, cpe_product, label, source, in_advisories) VALUES (…, 'manual', 1) ON CONFLICT (cpe_vendor, cpe_product) DO UPDATE SET in_advisories = 1`:

| cpe_vendor | cpe_product | label |
|---|---|---|
| linux | linux_kernel | Linux kernel |
| vmware | esxi | VMware ESXi |
| php | php | PHP |
| microsoft | windows_server_2016 | Windows Server |
| microsoft | windows_server_2019 | Windows Server |
| microsoft | windows_server_2022 | Windows Server |
| microsoft | windows_server_2025 | Windows Server |
| microsoft | sql_server | Microsoft SQL Server |

Before committing, check each name against `https://services.nvd.nist.gov/rest/json/cpes/2.0?cpeMatchString=cpe:2.3:*:<vendor>:<product>` and correct any that return nothing.

- [ ] **Step 4: Store the CISA fields in `syncKev`** (each sliced to 500 characters, `short_description` to 2000). In `vulnerabilities.js`: select `in_advisories` and return it as a boolean; in `PUT /admin/watch/:id`, accept an optional boolean `in_advisories` (400 `In customer reports must be true or false` otherwise), update it with `COALESCE`, and include `in_advisories=` in the audit detail.

- [ ] **Step 5: Run it and see it pass**, together with the rest of the file.

Run: `node --test test/vulnerabilities.integration.test.js`
Expected: PASS, every test.

---

### Task 2: Lifecycle section data

**Files:**
- Create: `server/reportInsights.js`
- Test: `server/test/reportInsights.integration.test.js`

**Interfaces:**
- Consumes: `managedReportData.getAssets(customerId, asOf, store)`, `softwareCompliance.loadProducts/productFor/assessVersion`, `customerLicences.licencesFor([id], store, today)`, `customerContracts.contractsFor([id], store, today)`.
- Produces: `getLifecycle(customerId: number, asOf: 'YYYY-MM-DD', store = db) -> Promise<{ total: number, summary: string, groups: Array<{ key: 'devices'|'licences'|'contracts', title: string, rows: Array<{ item: string, type: string, ends: 'YYYY-MM-DD', status: 'Expired'|'Within 90 days'|'Within 12 months' }> }> }>`. Groups with no rows are left out; `summary` is the opening line, or `''` when `total` is 0.

- [ ] **Step 1: Write the failing tests.** Use `ids.customer`, inserting rows directly, and `asOf = '2026-10-31'`.
  - `lifecycle groups what has expired or ends within 12 months, soonest first`. Data:
    - Device `FW-HQ-01` with support ending `2026-10-01`, and warranty `2028-01-01` (outside the window).
    - Device `ESX-02` with warranty `2027-09-01`.
    - Licence `M365 E3` expiring `2027-06-30`, with `not_renewing = 1`.
    - Certificate `*.example.com` expiring `2026-12-02`.
    - Licence `Old AV` that expired `2025-09-01` (stale).
    - Contract `Managed firewall` ending `2026-12-31`.
    - A renewed contract ending `2026-11-15`, with its renewal ending `2027-11-15`.

    Assert:

```js
assert.deepEqual(result.groups.map(g => g.title), ['Devices and firmware', 'Licences, subscriptions and certificates', 'Contracts']);
assert.deepEqual(result.groups[0].rows.map(r => [r.type, r.ends, r.status]), [['Support', '2026-10-01', 'Expired'], ['Warranty', '2027-09-01', 'Within 12 months']]);
assert.deepEqual(result.groups[1].rows.map(r => [r.item, r.type, r.status]), [['*.example.com', 'Certificate', 'Within 90 days'], ['M365 E3', 'Licence', 'Within 12 months']]);
assert.deepEqual(result.groups[2].rows.map(r => r.ends), ['2026-12-31'], 'the renewed one is gone; its renewal ends beyond 12 months');
assert.equal(result.summary, '5 items have expired or end within the next 12 months.');
```

  - `a customer with nothing recorded gets no groups` (Review Focus 1): use `ids.customerUnassigned` and assert `{ total: 0, summary: '', groups: [] }`.
  - `odd dates are read by their day or skipped` (Review Focus 4): use support `'2027-01-15 00:00:00'` and warranty `'n/a'`. Assert one Support row ending `2027-01-15` with status `Within 12 months`, and no Warranty row.
  - `firmware ending within the window is listed`: insert a `software_products` row (`enabled = 1`, `asset_vendor = 'Fortinet'`) and a `software_releases` row with branch `7.0` and eol `2027-03-30`, plus an active asset `Fortinet` running version `7.0.12`. Assert a `Firmware` row ending `2027-03-30`.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/reportInsights.integration.test.js`
Expected: FAIL (`Cannot find module '../reportInsights'`).

- [ ] **Step 3: Implement `getLifecycle`.** How each item is named:
  - Device support or warranty: `name`, plus ` (vendor model)` when known.
  - Firmware: `` `${product_name} ${line} on ${asset name}` ``, with end date `release.eol || release.support_end` of the release `assessVersion` matched (`line`). Pass `asOf` as `today` to `assessVersion`.
  - Licences: the `name`.
  - Contracts: the `description`, or `Contract` when it has none.

  Status is measured from `asOf`: before it is `Expired`; on or before `asOf + 90 days` is `Within 90 days`; on or before `asOf + 12 months` is `Within 12 months`; anything later is left out. Licences and contracts that ended before `asOf - 12 months` are left out.

- [ ] **Step 4: Run them and see them pass**

Run: `node --test test/reportInsights.integration.test.js`
Expected: PASS.

---

### Task 3: Advisories section data

**Files:**
- Modify: `server/reportInsights.js`
- Test: `server/test/reportInsights.integration.test.js`

**Interfaces:**
- Consumes: tables `cves`, `cve_kev`, `cve_watch` (Task 1 columns).
- Produces: `getAdvisories(from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', store = db) -> Promise<{ total: number, more: string, rows: Array<{ cve: string, product: string, severity: string, exploited: boolean, description: string }> }>` and constants `ADVISORY_NOTICE`, `ADVISORY_LIMIT = 10`, `ADVISORY_PER_PRODUCT = 3`, `ADVISORY_MIN_SCORE = 9`. `severity` reads like `Critical 9.8`. `more` is the more-than-shown line, or `''`.

- [ ] **Step 1: Write the failing tests.** Insert `cves` rows directly (`products` space-padded like `' php:php '`), and flag `php:php` and `microsoft:windows_server_2022` as label `Windows Server`, with `in_advisories = 1`. Tests share one database, so give each test its own month as the period: October 2026 for the first, then November and December. Assert `total` before adding the 9 extra products.
  - `advisories list exploited then highest score, above 9 only, from flagged products`. Data:
    - `A`: PHP, 9.8, published in the period.
    - `B`: Windows Server, 9.1; on CISA's list, added `2026-10-20` with a short description; published in 2025.
    - `C`: PHP, 9.0, exploited.
    - `D`: PHP, unscored.
    - `E`: a product that isn't flagged, 10.0.
    - `F`: PHP, 9.9, published in September.

    Assert:

```js
assert.deepEqual(result.rows.map(r => r.cve), ['B', 'A']);
assert.deepEqual(result.rows[0], { cve: 'B', product: 'Windows Server', severity: 'Critical 9.1', exploited: true, description: 'CISA text.' });
assert.equal(result.rows[1].description, 'NVD text for A.');
assert.equal(result.more, '');
```

  - `no more than 3 per product and 10 in all, saying how many qualified`: add 5 PHP CVEs scoring 9.5 and 12 Windows Server CVEs scoring 9.5, all in the period. Assert 6 rows (3 PHP and 3 Windows Server), `total === 17`, and `more === 'Showing the 10 most significant of 17.'`.

    Also add 9 more flagged products with 2 CVEs each, and assert `rows.length === 10`.
  - `a CVE under two flagged products appears once` (Review Focus 2): one CVE with `products` set to `' php:php microsoft:windows_server_2022 '`. Assert it appears once.
  - Review Focus 3 is covered by C and D above.

- [ ] **Step 2: Run them and see them fail.** Expected: FAIL (`getAdvisories is not a function`).

- [ ] **Step 3: Implement `getAdvisories`.** Two simple queries (pg-mem: avoid join filters):
  - Flagged watch rows.
  - Candidate CVEs with `cvss_score > ?`. Either `published >= from AND published < to + 1 day`, or `id IN (SELECT cve_id FROM cve_kev WHERE date_added BETWEEN ? AND ?)`. Left-join `cve_kev` for `date_added` and `short_description`.

  Then in JS: match a product with `products.includes(\` ${vendor}:${product} \`)`, taking the first flagged watch in id order. The name is `label || product`. Sort, apply the per-product cap, then the overall cap. `total` counts candidates that match a flagged product.

- [ ] **Step 4: Run them and see them pass.** Expected: PASS, every test in the file.

---

### Task 4: The built-in report — preview, PDF and Word

**Files:**
- Modify: `server/customerValueReport.js`
- Test: `server/test/customerValueReport.integration.test.js`

**Interfaces:**
- Consumes: `getLifecycle`, `getAdvisories`, `ADVISORY_NOTICE` (Tasks 2–3).
- Produces: `SECTIONS` gains `'lifecycle', 'advisories'` (`DEFAULT_SECTIONS` unchanged). `WORDING_DEFAULTS.headings` and `.empty` gain `lifecycle` and `advisories` with the Global Constraints text. The report object gains `lifecycle` (Task 2 shape, or `null` when not included) and `advisories` (Task 3 shape plus `notice: ADVISORY_NOTICE`, or `null`). Table specs from `tablesOf` may carry `groups: [{ title, rows }]` in place of `rows`, and `details: string[]` (one full-width line drawn under each row).

- [ ] **Step 1: Write the failing test** `lifecycle and advisories are off unless chosen, and appear in the preview, PDF and Word when chosen`:

```js
assert.equal((await api(`${base()}/customer-report/preview`, { method: 'POST', token: ids.tokenManager, body: { from, to } })).data.lifecycle, null);
const chosen = (await api(`${base()}/customer-report/preview`, { method: 'POST', token: ids.tokenManager, body: { from, to, sections: ['lifecycle', 'advisories'] } })).data;
assert.ok(Array.isArray(chosen.lifecycle.groups));
assert.equal(chosen.advisories.notice, 'General information about significant vulnerabilities published in this period. This list is not an assessment of your environment.');
for (const format of ['pdf', 'docx']) assert.equal((await download(format, { from, to, sections: ['lifecycle', 'advisories'] })).status, 200);
```

  Seed one flagged CVE and one expiring licence so both sections have rows. For Word, unzip the docx with `PizZip` and assert that `word/document.xml` contains `Technology lifecycle and support status`, `Licences, subscriptions and certificates`, the CVE number and its description.

- [ ] **Step 2: Run it and see it fail**

Run: `node --test --test-name-pattern="lifecycle and advisories" test/customerValueReport.integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `buildValueReport`: call the two builders only when their section is included.
  - `tablesOf`: lifecycle becomes one spec with `note: summary` and `groups`; advisories becomes one spec with `note: notice`, `details` (descriptions), columns `CVE 1.4 / Product 1.6 / Severity 1.1 / Actively exploited 1.1`, and `more` appended to the note.
  - `renderPdf` and `renderWord`: draw each group's title as a bold sub-heading followed by its table. Draw each detail as a full-width row (Word: one cell with `columnSpan`; PDF: a row the full table width).
  - An empty section shows its empty message.

- [ ] **Step 4: Run it and see it pass**, then the whole file.

Run: `node --test test/customerValueReport.integration.test.js`
Expected: PASS.

---

### Task 5: The company Word template path

**Files:**
- Modify: `server/managedCustomerReportingService.js` (`SECTION_KEYS`, `buildReportModel`)
- Modify: `server/routes/managedCustomers.js` (`picked` map, about line 229)
- Modify: `server/managedReportDocx.js` (`OPTIONAL_SECTIONS`, `PLACEHOLDERS`, `templateData`, `starterTemplate`)
- Test: `server/test/managedReportDocx.test.js`, `server/test/customerValueReport.integration.test.js`

**Interfaces:**
- Consumes: Tasks 2–3 builders.
- Produces:
  - `SECTION_KEYS` gains `'lifecycle', 'advisories'`. The model gains `lifecycle` and `advisories`, built only when selected, otherwise `null`. `picked` gains `lifecycle: ['lifecycle'], advisories: ['advisories']`.
  - Placeholders:
    - Flags: `include_lifecycle`, `include_advisories` (through `OPTIONAL_SECTIONS`), `has_lifecycle`, `has_lifecycle_devices`, `has_lifecycle_licences`, `has_lifecycle_contracts`, `has_advisories`.
    - Values: `lifecycle_summary`, `advisories_notice`, `advisories_more`.
    - Lists: `lifecycle_devices`, `lifecycle_licences`, `lifecycle_contracts` with fields `item`, `type`, `ends` (dd/mm/yyyy), `status`; `advisories` with fields `cve`, `product`, `severity`, `exploited` (`Yes` or `No`), `description`.

- [ ] **Step 1: Write the failing tests.**
  - In `managedReportDocx.test.js`, `the starter template has the lifecycle and advisories blocks`: assert the starter document's text contains `{#include_lifecycle}`, `{#lifecycle_devices}` and `{#advisories}`. The existing starter test must keep passing, since `validateTemplate` and the full fill check the new placeholders.
  - `a template made before these sections still works` (Review Focus 5): build a docx with only `{customer_name}` using `docx`, and assert that `validateTemplate` returns `{ ok: true }`.
  - In `customerValueReport.integration.test.js`, `the company Word template shows the sections only when ticked` (Review Focus 5):
    1. Upload the starter as the company template.
    2. Download Word with `sections: ['lifecycle', 'advisories']`. Assert that `word/document.xml` contains the seeded CVE number and `Technology lifecycle`.
    3. Download again with `sections: ['changes']`. Assert it contains neither.
    4. Remove the template afterwards, so the built-in layout used by other tests is restored.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/managedReportDocx.test.js test/customerValueReport.integration.test.js`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.** Starter template blocks go after the device list block, following its pattern:
  - `include_lifecycle`: heading `Technology lifecycle and support status`, then `{^has_lifecycle}Nothing has expired or ends within the next 12 months.{/has_lifecycle}`, then `{lifecycle_summary}`, then each group as a bold title followed by a `loopTable` inside its `has_` block.
  - `include_advisories`: heading `Security advisories for awareness`, then `{advisories_notice}`, then a `loopTable('advisories', …)` with columns CVE, Product, Severity, Actively exploited, Description. Then `{advisories_more}`, and the empty line under `{^has_advisories}`.

- [ ] **Step 4: Run them and see them pass.** Expected: PASS.

---

### Task 6: Screens — tick boxes, preview, Settings, product flag

**Files:**
- Modify: `client/src/components/CustomerReport.jsx` (`PARTS`, `BUILT_IN`, `Preview`)
- Modify: `client/src/pages/admin/ManagedReportTemplatesTab.jsx` (`SECTION_LABELS`, `HEADING_LABELS`, `EMPTY_LABELS`)
- Modify: `client/src/pages/Vulnerabilities.jsx` (watch table)
- Test: `client/e2e/customerReports.spec.js`, `client/e2e/vulnerabilities.spec.js`

**Interfaces:**
- Consumes: the report shape from Task 4; `in_advisories` from Task 1.
- Produces:
  - `PARTS` gains `['lifecycle', 'Technology lifecycle'], ['advisories', 'Security advisories']`. `SECTION_LABELS` gains the same labels. `HEADING_LABELS` and `EMPTY_LABELS` gain `lifecycle: 'Technology lifecycle'` and `advisories: 'Security advisories'`.
  - The watch table gains a column `In customer reports`: a checkbox with `aria-label={\`In customer reports: ${row.cpe_vendor} ${row.cpe_product || ''}\`.trim()}` calling `api.updateVulnerabilityWatch(row.id, { in_advisories })`.

- [ ] **Step 1: Write the failing e2e tests.**
  - In `customerReports.spec.js`, `lifecycle and security advisories can be ticked and are previewed`:
    - Give the mock `report(body)` `lifecycle` and `advisories` objects, set to `null` unless their key is in `body.sections`.
    - Tick `Technology lifecycle` and `Security advisories`. Assert the last preview request's `sections` contains both.
    - Assert the preview shows `Devices and firmware`, a row `FW-HQ-01`, the notice text, a CVE row, and its description.
  - In `vulnerabilities.spec.js`, `managers choose which products feed customer reports`:
    - Mock `GET /api/vulnerabilities/admin/status` with a `php` row where `in_advisories: true`, and a `fortinet` row where it is `false`.
    - Check `In customer reports: fortinet`. Assert the PUT body is `{ in_advisories: true }`.

- [ ] **Step 2: Run them and see them fail**

Run (from `client/`): `npx playwright test e2e/customerReports.spec.js e2e/vulnerabilities.spec.js`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.** The preview renders lifecycle as an `h3` and the `summary` line, then one `PreviewTable` per group with its title. It renders advisories as an `h3`, the notice in `text-muted text-sm`, and a table. Each CVE row is followed by a row whose single cell spans all columns and holds the description. `more` goes under the table. Use existing `crp-*` classes only.

- [ ] **Step 4: Run them and see them pass.** Expected: PASS.

---

### Task 7: Full verification and commit

- [ ] **Step 1:** Run `npm run lint` in `client/`. Expected: no errors.
- [ ] **Step 2:** Run `npm run build` in `client/`. Expected: build succeeds and `client/dist` is updated.
- [ ] **Step 3:** Run `npx playwright test` in `client/`. Expected: all pass.
- [ ] **Step 4:** Run `npm test` in `server/`, through the Bash tool, after Step 3 finishes. Expected: all pass, with PostgreSQL-only tests skipped locally.
- [ ] **Step 5:** Commit on `DEV-3` with the spec, this plan, the source and `client/dist`, leaving out `.superpowers/`. Write the message to a scratchpad file and commit with `git commit -F <file>`:

```
feat(reports): technology lifecycle and security advisories in the customer report

- Two optional sections on Customer 360 → Reports, in the preview, PDF, Word
  and the company Word template (new placeholders; the starter has them)
- Lifecycle: devices and firmware, licences and certificates, contracts that
  have expired or end within 12 months
- Advisories: CVSS above 9 for the products managers flag on the
  Vulnerabilities page; CISA's description is now stored

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
