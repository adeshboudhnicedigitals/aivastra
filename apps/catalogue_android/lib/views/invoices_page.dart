import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/utils/format_money.dart';
import '../features/billing/application/billing_providers.dart';
import '../features/billing/data/payment_record.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';

/// Invoices, on `GET /v1/payments/history`: every credit-pack purchase, with
/// its GST invoice PDF where one was issued.
class InvoicesPage extends ConsumerStatefulWidget {
  const InvoicesPage({super.key});

  @override
  ConsumerState<InvoicesPage> createState() => _InvoicesPageState();
}

class _InvoicesPageState extends ConsumerState<InvoicesPage> {
  String _dateRange = AppStrings.allDates;
  String _filter = AppStrings.filterAll;

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

  static String _date(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')} ${_months[d.month - 1]} ${d.year}';

  static String _time(DateTime d) {
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
  }

  bool _inRange(PaymentRecord p) {
    final now = DateTime.now();
    return switch (_dateRange) {
      'Last 7 days' => p.when.isAfter(now.subtract(const Duration(days: 7))),
      'Last 30 days' => p.when.isAfter(now.subtract(const Duration(days: 30))),
      'This year' => p.when.year == now.year,
      _ => true,
    };
  }

  bool _matchesStatus(PaymentRecord p) => switch (_filter) {
    AppStrings.paid => p.isPaid,
    AppStrings.failed => p.isFailed,
    // `created`: checkout was started but never completed.
    AppStrings.pending => !p.isPaid && !p.isFailed,
    _ => true,
  };

  Future<void> _openInvoice(PaymentRecord p) async {
    final url = p.invoiceUrl;
    if (url == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No invoice is available for this payment.'),
        ),
      );
      return;
    }
    final ok = await launchUrl(
      Uri.parse(url),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open the invoice.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final sectionGap = AppDimens.sdp(context, '_20sdp');
    final tileGap = AppDimens.sdp(context, '_10sdp');
    final historyAsync = ref.watch(paymentHistoryProvider);

    return DetailPageScaffold(
      title: AppStrings.invoices,
      subtitle: AppStrings.invoicesPageSubtitle,
      headerTrailing: DropdownChip(
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
      children: [
        historyAsync.when(
          loading: () => const AppLoader.section(),
          error: (_, _) => const InlineErrorBanner(
            message: 'Could not load your invoices. Please try again.',
          ),
          data: (all) {
            final inRange = all.where(_inRange).toList();
            final paid = inRange.where((p) => p.isPaid).toList();
            final totalSpent = paid.fold<int>(0, (a, p) => a + p.totalPaise);
            final visible = inRange.where(_matchesStatus).toList();

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: StatTile(
                        icon: Icons.description_outlined,
                        value: '${paid.length}',
                        label: AppStrings.totalInvoices,
                      ),
                    ),
                    SizedBox(width: tileGap),
                    Expanded(
                      child: StatTile(
                        icon: Icons.payments_outlined,
                        value: formatPaise(totalSpent),
                        label: AppStrings.totalSpent,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: sectionGap),
                FilterTabs(
                  options: const [
                    AppStrings.filterAll,
                    AppStrings.paid,
                    AppStrings.pending,
                    AppStrings.failed,
                  ],
                  selected: _filter,
                  onSelected: (value) => setState(() => _filter = value),
                ),
                SizedBox(height: sectionGap),
                if (visible.isEmpty)
                  Padding(
                    padding: EdgeInsets.symmetric(
                      vertical: AppDimens.sdp(context, '_30sdp'),
                    ),
                    child: Center(
                      child: Text(
                        all.isEmpty
                            ? 'No invoices yet. They appear here after you buy credits.'
                            : 'No invoices match these filters.',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.regular.copyWith(
                          color: AppColors.textSecondary,
                          fontSize: AppDimens.ssp(context, '_13ssp'),
                        ),
                      ),
                    ),
                  ),
                for (var i = 0; i < visible.length; i++) ...[
                  _InvoiceRow(
                    payment: visible[i],
                    title:
                        visible[i].invoiceNumber ??
                        'Order ${visible[i].id.substring(0, visible[i].id.length.clamp(0, 8))}',
                    subtitle:
                        '${_time(visible[i].when)}, ${_date(visible[i].when)}'
                        ' • ${visible[i].planName ?? visible[i].planId ?? 'Credits'}',
                    onDownload: () => _openInvoice(visible[i]),
                  ),
                  if (i != visible.length - 1) SizedBox(height: tileGap),
                ],
              ],
            );
          },
        ),
      ],
    );
  }
}

class _InvoiceRow extends StatelessWidget {
  const _InvoiceRow({
    required this.payment,
    required this.title,
    required this.subtitle,
    required this.onDownload,
  });

  final PaymentRecord payment;
  final String title;
  final String subtitle;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    final label = payment.isPaid
        ? AppStrings.paid
        : payment.isFailed
        ? AppStrings.failed
        : AppStrings.pending;

    return CardContainer(
      children: [
        Padding(
          padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_13ssp'),
                      ),
                    ),
                    SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                    Text(
                      subtitle,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.regular.copyWith(
                        color: AppColors.textSecondary,
                        fontSize: AppDimens.ssp(context, '_10ssp'),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(width: AppDimens.sdp(context, '_8sdp')),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    formatPaise(payment.totalPaise),
                    style: AppTextStyles.semiBold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(context, '_13ssp'),
                    ),
                  ),
                  SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                  StatusBadge(label: label, positive: payment.isPaid),
                ],
              ),
              SizedBox(width: AppDimens.sdp(context, '_10sdp')),
              _DownloadButton(
                onTap: onDownload,
                enabled: payment.invoiceUrl != null,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _DownloadButton extends StatelessWidget {
  const _DownloadButton({required this.onTap, required this.enabled});

  final VoidCallback onTap;

  /// Dimmed when there's no invoice PDF to fetch (still tappable, to explain).
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final size = AppDimens.sdp(context, '_32sdp');

    return Opacity(
      opacity: enabled ? 1 : 0.4,
      child: Material(
        color: AppColors.pinkGradientStart.withValues(alpha: 0.15),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: size,
            height: size,
            child: Icon(
              Icons.file_download_outlined,
              color: AppColors.pinkGradientStart,
              size: AppDimens.sdp(context, '_16sdp'),
            ),
          ),
        ),
      ),
    );
  }
}
