# OpsWatch Stage 3 — Analysis: sub-sections, cross-instance queries, reports and audit

Owner request (2026-09-18): finish what matters most, analysing the data. In their words: sub-menus per section (databases → instances, queries…), a way to see the queries of every instance mixed together and where each one comes from, a report per section ("over the last 15 hours there was … which loads a lot"), and an audit that says by itself "this is not working", like the manual investigation done on their production account.

Stage 1 (connections) and Stage 2 (live pages: Overview, Containers, Databases, Load balancers, Alarms, Logs) are done. This stage adds the analysis layer on top of them. It reuses the existing IAM catalogue: no new action, no template version bump, nothing for the owner to redeploy.

## 1. Navigation: a second menu inside the page

The owner showed the Datadog pattern and asked for it: the left sidebar opens a section, and inside the page there is a second, section-specific navigation panel.

- **Left rail (existing sidebar):** stays as the list of sections (Overview, Containers, Databases, Load balancers, Alarms, Logs, Getting started, Accounts). On wide screens it keeps its labels; the collapse control is kept for later and is not part of this stage.
- **Section panel (new):** a vertical menu on the left of the page content listing the sub-pages of the section, with the active one highlighted, and a "Collapse" action at its bottom that reduces it to icons. The collapsed state is remembered per browser (localStorage), never on the server.
- **Page header (new, above the content):** a breadcrumb reading section › connection › sub-page, the region selector, the time range picker on the right, and the auto-refresh control where it applies. This replaces the header the monitoring pages have today, keeping every control they already carry.
- **Filter row (new, under the header, only where it applies):** the filters that belong to the section, for example the service search on Containers, the state and target-tracking filters on Alarms, the engine or role filter on Databases. Filters live in the URL as today, so a page stays shareable.
- Below 1024 px the section panel becomes a horizontal, scrollable strip of links above the content, so nothing overflows at 360 px.

Sub-pages per section:

| Section | Sub-pages |
|---------|-----------|
| Overview | Insights (current page), Audit |
| Containers | Services (current list), Report |
| Databases | Instances (current list), Queries (new), Report |
| Load balancers | Load balancers (current list), Report |
| Alarms | Alarms (current list), Report |
| Logs | Search (current page), Volume (new, log group volume and retention) |

URLs extend the existing scheme: `/<locale>/c/<connectionId>/<region>/<section>/<subsection>`; the section root redirects to its first sub-page, and the current pages keep their content there. Everything stays a plain link, so it works without JavaScript and keeps region, window and filters.

## 1b. Visual language: dense, colourful, filterable

The owner showed two more Datadog screens and asked for that density. This is the visual contract for every list and report page of this stage; the components are built once and reused.

- **Main rail collapsible to icons.** The left sidebar can shrink to icons only, with the labels as tooltips, remembered per browser. The section panel of §1 sits next to it.
- **Facets panel** on the left of the content, above or under the section panel depending on width: grouped filters with a count per value and checkboxes, so the user sees "state: ok 10, unreachable 1" before clicking. Facet groups per section: Containers by cluster, launch type, deployment state, CPU band; Databases by engine, class, role, Performance Insights on or off; Load balancers by scheme and state; Alarms by state, namespace and whether the alarm is a target-tracking one; Logs by retention set or not and by volume band. Selecting a value filters the table and keeps the URL shareable; counts always reflect the unfiltered set so the user can see what they are excluding.
- **Status bar**: one horizontal bar at the top of a list showing the proportion of resources per state, coloured, with the counts written on it ("3 degraded", "27 healthy"), clickable to filter.
- **KPI tiles**: a row of big-number tiles above the table (for example requests per second, error rate, average latency, tasks running), coloured by threshold (healthy, warning, critical) and each showing its window.
- **Top-N bars**: horizontal bars for rankings, used for the slowest endpoints of a load balancer, the heaviest statements, the biggest log groups, the services using the most CPU.
- **Heat grid**: a compact grid of tiles, one per resource, coloured by the metric, for a fleet at a glance (ECS services by CPU, instances by load). Hovering names the resource and its value; clicking opens it.
- **Charts with threshold bands**: the existing line charts gain optional healthy, warning and critical bands so a spike is readable without reading the axis.
- **Tables**: sortable columns, coloured state badges, compact numeric columns with units, a "showing X of Y" line, and a link on every resource name. Row density stays readable at 360 px by dropping the least important columns first.
- Colours come from the existing tokens (one accent plus the status colours) and keep WCAG AA contrast in both themes; colour is never the only signal, every state also has a label or an icon.

