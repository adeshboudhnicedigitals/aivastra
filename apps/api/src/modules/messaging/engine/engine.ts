import { AppError } from '../../../lib/errors.js';
import { COPY } from './copy.js';
import { decodeReplyId, encodeReplyId } from './reply-id.js';
import {
  buildPool,
  buildTryonBody,
  drawLooks,
  firstMissingSlot,
  groupByTemplate,
  POSE_COUNTS,
  poseCountOptions,
  requiredPhotoSlots,
  retryLookIds,
} from './rules.js';
import type {
  EngineContext,
  EngineDeps,
  EngineResult,
  GarmentTypeOption,
  Gender,
  InboundEvent,
  OutboundMessage,
  PickCard,
  RunRef,
  Session,
  State,
} from './types.js';

// 9 rows + a "More" row keeps a list inside WhatsApp's 10-row limit.
const ROWS_PER_PAGE = 9;
// The order management gave: "Create catalogue for (Women, Men, Boys, Girls)".
const GENDERS: Gender[] = ['women', 'men', 'boys', 'girls'];

type Out = OutboundMessage[];
type Row = { action: string; value: string; title: string };

export async function freshSession(userId: string, deps: EngineDeps): Promise<Session> {
  const defaults = await deps.getUserDefaults(userId);
  return {
    v: 1,
    state: 'MAIN_MENU',
    nonce: deps.newNonce(),
    page: 0,
    aspectRatio: defaults.aspectRatio,
    resolution: defaults.resolution,
    photos: {},
    picked: [],
  };
}

/** Everything chosen for a catalog, cleared; image shape and resolution kept. */
function cleared(s: Session): Session {
  return {
    v: 1,
    state: s.state,
    nonce: s.nonce,
    page: 0,
    aspectRatio: s.aspectRatio,
    resolution: s.resolution,
    photos: {},
    picked: [],
  };
}

/** Back to choosing the garment type; the photo and gender are kept. */
function garmentCleared(s: Session): Session {
  return { ...cleared(s), garmentKey: s.garmentKey, gender: s.gender };
}

/** Back to choosing poses; garment, type, extra photos, face and templates kept. */
function picksCleared(s: Session): Session {
  return { ...s, picked: [], count: undefined, runs: undefined, unstarted: undefined };
}

const text = (t: string): OutboundMessage => ({ kind: 'text', text: t });

function buttons(
  s: Session,
  body: string,
  items: [action: string, value: string, title: string][],
): OutboundMessage {
  return {
    kind: 'buttons',
    text: body,
    buttons: items
      .slice(0, 3)
      .map(([a, v, title]) => ({ id: encodeReplyId(s.nonce, a, v), title })),
  };
}

/** A list page; rows beyond one page get a "More" row. */
function listMsg(s: Session, body: string, rows: Row[]): OutboundMessage {
  const start = s.page * ROWS_PER_PAGE;
  const page = rows.slice(start, start + ROWS_PER_PAGE).map((r) => ({
    id: encodeReplyId(s.nonce, r.action, r.value),
    title: r.title.slice(0, 24),
  }));
  if (start + ROWS_PER_PAGE < rows.length) {
    page.push({ id: encodeReplyId(s.nonce, 'more', ''), title: COPY.btnMore });
  }
  return { kind: 'list', text: body, buttonLabel: COPY.listChoose, rows: page };
}

interface Loaded {
  session: Session;
  cards: PickCard[];
}

/**
 * Re-reads every template of the type and keeps only the looks the bot can
 * generate (D49), as one de-duplicated pool. Re-read on every pick prompt and
 * on Generate, so a look an admin removed, or a presigned image URL that
 * expired, never reaches the seller; picks no longer in the pool are dropped.
 * Null when nothing is left — the type is then not available in the chat (D47).
 */
