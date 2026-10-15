import { AppError } from '../../../lib/errors.js';
import { COPY } from './copy.js';
import { decodeReplyId, encodeReplyId } from './reply-id.js';
import {
  buildPool,
  buildTryonBody,
  firstMissingSlot,
  groupByTemplate,
  MAX_PICKS,
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

const CARDS_PER_PAGE = 10;
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
  return { ...s, picked: [], runs: undefined, unstarted: undefined };
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

/** A carousel page plus a buttons message for More / extra actions. */
function cardsMsgs(
  s: Session,
  body: string,
  action: string,
  items: { id: string; label: string; imageUrl: string }[],
  extra: [action: string, value: string, title: string][] = [],
  footer: string = COPY.moreOptions,
): Out {
  const start = s.page * CARDS_PER_PAGE;
  const page = items.slice(start, start + CARDS_PER_PAGE);
  const out: Out = [
    {
      kind: 'cards',
      text: body,
      cards: page.map((i) => ({
        id: encodeReplyId(s.nonce, action, i.id),
        imageUrl: i.imageUrl,
        title: i.label,
      })),
    },
  ];
  const more: [string, string, string][] =
    start + CARDS_PER_PAGE < items.length ? [['more', '', COPY.btnMore]] : [];
  const actions = [...more, ...extra];
  if (actions.length > 0) out.push(buttons(s, footer, actions));
  return out;
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

function notAvailable(s: Session, label: string, out: Out, ctx: EngineContext, deps: EngineDeps) {
  out.push(text(COPY.notAvailable(label, deps.links.studio)));
  return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
}

/**
 * The garment type is known, from recognition or the list. Fills the defaults
 * the chat no longer asks for (D43): face and templates. Then the required
 * extra photos, then the pose picks.
 */
async function chooseGarmentType(
  s: Session,
  gt: GarmentTypeOption,
  recognized: boolean,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const faceId = await deps.getDefaultFaceId(s.gender as Gender, gt.id);
  const withType: Session = {
    ...garmentCleared(s),
    garmentType: gt,
    recognized,
    faceId: faceId ?? undefined,
  };
  if (!faceId) {
    deps.reportUnavailable({ gender: s.gender as Gender, garmentTypeId: gt.id, reason: 'no_face' });
  }
  const loaded = faceId ? await loadPool(withType, deps) : null;
  if (!loaded) return notAvailable(s, gt.label, out, ctx, deps);
  return enter(
    loaded.session,
    firstMissingSlot(loaded.session) ? 'ASK_EXTRA_PHOTO' : 'PICK_LOOKS',
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
    return enter({ ...s, picked: [] }, 'PICK_LOOKS', out, ctx, deps);
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
  if (!loaded) return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
  const ls = loaded.session;
  const inPool = new Set(loaded.cards.map((c) => c.id));
  if (lookIds.some((id) => !inPool.has(id))) {
    // An admin removed a look since the cards were shown: nothing is charged and
    // the seller reviews what is left (ls.picked is already pruned).
    out.push(text(COPY.posesChanged));
    return enter(ls, 'PICK_LOOKS', out, ctx, deps);
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

  // Shown, not charged, from the pick prompt's quote: the charge itself is
  // createJob's own resolution of the same plan (D17).
  const started = runs.reduce((n, r) => n + r.images, 0);
  out.push(text(COPY.generating(started, started * (ls.perImage ?? 0))));
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
          ['menu', 'new', COPY.btnNewCatalog],
          ['menu', 'credits', COPY.btnCredits],
          ['menu', 'help', COPY.btnHelp],
        ]),
      );
      return done();

    case 'ASK_GARMENT_PHOTO':
      out.push(text(COPY.askGarmentPhoto));
      return done();

    case 'ASK_GENDER':
      // Four options: one more than reply buttons allow, so a list.
      out.push(
        listMsg(
          s,
          COPY.askGender,
          GENDERS.map((g) => ({ action: 'gender', value: g, title: COPY.genders[g] })),
        ),
      );
      return done();

    case 'CONFIRM_GARMENT_TYPE':
      if (!s.garmentType) return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
      out.push(
        buttons(s, COPY.confirmGarment(s.garmentType.label), [
          ['confirm', '', COPY.btnYes],
          ['change', '', COPY.btnNo],
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
      if (!slot) return enter(s, 'PICK_LOOKS', out, ctx, deps);
      const gt = s.garmentType;
      const label =
        slot === 'lowerFront' ? (gt?.lowerUploadLabel ?? null) : (gt?.thirdUploadLabel ?? null);
      out.push(text(COPY.askPhoto[slot](label)));
      return done();
    }

    case 'PICK_LOOKS': {
      const loaded = await loadPool(s, deps);
      if (!loaded?.session.templates)
        return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
      const ls = loaded.session;
      let perImage = ls.perImage;
      let balance = ls.balance;
      // Priced once per visit to the step (page 0), not on every "More" page.
      if (ls.page === 0 || perImage === undefined || balance === undefined) {
        const first = ls.templates?.[0];
        if (!first) return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
        try {
          // One look prices one image: the cost per image comes from the same plan
          // resolution the web uses (D17); the selection multiplies it.
          const q = await deps.quote(ctx.userId, buildTryonBody(ls, first, [first.looks[0].id]));
          perImage = q.perImage;
          balance = q.balance;
        } catch (err) {
          // Anything createJob would reject surfaces here, before any credits are taken.
          if (!(err instanceof AppError)) throw err;
          out.push(text(err.message));
          return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
        }
      }
      const next: Session = { ...ls, perImage, balance };
      if (next.page === 0) {
        out.push(
          buttons(next, COPY.pickPrompt(perImage, balance), [
            ['change', '', COPY.btnChangeGarment],
          ]),
        );
      }
      const n = next.picked.length;
      out.push(
        ...cardsMsgs(
          next,
          COPY.pickCards,
          'look',
          loaded.cards,
          [
            ['generate', '', COPY.btnGenerate],
            ['clear', '', COPY.btnClear],
          ],
          n > 0 ? COPY.selected(n, n * perImage) : COPY.pickFooter,
        ),
      );
      return done(next);
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
      const retryable = retryLookIds(s).length > 0;
      const items: [string, string, string][] = [];
      if (retryable) items.push(['retry', '', COPY.btnRetryFailed]);
      items.push(['more_poses', '', COPY.btnMorePoses]);
      items.push(retryable ? ['menu', 'menu', COPY.btnMenu] : ['menu', 'new', COPY.btnNewCatalog]);
      out.push(buttons(s, COPY.delivered, items));
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
    case 'ASK_GENDER': {
      if (action !== 'gender' || !GENDERS.includes(value as Gender)) return reprompt();
      const gender = value as Gender;
      const withGender: Session = { ...s, gender };
      // Spec 8a: recognition runs now, against that gender's types only, and
      // returns null on every failure — the list is always the way out.
      const hit = s.garmentKey ? await deps.recognizeGarment(s.garmentKey, gender) : null;
      if (hit) {
        const gt = (await deps.listGarmentTypes(gender)).find((t) => t.id === hit.garmentTypeId);
        // A correct answer for a type the bot cannot offer (a saree two-step
        // type, no template): say so, rather than pretending we didn't know.
        if (!gt) return notAvailable(withGender, hit.label, out, ctx, deps);
        // A guess is confirmed before anything is loaded: one tap on a hit,
        // and a miss never reaches the credit prompt.
        return enter(
          { ...withGender, garmentType: gt, recognized: true },
          'CONFIRM_GARMENT_TYPE',
          out,
          ctx,
          deps,
        );
      }
      return enter(withGender, 'ASK_GARMENT_TYPE', out, ctx, deps);
    }

    case 'CONFIRM_GARMENT_TYPE': {
      if (action === 'confirm' && s.garmentType) {
        return chooseGarmentType(s, s.garmentType, true, out, ctx, deps);
      }
      if (action !== 'change') return reprompt();
      deps.recordRecognitionCorrected();
      return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
    }

    case 'ASK_GARMENT_TYPE': {
      const gt = (await deps.listGarmentTypes(s.gender as Gender)).find((t) => t.id === value);
      if (action !== 'gt' || !gt) return reprompt();
      return chooseGarmentType(s, gt, false, out, ctx, deps);
    }

    case 'PICK_LOOKS': {
      if (action === 'change') {
        if (s.recognized) deps.recordRecognitionCorrected();
        return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
      }
      const perImage = s.perImage ?? 0;
      // Not a re-render: re-sending the carousel after every tap would bury the
      // chat. The nonce stays, so every earlier Generate button acts on the
      // current selection.
      const status = (picks: string[]): OutboundMessage =>
        buttons(s, COPY.selected(picks.length, picks.length * perImage), [
          ['generate', '', COPY.btnGenerate],
          ['clear', '', COPY.btnClear],
        ]);
      if (action === 'clear') {
        out.push(status([]));
        return { session: { ...s, picked: [] }, messages: out };
      }
      if (action === 'generate') {
        if (s.picked.length === 0) {
          out.push(text(COPY.pickAtLeastOne));
          return { session: s, messages: out };
        }
        // Tapping Generate is the agreement to spend (D45). Caught here, before
        // any run exists; createJob checks again.
        const balance = await deps.getBalance(ctx.userId);
        if (s.picked.length * perImage > balance) return enter(s, 'NO_CREDITS', out, ctx, deps);
        return generate(s, s.picked, out, ctx, deps);
      }
      const inPool = (s.templates ?? []).some((t) => t.looks.some((l) => l.id === value));
      if (action !== 'look' || !inPool) return reprompt();
      if (s.picked.includes(value)) {
        const without = s.picked.filter((id) => id !== value);
        out.push(status(without));
        return { session: { ...s, picked: without }, messages: out };
      }
      if (s.picked.length >= MAX_PICKS) {
        out.push(text(COPY.pickCap(MAX_PICKS)));
        return { session: s, messages: out };
      }
      const next = [...s.picked, value];
      out.push(status(next));
      return { session: { ...s, picked: next }, messages: out };
    }

    case 'DELIVERED': {
      if (action === 'more_poses') return enter(picksCleared(s), 'PICK_LOOKS', out, ctx, deps);
      if (action === 'retry') {
        const ids = retryLookIds(s);
        if (ids.length === 0) return reprompt();
        // The dispatcher already refunded the failed images; this is a fresh,
        // priced run of only those looks.
        return generate({ ...s, picked: ids }, ids, out, ctx, deps);
      }
      return reprompt();
    }

    default:
      return reprompt();
  }
}

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
    return old.template === undefined && old.count === undefined ? prev : null;
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
      return enter({ ...fresh, garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
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
      if (cmd === 'menu' || cmd === 'restart')
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      if (cmd === 'help') {
        out.push(text(COPY.help(deps.links.help)));
        return render(s, out, ctx, deps);
      }
      if (s.state === 'MAIN_MENU' || s.state === 'GENERATING') return render(s, out, ctx, deps);
      out.push(text(COPY.reprompt));
      return { session: s, messages: out };
    }

    case 'reply': {
      const d = decodeReplyId(event.id);
      if (!d || d.nonce !== s.nonce) {
        out.push(text(COPY.stale));
        return { session: s, messages: out };
      }
      return onReply(s, d.action, d.value, out, ctx, deps);
    }

    case 'image': {
      if (NEW_PHOTO_STATES.includes(s.state)) {
        return enter({ ...cleared(s), garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
      }
      if (s.state === 'ASK_EXTRA_PHOTO') {
        const slot = firstMissingSlot(s);
        if (slot) {
          const next = { ...s, photos: { ...s.photos, [slot]: event.garmentKey } };
          return enter(
            next,
            firstMissingSlot(next) ? 'ASK_EXTRA_PHOTO' : 'PICK_LOOKS',
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
      // Back to the cards with the selection kept (spec section 6).
      if (s.state === 'NO_CREDITS') return enter(s, 'PICK_LOOKS', out, ctx, deps);
      return { session: s, messages: out };
  }
}
