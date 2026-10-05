// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'me_profile.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$MeProfile {

 String get id; String? get email; String? get displayName; String? get phone; String? get username; String? get companyName; String? get gstin; String get tier; String? get defaultResolution; String? get defaultAspectRatio; String? get defaultPlatform; bool get hasPassword; bool get hasShopifyStore; bool get isMerchant; bool get catalogVideoEnabled;
/// Create a copy of MeProfile
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MeProfileCopyWith<MeProfile> get copyWith => _$MeProfileCopyWithImpl<MeProfile>(this as MeProfile, _$identity);

  /// Serializes this MeProfile to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as MeProfile;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is MeProfile&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.email, _this.email) || other.email == _this.email)&&(identical(other.displayName, _this.displayName) || other.displayName == _this.displayName)&&(identical(other.phone, _this.phone) || other.phone == _this.phone)&&(identical(other.username, _this.username) || other.username == _this.username)&&(identical(other.companyName, _this.companyName) || other.companyName == _this.companyName)&&(identical(other.gstin, _this.gstin) || other.gstin == _this.gstin)&&(identical(other.tier, _this.tier) || other.tier == _this.tier)&&(identical(other.defaultResolution, _this.defaultResolution) || other.defaultResolution == _this.defaultResolution)&&(identical(other.defaultAspectRatio, _this.defaultAspectRatio) || other.defaultAspectRatio == _this.defaultAspectRatio)&&(identical(other.defaultPlatform, _this.defaultPlatform) || other.defaultPlatform == _this.defaultPlatform)&&(identical(other.hasPassword, _this.hasPassword) || other.hasPassword == _this.hasPassword)&&(identical(other.hasShopifyStore, _this.hasShopifyStore) || other.hasShopifyStore == _this.hasShopifyStore)&&(identical(other.isMerchant, _this.isMerchant) || other.isMerchant == _this.isMerchant)&&(identical(other.catalogVideoEnabled, _this.catalogVideoEnabled) || other.catalogVideoEnabled == _this.catalogVideoEnabled));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as MeProfile;
  return Object.hash(runtimeType,_this.id,_this.email,_this.displayName,_this.phone,_this.username,_this.companyName,_this.gstin,_this.tier,_this.defaultResolution,_this.defaultAspectRatio,_this.defaultPlatform,_this.hasPassword,_this.hasShopifyStore,_this.isMerchant,_this.catalogVideoEnabled);
}

@override
String toString() {
  final _this = this as MeProfile;
  return 'MeProfile(id: ${_this.id}, email: ${_this.email}, displayName: ${_this.displayName}, phone: ${_this.phone}, username: ${_this.username}, companyName: ${_this.companyName}, gstin: ${_this.gstin}, tier: ${_this.tier}, defaultResolution: ${_this.defaultResolution}, defaultAspectRatio: ${_this.defaultAspectRatio}, defaultPlatform: ${_this.defaultPlatform}, hasPassword: ${_this.hasPassword}, hasShopifyStore: ${_this.hasShopifyStore}, isMerchant: ${_this.isMerchant}, catalogVideoEnabled: ${_this.catalogVideoEnabled})';
}


}

