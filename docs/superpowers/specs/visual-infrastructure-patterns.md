# Visual infrastructure: the patterns worth taking, and the ones worth refusing

Written before implementation, from a set of Datadog marketing screenshots the operator collected as
references (ECS explorer and resource detail, EKS dashboard and container map, EC2 dashboard and host map,
live container list, log explorer). None of their branding, assets, copy or layout is reproduced. What
follows is the **information design** underneath them, restated in OpsWatch's own terms, with a verdict on
each: take it, adapt it, or refuse it.

The point of writing this down is that a reference is easy to imitate and hard to learn from. Six months
from now the question "why does the ECS page look like this" should have an answer other than "Datadog".

---

## The one principle that governs the rest

OpsWatch must be able to say **"everything here is healthy"** as loudly as it says "something is wrong".
Today almost all of its visual weight is spent on trouble, so a healthy estate renders as a blank page —
which reads as *"OpsWatch is not working"* rather than *"your infrastructure is fine"*.

But green is a claim, and this product does not make claims it has not measured. So:

> **Green is earned, never assumed.** A resource is green when it was evaluated, the evaluation was recent
> enough to still mean something, and the checks that ran passed. A resource nobody looked at is
> `unknown`. A resource whose last reading is too old is `stale`. Neither is green, and neither is red.

The absence of a problem row is *not* evidence of health — it is the absence of evidence. This is §2.4 and
§2.6 applied to colour, and it is the difference between a monitoring tool and a reassurance machine.

Concretely, five states, and every visual primitive in the product renders all five:

| State | Means | Colour |
|---|---|---|
| `healthy` | Evaluated, fresh, all checks that ran passed | Green |
| `warning` | Evaluated, fresh, at least one check is degraded | Amber |
| `critical` | Evaluated, fresh, at least one check failed badly | Red |
| `unknown` | Never evaluated, or the read failed | Neutral, outlined |
| `stale` | Evaluated once, but the reading is too old to stand for now | Neutral, outlined, with the age |

`unknown` and `stale` share a colour because they share a meaning — *OpsWatch cannot tell you* — but they
never share a word, because *nobody looked* and *we looked a long time ago* are different situations with
different fixes.

---

## Patterns taken

### 1. The grouped resource map (host map / container map)

**What it is.** Every resource in a section is one small tile. Tiles are gathered into labelled groups by
a dimension that matters — availability zone, cluster, instance type. Colour carries state. Hovering a
tile names it and gives its numbers; clicking drills into it.

**Why it works.** It answers "how much is there, and how much of it is wrong" in one glance, at a scale a
table cannot. Fifty green tiles with two amber ones is a sentence you read in half a second. And when
everything is green, the mass of green *is* the reassurance — the healthy state finally has visual weight.

**How OpsWatch does it.** Tiles are rectangles, not hexagons: hexagons are a signature, and they also make
alignment and hit targets worse. The grouping dimension is chosen per resource type and stated in words
above the map, not left to be inferred. Colour is the **evaluated health**, not a raw metric ramp — a
continuous yellow-to-red gradient of "CPU utilisation" looks like severity and is not, and it gives every
idle machine a reassuring pale colour it has not earned. Tiles for `unknown` resources are outlined and
unfilled, so a map of things nobody has read cannot be mistaken for a map of healthy things.

**Refused:** sizing tiles by a second metric. It is a clever idea that makes a map harder to scan and
introduces a second scale nobody has been told about.

### 2. The segmented count bar

**What it is.** A one-line stacked bar showing the composition of a set — running/pending/stopped,
healthy/unknown/unhealthy — with the count written beside each segment rather than only in a tooltip.

**Why it works.** It is a distribution and a set of exact numbers at once, in the height of a table row.
It is also the direct answer to "never make the reader infer what a number represents": the number is
next to the colour that defines it.

**How OpsWatch does it.** Every segment carries its count and its name; a zero segment is omitted from the
bar but kept in the accessible summary, because a missing segment must not read as an unmeasured one.

### 3. Metric cells with an inline micro-bar

**What it is.** A table cell that shows `62 %` and, behind or beside it, a small proportional bar.

**Why it works.** You can scan a column for outliers without reading a single number, then read the number
for the one that stood out. It is a sparkline's value at a fraction of its cost, and it needs no history —
only a value and a scale.

**How OpsWatch does it.** The bar is only drawn when the value has a *meaningful maximum*. A percentage
has one. A count of connections does not, and drawing a bar for it would invent a scale. When there is no
scale, the cell shows the number alone.

### 4. The chart paired with a top-N list

**What it is.** A time series answering *what is the shape of this*, immediately beside a horizontal bar
list answering *who is doing it*, for the same metric over the same window.

