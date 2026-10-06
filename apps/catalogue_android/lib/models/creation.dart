import '../utils/app_strings.dart';

/// Current selection across the My Creations filter sheet's three
/// sections. Matching against real catalogue/catalog-video rows happens in
/// `my_creations_page.dart`, since the two backends don't share a single
/// domain type to filter against.
class CreationFilters {
  const CreationFilters({
    this.creationType = AppStrings.creationTypeAll,
    this.category = AppStrings.filterCategoryAll,
    this.createdOn = AppStrings.filterCreatedAll,
  });

  final String creationType;
  final String category;
  final String createdOn;

  bool get isDefault =>
      creationType == AppStrings.creationTypeAll &&
      category == AppStrings.filterCategoryAll &&
      createdOn == AppStrings.filterCreatedAll;

  CreationFilters copyWith({
    String? creationType,
    String? category,
    String? createdOn,
  }) {
    return CreationFilters(
      creationType: creationType ?? this.creationType,
      category: category ?? this.category,
      createdOn: createdOn ?? this.createdOn,
    );
  }
}
