# Customer report: technology lifecycle and security advisories

Date: 2026-11-09
Status: content approved by the user on 2026-11-09; moved to Customer 360 → Reports at the user's choice, awaiting a check of that change

## Intent

Customers should get more from their report than a record of past work. Two new sections give them input they can act on or be aware of:

- **Technology lifecycle and support status** tells them what is expired or ending, so they can plan renewals and replacement budgets.
- **Security advisories** tells them about significant vulnerabilities in common technologies, for information only.

## Goals

- Add both sections to the customer report at **Customer 360 → Reports** (`customerValueReport.js`), in the on-screen preview, PDF and Word, and through the company Word template.
- Work for customers with no monitored devices, such as cloud or M365 customers.
- Reuse data the app already holds; the only new data is what CISA's feed already sends and the app discards.

## Non-goals

- **Capacity and performance trends.** This is a separate project. The app stores no capacity data today and LibreNMS is not integrated. Whether its API can return the averages needed is unconfirmed.
- **The older managed report outputs** (`/report.docx`, `/report.pdf`, `/report.xlsx`, `/report-preview`) and their built-in renderers. No screen calls them.
- **A review step.** Customer 360 → Reports has none today. Adding one is separate work.
- **Per-customer CVE matching, exposure, mitigation status or required actions.** The advisory list is general.

## Anti-goals

- The advisories section must not read as an assessment of the customer's environment.
- The look of the app must not change. New controls follow existing patterns.
- Existing uploaded Word templates must keep working unchanged.

## Approaches considered

| Option | Trade-off |
|---|---|
| Add to Customer 360 → Reports (**chosen by the user**) | Reaches customers through the report in use today; no formal review, though the person generating it sees a preview and can untick a section |
| Rebuild the managed report screens and review step, then add the sections there | Reviewed reports, but a much larger separate project that delays the sections |

The user first chose "managed report only", on the description that it was a report with a review step. Reading the code for the plan showed no screen can generate that report or submit one for review, so the user chose again.

## Choosing the sections