async function loadPool(s: Session, deps: EngineDeps): Promise<Loaded | null> {
  if (!s.gender || !s.garmentType) return null;
  const at = { gender: s.gender as Gender, garmentTypeId: s.garmentType.id };
  const options = await deps.getTemplates(at.gender, at.garmentTypeId);
  if (options.length === 0) {
    deps.reportUnavailable({ ...at, reason: 'no_template' });
    return null;
  }
  const { templates, cards } = buildPool(s.garmentType, options);
  if (templates.length === 0) {
    deps.reportUnavailable({
      ...at,
      reason: 'no_eligible_looks',
      templateId: options[0].id,
      templateLooks: options.reduce((n, t) => n + t.looks.length, 0),
    });
    return null;
  }
  const ids = new Set(cards.map((c) => c.id));
  return {
    session: { ...s, templates, picked: s.picked.filter((id) => ids.has(id)) },
    cards,
  };
}

/** Moves to `state` with a fresh nonce and renders its prompt. */
async function enter(
  s: Session,
  state: State,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  return render({ ...s, state, nonce: deps.newNonce(), page: 0 }, out, ctx, deps);
}

/**
 * The type cannot be made in the chat. Instead of clearing the session (and the
 * seller's photo), send a studio draft link and show the type list again, so
 * they can continue on the web or pick another type here.
 */
async function handoff(
  s: Session,
  gt: { id: string; label: string },
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
) {
  const url =
    s.gender && s.garmentKey
      ? await deps.createStudioDraft({
          userId: ctx.userId,
          gender: s.gender as Gender,
          garmentTypeId: gt.id,
          garmentKey: s.garmentKey,
        })
      : deps.links.studio;
  // An empty list would make ASK_GARMENT_TYPE say "nothing available" right
  // after "choose another type", so end at the menu with no list offer.
  if (s.gender && (await deps.listGarmentTypes(s.gender as Gender)).length === 0) {
    out.push(text(COPY.handoff(gt.label, url, false)));
    return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  }
  out.push(text(COPY.handoff(gt.label, url)));
  return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
}

/**
 * The garment type is known, from recognition or the list. Fills the defaults
 * the chat no longer asks for (D43): face and templates. Then the required
 * extra photos, then the pose picks.
 */
async function chooseGarmentType(
  s: Session,
  gt: GarmentTypeOption,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const faceId = await deps.getDefaultFaceId(s.gender as Gender, gt.id);
  const withType: Session = {
    ...garmentCleared(s),
    garmentType: gt,
    faceId: faceId ?? undefined,
  };
  if (!faceId) {
    deps.reportUnavailable({ gender: s.gender as Gender, garmentTypeId: gt.id, reason: 'no_face' });
  }
  const loaded = faceId ? await loadPool(withType, deps) : null;
  if (!loaded) return handoff(s, gt, out, ctx, deps);
  return enter(
    loaded.session,
    firstMissingSlot(loaded.session) ? 'ASK_EXTRA_PHOTO' : 'ASK_POSE_COUNT',
    out,
    ctx,
    deps,
  );
}

/** What a rejected quote or create means for the seller (spec section 13). */
async function createRejected(
  err: unknown,
  s: Session,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  if (!(err instanceof AppError)) throw err;
  if (err.code === 'INSUFFICIENT_CREDITS') return enter(s, 'NO_CREDITS', out, ctx, deps);
  // A look deactivated or a mapping changed after the cards were shown.
  if (err.code === 'BAD_CATALOG') {
    out.push(text(COPY.posesChanged));
    return enter({ ...s, picked: [], count: undefined }, 'ASK_POSE_COUNT', out, ctx, deps);
  }
  out.push(text(err.message));
  return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
}

/**
 * Starts the runs for `lookIds` (all picks, or the failed and unstarted ones on
 * retry): one create call per template, because a catalogue belongs to one
 * template mapping (P6). Every group is quoted first (read-only, raises what
 * createJob would), so a look that is no longer valid is found before the first
 * charge. A group that fails after an earlier one was charged leaves its looks
 * in `unstarted`, for [Retry].
 */
