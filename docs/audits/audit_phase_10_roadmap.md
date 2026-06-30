# Phase 10: Prioritized Improvement Roadmap

This final document consolidates the findings from Phases 1 through 9 into a prioritized execution plan. The goal is to evolve Ai Vastra from a prototype architecture into a world-class, enterprise-ready SaaS platform.

The roadmap is divided into three tiers based on Severity, Business Impact, and Technical Debt leverage.

---

## Tier 1: Critical Stability & Security (Immediate Action)
These items represent existential threats to the platform's operation or revenue.

1. **Credit Deduction Atomic Locking (Finding 1.3)**
   * **Action:** Rewrite the `WidgetService.createJob` Postgres transaction to use explicit `FOR UPDATE` row locks or `UPDATE ... RETURNING` to guarantee credit limits cannot be overdrafted via concurrent requests.
   * **Impact:** Prevents immediate revenue loss.
2. **Widget Rate Limiting & Origin Strictness (Finding 2.1 & 7.1)**
   * **Action:** Implement a Redis-backed rate limiter on `POST /v1/widget/jobs`. Move away from blind `Origin` trust; require cryptographically signed short-lived session tokens from the merchant backend.
   * **Impact:** Stops abuse, DDoS attacks, and API key scraping.
3. **Redis Stream Lifecycle Management (Finding 1.2)**
   * **Action:** Implement `XACK` / `XDEL` flows in the dispatcher and add an `XTRIM` bound (`MAXLEN ~ 10000`) on `XADD` calls to prevent Redis OOM crashes.
   * **Impact:** Platform uptime stability.
4. **ComfyUI Sandboxing & Orchestration (Finding 7.5 & 9.1)**
   * **Action:** Re-architect the `dispatcher` to strictly sanitize inputs. Never pass raw user inputs directly into ComfyUI parameters. Prepare the orchestration for multi-node GPU deployment.
   * **Impact:** Prevents RCE and scales generation capabilities.

---

## Tier 2: Product Completeness & UI/UX (Next 30 Days)
These items block adoption by enterprise customers and degrade the end-user experience.

1. **Job Cancellation & Refunds (Finding 3.1 & 1.5)**
   * **Action:** Expose a `DELETE /v1/widget/jobs/:id` route for users to abort generation. Build a cron sweeper to automatically refund credits for stuck jobs.
   * **Impact:** Builds merchant trust and improves end-user control.
2. **Client-Side Image Optimization (Finding 6.3 & 3.2)**
   * **Action:** Integrate a Web Worker in the widget to validate file sizes/types locally, downscale large files, and compress to WEBP *before* calling the API for a presigned URL.
   * **Impact:** Massively speeds up mobile uploads and cuts S3 ingress costs.
3. **B2B Webhook Infrastructure (Finding 2.2)**
   * **Action:** Build a Webhook dispatcher reading off the same PubSub events as SSE, allowing merchants to receive backend callbacks.
   * **Impact:** Unlocks enterprise API-only customers.
4. **Design System Migration (Finding 4.2 & 9.2)**
   * **Action:** Remove the `tokens.ts` inline-styling anti-pattern. Fully migrate to Tailwind CSS classes for consistent, responsive, and hardware-accelerated styling.
   * **Impact:** Improves rendering performance and unlocks massive developer velocity.

---

## Tier 3: Developer Experience & Scale (Quarterly Goals)
These items improve velocity and lower long-term maintenance costs.

1. **Testcontainers Migration (Finding 1.1 & 8.2)**
   * **Action:** Replace the fragile local docker-compose workflow with isolated Testcontainers per worker.
   * **Impact:** Reliable, parallelized CI/CD pipelines.
2. **Next.js Image Optimization & Hydration (Finding 6.1 & 6.2)**
   * **Action:** Convert `<img src>` tags to `next/image`. The CSS migration (Tier 2) will naturally resolve the hydration bloat.
   * **Impact:** Improves Core Web Vitals (SEO) for merchant sites embedding the widget.
3. **Image Generation Caching (Finding 2.4)**
   * **Action:** Implement a content-hash check before enqueueing jobs to instantly return previous identical generations.
   * **Impact:** Lowers GPU cloud compute bills significantly.
4. **Monorepo Boundary Enforcement (Finding 8.1)**
   * **Action:** Configure `eslint-plugin-boundaries` to prevent spaghetti imports across apps and packages.
   * **Impact:** Maintains a healthy codebase as the engineering team scales.

---

### Conclusion
Ai Vastra's current implementation successfully proves the core technical concept (S3 -> Redis -> GPU -> SSE). However, it relies heavily on "happy path" assumptions, inline React styles, and manual dev-ops. 

By executing **Tier 1**, we secure the platform. By executing **Tier 2**, we make it a premium product. By executing **Tier 3**, we make it scalable. 

I am ready to begin implementing this roadmap. Please indicate which Tier or specific finding we should tackle first.
