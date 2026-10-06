// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'credits_summary.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CreditLedgerRow {

 String get id; int get delta; String get reason; String get createdAt; String? get jobSource; String? get garmentType;
/// Create a copy of CreditLedgerRow
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CreditLedgerRowCopyWith<CreditLedgerRow> get copyWith => _$CreditLedgerRowCopyWithImpl<CreditLedgerRow>(this as CreditLedgerRow, _$identity);

  /// Serializes this CreditLedgerRow to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CreditLedgerRow;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CreditLedgerRow&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.delta, _this.delta) || other.delta == _this.delta)&&(identical(other.reason, _this.reason) || other.reason == _this.reason)&&(identical(other.createdAt, _this.createdAt) || other.createdAt == _this.createdAt)&&(identical(other.jobSource, _this.jobSource) || other.jobSource == _this.jobSource)&&(identical(other.garmentType, _this.garmentType) || other.garmentType == _this.garmentType));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CreditLedgerRow;
  return Object.hash(runtimeType,_this.id,_this.delta,_this.reason,_this.createdAt,_this.jobSource,_this.garmentType);
}

@override
String toString() {
  final _this = this as CreditLedgerRow;
  return 'CreditLedgerRow(id: ${_this.id}, delta: ${_this.delta}, reason: ${_this.reason}, createdAt: ${_this.createdAt}, jobSource: ${_this.jobSource}, garmentType: ${_this.garmentType})';
}


}

/// @nodoc
abstract mixin class $CreditLedgerRowCopyWith<$Res>  {
  factory $CreditLedgerRowCopyWith(CreditLedgerRow value, $Res Function(CreditLedgerRow) _then) = _$CreditLedgerRowCopyWithImpl;
@useResult
$Res call({
 String id, int delta, String reason, String createdAt, String? jobSource, String? garmentType
});




}
/// @nodoc
class _$CreditLedgerRowCopyWithImpl<$Res>
    implements $CreditLedgerRowCopyWith<$Res> {
  _$CreditLedgerRowCopyWithImpl(this._self, this._then);

  final CreditLedgerRow _self;
  final $Res Function(CreditLedgerRow) _then;

/// Create a copy of CreditLedgerRow
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? delta = null,Object? reason = null,Object? createdAt = null,Object? jobSource = freezed,Object? garmentType = freezed,}) {
  return _then(CreditLedgerRow(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,delta: null == delta ? _self.delta : delta // ignore: cast_nullable_to_non_nullable
as int,reason: null == reason ? _self.reason : reason // ignore: cast_nullable_to_non_nullable
as String,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,jobSource: freezed == jobSource ? _self.jobSource : jobSource // ignore: cast_nullable_to_non_nullable
as String?,garmentType: freezed == garmentType ? _self.garmentType : garmentType // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [CreditLedgerRow].
extension CreditLedgerRowPatterns on CreditLedgerRow {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CreditLedgerRow value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CreditLedgerRow() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CreditLedgerRow value)  $default,){
final _that = this;
switch (_that) {
case _CreditLedgerRow():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CreditLedgerRow value)?  $default,){
final _that = this;
switch (_that) {
case _CreditLedgerRow() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  int delta,  String reason,  String createdAt,  String? jobSource,  String? garmentType)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CreditLedgerRow() when $default != null:
return $default(_that.id,_that.delta,_that.reason,_that.createdAt,_that.jobSource,_that.garmentType);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  int delta,  String reason,  String createdAt,  String? jobSource,  String? garmentType)  $default,) {final _that = this;
switch (_that) {
case _CreditLedgerRow():
return $default(_that.id,_that.delta,_that.reason,_that.createdAt,_that.jobSource,_that.garmentType);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  int delta,  String reason,  String createdAt,  String? jobSource,  String? garmentType)?  $default,) {final _that = this;
switch (_that) {
case _CreditLedgerRow() when $default != null:
return $default(_that.id,_that.delta,_that.reason,_that.createdAt,_that.jobSource,_that.garmentType);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CreditLedgerRow implements CreditLedgerRow {
  const _CreditLedgerRow({required this.id, this.delta = 0, this.reason = '', this.createdAt = '', this.jobSource, this.garmentType});
  factory _CreditLedgerRow.fromJson(Map<String, dynamic> json) => _$CreditLedgerRowFromJson(json);

@override final  String id;
@override@JsonKey() final  int delta;
@override@JsonKey() final  String reason;
@override@JsonKey() final  String createdAt;
@override final  String? jobSource;
@override final  String? garmentType;

/// Create a copy of CreditLedgerRow
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CreditLedgerRowCopyWith<_CreditLedgerRow> get copyWith => __$CreditLedgerRowCopyWithImpl<_CreditLedgerRow>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CreditLedgerRowToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CreditLedgerRow&&(identical(other.id, id) || other.id == id)&&(identical(other.delta, delta) || other.delta == delta)&&(identical(other.reason, reason) || other.reason == reason)&&(identical(other.createdAt, createdAt) || other.createdAt == createdAt)&&(identical(other.jobSource, jobSource) || other.jobSource == jobSource)&&(identical(other.garmentType, garmentType) || other.garmentType == garmentType));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,delta,reason,createdAt,jobSource,garmentType);
}

@override
String toString() {
    return 'CreditLedgerRow(id: $id, delta: $delta, reason: $reason, createdAt: $createdAt, jobSource: $jobSource, garmentType: $garmentType)';
}


}

