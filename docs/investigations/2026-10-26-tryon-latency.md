# Try-on latency investigation — 2026-10-26

Read-only independent investigation of four merchant try-on jobs. No application changes, production mutations, commits, or pushes. The supplied earlier investigation was treated as hypotheses.

## Evidence and scope

Read production jobs, worker configuration, dispatcher logs, the running container's source and executed JavaScript, and retained ComfyUI histories. Ran a read-only local Redis blocking experiment and six read-only output downloads with in-memory WebP encoding inside the production dispatcher runtime. Credentials remained in memory and were not printed. No new GPU execution was requested.

Running dispatcher: `node apps/dispatcher/dist/index.js`; container started 2026-10-23T12:47:30Z. Its source hashes match local `lib/redis.ts`, `stream/consumer.ts`, `stream/webhooks.ts`, and `config/image-compression.ts`. Production index wiring and compiled polling/output code were inspected separately because local index differs. Repo HEAD alone was not treated as evidence of deployed behavior.

## Recorded durations

Seconds, rounded. Backend means `started_at` to `completed_at`; end-to-end here means database creation to completion, not browser display time.

| Job | ComfyUI execution | Backend | Difference | Created → started | Created → completed |
| --- | ---: | ---: | ---: | ---: | ---: |
| f45ba979-b7b3-4ce3-ab61-e27f55d1cc55 | 29.390 | 37.133 | 7.743 | 23.634 | 60.767 |
| eee620fd-9f51-421e-b976-ba9493df1879 | 26.813 | 44.090 | 17.277 | 17.089 | 61.179 |
| 07a13e98-ebd4-46dc-8a59-7adc5a9f37ad | 41.611 | 48.029 | 6.418 | 8.580 | 56.609 |
| eaf4d168-cbe6-448d-909b-d8e900f8d1d5 | 37.723 | 47.908 | 10.185 | 7.514 | 55.422 |

Execution durations come from the difference between ComfyUI's `execution_start` and `execution_success`, on the same worker clock. The database `comfy_duration_ms` values are instead 33672, 32357, 46017, and 42760 respectively: the processor measures from before POST /prompt through completion detection. That field includes transport and detection time, so it is not pure GPU execution time.

`started_at` is set on GENERATING, after worker selection and input uploads. Inputs are uploaded concurrently using Promise.all, not serially.

### Historical phases

| Job | Created → consumed | PREPROCESSING → claimed | Claimed → started | ComfyUI success → detected | Detected → DB complete |
| --- | ---: | ---: | ---: | ---: | ---: |
| f45ba979 | 7.508 | 13.118 | 2.991 | 3.308 | 3.454 |
| eee620fd | 10.001 | 4.336 | 2.734 | 4.392 | 11.726 |
| 07a13e98 | 3.478 | 4.279 | 0.810 | 3.441 | 2.005 |
| eaf4d168 | 2.105 | 4.286 | 1.106 | 4.062 | 5.141 |

Success-to-detection compares worker and dispatcher clocks; historical clock synchronization was not independently audited. These are observed timestamp differences, not a precise decomposition into sleep and network time. The same-clock execution durations and database durations do not have this qualification.

For f45ba979, the backend window consists of approximately 0.981s before ComfyUI execution starts, 29.390s executing, 3.308s until detection, and 3.454s afterward. There is a separate 23.634s before that window begins.

## Confirmed architectural defect: blocking Redis readers share the command connection

`index.ts` passes the same main Redis client to the GPU consumer, webhook consumer, and job processor. `stream/consumer.ts` blocks for 2000ms on jobs:low; `stream/webhooks.ts` blocks for 2000ms on webhooks:outbound. Commands on the same connection wait behind these blocking reads.

Affected operations include worker-claim Lua, per-worker queue-gate configuration GET, worker release, concurrency refresh, image-compression configuration GET, webhook enqueue, and stream acknowledgements. ComfyUI observation configuration already uses a separate `comfyRedis` connection; it is not the shared client discussed here. Video, in-house, and classification consumers already duplicate their blocking-reader connections.

Read-only reproduction against local Redis, using XREAD BLOCK on a unique absent stream and then PING:

| Blocking reads ahead of PING | Shared connection | Separate connection |
| --- | ---: | ---: |
| One, 2000ms | 1966ms | 1ms |
| Two, 2000ms each | 3982ms | 1ms |

The sandboxed first attempt could not connect; the permitted local-network rerun above succeeded. XREAD did not create streams or modify data.

Historical evidence is strongly consistent with this mechanism: three jobs each spend about 4.3s between PREPROCESSING and successful worker selection, with no failed probe logged. f45ba979 first rejects worker 6 because its ComfyUI queue contains two items; that HTTP probe takes only 224ms. The next successful worker claim arrives 8.877s later, across several shared-Redis operations. There are no per-command timers to allocate every historical millisecond, so these durations should not be labeled entirely GPU-capacity wait or entirely Redis wait.

This also invalidates attributing the entire final output phase to download/encode/storage: after download, `processWidgetJob` awaits `getImageCompressionConfig(redis, source)` on this shared connection.

## Confirmed completion overhead

`config/comfy-timeout.ts` sets POLL_INTERVAL_MS=3000. The loop sleeps before each history request. Once complete, the history response includes the full workflow (~123 KB in these four histories). Completion returns timing/status but discards that history. The processor immediately fetches it again before downloading the image.

