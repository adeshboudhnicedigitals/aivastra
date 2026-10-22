import { AppError } from '../../../lib/errors.js';
import { COPY } from './copy.js';
import { buttons, text } from './engine.js';
import { decodeReplyId, encodeReplyId } from './reply-id.js';
import {
  canFill,
  drawTryonPoses,
  TRYON_COUNTS,
  type TryonCount,
  type TryonPose,
} from './tryon-rules.js';
import type {
  EngineContext,
  EngineDeps,
  EngineResult,
  Gender,
  InboundEvent,
  OutboundMessage,
  Session,
  State,
} from './types.js';

/**
 * The try-on flow (spec 2026-10-22-whatsapp-tryon-flow-design):
 * photo -> gender -> how many poses -> generate. It reuses Session and the state
 * names the catalogue engine already has; it has its own reducer so the
 * catalogue flow stays untouched until this one is approved.
 */
export interface TryonDeps
  extends Pick<EngineDeps, 'newNonce' | 'getBalance' | 'shuffle' | 'links'> {
  // Credits per image (getTryonCreditCost).
  getTryonCost(): Promise<number>;
  // The drawable poses for a gender, read fresh.
  listPoolPoses(gender: Gender): Promise<TryonPose[]>;
  // One job per pose under one run. Throws AppError (INSUFFICIENT_CREDITS, ...)
  // when no job could be created; `created < requested` is a partial start.
  createTryonRun(
    ctx: EngineContext,
    input: { garmentKey: string; poses: TryonPose[] },
  ): Promise<{ runId: string; requested: number; created: number; reason?: string }>;
  // Admin-facing: a gender with nothing to draw (logged, never shown to the seller).
  reportNoPoses(gender: Gender): void;
}

type Out = OutboundMessage[];

const STATES: State[] = [
  'MAIN_MENU',
  'ASK_GARMENT_PHOTO',
  'ASK_GENDER',
  'ASK_POSE_COUNT',
  'NO_CREDITS',
  'GENERATING',
  'DELIVERED',
];
// The order the product asked for.
const GENDERS: Gender[] = ['men', 'women', 'boys', 'girls'];
// States where free text just shows the current step again.
const IDLE: State[] = ['MAIN_MENU', 'DELIVERED'];
const EXIT_WORDS = new Set(['cancel', 'exit', 'quit', 'back']);

function fresh(deps: TryonDeps): Session {
  return {
    v: 1,
    state: 'MAIN_MENU',
    flow: 'tryon',
    nonce: deps.newNonce(),
    page: 0,
    // Unused by this flow; the fields are required by Session.
    aspectRatio: '3:4',
    resolution: '2K',
    photos: {},
    picked: [],
  };
}

/** Everything chosen so far dropped; the next step is asked from scratch. */
const cleared = (s: Session, deps: TryonDeps): Session => ({ ...fresh(deps), nonce: s.nonce });

/** Moves to `state` with a fresh nonce and renders its prompt. */
function enter(s: Session, state: State, out: Out, ctx: EngineContext, deps: TryonDeps) {
  return render({ ...s, state, nonce: deps.newNonce(), page: 0 }, out, ctx, deps);
}

async function render(
  s: Session,
  out: Out,
  ctx: EngineContext,
  deps: TryonDeps,
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
      out.push({
        kind: 'list',
        text: COPY.askGender,
        buttonLabel: COPY.listChoose,
        rows: GENDERS.map((g) => ({
          id: encodeReplyId(s.nonce, 'gender', g),
          title: COPY.genders[g],
        })),
      });
      return done();

    case 'ASK_POSE_COUNT': {
      if (!s.gender) return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
      const [pool, perImage, balance] = await Promise.all([
        deps.listPoolPoses(s.gender),
        deps.getTryonCost(),
        deps.getBalance(ctx.userId),
      ]);
      const fillable = TRYON_COUNTS.filter((n) => canFill(pool, s.gender as Gender, n));
      if (fillable.length === 0) {
        deps.reportNoPoses(s.gender);
        out.push(text(COPY.tryonNoPoses));
        return enter({ ...s, gender: undefined }, 'ASK_GENDER', out, ctx, deps);
      }
      const offered = fillable.filter((n) => n * perImage <= balance);
      const next: Session = { ...s, perImage, balance };
      if (offered.length === 0) return enter(next, 'NO_CREDITS', out, ctx, deps);
      out.push({
        kind: 'list',
        text: COPY.tryonCountPrompt(COPY.genders[s.gender], perImage, balance),
        buttonLabel: COPY.listChoose,
        rows: offered.map((n) => ({
          id: encodeReplyId(s.nonce, 'count', String(n)),
          title: COPY.countOption(n, n * perImage),
        })),
      });
      return done(next);
    }

    case 'NO_CREDITS':
      out.push(buttons(s, COPY.noCredits(deps.links.pricing), [['menu', 'menu', COPY.btnMenu]]));
      return done();

    case 'GENERATING':
      out.push(text(COPY.generating(s.count ?? 0)));
      return done();

    case 'DELIVERED':
      out.push(
        buttons(s, COPY.deliveredNext, [
          ['next', 'more', COPY.btnMakeMore],
          ['next', 'new', COPY.btnNewGarment],
          ['menu', 'menu', COPY.btnMenu],
        ]),
      );
      return done();

    default:
      return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
  }
}

