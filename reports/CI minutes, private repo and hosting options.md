# Aivastra: CI Minutes, Private Repo & Hosting Options

2026-11-11 · Adesh

## Summary

Move the repo to a GitHub organisation on the Team plan and keep GitHub-hosted runners: about $32 to $82 a month for five people ($380 to $980 a year), depending on how CI usage grows.

- **Usage:** CI grew from about 1,700 minutes in June 2026 to about 8,400 in October. The base projection is about 7,500 a month now and 10,400 by October 2027.
- **Why it matters:** the repo is public, so minutes are free today. Private repos get $18 of included compute on Team, about 3,000 minutes, so the base case pays for roughly 4,500 to 7,400 extra minutes a month at $0.006 each.
- **Why Team:** it is the cheapest organisation plan with protected branches, required checks and required reviewers on private repos, at $4 per user a month. A personal Pro account with collaborators is cheaper still, but one account then owns the repo.
- **Alternatives:** GitLab Premium costs about $1,740 a year and means rewriting CI. A Hostinger KVM 4 runner costs $156 a year on the 24-month promo but saves at most about $580 a year and adds upkeep. Personal Pro with collaborators and a VPS runner is about $204 a year, with single-owner risk.
- **Measured:** a full CI run took about 6 minutes on GitHub-hosted runners, about 36 minutes on one self-hosted runner with 4 CPUs, and about 12 minutes with 11 runners on 8 CPUs. A KVM 4 would land at roughly 20 to 36 minutes, so the test supports staying on hosted runners (details under Self-hosted runners on a VPS).
- **Next:** trim waste (weekly full run, duplicate PR runs), set a budget cap, then transfer and go private. Before going private, pilot a third-party hosted runner for 30 days; a Hostinger VPS runner is not recommended, since the test measured 20 to 36 minute runs against about 6 on hosted.

## Actions minutes history

CI usage grew about fivefold in five months, from roughly 1,700 minutes in June 2026 to roughly 8,400 in October, and about 27,700 minutes in total since the repo was created on 25 May 2026. All jobs run on `ubuntu-latest`, so every minute counts at the Linux rate with no multiplier.

The repo is public, so GitHub reports zero billable time. These figures are my reconstruction from the start and finish time of each job across 1,968 of 1,984 workflow runs, rounded up to whole minutes per job the way GitHub bills. Treat them as accurate to roughly 10%. Sixteen runs could not be fetched and 37 jobs with negative durations were dropped. November covers only the first 10 days: 2,174 minutes, a pace of about 6,500 for the month.

Where the minutes go, by job:

| Job | Minutes | Share |
| --- | --- | --- |
| Integration tests | 8,325 | 30% |
| Unit tests | 4,538 | 16% |
| Deploy affected services | 3,170 | 11% |
| Typecheck | 2,138 | 8% |
| SSH deploy step | 1,847 | 7% |
| Detect affected targets | 1,672 | 6% |
| ci-gate | 1,666 | 6% |
| Lint and format | 1,480 | 5% |

By trigger: pull requests 14,685 minutes (53%), pushes 10,540 (38%), the weekly Monday schedule 1,837 (7%), manual runs 612 (2%).

Three things stand out. Deploy jobs are 18% of usage, and the one deploy run I inspected spent 2 minutes 41 seconds in SSH and `docker compose` steps. The weekly cron runs the whole suite for 7% of minutes. The ci-gate and detect jobs together take 12% of minutes, because each bills at least one minute per run.

## Projection

The base case is about 7,500 minutes a month now, rising to about 10,400 by October 2027, which is 2.5 to 3.5 times the GitHub Team allowance of 3,000 minutes.

*[Chart: Reconstructed from GitHub job timestamps, repo runs to 10 Nov 2026; scenarios are my assumptions. Monthly Actions minutes, Jun 2026 actual (1,707; 3,097; 6,584; 5,481; 8,388), then low/base/high scenarios in the table below. See the live doc for the drawn chart.]*

| Scenario | Starting month | Growth | 12-month total | Assumption |
| --- | --- | --- | --- | --- |
| Low | 5,000 | flat | 60,000 | Team cuts waste: drop the weekly full run, cancel superseded runs, trim deploy time |
| Base | 7,500 | 3% a month | 106,400 | Today's pace plus steady feature work and a slowly growing team |
| High | 8,400 | 8% a month | 159,400 | More contributors, more Android and Shopify surfaces, more test shards |

