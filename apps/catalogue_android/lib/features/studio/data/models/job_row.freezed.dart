// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'job_row.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$JobRow {

 String get id; String get status; String get createdAt; String? get completedAt; String? get errorMessage; String? get assetKind; int? get watermarkVersion; bool? get alreadyDownloaded; int? get creditsCharged;
/// Create a copy of JobRow
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$JobRowCopyWith<JobRow> get copyWith => _$JobRowCopyWithImpl<JobRow>(this as JobRow, _$identity);

  /// Serializes this JobRow to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as JobRow;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is JobRow&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.status, _this.status) || other.status == _this.status)&&(identical(other.createdAt, _this.createdAt) || other.createdAt == _this.createdAt)&&(identical(other.completedAt, _this.completedAt) || other.completedAt == _this.completedAt)&&(identical(other.errorMessage, _this.errorMessage) || other.errorMessage == _this.errorMessage)&&(identical(other.assetKind, _this.assetKind) || other.assetKind == _this.assetKind)&&(identical(other.watermarkVersion, _this.watermarkVersion) || other.watermarkVersion == _this.watermarkVersion)&&(identical(other.alreadyDownloaded, _this.alreadyDownloaded) || other.alreadyDownloaded == _this.alreadyDownloaded)&&(identical(other.creditsCharged, _this.creditsCharged) || other.creditsCharged == _this.creditsCharged));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as JobRow;
  return Object.hash(runtimeType,_this.id,_this.status,_this.createdAt,_this.completedAt,_this.errorMessage,_this.assetKind,_this.watermarkVersion,_this.alreadyDownloaded,_this.creditsCharged);
}

@override
String toString() {
  final _this = this as JobRow;
  return 'JobRow(id: ${_this.id}, status: ${_this.status}, createdAt: ${_this.createdAt}, completedAt: ${_this.completedAt}, errorMessage: ${_this.errorMessage}, assetKind: ${_this.assetKind}, watermarkVersion: ${_this.watermarkVersion}, alreadyDownloaded: ${_this.alreadyDownloaded}, creditsCharged: ${_this.creditsCharged})';
}


}

/// @nodoc
abstract mixin class $JobRowCopyWith<$Res>  {
  factory $JobRowCopyWith(JobRow value, $Res Function(JobRow) _then) = _$JobRowCopyWithImpl;
@useResult
$Res call({
 String id, String status, String createdAt, String? completedAt, String? errorMessage, String? assetKind, int? watermarkVersion, bool? alreadyDownloaded, int? creditsCharged
});




}
/// @nodoc
class _$JobRowCopyWithImpl<$Res>
    implements $JobRowCopyWith<$Res> {
  _$JobRowCopyWithImpl(this._self, this._then);

  final JobRow _self;
  final $Res Function(JobRow) _then;

/// Create a copy of JobRow
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? status = null,Object? createdAt = null,Object? completedAt = freezed,Object? errorMessage = freezed,Object? assetKind = freezed,Object? watermarkVersion = freezed,Object? alreadyDownloaded = freezed,Object? creditsCharged = freezed,}) {
  return _then(JobRow(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,completedAt: freezed == completedAt ? _self.completedAt : completedAt // ignore: cast_nullable_to_non_nullable
as String?,errorMessage: freezed == errorMessage ? _self.errorMessage : errorMessage // ignore: cast_nullable_to_non_nullable
as String?,assetKind: freezed == assetKind ? _self.assetKind : assetKind // ignore: cast_nullable_to_non_nullable
as String?,watermarkVersion: freezed == watermarkVersion ? _self.watermarkVersion : watermarkVersion // ignore: cast_nullable_to_non_nullable
as int?,alreadyDownloaded: freezed == alreadyDownloaded ? _self.alreadyDownloaded : alreadyDownloaded // ignore: cast_nullable_to_non_nullable
as bool?,creditsCharged: freezed == creditsCharged ? _self.creditsCharged : creditsCharged // ignore: cast_nullable_to_non_nullable
as int?,
  ));
}

}


