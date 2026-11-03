# Large-data performance

How TeamHub keeps lists and searches bounded as data grows, and how to measure it
(review item I11).

## What is bounded

| Path | How |
| --- | --- |
| Asset search (search bar) | Asset names, hostnames, serials, tags, IPs, MACs and models are encrypted, so the database cannot match them. A blind index (`server/assetSearchIndex.js`) stores keyed hashes (HMAC with the field key) of 3-letter pieces of those fields. A search looks up the two rarest pieces of the term, confirms the rest for those few assets, limits them in SQL to customers the person may see, and decrypts only those. At most 2,000 candidates (the newest) are considered. Terms of 2 letters cannot use the index; they check at most the 1,000 newest assets. |
| Customer search in the search bar | Uses the existing customer blind index (`server/customerSearchIndex.js`) before decrypting. |
| Projects list | Task counts in one grouped query (not three subqueries per project); customer names are decrypted once per customer, and only for the page sent back (or all rows when searching by customer). |
| Project page | The activity feed loads with its tab. |
| Customer pickers in forms | Tasks, projects, maintenance visits and the calendar search customers (`CustomerSearchSelect`) instead of loading every customer. |
| Settings | Each section is its own download: the Settings page itself went from 221.7 KB to 16.6 KB of JavaScript (54 KB to 5 KB gzipped). |

The index is rebuilt on start-up for assets with no entry for the current key, so it
follows key rotation; hashes reveal no values. Existing query metrics (Settings →
System health) still show slow queries; there is no separate dashboard.

## Measuring

`server/scripts/benchmark-large-data.js` fills a **disposable** PostgreSQL database with
representative data and times the list and search requests (after 3 warm-up runs):

```bash
cd server
BENCH_DATABASE_URL=postgres://user:pass@localhost/teamhub_bench node scripts/benchmark-large-data.js
# sizes: BENCH_CUSTOMERS=1000 BENCH_ASSETS=20000 BENCH_TASKS=20000 BENCH_RUNS=30
```

It reports p50/p95 latency, the database queries and the decryptions per request, and
times the old asset search (decrypt every asset) for comparison.

## Results (14 Oct 2026, local PostgreSQL 16, one developer laptop)

1,000 customers, 20,000 assets (1.14 million index hashes), 20,000 tasks; 30 timed runs.

| Request | p50 | p95 | Queries | Decryptions |
| --- | --- | --- | --- | --- |
| Search: asset serial (manager) | 28 ms | 62 ms | 30 | 5 |
| Search: asset hostname (engineer) | 21 ms | 43 ms | 27 | 0 |
| Search: 2 letters (no index, bounded) | 478 ms | 517 ms | 26 | 6,024 |
| Customers: paged search | 70 ms | 89 ms | 9 | 0* |
| Customers: first page | 263 ms | 306 ms | 8 | 0* |
| Projects: first page | 131 ms | 167 ms | 5 | 25 |
| Tasks: first page | 55 ms | 65 ms | 11 | 25 |
| **Before:** asset search, full scan | 11,363 ms | 12,041 ms | 1 | 139,989 |

\* Customer rows are decrypted through `decryptCustomer`, which the count does not include.

Remaining hot spot: the customer list sorts by the (encrypted) name, so it decrypts
every customer the person may see; about 0.3 s at 1,000 customers.