The starting points sit between the November pace (about 6,500) and October (8,388). Growth rates are judgment, not forecasts from data: June to October grew faster than any of them, but that was a team and test suite being built, and a single month swings by 20% (September fell 17%).

## GitHub plans

For a private repo, GitHub Team at $4 per user per month is the cheapest organisation plan that gives branch protection, required reviewers and CODEOWNERS, and it includes $18 of Actions compute. The repo is public today, so standard-runner Actions minutes are unlimited and free; that ends when it goes private.

| Plan | Price | Included Actions compute (private repos) | Private-repo controls | Notes |
| --- | --- | --- | --- | --- |
| Free (personal or org) | $0 | $12/month (about 2,000 Linux minutes) | No protected branches, required reviewers or CODEOWNERS on private repos | 20 concurrent jobs, 500 MB artifacts, community support |
| Pro (personal only) | $4/month (confirmed by Adesh) | $18/month (about 3,000 Linux minutes) | Protected branches, required reviewers, CODEOWNERS | Single owner; no org. 40 concurrent jobs |
| Team (org) | $4 per user/month | $18/month (about 3,000 Linux minutes) | Protected branches, required reviewers, CODEOWNERS, repository rules | 60 concurrent jobs, 2 GB artifacts, larger runners available, web support |
| Enterprise Cloud (org) | $21 per user/month | $300/month (50,000 Linux minutes) | Adds environment protection rules on private repos, SAML SSO, SCIM, audit log API | 500 concurrent jobs, 99.9% uptime SLA, 50 GB artifacts |

Per-minute overage after the allowance: Linux 2-core $0.006, Linux 1-core $0.002, Linux arm64 $0.005, Windows $0.010, macOS $0.062. Each job rounds up to a whole minute, so many short jobs cost more than their wall-clock time suggests. The allowance is now stated in dollars, not minutes; the minute figures above are derived at the Linux rate, except Enterprise, where GitHub states 50,000.

Self-hosted runners stay free and do not draw down the allowance. Without a payment method on file, jobs are blocked once the allowance is spent.

The dollar-versus-minute wording on the pricing page and in the docs disagrees in places, and the pricing page lists environment protection rules for Team as public repos only. Confirm both before relying on them.

