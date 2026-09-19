/**
 * Answers: "is there a history entry behind the current one, in this
 * document's session?" — used by useCloseOverlay to decide whether closing
 * an overlay can safely call browser back (navigate(-1)) or must replace to
 * a computed parent URL instead (a fresh load/refresh landing directly on a
 * URL that already has an overlay open has no prior entry to go back to).
 *
 * react-router-dom v6's routing engine (@remix-run/router) stamps
 * `{ usr, key, idx }` into `window.history.state` for every entry it
 * creates — `idx` starts at 0 on a fresh document load and is kept current
 * across BOTH pushes and browser-initiated Back/Forward (verified against
 * this repo's installed @remix-run/router@1.23.2: `getIndex()` always
 * re-reads `history.state.idx` live, including from the `popstate` handler).
 * That makes it the right signal here — a manually-maintained push/pop
 * counter only ever saw pushes and pops THIS app's own code performed, so a
 * physical Back press (dismissing an overlay exactly the way this app's own
 * docs say it should work) went unrecorded and could make a LATER close
 * wrongly think there was still an in-app push to go back to, popping the
 * user out of the app entirely. Reading the router's own position avoids
 * that class of bug outright — there's nothing left to keep in sync.
 *
 * `?? 0` fails toward the safe direction if this shape is ever unavailable:
 * useCloseOverlay's fallback (replace), never a navigate(-1) into nothing.
 */
export function hasInAppNavigation(): boolean {
  return ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
}
