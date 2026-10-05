import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/app_exception.dart';
import '../data/models/background_category.dart';
import '../data/models/catalog_options.dart';
import '../data/models/background_model.dart';
import '../data/models/catalog_node.dart';
import '../data/models/catalog_video_row.dart';
import '../data/models/catalogue_summary.dart';
import '../data/models/catalogue_template.dart';
import '../data/models/credits_summary.dart';
import '../data/models/custom_background.dart';
import '../data/models/face_model.dart';
import '../data/models/garment_type.dart';
import '../data/models/gender.dart';
import '../data/models/pose_model.dart';
import '../data/models/pose_preset.dart';
import '../data/models/resolutions_config.dart';
import '../data/models/sample_video.dart';
import '../data/models/uploaded_asset.dart';
import 'studio_providers.dart';

typedef GenderAndGarmentType = ({Gender gender, String garmentTypeId});

final garmentTypesProvider = FutureProvider.family<List<GarmentType>, Gender>(
  (ref, gender) =>
      ref.watch(studioRepositoryProvider).garmentTypes(gender.apiValue),
);

final facesProvider = FutureProvider.family<List<FaceModel>, Gender>(
  (ref, gender) => ref.watch(studioRepositoryProvider).faces(gender.apiValue),
);

final backgroundsProvider =
    FutureProvider.family<List<BackgroundModel>, Gender>(
      (ref, gender) => ref
          .watch(studioRepositoryProvider)
          .backgrounds(gender: gender.apiValue),
    );

final backgroundCategoriesProvider =
    FutureProvider.family<List<BackgroundCategory>, Gender>(
      (ref, gender) => ref
          .watch(studioRepositoryProvider)
          .backgroundCategories(gender: gender.apiValue),
    );

final posesProvider =
    FutureProvider.family<List<PoseModel>, GenderAndGarmentType>(
      (ref, key) => ref
          .watch(studioRepositoryProvider)
          .poses(gender: key.gender.apiValue, garmentTypeId: key.garmentTypeId),
    );

final catalogueTemplatesProvider =
    FutureProvider.family<List<CatalogueTemplate>, GenderAndGarmentType>(
      (ref, key) => ref
          .watch(studioRepositoryProvider)
          .catalogueTemplates(
            gender: key.gender.apiValue,
            garmentTypeId: key.garmentTypeId,
          ),
    );

/// [poseIdsKey] is the selected pose IDs (custom mode) or template looks'
/// pose IDs (ready-made mode), sorted and comma-joined — a plain `String`
/// so this record has real structural equality for Riverpod's family
/// caching (a `List`/`Set` field wouldn't: two different instances with the
/// same elements aren't `==` in Dart).
///
/// The web app (studio/page.tsx) always sends this as a `poseIds` query
/// param, and forwarding it here is required, not optional: rereading
/// apps/api/src/modules/catalog/routes.ts (`/v1/catalog/:type`) shows empty
/// `poseIds` doesn't return "everything unfiltered" — it falls through to a
/// separate **legacy tree path** (the route's own comment: "for backwards
/// compat with items that still have categoryId") that buckets categories
/// by a `${gender}-` slug prefix convention and silently drops any item
/// whose category doesn't match that convention. A non-empty `poseIds` takes
/// the current, permissive path instead (active items for the type/gender,
/// gated only by whether any given pose supports a lower/shoe node). Never
/// forwarding `poseIds` — the previous state here — meant this client always
/// hit the stale legacy path while the web app almost always hit the current
/// one (poses are selected by the time Lower/Footwear are reachable), which
/// is what made lower/shoe items show on web but not here.
typedef GenderGarmentTypeAndPoses = ({
  Gender gender,
  String garmentTypeId,
  String poseIdsKey,
});

final lowerCatalogProvider =
    FutureProvider.family<CatalogTree, GenderGarmentTypeAndPoses>(
      (ref, key) => ref
          .watch(studioRepositoryProvider)
          .catalogTree(
            type: 'lower',
            gender: key.gender.apiValue,
            garmentTypeId: key.garmentTypeId,
            poseIds: key.poseIdsKey.isEmpty ? null : key.poseIdsKey.split(','),
          ),
    );

final shoeCatalogProvider =
    FutureProvider.family<CatalogTree, GenderGarmentTypeAndPoses>(
      (ref, key) => ref
          .watch(studioRepositoryProvider)
          .catalogTree(
            type: 'shoe',
            gender: key.gender.apiValue,
            garmentTypeId: key.garmentTypeId,
            poseIds: key.poseIdsKey.isEmpty ? null : key.poseIdsKey.split(','),
          ),
    );