/// @nodoc
abstract mixin class _$CreditLedgerRowCopyWith<$Res> implements $CreditLedgerRowCopyWith<$Res> {
  factory _$CreditLedgerRowCopyWith(_CreditLedgerRow value, $Res Function(_CreditLedgerRow) _then) = __$CreditLedgerRowCopyWithImpl;
@override @useResult
$Res call({
 String id, int delta, String reason, String createdAt, String? jobSource, String? garmentType
});




}
/// @nodoc
class __$CreditLedgerRowCopyWithImpl<$Res>
    implements _$CreditLedgerRowCopyWith<$Res> {
  __$CreditLedgerRowCopyWithImpl(this._self, this._then);

  final _CreditLedgerRow _self;
  final $Res Function(_CreditLedgerRow) _then;

/// Create a copy of CreditLedgerRow
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? delta = null,Object? reason = null,Object? createdAt = null,Object? jobSource = freezed,Object? garmentType = freezed,}) {
  return _then(_CreditLedgerRow(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,delta: null == delta ? _self.delta : delta // ignore: cast_nullable_to_non_nullable
as int,reason: null == reason ? _self.reason : reason // ignore: cast_nullable_to_non_nullable
as String,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,jobSource: freezed == jobSource ? _self.jobSource : jobSource // ignore: cast_nullable_to_non_nullable
as String?,garmentType: freezed == garmentType ? _self.garmentType : garmentType // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}


/// @nodoc
mixin _$CreditsSummary {

 int get balance; List<CreditLedgerRow> get recent; Map<String, dynamic>? get unlimitedPlan;
/// Create a copy of CreditsSummary
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CreditsSummaryCopyWith<CreditsSummary> get copyWith => _$CreditsSummaryCopyWithImpl<CreditsSummary>(this as CreditsSummary, _$identity);

  /// Serializes this CreditsSummary to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CreditsSummary;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CreditsSummary&&(identical(other.balance, _this.balance) || other.balance == _this.balance)&&const DeepCollectionEquality().equals(other.recent, _this.recent)&&const DeepCollectionEquality().equals(other.unlimitedPlan, _this.unlimitedPlan));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CreditsSummary;
  return Object.hash(runtimeType,_this.balance,const DeepCollectionEquality().hash(_this.recent),const DeepCollectionEquality().hash(_this.unlimitedPlan));
}

@override
String toString() {
  final _this = this as CreditsSummary;
  return 'CreditsSummary(balance: ${_this.balance}, recent: ${_this.recent}, unlimitedPlan: ${_this.unlimitedPlan})';
}


}

/// @nodoc
abstract mixin class $CreditsSummaryCopyWith<$Res>  {
  factory $CreditsSummaryCopyWith(CreditsSummary value, $Res Function(CreditsSummary) _then) = _$CreditsSummaryCopyWithImpl;
@useResult
$Res call({
 int balance, List<CreditLedgerRow> recent, Map<String, dynamic>? unlimitedPlan
});




}
/// @nodoc
class _$CreditsSummaryCopyWithImpl<$Res>
    implements $CreditsSummaryCopyWith<$Res> {
  _$CreditsSummaryCopyWithImpl(this._self, this._then);

  final CreditsSummary _self;
  final $Res Function(CreditsSummary) _then;

/// Create a copy of CreditsSummary
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? balance = null,Object? recent = null,Object? unlimitedPlan = freezed,}) {
  return _then(CreditsSummary(
balance: null == balance ? _self.balance : balance // ignore: cast_nullable_to_non_nullable
as int,recent: null == recent ? _self.recent : recent // ignore: cast_nullable_to_non_nullable
as List<CreditLedgerRow>,unlimitedPlan: freezed == unlimitedPlan ? _self.unlimitedPlan : unlimitedPlan // ignore: cast_nullable_to_non_nullable
as Map<String, dynamic>?,
  ));
}

}