Sources: [Actions billing](https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions), [runner pricing](https://docs.github.com/en/billing/reference/actions-minute-multipliers), [limits](https://docs.github.com/en/actions/reference/limits), [pricing page](https://github.com/pricing), [plans doc](https://docs.github.com/en/get-started/learning-about-github/githubs-plans).

## GitLab plans

GitLab.com Free gives only 400 compute minutes a month and caps private top-level groups at 5 users, so it is a smaller allowance than GitHub Free and does not fit a growing team. Premium is $29 per user per month billed annually and includes 10,000 minutes.

| Plan | Price | Included compute minutes | Limits and notes |
| --- | --- | --- | --- |
| Free | $0 | 400 per month | 5 users per private top-level group, 10 GiB storage, card needed to use shared runners |
| Premium | $29 per user/month, billed annually | 10,000 per month | Unlimited users, 500 GiB storage. The card also shows "Let's talk", so confirm the price at checkout |
| Ultimate | Contact sales | 50,000 per month | Security and compliance suite. No published price |

Extra minutes cost $10 per 1,000 ($0.010 each) as a one-time purchase that rolls over. Minutes are weighted by a cost factor: a small Linux runner is 1, medium 2, large 3, macOS M1 6. Jobs that run on your own runners "will not use your compute minutes and is unlimited", and need no credit card.

Moving costs more than the plan price: all three workflows (`ci.yml` and the two Android workflows) would be rewritten as `.gitlab-ci.yml`, and third-party actions such as `pnpm/action-setup`, `subosito/flutter-action` and `r0adkll/upload-google-play` need GitLab equivalents. The switch is a project, not a setting.

For comparison at the same spend: GitLab Premium is $29 per user against GitHub Team at $4 per user, and GitHub Team already covers private-repo review rules.

Project management is GitLab's main extra. GitLab's pricing page lists "Team Project Management" and "SLA Management" under Premium, and "Strategic Portfolio Management" and "Value Stream Management" under Ultimate. From my own knowledge, not verified here: issues, boards, milestones and labels are on every tier; epics, roadmaps and iterations (sprints) start at Premium; and a container registry, package registry, wiki and Pages are built in. GitHub covers the basics on every plan with Issues, Projects (boards, tables, roadmap), Discussions, Wiki and Pages. Check GitLab's feature comparison page before paying for Premium on the strength of this note.

Sources: [GitLab pricing](https://about.gitlab.com/pricing/), [compute minutes docs](https://docs.gitlab.com/ci/pipelines/compute_minutes/). The comparison table on the pricing page lost its check marks in extraction, so per-tier availability of protected environments and merge request approvals is unconfirmed.

## Self-hosted runners on a VPS

A self-hosted runner on a Hostinger VPS costs a flat $9 to $13 a month on a 24-month term, runs on both GitHub and GitLab for free, and removes the minute cap entirely. The cost moves from money to operations: patching, disk cleanup, runner uptime and secret hygiene become your job.

| Plan | vCPU | RAM | NVMe | 24-month price | Renewal |
| --- | --- | --- | --- | --- | --- |
| KVM 1 | 1 | 4 GB | 50 GB | $6.49/mo | $11.99/mo |
| KVM 2 | 2 | 8 GB | 100 GB | $8.79/mo | $14.99/mo |
| KVM 4 | 4 | 16 GB | 200 GB | $12.99/mo | $28.99/mo |
| KVM 8 | 8 | 32 GB | 400 GB | $25.99/mo | $49.99/mo |

The prices are a Black Friday promotion on a 24-month term. Hostinger's page shows no 12-month or monthly price, and does not say whether vCPUs are dedicated or shared. Source: [Hostinger VPS](https://www.hostinger.com/vps-hosting).

Fit for this repo: the CI integration job starts Postgres, Redis and MinIO, and the test below measured what that costs. One 4-CPU self-hosted runner needed about 36 minutes for a full run against about 6 on GitHub-hosted runners, so a KVM 2 or KVM 4 would slow every pull request. Size a VPS from the measured run, not from vCPU count.

Rules that apply here:

- Never put the runner on the production VPS. A runner executes pull-request code with access to whatever secrets the job holds.
- Use a private repo only. Self-hosted runners on a public repo let strangers run code on your box through pull requests.
- Run jobs in ephemeral containers or wipe the workspace between runs, and prune Docker images on a schedule.
- Keep GitHub-hosted runners as a fallback for the Android builds if the VPS disk or RAM is too small.

Both GitHub and GitLab state that self-hosted runner use is free and does not reduce the included allowance. GitHub's pages list no platform fee for self-hosted runners today, but its postponed $0.002 per minute charge has no new date, so re-check before committing.

### Measured: a self-hosted runner test (10–11 Nov 2026)

A full run of `ci.yml` took about 36 minutes on one self-hosted runner and about 12 minutes with 11 runners on 8 CPUs, against about 6 minutes on GitHub-hosted runners. A KVM 4 can host one to three runners, not the 11-runner setup, so expect roughly 20 to 36 minutes there.

How it was tested: one 32-vCPU, 84 GB Ubuntu server (not Hostinger hardware) with the runner and Docker pinned to N CPUs through a systemd slice, memory sampled every second, and a copy of `ci.yml` with the deploy job removed (branch `ci/self-hosted-bench`). Every run executed all 13 jobs.

| Setup | Wall-clock | Peak memory in use | CPUs busy (mean) | Outcome |
| --- | --- | --- | --- | --- |
| GitHub-hosted, full suite (5 sampled runs) | 363–414 s (about 6 min) | n/a | n/a | passed |
| 1 self-hosted runner, 4 CPUs (2 runs) | 2,122–2,163 s of job time (about 36 min, jobs run one after another) | 6–7 GiB | 1.6 | flaky tests failed |
| 11 parallel runners, 8 CPUs | 721 s (about 12 min) | 15 GiB | 5.7 of 8 | 1 flaky test failed |
| 11 parallel runners, 32 CPUs | 625 s | 26 GiB | 7.2 of 32 | invalid: 3 jobs failed on a test-harness limit |

Memory in use is the whole machine and includes about 4 GiB for the OS, Docker and the runner. Even run alone, each job took 1.2 to 1.8 times as long as on a hosted runner (the detect job 2.4 times), so the test server's cores are slower per job than GitHub's, and Hostinger's vCPUs are an unknown.

**What it means for the Hostinger plans**

| Plan | vCPU / RAM | Runners it can host | Expected full run | Price a year (promo / renewal) |
| --- | --- | --- | --- | --- |
| KVM 2 | 2 / 8 GB | 1, tight on RAM | slower than 36 min, not measured | $105 / $180 |
| KVM 4 | 4 / 16 GB | 2 by CPU, 3 by RAM | about 36 min with 1 runner (measured at 4 CPUs); 20–25 min with 2 (my estimate) | $156 / $348 |
| KVM 8 | 8 / 32 GB | all 11, using 15 of 32 GiB | about 12 min (measured at 8 CPUs) | $312 / $600 |

KVM 4 cannot copy the 8-CPU result. That run kept 5.7 CPUs busy for 721 s, so 4 vCPUs would need at least about 17 minutes even with perfect packing, and 11 jobs peaking at 15 GiB leave no headroom in 16 GB. Using the same arithmetic as the $580 figure for KVM 4, KVM 8 would save at most about $430 a year in the high scenario on the promo price and about $140 at renewal.

**Findings that apply to any self-hosted option**

- **One runner per host is not enough for speed, and more runners need isolation.** The tests hard-code Redis on 6379 and MinIO on 9000, and the compose file maps Postgres to 5432, so parallel jobs on one host collide. The test gave each runner its own private Docker daemon and network namespace (`scripts/bench/parallel` on the branch). That is extra upkeep beyond registering more runners.
- **The test harness caps useful CPUs per job.** The API tests share 14 Redis database indexes, and Vitest starts one worker per core minus one. At 32 CPUs that is 31 workers, and two API suites timed out waiting for an index. This does not affect 4 to 8 vCPU machines, but it means more cores per runner stops helping.
- **Two timing-sensitive tests fail on the self-hosted runner.** The dispatcher test `happy-path` (`releaseWorkerIfToken`) failed in 4 of 5 runs, and `widget-key-rate-limit` failed once. Both passed in the hosted runs I sampled, though I only looked at successful ones. Until fixed they would block merges through `ci-gate`.
- **The slowest job sets the floor.** On hosted runners a full run is the detect job plus the dispatcher integration shard (about 336 s). More runners do not shorten it, and more shards might. Splitting that suite into four shards is free on self-hosted runners and is untested.

**Verdict:** the test supports the recommendation to stay on GitHub-hosted runners. A KVM 4 is cheap but would turn about 6-minute feedback into 20 to 36 minutes. KVM 8 gets within about 2 times of hosted speed and needs the isolation work above. Not tested: Hostinger hardware itself, single-runner runs at 2 and 8 CPUs, a 16-CPU run, and sharded dispatcher tests.

## Industry standard and what startups do

The common pattern for an early team already on GitHub is to stay on GitHub, move the repo into an organisation on Team, run CI on GitHub-hosted runners, and add a self-hosted runner only once the minutes bill is large enough to justify the upkeep. I could not find a source that reports what specific startups actually use, so this is general practice as the comparison articles describe it, not a measured survey.

- Most teams start on GitHub's free allowance because the code is already there, and the allowance covers a small team's early CI. The comparison articles I read say GitLab's 400 free minutes run out within about two weeks of active development.
- Paying for seats is usually driven by access controls (required reviews, protected branches), not by minutes. That is the $4 Team seat here.
- Self-hosted runners are the standard cost lever once usage passes a few thousand minutes a month, mostly for slow or heavy jobs such as integration tests and mobile builds, while light jobs stay hosted.
- GitLab is chosen mainly by teams that want one tool for code, CI and security scanning, or want to self-host the whole platform. It costs more per seat.
- Enterprise tiers are bought for SAML SSO, audit APIs and compliance. A team of five does not need them yet.

Self-hosted runner fee, checked on GitHub's own pages on 10 November 2026: GitHub announced a $0.002 per minute platform charge on self-hosted runners starting 1 March 2026, then [postponed it](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) "to take time to re-evaluate our approach", with no new date. GitHub's [billing ](https://docs.github.com/en/actions/concepts/billing-and-usage)[docs](https://docs.github.com/en/actions/concepts/billing-and-usage) say Actions usage is free for self-hosted runners. The fee could return, so re-check before committing to a self-hosted plan.

Sources (third-party, indicative only): [StackTrack](https://stacktrack.com/posts/understanding-github-actions-runner-costs-in-2026/), [CI/CD cost calculator](https://cicdcalculator.com/github-actions-vs-gitlab-ci), [WZ-IT](https://wz-it.com/en/blog/github-actions-pricing-change-2026-open-source-alternatives/), [Costbench](https://costbench.com/compare/gitlab-vs-github/).

## Cost comparison and tradeoffs

GitHub Team with hosted runners costs about $380 to $980 a year across all three scenarios, a quarter to under half of GitLab Premium, and a self-hosted VPS saves at most about $580 a year on top of that, while making CI runs 3 to 6 times slower (measured). I assumed 5 paid seats, since 5 distinct people committed in October, and used list prices without tax.

| Option | Low (5,000/mo) | Base (7,500, +3%/mo) | High (8,400, +8%/mo) | What you give up |
| --- | --- | --- | --- | --- |
| GitHub Free org, hosted | $216/yr | $495/yr | $812/yr | No protected branches or required reviewers on private repos |
| GitHub Pro personal + 4 collaborators, hosted | $192/yr | $471/yr | $788/yr | One account owns the repo, so one lost or locked account loses it; no org features; Pro is $4/mo |
| GitHub Pro personal + KVM 4 runner | $204/yr | $204/yr | $204/yr | Same single-owner risk; runs take 20 to 36 min against about 6 hosted (measured); $396/yr after the promo ends |
| GitHub Team, hosted | $384/yr | $663/yr | $980/yr | Nothing material at this size |
| GitHub Team + Blacksmith runners | $336/yr | $522/yr | $734/yr | Third-party dependency; Blacksmith prices unconfirmed; not piloted |
| GitHub Team + KVM 4 runner | $396/yr | $396/yr | $396/yr | You operate the runner; runs take 20 to 36 min against about 6 hosted (measured); $588/yr after the promo ends |
| GitLab Free + bought minutes | $552/yr | $1,016/yr | $1,546/yr | 5-user cap; full CI rewrite |
| GitLab Premium | $1,740/yr | $1,740/yr | $2,134/yr | Full CI rewrite; 7 times the seat price |
| GitLab Free + KVM 4 runner | $156/yr | $156/yr | $156/yr | 5-user cap, full CI rewrite, you operate the runner, slow runs |

Formulas: GitHub overage = (annual minutes minus 12 times the allowance) times $0.006, plus $4 times 5 seats times 12 for Team. GitLab bought minutes = $0.01 each beyond the included amount. The VPS rows use the 24-month KVM 4 price of $12.99 a month. The Pro row is one $4 a month seat ($48 a year) plus overage above the $18 allowance, with the other four contributors added as free collaborators; the $4 price was confirmed by Adesh; GitHub's pricing page, calculator and plans docs, which I read on 10 November 2026, show no Pro price. The Blacksmith row is 5 Team seats ($240) plus $0.004 for each minute beyond its 3,000 free minutes a month, using the 2 vCPU rate from the third-party runner research below. Enterprise (about $1,260 a year for 5 seats) is left out because nothing here needs SSO.

What each option provides across the software development lifecycle:

| Option | Plan | Code and review | Build and test | Release and deploy | Secure and operate |
| --- | --- | --- | --- | --- | --- |
| GitHub Free org, hosted | Issues, Projects boards and roadmap | Repos and PRs; no required reviewers, protected branches or CODEOWNERS on private repos | Actions, $12 included (about 2,000 min), 20 concurrent jobs | Actions workflows; 500 MB Packages; environment protection rules only on public repos | Audit log; community support |
| GitHub Pro personal + 4 collaborators | Same as Free | Required reviewers, protected branches, CODEOWNERS | $18 included (about 3,000 min), 40 concurrent jobs | 2 GB Packages; no org-level controls | Email support; single owner account |
| GitHub Team, hosted | Same as Free | Required reviewers, protected branches, CODEOWNERS, repository rules | $18 included (about 3,000 min), 60 concurrent jobs, larger runners | Actions workflows; 2 GB Packages; deployment branches and secrets for environments | Audit log; web support; no SAML SSO |
| Team + self-hosted VPS | Same as Team | Same as Team | Your own runner: no minute cap, your hardware limits speed | Same as Team; the runner must reach the deploy targets | Same as Team, plus you patch and monitor the runner |
| GitLab Premium | Issues and boards, plus Team Project Management and SLA Management; epics and roadmaps likely (unverified) | Merge requests; 500 GiB storage; approval rules unverified | 10,000 min included, Advanced CI/CD | Built-in registries and environments (unverified) | SAST on every tier; dependency and container scanning, vulnerability management only in Ultimate; priority support |

## Third-party runner options (to explore)

Several hosted-runner vendors list Linux x64 minutes at or below GitHub's $0.006 for 2 vCPU, so they are worth testing before we settle on GitHub-hosted runners. Prices below are list prices per minute as of 11 Nov 2026, from vendor pages read through a summarising fetch tool, and are not yet checked against live checkout.

| Provider | 2 vCPU | 4 vCPU | 8 vCPU | 16 vCPU | Free tier and plans |
| --- | --- | --- | --- | --- | --- |
| [GitHub-hosted](https://docs.github.com/en/billing/reference/actions-runner-pricing) (baseline) | $0.006 | $0.012 | $0.022 | $0.042 | Included compute per plan; billed per whole minute per job |
| [Ubicloud](https://ubicloud.com/docs/about/pricing) (premium) | $0.002 | $0.004 | $0.008 | $0.016 | $2.50 monthly credit; standard x64 ($0.00125 at 2 vCPU) closed to new customers |
| [Namespace](https://namespace.so/pricing) (prepaid) | $0.002 | $0.004 | $0.008 | $0.016 | Pay-as-you-go $0 with a 30-day trial; Team $100/mo, Business $250/mo; overage is 1.5x |
| [Blacksmith](https://www.blacksmith.sh/pricing) | $0.004 | $0.008 | $0.016 | $0.032 | 3,000 free 2 vCPU minutes per org per month, no card; larger runners burn it faster; startup and open-source discounts |
| [WarpBuild](https://www.warpbuild.com/pricing) | $0.004 | $0.008 | $0.016 | $0.032 | No free amount published; unlimited concurrency; BYOC $0.002/min |
| [Depot](https://depot.dev/pricing) | $0.006 | $0.012 | $0.024 | $0.048 | Developer $20/mo (2,000 min), Startup $200/mo (20,000 min) |
| [RunsOn](https://runs-on.com/pricing/) | about $0.0009 AWS spot | about $0.0013 | not published | about $0.0037 | Runs in our own AWS account; licence EUR 300 to 3,600 a year, plus a control plane from about $7/mo |
| [Actuated](https://actuated.com/pricing) | flat fee | flat fee | flat fee | flat fee | $150/mo first server, $125/mo each extra; unlimited minutes, but we supply the bare-metal or nested-virtualization hosts |
| [Buildkite](https://buildkite.com/pricing) | n/a | about $0.016 | about $0.032 | n/a | Separate CI platform, not an Actions runner; Pro $30 per active user/mo; hosted Linux $0.004 per vCPU-minute |

Arm is cheaper still at Ubicloud ($0.00125 at 2 vCPU), Namespace, Blacksmith ($0.0025) and WarpBuild ($0.003).

- **BuildJet is out:** it stopped running jobs on 2026-03-31, so `buildjet-*` labels fail ([WarpBuild's account](https://warpbuild.com/blog/buildjet-shutting-down)).
- **runmyjob:** it is RunJob from Puzl Cloud and bills per second on CPU and RAM used, but I found no prices, free tier or limits, so it cannot be compared yet.
- **Self-hosted fee:** if GitHub's postponed $0.002 a minute self-hosted charge returns, it would apply on top of RunsOn and Actuated.
- **Conflicts to settle before buying:** Ubicloud's docs and its price blog disagree on the standard rate, Depot's Windows prices contradict its own multiplier, and Blacksmith's per-size table comes from a third-party tracker because its docs page returned a 404.
- **Hidden costs:** cache and Docker layers are billed separately at Blacksmith ($0.50/GB-month), WarpBuild ($0.20/GB-month plus per-operation fees) and Depot ($0.20/GB-month beyond 25 GB). No vendor's egress price was found.

The full write-up with sources is in `reports/GitHub Actions runner pricing.md` in the repo working tree. Benchmarks, security and migration effort are not covered yet.

### Plans and limits by provider

Plans differ mostly in concurrency, runner size, cache and support, not in the per-minute rate. Figures are as read on 11 Nov 2026 from each vendor's pricing page and docs through a summarising fetch tool, so confirm the ones you rely on in a browser. GitHub's own plans are in the GitHub plans section above.

| Provider and plan | Price | Included usage | Concurrency | Largest runner | Cache and storage | Support and security |
| --- | --- | --- | --- | --- | --- | --- |
| Ubicloud (single usage plan) | Per minute only | $2.50 monthly credit, card required | Not published | 30 vCPU | 30 GB standard or 100 GB premium cache (marketing page, lower confidence) | Not published |
| Namespace Developer | $0, pay as you go | None; 30-day trial | 32 vCPU Linux, 12 vCPU macOS | 64 vCPU Linux | Cache $0.0048/GB-day; jobs capped at 3 h | Not listed; audit log 7 days |
| Namespace Team | $100/mo | 100,000 unit minutes, 1,000 Docker builds | 64 vCPU Linux, 24 vCPU macOS | 64 vCPU Linux | 3,000 GB-day cache free; jobs up to 5 h | Email; audit log 7 days |
| Namespace Business | $250/mo | 250,000 unit minutes, 2,500 Docker builds | 160 vCPU Linux, 48 vCPU macOS | 64 vCPU Linux | 9,000 GB-day cache free; jobs up to 24 h | Dedicated Slack; audit log 30 days |
| Namespace Enterprise | Custom | Custom | Custom | Custom | Custom | Custom roles, log export, dedicated egress pools |
| Blacksmith free allowance | $0 | 3,000 minutes per org per month | Unlimited | 32 vCPU Linux and Windows, 12 vCPU macOS | Actions cache 25 GB per repo per week, evicted after 7 idle days | Standard support, no SLA; SOC 2 Type 2; GitHub SSO login |
| Blacksmith pay as you go | Per minute | Pay after the allowance | Unlimited | Same | Docker layer cache and sticky disks $0.50/GB-month, no size cap stated; static IP $100/month | Premium support: greater of $250/mo or 5% of spend |
| Blacksmith Enterprise | Custom | Custom | Unlimited | Same | Same | 99.9% uptime SLA with service credits |
| WarpBuild usage plan | Per minute; no subscription | Amount not stated; no card at signup | Advertised unlimited | 32 vCPU and 128 GB Linux and Windows, 12 vCPU macOS | $0.20/GB-month, no numeric cap, 7-day expiry | SOC 2 Type 2; SAML SSO $250/mo, audit logs $400/mo, data residency $250/mo as add-ons |
| WarpBuild Enterprise | Custom | Custom | Unlimited | Same | BYOC cache free | 99.9% SLA, 24/7 support, Slack channel, SCIM, dedicated cloud option |
| Depot Developer | $20/mo | 2,000 minutes, 500 build minutes | Unlimited | 64 vCPU | 25 GB cache and registry | 1 user; Discord support; no RBAC or SSO |
| Depot Startup | $200/mo | 20,000 minutes, 5,000 build minutes | Unlimited | 64 vCPU | 250 GB | Unlimited users; RBAC; SSO optional at $500/mo; Discord and email |
| Depot Business | Custom | Custom | Unlimited | 64 vCPU | Custom | SSO, audit logging, static IPs, PrivateLink, GPU builds; Slack Connect |
| RunsOn Starter | EUR 300/yr | Under 50,000 jobs a month | None enforced | Your AWS instance types | In your own AWS account | Community Slack plus email; no SLA |
| RunsOn Growth | EUR 900/yr | Under 200,000 jobs a month | None enforced | Same | Same | Same |
| RunsOn Scale | EUR 1,800/yr | Under 500,000 jobs a month | None enforced | Same | Same | Same |
| RunsOn Unlimited | EUR 3,600/yr | Unlimited jobs | None enforced | Same | Same | Priority support, Slack Connect, source access |
| Actuated Self-Service | $150/mo first server, $125 each extra | Unlimited minutes per server | Unlimited per server | 2 to 32 cores | On your own servers | Community email, no SLA; Linux only, GPU supported, no macOS |
| Buildkite Free | $0 | 2,000 Linux vCPU-minutes, 5 users | 10 jobs | Small (2 vCPU) hosted agents | Builds kept 30 days | Not stated |
| Buildkite Pro | $30 per active user/mo, up to 50 users | 4,000 vCPU-minutes | 10 agents, then $3.50 each up to 250 | Larger shapes | Builds kept 90 days | SSO and signed pipelines |
| Buildkite Enterprise | Custom, 30-user minimum | Custom | Unlimited agents | Custom | Custom | SCIM, activity log, token revocation; 99.95% uptime commitment |
| RunJob Free | EUR 0 | 400 vCPU-minutes | 10 jobs | 12 vCPU and 32 GB | Not stated | Not stated |
| RunJob Business | EUR 50/mo | 2,000 vCPU-minutes | Unlimited | 48 vCPU and 96 GB | 10 GB persistent storage and job cache | Not stated |
| RunJob Enterprise | Custom | Not listed | Unlimited | Custom | Custom | Not stated |

- **Organisation accounts only:** Depot, WarpBuild and RunJob do not support personal GitHub accounts, which fits the move to a GitHub organisation already recommended here.
- **Where plans really differ:** Namespace gates concurrency, job length and audit retention by plan. Depot gates SSO, audit logs, static IPs and PrivateLink. Blacksmith and WarpBuild gate mainly support, SLA and paid add-ons. RunsOn gates only the job volume it expects, with no enforcement.
- **Security features worth checking early:** Blacksmith and WarpBuild both state SOC 2 Type 2. Namespace and Depot did not state SOC 2 on the pages read.
- **RunJob price:** overage is about EUR 0.072 per vCPU-hour, billed per second on CPU and memory used.
- **Not found:** Ubicloud support and concurrency, Actuated burst and custom plans, RunsOn cache caps and default AWS quotas, Namespace job-count concurrency and per-tier SSO, WarpBuild's free amount, and job timeouts and spending caps for Blacksmith and WarpBuild.
- **Under RunsOn, the real limits are on the AWS side:** you must raise your own on-demand and Spot vCPU quotas, and a Spot interruption fails the job unless GitHub's retry picks it up.

## Recommendation and next steps

Move the repo into a GitHub organisation on Team, keep GitHub-hosted runners, set a spending cap, and cut CI waste before adding any server. Pilot a third-party hosted runner for 30 days before settling (see Third-party runner options). Do not use a Hostinger KVM 4 runner: the benchmark measured 20 to 36 minute runs against about 6 on hosted.

Why this and not the others: GitLab Premium costs about 7 times more per seat plus a rewrite of all three workflows. A VPS saves at most about $580 a year at the high scenario and adds an on-call burden for a five-person team. GitHub Free in an organisation is cheaper than Team but cannot use protected branches or required status checks on private repos, and docs/version-control.md requires the ci-gate check before merging to main. Personal Pro with collaborators is cheaper than Team too, at about $192 to $788 a year, but one account stays the sole owner.

1. Create a free GitHub organisation, invite the five contributors, and upgrade it to Team.
2. Set a monthly Actions budget with a stop at the cap, for example $60, so a runaway workflow blocks instead of billing.
3. Transfer the repo into the organisation first, then switch it to private. Verify before the switch that the production and staging VPS deploys can still `git pull`: a private repo needs a deploy key or token there, and the SSH deploy job runs `git pull`.
4. Re-check every secret, environment and webhook that points at the old repo path, including Shopify and Cloudflare configuration. Also check what was exposed while the repo was public: it has 0 forks and 0 stars, so exposure is low, but rotate any secret that was ever committed.
5. Cut waste in the same week. Candidates from the history: shrink or drop the weekly full run (7% of minutes), cancel superseded pull-request runs, and review the 12% spent on the detect and gate jobs. That would put usage near the low scenario.
6. Record the org, plan, budget cap and the deploy-key change in `docs/progress.md`, as the repo rules require for state that lives outside the code.

Open questions:

- Seats: confirmed as 5 contributors, so the cost table's 5-seat assumption holds. Sharing one account across 5 devices is not recommended (it breaks required reviews and audit trails, and likely GitHub's terms; confirm in GitHub's Terms of Service).
- GitHub Pro's $4 a month price was confirmed by Adesh, though GitHub's public pricing page shows no Pro card, so the figure rests on the account's own billing page.
- Does the pricing page's "Public repositories" only entry for Team environment protection rules matter? Check whether production deploys depend on environment approvals.
- Do the two Android workflows need a larger runner? They would bill from the first minute on Team.
- Benchmark record: the raw timings are kept only in this doc (the Measured section). The branch holds just the harness and the pricing report, on `ci/self-hosted-bench`. The test measured CI speed only and is not part of the Aivastra app, and the conclusion is settled: self-hosted VPS runners are much slower than GitHub-hosted or specialised third-party runners.
- Third-party runner prices, including the Blacksmith row in the cost table, come from vendor pages read through a summarising tool. Check them at checkout and pilot for 30 days before choosing one.
