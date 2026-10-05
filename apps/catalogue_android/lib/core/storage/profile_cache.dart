import 'package:hive/hive.dart';

/// Caches the raw `/v1/me` JSON so the profile screen has something to show
/// immediately on cold start while a fresh copy is fetched. Kept generic
/// (raw JSON string) so this storage layer has no dependency on feature
/// models — callers decode/encode with their own DTOs.
class ProfileCache {
  ProfileCache(this._box);

  static const boxName = 'profile_cache';
  static const _meKey = 'me_json';

  final Box<String> _box;

  String? readMeJson() => _box.get(_meKey);

  Future<void> saveMeJson(String json) => _box.put(_meKey, json);

  Future<void> clear() => _box.delete(_meKey);
}
