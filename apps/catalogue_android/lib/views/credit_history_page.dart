import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/credits_summary.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';

/// Credit History, on `GET /v1/credits`: the live balance and the account's
/// most recent ledger entries (the server returns the latest 20 - there is no
/// paged ledger endpoint, and the web app works from the same list).
class CreditHistoryPage extends ConsumerStatefulWidget {
  const CreditHistoryPage({super.key});

  @override
  ConsumerState<CreditHistoryPage> createState() => _CreditHistoryPageState();
}

/// How a ledger `reason` code reads and looks.
class _Kind {
  const _Kind(this.title, this.icon, this.color);

  final String title;
  final IconData icon;
  final Color color;
}

class _CreditHistoryPageState extends ConsumerState<CreditHistoryPage> {
  String _filter = AppStrings.filterAll;
  String _dateRange = AppStrings.allDates;

  static const _dateOptions = [
    AppStrings.allDates,
    'Last 7 days',
    'Last 30 days',
    'This year',
  ];

  static const _months = [
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

  /// `jobs.source` (packages/types/src/job-taxonomy.ts JOB_SOURCE) is the only
  /// place that tells a video dispatch apart from an image one - `reason`
  /// alone is `JOB_DISPATCH` for both. Only `catalog_video` is a video job;
  /// every other source produces a still image.
  /// The title leads with the garment type when the server names one
  /// ("Kurta - Image generation"). With no jobSource at all (an older server,
  /// or a job that no longer exists) there is nothing true to say about what
  /// was generated, so the entry's date is the title instead.
  static _Kind _dispatchKind(
    String? jobSource,
    String? garmentType,
    String dateLabel,
  ) {
    final garment = (garmentType ?? '').trim();
    String named(String what) => garment.isEmpty ? what : '$garment - $what';
    return switch (jobSource) {
      'catalog_video' => _Kind(
        named('Video generation'),
        Icons.videocam_rounded,
        AppColors.violet,
      ),
      null => _Kind(dateLabel, Icons.image_rounded, AppColors.violet),
      _ => _Kind(
        named('Image generation'),
        Icons.image_rounded,
        AppColors.violet,
      ),
    };
  }

  /// The reason codes the server writes to `credit_ledger`. When the server
  /// sends no `reason` at all, there is nothing to build a clear title from,
  /// so the entry's own date stands in as the title instead of a vague
  /// generic label.
  static _Kind _kindOf(
    String reason,
    String? jobSource,
    String? garmentType,
    String dateLabel,
  ) => reason.isEmpty
      ? _Kind(dateLabel, Icons.receipt_long_rounded, AppColors.textSecondary)
      : switch (reason) {
    'JOB_DISPATCH' => _dispatchKind(jobSource, garmentType, dateLabel),
    'JOB_FAIL_REFUND' => const _Kind(
      'Refund - generation failed',
      Icons.replay_rounded,
      AppColors.infoBlue,
    ),
    'JOB_CANCEL_REFUND' => const _Kind(
      'Refund - generation cancelled',
      Icons.replay_rounded,
      AppColors.infoBlue,
    ),
    'PAYMENT' => const _Kind(
      'Credits purchased',
      Icons.shopping_bag_rounded,
      Colors.white,
    ),
    'FREE_TRIAL' => const _Kind(
      'Free trial credits',
      Icons.card_giftcard_rounded,
      AppColors.pinkGradientStart,
    ),
    'CAMPAIGN_BONUS' => const _Kind(
      'Bonus credits',
      Icons.card_giftcard_rounded,
      AppColors.pinkGradientStart,
    ),
    'UNLIMITED_PLAN_USAGE' => const _Kind(
      'Unlimited plan usage',
      Icons.all_inclusive_rounded,
      AppColors.violet,
    ),
    _ => _Kind(
      _humanize(reason),
      Icons.receipt_long_rounded,
      AppColors.textSecondary,
    ),
  };

  /// `SOME_CODE` -> `Some code`, for reasons this app doesn't know yet.
  static String _humanize(String reason) {
    final words = reason.toLowerCase().split('_').where((w) => w.isNotEmpty);
    final text = words.join(' ');
    return text.isEmpty
        ? 'Credit activity'
        : '${text[0].toUpperCase()}${text.substring(1)}';
  }

  static bool _isRefund(String reason) => reason.endsWith('_REFUND');

  static String _dateLabel(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')} ${_months[d.month - 1]}, ${d.year}';

  static String _time(DateTime d) {
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
  }

  static String _signed(int delta) {
    final n = delta.abs().toString().replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+$)'),
      (m) => '${m[1]},',
    );
    return '${delta >= 0 ? '+' : '-'}$n Credits';
  }

