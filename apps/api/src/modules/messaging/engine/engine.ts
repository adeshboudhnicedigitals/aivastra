import { AppError } from '../../../lib/errors.js';
import { COPY } from './copy.js';
import { decodeReplyId, encodeReplyId } from './reply-id.js';
import {
  buildPool,
  buildTryonBody,
  drawLooks,
  firstMissingSlot,
  itemSupply,
  POSE_COUNTS,
  poseCountOptions,
  requiredPhotoSlots,
  retryLookIds,
} from './rules.js';
import type {
  BasketChoice,
  EngineContext,
  EngineDeps,
  EngineResult,
  GarmentTypeOption,
  Gender,
  InboundEvent,
  OutboundMessage,
  PickCard,
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

/** Back to choosing poses; garment, type and extra photos kept. */
function picksCleared(s: Session): Session {
  return { ...s, picked: [], count: undefined, runs: undefined };
}

export const text = (t: string): OutboundMessage => ({ kind: 'text', text: t });

export function buttons(
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
 * Re-reads the type's standard poses and keeps only the ones the bot can
 * generate (D49), as one pool. Re-read on every prompt and on Generate, so a
 * pose an admin removed, or a presigned image URL that expired, never reaches
 * the seller; picks no longer in the pool are dropped. Null when nothing is
 * left — the type is then not available in the chat (D47).
 */
async function loadPool(s: Session, deps: EngineDeps): Promise<Loaded | null> {
  if (!s.gender || !s.garmentType) return null;
  const at = { gender: s.gender as Gender, garmentTypeId: s.garmentType.id };
  const poses = await deps.getLooks(at.gender, at.garmentTypeId);
  if (poses.length === 0) {
    deps.reportUnavailable({ ...at, reason: 'no_poses' });
    return null;
  }
  const [lowerIds, shoeIds] = await Promise.all([
    deps.listCatalogItemIds('lower', at.gender, at.garmentTypeId),
    deps.listCatalogItemIds('shoe', at.gender, at.garmentTypeId),
  ]);
  const { pool, cards } = buildPool(
    s.garmentType,
    poses,
    itemSupply(s.garmentType, lowerIds, shoeIds),
  );
  if (pool.looks.length === 0) {
    deps.reportUnavailable({ ...at, reason: 'no_eligible_looks', poses: poses.length });
    return null;
  }
  const ids = new Set(cards.map((c) => c.id));
  return {
    session: { ...s, pool, picked: s.picked.filter((id) => ids.has(id)) },
    cards,
  };
}

/**
 * What every image of a run shares: one model face and one background at
 * random, plus a lower garment and shoes — the type's default, else one at
 * random. Null when there is no face or no background. A lower or shoe the
 * type cannot supply is left out; the pool already excludes the poses that
 * need it.
 */
async function drawBatch(
  s: Session,
  deps: EngineDeps,
): Promise<Pick<Session, 'faceId' | 'backgroundId' | 'lowerCatalogId' | 'shoeCatalogId'> | null> {
  const gender = s.gender as Gender;
  const gt = s.garmentType as GarmentTypeOption;
  const [faces, backgrounds, lowers, shoes] = await Promise.all([
    deps.listFaceIds(gender, gt.id),
    deps.listBackgroundIds(gender),
    deps.listCatalogItemIds('lower', gender, gt.id),
    deps.listCatalogItemIds('shoe', gender, gt.id),
  ]);
  const faceId = deps.shuffle(faces)[0];
  const backgroundId = deps.shuffle(backgrounds)[0];
  if (!faceId || !backgroundId) return null;
  return {
    faceId,
    backgroundId,
    lowerCatalogId: gt.defaultLowerCatalogId ?? deps.shuffle(lowers)[0],
    shoeCatalogId: gt.defaultShoeCatalogId ?? deps.shuffle(shoes)[0],
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
  if (s.gender && (await deps.listBaskets(s.gender as Gender)).length === 0) {
    out.push(text(COPY.handoff(gt.label, url, false)));
    return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  }
  out.push(text(COPY.handoff(gt.label, url)));
  return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
}

/**
 * The garment type is known, from recognition or the list. Fills the defaults
 * the chat no longer asks for (D43): the pose pool. Then the required
 * extra photos, then the pose picks.
 */
async function chooseGarmentType(
  s: Session,
  gt: GarmentTypeOption,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const gender = s.gender as Gender;
  const withType: Session = { ...garmentCleared(s), garmentType: gt };
  const [faces, backgrounds] = await Promise.all([
    deps.listFaceIds(gender, gt.id),
    deps.listBackgroundIds(gender),
  ]);
  if (faces.length === 0) {
    deps.reportUnavailable({ gender, garmentTypeId: gt.id, reason: 'no_face' });
  }
  if (backgrounds.length === 0) {
    deps.reportUnavailable({ gender, garmentTypeId: gt.id, reason: 'no_background' });
  }
  const loaded = faces.length > 0 && backgrounds.length > 0 ? await loadPool(withType, deps) : null;
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
 * Starts one run for `lookIds` (all picks, or the failed ones on retry), on the
 * session's face and background. The run is quoted first (read-only, raises what
 * createJob would), so a pose that is no longer valid is found before the charge.
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
    // An admin removed a pose since the cards were shown: nothing is charged and
    // the seller reviews what is left (ls.picked is already pruned).
    out.push(text(COPY.posesChanged));
    return enter(ls, 'ASK_POSE_COUNT', out, ctx, deps);
  }

  let run: { runId: string; images: number };
  try {
    const body = buildTryonBody(ls, lookIds);
    await deps.quote(ctx.userId, body);
    run = await deps.createRun(ctx, body);
  } catch (err) {
    return createRejected(err, ls, out, ctx, deps);
  }

  out.push(text(COPY.generating(run.images)));
  return {
    session: {
      ...ls,
      picked: lookIds,
      state: 'GENERATING',
      nonce: deps.newNonce(),
      page: 0,
      runs: [run],
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
      out.push(buttons(s, COPY.askGarmentPhoto, [['menu', 'menu', COPY.btnBack]]));
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

    case 'CONFIRM_BASKET': {
      const guess = s.baskets?.[0];
      if (!guess) return enter(s, 'ASK_GARMENT_TYPE', out, ctx, deps);
      out.push(
        buttons(s, COPY.basketGuess(guess.name), [
          ['confirm', '', COPY.btnYesContinue],
          ['change', '', COPY.btnNoDifferent],
        ]),
      );
      return done();
    }

    case 'CHOOSE_BASKET': {
      const alternatives = s.baskets?.slice(1) ?? [];
      if (alternatives.length === 0) return enter(s, 'ASK_GARMENT_TYPE', out, ctx, deps);
      out.push(
        listMsg(s, COPY.askBasket, [
          ...alternatives.map((b) => ({ action: 'basket', value: b.key, title: b.name })),
          { action: 'other', value: '', title: COPY.basketOther },
        ]),
      );
      return done();
    }

    case 'ASK_GARMENT_TYPE': {
      // Baskets, not every type: one row per group the classifier would have
      // guessed, so the list stays short and each row runs like a confirmed guess.
      const choices = await deps.listBaskets(s.gender as Gender);
      if (choices.length === 0) {
        out.push(text(COPY.nothingAvailable));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
      out.push(
        listMsg(
          s,
          COPY.askGarmentType,
          choices.map((b) => ({ action: 'basket', value: b.key, title: b.name })),
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
      const batch = loaded ? await drawBatch(loaded.session, deps) : null;
      const first = loaded?.session.pool?.looks[0];
      if (!loaded || !batch || !first || !s.gender || !s.garmentType) {
        return handoff(s, s.garmentType ?? { id: '', label: 'These' }, out, ctx, deps);
      }
      const ls = loaded.session;
      let q: { perImage: number; balance: number };
      try {
        // One look prices one image: the cost per image comes from the same plan
        // resolution the web uses (D17); the count multiplies it.
        q = await deps.quote(ctx.userId, buildTryonBody({ ...ls, ...batch }, [first.id]));
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
      // One message: what was delivered, what it cost, what was refunded, what next.
      // Failed images were refunded, so only the delivered ones were spent.
      const body =
        delivered > 0 || failed > 0
          ? COPY.closing(delivered, failed, s.perImage ?? 0, await deps.getBalance(ctx.userId))
          : COPY.deliveredNext;
      const retryable = retryLookIds(s).length > 0;
      const items: [string, string, string][] = retryable
        ? [
            ['retry', '', COPY.btnRetryFailed],
            ['more_poses', '', COPY.btnMorePoses],
            ['menu', 'menu', COPY.btnMenu],
          ]
        : [
            ['more_poses', '', COPY.btnMorePoses],
            ['menu', 'new', COPY.btnNewGarment],
            ['menu', 'menu', COPY.btnMenu],
          ];
      out.push(buttons(s, body, items));
      return done();
    }
  }
}

/**
 * Answers credits / help without losing the seller's place: at the photo prompt
 * the reminder rides in the same message, while generating nothing is re-asked,
 * and anywhere else the current step is shown again with the draft kept.
 */
async function answerInfo(
  s: Session,
  message: string,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  if (s.state === 'ASK_GARMENT_PHOTO') {
    out.push(text(`${message}\n\n${COPY.thenPhoto}`));
    return { session: s, messages: out };
  }
  out.push(text(message));
  if (s.state === 'GENERATING') return { session: s, messages: out };
  return render(s, out, ctx, deps);
}

async function onReply(
  s: Session,
  action: string,
  value: string,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  // An answer that does not fit the step shows the step again, without a scolding line.
  const reprompt = () => render(s, out, ctx, deps);
  // Paging keeps the nonce so cards on earlier pages stay tappable.
  if (action === 'more') return render({ ...s, page: s.page + 1 }, out, ctx, deps);
  if (action === 'restart') return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  if (action === 'menu') {
    if (value === 'new') return enter(cleared(s), 'ASK_GARMENT_PHOTO', out, ctx, deps);
    if (value === 'credits') {
      const balance = await deps.getBalance(ctx.userId);
      return answerInfo(s, COPY.credits(balance, deps.links.pricing), out, ctx, deps);
    }
    if (value === 'help') return answerInfo(s, COPY.help(deps.links.help), out, ctx, deps);
    return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  }

  switch (s.state) {
    case 'CONFIRM_BASKET': {
      const guess = s.baskets?.[0];
      if (action === 'confirm' && guess) return chooseBasket(s, guess, out, ctx, deps);
      if (action !== 'change') return reprompt();
      deps.recordRecognitionCorrected();
      // The alternatives first; with none, CHOOSE_BASKET falls through to the list.
      return enter(s, 'CHOOSE_BASKET', out, ctx, deps);
    }

    case 'CHOOSE_BASKET': {
      if (action === 'other') {
        return enter({ ...s, baskets: undefined }, 'ASK_GARMENT_TYPE', out, ctx, deps);
      }
      const picked = s.baskets?.slice(1).find((b) => b.key === value);
      if (action !== 'basket' || !picked) return reprompt();
      return chooseBasket(s, picked, out, ctx, deps);
    }

    case 'ASK_GENDER': {
      if (action !== 'gender' || !GENDERS.includes(value as Gender)) return reprompt();
      return pickGender(s, value as Gender, out, ctx, deps);
    }

    case 'ASK_GARMENT_TYPE': {
      if (action === 'basket') {
        const picked = (await deps.listBaskets(s.gender as Gender)).find((b) => b.key === value);
        return picked ? chooseBasket(s, picked, out, ctx, deps) : reprompt();
      }
      // A type row from a list sent before baskets (2026-10-26), still tappable.
      const gt = (await deps.listGarmentTypes(s.gender as Gender)).find((t) => t.id === value);
      if (action !== 'gt' || !gt) return reprompt();
      return chooseGarmentType(s, gt, out, ctx, deps);
    }

    case 'ASK_POSE_COUNT': {
      const n = Number(value);
      if (action !== 'count' || !(POSE_COUNTS as readonly number[]).includes(n)) return reprompt();
      const loaded = await loadPool(s, deps);
      const batch = loaded ? await drawBatch(loaded.session, deps) : null;
      if (!loaded || !batch) {
        return handoff(s, s.garmentType ?? { id: '', label: 'These' }, out, ctx, deps);
      }
      // The face and background are drawn here, once, for the whole catalogue.
      const ls = { ...loaded.session, ...batch, count: n };
      // Tapping the count is the agreement to spend (D45). Caught here, before
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
      return reprompt();
    }

    default:
      return reprompt();
  }
}

// Typed words that mean "get me out". Never 'stop': that is the opt-out (inbound.ts).
const EXIT_WORDS = new Set(['cancel', 'exit', 'quit', 'back', 'hi', 'hello']);

// What a session saved before 2026-10-14 may still carry.
type LegacySession = Session & {
  template?: unknown;
  kind?: string;
  kindGenders?: string[];
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
  // Saved mid-confirm by the kind flow (before 2026-10-26): the photo is kept
  // and the seller is asked the gender, which now comes first.
  if ((old.state as string) === 'CONFIRM_KIND') {
    const { kind: _k, kindGenders: _g, ...rest } = old;
    return { ...rest, state: 'ASK_GENDER' };
  }
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

/**
 * The gender is tapped: recognise the photo among that gender's types (types
 * are per-gender rows, so recognition waits for it) and offer the best basket,
 * or the type list when there is no confident guess.
 */
async function pickGender(
  s: Session,
  gender: Gender,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const withGender: Session = { ...s, gender, baskets: undefined };
  const guesses = s.garmentKey ? await deps.recognizeBaskets(s.garmentKey, gender) : null;
  if (!guesses?.length) return enter(withGender, 'ASK_GARMENT_TYPE', out, ctx, deps);
  return enter({ ...withGender, baskets: guesses }, 'CONFIRM_BASKET', out, ctx, deps);
}

/**
 * A basket is confirmed or picked: it runs as the first of its types the bot can
 * offer, representative first (D47: assigned poses). None offerable — the
 * representative is not ready, say — hands the seller to the studio with that
 * type rather than pretend we didn't know.
 */
async function chooseBasket(
  s: Session,
  basket: BasketChoice,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  const gender = s.gender as Gender;
  const next: Session = { ...s, baskets: undefined };
  const [members, offered] = await Promise.all([
    deps.basketTypes(gender, basket.key),
    deps.listGarmentTypes(gender),
  ]);
  // An admin removed the basket since it was offered: the list is the way out.
  const first = members[0];
  if (!first) return enter(next, 'ASK_GARMENT_TYPE', out, ctx, deps);
  for (const m of members) {
    const gt = offered.find((t) => t.id === m.id);
    if (gt) return chooseGarmentType(next, gt, out, ctx, deps);
  }
  // Report why, from the same facts the studio reads, so an admin sees
  // "template_inactive" rather than a bare "not offered".
  const { reasons } = await deps.getReadiness(gender, first.id);
  for (const reason of reasons) {
    deps.reportUnavailable({ gender, garmentTypeId: first.id, reason });
  }
  return handoff(next, first, out, ctx, deps);
}

/** A new garment photo: the gender comes first, since recognition is per gender. */
async function startFromPhoto(
  fresh: Session,
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  return enter(fresh, 'ASK_GENDER', out, ctx, deps);
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
      if (cmd === 'help') return answerInfo(s, COPY.help(deps.links.help), out, ctx, deps);
      if (cmd === 'credits') {
        const balance = await deps.getBalance(ctx.userId);
        return answerInfo(s, COPY.credits(balance, deps.links.pricing), out, ctx, deps);
      }
      // Anything else shows the current step again, without a scolding line.
      return render(s, out, ctx, deps);
    }

    case 'reply': {
      const d = decodeReplyId(event.id);
      // Menu buttons do not depend on the step, so they work from any old message.
      // Any other stale tap just shows the step we are on, with no complaint.
      if (!d || (d.action !== 'menu' && d.nonce !== s.nonce)) return render(s, out, ctx, deps);
      return onReply(s, d.action, d.value, out, ctx, deps);
    }

    case 'image': {
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
      // Anywhere else a photo can only mean "do this one" (spec section 8): it
      // replaces the draft. Recognised once the gender is tapped; awaited
      // there, so the seller waits once, up to the budget.
      return startFromPhoto({ ...cleared(s), garmentKey: event.garmentKey }, out, ctx, deps);
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
      return enter(next, 'DELIVERED', out, ctx, deps);
    }

    case 'creditsAdded':
      out.push(text(COPY.creditsAdded(event.credits)));
      // Back to the count question (spec section 6).
      if (s.state === 'NO_CREDITS') return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
      return { session: s, messages: out };
  }
}