**Why it works.** The two questions always arrive together, and a chart of forty overlapping lines answers
only the first. This is the cheapest way to make a metric actionable.

**How OpsWatch does it.** The list is a ranked set of real subjects with links, so it is also a navigation
control: the answer to "who" is a click away from "then look at that one".

### 5. Drill-down as a panel over the list, not a page away from it

**What it is.** Selecting a row opens a detail panel above the list. The list stays visible and keeps its
scroll position and its filters.

**Why it works.** Investigation is comparison. An operator looking at one task is about to look at the
next one, and a full page navigation makes them rebuild their context each time.

**How OpsWatch does it.** The panel is a real, linkable route — a URL that can be shared and reloaded —
rendered over the list where the viewport allows and as its own page where it does not. The browser back
button returns to the list, which the existing E2E discipline already checks.

### 6. The identity grid

**What it is.** A resource detail opens with a row of small labelled cards: task definition, service,
cluster, launch type, age, platform. `LABEL` above, value below, each linking where a link exists.

**Why it works.** It answers "what am I looking at" before any metric, in a shape that scans. It also
makes the relationships enumerable — every link out of a resource is visible in one place.

**How OpsWatch does it.** A field OpsWatch could not read shows the label with an explicit *not available*
rather than being dropped, because a silently absent field reads as "this resource does not have one".

### 7. Tabs with a signal dot

**What it is.** `Metrics | Logs• | Events | Related` — a coloured dot on a tab that has something worth
opening.

**Why it works.** It turns tabs from a filing cabinet into a recommendation, which is what stops an
operator opening all of them in turn.

**How OpsWatch does it.** The dot means *measured*, never *probably*: it appears when a count is known and
greater than zero. A tab with nothing behind it is disabled with a reason, not hidden.

### 8. The relationship graph

**What it is.** Boxes for related resources, edges for the relationships, the current one highlighted.

**Why it works.** Containment and dependency are genuinely graph-shaped, and a breadcrumb flattens them.

**How OpsWatch does it.** **Only edges OpsWatch can prove.** An ECS task belongs to a service because the
ECS API says so; an EC2 instance serves a load balancer because the target group says so. Anything else —
"these two are probably related because their names are similar" — is not drawn. A missing edge is
correct; a guessed edge poisons everything else on the page.

### 9. The section band with a left gutter label

**What it is.** Related panels grouped into a horizontal band with the group's name in the gutter beside
them: `CPU`, `I/O`, `Network`.

**Why it works.** It gives a long dashboard a spine, and it costs one word per band rather than a heading
row per band.

### 10. Stating coverage in the page, not in the documentation

**What it is.** A line at the top of the reference container list admitting that only 3 % of agents were
reporting process data.

**Why it works.** It is the same instinct as §2.6, and it belongs in OpsWatch because OpsWatch will
frequently be partial: history off, a region unread, a family that failed to load.

---

## Patterns refused

### The wall of panels

The Kubernetes reference is thirty-odd small charts on one screen with no hierarchy, several of them
empty, and a note in the middle of the dashboard apologising that some graphs may be empty and explaining
what to install. It is a *list of available metrics*, not an answer to a question.

OpsWatch refuses this shape. A panel earns its place by answering a question an operator actually asks.
If a signal is not collected, the page says so once, in words, with a link to turn it on — it does not
render an empty axis.

### Colour as a metric ramp

Filling tiles with a continuous heat ramp of a raw metric makes idle resources look mildly warm and busy
healthy resources look dangerous. Colour in OpsWatch means evaluated state, and nothing else.

### Density for its own sake

The references are built for operators who use them daily. OpsWatch is also for the operator who opens it
after an alert at 3am, twice a year. Where the two conflict, OpsWatch chooses the second: progressive
disclosure, a stated default grouping, and no control whose meaning has to be learned before the page can
be read.

### Vanity numbers

"799 instances" is a bigger number than "11 healthy", and far less useful. Every headline figure in
OpsWatch is one somebody would act on.

---

## What this means for the build

The primitives come first, because ECS, EC2, Redis and Kubernetes should differ in *what they measure* and
not in *how they look*:

1. **The evaluated-health model** — five states, earned green, with the evidence of the evaluation stored
   so a healthy resource can explain itself.
2. **`ResourceMap`** — grouped, interactive tiles.
3. **`StatusBar`** — segmented counts with their numbers.
4. **`MetricCell`** — a value with an optional micro-bar.
5. **`TopList`** — ranked horizontal bars that are also links.
6. **`HealthySummary`** — the checks that actually ran, and when.
7. **`IdentityGrid`**, **signal tabs**, and the **proved-edges-only relationship view**.

Then ECS, EC2, Redis/ElastiCache and Kubernetes are each a question of which data OpsWatch can truthfully
obtain — answered per service, before any of them is designed.
