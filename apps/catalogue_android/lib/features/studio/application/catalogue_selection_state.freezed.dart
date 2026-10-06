// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'catalogue_selection_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$CatalogueSelectionState {

 Gender get gender; GarmentType? get garmentType; String? get upperGarmentKey; String? get lowerGarmentKey; String? get thirdGarmentKey; String? get palluGarmentKey; bool get isUploadingUpper; bool get isUploadingLower; bool get isUploadingThird; bool get isUploadingPallu; bool get isUploadingBackground; LookMode get lookMode; String? get faceId; CatalogueTemplate? get selectedTemplate; Set<String> get selectedLookIds; String? get backgroundId; Set<String> get poseIds; String? get lowerCatalogItemId; String? get shoeCatalogItemId; String get platform; String get aspectRatio; String get resolution; bool get posePresetPrefilled; bool get isSubmitting; String? get errorMessage;
/// Create a copy of CatalogueSelectionState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogueSelectionStateCopyWith<CatalogueSelectionState> get copyWith => _$CatalogueSelectionStateCopyWithImpl<CatalogueSelectionState>(this as CatalogueSelectionState, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as CatalogueSelectionState;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogueSelectionState&&(identical(other.gender, _this.gender) || other.gender == _this.gender)&&(identical(other.garmentType, _this.garmentType) || other.garmentType == _this.garmentType)&&(identical(other.upperGarmentKey, _this.upperGarmentKey) || other.upperGarmentKey == _this.upperGarmentKey)&&(identical(other.lowerGarmentKey, _this.lowerGarmentKey) || other.lowerGarmentKey == _this.lowerGarmentKey)&&(identical(other.thirdGarmentKey, _this.thirdGarmentKey) || other.thirdGarmentKey == _this.thirdGarmentKey)&&(identical(other.palluGarmentKey, _this.palluGarmentKey) || other.palluGarmentKey == _this.palluGarmentKey)&&(identical(other.isUploadingUpper, _this.isUploadingUpper) || other.isUploadingUpper == _this.isUploadingUpper)&&(identical(other.isUploadingLower, _this.isUploadingLower) || other.isUploadingLower == _this.isUploadingLower)&&(identical(other.isUploadingThird, _this.isUploadingThird) || other.isUploadingThird == _this.isUploadingThird)&&(identical(other.isUploadingPallu, _this.isUploadingPallu) || other.isUploadingPallu == _this.isUploadingPallu)&&(identical(other.isUploadingBackground, _this.isUploadingBackground) || other.isUploadingBackground == _this.isUploadingBackground)&&(identical(other.lookMode, _this.lookMode) || other.lookMode == _this.lookMode)&&(identical(other.faceId, _this.faceId) || other.faceId == _this.faceId)&&(identical(other.selectedTemplate, _this.selectedTemplate) || other.selectedTemplate == _this.selectedTemplate)&&const DeepCollectionEquality().equals(other.selectedLookIds, _this.selectedLookIds)&&(identical(other.backgroundId, _this.backgroundId) || other.backgroundId == _this.backgroundId)&&const DeepCollectionEquality().equals(other.poseIds, _this.poseIds)&&(identical(other.lowerCatalogItemId, _this.lowerCatalogItemId) || other.lowerCatalogItemId == _this.lowerCatalogItemId)&&(identical(other.shoeCatalogItemId, _this.shoeCatalogItemId) || other.shoeCatalogItemId == _this.shoeCatalogItemId)&&(identical(other.platform, _this.platform) || other.platform == _this.platform)&&(identical(other.aspectRatio, _this.aspectRatio) || other.aspectRatio == _this.aspectRatio)&&(identical(other.resolution, _this.resolution) || other.resolution == _this.resolution)&&(identical(other.posePresetPrefilled, _this.posePresetPrefilled) || other.posePresetPrefilled == _this.posePresetPrefilled)&&(identical(other.isSubmitting, _this.isSubmitting) || other.isSubmitting == _this.isSubmitting)&&(identical(other.errorMessage, _this.errorMessage) || other.errorMessage == _this.errorMessage));
}