## 2. Databases → Queries (cross-instance)

The page the owner asked for: the SQL of every instance mixed together, with its source.

- Data: for each RDS instance in the region with Performance Insights enabled, `DescribeDimensionKeys` on `db.load.avg` grouped by `db.sql_tokenized`, over the selected window, top 25 per instance (the existing `topSql` function, called per instance and merged).
- Merge: group the per-instance rows by the tokenized statement (exact text match after trimming), summing the average active sessions weighted by each instance's window, so one row is one statement across the fleet.
- Columns: statement (truncated, expandable, text only), total load, share of total load, number of instances where it appears, and the per-instance breakdown as a small list "instance — load — share" sorted by load. Each instance name links to that instance's detail page.
- Also group by `db.user` and by `db.host` when the dimension is available, shown as two smaller tables under the main one, so "where does it come from" is answerable beyond the instance: which user and which client host drive the load.
- Sorting by total load by default, with a toggle for "most instances affected". Window selector shared with the rest of the section (1 h, 3 h, 12 h, 24 h, 7 d).
- Empty and partial states: instances without Performance Insights are listed under the table as "not covered", so the user knows the picture is incomplete. A denied or failing instance shows in the same list with its error code, never silently dropped.
- Cost: Performance Insights `DescribeDimensionKeys` is not billed per metric like GetMetricData, but each call is an API call per instance; results are cached 5 minutes as today.

## 3. Reports (one per section)

A report answers "what happened over the window, and what loaded the most". It is generated from the same data modules, with a longer default window (12 h; selector 3 h, 12 h, 24 h, 7 d) and a coarser period.

Every report has the same shape:
1. **Headline sentences**, generated from the data with ICU messages, for example "Over the last 12 hours, 3 services used more than 85 % CPU on average" or "seller-api handled 61 % of the requests and returned 412 errors with status 5xx". No free-form text generation: every sentence is a message key with placeholders, so both languages stay exact.
2. **Top table**: the section's resources ranked by the metric that matters (ECS services by average and peak CPU and memory; RDS instances by average CPU, connections and, when available, database load; load balancers by requests, 5xx and p95; alarms by time spent in ALARM; log groups by ingested bytes).
3. **Change against the previous window of the same length**: an arrow and a percentage per row, so a regression is visible. Computed from the same series, not a second set of calls.
4. **What to look at next**: the insight rules of Stage 2 evaluated over the report window, grouped as on the Overview, each linking to the resource.

Reports are read-only views; nothing is stored. The window and section are in the URL.

## 3b. Slowest endpoints, from the application logs

The Datadog screen the owner showed has a "slowest API endpoints" panel. CloudWatch metrics cannot give that: the load balancer reports latency for the whole target group, never per path. The only source in a read-only AWS account is the application's own logs.

So the Logs section gains an "Endpoints" sub-page, honest about what it needs:
- The user picks one or more log groups and a field mapping: which field holds the route or path, and which holds the duration in milliseconds. Two presets are offered, JSON logs with `path` and `duration_ms`, and the format of this owner's APIs (`route` and `duration`), and the mapping is remembered per connection in the local database, never the log content.
- OpsWatch then runs one Logs Insights query over the window: statistics on the duration field grouped by the route field, returning count, average, p95 and maximum, sorted by p95, limited to 50 rows, and renders it as the top-N bar list plus a table.
- The page states the scanned bytes and reminds that Logs Insights is billed per scanned gigabyte, and refuses windows longer than 24 hours, like the rest of the Logs section.
- When the mapping matches nothing, the page says so and shows the first lines it saw, so the user can fix the field names rather than guess.

## 4. Audit

One page under Overview that runs a catalogue of checks over the last 24 hours and lists findings, worst first, each with: title, severity (critical, warning, info), the resource, the evidence (the numbers that triggered it), and what to do about it. Findings are localized messages with placeholders, never generated prose.

Check catalogue (all read-only, all within the current IAM actions):

