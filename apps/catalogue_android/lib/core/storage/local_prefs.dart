import 'package:shared_preferences/shared_preferences.dart';

/// Small, non-sensitive local flags/values.
class LocalPrefs {
  LocalPrefs(this._prefs);

  final SharedPreferences _prefs;

  static const _onboardingSeenKey = 'onboarding_seen';
  static const _deviceIdKey = 'device_id';
  static const _studioTutorialSeenKey = 'studio_tutorial_seen';

  bool get onboardingSeen => _prefs.getBool(_onboardingSeenKey) ?? false;

  Future<void> setOnboardingSeen() => _prefs.setBool(_onboardingSeenKey, true);

  /// The first-open spotlight walkthrough on the Studio form (Catalogue For
  /// → Garment Type → Upload → Generate) — separate from [onboardingSeen],
  /// which is the pre-login slides.
  bool get studioTutorialSeen =>
      _prefs.getBool(_studioTutorialSeenKey) ?? false;

  Future<void> setStudioTutorialSeen() =>
      _prefs.setBool(_studioTutorialSeenKey, true);

  String? get deviceId => _prefs.getString(_deviceIdKey);

  Future<void> setDeviceId(String id) => _prefs.setString(_deviceIdKey, id);
}