@override
int get hashCode {
  final _this = this as CatalogueSelectionState;
  return Object.hashAll([runtimeType,_this.gender,_this.garmentType,_this.upperGarmentKey,_this.lowerGarmentKey,_this.thirdGarmentKey,_this.palluGarmentKey,_this.isUploadingUpper,_this.isUploadingLower,_this.isUploadingThird,_this.isUploadingPallu,_this.isUploadingBackground,_this.lookMode,_this.faceId,_this.selectedTemplate,const DeepCollectionEquality().hash(_this.selectedLookIds),_this.backgroundId,const DeepCollectionEquality().hash(_this.poseIds),_this.lowerCatalogItemId,_this.shoeCatalogItemId,_this.platform,_this.aspectRatio,_this.resolution,_this.posePresetPrefilled,_this.isSubmitting,_this.errorMessage]);
}

@override
String toString() {
  final _this = this as CatalogueSelectionState;
  return 'CatalogueSelectionState(gender: ${_this.gender}, garmentType: ${_this.garmentType}, upperGarmentKey: ${_this.upperGarmentKey}, lowerGarmentKey: ${_this.lowerGarmentKey}, thirdGarmentKey: ${_this.thirdGarmentKey}, palluGarmentKey: ${_this.palluGarmentKey}, isUploadingUpper: ${_this.isUploadingUpper}, isUploadingLower: ${_this.isUploadingLower}, isUploadingThird: ${_this.isUploadingThird}, isUploadingPallu: ${_this.isUploadingPallu}, isUploadingBackground: ${_this.isUploadingBackground}, lookMode: ${_this.lookMode}, faceId: ${_this.faceId}, selectedTemplate: ${_this.selectedTemplate}, selectedLookIds: ${_this.selectedLookIds}, backgroundId: ${_this.backgroundId}, poseIds: ${_this.poseIds}, lowerCatalogItemId: ${_this.lowerCatalogItemId}, shoeCatalogItemId: ${_this.shoeCatalogItemId}, platform: ${_this.platform}, aspectRatio: ${_this.aspectRatio}, resolution: ${_this.resolution}, posePresetPrefilled: ${_this.posePresetPrefilled}, isSubmitting: ${_this.isSubmitting}, errorMessage: ${_this.errorMessage})';
}


}

