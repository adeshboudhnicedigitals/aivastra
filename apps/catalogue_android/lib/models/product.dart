import '../utils/app_strings.dart';

/// Current selection across the Products filter sheet. `GET /v1/assets`
/// only ever returns the account's own uploaded garment photos — no
/// asset-type/category/outfit-type metadata exists server-side for them —
/// so unlike the mock data this replaced, "Created On" is the only real
/// filter dimension.
class ProductFilters {
  const ProductFilters({this.createdOn = AppStrings.filterCreatedAll});

  final String createdOn;

  bool get isDefault => createdOn == AppStrings.filterCreatedAll;

  ProductFilters copyWith({String? createdOn}) {
    return ProductFilters(createdOn: createdOn ?? this.createdOn);
  }
}
