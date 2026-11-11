# Blacksmith and WarpBuild GitHub Actions runner pricing (retrieved 2026-11-11, USD)

Retrieval note: all figures fetched 2026-11-11 via page-reading tool; some pages returned partial/elided content (flagged). The Blacksmith per-size table comes from a secondary tracker (usagepricing.com, captured 2026-11-10) because blacksmith.sh/pricing only exposed the 2 vCPU rate in text.

## Per-minute price for 2/4/8/16/32 vCPU Linux x64 and ARM, plus Windows/macOS

### Takeaway
Both vendors price Linux x64 identically: $0.004/min at 2 vCPU, doubling per step to $0.064 at 32 vCPU. ARM is cheaper at Blacksmith ($0.0025 at 2 vCPU) than WarpBuild ($0.003). WarpBuild Windows is 2x Blacksmith's at equal size on the Blacksmith tracker numbers, and WarpBuild dropped Windows 2 vCPU.

### Cited Findings
Blacksmith
- Ubuntu x64: 2 vCPU $0.004; 4 $0.008; 8 $0.016; 16 $0.032; 32 $0.064 per min (8GB/16/32/64/128GB RAM). Each vCPU doubling doubles the rate — [usagepricing.com Blacksmith capture 2026-11-10](https://www.usagepricing.com/blueprint/blacksmith); x64 figures also corroborated by a search summary of [Blacksmith docs pricing](https://docs.blacksmith.sh/blacksmith-runners/pricing) and 2 vCPU $0.004 on [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)
- Ubuntu ARM: 2 vCPU $0.0025; 4 $0.005; 8 $0.01; 16 $0.02; 32 $0.04 per min — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith). Only 2 and 4 vCPU were confirmed from the official docs snippet; 8/16/32 ARM are third-party only ([docs search summary](https://docs.blacksmith.sh/blacksmith-runners/pricing))
- Windows x64 (public beta): 2 vCPU $0.008; 4 $0.016; 8 $0.032; 16 $0.064; 32 $0.128 per min — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith); 2 vCPU $0.008 also on [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)
- macOS M4: 6 vCPU $0.08; 12 vCPU $0.16 per min — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith); $0.08 also on [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)
- Pricing page lists vCPU selector 2, 4, 8, 16, 32 (plus 6, 12) — [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)

