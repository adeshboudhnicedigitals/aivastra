# Namespace, Depot, BuildJet: GitHub Actions runner pricing (retrieved 2026-11-11, USD)

Note: all figures were obtained via WebFetch, which summarizes pages with a small model, so exact numbers are summarizer-reported, not verbatim. Re-verify before committing to a purchase.

## Per-minute price for 2/4/8/16 vCPU Linux x64 and ARM (plus Windows/macOS)

### Takeaway
Depot is the simplest flat rate card: $0.006/min per 2 vCPU, linear in vCPU, with ARM identical to x64. Namespace is cheaper per vCPU but works on prepaid "unit minutes" (about $0.001 per vCPU-min when prepaid, $0.0015 on overage), and its 2 GB/vCPU shapes are not the same RAM as Depot's 4 GB/vCPU. BuildJet is shut down (jobs stopped 2026-03-31), so its prices are historical only.

### Cited Findings

**Depot** (per-minute list/overage price; also the rate at which included minutes are consumed via multiplier)
- x64 Linux (`depot-ubuntu-24.04[-N]`): 2 vCPU/8 GB $0.006; 4/16 $0.012; 8/32 $0.024; 16/64 $0.048; 32/128 $0.096; 64/256 $0.192. Included-minute multipliers 1x/2x/4x/8x/16x/32x. — [Depot runner types](https://depot.dev/docs/github-actions/runner-types) (retrieved 2026-11-11)
- ARM Linux (`depot-ubuntu-24.04-arm[-N]`, AWS Graviton4): same prices and multipliers as x64. — [Depot runner types](https://depot.dev/docs/github-actions/runner-types); CPU detail (x86 = 4th Gen AMD EPYC Genoa, ARM = Graviton4) from [Depot GHA overview](https://depot.dev/docs/github-actions/overview)
- Windows (`depot-windows-2025`/`2022`): 2 vCPU/8 GB $0.008; 4/16 $0.016; 8/32 $0.032; 16/64 $0.064; 32/128 $0.128; 64/256 $0.256. Page lists multipliers 2x/4x/8x/16x/32x/64x. — [Depot runner types](https://depot.dev/docs/github-actions/runner-types)
- macOS (`depot-macos-26`/`-latest`, `-15`, `-14`): $0.08/min, 8 vCPU/24 GB, no multiplier listed. — [Depot runner types](https://depot.dev/docs/github-actions/runner-types)
- Pricing page states base overage rate $0.006/min for the 2-vCPU Linux runner; runner sizes 2 to 64 vCPU; Linux, Windows, macOS on all plans; GPU runners Business only. — [Depot pricing](https://depot.dev/pricing), [Depot GHA overview](https://depot.dev/docs/github-actions/overview)

**Namespace** (unit minute = 1 vCPU + 2 GB RAM for 1 minute; units = vCPU x minutes x platform multiplier; non-standard RAM: units = max(vCPU, GB/2)). Prepaid vs overage per minute:
- Linux amd64/arm64 (multiplier 1; same price for both archs per page): 2 vCPU/4 GB $0.002 / $0.003; 4/8 $0.004 / $0.006; 8/16 $0.008 / $0.012; 16/32 $0.016 / $0.024; 32/64 $0.032 / $0.048; 64/128 $0.08 / $0.12 (80 units, not 64). Higher-RAM variants cost more, e.g. 4/16 $0.008 / $0.012, 8/32 $0.016 / $0.024. — [Namespace pricing](https://namespace.so/pricing) (retrieved 2026-11-11)
- Windows (multiplier 2): 2/4 $0.004 / $0.006; 4/8 $0.008 / $0.012; 8/16 $0.016 / $0.024; 16/32 $0.032 / $0.048. Page also says Windows is included in Team and Business plans. — [Namespace pricing](https://namespace.so/pricing)
- macOS Apple Silicon (multiplier 10): 4 vCPU/7 GB $0.04 / $0.06; 6/14 $0.06 / $0.09; 8/14 $0.08 / $0.12; 12/28 $0.12 / $0.18; 16/28 $0.16 / $0.24; 16/56 $0.20 / $0.30. — [Namespace pricing](https://namespace.so/pricing)
- Linux on Apple Silicon (arm64, early access, multiplier 7): 2/4 $0.014 / $0.021; 4/8 $0.028 / $0.042; 8/16 $0.056 / $0.084; 16/32 $0.112 / $0.168. — [Namespace pricing](https://namespace.so/pricing)
- Namespace docs page for GitHub Actions lists no prices. — [Namespace GHA docs](https://namespace.so/docs/solutions/github-actions)

**BuildJet** (HISTORICAL; service shut down)
- Cached/stale pricing page (no shutdown notice on it) lists AMD x64 / ARM per minute: 2 vCPU $0.004 / $0.004; 4 $0.008 / $0.008; 8 $0.016 / $0.016; 16 $0.032 / $0.032; 32 vCPU $0.048 (x64, 64 GB) / $0.064 (ARM). RAM x64: 8/16/32/64/64 GB; ARM: 3/6/12/24/48 GB. — [BuildJet pricing](https://buildjet.com/for-github-actions/pricing) (retrieved 2026-11-11; stale, see below)
- No Windows or macOS runners were found on that page. Ubuntu 20.04 and 22.04 only. — [WarpBuild: BuildJet shutting down](https://warpbuild.com/blog/buildjet-shutting-down)

### Inferences
- Per-vCPU-minute (comparable shape): Depot x64/ARM $0.003; Namespace prepaid $0.001 (2 GB/vCPU shape) / overage $0.0015; BuildJet was $0.002. Depot's shapes carry 4 GB/vCPU, Namespace's cheapest shape 2 GB/vCPU. Namespace shapes with 4 GB/vCPU (e.g. 4/16) cost $0.002/vCPU-min prepaid, still below Depot.
- Depot's Windows listing is internally inconsistent (2x multiplier but price only 1.33x of Linux, and 2x of base 2vCPU would be $0.012). Treat Windows pricing as needing manual re-check.

### Gaps
- Depot macOS multiplier not published on the page fetched; Depot Windows rate possibly mis-summarized.
- Namespace Linux ARM vs x64 price parity is inferred from the table header "Linux (amd64/arm64)".
- No independent confirmation of any figure beyond the vendors' own pages.

## Plan tiers, included minutes, subscription fees, concurrency

### Takeaway
Depot: $20 Developer / $200 Startup, unlimited concurrency. Namespace: pay-as-you-go Developer ($0), Team $100/mo, Business $250/mo, with unit-minute allowances and larger instance caps. BuildJet: one-time $5 credit and paid concurrency extensions, but it is closed.

### Cited Findings
- Depot Developer $20/mo: 2,000 GitHub Actions minutes, 2,000 sandbox minutes, 500 container build minutes, 25 GB cache/registry, 1 user, community support. — [Depot pricing](https://depot.dev/pricing)
- Depot Startup $200/mo: 20,000 GHA minutes, 20,000 sandbox minutes, 5,000 container build minutes, 250 GB storage, unlimited users, RBAC, email support. SAML/SCIM SSO optional +$500/mo on Startup. — [Depot pricing](https://depot.dev/pricing)
- Depot Business: custom; dedicated infra, GPU builds, static IPs, PrivateLink, SSO, audit logs, AWS Marketplace billing. — [Depot pricing](https://depot.dev/pricing)
- Depot: no concurrency limits (unlimited parallel jobs); usage caps available on all plans. — [Depot GHA overview](https://depot.dev/docs/github-actions/overview), [Depot pricing](https://depot.dev/pricing)
- Depot overage: $0.006/min base (2 vCPU Linux); larger sizes consume included minutes via multiplier. — [Depot pricing](https://depot.dev/pricing)
- Namespace Developer: $0, pay as you go, no included unit minutes; max Linux 32 vCPU, macOS 12 vCPU; max instance 3 hrs; 30-day free trial. — [Namespace pricing](https://namespace.so/pricing)
- Namespace Team $100/mo: 100,000 unit minutes (shared CI + remote builds), 1,000 Docker builds; Linux up to 64 vCPU, macOS 24; max 5 hrs. — [Namespace pricing](https://namespace.so/pricing)
- Namespace Business $250/mo: 250,000 unit minutes, 2,500 Docker builds; Linux up to 160 vCPU, macOS 48; up to 24 hrs; 30-day audit retention; dedicated Slack. — [Namespace pricing](https://namespace.so/pricing)
- Namespace Enterprise: custom; SSO, audit export, dedicated egress pools, custom concurrency. — [Namespace pricing](https://namespace.so/pricing)
- Namespace concurrency: no explicit concurrency cap number published (only per-instance vCPU caps by plan; Enterprise has custom concurrency). — [Namespace pricing](https://namespace.so/pricing), [Namespace GHA docs](https://namespace.so/docs/solutions/github-actions)
- BuildJet (stale page): one-time $5 free credit; default concurrency 64 AMD vCPU + 32 ARM vCPU; Concurrency Extension +100 vCPU for $300/mo. — [BuildJet pricing](https://buildjet.com/for-github-actions/pricing)
- BuildJet status: announced shutdown 2026-02-06, new signups halted, all concurrency subscriptions became free that day, jobs stop running 2026-03-31; `buildjet-*` labels fail after that. — [WarpBuild](https://warpbuild.com/blog/buildjet-shutting-down); corroborated by search summary citing [Tenki](https://www.tenki.cloud/blog/migrate-buildjet-to-tenki-runners) and [RunsOn](https://runs-on.com/blog/buildjet-shutting-down-runson-alternative/). Reason attributed (by secondary accounts, not verified from BuildJet): GitHub's faster/larger/native ARM runners closed the gap; RunsOn disputes this.

### Inferences
- Namespace Team's 100,000 unit minutes = 100,000 vCPU-minutes of 2 GB shapes, effectively $0.001/unit; Business is $0.001/unit as well ($250/250k). Overage is $0.0015/unit.
- Depot Startup effective included rate: $200 / 20,000 min = $0.01 per 2-vCPU-minute-unit, which is worse than the $0.006 overage rate, so the subscription is mostly a platform fee, not a discount (derived; confirm in the account).

### Gaps
- No BuildJet current pricing exists (service closed); the page content retrieved is stale.
- Depot "usage caps" and exact plan-minute definition for GHA vs sandbox pools not detailed.

## Cache, storage, egress, Docker build, add-ons

### Takeaway
Both Depot and Namespace charge $0.20/GB-month for storage beyond included amounts. Namespace has extra metered cache-volume pricing and a per-build Docker fee; Depot meters container builds in minutes. Neither lists per-GB egress.

### Cited Findings
- Depot cache/registry storage: $0.20/GB/mo overage; included 25 GB (Developer), 250 GB (Startup); cache speeds up to 1000 MiB/s, scoped by repo. — [Depot pricing](https://depot.dev/pricing), [Depot GHA overview](https://depot.dev/docs/github-actions/overview)
- Depot container builds: $0.04/min (default 16-vCPU builder); Startup/Business 16 to 64 vCPU builders, Developer limited to 16. — [Depot pricing](https://depot.dev/pricing)
- Depot sandbox/CI compute: $0.00005 per second per vCPU (about $0.003/vCPU-min), measured at 2 vCPU for included minutes. Test results $0.000001 per passing test (1M included). Standard CDN transfer free; Fast CDN price not captured. — [Depot pricing](https://depot.dev/pricing)
- Namespace Docker builds: Developer $0.05/build; Team 1,000 included then $10/1,000; Business 2,500 included then $10/1,000. — [Namespace pricing](https://namespace.so/pricing)
- Namespace cache volumes: snapshots $0.002/GB-hr (free: 5,000 GB-hr Team, 15,000 Business); storage $0.0048/GB-day (free: 3,000 GB-day Team, 9,000 Business); billed in 100 GB blocks; cost = attached capacity x runtime hours. — [Namespace pricing](https://namespace.so/pricing)
- Namespace container registry, Turborepo cache, GitHub Artifacts, Gradle cache: $0.20/GB-month. — [Namespace pricing](https://namespace.so/pricing)
- Namespace Bazel: cache hits $0.10/1,000; CAS storage $0.20/GB-month; included traffic = greater of 100 GB or 2 GB per 1,000 AC hits, extra $100/TB. Devbox minute $0.004; Devbox Plus $250/mo. — [Namespace pricing](https://namespace.so/pricing)
- BuildJet cache: 20 GB free per repo per week (oldest evicted); no paid cache price listed. — [BuildJet pricing](https://buildjet.com/for-github-actions/pricing)

### Inferences
- A cache-volume attached at 100 GB for a 10-minute job on Namespace costs roughly 100 x (10/60) x $0.0048/24 ~ negligible per run, but free-tier GB-hr/GB-day allowances only apply on Team and up (derived; verify).

### Gaps
- No egress per-GB prices found for any of the three. Namespace lists only "dedicated egress pools" (Enterprise, no price). Namespace Enterprise Support add-on price not listed.

## Billing rounding and gotchas

### Takeaway
Namespace bills in whole minutes with a quirky 15-second grace rule and a 1-minute minimum; Depot tracks per second with no per-run minimum but invoices whole minutes in aggregate.

### Cited Findings
- Namespace: 1-minute minimum; a partial minute rounds down if under 15 s past the full minute, otherwise up (examples: 30 s to 1 min, 70 s to 1 min, 150 s to 3 min). — [Namespace pricing](https://namespace.so/pricing)
- Depot: usage tracked per second, no 1-minute minimum per run; totals billed in whole minutes at the end of the billing period (aggregate rounding rule not stated). — [Depot GHA overview](https://depot.dev/docs/github-actions/overview)
- Namespace: oversized shapes cost more, observe a few runs before sizing; cache shared across all users of a runner profile including branch runs (poisoning risk); cache misses expected before main merge. — [Namespace GHA docs](https://namespace.so/docs/solutions/github-actions)
- Namespace "prepaid vs overage" split: overage is 1.5x prepaid price. — [Namespace pricing](https://namespace.so/pricing)
- Depot Windows/macOS multipliers and price listing conflict with the base-rate logic (see above). — [Depot runner types](https://depot.dev/docs/github-actions/runner-types)
- BuildJet: not SOC2 compliant per WarpBuild (competitor claim); product described as unchanged for 2.5+ years (competitor claim); any reusable workflow/composite action hardcoding `buildjet-*` labels will fail (Tenki advice). — [WarpBuild](https://warpbuild.com/blog/buildjet-shutting-down)

### Inferences
- For short jobs (e.g. 20-40 s lint steps), Depot's per-second tracking avoids Namespace's 1-minute-minimum overhead.

### Gaps
- Depot FAQ answers on rounding were not retrievable. Whether Namespace's Developer plan has any minimum monthly spend after the trial is not stated.