async function generate(
  s: Session,
  lookIds: string[],
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const loaded = await loadPool(s, deps);
  if (!loaded) return handoff(s, s.garmentType ?? { id: '', label: 'These' }, out, ctx, deps);
  const ls = loaded.session;
  const inPool = new Set(loaded.cards.map((c) => c.id));
  if (lookIds.some((id) => !inPool.has(id))) {
    // An admin removed a look since the cards were shown: nothing is charged and
    // the seller reviews what is left (ls.picked is already pruned).
    out.push(text(COPY.posesChanged));
    return enter(ls, 'ASK_POSE_COUNT', out, ctx, deps);
  }

  const groups = groupByTemplate(ls.templates ?? [], lookIds);
  const bodyOf = (g: (typeof groups)[number]) => buildTryonBody(ls, g.template, g.lookIds);
  try {
    for (const g of groups) await deps.quote(ctx.userId, bodyOf(g));
  } catch (err) {
    return createRejected(err, ls, out, ctx, deps);
  }

  const runs: RunRef[] = [];
  let unstarted: string[] = [];
  let reason = '';
  for (const [i, g] of groups.entries()) {
    try {
      // One key per group: a redelivered tap returns the same catalogues.
      const { runId, images } = await deps.createRun(
        { ...ctx, messageId: `${ctx.messageId}:${i}` },
        bodyOf(g),
      );
      runs.push({ runId, images });
    } catch (err) {
      if (runs.length === 0) return createRejected(err, ls, out, ctx, deps);
      if (!(err instanceof AppError)) throw err;
      unstarted = groups.slice(i).flatMap((rest) => rest.lookIds);
      reason = err.message;
      break;
    }
  }

  const started = runs.reduce((n, r) => n + r.images, 0);
  out.push(text(COPY.generating(started)));
  if (unstarted.length > 0) {
    out.push(text(COPY.partlyStarted(started, lookIds.length, reason)));
  }
  return {
    session: {
      ...ls,
      picked: lookIds,
      state: 'GENERATING',
      nonce: deps.newNonce(),
      page: 0,
      runs,
      unstarted: unstarted.length > 0 ? unstarted : undefined,
    },
    messages: out,
  };
}