WarpBuild (official pricing page)
- Linux x64: 2 vCPU $0.004; 4 $0.008; 8 $0.016; 16 $0.032; 32 $0.064 per min — [warpbuild.com/pricing](https://www.warpbuild.com/pricing)
- Linux arm64: 2 $0.003; 4 $0.006; 8 $0.012; 16 $0.024; 32 $0.048 per min — [warpbuild.com/pricing](https://www.warpbuild.com/pricing)
- Windows x64: 4 vCPU $0.016; 8 $0.032; 16 $0.064; 32 $0.128 (no 2 vCPU) — [warpbuild.com/pricing](https://www.warpbuild.com/pricing); Windows 2 vCPU removed 2026-06-08, min is 4 vCPU — [Cloud Runners docs](https://www.warpbuild.com/docs/ci/cloud-runners)
- macOS (M4/M5 Pro): 6 vCPU/14GB $0.08; 12 vCPU/28GB $0.16 per min; 6 vCPU gets 14GB and 12 vCPU 28GB from 2026-10-01, prices unchanged — [pricing](https://www.warpbuild.com/pricing), [Cloud Runners docs](https://www.warpbuild.com/docs/ci/cloud-runners)
- Docker builders per min: 16 vCPU $0.06; 32 $0.12; 64 $0.24; 96 (600GB) $0.36; 96 (2TB) $0.52; 192 (600GB) $0.72; 192 (2TB) $0.88 — [warpbuild.com/pricing](https://www.warpbuild.com/pricing)

### Inferences
- At equal sizes WarpBuild and Blacksmith x64 Linux cost the same; Blacksmith ARM is ~17% cheaper; Windows is the same per size, but only Blacksmith offers 2 vCPU Windows ($0.008).

### Gaps
- Blacksmith ARM 8/16/32 and Windows/macOS per-size not verified on an official Blacksmith page this session (official docs fetch 404'd at docs.blacksmith.sh/introduction/pricing).

## Free minutes, plan tiers, subscription fees, concurrency

### Takeaway
Blacksmith: 3,000 free x64-2vCPU-equivalent minutes/month per org, pay-as-you-go plus Enterprise (custom). WarpBuild publishes no free-minute amount or subscription tiers on its pricing page; it advertises unlimited concurrency.

### Cited Findings
- Blacksmith free tier: 3,000 x64 2 vCPU minutes per org per month, no credit card; larger runners drain it proportionally; ARM 2 vCPU min = 0.625 free min, Windows 2 vCPU = 2, macOS 6 vCPU = 20 — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith); "3,000 free min/mo" also on [Orb capture 2026-11-04](https://www.withorb.com/pricing-atlas/blacksmith)
- Blacksmith plans: pay-as-you-go + Enterprise (custom; 99.9% SLA, 24/7 support, Slack channel, "enterprise-grade concurrency") — [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)
- Blacksmith has no published numeric concurrency limit — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith)
- Blacksmith startup discount: <100 employees, <$50M raised, <5 years; OSS program for permissive-license public repos — [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)
- Blacksmith "Free Upgrades": job may run on next tier up at smaller tier's price when capacity is spare — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith)
- WarpBuild: no subscription fee listed; only add-on monthly fees (SAML SSO $250/mo, data residency $250/mo, audit logs $400/mo) — [warpbuild.com/pricing](https://www.warpbuild.com/pricing)
- WarpBuild cloud runners: "unlimited job concurrency", no queue limits; docker builders no hard limit; high macOS concurrency via support — [pricing](https://www.warpbuild.com/pricing), [Cloud Runners docs](https://www.warpbuild.com/docs/ci/cloud-runners)

### Gaps
- WarpBuild free minutes/credits: page says payment method needed "when you hit the free usage or credit limits" but gives no amount. Unverified.

## Cache, Docker layer cache, storage, egress, add-ons, BYOC

### Takeaway
Blacksmith charges $0.50/GB-month for sticky disks and Docker layer cache, with Actions cache free (25GB/repo/week). WarpBuild charges $0.20/GB-month cache plus $0.0001 per cache operation. WarpBuild BYOC is $0.002/min; Blacksmith BYOC not found.

### Cited Findings
- Blacksmith Actions cache: no extra cost, 25 GB free per repo per week; sticky disks $0.50/GB-month (up to 5/job, evicted after 7 days unused); Docker layer caching $0.50/GB-month on sticky disks — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith), [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)
- Blacksmith static IPs $100/IP/month (Ubuntu and Windows, not macOS) — [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)
- WarpBuild cache storage $0.20/GB-month; cache write/restore $0.0001/operation; snapshot restore $0.04/job; snapshot storage $0.025/hour/snapshot (changed 2025-12-07); Tailscale networking free — [warpbuild.com/pricing](https://www.warpbuild.com/pricing), [Dec 2025 changelog](https://warpbuild.com/docs/ci/changelog/2025-december)
- WarpBuild BYOC (AWS/GCP/Azure): Linux $0.002/min; Windows (AWS and Azure) $0.002/min; cache and snapshots free; no GCP Windows price listed — [warpbuild.com/pricing](https://www.warpbuild.com/pricing)
- WarpBuild egress: no rate; Enterprise region-specific infra removes cloud ingress/egress costs except macOS — [Cloud Runners docs](https://www.warpbuild.com/docs/ci/cloud-runners)
- WarpBuild spot cloud runners removed 2026-06-08; spot only via BYOC — [Cloud Runners docs](https://www.warpbuild.com/docs/ci/cloud-runners)

### Gaps
- Blacksmith egress and BYOC: not found. 
- Blacksmith per-GB cache beyond 25GB/repo/week: not stated.

## Billing rounding, gotchas, 2025-2026 price changes

### Takeaway
Neither vendor publishes a rounding rule. Mid-cycle invoice triggers exist at both. No vendor-specific 2026 per-minute change found; GitHub's own price moves changed the comparison basis.

### Cited Findings
- Blacksmith invoices the first time combined monthly usage crosses $100; no rounding rule published — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith)
- WarpBuild bills per minute, default on the last day of month, with a threshold that can trigger mid-cycle charge; rounding not described — [warpbuild.com/pricing](https://www.warpbuild.com/pricing)
- GitHub cut hosted-runner prices 15-39% from 2026-01-01 and added $0.002/min for self-hosted runners from 2026-03-01 — [WarpBuild blog](https://warpbuild.com/blog/github-actions-price-change), [IT Brief](https://itbrief.news/story/github-cuts-actions-runner-prices-adds-new-usage-fee) (vendor and press; WarpBuild claims it remains cheaper post-fee)
- Blacksmith savings claims inconsistent: pricing page says 33% cheaper per minute vs GitHub and 2x faster (page: 67%/75% savings assume 2x runtime); docs still say half GitHub price — [usagepricing.com](https://www.usagepricing.com/blueprint/blacksmith), [blacksmith.sh/pricing](https://www.blacksmith.sh/pricing)
- WarpBuild changes: snapshot pricing 2025-12-07; spot removal and Windows 2 vCPU removal 2026-06-08; macOS memory bump 2026-10-01 — sources above

### Gaps
- No Blacksmith 2025-2026 per-minute change announcement found (one search). Rounding unknown for both; ask vendors.
- Note: sub-vendor ARM/Windows claims may be stale versus live pages; recheck before decisions.
