/// App-wide, environment-dependent configuration.
///
/// Select the environment at build/run time with:
///   flutter run --dart-define=APP_ENV=staging
/// Defaults to production when not specified.
enum Environment { production, staging }

class AppConfig {
  AppConfig._();

  static const _envName = String.fromEnvironment(
    'APP_ENV',
    defaultValue: 'production',
  );

  static final Environment environment = _envName == 'staging'
      ? Environment.staging
      : Environment.production;

  static String get baseUrl => switch (environment) {
    Environment.production => 'https://app.aivastra.com',
    Environment.staging => 'https://staging-admin.aivastra.com',
  };

  /// The web app (catalogues-web) - where checkout lives. Distinct from
  /// [baseUrl] on staging, where the API/admin and the web app are separate
  /// hostnames.
  static String get webUrl => switch (environment) {
    Environment.production => 'https://app.aivastra.com',
    Environment.staging => 'https://staging-app.aivastra.com',
  };

  /// Google OAuth "Web application" client ID, used as `serverClientId` for
  /// Credential Manager's GetGoogleIdOption on Android and as the iOS/web
  /// client id. The exact same client id the backend verifies the Google ID
  /// token's `aud` claim against (GOOGLE_CLIENT_ID in apps/api) — reused from
  /// apps/virtual_tryon_android's GoogleSignInHelper.kt (same Google Cloud
  /// project, already proven working there). Also requires a matching
  /// "Android" OAuth client in that same project, registered under package
  /// `com.nice.aivastracatalogue` with the signing certificate's SHA-1 (a
  /// separate entry per signing key — debug and the release
  /// upload-keystore.jks each need their own).
  static const String googleWebClientId =
      '35415564946-g67lkjr3oso891lovqjaffqfd3gbhllq.apps.googleusercontent.com';

  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 20);
}
