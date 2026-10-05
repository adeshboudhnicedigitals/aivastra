/// Bridges the UI's singular "Catalogue For" labels (Women/Men/Boy/Girl,
/// from [AppStrings.filterCategory*]) to the backend's plural gender slugs
/// (women|men|boys|girls) used as the `gender` query param everywhere.
enum Gender {
  women('women', 'Women'),
  men('men', 'Men'),
  boys('boys', 'Boy'),
  girls('girls', 'Girl');

  const Gender(this.apiValue, this.displayLabel);

  final String apiValue;
  final String displayLabel;

  static Gender fromDisplayLabel(String label) {
    return Gender.values.firstWhere(
      (g) => g.displayLabel == label,
      orElse: () => Gender.women,
    );
  }
}
