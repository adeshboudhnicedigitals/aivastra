import 'package:freezed_annotation/freezed_annotation.dart';

import '../data/models/sample_video.dart';

part 'motion_selection_state.freezed.dart';

enum MotionMode { readyMade, createYourOwn }

@freezed
abstract class MotionSelectionState with _$MotionSelectionState {
  const factory MotionSelectionState({
    @Default(MotionMode.readyMade) MotionMode mode,
    SampleVideo? selectedSample,
    String? sourceImageKey,
    String? sourceJobId,
    @Default(false) bool isUploadingSource,
    @Default('') String prompt,
    @Default(10) int duration,
    @Default('720p') String quality,
    @Default(false) bool isSubmitting,
    String? errorMessage,
  }) = _MotionSelectionState;
}