- Two new tick boxes on Customer 360 → Reports and in Settings → Customer report template: `lifecycle` and `advisories`.
- **Both are off by default** (builder's call), like the existing device list. The company turns them on once in Settings, or per report. Saved templates are unaffected until someone ticks them.
- Headings and empty-section messages are editable in Settings, like every other section.

## Section 1: Technology lifecycle and support status

Layout chosen by the user: **grouped by kind of item**, in three groups, each a table with Item, Type, Ends, Status.

| Group | Source | Type values |
|---|---|---|
| Devices and firmware | `customer_assets.support_end_date`, `warranty_expiry_date`; firmware from the software version tracking in `softwareCompliance.js` | Support, Warranty, Firmware |
| Licences, subscriptions and certificates | `customer_licences` | Licence, Subscription, Certificate |
| Contracts | `customer_contracts` | Contract |

Rules:

- The opening line states the count: "7 items have expired or end within the next 12 months."
- Within a group, soonest date first.
- Status is one of: Expired, Within 90 days, Within 12 months.
- All dates are measured from the **report period's end date**, as the existing device list does, so regenerating a period gives the same answer.
- A group with no items is left out. If nothing at all is due, one line says so.
- Items marked as not renewing still appear, because the customer should know they are ending.
- Only assets still in use appear (not retired or decommissioned). Firmware appears only for products the app tracks.

Builder's calls, marked so they can be checked:

- *12-month window:* proposed during design and accepted.
- *How far back "expired" goes:* an active device stays listed however long ago its support ended, since it is still a live problem. Licences and contracts that expired more than 12 months before the period end are dropped as stale.
- *Renewed items:* a contract that has been renewed does not appear; its renewal does. A renewed licence shows its current expiry date.

The existing device list section stays as it is. The user wants the full list kept alongside the new section.

## Section 2: Security advisories

Layout accepted from the mockup: each entry is a row with CVE, Product, Severity, Actively exploited, followed by a row with the full description.

Content:

- **The same list for every customer**, with no reliance on asset records.
- **In the list:** CVEs with a CVSS score above 9 (the user's rule, applied to every entry), published in the report period or added to CISA's exploited list in the period. An exploited CVE scoring 9 or below does not appear, and neither does a CVE NVD has not scored yet. A score of exactly 9.0 does not appear.
- **Order:** exploited first, newest first; then the rest, highest score first.
- **At most 10 entries**, and no more than 3 per product (builder's call, so one busy product cannot take all 10 places). When more qualify, a line says "Showing the 10 most significant of N."
- **Description:** full official text, not shortened. CISA's short description for exploited CVEs, falling back to NVD's; NVD's for the rest.
- **Severity:** rating and score, for example "Critical 9.8".
- **Fixed wording above the list:** "General information about significant vulnerabilities published in this period. This list is not an assessment of your environment."
- **Empty period:** one line saying no significant advisories were published.

Which products the list covers: **one company-wide list of common technologies customers run on their servers**, such as PHP and Windows Server. Only CVEs for products on this list appear. A manager adds a product if it starts to matter. A customer may not run every product listed, which is why the fixed wording matters.

### Data changes

- `cve_kev` gains `vendor`, `product` and `short_description`, filled by `syncKev` from CISA's `vendorProject`, `product` and `shortDescription` fields.
- `cve_watch` gains a flag marking the products that feed the advisories section, and `label` gives the name shown in the report. Asset-derived rows are not flagged automatically, because they vary with customers' assets and the list is meant to be general.
- Seed the flagged list with Linux kernel, VMware ESXi, PHP, Windows Server and the SQL products. Watch by product, because the sync refuses a vendor as large as Microsoft. NVD lists each Windows Server release as its own product, so each supported release needs its own entry, shown under the single name "Windows Server". The exact NVD product names need checking when building.
- Managers maintain the flagged list on the existing Vulnerabilities admin table, with one new control per row.

## Where it plugs in

- A new `server/reportInsights.js` builds both sections. `customerValueReport.buildValueReport` calls it for the preview and built-in PDF and Word, and `buildReportModel` calls it for the Word template path.
- `customerValueReport.js`: add both to `SECTIONS` (not `DEFAULT_SECTIONS`), to `WORDING_DEFAULTS` headings and empty messages, and to `tablesOf` so PDF and Word both draw them.
- `CustomerReport.jsx` and `ManagedReportTemplatesTab.jsx`: tick boxes, preview, labels.
- `managedCustomerReportingService.js`: add both to `SECTION_KEYS`. Add them to the `picked` map in `routes/managedCustomers.js`.
- `managedReportDocx.js`: add both to `OPTIONAL_SECTIONS`, add the new placeholders to `PLACEHOLDERS` (uploads are rejected otherwise), and map them in `templateData`. The placeholders are `include_lifecycle`, `include_advisories`, loops for the three lifecycle groups and the advisories, and `has_` flags. Add both sections to the starter template; the placeholder reference in Settings follows automatically.

## Constraints

- A template without the new placeholders still works and simply does not show the sections. Adding them to an existing template is a manual step in Word.
- The first sync after adding a large product such as the Linux kernel downloads many CVEs, and is slow without an NVD API key.
- Lifecycle accuracy depends on the dates recorded. A missing date means the item does not appear, and the report does not flag it.
- A downloaded report is archived as a file in report history, so a later CVE sync cannot change that copy.

## Left to the builder

- Exact code layout and query shape, and how a full-width description row is drawn in PDF and Word.
- Tests: server tests for selection, ordering, both caps and date windows; a template render test; e2e tests for the tick boxes, preview and settings control. Tests needing joins beyond pg-mem use `pgOnly`.
- Repo rules apply: commit on `DEV-3`, rebuild `client/dist`, and run lint, client build, e2e and server tests before committing.
