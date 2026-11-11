# Plan tiers and limits: GitHub Actions, Buildkite, RunJob (Puzl Cloud)

All pages fetched 2026-11-11 (retrieval date for every figure). USD unless stated; RunJob is EUR. WebFetch returns summarised page content, so figures are as reported by the fetch tool.

## GitHub Actions plans and limits

### Takeaway
GitHub bills Actions as a dollar allowance, not minutes: Free $12, Pro/Team $18, Enterprise Cloud $300 per month. Hosted-runner concurrency is 20/40/60/500 jobs; larger runners are Team/Enterprise only (1,000 jobs). Self-hosted runners cost nothing, with a 5-day job limit and 24h queue limit.

### Cited Findings

Plan table (price, included usage, concurrency, storage, support):

| | Free | Pro (personal) | Team | Enterprise Cloud |
|---|---|---|---|---|
| Seat price | $0 | Not on pricing page (unknown) | $4/user/mo | $21/user/mo |
| Included compute/mo | $12 | $18 | $18 | $300 (~50,000 Linux 2-core min) |
| Artifact+Packages storage | 500 MB | 1 GB (billing doc) vs 2 GB (plans doc) - conflict | 2 GB | 50 GB |
| Cache per repo | 10 GB | 10 GB | 10 GB | 10 GB |
| Custom image storage | N/A | N/A | 75 GB | 150 GB |
| Standard hosted concurrent jobs | 20 | 40 | 60 | 500 |
| Standard macOS concurrent | 5 | 5 | 5 | 50 |
| Larger runner concurrent jobs | N/A | N/A | 1,000 | 1,000 |
| Larger macOS concurrent | N/A | N/A | 5 | 50 |
| Larger GPU concurrent | N/A | N/A | 100 | 100 |
| Larger runners available | No | No | Yes | Yes |
| Support | Community | Community + email | Email (pricing page: web + Standard Support) | Enterprise Support; Premium add-on (30-min urgent SLA, 24/7) |
| Gated admin/security | 2FA, RBAC, audit log; secret scanning/CodeQL public repos only; env protection rules public repos only | Protected branches, code owners, required reviewers in private repos | Adds secret scanning, push protection, CodeQL, Copilot Autofix, dependency review for private repos (some via paid GHAS per plans doc); team reviewers; security overview | Adds SAML SSO, SCIM, Enterprise Managed Users, IP allow list, audit log API/streaming, GitHub Connect, environment protection on private repos, SOC 1/2 reports, FedRAMP Tailored ATO, data residency |

