// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'batch_submit_result.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$BatchCatalogueGroup {

 int get rowIndex; String get catalogueId; List<String> get jobIds;
/// Create a copy of BatchCatalogueGroup
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$BatchCatalogueGroupCopyWith<BatchCatalogueGroup> get copyWith => _$BatchCatalogueGroupCopyWithImpl<BatchCatalogueGroup>(this as BatchCatalogueGroup, _$identity);

  /// Serializes this BatchCatalogueGroup to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as BatchCatalogueGroup;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is BatchCatalogueGroup&&(identical(other.rowIndex, _this.rowIndex) || other.rowIndex == _this.rowIndex)&&(identical(other.catalogueId, _this.catalogueId) || other.catalogueId == _this.catalogueId)&&const DeepCollectionEquality().equals(other.jobIds, _this.jobIds));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as BatchCatalogueGroup;
  return Object.hash(runtimeType,_this.rowIndex,_this.catalogueId,const DeepCollectionEquality().hash(_this.jobIds));
}

@override
String toString() {
  final _this = this as BatchCatalogueGroup;
  return 'BatchCatalogueGroup(rowIndex: ${_this.rowIndex}, catalogueId: ${_this.catalogueId}, jobIds: ${_this.jobIds})';
}


}

/// @nodoc
abstract mixin class $BatchCatalogueGroupCopyWith<$Res>  {
  factory $BatchCatalogueGroupCopyWith(BatchCatalogueGroup value, $Res Function(BatchCatalogueGroup) _then) = _$BatchCatalogueGroupCopyWithImpl;
@useResult
$Res call({
 int rowIndex, String catalogueId, List<String> jobIds
});




}
/// @nodoc
class _$BatchCatalogueGroupCopyWithImpl<$Res>
    implements $BatchCatalogueGroupCopyWith<$Res> {
  _$BatchCatalogueGroupCopyWithImpl(this._self, this._then);

  final BatchCatalogueGroup _self;
  final $Res Function(BatchCatalogueGroup) _then;

/// Create a copy of BatchCatalogueGroup
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? rowIndex = null,Object? catalogueId = null,Object? jobIds = null,}) {
  return _then(BatchCatalogueGroup(
rowIndex: null == rowIndex ? _self.rowIndex : rowIndex // ignore: cast_nullable_to_non_nullable
as int,catalogueId: null == catalogueId ? _self.catalogueId : catalogueId // ignore: cast_nullable_to_non_nullable
as String,jobIds: null == jobIds ? _self.jobIds : jobIds // ignore: cast_nullable_to_non_nullable
as List<String>,
  ));
}

}


/// Adds pattern-matching-related methods to [BatchCatalogueGroup].
extension BatchCatalogueGroupPatterns on BatchCatalogueGroup {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _BatchCatalogueGroup value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _BatchCatalogueGroup() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _BatchCatalogueGroup value)  $default,){
final _that = this;
switch (_that) {
case _BatchCatalogueGroup():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _BatchCatalogueGroup value)?  $default,){
final _that = this;
switch (_that) {
case _BatchCatalogueGroup() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int rowIndex,  String catalogueId,  List<String> jobIds)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _BatchCatalogueGroup() when $default != null:
return $default(_that.rowIndex,_that.catalogueId,_that.jobIds);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int rowIndex,  String catalogueId,  List<String> jobIds)  $default,) {final _that = this;
switch (_that) {
case _BatchCatalogueGroup():
return $default(_that.rowIndex,_that.catalogueId,_that.jobIds);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int rowIndex,  String catalogueId,  List<String> jobIds)?  $default,) {final _that = this;
switch (_that) {
case _BatchCatalogueGroup() when $default != null:
return $default(_that.rowIndex,_that.catalogueId,_that.jobIds);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _BatchCatalogueGroup implements BatchCatalogueGroup {
  const _BatchCatalogueGroup({required this.rowIndex, required this.catalogueId, required  List<String> jobIds}): _jobIds = jobIds;
  factory _BatchCatalogueGroup.fromJson(Map<String, dynamic> json) => _$BatchCatalogueGroupFromJson(json);

@override final  int rowIndex;
@override final  String catalogueId;
 final  List<String> _jobIds;
@override List<String> get jobIds {
  if (_jobIds is EqualUnmodifiableListView) return _jobIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_jobIds);
}


/// Create a copy of BatchCatalogueGroup
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$BatchCatalogueGroupCopyWith<_BatchCatalogueGroup> get copyWith => __$BatchCatalogueGroupCopyWithImpl<_BatchCatalogueGroup>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$BatchCatalogueGroupToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _BatchCatalogueGroup&&(identical(other.rowIndex, rowIndex) || other.rowIndex == rowIndex)&&(identical(other.catalogueId, catalogueId) || other.catalogueId == catalogueId)&&const DeepCollectionEquality().equals(other.jobIds, _jobIds));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,rowIndex,catalogueId,const DeepCollectionEquality().hash(_jobIds));
}