/// @nodoc
abstract mixin class $MeProfileCopyWith<$Res>  {
  factory $MeProfileCopyWith(MeProfile value, $Res Function(MeProfile) _then) = _$MeProfileCopyWithImpl;
@useResult
$Res call({
 String id, String? email, String? displayName, String? phone, String? username, String? companyName, String? gstin, String tier, String? defaultResolution, String? defaultAspectRatio, String? defaultPlatform, bool hasPassword, bool hasShopifyStore, bool isMerchant, bool catalogVideoEnabled
});




}
/// @nodoc
class _$MeProfileCopyWithImpl<$Res>
    implements $MeProfileCopyWith<$Res> {
  _$MeProfileCopyWithImpl(this._self, this._then);

  final MeProfile _self;
  final $Res Function(MeProfile) _then;

/// Create a copy of MeProfile
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? email = freezed,Object? displayName = freezed,Object? phone = freezed,Object? username = freezed,Object? companyName = freezed,Object? gstin = freezed,Object? tier = null,Object? defaultResolution = freezed,Object? defaultAspectRatio = freezed,Object? defaultPlatform = freezed,Object? hasPassword = null,Object? hasShopifyStore = null,Object? isMerchant = null,Object? catalogVideoEnabled = null,}) {
  return _then(MeProfile(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,email: freezed == email ? _self.email : email // ignore: cast_nullable_to_non_nullable
as String?,displayName: freezed == displayName ? _self.displayName : displayName // ignore: cast_nullable_to_non_nullable
as String?,phone: freezed == phone ? _self.phone : phone // ignore: cast_nullable_to_non_nullable
as String?,username: freezed == username ? _self.username : username // ignore: cast_nullable_to_non_nullable
as String?,companyName: freezed == companyName ? _self.companyName : companyName // ignore: cast_nullable_to_non_nullable
as String?,gstin: freezed == gstin ? _self.gstin : gstin // ignore: cast_nullable_to_non_nullable
as String?,tier: null == tier ? _self.tier : tier // ignore: cast_nullable_to_non_nullable
as String,defaultResolution: freezed == defaultResolution ? _self.defaultResolution : defaultResolution // ignore: cast_nullable_to_non_nullable
as String?,defaultAspectRatio: freezed == defaultAspectRatio ? _self.defaultAspectRatio : defaultAspectRatio // ignore: cast_nullable_to_non_nullable
as String?,defaultPlatform: freezed == defaultPlatform ? _self.defaultPlatform : defaultPlatform // ignore: cast_nullable_to_non_nullable
as String?,hasPassword: null == hasPassword ? _self.hasPassword : hasPassword // ignore: cast_nullable_to_non_nullable
as bool,hasShopifyStore: null == hasShopifyStore ? _self.hasShopifyStore : hasShopifyStore // ignore: cast_nullable_to_non_nullable
as bool,isMerchant: null == isMerchant ? _self.isMerchant : isMerchant // ignore: cast_nullable_to_non_nullable
as bool,catalogVideoEnabled: null == catalogVideoEnabled ? _self.catalogVideoEnabled : catalogVideoEnabled // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [MeProfile].
extension MeProfilePatterns on MeProfile {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _MeProfile value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _MeProfile() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _MeProfile value)  $default,){
final _that = this;
switch (_that) {
case _MeProfile():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _MeProfile value)?  $default,){
final _that = this;
switch (_that) {
case _MeProfile() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String? email,  String? displayName,  String? phone,  String? username,  String? companyName,  String? gstin,  String tier,  String? defaultResolution,  String? defaultAspectRatio,  String? defaultPlatform,  bool hasPassword,  bool hasShopifyStore,  bool isMerchant,  bool catalogVideoEnabled)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _MeProfile() when $default != null:
return $default(_that.id,_that.email,_that.displayName,_that.phone,_that.username,_that.companyName,_that.gstin,_that.tier,_that.defaultResolution,_that.defaultAspectRatio,_that.defaultPlatform,_that.hasPassword,_that.hasShopifyStore,_that.isMerchant,_that.catalogVideoEnabled);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String? email,  String? displayName,  String? phone,  String? username,  String? companyName,  String? gstin,  String tier,  String? defaultResolution,  String? defaultAspectRatio,  String? defaultPlatform,  bool hasPassword,  bool hasShopifyStore,  bool isMerchant,  bool catalogVideoEnabled)  $default,) {final _that = this;
switch (_that) {
case _MeProfile():
return $default(_that.id,_that.email,_that.displayName,_that.phone,_that.username,_that.companyName,_that.gstin,_that.tier,_that.defaultResolution,_that.defaultAspectRatio,_that.defaultPlatform,_that.hasPassword,_that.hasShopifyStore,_that.isMerchant,_that.catalogVideoEnabled);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String? email,  String? displayName,  String? phone,  String? username,  String? companyName,  String? gstin,  String tier,  String? defaultResolution,  String? defaultAspectRatio,  String? defaultPlatform,  bool hasPassword,  bool hasShopifyStore,  bool isMerchant,  bool catalogVideoEnabled)?  $default,) {final _that = this;
switch (_that) {
case _MeProfile() when $default != null:
return $default(_that.id,_that.email,_that.displayName,_that.phone,_that.username,_that.companyName,_that.gstin,_that.tier,_that.defaultResolution,_that.defaultAspectRatio,_that.defaultPlatform,_that.hasPassword,_that.hasShopifyStore,_that.isMerchant,_that.catalogVideoEnabled);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _MeProfile implements MeProfile {
  const _MeProfile({required this.id, this.email, this.displayName, this.phone, this.username, this.companyName, this.gstin, required this.tier, this.defaultResolution, this.defaultAspectRatio, this.defaultPlatform, required this.hasPassword, required this.hasShopifyStore, required this.isMerchant, required this.catalogVideoEnabled});
  factory _MeProfile.fromJson(Map<String, dynamic> json) => _$MeProfileFromJson(json);

@override final  String id;
@override final  String? email;
@override final  String? displayName;
@override final  String? phone;
@override final  String? username;
@override final  String? companyName;
@override final  String? gstin;
@override final  String tier;
@override final  String? defaultResolution;
@override final  String? defaultAspectRatio;
@override final  String? defaultPlatform;
@override final  bool hasPassword;
@override final  bool hasShopifyStore;
@override final  bool isMerchant;
@override final  bool catalogVideoEnabled;

/// Create a copy of MeProfile
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$MeProfileCopyWith<_MeProfile> get copyWith => __$MeProfileCopyWithImpl<_MeProfile>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$MeProfileToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _MeProfile&&(identical(other.id, id) || other.id == id)&&(identical(other.email, email) || other.email == email)&&(identical(other.displayName, displayName) || other.displayName == displayName)&&(identical(other.phone, phone) || other.phone == phone)&&(identical(other.username, username) || other.username == username)&&(identical(other.companyName, companyName) || other.companyName == companyName)&&(identical(other.gstin, gstin) || other.gstin == gstin)&&(identical(other.tier, tier) || other.tier == tier)&&(identical(other.defaultResolution, defaultResolution) || other.defaultResolution == defaultResolution)&&(identical(other.defaultAspectRatio, defaultAspectRatio) || other.defaultAspectRatio == defaultAspectRatio)&&(identical(other.defaultPlatform, defaultPlatform) || other.defaultPlatform == defaultPlatform)&&(identical(other.hasPassword, hasPassword) || other.hasPassword == hasPassword)&&(identical(other.hasShopifyStore, hasShopifyStore) || other.hasShopifyStore == hasShopifyStore)&&(identical(other.isMerchant, isMerchant) || other.isMerchant == isMerchant)&&(identical(other.catalogVideoEnabled, catalogVideoEnabled) || other.catalogVideoEnabled == catalogVideoEnabled));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,email,displayName,phone,username,companyName,gstin,tier,defaultResolution,defaultAspectRatio,defaultPlatform,hasPassword,hasShopifyStore,isMerchant,catalogVideoEnabled);
}

@override
String toString() {
    return 'MeProfile(id: $id, email: $email, displayName: $displayName, phone: $phone, username: $username, companyName: $companyName, gstin: $gstin, tier: $tier, defaultResolution: $defaultResolution, defaultAspectRatio: $defaultAspectRatio, defaultPlatform: $defaultPlatform, hasPassword: $hasPassword, hasShopifyStore: $hasShopifyStore, isMerchant: $isMerchant, catalogVideoEnabled: $catalogVideoEnabled)';
}


}