/// @nodoc
abstract mixin class $CatalogueSelectionStateCopyWith<$Res>  {
  factory $CatalogueSelectionStateCopyWith(CatalogueSelectionState value, $Res Function(CatalogueSelectionState) _then) = _$CatalogueSelectionStateCopyWithImpl;
@useResult
$Res call({
 Gender gender, GarmentType? garmentType, String? upperGarmentKey, String? lowerGarmentKey, String? thirdGarmentKey, String? palluGarmentKey, bool isUploadingUpper, bool isUploadingLower, bool isUploadingThird, bool isUploadingPallu, bool isUploadingBackground, LookMode lookMode, String? faceId, CatalogueTemplate? selectedTemplate, Set<String> selectedLookIds, String? backgroundId, Set<String> poseIds, String? lowerCatalogItemId, String? shoeCatalogItemId, String platform, String aspectRatio, String resolution, bool posePresetPrefilled, bool isSubmitting, String? errorMessage
});


$GarmentTypeCopyWith<$Res>? get garmentType;$CatalogueTemplateCopyWith<$Res>? get selectedTemplate;

}
/// @nodoc
class _$CatalogueSelectionStateCopyWithImpl<$Res>
    implements $CatalogueSelectionStateCopyWith<$Res> {
  _$CatalogueSelectionStateCopyWithImpl(this._self, this._then);

  final CatalogueSelectionState _self;
  final $Res Function(CatalogueSelectionState) _then;

/// Create a copy of CatalogueSelectionState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? gender = null,Object? garmentType = freezed,Object? upperGarmentKey = freezed,Object? lowerGarmentKey = freezed,Object? thirdGarmentKey = freezed,Object? palluGarmentKey = freezed,Object? isUploadingUpper = null,Object? isUploadingLower = null,Object? isUploadingThird = null,Object? isUploadingPallu = null,Object? isUploadingBackground = null,Object? lookMode = null,Object? faceId = freezed,Object? selectedTemplate = freezed,Object? selectedLookIds = null,Object? backgroundId = freezed,Object? poseIds = null,Object? lowerCatalogItemId = freezed,Object? shoeCatalogItemId = freezed,Object? platform = null,Object? aspectRatio = null,Object? resolution = null,Object? posePresetPrefilled = null,Object? isSubmitting = null,Object? errorMessage = freezed,}) {
  return _then(CatalogueSelectionState(
gender: null == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as Gender,garmentType: freezed == garmentType ? _self.garmentType : garmentType // ignore: cast_nullable_to_non_nullable
as GarmentType?,upperGarmentKey: freezed == upperGarmentKey ? _self.upperGarmentKey : upperGarmentKey // ignore: cast_nullable_to_non_nullable
as String?,lowerGarmentKey: freezed == lowerGarmentKey ? _self.lowerGarmentKey : lowerGarmentKey // ignore: cast_nullable_to_non_nullable
as String?,thirdGarmentKey: freezed == thirdGarmentKey ? _self.thirdGarmentKey : thirdGarmentKey // ignore: cast_nullable_to_non_nullable
as String?,palluGarmentKey: freezed == palluGarmentKey ? _self.palluGarmentKey : palluGarmentKey // ignore: cast_nullable_to_non_nullable
as String?,isUploadingUpper: null == isUploadingUpper ? _self.isUploadingUpper : isUploadingUpper // ignore: cast_nullable_to_non_nullable
as bool,isUploadingLower: null == isUploadingLower ? _self.isUploadingLower : isUploadingLower // ignore: cast_nullable_to_non_nullable
as bool,isUploadingThird: null == isUploadingThird ? _self.isUploadingThird : isUploadingThird // ignore: cast_nullable_to_non_nullable
as bool,isUploadingPallu: null == isUploadingPallu ? _self.isUploadingPallu : isUploadingPallu // ignore: cast_nullable_to_non_nullable
as bool,isUploadingBackground: null == isUploadingBackground ? _self.isUploadingBackground : isUploadingBackground // ignore: cast_nullable_to_non_nullable
as bool,lookMode: null == lookMode ? _self.lookMode : lookMode // ignore: cast_nullable_to_non_nullable
as LookMode,faceId: freezed == faceId ? _self.faceId : faceId // ignore: cast_nullable_to_non_nullable
as String?,selectedTemplate: freezed == selectedTemplate ? _self.selectedTemplate : selectedTemplate // ignore: cast_nullable_to_non_nullable
as CatalogueTemplate?,selectedLookIds: null == selectedLookIds ? _self.selectedLookIds : selectedLookIds // ignore: cast_nullable_to_non_nullable
as Set<String>,backgroundId: freezed == backgroundId ? _self.backgroundId : backgroundId // ignore: cast_nullable_to_non_nullable
as String?,poseIds: null == poseIds ? _self.poseIds : poseIds // ignore: cast_nullable_to_non_nullable
as Set<String>,lowerCatalogItemId: freezed == lowerCatalogItemId ? _self.lowerCatalogItemId : lowerCatalogItemId // ignore: cast_nullable_to_non_nullable
as String?,shoeCatalogItemId: freezed == shoeCatalogItemId ? _self.shoeCatalogItemId : shoeCatalogItemId // ignore: cast_nullable_to_non_nullable
as String?,platform: null == platform ? _self.platform : platform // ignore: cast_nullable_to_non_nullable
as String,aspectRatio: null == aspectRatio ? _self.aspectRatio : aspectRatio // ignore: cast_nullable_to_non_nullable
as String,resolution: null == resolution ? _self.resolution : resolution // ignore: cast_nullable_to_non_nullable
as String,posePresetPrefilled: null == posePresetPrefilled ? _self.posePresetPrefilled : posePresetPrefilled // ignore: cast_nullable_to_non_nullable
as bool,isSubmitting: null == isSubmitting ? _self.isSubmitting : isSubmitting // ignore: cast_nullable_to_non_nullable
as bool,errorMessage: freezed == errorMessage ? _self.errorMessage : errorMessage // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}
/// Create a copy of CatalogueSelectionState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GarmentTypeCopyWith<$Res>? get garmentType {
    if (_self.garmentType == null) {
    return null;
  }

  return $GarmentTypeCopyWith<$Res>(_self.garmentType!, (value) {
    return _then(_self.copyWith(garmentType: value));
  });
}/// Create a copy of CatalogueSelectionState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$CatalogueTemplateCopyWith<$Res>? get selectedTemplate {
    if (_self.selectedTemplate == null) {
    return null;
  }

  return $CatalogueTemplateCopyWith<$Res>(_self.selectedTemplate!, (value) {
    return _then(_self.copyWith(selectedTemplate: value));
  });
}
}