/// Adds pattern-matching-related methods to [JobRow].
extension JobRowPatterns on JobRow {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _JobRow value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _JobRow() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _JobRow value)  $default,){
final _that = this;
switch (_that) {
case _JobRow():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _JobRow value)?  $default,){
final _that = this;
switch (_that) {
case _JobRow() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String status,  String createdAt,  String? completedAt,  String? errorMessage,  String? assetKind,  int? watermarkVersion,  bool? alreadyDownloaded,  int? creditsCharged)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _JobRow() when $default != null:
return $default(_that.id,_that.status,_that.createdAt,_that.completedAt,_that.errorMessage,_that.assetKind,_that.watermarkVersion,_that.alreadyDownloaded,_that.creditsCharged);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String status,  String createdAt,  String? completedAt,  String? errorMessage,  String? assetKind,  int? watermarkVersion,  bool? alreadyDownloaded,  int? creditsCharged)  $default,) {final _that = this;
switch (_that) {
case _JobRow():
return $default(_that.id,_that.status,_that.createdAt,_that.completedAt,_that.errorMessage,_that.assetKind,_that.watermarkVersion,_that.alreadyDownloaded,_that.creditsCharged);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String status,  String createdAt,  String? completedAt,  String? errorMessage,  String? assetKind,  int? watermarkVersion,  bool? alreadyDownloaded,  int? creditsCharged)?  $default,) {final _that = this;
switch (_that) {
case _JobRow() when $default != null:
return $default(_that.id,_that.status,_that.createdAt,_that.completedAt,_that.errorMessage,_that.assetKind,_that.watermarkVersion,_that.alreadyDownloaded,_that.creditsCharged);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _JobRow extends JobRow {
  const _JobRow({required this.id, required this.status, required this.createdAt, this.completedAt, this.errorMessage, this.assetKind, this.watermarkVersion, this.alreadyDownloaded, this.creditsCharged}): super._();
  factory _JobRow.fromJson(Map<String, dynamic> json) => _$JobRowFromJson(json);

@override final  String id;
@override final  String status;
@override final  String createdAt;
@override final  String? completedAt;
@override final  String? errorMessage;
@override final  String? assetKind;
@override final  int? watermarkVersion;
@override final  bool? alreadyDownloaded;
@override final  int? creditsCharged;

/// Create a copy of JobRow
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$JobRowCopyWith<_JobRow> get copyWith => __$JobRowCopyWithImpl<_JobRow>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$JobRowToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _JobRow&&(identical(other.id, id) || other.id == id)&&(identical(other.status, status) || other.status == status)&&(identical(other.createdAt, createdAt) || other.createdAt == createdAt)&&(identical(other.completedAt, completedAt) || other.completedAt == completedAt)&&(identical(other.errorMessage, errorMessage) || other.errorMessage == errorMessage)&&(identical(other.assetKind, assetKind) || other.assetKind == assetKind)&&(identical(other.watermarkVersion, watermarkVersion) || other.watermarkVersion == watermarkVersion)&&(identical(other.alreadyDownloaded, alreadyDownloaded) || other.alreadyDownloaded == alreadyDownloaded)&&(identical(other.creditsCharged, creditsCharged) || other.creditsCharged == creditsCharged));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,status,createdAt,completedAt,errorMessage,assetKind,watermarkVersion,alreadyDownloaded,creditsCharged);
}

@override
String toString() {
    return 'JobRow(id: $id, status: $status, createdAt: $createdAt, completedAt: $completedAt, errorMessage: $errorMessage, assetKind: $assetKind, watermarkVersion: $watermarkVersion, alreadyDownloaded: $alreadyDownloaded, creditsCharged: $creditsCharged)';
}


}

/// @nodoc
abstract mixin class _$JobRowCopyWith<$Res> implements $JobRowCopyWith<$Res> {
  factory _$JobRowCopyWith(_JobRow value, $Res Function(_JobRow) _then) = __$JobRowCopyWithImpl;
@override @useResult
$Res call({
 String id, String status, String createdAt, String? completedAt, String? errorMessage, String? assetKind, int? watermarkVersion, bool? alreadyDownloaded, int? creditsCharged
});




}
/// @nodoc
class __$JobRowCopyWithImpl<$Res>
    implements _$JobRowCopyWith<$Res> {
  __$JobRowCopyWithImpl(this._self, this._then);

  final _JobRow _self;
  final $Res Function(_JobRow) _then;

/// Create a copy of JobRow
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? status = null,Object? createdAt = null,Object? completedAt = freezed,Object? errorMessage = freezed,Object? assetKind = freezed,Object? watermarkVersion = freezed,Object? alreadyDownloaded = freezed,Object? creditsCharged = freezed,}) {
  return _then(_JobRow(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,completedAt: freezed == completedAt ? _self.completedAt : completedAt // ignore: cast_nullable_to_non_nullable
as String?,errorMessage: freezed == errorMessage ? _self.errorMessage : errorMessage // ignore: cast_nullable_to_non_nullable
as String?,assetKind: freezed == assetKind ? _self.assetKind : assetKind // ignore: cast_nullable_to_non_nullable
as String?,watermarkVersion: freezed == watermarkVersion ? _self.watermarkVersion : watermarkVersion // ignore: cast_nullable_to_non_nullable
as int?,alreadyDownloaded: freezed == alreadyDownloaded ? _self.alreadyDownloaded : alreadyDownloaded // ignore: cast_nullable_to_non_nullable
as bool?,creditsCharged: freezed == creditsCharged ? _self.creditsCharged : creditsCharged // ignore: cast_nullable_to_non_nullable
as int?,
  ));
}


}