/** Appends the current step's prompt. May redirect when a step has nothing to ask. */
async function render(
  s: Session,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const done = (session: Session = s): EngineResult => ({ session, messages: out });

  switch (s.state) {
    case 'MAIN_MENU':
      out.push(
        buttons(s, COPY.menu, [
          ['menu', 'new', COPY.btnMenuNew],
          ['menu', 'credits', COPY.btnCredits],
          ['menu', 'help', COPY.btnHelp],
        ]),
      );
      return done();

    case 'ASK_GARMENT_PHOTO':
      out.push(buttons(s, COPY.askGarmentPhoto, [['menu', 'menu', COPY.btnMenu]]));
      return done();

    case 'ASK_GENDER':
      // Four options: one more than reply buttons allow, so a list.
      out.push(
        listMsg(
          s,
          s.kind ? COPY.askGenderConfirmed : COPY.askGender,
          GENDERS.map((g) => ({ action: 'gender', value: g, title: COPY.genders[g] })),
        ),
      );
      return done();

    case 'CONFIRM_KIND':
      if (!s.kind) return enter(s, 'ASK_GENDER', out, ctx, deps);
      out.push(
        buttons(s, COPY.kindGuess(s.kind), [
          ['confirm', '', COPY.btnYesContinue],
          ['change', '', COPY.btnNoDifferent],
        ]),
      );
      return done();

    case 'ASK_GARMENT_TYPE': {
      const types = await deps.listGarmentTypes(s.gender as Gender);
      if (types.length === 0) {
        out.push(text(COPY.nothingAvailable));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
      out.push(
        listMsg(
          s,
          COPY.askGarmentType,
          types.map((t) => ({ action: 'gt', value: t.id, title: t.label })),
        ),
      );
      return done();
    }

    case 'ASK_EXTRA_PHOTO': {
      const slot = firstMissingSlot(s);
      if (!slot) return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
      const gt = s.garmentType;
      const label =
        slot === 'lowerFront' ? (gt?.lowerUploadLabel ?? null) : (gt?.thirdUploadLabel ?? null);
      // Said once, with the first extra photo, while the seller can still fix the order.
      const main = gt && slot === requiredPhotoSlots(gt)[0] ? gt.upperUploadLabel : null;
      out.push(buttons(s, COPY.askPhoto[slot](label, main), [['menu', 'menu', COPY.btnMenu]]));
      return done();
    }

    case 'ASK_POSE_COUNT': {
      const loaded = await loadPool(s, deps);
      const first = loaded?.session.templates?.[0];
      if (!loaded || !first || !s.gender || !s.garmentType) {
        return handoff(s, s.garmentType ?? { id: '', label: 'These' }, out, ctx, deps);
      }
      const ls = loaded.session;
      let q: { perImage: number; balance: number };
      try {
        // One look prices one image: the cost per image comes from the same plan
        // resolution the web uses (D17); the count multiplies it.
        q = await deps.quote(ctx.userId, buildTryonBody(ls, first, [first.looks[0].id]));
      } catch (err) {
        // Anything createJob would reject surfaces here, before any credits are taken.
        if (!(err instanceof AppError)) throw err;
        out.push(text(err.message));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
      const next: Session = { ...ls, perImage: q.perImage, balance: q.balance, count: undefined };
      const options = poseCountOptions(loaded.cards.length, q.perImage, q.balance);
      if (options.length === 0) return enter(next, 'NO_CREDITS', out, ctx, deps);
      out.push(
        listMsg(
          next,
          COPY.countPrompt(COPY.genders[s.gender], s.garmentType.label, q.perImage, q.balance),
          options.map((n) => ({
            action: 'count',
            value: String(n),
            title: COPY.countOption(n, n * q.perImage),
          })),
        ),
      );
      return done(next);
    }

    case 'CONFIRM_GENERATE': {
      const { count: n, perImage, gender, garmentType } = s;
      if (!n || perImage === undefined || !gender || !garmentType) {
        return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
      }
      const remaining = (await deps.getBalance(ctx.userId)) - n * perImage;
      // Balance fell since the count was chosen: don't show a negative remainder.
      if (remaining < 0) return enter(s, 'NO_CREDITS', out, ctx, deps);
      out.push(
        buttons(
          s,
          COPY.confirmGenerate(n, COPY.genders[gender], garmentType.label, n * perImage, remaining),
          [
            ['generate', '', COPY.btnGenerate],
            ['recount', '', COPY.btnDifferentNumber],
          ],
        ),
      );
      return done();
    }

    case 'NO_CREDITS':
      out.push(buttons(s, COPY.noCredits(deps.links.pricing), [['menu', 'menu', COPY.btnMenu]]));
      return done();

    case 'GENERATING': {
      const progress = await Promise.all((s.runs ?? []).map((r) => deps.runProgress(r.runId)));
      const finished = progress.reduce((n, p) => n + p.finished, 0);
      const total = progress.reduce((n, p) => n + p.total, 0);
      out.push(text(COPY.stillGenerating(finished, total)));
      return done();
    }

    case 'DELIVERED': {
      const runs = s.runs ?? [];
      const failed = runs.reduce((n, r) => n + (r.failedPoseIds?.length ?? 0), 0);
      const delivered = runs.reduce((n, r) => n + r.images, 0) - failed;
      // Failed images were refunded, so only the delivered ones were spent.
      if (delivered > 0 && s.gender && s.garmentType) {
        out.push(
          text(
            COPY.deliveredSummary(
              delivered,
              COPY.genders[s.gender],
              s.garmentType.label,
              delivered * (s.perImage ?? 0),
              await deps.getBalance(ctx.userId),
            ),
          ),
        );
      }
      const retryable = retryLookIds(s).length > 0;
      const items: [string, string, string][] = retryable
        ? [
            ['retry', '', COPY.btnRetryFailed],
            ['more_poses', '', COPY.btnMorePoses],
            ['menu', 'menu', COPY.btnMenu],
          ]
        : [
            ['more_poses', '', COPY.btnMorePoses],
            ['change', '', COPY.btnChangeGarment],
            ['menu', 'new', COPY.btnNewCatalog],
          ];
      out.push(buttons(s, COPY.deliveredNext, items));
      return done();
    }
  }
}

async function onReply(
  s: Session,
  action: string,
  value: string,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const reprompt = () => {
    out.push(text(COPY.reprompt));
    return { session: s, messages: out };
  };
  // Paging keeps the nonce so cards on earlier pages stay tappable.
  if (action === 'more') return render({ ...s, page: s.page + 1 }, out, ctx, deps);
  if (action === 'restart') return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  if (action === 'menu') {
    if (value === 'new') return enter(cleared(s), 'ASK_GARMENT_PHOTO', out, ctx, deps);
    if (value === 'credits') {
      out.push(text(COPY.credits(await deps.getBalance(ctx.userId), deps.links.pricing)));
      return enter(s, 'MAIN_MENU', out, ctx, deps);
    }
    if (value === 'help') {
      out.push(text(COPY.help(deps.links.help)));
      return enter(s, 'MAIN_MENU', out, ctx, deps);
    }
    return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  }

  switch (s.state) {
    case 'CONFIRM_KIND': {
      if (action === 'confirm') return enter(s, 'ASK_GENDER', out, ctx, deps);
      if (action !== 'change') return reprompt();
      deps.recordRecognitionCorrected();
      return enter({ ...s, kind: undefined }, 'ASK_GENDER', out, ctx, deps);
    }

    case 'ASK_GENDER': {
      if (action !== 'gender' || !GENDERS.includes(value as Gender)) return reprompt();
      const gender = value as Gender;
      const withGender: Session = { ...s, gender };
      // No kind, or a kind this gender does not have: the list is the way out.
      const hit = s.kind ? await deps.typeForKind(s.kind, gender) : null;
      if (!hit)
        return enter({ ...withGender, kind: undefined }, 'ASK_GARMENT_TYPE', out, ctx, deps);
      const gt = (await deps.listGarmentTypes(gender)).find((t) => t.id === hit.garmentTypeId);
      // A correct answer for a type the bot cannot offer (a saree two-step
      // type, no template): hand the seller to the studio rather than pretend we didn't know.
      if (!gt) {
        // Report why, from the same facts the studio reads, so an admin sees
        // "template_inactive" rather than a bare "not offered".
        const { reasons } = await deps.getReadiness(gender, hit.garmentTypeId);
        for (const reason of reasons) {
          deps.reportUnavailable({ gender, garmentTypeId: hit.garmentTypeId, reason });
        }
        return handoff(withGender, { id: hit.garmentTypeId, label: hit.label }, out, ctx, deps);
      }
      // The kind was confirmed before the gender, so no second "Looks like".
      return chooseGarmentType({ ...withGender, kind: undefined }, gt, out, ctx, deps);
    }

    case 'ASK_GARMENT_TYPE': {
      const gt = (await deps.listGarmentTypes(s.gender as Gender)).find((t) => t.id === value);
      if (action !== 'gt' || !gt) return reprompt();
      return chooseGarmentType(s, gt, out, ctx, deps);
    }

    case 'ASK_POSE_COUNT': {
      const n = Number(value);
      if (action !== 'count' || !(POSE_COUNTS as readonly number[]).includes(n)) return reprompt();
      return enter({ ...s, count: n }, 'CONFIRM_GENERATE', out, ctx, deps);
    }

    case 'CONFIRM_GENERATE': {
      if (action === 'recount')
        return enter({ ...s, count: undefined }, 'ASK_POSE_COUNT', out, ctx, deps);
      const n = s.count;
      if (action !== 'generate' || !n) return reprompt();
      const loaded = await loadPool(s, deps);
      if (!loaded) return handoff(s, s.garmentType ?? { id: '', label: 'These' }, out, ctx, deps);
      const ls = loaded.session;
      // Tapping Generate is the agreement to spend (D45). Caught here, before
      // any run exists; createJob checks again.
      const perImage = s.perImage ?? 0;
      if (n * perImage > (await deps.getBalance(ctx.userId))) {
        return enter(ls, 'NO_CREDITS', out, ctx, deps);
      }
      const draw = drawLooks(
        loaded.cards.map((c) => c.id),
        ls.seenLooks ?? [],
        n,
        deps.shuffle,
      );
      return generate({ ...ls, picked: draw.ids, seenLooks: draw.seen }, draw.ids, out, ctx, deps);
    }

    case 'DELIVERED': {
      if (action === 'more_poses') return enter(picksCleared(s), 'ASK_POSE_COUNT', out, ctx, deps);
      if (action === 'retry') {
        const ids = retryLookIds(s);
        if (ids.length === 0) return reprompt();
        // The dispatcher already refunded the failed images; this is a fresh,
        // priced run of only those looks.
        return generate({ ...s, picked: ids }, ids, out, ctx, deps);
      }
      if (action === 'change') return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
      return reprompt();
    }

    default:
      return reprompt();
  }
}

// Typed words that mean "get me out". Never 'stop': that is the opt-out (inbound.ts).
const EXIT_WORDS = new Set(['cancel', 'exit', 'quit', 'back', 'hi', 'hello']);

// Steps with no question pending: stray text shows the step again, not a reprompt.
const IDLE_STATES: State[] = ['MAIN_MENU', 'GENERATING', 'DELIVERED', 'NO_CREDITS'];

// States where a new photo starts a new catalog (spec section 8): outside the
// question steps, a photo can only mean "do this one".
const NEW_PHOTO_STATES: State[] = [
  'MAIN_MENU',
  'ASK_GARMENT_PHOTO',
  'NO_CREDITS',
  'GENERATING',
  'DELIVERED',
];

// What a session saved before 2026-10-14 may still carry.
type LegacySession = Session & {
  template?: unknown;
  count?: number;
  runId?: string;
  runImages?: number;
  failedPoseIds?: string[];
};

/**
 * A session saved by the single-template engine. One that was generating or
 * delivered becomes a one-run list, so a seller mid-run at deploy still gets
 * their closing message. One that was still picking has no pool to tap against;
 * null starts it over like an expired session.
 */
function upgradeSession(prev: Session): Session | null {
  const old = prev as LegacySession;
  if (old.runId === undefined) {
    // `count` is a current field again (pose count), so only `template` marks the old shape.
    return old.template === undefined ? prev : null;
  }
  const { template: _t, count: _c, runId, runImages, failedPoseIds, ...rest } = old;
  return {
    ...rest,
    runs: [
      {
        runId,
        images: runImages ?? 0,
        ...(failedPoseIds ? { finished: true, failedPoseIds } : {}),
      },
    ],
  };
}

/** A new garment photo: recognise the kind first, else go straight to the gender. */
async function startFromPhoto(
  fresh: Session,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const hit = await deps.recognizeKind(fresh.garmentKey as string);
  return hit
    ? enter({ ...fresh, kind: hit.label }, 'CONFIRM_KIND', out, ctx, deps)
    : enter(fresh, 'ASK_GENDER', out, ctx, deps);
}

/**
 * The whole conversation as one deterministic step: (session, event) → (session,
 * messages). No I/O of its own — everything goes through `deps` (D33), so it is
 * tested with in-memory fakes and knows nothing about WhatsApp (spec section 6).
 */
export async function handle(
  prev: Session | null,
  event: InboundEvent,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const out: Out = [];
  const upgraded = prev ? upgradeSession(prev) : null;
  if (!upgraded) {
    const fresh = await freshSession(ctx.userId, deps);
    if (event.type === 'reply') out.push(text(COPY.sessionExpired));
    // A first photo starts a catalog straight away (spec section 8).
    if (event.type === 'image')
      return startFromPhoto({ ...fresh, garmentKey: event.garmentKey }, out, ctx, deps);
    return render(fresh, out, ctx, deps);
  }
  // The shape is the bot's own fixed setting (D43), not a per-chat choice, so it is
  // re-read on every event. A session lives 24 h and every message extends it, so
  // one saved before the setting changed would otherwise keep generating at the old
  // shape (seen 2026-10-14: a chat still on 1:1 after the switch to 3:4).
  const defaults = await deps.getUserDefaults(ctx.userId);
  const s: Session = {
    ...upgraded,
    aspectRatio: defaults.aspectRatio,
    resolution: defaults.resolution,
  };

  switch (event.type) {
    case 'text': {
      const cmd = event.text.trim().toLowerCase();
      if (cmd === 'menu' || cmd === 'restart' || EXIT_WORDS.has(cmd))
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      if (cmd === 'help') {
        out.push(text(COPY.help(deps.links.help)));
        return render(s, out, ctx, deps);
      }
      if (IDLE_STATES.includes(s.state)) return render(s, out, ctx, deps);
      out.push(text(COPY.reprompt));
      return { session: s, messages: out };
    }

    case 'reply': {
      const d = decodeReplyId(event.id);
      if (!d || d.nonce !== s.nonce) {
        out.push(text(COPY.stale));
        return render(s, out, ctx, deps);
      }
      return onReply(s, d.action, d.value, out, ctx, deps);
    }

    case 'image': {
      if (NEW_PHOTO_STATES.includes(s.state)) {
        // Spec 8a: recognised right after the upload and before any question,
        // so the seller confirms the kind while the photo is fresh. Awaited:
        // the seller waits once, up to the budget (spec 2026-10-22, risks).
        return startFromPhoto({ ...cleared(s), garmentKey: event.garmentKey }, out, ctx, deps);
      }
      if (s.state === 'ASK_EXTRA_PHOTO') {
        const slot = firstMissingSlot(s);
        if (slot) {
          const next = { ...s, photos: { ...s.photos, [slot]: event.garmentKey } };
          return enter(
            next,
            firstMissingSlot(next) ? 'ASK_EXTRA_PHOTO' : 'ASK_POSE_COUNT',
            out,
            ctx,
            deps,
          );
        }
      }
      out.push(text(COPY.notNow));
      return render(s, out, ctx, deps);
    }

    case 'unsupportedMedia':
      out.push(text(COPY.unsupported));
      return s.state === 'ASK_GARMENT_PHOTO' || s.state === 'ASK_EXTRA_PHOTO'
        ? { session: s, messages: out }
        : render(s, out, ctx, deps);

    case 'runFinished': {
      // A run from an older session (the seller started another catalog
      // meanwhile) still gets its images (plan 3 sends them by run, not by
      // session), but no buttons here.
      const runs = s.runs ?? [];
      const mine = runs.find((r) => r.runId === event.runId);
      if (!mine || mine.finished) return { session: s, messages: out };
      const updated = runs.map((r) =>
        r.runId === event.runId ? { ...r, finished: true, failedPoseIds: event.failedPoseIds } : r,
      );
      const next: Session = { ...s, runs: updated };
      // The closing message waits for the last run of the Generate (spec section 4).
      if (!updated.every((r) => r.finished)) return { session: next, messages: out };
      const failed = updated.reduce((n, r) => n + (r.failedPoseIds?.length ?? 0), 0);
      const images = updated.reduce((n, r) => n + r.images, 0);
      if (failed > 0) out.push(text(COPY.partlyFailed(failed, images)));
      return enter(next, 'DELIVERED', out, ctx, deps);
    }

    case 'creditsAdded':
      out.push(text(COPY.creditsAdded(event.credits)));
      // Back to the count question (spec section 6).
      if (s.state === 'NO_CREDITS') return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
      return { session: s, messages: out };
  }
}