@override
String toString() {
    return 'BatchCatalogueGroup(rowIndex: $rowIndex, catalogueId: $catalogueId, jobIds: $jobIds)';
}


}

/// @nodoc
abstract mixin class _$BatchCatalogueGroupCopyWith<$Res> implements $BatchCatalogueGroupCopyWith<$Res> {
  factory _$BatchCatalogueGroupCopyWith(_BatchCatalogueGroup value, $Res Function(_BatchCatalogueGroup) _then) = __$BatchCatalogueGroupCopyWithImpl;
@override @useResult
$Res call({
 int rowIndex, String catalogueId, List<String> jobIds
});




}
/// @nodoc
class __$BatchCatalogueGroupCopyWithImpl<$Res>
    implements _$BatchCatalogueGroupCopyWith<$Res> {
  __$BatchCatalogueGroupCopyWithImpl(this._self, this._then);

  final _BatchCatalogueGroup _self;
  final $Res Function(_BatchCatalogueGroup) _then;

/// Create a copy of BatchCatalogueGroup
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? rowIndex = null,Object? catalogueId = null,Object? jobIds = null,}) {
  return _then(_BatchCatalogueGroup(
rowIndex: null == rowIndex ? _self.rowIndex : rowIndex // ignore: cast_nullable_to_non_nullable
as int,catalogueId: null == catalogueId ? _self.catalogueId : catalogueId // ignore: cast_nullable_to_non_nullable
as String,jobIds: null == jobIds ? _self._jobIds : jobIds // ignore: cast_nullable_to_non_nullable
as List<String>,
  ));
}


}


/// @nodoc
mixin _$BatchSubmitResult {

 String get batchId; int get totalJobs; int get creditsCharged; List<BatchCatalogueGroup> get catalogues; List<String> get failedJobIds;
/// Create a copy of BatchSubmitResult
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$BatchSubmitResultCopyWith<BatchSubmitResult> get copyWith => _$BatchSubmitResultCopyWithImpl<BatchSubmitResult>(this as BatchSubmitResult, _$identity);

  /// Serializes this BatchSubmitResult to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as BatchSubmitResult;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is BatchSubmitResult&&(identical(other.batchId, _this.batchId) || other.batchId == _this.batchId)&&(identical(other.totalJobs, _this.totalJobs) || other.totalJobs == _this.totalJobs)&&(identical(other.creditsCharged, _this.creditsCharged) || other.creditsCharged == _this.creditsCharged)&&const DeepCollectionEquality().equals(other.catalogues, _this.catalogues)&&const DeepCollectionEquality().equals(other.failedJobIds, _this.failedJobIds));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as BatchSubmitResult;
  return Object.hash(runtimeType,_this.batchId,_this.totalJobs,_this.creditsCharged,const DeepCollectionEquality().hash(_this.catalogues),const DeepCollectionEquality().hash(_this.failedJobIds));
}

@override
String toString() {
  final _this = this as BatchSubmitResult;
  return 'BatchSubmitResult(batchId: ${_this.batchId}, totalJobs: ${_this.totalJobs}, creditsCharged: ${_this.creditsCharged}, catalogues: ${_this.catalogues}, failedJobIds: ${_this.failedJobIds})';
}


}

/// @nodoc
abstract mixin class $BatchSubmitResultCopyWith<$Res>  {
  factory $BatchSubmitResultCopyWith(BatchSubmitResult value, $Res Function(BatchSubmitResult) _then) = _$BatchSubmitResultCopyWithImpl;
@useResult
$Res call({
 String batchId, int totalJobs, int creditsCharged, List<BatchCatalogueGroup> catalogues, List<String> failedJobIds
});




}
/// @nodoc
class _$BatchSubmitResultCopyWithImpl<$Res>
    implements $BatchSubmitResultCopyWith<$Res> {
  _$BatchSubmitResultCopyWithImpl(this._self, this._then);

  final BatchSubmitResult _self;
  final $Res Function(BatchSubmitResult) _then;

/// Create a copy of BatchSubmitResult
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? batchId = null,Object? totalJobs = null,Object? creditsCharged = null,Object? catalogues = null,Object? failedJobIds = null,}) {
  return _then(BatchSubmitResult(
batchId: null == batchId ? _self.batchId : batchId // ignore: cast_nullable_to_non_nullable
as String,totalJobs: null == totalJobs ? _self.totalJobs : totalJobs // ignore: cast_nullable_to_non_nullable
as int,creditsCharged: null == creditsCharged ? _self.creditsCharged : creditsCharged // ignore: cast_nullable_to_non_nullable
as int,catalogues: null == catalogues ? _self.catalogues : catalogues // ignore: cast_nullable_to_non_nullable
as List<BatchCatalogueGroup>,failedJobIds: null == failedJobIds ? _self.failedJobIds : failedJobIds // ignore: cast_nullable_to_non_nullable
as List<String>,
  ));
}

}


