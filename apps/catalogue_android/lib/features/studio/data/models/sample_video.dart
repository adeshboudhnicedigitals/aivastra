import 'package:freezed_annotation/freezed_annotation.dart';

part 'sample_video.freezed.dart';
part 'sample_video.g.dart';

@freezed
abstract class SampleVideo with _$SampleVideo {
  const factory SampleVideo({
    required String id,
    required String title,
    required String prompt,
    required String thumbnailUrl,
    required String previewVideoUrl,
    required int duration,
    required String quality,
    required int creditCost,
  }) = _SampleVideo;

  factory SampleVideo.fromJson(Map<String, dynamic> json) =>
      _$SampleVideoFromJson(json);
}

/// Pricing is admin-edited config served back as-is (see
/// getPixverseVideoPricingConfig in apps/api), not a validated schema: a
/// number saved as a string ("10") or a tier left blank (null) reaches the
/// app verbatim. Read strictly, one such value failed the whole response and
/// Motion Studio showed "presets are unavailable" with nothing wrong with the
/// presets themselves. Numbers are read leniently and unreadable tiers are
/// dropped — the item's own server-computed `creditCost` is what's charged.
num _lenientNum(Object? value) => switch (value) {
  final num n => n,
  final String s => num.tryParse(s.trim()) ?? 0,
  _ => 0,
};

Map<String, num> _lenientNumMap(Object? value) {
  if (value is! Map) return const {};
  return {
    for (final entry in value.entries)
      if (entry.value is num || num.tryParse('${entry.value}') != null)
        '${entry.key}': _lenientNum(entry.value),
  };
}

@freezed
abstract class PixversePricing with _$PixversePricing {
  const factory PixversePricing({
    @JsonKey(fromJson: _lenientNum) @Default(0) num perSecondRate,
    @JsonKey(fromJson: _lenientNumMap) @Default({}) Map<String, num> qualityBase,
  }) = _PixversePricing;

  factory PixversePricing.fromJson(Map<String, dynamic> json) =>
      _$PixversePricingFromJson(json);
}

@freezed
abstract class SampleVideosResponse with _$SampleVideosResponse {
  const factory SampleVideosResponse({
    @Default([]) List<SampleVideo> items,
    PixversePricing? pixverseVideoPricing,
  }) = _SampleVideosResponse;

  factory SampleVideosResponse.fromJson(Map<String, dynamic> json) =>
      _$SampleVideosResponseFromJson(json);
}
