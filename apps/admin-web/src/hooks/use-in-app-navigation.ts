// A tiny module-level flag, not React state — deliberately not routed through
// context. It answers one question: has this browser tab performed at least
// one in-app push yet? useCloseOverlay uses it to decide whether "close" can
// safely call browser back (there's something to go back to) or must replace
// to a computed parent URL instead (a fresh deep-link/refresh landing directly
// on a URL with an overlay already open has no prior in-app history).
let hasPushed = false;

export function markInAppNavigation(): void {
  hasPushed = true;
}

export function hasInAppNavigation(): boolean {
  return hasPushed;
}
