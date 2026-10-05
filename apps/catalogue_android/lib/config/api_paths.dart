class ApiPaths {
  ApiPaths._();

  static const register = '/v1/auth/register';
  static const verifyEmail = '/v1/auth/verify-email';
  static const resendVerification = '/v1/auth/resend-verification';
  static const deviceLogin = '/v1/auth/device-login';
  static const deviceLoginForce = '/v1/auth/device-login/force';
  static const deviceLoginGoogle = '/v1/auth/device-login/google';
  static const deviceRefresh = '/v1/auth/device-refresh';
  static const deviceLogout = '/v1/auth/device-logout';
  static const forgotPassword = '/v1/auth/forgot-password';
  static const resetPassword = '/v1/auth/reset-password';
  static const me = '/v1/me';
  static const paymentPlans = '/v1/payments/plans';
  static const contact = '/v1/contact';
  static const paymentHistory = '/v1/payments/history';
  static const mePassword = '/v1/me/password';

  // Studio reference data
  static const catalogOptions = '/v1/dev/catalog/options';
  static const garmentTypes = '/v1/models/garment-types';
  static const faces = '/v1/models/faces';
  static const backgrounds = '/v1/models/backgrounds';
  static const backgroundCategories = '/v1/models/background-categories';
  static const poses = '/v1/models/poses';
  static const catalogueTemplates = '/v1/models/catalogue-templates';
  static const sampleVideos = '/v1/models/sample-videos';

  static const posePresets = '/v1/pose-presets';
  static String posePreset(String id) => '/v1/pose-presets/$id';

  static String catalog(String type) => '/v1/catalog/$type';

  static const uploadsPresign = '/v1/uploads/presign';

  static const backgroundsMine = '/v1/backgrounds/mine';
  static const backgroundsMinePresign = '/v1/backgrounds/mine/presign';
  static const backgroundsMineConfirm = '/v1/backgrounds/mine/confirm';
  static const backgroundsMineFromUrl = '/v1/backgrounds/mine/from-url';
  static String backgroundMine(String id) => '/v1/backgrounds/mine/$id';

  static const jobsTryon = '/v1/jobs/tryon';
  static const jobsBatch = '/v1/jobs/batch';
  static const jobsSareeMannequin = '/v1/jobs/saree-mannequin';
  static const catalogueVideoJob = '/v1/jobs/catalog-video';

  static const catalogues = '/v1/catalogues';
  static String catalogue(String id) => '/v1/catalogues/$id';

  static const jobs = '/v1/jobs';
  static String job(String id) => '/v1/jobs/$id';
  static String jobResult(String id) => '/v1/jobs/$id/result';
  static String jobThumbnail(String id) => '/v1/jobs/$id/thumbnail';
  static String jobDownload(String id) => '/v1/jobs/$id/download';
  static String jobCancel(String id) => '/v1/jobs/$id/cancel';
  static String jobRegenerateReasons(String id) =>
      '/v1/jobs/$id/regenerate-reasons';
  static String jobRegenerate(String id) => '/v1/jobs/$id/regenerate';

  static const assets = '/v1/assets';
  static String batch(String id) => '/v1/batches/$id';

  static const catalogVideos = '/v1/catalog-videos';

  static const configResolutions = '/v1/config/resolutions';
  static const credits = '/v1/credits';
  static const tryonGarmentImages = '/v1/tryon/garment-images';
}
