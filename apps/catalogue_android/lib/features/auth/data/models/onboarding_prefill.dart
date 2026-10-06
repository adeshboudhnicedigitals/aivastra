import 'package:freezed_annotation/freezed_annotation.dart';

part 'onboarding_prefill.freezed.dart';
part 'onboarding_prefill.g.dart';

@freezed
abstract class OnboardingPrefill with _$OnboardingPrefill {
  const factory OnboardingPrefill({
    String? suggestedContactName,
    String? suggestedCompanyName,
  }) = _OnboardingPrefill;

  factory OnboardingPrefill.fromJson(Map<String, dynamic> json) =>
      _$OnboardingPrefillFromJson(json);
}
