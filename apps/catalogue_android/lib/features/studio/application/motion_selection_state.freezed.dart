// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'motion_selection_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$MotionSelectionState {

 MotionMode get mode; SampleVideo? get selectedSample; String? get sourceImageKey; String? get sourceJobId; bool get isUploadingSource; String get prompt; int get duration; String get quality; bool get isSubmitting; String? get errorMessage;
/// Create a copy of MotionSelectionState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MotionSelectionStateCopyWith<MotionSelectionState> get copyWith => _$MotionSelectionStateCopyWithImpl<MotionSelectionState>(this as MotionSelectionState, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as MotionSelectionState;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is MotionSelectionState&&(identical(other.mode, _this.mode) || other.mode == _this.mode)&&(identical(other.selectedSample, _this.selectedSample) || other.selectedSample == _this.selectedSample)&&(identical(other.sourceImageKey, _this.sourceImageKey) || other.sourceImageKey == _this.sourceImageKey)&&(identical(other.sourceJobId, _this.sourceJobId) || other.sourceJobId == _this.sourceJobId)&&(identical(other.isUploadingSource, _this.isUploadingSource) || other.isUploadingSource == _this.isUploadingSource)&&(identical(other.prompt, _this.prompt) || other.prompt == _this.prompt)&&(identical(other.duration, _this.duration) || other.duration == _this.duration)&&(identical(other.quality, _this.quality) || other.quality == _this.quality)&&(identical(other.isSubmitting, _this.isSubmitting) || other.isSubmitting == _this.isSubmitting)&&(identical(other.errorMessage, _this.errorMessage) || other.errorMessage == _this.errorMessage));
}


@override
int get hashCode {
  final _this = this as MotionSelectionState;
  return Object.hash(runtimeType,_this.mode,_this.selectedSample,_this.sourceImageKey,_this.sourceJobId,_this.isUploadingSource,_this.prompt,_this.duration,_this.quality,_this.isSubmitting,_this.errorMessage);
}

@override
String toString() {
  final _this = this as MotionSelectionState;
  return 'MotionSelectionState(mode: ${_this.mode}, selectedSample: ${_this.selectedSample}, sourceImageKey: ${_this.sourceImageKey}, sourceJobId: ${_this.sourceJobId}, isUploadingSource: ${_this.isUploadingSource}, prompt: ${_this.prompt}, duration: ${_this.duration}, quality: ${_this.quality}, isSubmitting: ${_this.isSubmitting}, errorMessage: ${_this.errorMessage})';
}


}

