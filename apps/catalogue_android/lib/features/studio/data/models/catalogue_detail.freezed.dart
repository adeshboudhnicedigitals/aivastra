// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'catalogue_detail.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CatalogueDetail {

 String get catalogueId; List<JobRow> get jobs; String? get aspectRatio; String? get platform; String? get garmentUrl; bool? get currentPlanWatermark; String? get gender; String? get garmentName;
/// Create a copy of CatalogueDetail
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogueDetailCopyWith<CatalogueDetail> get copyWith => _$CatalogueDetailCopyWithImpl<CatalogueDetail>(this as CatalogueDetail, _$identity);

  /// Serializes this CatalogueDetail to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogueDetail;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogueDetail&&(identical(other.catalogueId, _this.catalogueId) || other.catalogueId == _this.catalogueId)&&const DeepCollectionEquality().equals(other.jobs, _this.jobs)&&(identical(other.aspectRatio, _this.aspectRatio) || other.aspectRatio == _this.aspectRatio)&&(identical(other.platform, _this.platform) || other.platform == _this.platform)&&(identical(other.garmentUrl, _this.garmentUrl) || other.garmentUrl == _this.garmentUrl)&&(identical(other.currentPlanWatermark, _this.currentPlanWatermark) || other.currentPlanWatermark == _this.currentPlanWatermark)&&(identical(other.gender, _this.gender) || other.gender == _this.gender)&&(identical(other.garmentName, _this.garmentName) || other.garmentName == _this.garmentName));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogueDetail;
  return Object.hash(runtimeType,_this.catalogueId,const DeepCollectionEquality().hash(_this.jobs),_this.aspectRatio,_this.platform,_this.garmentUrl,_this.currentPlanWatermark,_this.gender,_this.garmentName);
}

@override
String toString() {
  final _this = this as CatalogueDetail;
  return 'CatalogueDetail(catalogueId: ${_this.catalogueId}, jobs: ${_this.jobs}, aspectRatio: ${_this.aspectRatio}, platform: ${_this.platform}, garmentUrl: ${_this.garmentUrl}, currentPlanWatermark: ${_this.currentPlanWatermark}, gender: ${_this.gender}, garmentName: ${_this.garmentName})';
}


}

/// @nodoc
abstract mixin class $CatalogueDetailCopyWith<$Res>  {
  factory $CatalogueDetailCopyWith(CatalogueDetail value, $Res Function(CatalogueDetail) _then) = _$CatalogueDetailCopyWithImpl;
@useResult
$Res call({
 String catalogueId, List<JobRow> jobs, String? aspectRatio, String? platform, String? garmentUrl, bool? currentPlanWatermark, String? gender, String? garmentName
});




}
/// @nodoc
class _$CatalogueDetailCopyWithImpl<$Res>
    implements $CatalogueDetailCopyWith<$Res> {
  _$CatalogueDetailCopyWithImpl(this._self, this._then);

  final CatalogueDetail _self;
  final $Res Function(CatalogueDetail) _then;

/// Create a copy of CatalogueDetail
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? catalogueId = null,Object? jobs = null,Object? aspectRatio = freezed,Object? platform = freezed,Object? garmentUrl = freezed,Object? currentPlanWatermark = freezed,Object? gender = freezed,Object? garmentName = freezed,}) {
  return _then(CatalogueDetail(
catalogueId: null == catalogueId ? _self.catalogueId : catalogueId // ignore: cast_nullable_to_non_nullable
as String,jobs: null == jobs ? _self.jobs : jobs // ignore: cast_nullable_to_non_nullable
as List<JobRow>,aspectRatio: freezed == aspectRatio ? _self.aspectRatio : aspectRatio // ignore: cast_nullable_to_non_nullable
as String?,platform: freezed == platform ? _self.platform : platform // ignore: cast_nullable_to_non_nullable
as String?,garmentUrl: freezed == garmentUrl ? _self.garmentUrl : garmentUrl // ignore: cast_nullable_to_non_nullable
as String?,currentPlanWatermark: freezed == currentPlanWatermark ? _self.currentPlanWatermark : currentPlanWatermark // ignore: cast_nullable_to_non_nullable
as bool?,gender: freezed == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as String?,garmentName: freezed == garmentName ? _self.garmentName : garmentName // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogueDetail].
extension CatalogueDetailPatterns on CatalogueDetail {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogueDetail value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogueDetail() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogueDetail value)  $default,){
final _that = this;
switch (_that) {
case _CatalogueDetail():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogueDetail value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogueDetail() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String catalogueId,  List<JobRow> jobs,  String? aspectRatio,  String? platform,  String? garmentUrl,  bool? currentPlanWatermark,  String? gender,  String? garmentName)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogueDetail() when $default != null:
return $default(_that.catalogueId,_that.jobs,_that.aspectRatio,_that.platform,_that.garmentUrl,_that.currentPlanWatermark,_that.gender,_that.garmentName);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String catalogueId,  List<JobRow> jobs,  String? aspectRatio,  String? platform,  String? garmentUrl,  bool? currentPlanWatermark,  String? gender,  String? garmentName)  $default,) {final _that = this;
switch (_that) {
case _CatalogueDetail():
return $default(_that.catalogueId,_that.jobs,_that.aspectRatio,_that.platform,_that.garmentUrl,_that.currentPlanWatermark,_that.gender,_that.garmentName);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String catalogueId,  List<JobRow> jobs,  String? aspectRatio,  String? platform,  String? garmentUrl,  bool? currentPlanWatermark,  String? gender,  String? garmentName)?  $default,) {final _that = this;
switch (_that) {
case _CatalogueDetail() when $default != null:
return $default(_that.catalogueId,_that.jobs,_that.aspectRatio,_that.platform,_that.garmentUrl,_that.currentPlanWatermark,_that.gender,_that.garmentName);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogueDetail extends CatalogueDetail {
  const _CatalogueDetail({required this.catalogueId,  List<JobRow> jobs = const [], this.aspectRatio, this.platform, this.garmentUrl, this.currentPlanWatermark, this.gender, this.garmentName}): _jobs = jobs,super._();
  factory _CatalogueDetail.fromJson(Map<String, dynamic> json) => _$CatalogueDetailFromJson(json);

@override final  String catalogueId;
 final  List<JobRow> _jobs;
@override@JsonKey() List<JobRow> get jobs {
  if (_jobs is EqualUnmodifiableListView) return _jobs;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_jobs);
}

@override final  String? aspectRatio;
@override final  String? platform;
@override final  String? garmentUrl;
@override final  bool? currentPlanWatermark;
@override final  String? gender;
@override final  String? garmentName;

/// Create a copy of CatalogueDetail
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogueDetailCopyWith<_CatalogueDetail> get copyWith => __$CatalogueDetailCopyWithImpl<_CatalogueDetail>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogueDetailToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogueDetail&&(identical(other.catalogueId, catalogueId) || other.catalogueId == catalogueId)&&const DeepCollectionEquality().equals(other.jobs, _jobs)&&(identical(other.aspectRatio, aspectRatio) || other.aspectRatio == aspectRatio)&&(identical(other.platform, platform) || other.platform == platform)&&(identical(other.garmentUrl, garmentUrl) || other.garmentUrl == garmentUrl)&&(identical(other.currentPlanWatermark, currentPlanWatermark) || other.currentPlanWatermark == currentPlanWatermark)&&(identical(other.gender, gender) || other.gender == gender)&&(identical(other.garmentName, garmentName) || other.garmentName == garmentName));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,catalogueId,const DeepCollectionEquality().hash(_jobs),aspectRatio,platform,garmentUrl,currentPlanWatermark,gender,garmentName);
}

