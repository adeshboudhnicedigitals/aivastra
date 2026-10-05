// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sample_video.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_SampleVideo _$SampleVideoFromJson(Map<String, dynamic> json) => _SampleVideo(
  id: json['id'] as String,
  title: json['title'] as String,
  prompt: json['prompt'] as String,
  thumbnailUrl: json['thumbnailUrl'] as String,
  previewVideoUrl: json['previewVideoUrl'] as String,
  duration: (json['duration'] as num).toInt(),
  quality: json['quality'] as String,
  creditCost: (json['creditCost'] as num).toInt(),
);

Map<String, dynamic> _$SampleVideoToJson(_SampleVideo instance) =>
    <String, dynamic>{
      'id': instance.id,
      'title': instance.title,
      'prompt': instance.prompt,
      'thumbnailUrl': instance.thumbnailUrl,
      'previewVideoUrl': instance.previewVideoUrl,
      'duration': instance.duration,
      'quality': instance.quality,
      'creditCost': instance.creditCost,
    };

_PixversePricing _$PixversePricingFromJson(Map<String, dynamic> json) =>
    _PixversePricing(
      perSecondRate: json['perSecondRate'] == null
          ? 0
          : _lenientNum(json['perSecondRate']),
      qualityBase: json['qualityBase'] == null
          ? const {}
          : _lenientNumMap(json['qualityBase']),
    );

Map<String, dynamic> _$PixversePricingToJson(_PixversePricing instance) =>
    <String, dynamic>{
      'perSecondRate': instance.perSecondRate,
      'qualityBase': instance.qualityBase,
    };

_SampleVideosResponse _$SampleVideosResponseFromJson(
  Map<String, dynamic> json,
) => _SampleVideosResponse(
  items:
      (json['items'] as List<dynamic>?)
          ?.map((e) => SampleVideo.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  pixverseVideoPricing: json['pixverseVideoPricing'] == null
      ? null
      : PixversePricing.fromJson(
          json['pixverseVideoPricing'] as Map<String, dynamic>,
        ),
);

Map<String, dynamic> _$SampleVideosResponseToJson(
  _SampleVideosResponse instance,
) => <String, dynamic>{
  'items': instance.items,
  'pixverseVideoPricing': instance.pixverseVideoPricing,
};