/// @nodoc
abstract mixin class $MotionSelectionStateCopyWith<$Res>  {
  factory $MotionSelectionStateCopyWith(MotionSelectionState value, $Res Function(MotionSelectionState) _then) = _$MotionSelectionStateCopyWithImpl;
@useResult
$Res call({
 MotionMode mode, SampleVideo? selectedSample, String? sourceImageKey, String? sourceJobId, bool isUploadingSource, String prompt, int duration, String quality, bool isSubmitting, String? errorMessage
});


$SampleVideoCopyWith<$Res>? get selectedSample;

}
/// @nodoc
class _$MotionSelectionStateCopyWithImpl<$Res>
    implements $MotionSelectionStateCopyWith<$Res> {
  _$MotionSelectionStateCopyWithImpl(this._self, this._then);

  final MotionSelectionState _self;
  final $Res Function(MotionSelectionState) _then;

/// Create a copy of MotionSelectionState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? mode = null,Object? selectedSample = freezed,Object? sourceImageKey = freezed,Object? sourceJobId = freezed,Object? isUploadingSource = null,Object? prompt = null,Object? duration = null,Object? quality = null,Object? isSubmitting = null,Object? errorMessage = freezed,}) {
  return _then(MotionSelectionState(
mode: null == mode ? _self.mode : mode // ignore: cast_nullable_to_non_nullable
as MotionMode,selectedSample: freezed == selectedSample ? _self.selectedSample : selectedSample // ignore: cast_nullable_to_non_nullable
as SampleVideo?,sourceImageKey: freezed == sourceImageKey ? _self.sourceImageKey : sourceImageKey // ignore: cast_nullable_to_non_nullable
as String?,sourceJobId: freezed == sourceJobId ? _self.sourceJobId : sourceJobId // ignore: cast_nullable_to_non_nullable
as String?,isUploadingSource: null == isUploadingSource ? _self.isUploadingSource : isUploadingSource // ignore: cast_nullable_to_non_nullable
as bool,prompt: null == prompt ? _self.prompt : prompt // ignore: cast_nullable_to_non_nullable
as String,duration: null == duration ? _self.duration : duration // ignore: cast_nullable_to_non_nullable
as int,quality: null == quality ? _self.quality : quality // ignore: cast_nullable_to_non_nullable
as String,isSubmitting: null == isSubmitting ? _self.isSubmitting : isSubmitting // ignore: cast_nullable_to_non_nullable
as bool,errorMessage: freezed == errorMessage ? _self.errorMessage : errorMessage // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}
/// Create a copy of MotionSelectionState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$SampleVideoCopyWith<$Res>? get selectedSample {
    if (_self.selectedSample == null) {
    return null;
  }

  return $SampleVideoCopyWith<$Res>(_self.selectedSample!, (value) {
    return _then(_self.copyWith(selectedSample: value));
  });
}
}


/// Adds pattern-matching-related methods to [MotionSelectionState].
extension MotionSelectionStatePatterns on MotionSelectionState {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _MotionSelectionState value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _MotionSelectionState() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _MotionSelectionState value)  $default,){
final _that = this;
switch (_that) {
case _MotionSelectionState():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _MotionSelectionState value)?  $default,){
final _that = this;
switch (_that) {
case _MotionSelectionState() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( MotionMode mode,  SampleVideo? selectedSample,  String? sourceImageKey,  String? sourceJobId,  bool isUploadingSource,  String prompt,  int duration,  String quality,  bool isSubmitting,  String? errorMessage)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _MotionSelectionState() when $default != null:
return $default(_that.mode,_that.selectedSample,_that.sourceImageKey,_that.sourceJobId,_that.isUploadingSource,_that.prompt,_that.duration,_that.quality,_that.isSubmitting,_that.errorMessage);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( MotionMode mode,  SampleVideo? selectedSample,  String? sourceImageKey,  String? sourceJobId,  bool isUploadingSource,  String prompt,  int duration,  String quality,  bool isSubmitting,  String? errorMessage)  $default,) {final _that = this;
switch (_that) {
case _MotionSelectionState():
return $default(_that.mode,_that.selectedSample,_that.sourceImageKey,_that.sourceJobId,_that.isUploadingSource,_that.prompt,_that.duration,_that.quality,_that.isSubmitting,_that.errorMessage);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( MotionMode mode,  SampleVideo? selectedSample,  String? sourceImageKey,  String? sourceJobId,  bool isUploadingSource,  String prompt,  int duration,  String quality,  bool isSubmitting,  String? errorMessage)?  $default,) {final _that = this;
switch (_that) {
case _MotionSelectionState() when $default != null:
return $default(_that.mode,_that.selectedSample,_that.sourceImageKey,_that.sourceJobId,_that.isUploadingSource,_that.prompt,_that.duration,_that.quality,_that.isSubmitting,_that.errorMessage);case _:
  return null;

}
}

}

/// @nodoc


class _MotionSelectionState implements MotionSelectionState {
  const _MotionSelectionState({this.mode = MotionMode.readyMade, this.selectedSample, this.sourceImageKey, this.sourceJobId, this.isUploadingSource = false, this.prompt = '', this.duration = 10, this.quality = '720p', this.isSubmitting = false, this.errorMessage});
  

@override@JsonKey() final  MotionMode mode;
@override final  SampleVideo? selectedSample;
@override final  String? sourceImageKey;
@override final  String? sourceJobId;
@override@JsonKey() final  bool isUploadingSource;
@override@JsonKey() final  String prompt;
@override@JsonKey() final  int duration;
@override@JsonKey() final  String quality;
@override@JsonKey() final  bool isSubmitting;
@override final  String? errorMessage;

/// Create a copy of MotionSelectionState
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$MotionSelectionStateCopyWith<_MotionSelectionState> get copyWith => __$MotionSelectionStateCopyWithImpl<_MotionSelectionState>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _MotionSelectionState&&(identical(other.mode, mode) || other.mode == mode)&&(identical(other.selectedSample, selectedSample) || other.selectedSample == selectedSample)&&(identical(other.sourceImageKey, sourceImageKey) || other.sourceImageKey == sourceImageKey)&&(identical(other.sourceJobId, sourceJobId) || other.sourceJobId == sourceJobId)&&(identical(other.isUploadingSource, isUploadingSource) || other.isUploadingSource == isUploadingSource)&&(identical(other.prompt, prompt) || other.prompt == prompt)&&(identical(other.duration, duration) || other.duration == duration)&&(identical(other.quality, quality) || other.quality == quality)&&(identical(other.isSubmitting, isSubmitting) || other.isSubmitting == isSubmitting)&&(identical(other.errorMessage, errorMessage) || other.errorMessage == errorMessage));
}