/// Adds pattern-matching-related methods to [CatalogueSelectionState].
extension CatalogueSelectionStatePatterns on CatalogueSelectionState {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogueSelectionState value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogueSelectionState() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogueSelectionState value)  $default,){
final _that = this;
switch (_that) {
case _CatalogueSelectionState():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogueSelectionState value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogueSelectionState() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( Gender gender,  GarmentType? garmentType,  String? upperGarmentKey,  String? lowerGarmentKey,  String? thirdGarmentKey,  String? palluGarmentKey,  bool isUploadingUpper,  bool isUploadingLower,  bool isUploadingThird,  bool isUploadingPallu,  bool isUploadingBackground,  LookMode lookMode,  String? faceId,  CatalogueTemplate? selectedTemplate,  Set<String> selectedLookIds,  String? backgroundId,  Set<String> poseIds,  String? lowerCatalogItemId,  String? shoeCatalogItemId,  String platform,  String aspectRatio,  String resolution,  bool posePresetPrefilled,  bool isSubmitting,  String? errorMessage)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogueSelectionState() when $default != null:
return $default(_that.gender,_that.garmentType,_that.upperGarmentKey,_that.lowerGarmentKey,_that.thirdGarmentKey,_that.palluGarmentKey,_that.isUploadingUpper,_that.isUploadingLower,_that.isUploadingThird,_that.isUploadingPallu,_that.isUploadingBackground,_that.lookMode,_that.faceId,_that.selectedTemplate,_that.selectedLookIds,_that.backgroundId,_that.poseIds,_that.lowerCatalogItemId,_that.shoeCatalogItemId,_that.platform,_that.aspectRatio,_that.resolution,_that.posePresetPrefilled,_that.isSubmitting,_that.errorMessage);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( Gender gender,  GarmentType? garmentType,  String? upperGarmentKey,  String? lowerGarmentKey,  String? thirdGarmentKey,  String? palluGarmentKey,  bool isUploadingUpper,  bool isUploadingLower,  bool isUploadingThird,  bool isUploadingPallu,  bool isUploadingBackground,  LookMode lookMode,  String? faceId,  CatalogueTemplate? selectedTemplate,  Set<String> selectedLookIds,  String? backgroundId,  Set<String> poseIds,  String? lowerCatalogItemId,  String? shoeCatalogItemId,  String platform,  String aspectRatio,  String resolution,  bool posePresetPrefilled,  bool isSubmitting,  String? errorMessage)  $default,) {final _that = this;
switch (_that) {
case _CatalogueSelectionState():
return $default(_that.gender,_that.garmentType,_that.upperGarmentKey,_that.lowerGarmentKey,_that.thirdGarmentKey,_that.palluGarmentKey,_that.isUploadingUpper,_that.isUploadingLower,_that.isUploadingThird,_that.isUploadingPallu,_that.isUploadingBackground,_that.lookMode,_that.faceId,_that.selectedTemplate,_that.selectedLookIds,_that.backgroundId,_that.poseIds,_that.lowerCatalogItemId,_that.shoeCatalogItemId,_that.platform,_that.aspectRatio,_that.resolution,_that.posePresetPrefilled,_that.isSubmitting,_that.errorMessage);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( Gender gender,  GarmentType? garmentType,  String? upperGarmentKey,  String? lowerGarmentKey,  String? thirdGarmentKey,  String? palluGarmentKey,  bool isUploadingUpper,  bool isUploadingLower,  bool isUploadingThird,  bool isUploadingPallu,  bool isUploadingBackground,  LookMode lookMode,  String? faceId,  CatalogueTemplate? selectedTemplate,  Set<String> selectedLookIds,  String? backgroundId,  Set<String> poseIds,  String? lowerCatalogItemId,  String? shoeCatalogItemId,  String platform,  String aspectRatio,  String resolution,  bool posePresetPrefilled,  bool isSubmitting,  String? errorMessage)?  $default,) {final _that = this;
switch (_that) {
case _CatalogueSelectionState() when $default != null:
return $default(_that.gender,_that.garmentType,_that.upperGarmentKey,_that.lowerGarmentKey,_that.thirdGarmentKey,_that.palluGarmentKey,_that.isUploadingUpper,_that.isUploadingLower,_that.isUploadingThird,_that.isUploadingPallu,_that.isUploadingBackground,_that.lookMode,_that.faceId,_that.selectedTemplate,_that.selectedLookIds,_that.backgroundId,_that.poseIds,_that.lowerCatalogItemId,_that.shoeCatalogItemId,_that.platform,_that.aspectRatio,_that.resolution,_that.posePresetPrefilled,_that.isSubmitting,_that.errorMessage);case _:
  return null;

}
}

}

/// @nodoc


class _CatalogueSelectionState implements CatalogueSelectionState {
  const _CatalogueSelectionState({this.gender = Gender.women, this.garmentType, this.upperGarmentKey, this.lowerGarmentKey, this.thirdGarmentKey, this.palluGarmentKey, this.isUploadingUpper = false, this.isUploadingLower = false, this.isUploadingThird = false, this.isUploadingPallu = false, this.isUploadingBackground = false, this.lookMode = LookMode.createYourOwn, this.faceId, this.selectedTemplate,  Set<String> selectedLookIds = const <String>{}, this.backgroundId,  Set<String> poseIds = const <String>{}, this.lowerCatalogItemId, this.shoeCatalogItemId, this.platform = 'Amazon', this.aspectRatio = '1:1', this.resolution = '2K', this.posePresetPrefilled = false, this.isSubmitting = false, this.errorMessage}): _selectedLookIds = selectedLookIds,_poseIds = poseIds;
  

@override@JsonKey() final  Gender gender;
@override final  GarmentType? garmentType;
@override final  String? upperGarmentKey;
@override final  String? lowerGarmentKey;
@override final  String? thirdGarmentKey;
@override final  String? palluGarmentKey;
@override@JsonKey() final  bool isUploadingUpper;
@override@JsonKey() final  bool isUploadingLower;
@override@JsonKey() final  bool isUploadingThird;
@override@JsonKey() final  bool isUploadingPallu;
@override@JsonKey() final  bool isUploadingBackground;
@override@JsonKey() final  LookMode lookMode;
@override final  String? faceId;
@override final  CatalogueTemplate? selectedTemplate;
 final  Set<String> _selectedLookIds;
@override@JsonKey() Set<String> get selectedLookIds {
  if (_selectedLookIds is EqualUnmodifiableSetView) return _selectedLookIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableSetView(_selectedLookIds);
}

@override final  String? backgroundId;
 final  Set<String> _poseIds;
@override@JsonKey() Set<String> get poseIds {
  if (_poseIds is EqualUnmodifiableSetView) return _poseIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableSetView(_poseIds);
}

@override final  String? lowerCatalogItemId;
@override final  String? shoeCatalogItemId;
@override@JsonKey() final  String platform;
@override@JsonKey() final  String aspectRatio;
@override@JsonKey() final  String resolution;
@override@JsonKey() final  bool posePresetPrefilled;
@override@JsonKey() final  bool isSubmitting;
@override final  String? errorMessage;

/// Create a copy of CatalogueSelectionState
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogueSelectionStateCopyWith<_CatalogueSelectionState> get copyWith => __$CatalogueSelectionStateCopyWithImpl<_CatalogueSelectionState>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogueSelectionState&&(identical(other.gender, gender) || other.gender == gender)&&(identical(other.garmentType, garmentType) || other.garmentType == garmentType)&&(identical(other.upperGarmentKey, upperGarmentKey) || other.upperGarmentKey == upperGarmentKey)&&(identical(other.lowerGarmentKey, lowerGarmentKey) || other.lowerGarmentKey == lowerGarmentKey)&&(identical(other.thirdGarmentKey, thirdGarmentKey) || other.thirdGarmentKey == thirdGarmentKey)&&(identical(other.palluGarmentKey, palluGarmentKey) || other.palluGarmentKey == palluGarmentKey)&&(identical(other.isUploadingUpper, isUploadingUpper) || other.isUploadingUpper == isUploadingUpper)&&(identical(other.isUploadingLower, isUploadingLower) || other.isUploadingLower == isUploadingLower)&&(identical(other.isUploadingThird, isUploadingThird) || other.isUploadingThird == isUploadingThird)&&(identical(other.isUploadingPallu, isUploadingPallu) || other.isUploadingPallu == isUploadingPallu)&&(identical(other.isUploadingBackground, isUploadingBackground) || other.isUploadingBackground == isUploadingBackground)&&(identical(other.lookMode, lookMode) || other.lookMode == lookMode)&&(identical(other.faceId, faceId) || other.faceId == faceId)&&(identical(other.selectedTemplate, selectedTemplate) || other.selectedTemplate == selectedTemplate)&&const DeepCollectionEquality().equals(other.selectedLookIds, _selectedLookIds)&&(identical(other.backgroundId, backgroundId) || other.backgroundId == backgroundId)&&const DeepCollectionEquality().equals(other.poseIds, _poseIds)&&(identical(other.lowerCatalogItemId, lowerCatalogItemId) || other.lowerCatalogItemId == lowerCatalogItemId)&&(identical(other.shoeCatalogItemId, shoeCatalogItemId) || other.shoeCatalogItemId == shoeCatalogItemId)&&(identical(other.platform, platform) || other.platform == platform)&&(identical(other.aspectRatio, aspectRatio) || other.aspectRatio == aspectRatio)&&(identical(other.resolution, resolution) || other.resolution == resolution)&&(identical(other.posePresetPrefilled, posePresetPrefilled) || other.posePresetPrefilled == posePresetPrefilled)&&(identical(other.isSubmitting, isSubmitting) || other.isSubmitting == isSubmitting)&&(identical(other.errorMessage, errorMessage) || other.errorMessage == errorMessage));
}


