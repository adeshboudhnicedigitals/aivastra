import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:uuid/uuid.dart';

import '../storage/local_prefs.dart';

/// Builds the stable per-install [deviceId] (a UUID, persisted once) and a
/// human-readable [deviceName] for the device-login family of endpoints.
class DeviceInfoHelper {
  DeviceInfoHelper(this._prefs);

  final LocalPrefs _prefs;
  static const _uuid = Uuid();

  Future<String> resolveDeviceId() async {
    final existing = _prefs.deviceId;
    if (existing != null) return existing;
    final generated = _uuid.v4();
    await _prefs.setDeviceId(generated);
    return generated;
  }

  Future<String> resolveDeviceName() async {
    final plugin = DeviceInfoPlugin();
    try {
      if (Platform.isAndroid) {
        final info = await plugin.androidInfo;
        return '${info.manufacturer} ${info.model}'.trim();
      }
      if (Platform.isIOS) {
        final info = await plugin.iosInfo;
        return info.utsname.machine;
      }
      if (Platform.isWindows) {
        final info = await plugin.windowsInfo;
        return info.computerName;
      }
      if (Platform.isMacOS) {
        final info = await plugin.macOsInfo;
        return info.computerName;
      }
      if (Platform.isLinux) {
        final info = await plugin.linuxInfo;
        return info.name;
      }
    } catch (_) {
      // Fall through to a generic name below.
    }
    return Platform.operatingSystem;
  }
}
