# Namespace and Depot GitHub Actions runner: plan tiers and limits (retrieved 2026-11-11, USD)

Note: all figures come from one WebFetch pass per page (a model-summarized extraction of the page, not a raw read). Checkmarks in feature grids may not have survived extraction. Verify key numbers in a browser before relying on them.

## Namespace plan tiers and limits

### Takeaway
Namespace has four tiers: Developer ($0, pay-as-you-go), Team ($100/mo), Business ($250/mo), Enterprise (custom). Concurrency is capped in vCPUs per OS and rises with the tier. SSO, SOC2, static IPs and private networking per tier were not extractable.

### Cited Findings
Source for every row: [Namespace pricing](https://namespace.so/pricing), retrieved 2026-11-11.

| Item | Developer | Team | Business | Enterprise |
|---|---|---|---|---|
| Price | $0, pay as you go | $100/mo | $250/mo | Custom |
| Included usage (unit minutes, shared by CI and remote builds) | None (pay per use) | 100,000 | 250,000 | Custom |
| Docker builds | $0.05/build | 1,000 included; extra $10 per 1,000 | 2,500 included; extra $10 per 1,000 | Custom |
| Max instance duration | 3 h | 5 h | Up to 24 h | Up to 24 h |
| Linux concurrency | 32 vCPU | 64 vCPU | 160 vCPU | Custom |
| macOS concurrency | 12 vCPU | 24 vCPU | 48 vCPU | Custom |
| Job-count concurrency limit | Not stated (limits are in vCPU) | Not stated | Not stated | Not stated |
| Cache volume snapshots | $0.002/GB-hr | 5,000 GB-hr free | 15,000 GB-hr free | Custom |
| Cache volume storage | $0.0048/GB-day | 3,000 GB-day free | 9,000 GB-day free | Custom |
| Audit log retention | 7 days | 7 days | 30 days | Custom; audit log export |
| Support | Not listed | Email | Dedicated Slack channel | Custom (Enterprise Support add-on available) |
| Devboxes (per user / per workspace) | 1 / 3 | 3 / 30 | 5 / 50 | Custom |
| Other | Managed GitHub runners, cloud image building, cross-invocation caching | Increased concurrency; Windows runners included | High concurrency, very large jobs and builds; Windows runners included | Custom log and metric sinks, dedicated egress pools, custom roles, very high build concurrency |

- Max runner size: the page lists shapes, not a per-plan cap. The largest are 64 vCPU/512 GB (Linux), 32 vCPU/512 GB (Windows) and 16 vCPU/56 GB (macOS). Whether smaller tiers can use all shapes is not stated.
- Storage for container registry, Turborepo cache, GitHub Artifacts and Gradle cache is $0.2/GB-month on all tiers, with no free allowance listed.
- Bazel: available on Developer, Team and Business. Cache hits cost $0.10 per 1,000 and CAS storage $0.20/GB-month.
- Devbox usage is billed separately on Team and Business: $0.004/min and $0.20/GB-month storage. Devbox Plus is $250/mo.
- The FAQ mentions a "Business+" plan that appears nowhere else on the page.

### Inferences
- Concurrency is the main upgrade lever: Linux vCPU goes 32 to 64 to 160 across the paid tiers.
- Team and Business include unit minutes, so heavy users pay an effective flat fee. Developer is purely metered.

### Gaps
- SSO and RBAC per tier: only Enterprise "custom roles" is mentioned.
- SOC2: not on the pricing page. The /security URL I tried returned 404, so it is unverified.
- Static IPs and private networking: only "dedicated egress pools" appears (Enterprise); the rest is unknown.
- Seat limits: none stated other than Devbox counts.
- Cache retention period (days): not stated. Only storage rates were found.
- Artifact size limits and per-plan max runner size: not stated.
- The docs URL for runner concurrency (/docs/solutions/github-actions/runner-concurrency) returned 404.

## Depot plan tiers and limits

### Takeaway
Depot's pricing page shows three tiers, not four: Developer ($20/mo), Startup ($200/mo) and Business (custom). There is no tier named "Enterprise". Business appears to be the top tier and carries the enterprise features: SSO included, audit logs, static IPs, PrivateLink. Concurrency is stated as unlimited on all tiers.

### Cited Findings
Source for the table: [Depot pricing](https://depot.dev/pricing), retrieved 2026-11-11.

| Item | Developer | Startup | Business (acts as Enterprise) |
|---|---|---|---|
| Price | $20/mo | $200/mo | Custom |
| Included GitHub Actions minutes | 2,000 | 20,000 | Custom |
| Included sandbox minutes (shared) | 2,000 | 20,000 | Custom |
| Included container build minutes | 500 | 5,000 | Custom |
| Included cache/registry storage | 25 GB | 250 GB | Custom (not stated) |
| Overage | GHA $0.006/min; builds $0.04/min; storage $0.20/GB/mo | Same | Custom volume pricing |
| Concurrency (jobs, vCPUs) | Unlimited | Unlimited | Unlimited |
| Runner size | 2-64 vCPU, Intel or Arm | Same | Same |
| Max container builder | 16 vCPU | 16-64 vCPU | 16-64 vCPU |
| Cache disks | 50 GB-1 TB | Same | Same |
| Seats | 1 user | Unlimited | Unlimited |
| RBAC | No | Yes | Yes |
| SSO (SAML and SCIM) | No | Optional add-on, $500/mo | Included |
| Audit logging | No | No | Yes |
| Static outbound IPs and firewall rules | No | No | Yes |
| AWS PrivateLink | No | No | Yes |
| Tailscale private networking | Yes | Yes | Yes |
| Support | Discord community | Discord and email | Discord, email, Slack Connect |
| GPU builds | No | No | Yes |
| Other | US and EU regions | Same | Custom regions, dedicated infrastructure, deploy in your own AWS account, invoice/ACH and AWS Marketplace billing |

Source for the next four bullets: [Depot GitHub Actions docs](https://depot.dev/docs/github-actions/overview), retrieved 2026-11-11.
- The docs say "No concurrency limits, cache size limits, or network limits". Ubuntu runners run from 2 vCPU/2 GB to 64 vCPU/256 GB.
- GitHub Actions cache retention is configurable in the Depot Cache overview. No default period is stated.
- Only Business gets GPU-enabled runners and custom runner AMIs.
- Depot runners support only repositories owned by GitHub organizations. Larger runners consume included minutes faster (multipliers).

### Inferences
- Depot's unlimited concurrency means the plan gates features (SSO, audit log, static IP) rather than throughput.
- The user's "Enterprise" label maps to Business here. Confirm by checking whether a separate Enterprise page exists.

### Gaps
- SOC 2 status: not stated on the pricing page or the security docs page I fetched (https://depot.dev/docs/security/overview).
- Artifact limits: not mentioned in the docs.
- Default cache retention period: not stated.
- The "test results" quota is 1,000,000 on Developer and Startup, and unknown for Business.
- A separate "Enterprise" tier: not found; unverified whether one exists elsewhere on the site.