**Availability**
- ECS service running fewer tasks than desired, or a deployment that failed or has been in progress for more than 30 minutes.
- Target group with unhealthy hosts, or with no healthy host at all.
- Load balancer returning 5xx from the load balancer itself (no target could be chosen).

**Saturation**
- ECS service above 85 % CPU or memory on average, or above 95 % at peak.
- RDS instance above 80 % CPU, or with freeable memory below 5 % of the instance class memory, or with connections above 80 % of the class maximum when it can be derived.
- Aurora reader lagging more than one second.
- RDS instance whose database load exceeds its vCPU count, with the top statement named.

**Errors**
- Target 5xx rate above 1 % of requests over the window.
- Log group whose ingestion jumped more than three times against the previous window (a sign of an error loop).

**Cost and hygiene**
- Log group without a retention setting, with its stored size, since these grow forever.
- Log group ingesting a large share of the account total, named with its share.
- Load balancer with no requests over the window.
- Instance with Performance Insights disabled, so the database analysis is blind there.
- ECS cluster without Container Insights, so task counts are unavailable.
- Alarms: a resource with no alarm at all among the ones this audit flags.

**Permissions**
- Any service the connection cannot read, taken from the stored permission test, since a missing permission makes every other check partial.

The page states plainly when a check could not run, and why. A "Copy report" action puts the findings on the clipboard as Markdown, and a "Download" link returns the same Markdown as a file, so the owner can paste it into a ticket. Nothing is sent anywhere.

## 5. Architecture

- New server-only modules under `src/lib/analysis/`: `queries.ts` (cross-instance Performance Insights merge), `report.ts` (per-section aggregation, previous-window comparison, ranking), `audit.ts` (the check catalogue, pure functions over already-fetched data), `markdown.ts` (findings to Markdown).
- They consume the Stage 2 modules (`ecs.ts`, `rds.ts`, `pi.ts`, `elb.ts`, `alarms.ts`, `logs.ts`, `metrics.ts`, `insights.ts`) and the existing cache, timeouts and failure typing. No new AWS client, no new IAM action.
- Cost control: a report or audit run is bounded. Reports request at most 300 metric queries per section; the audit at most 500 in total, batched through the existing GetMetricData batching, with the 60 s cache shared with the live pages. Both state at the top how many resources they covered, and when a cap truncated the scope. Neither auto-refreshes.
- Pages stream per card as today: the heavy parts (per-instance Performance Insights, log volume) are their own Suspense boundaries.

## 6. Tests

- Unit: the merge of per-instance statements (same statement across instances, per-instance breakdown, weighting), the previous-window comparison arithmetic, each audit check against fixtures at and around its threshold, the Markdown rendering, and the caps.
- End-to-end against moto: sub-section tabs navigate and keep region and window; the Databases queries page shows the "not covered" list (moto has no Performance Insights); each report renders with the seeded data; the audit lists at least the seeded alarm and the log group without retention; the Markdown download returns a file.
- The existing suites keep passing; message parity stays enforced.

## 7. Definition of done

- Every section has its sub-pages and the tabs work at 360 px.
- The Databases queries page shows the fleet's statements with their per-instance origin on the owner's real account.
- Each section report renders over 12 hours with the headline sentences, the ranking and the change against the previous window.
- The audit lists findings with evidence and can be copied or downloaded as Markdown.
- Unit and end-to-end tests pass; lint, typecheck, build and the dead-code check stay clean; no new IAM action and no template version change.

## 8. Amendments after peer review (binding; they override the sections above where they conflict)