Sources: compute/storage - [billing doc](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions), [limits](https://docs.github.com/en/actions/reference/limits), [product billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions); concurrency - [limits](https://docs.github.com/en/actions/reference/limits); seat price/support/security - [github.com/pricing](https://github.com/pricing), [plans doc](https://docs.github.com/en/get-started/learning-about-github/githubs-plans).

Note: github.com/pricing still advertises minutes (Free 2,000, Team 3,000, Enterprise 50,000/mo) and packages 500 MB/2 GB/50 GB, while docs use dollars ($12/$18/$300). Both come from [github.com/pricing](https://github.com/pricing) vs [billing doc](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions). Docs conflict on Pro artifact storage: 1 GB vs 2 GB ([billing doc](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) vs [plans doc](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)).

Concurrency notes: macOS concurrency is shared between standard and larger runners; support can raise limits by ticket; storage limits cannot be raised by support - [limits](https://docs.github.com/en/actions/reference/limits).

Per-minute rates (all plans, same rate) - [pricing reference](https://docs.github.com/en/billing/reference/actions-runner-pricing):
- Standard: Linux 1-core $0.002; Linux 2-core x64 $0.006; Linux 2-core arm64 $0.005; Windows 2-core $0.010; macOS 3/4-core $0.062.
- Larger x64 Linux: 2c adv $0.006, 4c $0.012, 8c $0.022, 16c $0.042, 32c $0.082, 64c $0.162, 96c $0.252 (96 cores = max Linux x64).
- Larger x64 Windows: 4c $0.022, 8c $0.042, 16c $0.082, 32c $0.162, 64c $0.322, 96c $0.552. macOS 12-core $0.077.
- Larger arm64 Linux: 2c $0.005, 4c $0.008, 8c $0.014, 16c $0.026, 32c $0.050, 64c $0.098 (64 = max). Windows arm 64c $0.194. macOS 5-core M2 Pro $0.102.
- GPU: Linux 4-core $0.052; Windows 4-core $0.102.
- Minutes rounded up per job; larger runners not free for public repos; custom-image jobs billed at larger-runner rate.
- No page gives RAM per size (not fetched).

Time/queue limits - [limits](https://docs.github.com/en/actions/reference/limits):
- Hosted job: 6 hours. Self-hosted job: 5 days. Self-hosted queue: 24h then auto-cancel. Workflow run: 35 days. Environment approval gate: 30 days.
- Trigger events: 1,500/10s/repo. Workflow runs queued: 500/10s. Concurrency group queue (`queue: max`): 100.
- Matrix: 256 jobs per run. Workflow file 500 KB. Re-runs 50 per run. Check runs per suite 50,000.
- Cache API: 200 uploads/min, 1,500 downloads/min, 400 deletes/min per repo.
- Self-hosted: registrations 1,500 per 5 min; 10,000 runners per group; no per-plan runner count cap listed.
- Larger-runner static IPs: 10 per org/enterprise.

Storage, retention, overage:
- Cache: 10 GB default per repo, LRU eviction, caches unused >7 days removed; limit can be raised (opt-in with payment method; user-owned repos up to 10 TB) - [dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching). Overage $0.07/GB-mo; cache goes read-only if a budget is exceeded.
- Artifacts/logs: default 90 days; public 1-90 days; private 1-400 days (org/enterprise may cap) - [retention doc](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization). Overage $0.25/GB-mo (artifacts+Packages), accrued hourly.
- Self-hosted runners: free, do not consume included compute, no platform fee listed - [billing doc](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions).

### Inferences
- Enterprise Cloud $300 allowance at $0.006/min equals 50,000 Linux 2-core minutes, matching the old "50,000 minutes" marketing, so the dollar model is equivalent for Linux. Free's $12 = 2,000 Linux min, Team's $18 = 3,000 min, consistent with the pricing page.
- Larger runners are bought only on Team/Enterprise, and allowance dollars are spent at the larger rate, so the allowance buys proportionally fewer minutes on larger runners.

### Gaps
- Pro (personal) seat price: not on github.com/pricing; likely $4/mo but unverified.
- RAM/disk per larger-runner size: not fetched.
- Whether any per-plan concurrency of self-hosted runners exists: none listed.
- Support SLAs for Team: pricing page and plans doc differ slightly (web vs email).

## Buildkite

### Takeaway
Buildkite is per-active-user ($30 Pro) with hosted agents billed per vCPU-second; Free is capped at 5 users, 10 concurrent jobs, 2,000 vCPU-min. SSO is Pro and above; SCIM, audit/activity log, SLA are Enterprise-only.

### Cited Findings
Source for all rows: [buildkite.com/pricing](https://buildkite.com/pricing), retrieved 2026-11-11.

| | Free | Pro | Enterprise |
|---|---|---|---|
| Price | $0 | $30/active user/mo | Custom (30-user minimum) |
| Active users | Up to 5 | Up to 50 | Unlimited |
| Concurrency | Up to 10 concurrent jobs | Up to 250 concurrent agents; 10 included, then $3.50/agent/mo | Unlimited self-hosted agents, custom limits |
| Included hosted minutes | 2,000 Linux AMD64 vCPU-min/mo | 4,000 vCPU-min/mo then pay-as-you-go | Volume discounts |
| Max hosted size | Up to 20 vCPU concurrent, Small (2 vCPU) only | Up to 256 vCPU Linux AMD64; Small/Medium/Large (2/4/8 vCPU); ARM64 up to 64 vCPU; Windows up to 64; M4 Mac up to 48 vCPU (Medium 6/Large 12) | Larger sizes on request; remote Docker builds |
| Build retention | 30 days | 90 days | 1 year + historical export |
| Artifact retention / storage | 30 days / 50 GB/mo | 30 days / 250 GB/mo (+$0.05/GB-mo) | Custom |
| Artifact downloads | 250 GB/mo | 2.5 TB/mo (+$0.10/GB) | Custom |
| Test executions | 250k/mo; 24h history | 1M/mo (+$15/M); 7-day history | Custom; 28-day history |
| Package registries | 1 GB | 20 GB | Custom |
| Support | Community | Priority email | SLA credits, priority response, Slack Connect; 99.95% uptime |
| Security/admin | GitHub auth | + SSO, signed pipelines | + SCIM, custom SAML/ADFS, private log storage, activity log, inactive-user list, token revocation, SSO IP pinning, pipeline templates, GHES support, SLSA provenance, member permissions |

Hosted rates (Pro, per vCPU-minute): Linux $0.004 (Small $0.008/min, Medium $0.016, Large $0.032); Windows $0.008 (Small $0.016, Medium $0.032, Large $0.064); Mac $0.02 (M4 Medium $0.12/min, Large $0.24). Per-second metering, no minimum, startup/shutdown unbilled - [pricing](https://buildkite.com/pricing).

Hosted-agent limitations: US East Coast data centers only; best-effort priority; environment destroyed after job; signed-pipeline validation unsupported; cache volumes carry no extra charge, no quotas stated; no max concurrency stated - [hosted agents docs](https://buildkite.com/docs/pipelines/hosted-agents).

### Inferences
- Self-hosted agent count on Free is limited to 10 jobs, so a 10-concurrent-job benchmark fits Free but not beyond.

### Gaps
- Rate-limits page returned empty; API/rate limits unknown.
- Whether "10 concurrent jobs" on Free applies to both hosted and self-hosted agents is not explicit.

## RunJob by Puzl Cloud (runjob.eu; runmyjob.io 301-redirects to runjob.eu)

### Takeaway
RunJob has Free (EUR 0), Business (EUR 50/mo) and custom Enterprise. Overage is EUR 0.00002 per vCPU-second and EUR 0.000001 per GB-second. GitHub support is organization accounts only.

### Cited Findings
Source: [runjob.eu](https://runjob.eu/) (runmyjob.io redirects there), retrieved 2026-11-11. Prices EUR, excluding tax; the site's cost chart is labeled illustrative.

| | Free | Business | Enterprise |
|---|---|---|---|
| Price | EUR 0 | EUR 50/mo (14-day trial) | Custom |
| Integrations (GitHub/GitLab orgs) | 1 | 3 | Custom |
| Runners per integration | 1 | 3 | Custom |
| Concurrent jobs | 10 | Unlimited | Unlimited |
| Max per job | 12 vCPU / 32 GB | 48 vCPU / 96 GB | Custom |
| Included vCPU-min/mo | 400 | 2,000 | Not listed |
| Included GB-min/mo | 800 | 4,000 | Not listed |
| Persistent storage | None | 10 GB included | Custom |
| Job cache | No | Yes | Yes |
| GPU | No | No | Yes |
| Support | None | Ticket, 1 business day | Priority |
| Other | GitLab 2 service containers; ephemeral 100 GB (GitLab) / 150 GB (GitHub) | 10 service containers; same ephemeral; interactive terminal | Dedicated nodes, job region choice |

- Overage: CPU EUR 0.00002/vCPU-s (= EUR 0.072/vCPU-hour, EUR 0.0012/vCPU-min); memory EUR 0.000001/GB-s (= EUR 0.0036/GB-hour); persistent storage EUR 0.00000006/GB-s beyond 10 GB (Business). Billing based on actual use; idle CPU not billed. Each job runs in its own isolated VM.
- GitHub: org accounts only (no personal repos); github.com and GHES supported; `runs-on: runjob-ubuntu-latest` - [runjob.eu/docs](https://runjob.eu/docs).
- "Coming soon": local Docker layer cache, Windows, ARM nodes (listed ambiguously).
- "5x cheaper, 2x faster" is a vendor marketing claim without benchmarks.

### Inferences
- Included Business allowance (2,000 vCPU-min) is small: a 4-vCPU job running 500 minutes exhausts it; most real usage is overage.

### Gaps
- /pricing and puzl.cloud/runjob returned 404; Resources and Billing and Security docs pages were not fetched.
- Enterprise rates, retention of logs/artifacts, SSO/audit features: not found.
- Free-plan includes "1 runner" per integration: whether that caps concurrency below 10 is unclear.
