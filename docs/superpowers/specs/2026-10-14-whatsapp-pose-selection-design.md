# WhatsApp bot — free pose selection across templates

**Status:** design approved in conversation 2026-10-14; written for review. No code written.
**Amends:** `2026-10-12-whatsapp-catalog-bot-design.md` — D44 (choosing poses) and D45
(confirmation) are replaced; D43's "template: the top-sorted active template" and the
single-template part of D24/D44 no longer hold. Everything else in that spec stands.

## 1. Summary

Today the seller answers "How many poses do you want?" and then taps exactly that many poses from
**one** template (the top-sorted active template for the garment type). This change removes the
count question. The bot shows the poses of **every** active template for the garment type, the
seller taps as many as they want (fewer than the total), and a running **Generate** button starts
the run.

Because a catalogue (one run) belongs to exactly one template mapping, a pick that spans templates
becomes **one run per template**, created one after another through the existing create path. No
api or `createJob` change.

## 2. Decisions

| # | Decision | Detail |
|---|---|---|
| P1 | No count step | `ASK_POSE_COUNT` is removed. After the garment type is known and any required extra photos are in, the bot goes straight to picking (`PICK_LOOKS`). |
| P2 | Pool = every active template | All templates `listCatalogueTemplates` returns for the gender and garment type, in template admin order then look order, after the existing eligibility filter (D49, `rules.ts`). A pose + background pair that appears in more than one template is shown once, under the first template. |
| P3 | Finish with a running Generate button | Each tap on a pose replies "N selected · X credits" with **[Generate]** and **[Clear]**. Tapping a selected pose again removes it. Each carousel page ends with the same buttons plus **[More]**. The nonce does not change while picking, so an older Generate button still acts on the current selection. |
| P4 | Cap of 20 poses per Generate | A 21st tap is declined with a message and the selection is unchanged. Keeps one request inside the queue-capacity check (`assertQueueCapacity`). Replaces `MAX_POSES = 9`. The retry of a failed image is matched by pose id (all delivery reports), so a pose that appears in two templates with different backgrounds is retried in both. |
| P5 | Generate is the agreement to spend | As the last pick was (D45). The cost per pose and the balance are shown in the picking prompt, and the total on every "N selected" reply. |
| P6 | One run per template | Option A of the review. Option B (a catalogue spanning several mappings) was rejected: it changes `createJob` and the plan resolver, which web, Shopify and the widget share, and each mapping carries its own pose workflows. |
| P7 | Free-text agent mode is out of scope | Recorded as a possible later option, section 9. |

## 3. Flow

```
 garment known (+ extra photos)
        │
        ▼
 PICK_LOOKS   "Tap the poses you want. Each is X credits. Your balance: N."
        │      carousel pages of 10 · [More] · tap = select / unselect
        │      each tap → "N selected · X credits"  [Generate] [Clear]
        ▼
 [Generate]   re-read pool → drop removed picks (if any: "Those poses changed…", no charge)
        │     balance check → NO_CREDITS (selection kept) if short
        │     group picks by template → quote every group (read-only)
        │     createRun per group, in order
        ▼
 GENERATING → DELIVERED  [Retry failed] [More poses, same garment] [Menu]
```

"More poses, same garment" returns to `PICK_LOOKS` with the photo, gender and type kept.
`NO_CREDITS` returns to `PICK_LOOKS` instead of the count step.

## 4. Running several templates as one request

All of this is in the bot; `createJob` is untouched.

1. **Group.** On [Generate] the picks are grouped by template. One group is one `createRun` call,
   one catalogue, one `messaging_runs` row. A seller who picks from one template gets exactly
   today's behaviour.
2. **Check before charging.** Every group is quoted with `quoteRun` (read-only, raises the same
   `AppError`s `createJob` would) and the total is compared with the balance, all before the first
   run is created. A deactivated look or a missing default shoe is caught while nothing has been
   charged.
3. **Create in order.** Each call's idempotency key is the Generate tap's Meta message id plus the
   group's position (`<messageId>:<n>`), so a redelivered webhook returns the same catalogues and
   cannot charge twice.
4. **Partial start.** If a later group still fails (balance changed concurrently, queue capacity),
   earlier groups are already charged and running. The seller is told "Started X of Y images. The
   rest couldn't start: <reason>". The unstarted poses stay selected and are included in
   **[Retry]** once the started runs finish.
5. **Progress.** "Still generating" sums `runProgress` over all runs.
6. **Finish.** Delivery still sends each run's images as that run finishes, so images arrive in
   bursts. The engine collects each run's `runFinished` event and shows the partly-failed note and
   the DELIVERED buttons once, when the last run has finished.
