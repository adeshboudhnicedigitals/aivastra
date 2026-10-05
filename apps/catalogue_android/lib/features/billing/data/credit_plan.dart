/// One purchasable credit pack, as returned by `GET /v1/payments/plans`
/// (the same rows the web pricing page renders).
class CreditPlan {
  const CreditPlan({
    required this.id,
    required this.slug,
    required this.name,
    required this.credits,
    required this.basePaise,
    required this.sortOrder,
    required this.planType,
    this.subtext = '',
    this.badge,
    this.isHighlighted = false,
  });

  factory CreditPlan.fromJson(Map<String, dynamic> json) => CreditPlan(
    id: '${json['id'] ?? ''}',
    slug: '${json['slug'] ?? ''}',
    name: '${json['name'] ?? ''}',
    credits: (json['credits'] as num?)?.toInt() ?? 0,
    basePaise: (json['basePaise'] as num?)?.toInt() ?? 0,
    sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
    planType: '${json['planType'] ?? 'catalogue'}',
    subtext: '${json['subtext'] ?? ''}',
    badge: json['badge'] as String?,
    isHighlighted: json['isHighlighted'] == true,
  );

  final String id;
  final String slug;
  final String name;
  final int credits;

  /// Price before GST, in paise (GST is added at checkout).
  final int basePaise;
  final int sortOrder;

  /// `catalogue` or `tryon`.
  final String planType;
  final String subtext;
  final String? badge;
  final bool isHighlighted;
}
