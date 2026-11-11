# Baseline GitHub-hosted runner pricing, Buildkite, runmyjob

All pages retrieved 2026-11-11 via WebFetch/WebSearch (summarised by a fetch model; spot-check exact figures before publication). USD.

## GitHub-hosted runners: per-minute rates (Linux/Windows/macOS/ARM/GPU)

### Takeaway
Linux x64 is $0.006 (2 vCPU), $0.012 (4), $0.022 (8), $0.042 (16) per minute; Linux ARM is cheaper at $0.005/0.008/0.014/0.026. Windows costs roughly 1.7-2x Linux, macOS $0.062+ per minute.

### Cited Findings
- Standard: Linux 1-core x64 $0.002; Linux 2-core x64 $0.006; Linux 2-core arm64 $0.005; Windows 2-core x64 and arm64 $0.010; macOS 3/4-core (M1/Intel) $0.062 — [GitHub Docs: Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- x64 larger Linux: 2-core Advanced $0.006; 4-core $0.012; 8-core $0.022; 16-core $0.042; 32-core $0.082; 64-core $0.162; 96-core $0.252 — same page
- x64 larger Windows: 4-core $0.022; 8-core $0.042; 16-core $0.082; 32-core $0.162; 64-core $0.322; 96-core $0.552 — same page
- macOS larger: 12-core (x64) $0.077; 5-core M2 Pro (xl, arm64) $0.102 — same page
- arm64 Linux: 2-core $0.005; 4-core $0.008; 8-core $0.014; 16-core $0.026; 32-core $0.050; 64-core $0.098 — same page
- arm64 Windows: 2-core $0.008; 4-core $0.014; 8-core $0.026; 16-core $0.050; 32-core $0.098; 64-core $0.194 — same page
- GPU: Linux 4-core $0.052; Windows 4-core $0.102 — same page
- Rounding: each job's usage rounds up to the nearest whole minute — same page
- Hosted rates dropped by up to 39% effective 2026-01-01; included quotas unchanged — [GitHub Changelog 2025-12-16](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)

### Inferences
- Per-vCPU Linux x64 cost is ~$0.003/min at 2 vCPU, ~$0.0026 at 8, ~$0.0026 at 16 (derived), so larger runners are not cheaper per core.
- Cost for an hour on the 4-core x64 Linux is $0.72; on 8-core $1.32 (derived).

### Gaps
- Larger runners' separate free-minute treatment (they are not covered by included compute per older docs; the fetched page said larger runners always require a payment method) not independently verified.

## Plans, included compute, storage, billing gotchas

### Takeaway
Included compute is now expressed in dollars: Free $12, Pro/Team $18, Enterprise Cloud $300 per month (50,000 min on 2-core Linux). Cache over 10 GB/repo costs $0.07/GB/month; artifacts $0.25/GB/month.

### Cited Findings
- Included compute/month: Free $12; Pro $18; Free-for-orgs $12; Team $18; Enterprise Cloud $300. Artifact storage 500 MB / 1 GB / 500 MB / 2 GB / 50 GB; cache 10 GB per repo on all; custom image storage 75 GB (Team), 150 GB (Enterprise) — [GitHub Docs: Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- $300 = 50,000 min on 2-core Linux at $0.006 (page); $12 ≈ 2,000 min and $18 ≈ 3,000 min is my calculation — same page
- Overage storage: artifacts/Packages $0.25/GB/month; Actions cache $0.07/GB/month (only above 10 GB per repo and only if the cache limit is raised); custom image storage $0.07/GB/month. Storage accrues hourly (GB-hours); artifact storage rounded to nearest MB at month end; cache measured by hourly peak; deleting artifacts doesn't remove charges already accrued — same page
- Without a valid payment method, usage blocks once included compute is used; larger runners always require one. Budgets can cap spend; alerts at 90% and 100% — same page
- Self-hosted runner usage is free and doesn't consume included compute; public repos remain free — same page; [Changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)
- Planned $0.002/min "cloud platform charge" on self-hosted runners from 2026-03-01 was postponed ("to re-evaluate our approach"), no new date given — [Changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/). A search-result summary says (mid-2026 source, OpenMetal) it never took effect — [OpenMetal](https://openmetal.io/resources/blog/the-real-cost-math-behind-self-hosted-github-actions-runners/); several other articles still describe it as planned ([Substack](https://theplatformengineering.substack.com/p/github-actions-2026-pricing-changes)) — stale.

### Inferences
- As of 2026-11-11 self-hosted runners appear to carry no GitHub platform fee, but I could not find a GitHub statement dated after the postponement confirming it won't return.

### Gaps
- Concurrency limits per plan not covered on fetched pages (not retrieved).
- macOS-specific included-minute multipliers: not retrieved.

## Buildkite

### Takeaway
Buildkite is a separate CI platform (not a GitHub Actions runner provider): Free (5 users, 2,000 Linux min), Pro $30/active user/month, Enterprise custom. Hosted agents bill $0.004/vCPU-min Linux, $0.008 Windows, $0.02 Mac, per second with no minimum.

### Cited Findings
- Free: $0, up to 5 users, up to 10 concurrent jobs, 2,000 Linux AMD64 vCPU-min/month, Small shape only, 20 vCPU concurrency, 30-day retention — [Buildkite pricing](https://buildkite.com/pricing)
- Pro: $30 per active user/month, up to 50 users, 4,000 Linux AMD64 vCPU-min/month included then per-minute; up to 250 concurrent agents (10 included, then $3.50/agent/month); ARM64 (up to 64 vCPU), Mac (up to 48 vCPU), Windows (up to 64 vCPU) hosted agents; 90-day retention — same page
- Enterprise: custom, 30-user minimum, unlimited self-hosted agents, volume discounts, 99.95% uptime — same page
- Hosted agent rates (Pro, pay as you go): Linux (AMD64 and ARM64) $0.004/vCPU-min (Small $0.008, Medium $0.016, Large $0.032 per min); Windows $0.008/vCPU-min (Small $0.016, Medium $0.032, Large $0.064); Mac $0.02/vCPU-min (M4 Medium $0.12, M4 Large $0.24) — same page
- Billing: per vCPU-minute, metered to the second, no minimums or rounding; startup/shutdown excluded; no extra charge for storage or cache usage; remote Docker builders Enterprise only — [pricing](https://buildkite.com/pricing); [Buildkite hosted agents docs](https://buildkite.com/docs/pipelines/hosted-agents)
- Test executions: 250k (Free), 1M (Pro) then $15 per extra million; artifact storage 50 GB (Free) / 250 GB (Pro, then $0.05/GB-month), downloads $0.10/GB over 2.5 TB — pricing page
- 30-day free trial, no card; open-source pricing by contact — pricing page

### Inferences
- Shape-to-vCPU mapping implied by rates: Small = 2 vCPU, Medium = 4, Large = 8 (Linux: $0.008/$0.016/$0.032 ÷ $0.004). A 4 vCPU Linux Buildkite minute is $0.016 vs GitHub $0.012 (derived); 8 vCPU $0.032 vs $0.022. Not confirmed on the page; treat as derived.
- Per-seat cost makes Buildkite costlier at small scale; its per-active-user fee applies regardless of runner type.

### Gaps
- Relationship to GitHub Actions: Buildkite is an alternative CI orchestrator that triggers from GitHub repos; my attempt to fetch the GitHub integration doc returned an unrelated plugins page, so no sourced statement.
- Explicit shape vCPU/RAM tables not found on the docs page fetched.
- Whether Buildkite self-hosted agents on Pro incur per-minute charges beyond the $3.50/agent over 10: not verified.

## runmyjob

### Takeaway
It exists: RunMyJob/RunJob (runjob.eu, also runmyjob.io), a EU-based GitHub Actions/GitLab CI runner service from Puzl Cloud, billed per second on real CPU/RAM usage. I could not find exact prices.

### Cited Findings
- Runs GitHub Actions runners; works only for GitHub organizations (not personal accounts); supports github.com and GitHub Enterprise Server; migrate by setting `runs-on: runjob-ubuntu-latest`; Terraform modules and Kubernetes API access offered — [RunJob docs](https://runjob.eu/docs/) (old docs.puzl.cloud URL 301-redirects there)
- Vendor docs/listings claim "up to 2x faster and 5x cheaper" (docs) vs "10x cheaper" (another page); unverified marketing — [search results: Puzl docs](https://docs.puzl.cloud/services/run-my-job), [Euro-Stack listing](https://euro-stack.com/solutions/runmyjob-io)
- Third-party listings say billing is per second on actual CPU/RAM usage and free to try with no credit card — [Product Hunt](https://www.producthunt.com/p/runmyjob-github-gitlab-runners/runmyjob) (search snippet only, not fetched)

### Inferences
- Pay-for-usage billing (not fixed vCPU shapes) means comparisons to fixed-size runners depend on actual utilisation.

### Gaps
- No per-second CPU/RAM prices, free-tier size, minimums or concurrency limits found; the docs' pricing pages ("CPU", "Memory" under Resources and Billing) were not fetched.
- Company track record/stability unverified.