7. **Retry.** [Retry failed] covers failed jobs and unstarted poses together and goes through
   steps 1–3 again. The dispatcher has already refunded failed images.

**Known limitation.** The paid "images are ready" template (D26) is sent per run, and only when the
24-hour window is closed. The seller has just tapped Generate, so this needs a run to take more than
24 hours; the worst case is one extra template per run. Fixing it needs a `batch_id` column on
`messaging_runs`, which this change leaves out.

## 5. Session shape and size

`Session` (`engine/types.ts`):

| Field | Change |
|---|---|
| `template` | Becomes `templates: { id, mappingId, lowerOnly, looks }[]`. `lowerOnly` is decided per template (`eligibleLooks`), so a mixed type can have a lower-only and a full-body template. `buildTryonBody` is called once per group with that group's template. |
| `count` | Removed. |
| `picked` | Unchanged: look ids in tap order. Look ids are UUIDs, so a look maps to its template through the session pool; the reply id carries only `<nonce>\|look\|<lookId>`. |
| `runId`, `runImages`, `failedPoseIds` | Become `runs: { runId, images, finished?, failedPoseIds? }[]` and `unstarted: string[]` (look ids). A stored session with a single `runId` is read as a list of one, so a seller mid-run at deploy is not broken. |
| `perImage`, `balance` | Kept; set when `PICK_LOOKS` is entered instead of at the count step. |

**Size.** About 150 looks at roughly 400 bytes each (with presigned image URLs) is ~60 KB,
rewritten on every tap. The stored pool therefore keeps only ids and flags (look id, pose id,
background id, eligibility). Labels and image URLs are re-read on every render, as `loadTemplate`
already does so presigned URLs stay fresh.

## 6. Edge cases

| Case | Behaviour |
|---|---|
| [Generate] with nothing picked | "Tap at least one pose". |
| 21st pose | Declined with the cap message; selection unchanged. |
| Picked look removed by an admin since | Dropped at [Generate]; "Those poses changed, please check your selection" with the updated count; nothing charged. |
| Not enough credits | `NO_CREDITS`, selection kept, so topping up and returning loses nothing. |
| Old [Generate] button tapped | Acts on the current selection (the nonce does not change while picking). |
| One template, one look | A one-card list, works as today. |
| Type with no eligible look in any template | "Not available on WhatsApp yet" (D47, D49), unchanged. |
| Redelivered Generate webhook | Same catalogues returned from the idempotency cache (section 4, step 3). |

## 7. Copy (`engine/copy.ts`)

Removed: `askCount`, `countRow`, `pickLooks`. Added: the picking prompt (cost per pose and balance),
"N selected · X credits", `btnGenerate`, `btnClear`, `btnChangeGarment`, the cap message, "Tap at least one pose",
"Started X of Y images. The rest couldn't start: …".

## 8. Tests and documentation

**Unit (`test/messaging-engine.test.ts`).** Remove the count-step tests. Add: pool across two
templates with a duplicate shown once; tap, untap and the cap; [Generate] making one `createRun`
call per template with the key suffix; a failing pre-quote creating no run; the partial-start
message; progress summed over runs; the finish event acting only on the last run; an old
single-`runId` session read as one run; retry covering failed and unstarted poses.

**Integration (`test/integration/messaging-conversation.test.ts`).** A garment type with two
templates, run end to end: both catalogues created and charged once each. `test/helpers/engine-fakes.ts`
gains multi-template support.

**Docs.** Revise D44/D45 and the D24 history note in the main spec, and its sections 8, 9, 12, 13;
add a `docs/progress.md` entry; update the handoff file.

## 9. Not in this change

- **Free-text agent mode.** A later, separate mode where an LLM agent uses tools (`recognizeGarment`,
  `getTemplate`, `quote`, `createRun`, `runProgress` — the `EngineDeps` boundary) with the session as
  memory. Nothing here blocks it. The spend step should stay a button even then, so a model, and any
  prompt injection in the seller's text, stays out of the credit-spending path. It adds a model call
  per message, latency and a new failure class (misread requests), which is why it is not part of
  this change.
- A `batch_id` on `messaging_runs`; any change to `createJob`; a "select all" button; custom
  backgrounds or poses (D42).

## 10. Production data note (read 2026-10-14)

A garment type is mapped to 29–40 non-deleted templates in production (one pair to 8), each with
2–7 looks (average 4.6): roughly 130–180 poses per type if all were active. None is active in
production yet, so this is the upper bound; admin controls the real size by activating fewer
templates. The design therefore pages (10 per carousel) and caps selection rather than assuming a
small pool.