/// Adds pattern-matching-related methods to [BatchSubmitResult].
extension BatchSubmitResultPatterns on BatchSubmitResult {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _BatchSubmitResult value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _BatchSubmitResult() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _BatchSubmitResult value)  $default,){
final _that = this;
switch (_that) {
case _BatchSubmitResult():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _BatchSubmitResult value)?  $default,){
final _that = this;
switch (_that) {
case _BatchSubmitResult() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String batchId,  int totalJobs,  int creditsCharged,  List<BatchCatalogueGroup> catalogues,  List<String> failedJobIds)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _BatchSubmitResult() when $default != null:
return $default(_that.batchId,_that.totalJobs,_that.creditsCharged,_that.catalogues,_that.failedJobIds);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String batchId,  int totalJobs,  int creditsCharged,  List<BatchCatalogueGroup> catalogues,  List<String> failedJobIds)  $default,) {final _that = this;
switch (_that) {
case _BatchSubmitResult():
return $default(_that.batchId,_that.totalJobs,_that.creditsCharged,_that.catalogues,_that.failedJobIds);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String batchId,  int totalJobs,  int creditsCharged,  List<BatchCatalogueGroup> catalogues,  List<String> failedJobIds)?  $default,) {final _that = this;
switch (_that) {
case _BatchSubmitResult() when $default != null:
return $default(_that.batchId,_that.totalJobs,_that.creditsCharged,_that.catalogues,_that.failedJobIds);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _BatchSubmitResult implements BatchSubmitResult {
  const _BatchSubmitResult({required this.batchId, required this.totalJobs, required this.creditsCharged, required  List<BatchCatalogueGroup> catalogues,  List<String> failedJobIds = const <String>[]}): _catalogues = catalogues,_failedJobIds = failedJobIds;
  factory _BatchSubmitResult.fromJson(Map<String, dynamic> json) => _$BatchSubmitResultFromJson(json);

@override final  String batchId;
@override final  int totalJobs;
@override final  int creditsCharged;
 final  List<BatchCatalogueGroup> _catalogues;
@override List<BatchCatalogueGroup> get catalogues {
  if (_catalogues is EqualUnmodifiableListView) return _catalogues;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_catalogues);
}

 final  List<String> _failedJobIds;
@override@JsonKey() List<String> get failedJobIds {
  if (_failedJobIds is EqualUnmodifiableListView) return _failedJobIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_failedJobIds);
}


/// Create a copy of BatchSubmitResult
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$BatchSubmitResultCopyWith<_BatchSubmitResult> get copyWith => __$BatchSubmitResultCopyWithImpl<_BatchSubmitResult>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$BatchSubmitResultToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _BatchSubmitResult&&(identical(other.batchId, batchId) || other.batchId == batchId)&&(identical(other.totalJobs, totalJobs) || other.totalJobs == totalJobs)&&(identical(other.creditsCharged, creditsCharged) || other.creditsCharged == creditsCharged)&&const DeepCollectionEquality().equals(other.catalogues, _catalogues)&&const DeepCollectionEquality().equals(other.failedJobIds, _failedJobIds));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,batchId,totalJobs,creditsCharged,const DeepCollectionEquality().hash(_catalogues),const DeepCollectionEquality().hash(_failedJobIds));
}

@override
String toString() {
    return 'BatchSubmitResult(batchId: $batchId, totalJobs: $totalJobs, creditsCharged: $creditsCharged, catalogues: $catalogues, failedJobIds: $failedJobIds)';
}


}

/// @nodoc
abstract mixin class _$BatchSubmitResultCopyWith<$Res> implements $BatchSubmitResultCopyWith<$Res> {
  factory _$BatchSubmitResultCopyWith(_BatchSubmitResult value, $Res Function(_BatchSubmitResult) _then) = __$BatchSubmitResultCopyWithImpl;
@override @useResult
$Res call({
 String batchId, int totalJobs, int creditsCharged, List<BatchCatalogueGroup> catalogues, List<String> failedJobIds
});




}
/// @nodoc
class __$BatchSubmitResultCopyWithImpl<$Res>
    implements _$BatchSubmitResultCopyWith<$Res> {
  __$BatchSubmitResultCopyWithImpl(this._self, this._then);

  final _BatchSubmitResult _self;
  final $Res Function(_BatchSubmitResult) _then;

/// Create a copy of BatchSubmitResult
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? batchId = null,Object? totalJobs = null,Object? creditsCharged = null,Object? catalogues = null,Object? failedJobIds = null,}) {
  return _then(_BatchSubmitResult(
batchId: null == batchId ? _self.batchId : batchId // ignore: cast_nullable_to_non_nullable
as String,totalJobs: null == totalJobs ? _self.totalJobs : totalJobs // ignore: cast_nullable_to_non_nullable
as int,creditsCharged: null == creditsCharged ? _self.creditsCharged : creditsCharged // ignore: cast_nullable_to_non_nullable
as int,catalogues: null == catalogues ? _self._catalogues : catalogues // ignore: cast_nullable_to_non_nullable
as List<BatchCatalogueGroup>,failedJobIds: null == failedJobIds ? _self._failedJobIds : failedJobIds // ignore: cast_nullable_to_non_nullable
as List<String>,
  ));
}


}

// dart format on