/// @nodoc
mixin _$PresignedUrl {

 String get url; int get expiresIn;
/// Create a copy of PresignedUrl
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PresignedUrlCopyWith<PresignedUrl> get copyWith => _$PresignedUrlCopyWithImpl<PresignedUrl>(this as PresignedUrl, _$identity);

  /// Serializes this PresignedUrl to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as PresignedUrl;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is PresignedUrl&&(identical(other.url, _this.url) || other.url == _this.url)&&(identical(other.expiresIn, _this.expiresIn) || other.expiresIn == _this.expiresIn));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as PresignedUrl;
  return Object.hash(runtimeType,_this.url,_this.expiresIn);
}

@override
String toString() {
  final _this = this as PresignedUrl;
  return 'PresignedUrl(url: ${_this.url}, expiresIn: ${_this.expiresIn})';
}


}

/// @nodoc
abstract mixin class $PresignedUrlCopyWith<$Res>  {
  factory $PresignedUrlCopyWith(PresignedUrl value, $Res Function(PresignedUrl) _then) = _$PresignedUrlCopyWithImpl;
@useResult
$Res call({
 String url, int expiresIn
});




}
/// @nodoc
class _$PresignedUrlCopyWithImpl<$Res>
    implements $PresignedUrlCopyWith<$Res> {
  _$PresignedUrlCopyWithImpl(this._self, this._then);

  final PresignedUrl _self;
  final $Res Function(PresignedUrl) _then;

/// Create a copy of PresignedUrl
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? url = null,Object? expiresIn = null,}) {
  return _then(PresignedUrl(
url: null == url ? _self.url : url // ignore: cast_nullable_to_non_nullable
as String,expiresIn: null == expiresIn ? _self.expiresIn : expiresIn // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [PresignedUrl].
extension PresignedUrlPatterns on PresignedUrl {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _PresignedUrl value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _PresignedUrl() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _PresignedUrl value)  $default,){
final _that = this;
switch (_that) {
case _PresignedUrl():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _PresignedUrl value)?  $default,){
final _that = this;
switch (_that) {
case _PresignedUrl() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String url,  int expiresIn)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _PresignedUrl() when $default != null:
return $default(_that.url,_that.expiresIn);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String url,  int expiresIn)  $default,) {final _that = this;
switch (_that) {
case _PresignedUrl():
return $default(_that.url,_that.expiresIn);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String url,  int expiresIn)?  $default,) {final _that = this;
switch (_that) {
case _PresignedUrl() when $default != null:
return $default(_that.url,_that.expiresIn);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _PresignedUrl implements PresignedUrl {
  const _PresignedUrl({required this.url, required this.expiresIn});
  factory _PresignedUrl.fromJson(Map<String, dynamic> json) => _$PresignedUrlFromJson(json);

@override final  String url;
@override final  int expiresIn;

/// Create a copy of PresignedUrl
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$PresignedUrlCopyWith<_PresignedUrl> get copyWith => __$PresignedUrlCopyWithImpl<_PresignedUrl>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$PresignedUrlToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _PresignedUrl&&(identical(other.url, url) || other.url == url)&&(identical(other.expiresIn, expiresIn) || other.expiresIn == expiresIn));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,url,expiresIn);
}

@override
String toString() {
    return 'PresignedUrl(url: $url, expiresIn: $expiresIn)';
}


}

/// @nodoc
abstract mixin class _$PresignedUrlCopyWith<$Res> implements $PresignedUrlCopyWith<$Res> {
  factory _$PresignedUrlCopyWith(_PresignedUrl value, $Res Function(_PresignedUrl) _then) = __$PresignedUrlCopyWithImpl;
@override @useResult
$Res call({
 String url, int expiresIn
});




}
/// @nodoc
class __$PresignedUrlCopyWithImpl<$Res>
    implements _$PresignedUrlCopyWith<$Res> {
  __$PresignedUrlCopyWithImpl(this._self, this._then);

  final _PresignedUrl _self;
  final $Res Function(_PresignedUrl) _then;

/// Create a copy of PresignedUrl
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? url = null,Object? expiresIn = null,}) {
  return _then(_PresignedUrl(
url: null == url ? _self.url : url // ignore: cast_nullable_to_non_nullable
as String,expiresIn: null == expiresIn ? _self.expiresIn : expiresIn // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

// dart format on
