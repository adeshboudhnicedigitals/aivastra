import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../widgets/app_loader.dart';
import '../widgets/app_network_image.dart';

/// Lays [children] out [columns] per row, each taking an equal share of the
/// available width. Unlike a `GridView` the cells size to their own content,
/// so it can live inside the page's scroll view without a fixed aspect ratio.
class BatchAdaptiveGrid extends StatelessWidget {
  const BatchAdaptiveGrid({
    super.key,
    required this.columnsFor,
    required this.spacing,
    required this.children,
  });

  /// Picks the column count from the width this grid actually has (not the
  /// screen), so it stays right inside cards and on tablets.
  final int Function(double width) columnsFor;
  final double spacing;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = columnsFor(constraints.maxWidth).clamp(1, 12);
        final cellWidth =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: [
            for (final child in children)
              SizedBox(width: cellWidth, child: child),
          ],
        );
      },
    );
  }
}

/// Network image that falls back to a quiet placeholder instead of the
/// framework's red error box, decoding at thumbnail size to keep memory low
/// when a batch shows many of them.
class BatchNetworkImage extends StatelessWidget {
  const BatchNetworkImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.icon = Icons.image_rounded,
    this.cacheWidth = 360,
  });

  final String? url;
  final BoxFit fit;
  final IconData icon;
  final int cacheWidth;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      color: Colors.white.withValues(alpha: 0.06),
      alignment: Alignment.center,
      child: Icon(
        icon,
        color: AppColors.textSecondary,
        size: AppDimens.sdp(context, '_22sdp'),
      ),
    );
    final url = this.url;
    if (url == null || url.isEmpty) return placeholder;
    return CachedNetworkImage(
      imageUrl: url,
      cacheKey: imageCacheKey(url),
      fit: fit,
      memCacheWidth: cacheWidth,
      width: double.infinity,
      height: double.infinity,
      fadeOutDuration: Duration.zero,
      placeholder: (_, _) => placeholder,
      errorWidget: (_, _, _) => placeholder,
    );
  }
}

/// Small pink check badge marking a selected card.
class BatchCheckBadge extends StatelessWidget {
  const BatchCheckBadge({super.key, this.size});

  final double? size;

  @override
  Widget build(BuildContext context) {
    final s = size ?? AppDimens.sdp(context, '_20sdp');
    return Container(
      width: s,
      height: s,
      decoration: const BoxDecoration(
        gradient: AppColors.pinkGradient,
        shape: BoxShape.circle,
      ),
      child: Icon(Icons.check_rounded, color: Colors.white, size: s * 0.66),
    );
  }
}

