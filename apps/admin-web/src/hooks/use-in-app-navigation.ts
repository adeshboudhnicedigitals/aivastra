// A tiny module-level counter, not React state — deliberately not routed
// through context. It tracks how many pushes this app's own navigation calls
// (useUrlState/useUrlStateMulti/AssetsContext's setActiveTab) have made that
// haven't yet been popped again by useCloseOverlay's own navigate(-1) call.
// useCloseOverlay uses it to decide whether "close" can safely call browser
// back (there's a push it made itself to land on) or must replace to a
// computed parent URL instead.
//
// A one-way boolean was tried first and is unsound: once true, it stays true
// even after every push it recorded has already been popped again, so a LATER
// close (e.g. collapsing an accordion after an earlier modal was opened and
// cancelled) would wrongly call navigate(-1) and could exit the app entirely.
// A counter that increments on push and decrements on pop tracks this
// correctly.
//
// Not every push in the app goes through markInAppNavigation — sidebar nav
// and breadcrumb clicks don't. That only makes the counter under-count,
// which is the safe direction: it can make useCloseOverlay use the fallback
// replace in a case where navigate(-1) would also have been fine, never the
// reverse (it can never make the counter claim a push exists that doesn't).
let pushDepth = 0;

export function markInAppNavigation(): void {
  pushDepth += 1;
}

export function recordInAppPop(): void {
  pushDepth = Math.max(0, pushDepth - 1);
}

export function hasInAppNavigation(): boolean {
  return pushDepth > 0;
}
