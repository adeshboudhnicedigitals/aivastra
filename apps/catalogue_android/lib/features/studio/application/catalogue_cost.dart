import 'catalogue_selection_state.dart';
import '../data/models/resolutions_config.dart';

/// Fallback per-image cost when the server hasn't returned its resolution
/// config yet — mirrors the web app's own `RESOLUTION_COSTS` fallback
/// (apps/catalogues-web/src/app/(app)/studio/page.tsx), used there for that
/// same brief gap.
const kFallbackResolutionCredits = {'HD': 25, '2K': 35, '4K': 40};

/// How many images a Catalogue Studio submission will produce: one per
/// selected pose in Create Your Own, one per kept look in Ready-Made —
/// exactly what `resolveTryonPlan` bills server-side, one deduction per look
/// (apps/api/src/modules/jobs/create.ts).
int imageCountFor(CatalogueSelectionState selection) =>
    selection.lookMode == LookMode.createYourOwn
        ? selection.poseIds.length
        : selection.selectedLookIds.length;

/// Total credits a submission will actually charge: per-image cost (the
/// chosen resolution tier) times [imageCountFor] — mirrors the web app's
/// `creditCost` (studio/page.tsx: `resolutionConfig[resolution].creditCost *
/// selectedCount`). The Generate button previously showed a flat "10
/// Credits" regardless of how many poses/looks were selected, undercounting
/// every multi-image submission relative to what the server deducts.
int creditsForSelection(
  CatalogueSelectionState selection,
  ResolutionsConfig? config,
) {
  final perImage =
      config?.resolutions[selection.resolution]?.creditCost ??
      kFallbackResolutionCredits[selection.resolution] ??
      35;
  return perImage * imageCountFor(selection);
}