final posePresetsProvider =
    FutureProvider.family<PosePresetsResponse, GenderAndGarmentType>(
      (ref, key) => ref
          .watch(studioRepositoryProvider)
          .posePresets(
            gender: key.gender.apiValue,
            garmentTypeId: key.garmentTypeId,
          ),
    );

final resolutionsConfigProvider = FutureProvider<ResolutionsConfig>(
  (ref) => ref.watch(studioRepositoryProvider).resolutions(),
);

/// The account's credit balance (`GET /v1/credits`, the same endpoint the web
/// app's header uses — `user_credits.balance` is the source of truth, updated
/// in the same transaction as every deduct/refund/grant).
///
/// Kept fresh three ways, since credits change server-side outside anything
/// this screen does (refunds on a failed job, top-ups, a grant from admin):
/// re-fetched every 30s while the app is being used, whenever the app comes
/// back to the foreground, and on demand via `ref.invalidate` right after
/// actions that spend credits. While a refresh is in flight the previous
/// balance stays visible.
final creditsSummaryProvider = FutureProvider<CreditsSummary>((ref) {
  final timer = Timer.periodic(
    const Duration(seconds: 30),
    (_) => ref.invalidateSelf(),
  );
  final lifecycle = AppLifecycleListener(onResume: ref.invalidateSelf);
  ref.onDispose(() {
    timer.cancel();
    lifecycle.dispose();
  });
  return ref.watch(studioRepositoryProvider).credits();
});

final sampleVideosProvider = FutureProvider<SampleVideosResponse>(
  (ref) => ref.watch(studioRepositoryProvider).sampleVideos(),
);

/// The user's own uploaded/imported backgrounds — refreshed (via
/// `ref.invalidate`) right after a successful upload.
final myBackgroundsProvider = FutureProvider<List<CustomBackground>>(
  (ref) => ref.watch(studioRepositoryProvider).myBackgrounds(),
);

final jobThumbnailUrlProvider = FutureProvider.family<String, String>((
  ref,
  jobId,
) async {
  final presigned = await ref
      .watch(studioRepositoryProvider)
      .jobThumbnail(jobId);
  return presigned.url;
});

final jobResultUrlProvider = FutureProvider.family<String, String>((
  ref,
  jobId,
) async {
  final presigned = await ref.watch(studioRepositoryProvider).jobResult(jobId);
  return presigned.url;
});

/// Completed catalogues, newest first — backs Motion Studio's
/// "Select Catalogue" source picker.
final userCataloguesProvider = FutureProvider<List<CatalogueSummary>>((
  ref,
) async {
  final catalogues = await ref.watch(studioRepositoryProvider).listCatalogues();
  return catalogues.where((c) => c.jobs.any((j) => j.isCompleted)).toList();
});

/// Every catalogue (any status), newest first — backs the My Creations grid,
/// which (unlike the Motion Studio source picker above) also needs to show
/// in-progress and failed jobs.
final allCataloguesProvider = FutureProvider<List<CatalogueSummary>>(
  (ref) => ref.watch(studioRepositoryProvider).listCatalogues(),
);

/// The account's catalog-video jobs — backs the My Creations grid. Catalog
/// video is an allowlist-gated feature server-side; an account it isn't
/// enabled for gets a 403, which reads as "no videos yet" rather than an
/// error banner.
final userCatalogVideosProvider = FutureProvider<List<CatalogVideoRow>>((
  ref,
) async {
  try {
    return await ref.watch(studioRepositoryProvider).catalogVideos();
  } on AppException catch (e) {
    return e.maybeWhen(
      forbidden: (_) => const <CatalogVideoRow>[],
      orElse: () => throw e,
    );
  }
});

/// The account's unique uploaded garment photos — backs the Products grid.
final userAssetsProvider = FutureProvider<List<UploadedAsset>>(
  (ref) => ref.watch(studioRepositoryProvider).assets(),
);

/// All selectable catalog options in one request via `GET /v1/dev/catalog/options`.
/// Keyed by `({Gender gender, String? garmentTypeSlug})`.
typedef CatalogOptionsKey = ({Gender gender, String? garmentTypeSlug});

final catalogOptionsProvider =
    FutureProvider.family<CatalogOptions, CatalogOptionsKey>(
      (ref, key) => ref
          .watch(studioRepositoryProvider)
          .catalogOptions(
            gender: key.gender.apiValue,
            garmentType: key.garmentTypeSlug,
          ),
    );
