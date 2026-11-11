# Blacksmith and WarpBuild plan tiers and limits (GitHub Actions runners)

All pages fetched 2026-11-11. USD. Neither vendor publishes named Free/Pro/Team tiers on its pricing page; both are usage-based plus an Enterprise tier. "Not stated" = not found on pages opened.

## Blacksmith plans and limits

### Takeaway
Blacksmith: pay-as-you-go with 3,000 free min/month, plus Enterprise (contact sales). No concurrency cap on any plan. Static IP, Docker layer cache and sticky disks are paid add-ons. SLA is Enterprise-only.

### Cited Findings
| Item | Free allowance (PAYG) | Pay-as-you-go | Enterprise |
|---|---|---|---|
| Price | Free: 3,000 min/month ([pricing](https://www.blacksmith.sh/pricing)); docs: 3,000 x64 2-vCPU min per org per month; ARM counts 0.625x, Windows 2x, macOS 6-vCPU 20x ([runners](https://docs.blacksmith.sh/blacksmith-runners/overview.md)) | Ubuntu x64 $0.004/min (2 vCPU basis), Ubuntu ARM $0.0025, Windows x64 $0.008, macOS M4 $0.08 ([pricing](https://www.blacksmith.sh/pricing)); larger sizes scale proportionally per docs (inferred) | Not stated; contact sales ([pricing](https://www.blacksmith.sh/pricing)) |
| Concurrency (jobs/vCPUs) | Unlimited; "never caps how many jobs or vCPUs"; no plan tier to upgrade, no ticket needed ([concurrency](https://docs.blacksmith.sh/blacksmith-runners/concurrency.md)) | same | "Enterprise-grade concurrency" (pricing page); same unlimited per docs |
| Max runner size | Linux/Windows x64 32 vCPU (Linux 128GB/1.5TB; Windows 112GB); macOS 12 vCPU/48GB; ARM Ubuntu 32 vCPU (ARM 22.04 marked deprecated) ([runners](https://docs.blacksmith.sh/blacksmith-runners/overview.md)) | same | Not stated as different |
| Actions cache | 25GB free per repo per week; raise via support@blacksmith.sh; LRU evict entries not accessed >7 days ([caching](https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions.md)) | same | not stated |
| Docker layer cache | Add-on $0.50/GB/mo ([pricing](https://www.blacksmith.sh/pricing)); no max size stated; layers unused 8 days GC'd; sticky disk behind it evicted after 7 days idle ([docker](https://docs.blacksmith.sh/blacksmith-caching/docker-builds.md)) | same | same |
| Sticky disks | $0.50/GB/mo; no max size stated; purged after 7 days unused; up to 5 per job ([sticky](https://docs.blacksmith.sh/blacksmith-caching/dependencies-sticky-disks.md)) | same | same |
| Support | Standard: free, no SLA, no response times ([support terms](https://docs.blacksmith.sh/about/support-terms.md)) | Premium: add-on, or annual/committed contract; greater of $250/mo or 5% of monthly spend; no SLA; ticket response: business-critical every 2h 24/7, degraded 8h initial, general 24 business h ([support terms](https://docs.blacksmith.sh/about/support-terms.md)) | Enterprise Support: 99.9% monthly uptime SLA with service credits (sole remedy), dedicated Slack, dedicated engineers, onboarding, CI optimization reviews; critical every 30 min 24/7, degraded 4h, general 12 business h initial ([support terms](https://docs.blacksmith.sh/about/support-terms.md); [pricing](https://www.blacksmith.sh/pricing)) |
| Security/admin | SOC 2 Type 2, GDPR; reports on request via Trust Center; login is GitHub SSO only; no customer audit-log feature described; HIPAA "in process" ([security](https://www.blacksmith.sh/security)) | Static IP $100/IP/mo add-on, enabled per org via support ([pricing](https://www.blacksmith.sh/pricing); [static-ip](https://docs.blacksmith.sh/blacksmith-runners/static-ip.md)); network/IP allowlisting page exists (not opened) | Pricing page lists nothing SSO/audit-specific beyond SLA/support |
| Seat/org limits | Pricing is per-minute, no seat limit stated; free minutes are per org | | |
| Other limits | Regions us-east, us-west, eu-west, eu-central; KVM only x64 Linux; Windows runners public beta; jobs can queue if Blacksmith GitHub App not installed on every repo ([runners](https://docs.blacksmith.sh/blacksmith-runners/overview.md)). "Scale Apps" (3 extra GitHub apps) raise GitHub API rate-limit headroom; plan gating and numbers not stated ([scale apps](https://docs.blacksmith.sh/blacksmith-administration/scale-apps.md)) | | |
| Discounts | Startup program (<100 employees, <$50M raised, <5 yrs) and OSS program; discount size not stated ([pricing](https://www.blacksmith.sh/pricing)) | | |

### Inferences
- Because Premium support is the greater of $250/mo or 5% of spend, it becomes spend-proportional above $5,000/mo.
- Unlimited concurrency means queueing is not a plan-driven constraint; the realistic limits are GitHub's own (e.g. GitHub API rate limits, mitigated by Scale Apps).

### Gaps
- Job timeout, spending caps/budget alerts, audit logs (customer-facing), SAML SSO, private networking: not stated on pages opened.
- Enterprise price, Premium/Enterprise feature gating of static IP: not stated.
- Network allowlisting, GitHub Enterprise and Settings pages not opened.

## WarpBuild plans and limits

### Takeaway
WarpBuild has no named plan ladder: usage-based cloud runners, a cheaper BYOC option, and Enterprise (contact sales). Cloud concurrency is advertised as unlimited. SSO ($250/mo) and audit logs ($400/mo) are paid add-ons; SOC2 Type 2 is stated for all plans.

### Cited Findings
| Item | Cloud (usage-based) | BYOC | Enterprise |
|---|---|---|---|
| Price | Linux x64: 2vCPU $0.004/min, 4 $0.008, 8 $0.016, 16 $0.032, 32 $0.064; Linux arm64: 2 $0.003, 4 $0.006, 8 $0.012, 16 $0.024, 32 $0.048; Apple Silicon/macOS M4-M5 Pro: 6vCPU $0.08, 12 $0.16; Windows: 4 $0.016, 8 $0.032, 16 $0.064, 32 $0.128 ([pricing](https://www.warpbuild.com/pricing)) | $0.002/min Linux; Windows (AWS/Azure only) $0.002/min; cache and snapshots free; runs in your AWS/GCP/Azure VPC ([pricing](https://www.warpbuild.com/pricing)) | Not stated; contact sales ([pricing](https://www.warpbuild.com/pricing)) |
| Included/free usage | Amount not stated; no card at signup, payment method required "when you hit the free usage or credit limits" ([pricing](https://www.warpbuild.com/pricing)) | not stated | not stated |
| Concurrency | "Unlimited"; docs: unlimited on Linux and Windows for GA features; for high macOS concurrency contact support ([cloud runners](https://www.warpbuild.com/docs/ci/cloud-runners)) | not stated | Unlimited, no job queue limits ([pricing](https://www.warpbuild.com/pricing)) |
| Max runner size | 32 vCPU/128GB (Linux x64, arm64, Windows); 12 vCPU/28GB macOS and Apple Silicon Ubuntu; storage up to 150GB Linux (300GB on 12x Apple Silicon Ubuntu), 256GB Windows, 270GB macOS 12x ([cloud runners](https://www.warpbuild.com/docs/ci/cloud-runners)) | not stated | not stated (custom AMIs offered) |
| Cache | Unlimited (no numeric cap); $0.20/GB-month; $0.0001 per write/restore/list op; expires 7 days after last use ([caching](https://www.warpbuild.com/docs/ci/features/caching); [pricing](https://www.warpbuild.com/pricing)) | Free | not stated |
| Docker builders | 7 profiles, 16vCPU/32GB/100GB at $0.06/min up to 192vCPU/384GB/2TB at $0.88/min; shared across jobs, no hard concurrency limit ([pricing](https://www.warpbuild.com/pricing)) | | |
| Snapshots | Restore $0.04/job; storage $0.025/hour per snapshot ([pricing](https://www.warpbuild.com/pricing)) | free | |
| Support/SLA | Tiers for non-Enterprise not stated | | 24/7 support, dedicated Slack, 99.9% contractual SLA with credits, cold start <10s with warm pools ([pricing](https://www.warpbuild.com/pricing)) |
| Security/admin | SOC2 Type 2 for all plans (FAQ; [trust center](https://trust.warpbuild.com)); SAML SSO $250/mo; audit logs $400/mo; data residency $250/mo; Tailscale networking free ([pricing](https://www.warpbuild.com/pricing)) | | SOC2 Type II, SAML SSO ($250/mo) Okta/Azure AD/Google, SCIM, dedicated Enterprise Cloud, region-specific infra with no ingress/egress charges (excl. macOS), GHES/GHEC data residency, guaranteed 40% infra savings vs ARC ([pricing](https://www.warpbuild.com/pricing); [cloud runners](https://www.warpbuild.com/docs/ci/cloud-runners)) |
| Seat/org limits | Per-usage, no seats; GitHub org required (no personal accounts); one GitHub org maps to one WarpBuild workspace; new workspaces may be reviewed before jobs run ([quick start](https://www.warpbuild.com/docs/ci/quick-start)) | | |
| Billing | Billed last day of month; mid-cycle charge possible once undisclosed usage threshold crossed ([pricing](https://www.warpbuild.com/pricing)) | | |

### Inferences
- Source for static IP on WarpBuild: only a secondhand Product Hunt mention ("static IPs") surfaced in search; treat as unverified.
- WarpBuild x64 2vCPU price equals Blacksmith's ($0.004/min); arm64 is $0.003 vs $0.0025.

### Gaps
- Free credit amount, job timeout, queue behavior, spending caps, static IP availability/price, log/artifact retention, non-Enterprise support tiers, BYOC/Enterprise max runner size: not stated on pages opened.
- Pricing page listed no named Free/Pro/Team plan; a third-party page (toolradar) claims a "free plan," not verified against a primary source.
- Docs pages for BYOC, Docker builders, observability and the trust center not opened.
