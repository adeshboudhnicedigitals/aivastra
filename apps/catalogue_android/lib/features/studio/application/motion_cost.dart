import 'dart:math' as math;

import '../data/models/sample_video.dart';

/// Mirrors the server's computePixverseVideoCost exactly
/// (packages/types/src/jobs.ts), so the Generate button's estimate never
/// diverges from what the server actually deducts: base cost for the chosen
/// quality tier plus duration times that tier's per-second rate, floored to
/// at least 1 credit. Missing/unreadable config for the tier (e.g. an admin
/// edit that hasn't filled in every quality yet) falls back to 1 rather than
/// a misleading 0 — same reasoning as the server's own NaN guard.
int computePixverseVideoCost(
  int duration,
  String quality,
  PixversePricing pricing,
) {
  final base = pricing.qualityBase[quality];
  final perSecond = pricing.perSecondRate[quality];
  if (base == null || perSecond == null) return 1;
  return math.max(1, (base + duration * perSecond).ceil());
}

/// What the Generate button should show and what submission will actually be
/// billed — mirrors the web app's catalog-video page exactly
/// (ConfigPanel.tsx): computed live from the current duration/quality once
/// pricing config has loaded, falling back to the selected preset's own
/// server-computed `creditCost` for the brief gap before it has (or if it
/// never loads). Previously this button showed a hardcoded "10 Credits"
/// regardless of selection — PIXVERSE_VIDEO_COST (packages/types/src/jobs.ts)
/// defaults every quality tier's base to 150, so a plain custom-duration
/// video costs far more than that flat 10 in practice.
int? creditsForMotionVideo({
  required int duration,
  required String quality,
  required PixversePricing? pricing,
  required int? selectedSampleCreditCost,
}) {
  if (pricing != null) {
    return computePixverseVideoCost(duration, quality, pricing);
  }
  return selectedSampleCreditCost;
}
