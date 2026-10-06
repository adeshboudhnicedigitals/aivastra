import 'package:freezed_annotation/freezed_annotation.dart';

part 'me_profile.freezed.dart';
part 'me_profile.g.dart';

@freezed
abstract class MeProfile with _$MeProfile {
  const factory MeProfile({
    required String id,
    String? email,
    String? displayName,
    String? phone,
    String? username,
    String? companyName,
    String? gstin,
    required String tier,
    String? defaultResolution,
    String? defaultAspectRatio,
    String? defaultPlatform,
    required bool hasPassword,
    required bool hasShopifyStore,
    required bool isMerchant,
    required bool catalogVideoEnabled,
  }) = _MeProfile;

  factory MeProfile.fromJson(Map<String, dynamic> json) =>
      _$MeProfileFromJson(json);
}