/// @nodoc
abstract mixin class _$MeProfileCopyWith<$Res> implements $MeProfileCopyWith<$Res> {
  factory _$MeProfileCopyWith(_MeProfile value, $Res Function(_MeProfile) _then) = __$MeProfileCopyWithImpl;
@override @useResult
$Res call({
 String id, String? email, String? displayName, String? phone, String? username, String? companyName, String? gstin, String tier, String? defaultResolution, String? defaultAspectRatio, String? defaultPlatform, bool hasPassword, bool hasShopifyStore, bool isMerchant, bool catalogVideoEnabled
});




}
/// @nodoc
class __$MeProfileCopyWithImpl<$Res>
    implements _$MeProfileCopyWith<$Res> {
  __$MeProfileCopyWithImpl(this._self, this._then);

  final _MeProfile _self;
  final $Res Function(_MeProfile) _then;

/// Create a copy of MeProfile
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? email = freezed,Object? displayName = freezed,Object? phone = freezed,Object? username = freezed,Object? companyName = freezed,Object? gstin = freezed,Object? tier = null,Object? defaultResolution = freezed,Object? defaultAspectRatio = freezed,Object? defaultPlatform = freezed,Object? hasPassword = null,Object? hasShopifyStore = null,Object? isMerchant = null,Object? catalogVideoEnabled = null,}) {
  return _then(_MeProfile(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,email: freezed == email ? _self.email : email // ignore: cast_nullable_to_non_nullable
as String?,displayName: freezed == displayName ? _self.displayName : displayName // ignore: cast_nullable_to_non_nullable
as String?,phone: freezed == phone ? _self.phone : phone // ignore: cast_nullable_to_non_nullable
as String?,username: freezed == username ? _self.username : username // ignore: cast_nullable_to_non_nullable
as String?,companyName: freezed == companyName ? _self.companyName : companyName // ignore: cast_nullable_to_non_nullable
as String?,gstin: freezed == gstin ? _self.gstin : gstin // ignore: cast_nullable_to_non_nullable
as String?,tier: null == tier ? _self.tier : tier // ignore: cast_nullable_to_non_nullable
as String,defaultResolution: freezed == defaultResolution ? _self.defaultResolution : defaultResolution // ignore: cast_nullable_to_non_nullable
as String?,defaultAspectRatio: freezed == defaultAspectRatio ? _self.defaultAspectRatio : defaultAspectRatio // ignore: cast_nullable_to_non_nullable
as String?,defaultPlatform: freezed == defaultPlatform ? _self.defaultPlatform : defaultPlatform // ignore: cast_nullable_to_non_nullable
as String?,hasPassword: null == hasPassword ? _self.hasPassword : hasPassword // ignore: cast_nullable_to_non_nullable
as bool,hasShopifyStore: null == hasShopifyStore ? _self.hasShopifyStore : hasShopifyStore // ignore: cast_nullable_to_non_nullable
as bool,isMerchant: null == isMerchant ? _self.isMerchant : isMerchant // ignore: cast_nullable_to_non_nullable
as bool,catalogVideoEnabled: null == catalogVideoEnabled ? _self.catalogVideoEnabled : catalogVideoEnabled // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}

// dart format on