@override
int get hashCode {
    return Object.hash(runtimeType,mode,selectedSample,sourceImageKey,sourceJobId,isUploadingSource,prompt,duration,quality,isSubmitting,errorMessage);
}

@override
String toString() {
    return 'MotionSelectionState(mode: $mode, selectedSample: $selectedSample, sourceImageKey: $sourceImageKey, sourceJobId: $sourceJobId, isUploadingSource: $isUploadingSource, prompt: $prompt, duration: $duration, quality: $quality, isSubmitting: $isSubmitting, errorMessage: $errorMessage)';
}


}

/// @nodoc
abstract mixin class _$MotionSelectionStateCopyWith<$Res> implements $MotionSelectionStateCopyWith<$Res> {
  factory _$MotionSelectionStateCopyWith(_MotionSelectionState value, $Res Function(_MotionSelectionState) _then) = __$MotionSelectionStateCopyWithImpl;
@override @useResult
$Res call({
 MotionMode mode, SampleVideo? selectedSample, String? sourceImageKey, String? sourceJobId, bool isUploadingSource, String prompt, int duration, String quality, bool isSubmitting, String? errorMessage
});


@override $SampleVideoCopyWith<$Res>? get selectedSample;

}
/// @nodoc
class __$MotionSelectionStateCopyWithImpl<$Res>
    implements _$MotionSelectionStateCopyWith<$Res> {
  __$MotionSelectionStateCopyWithImpl(this._self, this._then);

  final _MotionSelectionState _self;
  final $Res Function(_MotionSelectionState) _then;

/// Create a copy of MotionSelectionState
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? mode = null,Object? selectedSample = freezed,Object? sourceImageKey = freezed,Object? sourceJobId = freezed,Object? isUploadingSource = null,Object? prompt = null,Object? duration = null,Object? quality = null,Object? isSubmitting = null,Object? errorMessage = freezed,}) {
  return _then(_MotionSelectionState(
mode: null == mode ? _self.mode : mode // ignore: cast_nullable_to_non_nullable
as MotionMode,selectedSample: freezed == selectedSample ? _self.selectedSample : selectedSample // ignore: cast_nullable_to_non_nullable
as SampleVideo?,sourceImageKey: freezed == sourceImageKey ? _self.sourceImageKey : sourceImageKey // ignore: cast_nullable_to_non_nullable
as String?,sourceJobId: freezed == sourceJobId ? _self.sourceJobId : sourceJobId // ignore: cast_nullable_to_non_nullable
as String?,isUploadingSource: null == isUploadingSource ? _self.isUploadingSource : isUploadingSource // ignore: cast_nullable_to_non_nullable
as bool,prompt: null == prompt ? _self.prompt : prompt // ignore: cast_nullable_to_non_nullable
as String,duration: null == duration ? _self.duration : duration // ignore: cast_nullable_to_non_nullable
as int,quality: null == quality ? _self.quality : quality // ignore: cast_nullable_to_non_nullable
as String,isSubmitting: null == isSubmitting ? _self.isSubmitting : isSubmitting // ignore: cast_nullable_to_non_nullable
as bool,errorMessage: freezed == errorMessage ? _self.errorMessage : errorMessage // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

/// Create a copy of MotionSelectionState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$SampleVideoCopyWith<$Res>? get selectedSample {
    if (_self.selectedSample == null) {
    return null;
  }

  return $SampleVideoCopyWith<$Res>(_self.selectedSample!, (value) {
    return _then(_self.copyWith(selectedSample: value));
  });
}
}

// dart format on
