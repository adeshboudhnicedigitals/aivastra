import { AppError } from '../../../lib/errors.js';
import { COPY } from './copy.js';
import { decodeReplyId, encodeReplyId } from './reply-id.js';
import { buildTryonBody, eligibleLooks, firstMissingSlot, maxCount } from './rules.js';
import type {
  EngineContext,
  EngineDeps,
  EngineResult,
  GarmentTypeOption,
  Gender,
  InboundEvent,
  OutboundMessage,
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

/** Back to the count step; garment, type, extra photos, face and template kept. */
function picksCleared(s: Session): Session {
  return {
    ...s,
    count: undefined,
    picked: [],
    runId: undefined,
    runImages: undefined,
    failedPoseIds: undefined,
  };
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
  if (actions.length > 0) out.push(buttons(s, COPY.moreOptions, actions));
  return out;
}

/**
 * Re-reads the type's template and keeps only the looks the bot can generate
 * (D49). Re-read on every count / pick prompt, so a look an admin removed, or
 * a presigned image URL that expired, never reaches the seller. Null when
 * nothing is left — the type is then not available in the chat (D47).
 */
async function loadTemplate(s: Session, deps: EngineDeps): Promise<Session | null> {
  if (!s.gender || !s.garmentType) return null;
  const t = await deps.getTemplate(s.gender, s.garmentType.id);
  if (!t) return null;
  const { lowerOnly, looks } = eligibleLooks(s.garmentType, t.looks);
  if (looks.length === 0) return null;
  const ids = new Set(looks.map((l) => l.id));
  return {
    ...s,
    template: { id: t.id, mappingId: t.mappingId, lowerOnly, looks },
    picked: s.picked.filter((id) => ids.has(id)),
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
 * the chat no longer asks for (D43): face and template. Then the required
 * extra photos, then the count.
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
  const loaded = faceId ? await loadTemplate(withType, deps) : null;
  if (!loaded) return notAvailable(s, gt.label, out, ctx, deps);
  if (recognized) out.push(text(COPY.detected(gt.label)));
  return enter(
    loaded,
    firstMissingSlot(loaded) ? 'ASK_EXTRA_PHOTO' : 'ASK_POSE_COUNT',
    out,
    ctx,
    deps,
  );
}

/** Creates the run for `lookIds` (all picks, or the failed ones on retry). */
async function generate(
  s: Session,
  lookIds: string[],
  out: Out,
  ctx: EngineContext,
  deps: EngineDeps,
): Promise<EngineResult> {
  try {
    const { runId, images } = await deps.createRun(ctx, buildTryonBody(s, lookIds));
    // Shown, not charged, from the count step's quote: the charge itself is
    // createJob's own resolution of the same plan (D17).
    out.push(text(COPY.generating(images, images * (s.perImage ?? 0))));
    return {
      session: {
        ...s,
        state: 'GENERATING',
        nonce: deps.newNonce(),
        page: 0,
        runId,
        runImages: images,
        failedPoseIds: undefined,
      },
      messages: out,
    };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    if (err.code === 'INSUFFICIENT_CREDITS') return enter(s, 'NO_CREDITS', out, ctx, deps);
    // A look deactivated or a mapping changed after the list was shown (spec section 13).
    if (err.code === 'BAD_CATALOG') {
      out.push(text(COPY.posesChanged));
      return enter(picksCleared(s), 'ASK_POSE_COUNT', out, ctx, deps);
    }
    out.push(text(err.message));
    return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
  }
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
      out.push(text(COPY.askPhoto[slot](label)));
      return done();
    }

    case 'ASK_POSE_COUNT': {
      const loaded = await loadTemplate(s, deps);
      if (!loaded?.template)
        return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
      let perImage: number;
      let balance: number;
      try {
        // One look prices one image: the cost per image comes from the same plan
        // resolution the web uses (D17); the count rows multiply it.
        const q = await deps.quote(
          ctx.userId,
          buildTryonBody(loaded, [loaded.template.looks[0].id]),
        );
        perImage = q.perImage;
        balance = q.balance;
      } catch (err) {
        // Anything createJob would reject surfaces here, before any credits are taken.
        if (!(err instanceof AppError)) throw err;
        out.push(text(err.message));
        return enter(cleared(s), 'MAIN_MENU', out, ctx, deps);
      }
      const rows: Row[] = Array.from({ length: maxCount(loaded) }, (_, i) => ({
        action: 'count',
        value: String(i + 1),
        title: COPY.countRow(i + 1, (i + 1) * perImage),
      }));
      rows.push({ action: 'change', value: '', title: COPY.rowChangeGarment });
      const next: Session = { ...loaded, perImage, balance };
      out.push(listMsg(next, COPY.askCount(balance), rows));
      return done(next);
    }

    case 'PICK_LOOKS': {
      const loaded = await loadTemplate(s, deps);
      if (!loaded?.template)
        return notAvailable(s, s.garmentType?.label ?? 'These', out, ctx, deps);
      out.push(
        ...cardsMsgs(loaded, COPY.pickLooks(loaded.count ?? 1), 'look', loaded.template.looks, [
          ['restart', '', COPY.btnStartOver],
        ]),
      );
      return done(loaded);
    }

    case 'NO_CREDITS':
      out.push(buttons(s, COPY.noCredits(deps.links.pricing), [['menu', 'menu', COPY.btnMenu]]));
      return done();

    case 'GENERATING': {
      const p = s.runId
        ? await deps.runProgress(s.runId)
        : { finished: 0, total: s.runImages ?? 0 };
      out.push(text(COPY.stillGenerating(p.finished, p.total)));
      return done();
    }

    case 'DELIVERED': {
      const failed = s.failedPoseIds?.length ?? 0;
      const items: [string, string, string][] = [];
      if (failed > 0) items.push(['retry', '', COPY.btnRetryFailed]);
      items.push(['more_poses', '', COPY.btnMorePoses]);
      items.push(failed > 0 ? ['menu', 'menu', COPY.btnMenu] : ['menu', 'new', COPY.btnNewCatalog]);
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
        return chooseGarmentType(withGender, gt, true, out, ctx, deps);
      }
      return enter(withGender, 'ASK_GARMENT_TYPE', out, ctx, deps);
    }

    case 'ASK_GARMENT_TYPE': {
      const gt = (await deps.listGarmentTypes(s.gender as Gender)).find((t) => t.id === value);
      if (action !== 'gt' || !gt) return reprompt();
      return chooseGarmentType(s, gt, false, out, ctx, deps);
    }

    case 'ASK_POSE_COUNT': {
      if (action === 'change') {
        if (s.recognized) deps.recordRecognitionCorrected();
        return enter(garmentCleared(s), 'ASK_GARMENT_TYPE', out, ctx, deps);
      }
      const n = Number(value);
      if (action !== 'count' || !Number.isInteger(n) || n < 1 || n > maxCount(s)) return reprompt();
      const next: Session = { ...s, count: n, picked: [] };
      // Caught here, before the seller taps n poses (D45); createJob checks again.
      const balance = await deps.getBalance(ctx.userId);
      if (n * (s.perImage ?? 0) > balance) return enter(next, 'NO_CREDITS', out, ctx, deps);
      return enter(next, 'PICK_LOOKS', out, ctx, deps);
    }

    case 'PICK_LOOKS': {
      if (action !== 'look' || !s.template?.looks.some((l) => l.id === value)) return reprompt();
      if (s.picked.includes(value)) {
        out.push(text(COPY.lookAlreadyAdded));
        return { session: s, messages: out };
      }
      const next: Session = { ...s, picked: [...s.picked, value] };
      const count = s.count ?? 1;
      // Choosing the count was the agreement to spend (D45): the last pick starts the run.
      if (next.picked.length >= count) return generate(next, next.picked, out, ctx, deps);
      // Not a re-render: re-sending the carousel after every tap would bury the chat.
      out.push(
        buttons(next, COPY.lookAdded(next.picked.length, count), [
          ['restart', '', COPY.btnStartOver],
        ]),
      );
      return { session: next, messages: out };
    }

    case 'DELIVERED': {
      if (action === 'more_poses') return enter(picksCleared(s), 'ASK_POSE_COUNT', out, ctx, deps);
      if (action === 'retry') {
        const failed = new Set(s.failedPoseIds ?? []);
        const looks = s.template?.looks ?? [];
        const ids = s.picked.filter((id) =>
          failed.has(looks.find((l) => l.id === id)?.poseId ?? ''),
        );
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
  if (!prev) {
    const s = await freshSession(ctx.userId, deps);
    if (event.type === 'reply') out.push(text(COPY.sessionExpired));
    // A first photo starts a catalog straight away (spec section 8).
    if (event.type === 'image')
      return enter({ ...s, garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
    return render(s, out, ctx, deps);
  }
  const s = prev;

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
      if (s.runId !== event.runId) return { session: s, messages: out };
      if (event.failedPoseIds.length > 0)
        out.push(text(COPY.partlyFailed(event.failedPoseIds.length, event.images)));
      return enter({ ...s, failedPoseIds: event.failedPoseIds }, 'DELIVERED', out, ctx, deps);
    }

    case 'creditsAdded':
      out.push(text(COPY.creditsAdded(event.credits)));
      if (s.state === 'NO_CREDITS') return enter(picksCleared(s), 'ASK_POSE_COUNT', out, ctx, deps);
      return { session: s, messages: out };
  }
}
