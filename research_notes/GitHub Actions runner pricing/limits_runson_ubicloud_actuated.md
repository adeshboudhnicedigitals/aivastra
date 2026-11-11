# Plan tiers and limits: RunsOn, Ubicloud, Actuated (GitHub Actions runners)

All pages retrieved 2026-11-11 via WebFetch (page content is a model-extracted summary, not raw HTML; treat exact wording as approximate). RunsOn in EUR, others USD.

## RunsOn: licence tiers and limits

### Takeaway
RunsOn is a self-hosted-in-your-AWS product licensed by annual flat fee, tiered by monthly job volume. The pricing page says no feature is gated by tier and no job limit is enforced; tier moves happen only after two months of sustained overage. The practical limits are AWS quotas in your own account.

### Cited Findings
| Tier | Price (EUR) | Jobs/mo band | Trial | Support | Source |
|---|---|---|---|---|---|
| Free | 0 | not stated (open source, non-profit, personal non-commercial; needs public link back to runs-on.com) | n/a | community Slack | [pricing](https://runs-on.com/pricing/) |
| Starter | 300/yr | < 50k | 15 days | community Slack + email | same |
| Growth | 900/yr | < 200k | 15 days | community Slack + email | same |
| Scale | 1,800/yr | < 500k | 15 days | community Slack + email | same |
| Sponsorship / Enterprise ("Unlimited") | 3,600/yr | unlimited | none listed | priority support + Slack Connect | same |

- Every paid step includes Flex and Fleet modes, every release and AMI. No tier gates features; Sponsorship adds full server and agent source for security review, priority support, Slack Connect, optional homepage logo — [pricing](https://runs-on.com/pricing/)
- One licence covers all GitHub orgs and AWS accounts you own, and each stack deployment (one install in one account/region). Licence is per legal entity; affiliates covered only if named in plan/order/invoice/agreement — [pricing](https://runs-on.com/pricing/)
- Enforcement: no job limit enforced, jobs keep running regardless of volume. Short spikes never change tier; sustained overage for two consecutive months moves you up, prorated — [pricing](https://runs-on.com/pricing/)
- Adoption split on page: ~79% Starter, ~14% Growth, ~6% Scale — [pricing](https://runs-on.com/pricing/)
- Runner sizes: "1 to 896 vCPUs" latest-gen CPUs (bounded by AWS instance types, not tier); "Magic Cache" described as "effectively unlimited" (marketing wording; no numeric cap or retention found) — [docs home](https://runs-on.com/docs/)
- Spot: always tries Spot first, falls back to on-demand. Interruption fails the job (so GitHub auto-retry can pick it up) and RunsOn adds an `EC2 Spot interruption` annotation. Flex fallback adds 2-3s launch delay; Fleet retries on-demand ~5s later (v3.6.0+). Spot interruption within first hour is not billed by AWS (per page) — [spot-pricing](https://runs-on.com/docs/costs/spot-pricing/)
- Spot quota exhausted (Flex): on-demand for 5 minutes for affected runners plus email alert to raise quota; Fleet: no auto-disable or alert, falls back to on-demand — [spot-pricing](https://runs-on.com/docs/costs/spot-pricing/)
- On-demand vCPU quota `VcpuLimitExceeded` (Flex only): alert at most once/hour per quota bucket, retry ~1 min later, not counted against launch attempts; job fails if quota is smaller than smallest acceptable instance. `MaxSpotInstanceCountExceeded`: alert, snooze spot, launch on-demand — [rate-limits](https://runs-on.com/docs/control-plane/rate-limits/)
- Quotas to raise in AWS: on-demand vCPU = peak concurrency x vCPU per runner; "All Standard Spot Instance Requests" to match spot usage; RunInstances/CreateFleet request rate (AWS default usually 2/s; suggested 4 medium, 10 high, 20 xhigh) — [rate-limits](https://runs-on.com/docs/control-plane/rate-limits/)
- Control-plane scale: designed for ~80,000 VMs/day; AppSize presets small/medium/high/xhigh (webhook/provisioning workers 4/8/20/40); GitHub secondary limit budget 15 points/s per App installation; Fleet `max_launch_batch_size` default 50 — [rate-limits](https://runs-on.com/docs/control-plane/rate-limits/)
- AWS: quotas are per-Region defaults; request increases via Service Quotas console — [AWS docs](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-resource-limits.html)
- "Credentials never leave your VPC" — [docs home](https://runs-on.com/docs/)

### Inferences
- Tier choice is purely honour-based volume banding; cost is flat and tiny relative to AWS compute, so effective cost is AWS bill plus EUR 300-3,600/yr.
- Real concurrency ceiling = your AWS vCPU quota (new accounts often have low defaults; AWS says it auto-raises with usage) and EC2 API rate, not RunsOn licence.

### Gaps
- Per-tier concurrency, org/repo count caps, SLA: not stated (pricing page says no SLA, no concurrency limit).
- Numeric cache cap/retention, private networking, ARM, GPU, macOS (RunsOn is AWS-only, so macOS presumably unavailable; not verified), multi-region docs pages not opened (several docs URLs returned 404: /docs/faq/, /docs/license/, /docs/install/aws-quotas/).
- Default AWS vCPU quota numbers not retrieved (AWS page summary gave no numbers).
- Whether "Unlimited" is the official tier name: page labels it "Sponsorship (Enterprise)"; unlimited jobs.

## Ubicloud GitHub runners

### Takeaway
Ubicloud is purely usage-priced with no plan tiers: $2.50/month free credit (= 1,250 two-vCPU minutes) and a card required. No support tiers, SLA or concurrency limits were found in the pages fetched.

### Cited Findings
- Free credit: $2.5/month per account = 1,250 minutes of 2-vCPU runner time; valid credit card on file required before creating resources — [quickstart](https://www.ubicloud.com/docs/github-actions-integration/quickstart), [pricing.md](https://ubicloud.com/docs/about/pricing.md)
- Billing per-minute, usage-based — [price-performance](https://www.ubicloud.com/docs/github-actions-integration/price-performance)
- Standard x64 per min: 2vCPU/8GB $0.00125; 4/16 $0.0025; 8/32 $0.005; 16/64 $0.01; 30/120 $0.01875 — [pricing.md](https://ubicloud.com/docs/about/pricing.md)
- Premium x64 per min: 2 $0.002; 4 $0.004; 8 $0.008; 16 $0.016; 30 $0.030 — same
- arm64 per min: 2vCPU/6GB $0.00125; 4/12 $0.0025; 8/24 $0.005; 16/48 $0.01; 30/90 $0.01875 — same
- Max size listed: 30 vCPU / 120GB (x64), 30 vCPU / 90GB (arm64). Default label `ubicloud-standard-2`; premium enabled by default, jobs route to premium and fall back to standard when busy (togglable in Console, GitHub Runners > Settings) — [quickstart](https://www.ubicloud.com/docs/github-actions-integration/quickstart)
- Use-case page (marketing; conflicts with pricing.md): says standard $0.0010/min for 2 vCPU and lists sizes 2/4/8/16 vCPU only — [use-cases](https://www.ubicloud.com/use-cases/github-actions) vs pricing.md ($0.00125). Docs pricing.md treated as authoritative.
- Cache free allowance: standard 30GB, premium 100GB — [use-cases](https://www.ubicloud.com/use-cases/github-actions) (marketing page; not corroborated in docs fetched)
- Hardware: standard AMD EPYC Genoa; premium AMD Ryzen 9 — same
- Firewalled services may need allowlisting https://api.ubicloud.com/ips-v4 — quickstart

### Inferences
- A monthly free credit of 1,250 min is trivial for CI at scale; costs ~ $0.00125/min per 2 vCPU.

### Gaps
- Support tiers/SLA, concurrency or vCPU quota, cache retention period, GPU, macOS, multi-region, SSO/audit/private networking: not found. Not stated in pages fetched; /pricing and /docs/github-actions-integration/pricing returned 404.
- No paid "plans" for GitHub runners found.

## Actuated

### Takeaway
Actuated is a managed control plane over servers you supply, sold per server (self-service: $150/month first server, $125 each additional). Tier details for burst and custom plans were not found publicly.

### Cited Findings
- Self-Service: $150/month first server, $125 each additional, "unlimited" build minutes/concurrency/RAM/CPU on the server, selectable 1-10 servers or "Custom"; runner sizes 2/4/8/16/32 core in comparison; support: community, best-effort email; features: org/repo/user reports, SSH debug, Prometheus metrics — [pricing](https://actuated.com/pricing)
- Monthly plans, no minimum commitment, paid by corporate card; you bring one or more bare-metal servers; needs GitHub org admin; onboarding call — [register](https://docs.actuated.com/register/)
- Plan determines how many servers you can run; Arm and SSH gateway included only in some plans ("check your subscription plan") — [FAQ](https://docs.actuated.com/faq/)
- Jobs queue when no capacity; one build per VM; VM size flexible via label (e.g. `actuated-4cpu-16gb`); placement by RAM reserved — [FAQ](https://docs.actuated.com/faq/)
- Hosts: bare metal or nested-virtualisation VMs (GCP, DigitalOcean); Linux only (AMD64/64-bit Arm), no macOS/Windows; Arm nested virt not ready; GPU supported — [FAQ](https://docs.actuated.com/faq/), [docs home](https://docs.actuated.com/)
- No SLA or uptime figure published; monitoring data retention 14 days — [FAQ](https://docs.actuated.com/faq/)
- Open-source: CNCF/Ampere sponsored programme, README badge required — [FAQ](https://docs.actuated.com/faq/)
- Firecracker microVM isolation, managed control plane, minimal GitHub permissions — [pricing](https://actuated.com/pricing)

### Inferences
- Cost excludes the server hardware itself (you pay the host provider separately).

### Gaps
- "Burst" plan and "Custom" plan: no details found anywhere (pricing page lists custom only as a selector option; web search found nothing). Mark unknown.
- Org count limits, per-server max concurrency, cache storage caps/retention, SSO/audit, paid support tiers/SLA: not stated.
- Arm availability per plan: unclear.