@override
String toString() {
    return 'CatalogueDetail(catalogueId: $catalogueId, jobs: $jobs, aspectRatio: $aspectRatio, platform: $platform, garmentUrl: $garmentUrl, currentPlanWatermark: $currentPlanWatermark, gender: $gender, garmentName: $garmentName)';
}


}

/// @nodoc
abstract mixin class _$CatalogueDetailCopyWith<$Res> implements $CatalogueDetailCopyWith<$Res> {
  factory _$CatalogueDetailCopyWith(_CatalogueDetail value, $Res Function(_CatalogueDetail) _then) = __$CatalogueDetailCopyWithImpl;
@override @useResult
$Res call({
 String catalogueId, List<JobRow> jobs, String? aspectRatio, String? platform, String? garmentUrl, bool? currentPlanWatermark, String? gender, String? garmentName
});




}
/// @nodoc
class __$CatalogueDetailCopyWithImpl<$Res>
    implements _$CatalogueDetailCopyWith<$Res> {
  __$CatalogueDetailCopyWithImpl(this._self, this._then);

  final _CatalogueDetail _self;
  final $Res Function(_CatalogueDetail) _then;

/// Create a copy of CatalogueDetail
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? catalogueId = null,Object? jobs = null,Object? aspectRatio = freezed,Object? platform = freezed,Object? garmentUrl = freezed,Object? currentPlanWatermark = freezed,Object? gender = freezed,Object? garmentName = freezed,}) {
  return _then(_CatalogueDetail(
catalogueId: null == catalogueId ? _self.catalogueId : catalogueId // ignore: cast_nullable_to_non_nullable
as String,jobs: null == jobs ? _self._jobs : jobs // ignore: cast_nullable_to_non_nullable
as List<JobRow>,aspectRatio: freezed == aspectRatio ? _self.aspectRatio : aspectRatio // ignore: cast_nullable_to_non_nullable
as String?,platform: freezed == platform ? _self.platform : platform // ignore: cast_nullable_to_non_nullable
as String?,garmentUrl: freezed == garmentUrl ? _self.garmentUrl : garmentUrl // ignore: cast_nullable_to_non_nullable
as String?,currentPlanWatermark: freezed == currentPlanWatermark ? _self.currentPlanWatermark : currentPlanWatermark // ignore: cast_nullable_to_non_nullable
as bool?,gender: freezed == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as String?,garmentName: freezed == garmentName ? _self.garmentName : garmentName // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