@override
int get hashCode {
    return Object.hashAll([runtimeType,gender,garmentType,upperGarmentKey,lowerGarmentKey,thirdGarmentKey,palluGarmentKey,isUploadingUpper,isUploadingLower,isUploadingThird,isUploadingPallu,isUploadingBackground,lookMode,faceId,selectedTemplate,const DeepCollectionEquality().hash(_selectedLookIds),backgroundId,const DeepCollectionEquality().hash(_poseIds),lowerCatalogItemId,shoeCatalogItemId,platform,aspectRatio,resolution,posePresetPrefilled,isSubmitting,errorMessage]);
}

@override
String toString() {
    return 'CatalogueSelectionState(gender: $gender, garmentType: $garmentType, upperGarmentKey: $upperGarmentKey, lowerGarmentKey: $lowerGarmentKey, thirdGarmentKey: $thirdGarmentKey, palluGarmentKey: $palluGarmentKey, isUploadingUpper: $isUploadingUpper, isUploadingLower: $isUploadingLower, isUploadingThird: $isUploadingThird, isUploadingPallu: $isUploadingPallu, isUploadingBackground: $isUploadingBackground, lookMode: $lookMode, faceId: $faceId, selectedTemplate: $selectedTemplate, selectedLookIds: $selectedLookIds, backgroundId: $backgroundId, poseIds: $poseIds, lowerCatalogItemId: $lowerCatalogItemId, shoeCatalogItemId: $shoeCatalogItemId, platform: $platform, aspectRatio: $aspectRatio, resolution: $resolution, posePresetPrefilled: $posePresetPrefilled, isSubmitting: $isSubmitting, errorMessage: $errorMessage)';
}


}

