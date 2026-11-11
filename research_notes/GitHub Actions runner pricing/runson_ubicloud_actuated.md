# RunsOn, Ubicloud, Actuated: GitHub Actions runner pricing (as of 2026-11-11, USD unless noted)

All pages retrieved 2026-11-11 via WebFetch/WebSearch unless a source's own read date is given.

## 1. Per-minute / license price for 2, 4, 8, 16 vCPU Linux x64 and ARM

### Takeaway
Ubicloud is the only one with a true per-minute list price: x64 standard $0.00125, $0.0025, $0.005, $0.01 per min for 2/4/8/16 vCPU, premium x64 about 1.6x that, ARM same as standard. RunsOn and Actuated have no per-minute vendor price. RunsOn is an annual license (EUR) plus AWS spot cost (about $0.0009 per min for 2 vCPU). Actuated is a flat monthly fee per server you supply.

### Cited Findings
- Ubicloud standard x64: 2 vCPU/8GB $0.00125; 4/16GB $0.00250; 8/32GB $0.00500; 16/64GB $0.01000; 30/120GB $0.01875 per min. — [Ubicloud pricing docs](https://ubicloud.com/docs/about/pricing.md)
- Ubicloud premium x64: 2 $0.002; 4 $0.004; 8 $0.008; 16 $0.016; 30 $0.030 per min. — [Ubicloud pricing docs](https://ubicloud.com/docs/about/pricing.md)
- Ubicloud arm64: 2 vCPU/6GB $0.00125; 4/12GB $0.0025; 8/24GB $0.005; 16/48GB $0.01; 30/90GB $0.01875 per min. — [Ubicloud pricing docs](https://ubicloud.com/docs/about/pricing.md); matches [cicdpipelinecost.com](https://cicdpipelinecost.com/ubicloud-pricing) (third party; its ARM cells were partly elided)
- Ubicloud marketing page quotes lower headline rates: Standard $0.0010/min ("85% lower" than GitHub), Premium "70% lower" with no figure extracted. — [Ubicloud GitHub Actions page](https://www.ubicloud.com/use-cases/github-actions); third party notes the marketing page shows $0.0010 standard and $0.0016 premium versus docs figures — [cicdpipelinecost.com](https://cicdpipelinecost.com/ubicloud-pricing)
- Ubicloud price-adjustment blog: Standard rose from $0.0008 to $0.0010/min (+26%), new deployments from 2026-05-01, existing resources from 2026-06-01. Premium-2 unchanged. Affects Germany, Finland and Virginia regions; AWS-powered regions unchanged. Standard x64 is no longer available to new customers, who are directed to premium. — [Ubicloud blog](https://ubicloud.com/blog/ubicloud-price-adjustment-2026)
- RunsOn license (EUR, billed annually per legal entity): Free (non-commercial) EUR 0; Starter <50k jobs/month EUR 300/yr; Growth <200k EUR 900/yr; Scale <500k EUR 1,800/yr; Sponsorship/Enterprise unlimited EUR 3,600/yr. — [RunsOn pricing](https://runs-on.com/pricing/)
- RunsOn AWS compute cost per runner-minute (us-east-1, spot, includes 30GB gp3 root volume, no RunsOn markup): 1cpu t8i.medium $0.0006; 2cpu m8a.large $0.0009; 4cpu m8a.xlarge $0.0013; 16cpu c8id.4xlarge $0.0037; 64cpu c8i-flex.16xlarge $0.0082. GitHub-hosted comparison on the same page: $0.0020, $0.0060, $0.0120, $0.0420, $0.1620. — [RunsOn pricing](https://runs-on.com/pricing/)
- Actuated: "Self-Service" plan, $150/month for the first server and $125/month for each additional server, with unlimited build minutes, CPUs, RAM and concurrency. The page also displays runner sizes 2 to 32 cores at $0.005/min, which appears to be a comparison/illustration rather than a billed rate. — [Actuated pricing](https://actuated.com/pricing)
- GitHub-hosted comparison shown on Actuated's page: $0.008/min (2-core) up to $0.128/min (32-core). — [Actuated pricing](https://actuated.com/pricing)

### Inferences
- Ubicloud standard and ARM are linear in vCPU at $0.000625 per vCPU-min; premium is $0.001 per vCPU-min.
- RunsOn 8 vCPU is not on the page; interpolating between 4cpu $0.0013 and 16cpu $0.0037 gives roughly $0.002 (my estimate, unverified).
- Ubicloud premium (about $0.002 per min for 2 vCPU) is roughly 2x RunsOn AWS spot cost per minute for 2 vCPU ($0.0009), before RunsOn's license and control-plane costs.
- For a small team (<50k jobs/mo), RunsOn adds about EUR 25/month plus roughly $7/month control plane to AWS spot costs.

### Gaps
- RunsOn ARM (Graviton) per-minute AWS cost and 8 vCPU were not in the extracted page. Not found.
- RunsOn USD license price: page says USD checkout exists but only EUR amounts were extracted.
- Ubicloud docs ($0.00125 standard) conflict with the blog/marketing figure ($0.0010 standard). The docs table may reflect a different region set or be stale. Verify at checkout.
- Whether Actuated's $0.005/min figure is billed anywhere is unverified (page says flat per-server).

## 2. RunsOn license model and typical AWS cost

### Takeaway
Annual, per-legal-entity license tiered by jobs/month, free for non-commercial use, with a 15-day trial. AWS costs are billed directly by AWS, with a control plane from about $7/month.

### Cited Findings
- Unit is one ephemeral runner per GitHub Actions job. — [RunsOn pricing](https://runs-on.com/pricing/)
- Free tier: full product for open source, non-profit, educational and personal non-commercial use, in exchange for a public link back to runs-on.com. — [RunsOn pricing](https://runs-on.com/pricing/)
- Trial: 15 days on Starter, Growth and Scale; payment details collected at checkout. — [RunsOn pricing](https://runs-on.com/pricing/)
- No limit enforced; moving up a tier happens only after two months of sustained overage, prorated. — [RunsOn pricing](https://runs-on.com/pricing/)
- Share of teams per tier per page: Starter ~79%, Growth ~14%, Scale ~6%. — [RunsOn pricing](https://runs-on.com/pricing/)
- Control plane (Fargate service, S3 cache, in-region data transfer) from about $7/month, paid to AWS. — [RunsOn pricing](https://runs-on.com/pricing/)

### Inferences
- Costs are spot-based; on-demand fallback or other regions will cost more than the quoted spot figures.

### Gaps
- Documented gotchas on cache/egress/EBS beyond the $7/month note were not retrieved (runs-on.com/docs/pricing/ returned 404).

## 3. Actuated plans and infrastructure you supply

### Takeaway
Single published self-service plan priced per server per month; you bring the servers (bare metal or nested-virt capable). No minute metering.

### Cited Findings
- $150/month first server, $125/month each additional; unlimited minutes, concurrency, CPUs and RAM; server selector 1 to 10 plus "Custom" for more. Includes org/repo/user reports, SSH debugging, Prometheus metrics, best-effort community email support. — [Actuated pricing](https://actuated.com/pricing)
- Hosts must be bare-metal (e.g. AWS Metal, Graviton, on-prem) or support nested virtualization; docs name GCP and DigitalOcean for nested virt. — [Actuated docs](https://docs.actuated.com/)
- Blog covers bare-metal Arm, Ampere Arm CI, dedicated GPUs (2024-03-12), KVM/nested virt, burst billing (2024-04-25) and "Custom Billing" (Q4 2025 announcements, 2025-10-31; no detail). — [Actuated blog](https://actuated.com/blog)
- Docs describe cost as a fixed monthly cost; to get pricing you subscribe or book a call. — [Actuated docs](https://docs.actuated.com/)

### Inferences
- Total cost = $125-150 per server per month plus the server cost itself (e.g. an AWS metal instance or dedicated host), which usually dominates.

### Gaps
- Server size limits, supported OS, x64/arm64 plan differences, and the burst billing price were not found. Whether the March 2026 GitHub self-hosted runner platform fee (reported by [DevClass](https://www.devclass.com/development/2025/12/17/github-to-charge-for-self-hosted-runners-from-march-2026/1734518); not fetched) affects these products was not verified. That fee would apply on top of RunsOn and Actuated, since both use self-hosted runners; confirm GitHub's current terms.

## 4. Ubicloud free minutes, rates, ARM/GPU

### Takeaway
$2.50/month credit per account (documented as equal to 1,250 minutes of 2 vCPU). ARM is offered at standard rates; no GPU runner found.

### Cited Findings
- Every account gets $2.5/month credit, "equivalent to 1,250 minutes" of 2 vCPU runner time. — [Ubicloud pricing docs](https://ubicloud.com/docs/about/pricing.md); [price-performance doc](https://ubicloud.com/docs/github-actions-integration/price-performance)
- The 1,250 figure only holds at the premium 2 vCPU rate ($2.50 / $0.002); at standard $0.00125 it buys 2,000 minutes. — [cicdpipelinecost.com](https://cicdpipelinecost.com/ubicloud-pricing) (third-party arithmetic)
- Billing is per minute granularity. — [Ubicloud price-performance doc](https://ubicloud.com/docs/github-actions-integration/price-performance)
- ARM: Linux arm64 only, prices above. Memory 4 GB/vCPU x64, 3 GB/vCPU arm64. — [Ubicloud pricing docs](https://ubicloud.com/docs/about/pricing.md); [cicdpipelinecost.com](https://cicdpipelinecost.com/ubicloud-pricing)
- Linux only; no macOS or Windows runners. — [cicdpipelinecost.com](https://cicdpipelinecost.com/ubicloud-pricing)

### Inferences
- "Standard no longer for new customers" plus default-premium means a new account likely pays the premium rate unless premium is disabled (see gotchas).

### Gaps
- GPU runners: no mention in the official pricing docs or marketing page; unverified, treat as unavailable.

## 5. Gotchas (cache, storage, egress, rounding, concurrency)

### Takeaway
Ubicloud has included cache and fallback billing quirks; RunsOn's extras are AWS-side; Actuated has no concurrency cap but needs your own hardware.

### Cited Findings
- Ubicloud cache: Standard runners include 30GB free cache storage, Premium 100GB; other storage terms not specified. — [Ubicloud GitHub Actions page](https://www.ubicloud.com/use-cases/github-actions)
- Ubicloud premium is on by default for new accounts; if premium capacity is full, jobs fall back to standard and are billed at the rate of the runner actually used. (Ubicloud docs: fallback occurs "with no extra wait time".) — [cicdpipelinecost.com](https://cicdpipelinecost.com/ubicloud-pricing); [Ubicloud pricing docs](https://ubicloud.com/docs/about/pricing.md)
- Ubicloud runners are in German data centres per a third party; the blog also mentions Finland, Virginia and AWS-powered regions. — [cicdpipelinecost.com](https://cicdpipelinecost.com/ubicloud-pricing); [Ubicloud blog](https://ubicloud.com/blog/ubicloud-price-adjustment-2026)
- Ubicloud billing is per minute and invoiced monthly. — [cicdpipelinecost.com](https://cicdpipelinecost.com/ubicloud-pricing)
- RunsOn: AWS figures include a 30GB gp3 root volume; cache/data transfer are inside the ~$7/month control plane only for in-region traffic. Egress outside region is billed by AWS. — [RunsOn pricing](https://runs-on.com/pricing/)
- Actuated: unlimited concurrency per server, but real concurrency is bounded by the hardware you add. — [Actuated pricing](https://actuated.com/pricing)

### Inferences
- Per-minute rounding on RunsOn is determined by AWS (per-second EC2 billing with 60s minimum, from my background knowledge; not verified here).

### Gaps
- Concurrency limits for Ubicloud and RunsOn not found. Ubicloud rounding granularity (per started minute vs. exact) not confirmed beyond "per minute".
- Third-party sources (cicdpipelinecost.com, depmedicdev, devtoolpicks, raxx internal doc) are secondary; the raxx doc's Premium-2 $0.0016 conflicts with the docs' $0.002 and is not relied on.