1. **No "time spent in ALARM".** `DescribeAlarms` returns the current state and when it changed, nothing historical, and the history call is not in the IAM catalogue. Alarms are ranked by "currently in ALARM, longest first" using `stateUpdatedAt`, and the wording says exactly that. Adding `cloudwatch:DescribeAlarmHistory` would need a template version bump and a stack update by the owner: recorded as a separate decision, not part of this stage.
2. **Cross-instance queries are honest about their scope.** The page shows "the statements visible in each instance's top 25", never claims a guaranteed fleet-wide ranking, and says so on the page. `topSql` takes the limit as a parameter (default stays 10 for the instance page, 25 here).
3. **Merge by digest, not by text.** Rows are merged on `db.sql_tokenized.id`; the truncated statement text (500 bytes from AWS) is only displayed. Different statements sharing a prefix can no longer collapse into one row.
4. **Share of load is labelled for what it is:** the share of the statements shown, not of the instance's total load, since the true total would cost another call per instance.
5. **Grouping is one at a time.** The Queries page groups by statement, by database user or by client host, chosen by the user, so it costs one Performance Insights call per instance per view, never three.
6. **Previous-window comparison:** metric-backed rows fetch a window of twice the selected length in the same call and split it in half locally, so the comparison costs nothing extra. The Performance Insights column carries no comparison arrow, because that would need a second call per instance.
7. **Audit arithmetic differs from the live rules.** Over a 24-hour window the audit measures the share of the window spent breaching and the worst 15-minute stretch, not the live "is it breaching right now" rule, so a service pegged for 18 hours and calm in the last minutes is still reported.
8. **Checks that were dropped or softened:**
   - Connections against the class maximum is dropped: the real limit lives in a parameter group we cannot read. The reports show peak connections (`Maximum`, not `Average`) instead.
   - "Resource with no alarm" checks metric alarms only and says so, since composite and metric-math alarms do not expose their dimensions.
   - "Log group without retention" is informational, gated on stored size, because compliance groups keep logs on purpose.
   - Aurora replica lag needs a sustained breach (at least three consecutive datapoints or five per cent of the window), not a single spike.
   - "Cluster without Container Insights" says only that historical task counts are missing; live counts still come from `DescribeServices`.
   - Instance classes missing from the memory table appear in a "not covered" list instead of being silently skipped.
9. **Metric identity pinned:** ingested volume is `AWS/Logs` `IncomingBytes` by `LogGroupName`. `storedBytes` from `DescribeLogGroups` is only used for the stored size and is labelled as possibly lagging by hours.
10. **Alarms report excludes target-tracking alarms by default**, with a toggle, as the Overview already does.
11. **Cost budget covers both axes.** Per page load: at most 300 metric queries and at most one Performance Insights call per instance. The audit: at most 500 metric queries in total, with log volume asking one query per group covering both windows, and it states how many resources it covered and where a cap truncated the scope.
12. **Build order, with a checkpoint after each phase.** Phase 1: shared primitives only (double-window split, caps and "N of M covered", the Markdown renderer, the facet and table primitives of §1b). Phase 2: the second menu and page header, the Queries page, and the Containers and Load balancers reports. Phase 3: the remaining reports, the Logs volume and Endpoints pages, and the audit last. If time runs short, the cut goes in that order, from the end.

## 9. Owner amendment: every section is a dashboard (binding)

After seeing the Datadog screens again, the owner asked for three things that override anything narrower above.

1. **Both menus can shrink.** The main rail collapses to icons with tooltips, and the section panel of §1 collapses to icons too. Both states are remembered per browser. On a narrow screen the section panel becomes the horizontal strip already described.
2. **The first page of every section is a dashboard for that category, not a bare list.** Its shape, top to bottom: a row of KPI tiles for the category, a status bar showing the split by state, two or three charts or a heat grid, a top-N ranking, then the dense filterable table, then the insights that concern this category. The list that exists today becomes the table inside that dashboard, keeping its filters and its links.
   - **Containers:** services, running against desired tasks, services above threshold, deployments in progress; heat grid of services by CPU; top ten by CPU and by memory; the services table; container insights.
   - **Databases:** instances, writers and readers, average CPU, peak connections, database load where Performance Insights is on; load per instance over time; top statements by load, which links to the Queries page; the instances table; database insights.
   - **Load balancers:** requests, error rate from 5xx, p95 response time, unhealthy hosts; requests and errors over time; top target groups by errors; the table; insights.
   - **Alarms:** in alarm, insufficient data, ok, and how many are hidden autoscaling alarms; the state bar; the alarms in alarm the longest; the table.
   - **Logs:** groups, volume ingested over the window, the biggest group, groups with no retention; volume over time; top ten groups by volume; the groups table with size, retention and a link that opens the search on that group.
   - **Overview:** one card per category with its headline numbers and its worst finding, each linking to that category's dashboard, plus the insights list and a link to the audit.
3. **Every page carries analysis, not only numbers.** Each dashboard states, in words built from its own data, what stands out: the resource that loads the most, what changed against the previous window, and what to look at next. The rule is the same as for reports: message keys with placeholders in both languages, never generated prose.