  bool _inRange(DateTime when) {
    final now = DateTime.now();
    return switch (_dateRange) {
      'Last 7 days' => when.isAfter(now.subtract(const Duration(days: 7))),
      'Last 30 days' => when.isAfter(now.subtract(const Duration(days: 30))),
      'This year' => when.year == now.year,
      _ => true,
    };
  }

  @override
  Widget build(BuildContext context) {
    final sectionGap = AppDimens.sdp(context, '_24sdp');
    final rowGap = AppDimens.sdp(context, '_16sdp');
    final tileGap = AppDimens.sdp(context, '_10sdp');

    final creditsAsync = ref.watch(creditsSummaryProvider);
    final summary = creditsAsync.value;

    final entries = <({CreditLedgerRow row, DateTime when})>[
      for (final row in summary?.recent ?? const <CreditLedgerRow>[])
        (
          row: row,
          when: DateTime.tryParse(row.createdAt)?.toLocal() ?? DateTime(1970),
        ),
    ]..sort((a, b) => b.when.compareTo(a.when));

    // Totals over the entries the server returned (the latest 20): money in
    // vs. credits spent, with refunds netted off what was spent.
    final purchased = entries
        .where((e) => e.row.delta > 0 && !_isRefund(e.row.reason))
        .fold<int>(0, (a, e) => a + e.row.delta);
    final refunded = entries
        .where((e) => e.row.delta > 0 && _isRefund(e.row.reason))
        .fold<int>(0, (a, e) => a + e.row.delta);
    final spent = entries
        .where((e) => e.row.delta < 0)
        .fold<int>(0, (a, e) => a + e.row.delta.abs());
    final used = (spent - refunded).clamp(0, 1 << 31);

    final visible = entries.where((e) {
      if (!_inRange(e.when)) return false;
      if (_filter == AppStrings.filterAdded) return e.row.delta > 0;
      if (_filter == AppStrings.filterUsed) return e.row.delta < 0;
      return true;
    }).toList();

    final groups = <String, List<({CreditLedgerRow row, DateTime when})>>{};
    for (final e in visible) {
      groups.putIfAbsent(_dateLabel(e.when), () => []).add(e);
    }

    return DetailPageScaffold(
      title: AppStrings.creditHistory,
      subtitle: AppStrings.creditHistoryPageSubtitle,
      children: [
        _AvailableCreditsCard(credits: summary?.balance),
        SizedBox(height: rowGap),
        Row(
          children: [
            Expanded(
              child: StatTile(
                icon: Icons.add_shopping_cart_rounded,
                value: '$purchased',
                label: AppStrings.purchasedCreditsLabel,
              ),
            ),
            SizedBox(width: tileGap),
            Expanded(
              child: StatTile(
                icon: Icons.bolt_rounded,
                value: '$used',
                label: AppStrings.usedCreditsLabel,
              ),
            ),
          ],
        ),
        SizedBox(height: sectionGap),
        Row(
          children: [
            Expanded(
              child: Text(
                AppStrings.recentActivity,
                style: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_14ssp'),
                ),
              ),
            ),
            DropdownChip(
              label: _dateRange,
              onTap: () async {
                final result = await pickOptionSheet(
                  context,
                  title: AppStrings.allDates,
                  options: _dateOptions,
                  selected: _dateRange,
                );
                if (result != null) setState(() => _dateRange = result);
              },
            ),
          ],
        ),
        SizedBox(height: AppDimens.sdp(context, '_12sdp')),
        FilterTabs(
          options: const [
            AppStrings.filterAll,
            AppStrings.filterAdded,
            AppStrings.filterUsed,
          ],
          selected: _filter,
          onSelected: (value) => setState(() => _filter = value),
        ),
        SizedBox(height: sectionGap),
        if (creditsAsync.isLoading && summary == null)
          const AppLoader.section()
        else if (creditsAsync.hasError && summary == null)
          const InlineErrorBanner(
            message: 'Could not load your credit history. Please try again.',
          )
        else if (groups.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(
              vertical: AppDimens.sdp(context, '_30sdp'),
            ),
            child: Center(
              child: Text(
                entries.isEmpty
                    ? 'No credit activity yet.'
                    : 'No activity matches these filters.',
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ),
          )
        else ...[
          for (final entry in groups.entries) ...[
            Text(
              entry.key,
              style: AppTextStyles.medium.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_11ssp'),
              ),
            ),
            SizedBox(height: AppDimens.sdp(context, '_10sdp')),
            for (final e in entry.value) ...[
              _ActivityRow(
                kind: _kindOf(
                  e.row.reason,
                  e.row.jobSource,
                  e.row.garmentType,
                  _dateLabel(e.when),
                ),
                time: _time(e.when),
                amountLabel: _signed(e.row.delta),
                isCredit: e.row.delta > 0,
              ),
              SizedBox(height: tileGap),
            ],
          ],
          Padding(
            padding: EdgeInsets.only(top: AppDimens.sdp(context, '_4sdp')),
            child: Text(
              'Showing your most recent transactions.',
              textAlign: TextAlign.center,
              style: AppTextStyles.regular.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_11ssp'),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _AvailableCreditsCard extends StatelessWidget {
  const _AvailableCreditsCard({required this.credits});

  final int? credits;

  @override
  Widget build(BuildContext context) {
    final iconBoxSize = AppDimens.sdp(context, '_44sdp');

    return GlowCard(
      child: Row(
        children: [
          Container(
            width: iconBoxSize,
            height: iconBoxSize,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(
                AppDimens.sdp(context, '_12sdp'),
              ),
            ),
            child: Icon(
              Icons.monetization_on_rounded,
              color: Colors.white,
              size: AppDimens.sdp(context, '_22sdp'),
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_14sdp')),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                credits?.toString() ?? '—',
                style: AppTextStyles.bold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_22ssp'),
                ),
              ),
              Text(
                AppStrings.availableCreditsLabel,
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_12ssp'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({
    required this.kind,
    required this.time,
    required this.amountLabel,
    required this.isCredit,
  });

  final _Kind kind;
  final String time;
  final String amountLabel;
  final bool isCredit;

  @override
  Widget build(BuildContext context) {
    final iconBoxSize = AppDimens.sdp(context, '_36sdp');

    return Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_16sdp')),
        border: Border.all(color: AppColors.fieldBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: iconBoxSize,
            height: iconBoxSize,
            decoration: BoxDecoration(
              color: kind.color.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(
                AppDimens.sdp(context, '_10sdp'),
              ),
            ),
            child: Icon(
              kind.icon,
              color: kind.color,
              size: AppDimens.sdp(context, '_16sdp'),
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_12sdp')),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  kind.title,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_13ssp'),
                  ),
                ),
                SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                Text(
                  time,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_11ssp'),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
          // The ledger only records committed entries, so there is no
          // per-row status to show.
          Text(
            amountLabel,
            style: AppTextStyles.semiBold.copyWith(
              color: isCredit ? AppColors.success : Colors.white,
              fontSize: AppDimens.ssp(context, '_13ssp'),
            ),
          ),
        ],
      ),
    );
  }
}
