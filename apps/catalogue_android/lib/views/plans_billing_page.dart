import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../config/app_config.dart';
import '../core/utils/format_money.dart';
import '../features/auth/application/auth_providers.dart';
import '../features/billing/application/billing_providers.dart';
import '../features/billing/data/credit_plan.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/gradient_button.dart';

/// Plans & Billing, on live data: the packs come from
/// `GET /v1/payments/plans`, the balance and unlimited-plan status from
/// `GET /v1/credits`, and the plan tier from `GET /v1/me`.
///
/// Checkout is handed to the web app (`/pricing?plan=<slug>` opens the
/// payment sheet straight away) - the in-app Razorpay flow isn't built.
class PlansBillingPage extends ConsumerStatefulWidget {
  const PlansBillingPage({super.key});

  @override
  ConsumerState<PlansBillingPage> createState() => _PlansBillingPageState();
}

class _PlansBillingPageState extends ConsumerState<PlansBillingPage> {
  /// null until the user toggles a card; then the highlighted pack (or the
  /// first) is open by default.
  int? _expandedIndex;

  // The web pricing page's own feature lists, by pack position: the entry
  // pack is single-image, the rest bulk.
  static const _features = [
    [
      AppStrings.standardAiModels,
      AppStrings.standardBackgrounds,
      AppStrings.singleCatalogueGeneration,
      AppStrings.productCatalogueTemplates,
      AppStrings.emailSupportFeature,
    ],
    [
      AppStrings.standardAiModels,
      AppStrings.standardBackgrounds,
      AppStrings.bulkCatalogueGeneration,
      AppStrings.productCatalogueTemplates,
      AppStrings.emailSupportFeature,
    ],
  ];

  static const _icons = [
    Icons.rocket_launch_rounded,
    Icons.trending_up_rounded,
    Icons.workspace_premium_rounded,
    Icons.apartment_rounded,
  ];

  static String _number(int n) => formatInr(n).substring(1);