/// Adds pattern-matching-related methods to [CreditsSummary].
extension CreditsSummaryPatterns on CreditsSummary {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CreditsSummary value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CreditsSummary() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CreditsSummary value)  $default,){
final _that = this;
switch (_that) {
case _CreditsSummary():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CreditsSummary value)?  $default,){
final _that = this;
switch (_that) {
case _CreditsSummary() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int balance,  List<CreditLedgerRow> recent,  Map<String, dynamic>? unlimitedPlan)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CreditsSummary() when $default != null:
return $default(_that.balance,_that.recent,_that.unlimitedPlan);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int balance,  List<CreditLedgerRow> recent,  Map<String, dynamic>? unlimitedPlan)  $default,) {final _that = this;
switch (_that) {
case _CreditsSummary():
return $default(_that.balance,_that.recent,_that.unlimitedPlan);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int balance,  List<CreditLedgerRow> recent,  Map<String, dynamic>? unlimitedPlan)?  $default,) {final _that = this;
switch (_that) {
case _CreditsSummary() when $default != null:
return $default(_that.balance,_that.recent,_that.unlimitedPlan);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CreditsSummary implements CreditsSummary {
  const _CreditsSummary({this.balance = 0,  List<CreditLedgerRow> recent = const [],  Map<String, dynamic>? unlimitedPlan}): _recent = recent,_unlimitedPlan = unlimitedPlan;
  factory _CreditsSummary.fromJson(Map<String, dynamic> json) => _$CreditsSummaryFromJson(json);

@override@JsonKey() final  int balance;
 final  List<CreditLedgerRow> _recent;
@override@JsonKey() List<CreditLedgerRow> get recent {
  if (_recent is EqualUnmodifiableListView) return _recent;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_recent);
}

 final  Map<String, dynamic>? _unlimitedPlan;
@override Map<String, dynamic>? get unlimitedPlan {
  final value = _unlimitedPlan;
  if (value == null) return null;
  if (_unlimitedPlan is EqualUnmodifiableMapView) return _unlimitedPlan;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableMapView(value);
}


/// Create a copy of CreditsSummary
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CreditsSummaryCopyWith<_CreditsSummary> get copyWith => __$CreditsSummaryCopyWithImpl<_CreditsSummary>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CreditsSummaryToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CreditsSummary&&(identical(other.balance, balance) || other.balance == balance)&&const DeepCollectionEquality().equals(other.recent, _recent)&&const DeepCollectionEquality().equals(other.unlimitedPlan, _unlimitedPlan));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,balance,const DeepCollectionEquality().hash(_recent),const DeepCollectionEquality().hash(_unlimitedPlan));
}

@override
String toString() {
    return 'CreditsSummary(balance: $balance, recent: $recent, unlimitedPlan: $unlimitedPlan)';
}


}

/// @nodoc
abstract mixin class _$CreditsSummaryCopyWith<$Res> implements $CreditsSummaryCopyWith<$Res> {
  factory _$CreditsSummaryCopyWith(_CreditsSummary value, $Res Function(_CreditsSummary) _then) = __$CreditsSummaryCopyWithImpl;
@override @useResult
$Res call({
 int balance, List<CreditLedgerRow> recent, Map<String, dynamic>? unlimitedPlan
});




}
/// @nodoc
class __$CreditsSummaryCopyWithImpl<$Res>
    implements _$CreditsSummaryCopyWith<$Res> {
  __$CreditsSummaryCopyWithImpl(this._self, this._then);

  final _CreditsSummary _self;
  final $Res Function(_CreditsSummary) _then;

/// Create a copy of CreditsSummary
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? balance = null,Object? recent = null,Object? unlimitedPlan = freezed,}) {
  return _then(_CreditsSummary(
balance: null == balance ? _self.balance : balance // ignore: cast_nullable_to_non_nullable
as int,recent: null == recent ? _self._recent : recent // ignore: cast_nullable_to_non_nullable
as List<CreditLedgerRow>,unlimitedPlan: freezed == unlimitedPlan ? _self._unlimitedPlan : unlimitedPlan // ignore: cast_nullable_to_non_nullable
as Map<String, dynamic>?,
  ));
}


}

// dart format on
