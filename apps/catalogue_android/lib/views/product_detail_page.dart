import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../core/utils/relative_date.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/uploaded_asset.dart';
import '../utils/app_strings.dart';
import '../widgets/credits_badge.dart';
import '../widgets/detail_page_widgets.dart';

class ProductDetailPage extends StatelessWidget {
  const ProductDetailPage({super.key, required this.asset});

  final UploadedAsset asset;

  Future<void> _download() async {
    final url = asset.thumbnailUrl;
    if (url == null) return;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final sectionGap = AppDimens.sdp(context, '_20sdp');
    final uploadedAt = parseApiDate(asset.uploadedAt);

    return DetailPageScaffold(
      title: AppStrings.uploadedGarmentTitle,
      subtitle: null,
      headerTrailing: Consumer(
        builder: (context, ref, _) {
          final credits = ref.watch(creditsSummaryProvider).value;
          return CreditsBadge(credits: credits?.balance);
        },
      ),
      children: [
        MediaHeroImage(
          icon: Icons.checkroom_rounded,
          tint: AppColors.pinkGradientStart,
          imageUrl: asset.thumbnailUrl,
          showFullscreenButton: false,
        ),
        SizedBox(height: sectionGap),
        AppPillButton(
          label: AppStrings.download,
          icon: Icons.download_rounded,
          onTap: _download,
        ),
        SizedBox(height: sectionGap),
        CardContainer(
          children: [
            MetaRow(
              icon: Icons.calendar_today_rounded,
              label: AppStrings.uploadedOn,
              value:
                  '${formatDateGroup(uploadedAt)} • ${_formatTime(uploadedAt)}',
            ),
            MetaRow(
              icon: Icons.auto_awesome_rounded,
              label: AppStrings.usedIn,
              value: AppStrings.usedInJobsCount(asset.jobsCount),
            ),
          ],
        ),
      ],
    );
  }

  String _formatTime(DateTime dt) {
    final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final minute = dt.minute.toString().padLeft(2, '0');
    final period = dt.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute $period';
  }
}
