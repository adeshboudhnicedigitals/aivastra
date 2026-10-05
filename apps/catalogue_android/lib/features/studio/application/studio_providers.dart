import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/core_providers.dart';
import '../data/datasources/catalog_api.dart';
import '../data/datasources/config_api.dart';
import '../data/datasources/credits_api.dart';
import '../data/datasources/custom_backgrounds_api.dart';
import '../data/datasources/jobs_api.dart';
import '../data/datasources/motion_api.dart';
import '../data/datasources/pose_presets_api.dart';
import '../data/datasources/studio_reference_api.dart';
import '../data/datasources/upload_api.dart';
import '../data/repositories/studio_repository.dart';

final studioReferenceApiProvider = Provider(
  (ref) => StudioReferenceApi(ref.watch(dioProvider)),
);
final catalogApiProvider = Provider(
  (ref) => CatalogApi(ref.watch(dioProvider)),
);
final posePresetsApiProvider = Provider(
  (ref) => PosePresetsApi(ref.watch(dioProvider)),
);
final uploadApiProvider = Provider((ref) => UploadApi(ref.watch(dioProvider)));
final jobsApiProvider = Provider((ref) => JobsApi(ref.watch(dioProvider)));
final motionApiProvider = Provider((ref) => MotionApi(ref.watch(dioProvider)));
final configApiProvider = Provider((ref) => ConfigApi(ref.watch(dioProvider)));
final creditsApiProvider = Provider(
  (ref) => CreditsApi(ref.watch(dioProvider)),
);
final customBackgroundsApiProvider = Provider(
  (ref) => CustomBackgroundsApi(ref.watch(dioProvider)),
);

final studioRepositoryProvider = Provider<StudioRepository>((ref) {
  return StudioRepository(
    referenceApi: ref.watch(studioReferenceApiProvider),
    catalogApi: ref.watch(catalogApiProvider),
    posePresetsApi: ref.watch(posePresetsApiProvider),
    uploadApi: ref.watch(uploadApiProvider),
    jobsApi: ref.watch(jobsApiProvider),
    motionApi: ref.watch(motionApiProvider),
    configApi: ref.watch(configApiProvider),
    creditsApi: ref.watch(creditsApiProvider),
    customBackgroundsApi: ref.watch(customBackgroundsApiProvider),
  );
});