Fresh history reads from the VPS took 1.04–1.73s including the full body. Historical second-history reads took approximately 0.27–1.09s. Avoiding the duplicate fetch removes a real request; reducing the interval removes avoidable sleep but does not eliminate network/body time.

A 500ms interval is not “trivial load” merely because unfinished response bodies are two bytes: request handling, TLS/tunnel overhead and worker capacity still matter. Start with a configurable 1s interval, prevent overlapping polls, preserve timeout/cancellation behavior, and measure request rate and latency.

## Scheduling and capacity: different from the supplied case study

Production worker configuration predates these jobs:

- worker-1, worker-3, worker-5: catalogue only.
- tryon-worker-6, woker-7: merchant, tryon, Shopify, saree.
- worker-2: in-house only.

Catalogue jobs do not directly consume these merchant GPUs under this configuration. However, catalogue and merchant jobs share the normal stream, admission loop, and Redis connection. Logs show catalogue jobs repeatedly re-enqueued because their own pool had no eligible worker. That creates dispatcher contention even when GPU pools differ. The exact contribution of admission saturation versus Redis blocking to each pickup delay is not measurable from existing logs.

The live registry additionally contains tryon-worker-4 in DRAINING with an empty allowed-type object. `getWorkers` normalizes this to an empty array; `servesSharedPools` then counts it in the shared cap despite its inability to accept claims. Historical concurrency logs show 5 → 6 at 06:16:02.286Z (and 6 → 5 earlier at 04:31:43.963Z). Therefore “six active shared workers” is not an accurate description. Capacity calculation must exclude draining/ineligible entries, while still counting BUSY usable workers toward total pool capacity.

The GPU reader blocks only on the low-priority stream after checking priority and normal. A new normal/priority arrival cannot wake that low-stream read, introducing up to the remaining two-second timeout independently of the shared-client issue.

Worker reservations are held through output download, compression-config read, encoding, storage, completion publication, webhook enqueue and acknowledgement. The GPU may have finished long before its reservation is released. Three sample job-success logs occur ~1.25s after DB completion; 07a13e98 is ~3.34s later, with release following that log. Faster finalization/Redis operations also improve worker availability for subsequent jobs.

## Fresh output measurements

Executed Node fetch and sharp q90 inside the running dispatcher container, matching its network/runtime. Three sequential reads of one existing result from each worker; no storage writes.

| Worker | Download total ms, samples 1–3 | Encode ms, samples 1–3 | PNG bytes | WebP bytes |
| --- | --- | --- | ---: | ---: |
| tryon-worker-6 | 912, 254, 265 | 174, 153, 173 | 1168497 | 79258 |
| woker-7 | 1283, 792, 773 | 159, 172, 173 | 1261298 | 102986 |

The production compression setting is unset, so merchant_tryon uses enabled q90 by default. A GET on a fresh independent Redis client took 0.38ms. These measurements do not include the old shared connection's queued work.

No nine-second download stall was reproduced. This small sample neither rules out intermittent network stalls nor proves that Cloudflare caused the historical 10.628s between history response and DB completion for eee620fd. There is no historical timer separating download, compression config, encode, object upload, and completion transaction. No fresh production object upload was benchmarked, because this investigation is read-only. The measured encoding cost does not justify removing WebP from the critical path first.

## Recommended mitigation order

| Change | Developer / operational tradeoff | User benefit |
| --- | --- | --- |
| Give GPU and webhook BLOCK readers dedicated connections; keep commands on a nonblocking client | Small bounded change; handle reader shutdown/reconnect and consumer-group semantics; regression test shared traffic | Removes proven cross-operation waits during selection, finalization and release without changing image quality |
| Reuse final history; configurable 1s completion polling | Preserve output-node filtering, withheld-output handling, cancellation and timeout tests; increased request rate | Faster completion detection and one fewer full-history transfer |
| Add monotonic stage timings alongside those fixes | Small observability cost; avoid prompts, image keys and credentials in logs | Measures actual savings and isolates the remaining long tail |
| Correct capacity accounting and then separate admission by eligible pool; make normal/priority arrivals wake reads | Moderate scheduler change; test fairness, retries and idempotency | Keeps catalogue backlog from delaying shopper jobs despite separate GPUs |
| Consider worker-side WebP or a bounded hedged download only if transfer tails persist | Workflow/output-contract changes or extra traffic; hedge must cancel the loser after a fully valid body and cap duplicate work | Potentially improves transfer tails; not yet justified as the first change |

Do not move worker release earlier casually: prove output files remain stable and cancellation/error ownership remains safe before allowing another execution on the GPU. Do not compress customer inputs more aggressively without checking try-on quality. Reserving additional merchant GPUs is a capacity/business choice, not the first fix for these confirmed software delays.

Instrumentation should separate enqueue→consume, selection→claim (including Redis and probe time), input read/upload, prompt submission, GPU execution, completion detection, history, output headers/body, compression-config GET, encode, storage PUT, DB completion, SSE, and worker release. Track end-to-end p50/p95/p99 and completion-detection lag by worker/source, not just started_at duration.

Staging validation should include a merchant job with an empty webhook stream, a mixed catalogue/merchant backlog, arrivals while the low queue is empty, cancellation/timeouts, and a slow output response. Compare before/after timings under the same workload before production deployment. No mitigation has been implemented or its latency savings proven yet.
