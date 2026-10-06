// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'catalogue_summary.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CatalogueSummary {

 String get catalogueId; String? get genderSlug; String? get platform; String? get garmentType; List<JobRow> get jobs; String get createdAt; String? get coverUrl; String? get coverThumbUrl;
/// Create a copy of CatalogueSummary
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogueSummaryCopyWith<CatalogueSummary> get copyWith => _$CatalogueSummaryCopyWithImpl<CatalogueSummary>(this as CatalogueSummary, _$identity);

  /// Serializes this CatalogueSummary to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogueSummary;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogueSummary&&(identical(other.catalogueId, _this.catalogueId) || other.catalogueId == _this.catalogueId)&&(identical(other.genderSlug, _this.genderSlug) || other.genderSlug == _this.genderSlug)&&(identical(other.platform, _this.platform) || other.platform == _this.platform)&&(identical(other.garmentType, _this.garmentType) || other.garmentType == _this.garmentType)&&const DeepCollectionEquality().equals(other.jobs, _this.jobs)&&(identical(other.createdAt, _this.createdAt) || other.createdAt == _this.createdAt)&&(identical(other.coverUrl, _this.coverUrl) || other.coverUrl == _this.coverUrl)&&(identical(other.coverThumbUrl, _this.coverThumbUrl) || other.coverThumbUrl == _this.coverThumbUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogueSummary;
  return Object.hash(runtimeType,_this.catalogueId,_this.genderSlug,_this.platform,_this.garmentType,const DeepCollectionEquality().hash(_this.jobs),_this.createdAt,_this.coverUrl,_this.coverThumbUrl);
}

@override
String toString() {
  final _this = this as CatalogueSummary;
  return 'CatalogueSummary(catalogueId: ${_this.catalogueId}, genderSlug: ${_this.genderSlug}, platform: ${_this.platform}, garmentType: ${_this.garmentType}, jobs: ${_this.jobs}, createdAt: ${_this.createdAt}, coverUrl: ${_this.coverUrl}, coverThumbUrl: ${_this.coverThumbUrl})';
}


}