/// One audience choice: avatar, name and a check when selected.
class BatchAudienceTile extends StatelessWidget {
  const BatchAudienceTile({
    super.key,
    required this.label,
    required this.avatarUrl,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String? avatarUrl;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_14sdp'));
    final avatar = AppDimens.sdp(context, '_34sdp');

    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: AppDimens.sdp(context, '_10sdp'),
            vertical: AppDimens.sdp(context, '_10sdp'),
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.pinkGradientStart.withValues(alpha: 0.14)
                : AppColors.fieldFill,
            borderRadius: radius,
            border: Border.all(
              color: selected
                  ? AppColors.pinkGradientStart.withValues(alpha: 0.85)
                  : AppColors.fieldBorder,
            ),
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Row(
                children: [
                  ClipOval(
                    child: SizedBox(
                      width: avatar,
                      height: avatar,
                      child: BatchNetworkImage(
                        url: avatarUrl,
                        icon: Icons.person_rounded,
                        cacheWidth: 120,
                      ),
                    ),
                  ),
                  SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                  Expanded(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_13ssp'),
                      ),
                    ),
                  ),
                ],
              ),
              // A corner badge (not inline) so the name keeps its full width.
              if (selected)
                Positioned(
                  top: -AppDimens.sdp(context, '_6sdp'),
                  right: -AppDimens.sdp(context, '_6sdp'),
                  child: BatchCheckBadge(
                    size: AppDimens.sdp(context, '_16sdp'),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One garment-type card: product photo on white with its name beneath.
class BatchGarmentTypeCard extends StatelessWidget {
  const BatchGarmentTypeCard({
    super.key,
    required this.label,
    required this.imageUrl,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String? imageUrl;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: radius,
          border: Border.all(
            // AppColors.fieldBorder is a near-transparent white, meant to
            // show against this app's dark fields — invisible against this
            // card's own white product-photo background, which made an
            // unselected card look like the photo had no frame at all. A
            // dark outline shows up against both the white photo and the
            // dark label strip below it.
            color: selected
                ? AppColors.pinkGradientStart
                : Colors.black.withValues(alpha: 0.18),
            width: selected ? 1.6 : 1,
          ),
        ),
        child: ClipRRect(
          // '_11sdp' isn't a real AppDimens key — the lookup silently fell
          // back to 0, so this clip had no rounding at all while the border
          // above it (a valid '_12sdp') was visibly curved. Reusing the same
          // `radius` keeps the two in sync.
          borderRadius: radius,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AspectRatio(
                aspectRatio: 1,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ColoredBox(
                      color: Colors.white,
                      child: Padding(
                        padding: EdgeInsets.all(
                          AppDimens.sdp(context, '_6sdp'),
                        ),
                        child: BatchNetworkImage(
                          url: imageUrl,
                          fit: BoxFit.contain,
                          icon: Icons.checkroom_rounded,
                        ),
                      ),
                    ),
                    if (selected)
                      Positioned(
                        top: AppDimens.sdp(context, '_6sdp'),
                        right: AppDimens.sdp(context, '_6sdp'),
                        child: const BatchCheckBadge(),
                      ),
                  ],
                ),
              ),
              Container(
                color: const Color(0xFF14141F),
                padding: EdgeInsets.symmetric(
                  horizontal: AppDimens.sdp(context, '_6sdp'),
                  vertical: AppDimens.sdp(context, '_8sdp'),
                ),
                child: Text(
                  label,
                  maxLines: 1,
                  textAlign: TextAlign.center,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_11ssp'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A round dark control (remove / retry) that sits on top of a photo.
class BatchOverlayIconButton extends StatelessWidget {
  const BatchOverlayIconButton({
    super.key,
    required this.icon,
    required this.onTap,
    this.size,
  });

  final IconData icon;
  final VoidCallback onTap;
  final double? size;

  @override
  Widget build(BuildContext context) {
    final s = size ?? AppDimens.sdp(context, '_22sdp');
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: s,
        height: s,
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.6),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: Colors.white, size: s * 0.6),
      ),
    );
  }
}

/// A square garment photo with its upload state on top: progress while it
/// uploads, a retry when it failed, and a remove control. Used for the tray
/// on the first page and for a row's own garment cell.
class BatchGarmentPhoto extends StatelessWidget {
  const BatchGarmentPhoto({
    super.key,
    required this.path,
    required this.uploading,
    required this.error,
    required this.onRemove,
    required this.onRetry,
    this.onTap,
  });

  final String path;
  final bool uploading;
  final String? error;
  final VoidCallback onRemove;
  final VoidCallback onRetry;

  /// Tapping the photo itself (a row's cell uses this to replace the file).
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_10sdp'));
    final gap = AppDimens.sdp(context, '_4sdp');

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: radius,
          border: Border.all(
            color: error != null ? AppColors.danger : AppColors.fieldBorder,
          ),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_9sdp')),
          child: Stack(
            fit: StackFit.expand,
            children: [
              Image.file(
                File(path),
                fit: BoxFit.cover,
                cacheWidth: 360,
                errorBuilder: (_, _, _) => Container(
                  color: Colors.white.withValues(alpha: 0.06),
                  alignment: Alignment.center,
                  child: const Icon(
                    Icons.broken_image_outlined,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              if (uploading)
                ColoredBox(
                  color: Colors.black.withValues(alpha: 0.45),
                  child: Center(child: AppLoader.button()),
                ),
              if (error != null)
                GestureDetector(
                  onTap: onRetry,
                  child: ColoredBox(
                    color: Colors.black.withValues(alpha: 0.62),
                    child: Padding(
                      padding: EdgeInsets.all(gap),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.refresh_rounded,
                            color: Colors.white,
                            size: AppDimens.sdp(context, '_20sdp'),
                          ),
                          Text(
                            error == 'Over 10 MB' ? error! : 'Retry',
                            textAlign: TextAlign.center,
                            style: AppTextStyles.medium.copyWith(
                              color: Colors.white,
                              fontSize: AppDimens.ssp(context, '_10ssp'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              Positioned(
                top: gap,
                right: gap,
                child: BatchOverlayIconButton(
                  icon: Icons.close_rounded,
                  onTap: onRemove,
                  size: AppDimens.sdp(context, '_20sdp'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Confirmation used before the batch throws away the user's work.
Future<bool> confirmBatchDialog(
  BuildContext context, {
  required String title,
  required String body,
  required String action,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      backgroundColor: AppColors.sheetBackground,
      title: Text(title, style: const TextStyle(color: Colors.white)),
      content: Text(body, style: const TextStyle(color: Colors.white70)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(
            action,
            style: const TextStyle(color: AppColors.pinkGradientStart),
          ),
        ),
      ],
    ),
  );
  return result ?? false;
}