/// @nodoc
abstract mixin class _$CatalogueSelectionStateCopyWith<$Res> implements $CatalogueSelectionStateCopyWith<$Res> {
  factory _$CatalogueSelectionStateCopyWith(_CatalogueSelectionState value, $Res Function(_CatalogueSelectionState) _then) = __$CatalogueSelectionStateCopyWithImpl;
@override @useResult
$Res call({
 Gender gender, GarmentType? garmentType, String? upperGarmentKey, String? lowerGarmentKey, String? thirdGarmentKey, String? palluGarmentKey, bool isUploadingUpper, bool isUploadingLower, bool isUploadingThird, bool isUploadingPallu, bool isUploadingBackground, LookMode lookMode, String? faceId, CatalogueTemplate? selectedTemplate, Set<String> selectedLookIds, String? backgroundId, Set<String> poseIds, String? lowerCatalogItemId, String? shoeCatalogItemId, String platform, String aspectRatio, String resolution, bool posePresetPrefilled, bool isSubmitting, String? errorMessage
});


@override $GarmentTypeCopyWith<$Res>? get garmentType;@override $CatalogueTemplateCopyWith<$Res>? get selectedTemplate;

}
/// @nodoc
class __$CatalogueSelectionStateCopyWithImpl<$Res>
    implements _$CatalogueSelectionStateCopyWith<$Res> {
  __$CatalogueSelectionStateCopyWithImpl(this._self, this._then);

  final _CatalogueSelectionState _self;
  final $Res Function(_CatalogueSelectionState) _then;

/// Create a copy of CatalogueSelectionState
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? gender = null,Object? garmentType = freezed,Object? upperGarmentKey = freezed,Object? lowerGarmentKey = freezed,Object? thirdGarmentKey = freezed,Object? palluGarmentKey = freezed,Object? isUploadingUpper = null,Object? isUploadingLower = null,Object? isUploadingThird = null,Object? isUploadingPallu = null,Object? isUploadingBackground = null,Object? lookMode = null,Object? faceId = freezed,Object? selectedTemplate = freezed,Object? selectedLookIds = null,Object? backgroundId = freezed,Object? poseIds = null,Object? lowerCatalogItemId = freezed,Object? shoeCatalogItemId = freezed,Object? platform = null,Object? aspectRatio = null,Object? resolution = null,Object? posePresetPrefilled = null,Object? isSubmitting = null,Object? errorMessage = freezed,}) {
  return _then(_CatalogueSelectionState(
gender: null == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as Gender,garmentType: freezed == garmentType ? _self.garmentType : garmentType // ignore: cast_nullable_to_non_nullable
as GarmentType?,upperGarmentKey: freezed == upperGarmentKey ? _self.upperGarmentKey : upperGarmentKey // ignore: cast_nullable_to_non_nullable
as String?,lowerGarmentKey: freezed == lowerGarmentKey ? _self.lowerGarmentKey : lowerGarmentKey // ignore: cast_nullable_to_non_nullable
as String?,thirdGarmentKey: freezed == thirdGarmentKey ? _self.thirdGarmentKey : thirdGarmentKey // ignore: cast_nullable_to_non_nullable
as String?,palluGarmentKey: freezed == palluGarmentKey ? _self.palluGarmentKey : palluGarmentKey // ignore: cast_nullable_to_non_nullable
as String?,isUploadingUpper: null == isUploadingUpper ? _self.isUploadingUpper : isUploadingUpper // ignore: cast_nullable_to_non_nullable
as bool,isUploadingLower: null == isUploadingLower ? _self.isUploadingLower : isUploadingLower // ignore: cast_nullable_to_non_nullable
as bool,isUploadingThird: null == isUploadingThird ? _self.isUploadingThird : isUploadingThird // ignore: cast_nullable_to_non_nullable
as bool,isUploadingPallu: null == isUploadingPallu ? _self.isUploadingPallu : isUploadingPallu // ignore: cast_nullable_to_non_nullable
as bool,isUploadingBackground: null == isUploadingBackground ? _self.isUploadingBackground : isUploadingBackground // ignore: cast_nullable_to_non_nullable
as bool,lookMode: null == lookMode ? _self.lookMode : lookMode // ignore: cast_nullable_to_non_nullable
as LookMode,faceId: freezed == faceId ? _self.faceId : faceId // ignore: cast_nullable_to_non_nullable
as String?,selectedTemplate: freezed == selectedTemplate ? _self.selectedTemplate : selectedTemplate // ignore: cast_nullable_to_non_nullable
as CatalogueTemplate?,selectedLookIds: null == selectedLookIds ? _self._selectedLookIds : selectedLookIds // ignore: cast_nullable_to_non_nullable
as Set<String>,backgroundId: freezed == backgroundId ? _self.backgroundId : backgroundId // ignore: cast_nullable_to_non_nullable
as String?,poseIds: null == poseIds ? _self._poseIds : poseIds // ignore: cast_nullable_to_non_nullable
as Set<String>,lowerCatalogItemId: freezed == lowerCatalogItemId ? _self.lowerCatalogItemId : lowerCatalogItemId // ignore: cast_nullable_to_non_nullable
as String?,shoeCatalogItemId: freezed == shoeCatalogItemId ? _self.shoeCatalogItemId : shoeCatalogItemId // ignore: cast_nullable_to_non_nullable
as String?,platform: null == platform ? _self.platform : platform // ignore: cast_nullable_to_non_nullable
as String,aspectRatio: null == aspectRatio ? _self.aspectRatio : aspectRatio // ignore: cast_nullable_to_non_nullable
as String,resolution: null == resolution ? _self.resolution : resolution // ignore: cast_nullable_to_non_nullable
as String,posePresetPrefilled: null == posePresetPrefilled ? _self.posePresetPrefilled : posePresetPrefilled // ignore: cast_nullable_to_non_nullable
as bool,isSubmitting: null == isSubmitting ? _self.isSubmitting : isSubmitting // ignore: cast_nullable_to_non_nullable
as bool,errorMessage: freezed == errorMessage ? _self.errorMessage : errorMessage // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

/// Create a copy of CatalogueSelectionState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GarmentTypeCopyWith<$Res>? get garmentType {
    if (_self.garmentType == null) {
    return null;
  }

  return $GarmentTypeCopyWith<$Res>(_self.garmentType!, (value) {
    return _then(_self.copyWith(garmentType: value));
  });
}/// Create a copy of CatalogueSelectionState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$CatalogueTemplateCopyWith<$Res>? get selectedTemplate {
    if (_self.selectedTemplate == null) {
    return null;
  }

  return $CatalogueTemplateCopyWith<$Res>(_self.selectedTemplate!, (value) {
    return _then(_self.copyWith(selectedTemplate: value));
  });
}
}

// dart format on