/// @nodoc
abstract mixin class $CatalogueSummaryCopyWith<$Res>  {
  factory $CatalogueSummaryCopyWith(CatalogueSummary value, $Res Function(CatalogueSummary) _then) = _$CatalogueSummaryCopyWithImpl;
@useResult
$Res call({
 String catalogueId, String? genderSlug, String? platform, String? garmentType, List<JobRow> jobs, String createdAt, String? coverUrl, String? coverThumbUrl
});




}
/// @nodoc
class _$CatalogueSummaryCopyWithImpl<$Res>
    implements $CatalogueSummaryCopyWith<$Res> {
  _$CatalogueSummaryCopyWithImpl(this._self, this._then);

  final CatalogueSummary _self;
  final $Res Function(CatalogueSummary) _then;

/// Create a copy of CatalogueSummary
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? catalogueId = null,Object? genderSlug = freezed,Object? platform = freezed,Object? garmentType = freezed,Object? jobs = null,Object? createdAt = null,Object? coverUrl = freezed,Object? coverThumbUrl = freezed,}) {
  return _then(CatalogueSummary(
catalogueId: null == catalogueId ? _self.catalogueId : catalogueId // ignore: cast_nullable_to_non_nullable
as String,genderSlug: freezed == genderSlug ? _self.genderSlug : genderSlug // ignore: cast_nullable_to_non_nullable
as String?,platform: freezed == platform ? _self.platform : platform // ignore: cast_nullable_to_non_nullable
as String?,garmentType: freezed == garmentType ? _self.garmentType : garmentType // ignore: cast_nullable_to_non_nullable
as String?,jobs: null == jobs ? _self.jobs : jobs // ignore: cast_nullable_to_non_nullable
as List<JobRow>,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,coverUrl: freezed == coverUrl ? _self.coverUrl : coverUrl // ignore: cast_nullable_to_non_nullable
as String?,coverThumbUrl: freezed == coverThumbUrl ? _self.coverThumbUrl : coverThumbUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogueSummary].
extension CatalogueSummaryPatterns on CatalogueSummary {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogueSummary value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogueSummary() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogueSummary value)  $default,){
final _that = this;
switch (_that) {
case _CatalogueSummary():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogueSummary value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogueSummary() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String catalogueId,  String? genderSlug,  String? platform,  String? garmentType,  List<JobRow> jobs,  String createdAt,  String? coverUrl,  String? coverThumbUrl)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogueSummary() when $default != null:
return $default(_that.catalogueId,_that.genderSlug,_that.platform,_that.garmentType,_that.jobs,_that.createdAt,_that.coverUrl,_that.coverThumbUrl);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String catalogueId,  String? genderSlug,  String? platform,  String? garmentType,  List<JobRow> jobs,  String createdAt,  String? coverUrl,  String? coverThumbUrl)  $default,) {final _that = this;
switch (_that) {
case _CatalogueSummary():
return $default(_that.catalogueId,_that.genderSlug,_that.platform,_that.garmentType,_that.jobs,_that.createdAt,_that.coverUrl,_that.coverThumbUrl);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String catalogueId,  String? genderSlug,  String? platform,  String? garmentType,  List<JobRow> jobs,  String createdAt,  String? coverUrl,  String? coverThumbUrl)?  $default,) {final _that = this;
switch (_that) {
case _CatalogueSummary() when $default != null:
return $default(_that.catalogueId,_that.genderSlug,_that.platform,_that.garmentType,_that.jobs,_that.createdAt,_that.coverUrl,_that.coverThumbUrl);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogueSummary implements CatalogueSummary {
  const _CatalogueSummary({required this.catalogueId, this.genderSlug, this.platform, this.garmentType,  List<JobRow> jobs = const [], required this.createdAt, this.coverUrl, this.coverThumbUrl}): _jobs = jobs;
  factory _CatalogueSummary.fromJson(Map<String, dynamic> json) => _$CatalogueSummaryFromJson(json);

@override final  String catalogueId;
@override final  String? genderSlug;
@override final  String? platform;
@override final  String? garmentType;
 final  List<JobRow> _jobs;
@override@JsonKey() List<JobRow> get jobs {
  if (_jobs is EqualUnmodifiableListView) return _jobs;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_jobs);
}

@override final  String createdAt;
@override final  String? coverUrl;
@override final  String? coverThumbUrl;

/// Create a copy of CatalogueSummary
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogueSummaryCopyWith<_CatalogueSummary> get copyWith => __$CatalogueSummaryCopyWithImpl<_CatalogueSummary>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogueSummaryToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogueSummary&&(identical(other.catalogueId, catalogueId) || other.catalogueId == catalogueId)&&(identical(other.genderSlug, genderSlug) || other.genderSlug == genderSlug)&&(identical(other.platform, platform) || other.platform == platform)&&(identical(other.garmentType, garmentType) || other.garmentType == garmentType)&&const DeepCollectionEquality().equals(other.jobs, _jobs)&&(identical(other.createdAt, createdAt) || other.createdAt == createdAt)&&(identical(other.coverUrl, coverUrl) || other.coverUrl == coverUrl)&&(identical(other.coverThumbUrl, coverThumbUrl) || other.coverThumbUrl == coverThumbUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,catalogueId,genderSlug,platform,garmentType,const DeepCollectionEquality().hash(_jobs),createdAt,coverUrl,coverThumbUrl);
}

@override
String toString() {
    return 'CatalogueSummary(catalogueId: $catalogueId, genderSlug: $genderSlug, platform: $platform, garmentType: $garmentType, jobs: $jobs, createdAt: $createdAt, coverUrl: $coverUrl, coverThumbUrl: $coverThumbUrl)';
}


}

/// @nodoc
abstract mixin class _$CatalogueSummaryCopyWith<$Res> implements $CatalogueSummaryCopyWith<$Res> {
  factory _$CatalogueSummaryCopyWith(_CatalogueSummary value, $Res Function(_CatalogueSummary) _then) = __$CatalogueSummaryCopyWithImpl;
@override @useResult
$Res call({
 String catalogueId, String? genderSlug, String? platform, String? garmentType, List<JobRow> jobs, String createdAt, String? coverUrl, String? coverThumbUrl
});




}
/// @nodoc
class __$CatalogueSummaryCopyWithImpl<$Res>
    implements _$CatalogueSummaryCopyWith<$Res> {
  __$CatalogueSummaryCopyWithImpl(this._self, this._then);

  final _CatalogueSummary _self;
  final $Res Function(_CatalogueSummary) _then;

/// Create a copy of CatalogueSummary
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? catalogueId = null,Object? genderSlug = freezed,Object? platform = freezed,Object? garmentType = freezed,Object? jobs = null,Object? createdAt = null,Object? coverUrl = freezed,Object? coverThumbUrl = freezed,}) {
  return _then(_CatalogueSummary(
catalogueId: null == catalogueId ? _self.catalogueId : catalogueId // ignore: cast_nullable_to_non_nullable
as String,genderSlug: freezed == genderSlug ? _self.genderSlug : genderSlug // ignore: cast_nullable_to_non_nullable
as String?,platform: freezed == platform ? _self.platform : platform // ignore: cast_nullable_to_non_nullable
as String?,garmentType: freezed == garmentType ? _self.garmentType : garmentType // ignore: cast_nullable_to_non_nullable
as String?,jobs: null == jobs ? _self._jobs : jobs // ignore: cast_nullable_to_non_nullable
as List<JobRow>,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,coverUrl: freezed == coverUrl ? _self.coverUrl : coverUrl // ignore: cast_nullable_to_non_nullable
as String?,coverThumbUrl: freezed == coverThumbUrl ? _self.coverThumbUrl : coverThumbUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