  Future<void> _openCheckout([String? slug]) async {
    final uri = Uri.parse(
      '${AppConfig.webUrl}/pricing${slug == null ? '' : '?plan=$slug'}',
    );
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open the pricing page.')),
      );
    }
  }

  static String _formatDate(String iso) {
    final dt = DateTime.tryParse(iso)?.toLocal();
    if (dt == null) return '';
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${dt.day} ${months[dt.month - 1]} ${dt.year}';
  }

  @override
  Widget build(BuildContext context) {
    final sectionGap = AppDimens.sdp(context, '_28sdp');
    final labelGap = AppDimens.sdp(context, '_10sdp');
    final cardGap = AppDimens.sdp(context, '_12sdp');

    final plansAsync = ref.watch(creditPlansProvider);
    final credits = ref.watch(creditsSummaryProvider).value;
    final tier = ref.watch(currentProfileProvider)?.tier;

    final plans = plansAsync.value ?? const <CreditPlan>[];
    // The plan the account is on, if it matches a pack (tier is the plan slug).
    final current = plans.where((p) => p.slug == tier).firstOrNull;
    final tierName = tier == null || tier.isEmpty
        ? '—'
        : '${tier[0].toUpperCase()}${tier.substring(1)}';

    final unlimited = credits?.unlimitedPlan;
    final unlimitedStatus = unlimited?['status'] as String?;
    final isUnlimited =
        unlimitedStatus == 'active' || unlimitedStatus == 'expiring_soon';
    final endAt = unlimited?['endAt'] as String?;
    final daysLeft = (unlimited?['daysRemaining'] as num?)?.toInt();

    final expanded =
        _expandedIndex ??
        (plans.indexWhere((p) => p.isHighlighted) == -1
            ? 0
            : plans.indexWhere((p) => p.isHighlighted));

    return DetailPageScaffold(
      title: AppStrings.plansAndBilling,
      subtitle: AppStrings.plansAndBillingSubtitle,
      children: [
        const SectionLabel(AppStrings.currentPlanSection),
        SizedBox(height: labelGap),
        _CurrentPlanCard(
          planName: current?.name ?? tierName,
          creditsRemaining: credits?.balance,
          unlimitedLine: isUnlimited
              ? 'Unlimited plan${daysLeft == null ? '' : ' · $daysLeft days left'}'
              : null,
          renewsOn: isUnlimited && endAt != null ? _formatDate(endAt) : null,
          onUpgrade: _openCheckout,
        ),
        SizedBox(height: sectionGap),
        const SectionLabel(AppStrings.availablePlansSection),
        SizedBox(height: AppDimens.sdp(context, '_4sdp')),
        Text(
          AppStrings.availablePlansSubtitle,
          style: AppTextStyles.regular.copyWith(
            color: AppColors.textSecondary,
            fontSize: AppDimens.ssp(context, '_12ssp'),
          ),
        ),
        SizedBox(height: labelGap),
        plansAsync.when(
          loading: () => const AppLoader.section(),
          error: (_, _) => const InlineErrorBanner(
            message: 'Could not load the plans. Please try again.',
          ),
          data: (plans) => Column(
            children: [
              for (var i = 0; i < plans.length; i++) ...[
                _PlanCard(
                  plan: _Plan(
                    icon: _icons[i.clamp(0, _icons.length - 1)],
                    name: plans[i].name,
                    creditsLabel:
                        '${_number(plans[i].credits)} ${AppStrings.creditsLabel}',
                    price: formatInr(plans[i].basePaise ~/ 100),
                    badge: plans[i].isHighlighted
                        ? (plans[i].badge ?? AppStrings.bestValue)
                        : null,
                    features: _features[i == 0 ? 0 : 1],
                    slug: plans[i].slug,
                  ),
                  isExpanded: expanded == i,
                  onToggle: () =>
                      setState(() => _expandedIndex = expanded == i ? -1 : i),
                  onChoose: () => _openCheckout(plans[i].slug),
                ),
                if (i != plans.length - 1) SizedBox(height: cardGap),
              ],
              SizedBox(height: AppDimens.sdp(context, '_12sdp')),
              Text(
                'Prices are before GST. Payment is completed securely on the '
                'AI Vastra website.',
                textAlign: TextAlign.center,
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_11ssp'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _CurrentPlanCard extends StatelessWidget {
  const _CurrentPlanCard({
    required this.planName,
    required this.creditsRemaining,
    required this.unlimitedLine,
    required this.renewsOn,
    required this.onUpgrade,
  });

  final String planName;
  final int? creditsRemaining;
  final String? unlimitedLine;
  final String? renewsOn;
  final VoidCallback onUpgrade;

  @override
  Widget build(BuildContext context) {
    return GlowCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      planName,
                      style: AppTextStyles.bold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_16ssp'),
                      ),
                    ),
                    SizedBox(height: AppDimens.sdp(context, '_6sdp')),
                    Text(
                      unlimitedLine ??
                          '${creditsRemaining ?? '—'} ${AppStrings.creditsRemainingLabel}',
                      style: AppTextStyles.regular.copyWith(
                        color: AppColors.textSecondary,
                        fontSize: AppDimens.ssp(context, '_12ssp'),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(width: AppDimens.sdp(context, '_8sdp')),
              AppPillButton(
                label: AppStrings.upgradePlan,
                style: AppPillButtonStyle.light,
                trailingIcon: Icons.arrow_forward_rounded,
                onTap: onUpgrade,
              ),
            ],
          ),
          if (renewsOn != null) ...[
            SizedBox(height: AppDimens.sdp(context, '_12sdp')),
            Row(
              children: [
                Icon(
                  Icons.calendar_today_rounded,
                  color: AppColors.textSecondary,
                  size: AppDimens.sdp(context, '_12sdp'),
                ),
                SizedBox(width: AppDimens.sdp(context, '_6sdp')),
                Text(
                  '${AppStrings.renewsOnLabel} $renewsOn',
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_11ssp'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Plan {
  const _Plan({
    required this.icon,
    required this.name,
    required this.creditsLabel,
    required this.price,
    this.badge,
    this.slug = '',
    this.features = const [],
  });

  final IconData icon;
  final String name;
  final String creditsLabel;
  final String price;

  /// Badge shown next to the name (from the admin), null for none.
  final String? badge;
  final String slug;
  final List<String> features;

  /// Plan name without the trailing "Pack", e.g. "Growth" for the CTA
  /// button label ("Choose Growth").
  String get shortName => name.replaceFirst(' Pack', '');
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.plan,
    required this.isExpanded,
    required this.onToggle,
    required this.onChoose,
  });

  final _Plan plan;
  final bool isExpanded;
  final VoidCallback onToggle;
  final VoidCallback onChoose;

  @override
  Widget build(BuildContext context) {
    final iconBoxSize = AppDimens.sdp(context, '_36sdp');
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_18sdp'));

    return Container(
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: radius,
        border: Border.all(
          color: isExpanded
              ? AppColors.pinkGradientStart.withValues(alpha: 0.5)
              : AppColors.fieldBorder,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
              child: Row(
                children: [
                  Container(
                    width: iconBoxSize,
                    height: iconBoxSize,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(
                        AppDimens.sdp(context, '_10sdp'),
                      ),
                    ),
                    child: Icon(
                      plan.icon,
                      color: Colors.white,
                      size: AppDimens.sdp(context, '_18sdp'),
                    ),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_12sdp')),
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                plan.name,
                                overflow: TextOverflow.ellipsis,
                                style: AppTextStyles.semiBold.copyWith(
                                  color: Colors.white,
                                  fontSize: AppDimens.ssp(context, '_14ssp'),
                                ),
                              ),
                            ),
                            if (plan.badge != null) ...[
                              SizedBox(width: AppDimens.sdp(context, '_6sdp')),
                              _BestValueBadge(label: plan.badge!),
                            ],
                          ],
                        ),
                        SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                        Text(
                          plan.creditsLabel,
                          style: AppTextStyles.regular.copyWith(
                            color: AppColors.textSecondary,
                            fontSize: AppDimens.ssp(context, '_11ssp'),
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                  Text(
                    plan.price,
                    style: AppTextStyles.bold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(context, '_14ssp'),
                    ),
                  ),
                  Icon(
                    isExpanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    color: AppColors.textSecondary,
                    size: AppDimens.sdp(context, '_20sdp'),
                  ),
                ],
              ),
            ),
          ),
          if (isExpanded && plan.features.isNotEmpty)
            Padding(
              padding: EdgeInsets.fromLTRB(
                AppDimens.sdp(context, '_14sdp'),
                0,
                AppDimens.sdp(context, '_14sdp'),
                AppDimens.sdp(context, '_14sdp'),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < plan.features.length; i += 2)
                    Padding(
                      padding: EdgeInsets.only(
                        bottom: AppDimens.sdp(context, '_10sdp'),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(child: _FeatureItem(text: plan.features[i])),
                          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                          Expanded(
                            child: i + 1 < plan.features.length
                                ? _FeatureItem(text: plan.features[i + 1])
                                : const SizedBox.shrink(),
                          ),
                        ],
                      ),
                    ),
                  SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                  GradientButton(
                    label: AppStrings.choosePlan(plan.shortName),
                    onPressed: onChoose,
                    icon: Icon(
                      Icons.arrow_forward_rounded,
                      color: Colors.white,
                      size: AppDimens.sdp(context, '_16sdp'),
                    ),
                    iconPosition: GradientButtonIconPosition.trailing,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _FeatureItem extends StatelessWidget {
  const _FeatureItem({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          Icons.check_circle_rounded,
          color: AppColors.pinkGradientStart,
          size: AppDimens.sdp(context, '_14sdp'),
        ),
        SizedBox(width: AppDimens.sdp(context, '_6sdp')),
        Expanded(
          child: Text(
            text,
            style: AppTextStyles.regular.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_11ssp'),
            ),
          ),
        ),
      ],
    );
  }
}

class _BestValueBadge extends StatelessWidget {
  const _BestValueBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_20sdp'));

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: AppDimens.sdp(context, '_8sdp'),
        vertical: AppDimens.sdp(context, '_3sdp'),
      ),
      decoration: BoxDecoration(
        gradient: AppColors.pinkGradient,
        borderRadius: radius,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.star_rounded,
            color: Colors.white,
            size: AppDimens.sdp(context, '_10sdp'),
          ),
          SizedBox(width: AppDimens.sdp(context, '_2sdp')),
          Text(
            label,
            style: AppTextStyles.semiBold.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_9ssp'),
            ),
          ),
        ],
      ),
    );
  }
}
