import 'package:freezed_annotation/freezed_annotation.dart';

part 'active_device_info.freezed.dart';
part 'active_device_info.g.dart';

@freezed
abstract class ActiveDeviceInfo with _$ActiveDeviceInfo {
  const factory ActiveDeviceInfo({
    required String id,
    required String platform,
    required String deviceId,
    String? deviceName,
    required String createdAt,
    required String expiresAt,
  }) = _ActiveDeviceInfo;

  factory ActiveDeviceInfo.fromJson(Map<String, dynamic> json) =>
      _$ActiveDeviceInfoFromJson(json);
}