/** The count tap: the seller's agreement to spend (D45), so the balance is re-read here. */
async function generate(
  s: Session,
  n: TryonCount,
  out: Out,
  ctx: EngineContext,
  deps: TryonDeps,
): Promise<EngineResult> {
  if (!s.gender || !s.garmentKey) return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
  const [pool, perImage, balance] = await Promise.all([
    deps.listPoolPoses(s.gender),
    deps.getTryonCost(),
    deps.getBalance(ctx.userId),
  ]);
  if (!canFill(pool, s.gender, n)) {
    // An admin removed poses since the list was shown: nothing is charged.
    out.push(text(COPY.posesChanged));
    return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
  }
  const noCredits = () => enter({ ...s, perImage, balance }, 'NO_CREDITS', out, ctx, deps);
  if (n * perImage > balance) return noCredits();

  const poses = drawTryonPoses(pool, s.gender, n, deps.shuffle);
  let run: Awaited<ReturnType<TryonDeps['createTryonRun']>>;
  try {
    run = await deps.createTryonRun(ctx, { garmentKey: s.garmentKey, poses });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    if (err.code === 'INSUFFICIENT_CREDITS') return noCredits();
    out.push(text(err.message));
    return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
  }
  if (run.created < run.requested) {
    out.push(
      text(COPY.partlyStarted(run.created, run.requested, run.reason ?? 'a temporary problem')),
    );
  }
  out.push(text(COPY.generating(run.created)));
  return {
    session: {
      ...s,
      state: 'GENERATING',
      nonce: deps.newNonce(),
      page: 0,
      count: n,
      perImage,
      balance,
      runs: [{ runId: run.runId, images: run.created }],
    },
    messages: out,
  };
}

async function onReply(
  s: Session,
  action: string,
  value: string,
  out: Out,
  ctx: EngineContext,
  deps: TryonDeps,
): Promise<EngineResult> {
  if (action === 'menu') {
    if (value === 'new') return enter(cleared(s, deps), 'ASK_GARMENT_PHOTO', out, ctx, deps);
    if (value === 'credits') {
      const balance = await deps.getBalance(ctx.userId);
      out.push(text(COPY.credits(balance, deps.links.pricing)));
      return render(s, out, ctx, deps);
    }
    if (value === 'help') {
      out.push(text(COPY.help(deps.links.help)));
      return render(s, out, ctx, deps);
    }
    return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
  }
  if (action === 'gender' && s.state === 'ASK_GENDER') {
    const gender = GENDERS.find((g) => g === value);
    if (!gender) return render(s, out, ctx, deps);
    return enter({ ...s, gender }, 'ASK_POSE_COUNT', out, ctx, deps);
  }
  if (action === 'count' && s.state === 'ASK_POSE_COUNT') {
    const n = TRYON_COUNTS.find((c) => String(c) === value);
    if (!n) return render(s, out, ctx, deps);
    return generate(s, n, out, ctx, deps);
  }
  if (action === 'next' && s.state === 'DELIVERED') {
    if (value === 'more') return enter({ ...s, runs: undefined }, 'ASK_POSE_COUNT', out, ctx, deps);
    return enter(cleared(s, deps), 'ASK_GARMENT_PHOTO', out, ctx, deps);
  }
  return render(s, out, ctx, deps);
}

export async function handleTryon(
  prev: Session | null,
  event: InboundEvent,
  ctx: EngineContext,
  deps: TryonDeps,
): Promise<EngineResult> {
  const out: Out = [];
  // A session saved by the other flow (the flag was switched) starts over. The
  // state names overlap, so the flow marker — not the state — decides this.
  const known = prev && prev.flow === 'tryon' && STATES.includes(prev.state) ? prev : null;
  if (!known) {
    const s = fresh(deps);
    if (event.type === 'reply' && prev) out.push(text(COPY.sessionExpired));
    if (event.type === 'image') {
      return enter({ ...s, garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
    }
    return render(s, out, ctx, deps);
  }
  const s = known;

  switch (event.type) {
    case 'text': {
      const cmd = event.text.trim().toLowerCase();
      if (cmd === 'menu' || cmd === 'restart' || EXIT_WORDS.has(cmd))
        return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
      if (cmd === 'help') {
        out.push(text(COPY.help(deps.links.help)));
        return render(s, out, ctx, deps);
      }
      if (IDLE.includes(s.state)) return render(s, out, ctx, deps);
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

    case 'image':
      if (s.state === 'GENERATING') {
        out.push(text(COPY.notNow));
        return render(s, out, ctx, deps);
      }
      return enter(
        { ...cleared(s, deps), garmentKey: event.garmentKey },
        'ASK_GENDER',
        out,
        ctx,
        deps,
      );

    case 'unsupportedMedia':
      out.push(text(COPY.unsupported));
      return s.state === 'ASK_GARMENT_PHOTO'
        ? { session: s, messages: out }
        : render(s, out, ctx, deps);

    case 'runFinished': {
      const mine = (s.runs ?? []).find((r) => r.runId === event.runId);
      // A run from an earlier session still gets its images (delivery sends by
      // run); only the closing message here is skipped.
      if (!mine || mine.finished) return { session: s, messages: out };
      const failed = event.failed ?? event.failedPoseIds.length;
      const delivered = Math.max(event.images - failed, 0);
      const runs = (s.runs ?? []).map((r) =>
        r.runId === event.runId ? { ...r, finished: true, failed } : r,
      );
      if (delivered > 0) {
        const remaining = await deps.getBalance(ctx.userId);
        out.push(
          text(
            COPY.tryonDelivered(
              delivered,
              COPY.genders[(s.gender ?? 'men') as Gender],
              delivered * (s.perImage ?? 0),
              remaining,
            ),
          ),
        );
      }
      if (failed > 0) out.push(text(COPY.partlyFailed(failed, event.images)));
      return enter({ ...s, runs }, 'DELIVERED', out, ctx, deps);
    }

    case 'creditsAdded':
      out.push(text(COPY.creditsAdded(event.credits)));
      if (s.state === 'NO_CREDITS' && s.gender && s.garmentKey)
        return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
      return { session: s, messages: out };
  }
}
