import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import 'app_network_image.dart';
import 'gradient_button.dart';

export 'app_network_image.dart';

/// Shared chrome for the secondary ("detail") pages reached from Profile:
/// Profile & Preferences, Plans & Billing, Credit History, Invoices,
/// Tutorials and Contact Us. Provides the glow background, back-button
/// header and scrollable, width-constrained body every one of those pages
/// needs, scaling with [AppDimens] for phone/tablet.
class DetailPageScaffold extends StatelessWidget {
  const DetailPageScaffold({
    super.key,
    required this.title,
    required this.subtitle,
    required this.children,
    this.headerTrailing,
    this.bottomBar,
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;
  final Widget? headerTrailing;

  /// Action row floated over the bottom of the page (the body scrolls
  /// underneath it) instead of sitting at the end of the scroll content.
  final Widget? bottomBar;

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = AppDimens.sdp(context, '_16sdp');
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset(AppAssets.backgroundGlow, fit: BoxFit.cover),
          ),
          SafeArea(
            child: Center(
              heightFactor: 1,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxWidth),
                child: Column(
                  children: [
                    Padding(
                      padding: EdgeInsets.fromLTRB(
                        horizontalPadding,
                        AppDimens.sdp(context, '_24sdp'),
                        horizontalPadding,
                        AppDimens.sdp(context, '_8sdp'),
                      ),
                      child: DetailPageHeader(
                        title: title,
                        subtitle: subtitle,
                        trailing: headerTrailing,
                      ),
                    ),
                    Expanded(
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: SingleChildScrollView(
                              padding: EdgeInsets.fromLTRB(
                                horizontalPadding,
                                AppDimens.sdp(context, '_8sdp'),
                                horizontalPadding,
                                // Clears the floating bar so the last card can
                                // scroll fully into view above it.
                                AppDimens.sdp(
                                  context,
                                  bottomBar == null ? '_40sdp' : '_100sdp',
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: children,
                              ),
                            ),
                          ),
                          if (bottomBar != null)
                            Positioned(
                              left: horizontalPadding,
                              right: horizontalPadding,
                              bottom: AppDimens.sdp(context, '_16sdp'),
                              child: bottomBar!,
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class DetailPageHeader extends StatelessWidget {
  const DetailPageHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        BackIconButton(onTap: () => Navigator.of(context).maybePop()),
        SizedBox(width: AppDimens.sdp(context, '_12sdp')),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_18ssp'),
                ),
              ),
              if (subtitle != null) ...[
                SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                Text(
                  subtitle!,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_12ssp'),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (trailing != null) ...[
          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
          trailing!,
        ],
      ],
    );
  }
}

class BackIconButton extends StatelessWidget {
  const BackIconButton({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final size = AppDimens.sdp(context, '_36sdp');

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0.14),
            Colors.white.withValues(alpha: 0.02),
          ],
        ),
        border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: AppDimens.sdp(context, '_8sdp'),
            offset: Offset(0, AppDimens.sdp(context, '_2sdp')),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Icon(
            Icons.arrow_back_rounded,
            color: Colors.white,
            size: AppDimens.sdp(context, '_18sdp'),
          ),
        ),
      ),
    );
  }
}

/// Lays out [children] in a multi-column grid — 2 columns on phones, more
/// on tablet/wide screens — without a fixed per-cell aspect ratio, so each
/// cell just sizes to its own content (an image plus a variable amount of
/// text below it). Used by Products' item grid and the Generated Videos
/// grid on the product detail page.
class ResponsiveGrid extends StatelessWidget {
  const ResponsiveGrid({super.key, required this.children, this.spacing});

  final List<Widget> children;
  final double? spacing;

  /// The grid's rows as separate widgets (with the gaps between them), for a
  /// page that puts them straight into a lazy list so off-screen rows — and
  /// the images in them — aren't built until scrolled to. [build] is the
  /// same rows in a plain [Column], for short grids.
  static List<Widget> rows(
    BuildContext context,
    List<Widget> children, {
    double? spacing,
  }) {
    final width = MediaQuery.sizeOf(context).width;
    final crossAxisCount = width >= 900 ? 4 : (width >= 600 ? 3 : 2);
    final gap = spacing ?? AppDimens.sdp(context, '_12sdp');

    final rows = <Widget>[];
    for (var i = 0; i < children.length; i += crossAxisCount) {
      final rowItems = children.skip(i).take(crossAxisCount).toList();
      rows.add(
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var j = 0; j < crossAxisCount; j++) ...[
              if (j > 0) SizedBox(width: gap),
              Expanded(
                child: j < rowItems.length
                    ? rowItems[j]
                    : const SizedBox.shrink(),
              ),
            ],
          ],
        ),
      );
      if (i + crossAxisCount < children.length) rows.add(SizedBox(height: gap));
    }
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    return Column(children: rows(context, children, spacing: spacing));
  }
}

/// Gradient-tinted hero image placeholder (no real asset backend yet) with
/// an icon centered on it and an optional bottom-right fullscreen button.
/// Used by the Product and Creation (image) detail pages.
/// A frosted-glass circle for controls that sit on top of photos: the photo
/// behind it is blurred, with a faint white tint and hairline border.
class GlassCircle extends StatelessWidget {
  const GlassCircle({super.key, required this.size, required this.child});

  final double size;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white.withValues(alpha: 0.24),
                Colors.white.withValues(alpha: 0.08),
              ],
            ),
            border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// The expand / fullscreen button for images: the app's own `expand_ic.svg`
/// (which draws its own round dark badge) over a light blur of the photo.
class ExpandIconButton extends StatelessWidget {
  const ExpandIconButton({super.key, this.onTap, this.size});

  final VoidCallback? onTap;
  final double? size;

  @override
  Widget build(BuildContext context) {
    final d = size ?? AppDimens.sdp(context, '_36sdp');
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: ClipOval(
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 8, sigmaY: 8),
          child: SvgPicture.asset(AppAssets.expandIcon, width: d, height: d),
        ),
      ),
    );
  }
}

class MediaHeroImage extends StatelessWidget {
  const MediaHeroImage({
    super.key,
    required this.icon,
    required this.tint,
    this.aspectRatio = 0.82,
    this.showFullscreenButton = true,
    this.imageUrl,
    this.radius,
  });

  final IconData icon;
  final Color tint;
  final double aspectRatio;
  final bool showFullscreenButton;

  /// Corner radius; defaults to the standalone-card `_20sdp`. Smaller when
  /// the image sits inside another bordered card.
  final double? radius;

  /// When set, renders this network image instead of the icon+tint
  /// placeholder (falling back to the placeholder on load failure).
  final String? imageUrl;

  @override
  Widget build(BuildContext context) {
    final cornerRadius = BorderRadius.circular(
      radius ?? AppDimens.sdp(context, '_20sdp'),
    );
    final url = imageUrl;

    return ClipRRect(
      borderRadius: cornerRadius,
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (url != null)
              AppNetworkImage(
                url,
                placeholder: _placeholder,
                errorBuilder: _placeholder,
              )
            else
              _placeholder(context),
            if (showFullscreenButton)
              Positioned(
                right: AppDimens.sdp(context, '_12sdp'),
                bottom: AppDimens.sdp(context, '_12sdp'),
                child: const ExpandIconButton(),
              ),
          ],
        ),
      ),
    );
  }

  Widget _placeholder(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                tint.withValues(alpha: 0.45),
                tint.withValues(alpha: 0.12),
              ],
            ),
          ),
        ),
        Center(
          child: Icon(
            icon,
            color: Colors.white.withValues(alpha: 0.85),
            size: AppDimens.sdp(context, '_60sdp'),
          ),
        ),
      ],
    );
  }
}

/// Icon-chip + label + value row, e.g. "Uploaded On" / "Aug 25, 2026".
/// Used inside a [CardContainer] on the Product and Creation detail pages.
class MetaRow extends StatelessWidget {
  const MetaRow({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final iconBoxSize = AppDimens.sdp(context, '_32sdp');

    return Padding(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
      child: Row(
        children: [
          Container(
            width: iconBoxSize,
            height: iconBoxSize,
            decoration: BoxDecoration(
              color: AppColors.pinkGradientStart.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(
                AppDimens.sdp(context, '_8sdp'),
              ),
            ),
            child: Icon(
              icon,
              color: AppColors.pinkGradientStart,
              size: AppDimens.sdp(context, '_15sdp'),
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_12sdp')),
          Text(
            label,
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_12ssp'),
            ),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.semiBold.copyWith(
                color: Colors.white,
                fontSize: AppDimens.ssp(context, '_12ssp'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Thumbnail card: gradient-tinted placeholder with a bottom-left badge
/// (e.g. a video duration or an image count) and a title/tag/time-ago
/// footer. Used by the Products grid, the My Creations grid, "Generated
/// Videos" and "Recent Creations".
/// The three-dot button on a [MediaThumbnailCard]. When [onDownload] or
/// [onDelete] is set, tapping it opens a frosted-glass popup - Download, a
/// divider, then a pink Delete - otherwise it is just the decorative badge.
class _CardMenuButton extends StatelessWidget {
  const _CardMenuButton({this.onDownload, this.onDelete});

  final VoidCallback? onDownload;
  final VoidCallback? onDelete;

  Future<void> _open(BuildContext context) async {
    final box = context.findRenderObject() as RenderBox;
    final origin = box.localToGlobal(Offset.zero);
    final anchor = origin & box.size;
    final screen = MediaQuery.sizeOf(context);
    final gap = AppDimens.sdp(context, '_6sdp');
    // Right edge lines up with the button and the card grows leftwards to fit
    // its labels (a fixed width overflowed on tablet-size text); flips above
    // the button if it would run off the bottom of the screen.
    final right = (screen.width - anchor.right).clamp(gap, screen.width);
    final estimatedHeight = AppDimens.sdp(context, '_106sdp');
    final below = anchor.bottom + gap;
    final top = below + estimatedHeight > screen.height - gap
        ? anchor.top - gap - estimatedHeight
        : below;

    final choice = await showGeneralDialog<String>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Close menu',
      barrierColor: Colors.transparent,
      transitionDuration: const Duration(milliseconds: 140),
      transitionBuilder: (context, animation, _, child) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(
          scale: Tween(begin: 0.92, end: 1.0).animate(animation),
          alignment: Alignment.topRight,
          child: child,
        ),
      ),
      pageBuilder: (dialogContext, _, _) => Stack(
        children: [
          Positioned(
            right: right,
            top: top,
            child: _GlassMenu(
              onDownload: onDownload == null
                  ? null
                  : () => Navigator.of(dialogContext).pop('download'),
              onDelete: onDelete == null
                  ? null
                  : () => Navigator.of(dialogContext).pop('delete'),
            ),
          ),
        ],
      ),
    );
    if (choice == 'download') onDownload?.call();
    if (choice == 'delete') onDelete?.call();
  }

  @override
  Widget build(BuildContext context) {
    final badge = Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_5sdp')),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.45),
        shape: BoxShape.circle,
      ),
      child: Icon(
        Icons.more_vert_rounded,
        color: Colors.white,
        size: AppDimens.sdp(context, '_18sdp'),
      ),
    );
    if (onDownload == null && onDelete == null) return badge;

    // Opaque, with extra padding, so the touch target is bigger than the
    // visible circle.
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => _open(context),
      child: Padding(
        padding: EdgeInsets.all(AppDimens.sdp(context, '_3sdp')),
        child: badge,
      ),
    );
  }
}

/// Frosted-glass popup card: the content behind it is blurred, with a faint
/// white tint and hairline border.
class _GlassMenu extends StatelessWidget {
  const _GlassMenu({this.onDownload, this.onDelete});

  final VoidCallback? onDownload;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_16sdp'));

    Widget item(IconData icon, String label, Color color, VoidCallback onTap) {
      return InkWell(
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: AppDimens.sdp(context, '_16sdp'),
            vertical: AppDimens.sdp(context, '_14sdp'),
          ),
          child: Row(
            children: [
              Icon(icon, color: color, size: AppDimens.sdp(context, '_20sdp')),
              SizedBox(width: AppDimens.sdp(context, '_12sdp')),
              Text(
                label,
                style: AppTextStyles.medium.copyWith(
                  color: color,
                  fontSize: AppDimens.ssp(context, '_14ssp'),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Material(
      type: MaterialType.transparency,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          minWidth: AppDimens.sdp(context, '_130sdp'),
        ),
        child: IntrinsicWidth(
          child: ClipRRect(
            borderRadius: radius,
            child: BackdropFilter(
              filter: ui.ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: radius,
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Colors.white.withValues(alpha: 0.16),
                      Colors.white.withValues(alpha: 0.05),
                    ],
                  ),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.22),
                  ),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (onDownload != null)
                      item(
                        Icons.file_download_outlined,
                        AppStrings.download,
                        Colors.white,
                        onDownload!,
                      ),
                    if (onDownload != null && onDelete != null)
                      Divider(
                        height: 1,
                        color: Colors.white.withValues(alpha: 0.18),
                      ),
                    if (onDelete != null)
                      item(
                        Icons.delete_outline_rounded,
                        AppStrings.delete,
                        AppColors.pinkGradientStart,
                        onDelete!,
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class MediaThumbnailCard extends StatelessWidget {
  const MediaThumbnailCard({
    super.key,
    required this.title,
    required this.tagLabel,
    required this.tagColor,
    required this.timeAgo,
    required this.icon,
    required this.tint,
    this.badgeIcon,
    this.badgeLabel,
    this.centerIcon,
    this.showMenu = true,
    this.onDownload,
    this.onDelete,
    this.onTap,
    this.imageUrl,
  });

  /// Actions behind the card's three-dot button. With neither set, the button
  /// is a plain non-interactive badge (as on the Products grid).
  final VoidCallback? onDownload;
  final VoidCallback? onDelete;

  final String title;
  final String tagLabel;
  final Color tagColor;
  final String timeAgo;
  final IconData icon;
  final Color tint;
  final IconData? badgeIcon;
  final String? badgeLabel;

  /// When set, overlays this icon centered on the thumbnail — e.g. a play
  /// glyph marking a video item in a grid that otherwise mixes images and
  /// videos. Unset (the default) shows no overlay, so existing image-only
  /// callers (Products grid) are unaffected.
  final IconData? centerIcon;
  final bool showMenu;
  final VoidCallback? onTap;

  /// When set, renders this network image instead of the icon+tint
  /// placeholder (falling back to the placeholder on load failure).
  final String? imageUrl;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_14sdp'));

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.fieldFill,
          borderRadius: radius,
          border: Border.all(color: AppColors.fieldBorder),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 4:5 — closer to the portrait ratios most generated looks
            // actually use (3:4, 4:5, 9:16) than the previous near-square
            // 0.9, so `cover` below only has to crop a little rather than a
            // lot. `contain` was tried instead of tightening this ratio, but
            // on a shape this mismatched from the source photo it always
            // leaves an empty strip down both sides — full-bleed `cover`
            // with a closer-fitting box is the better tradeoff here.
            AspectRatio(
              aspectRatio: 0.8,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (imageUrl != null)
                    AppNetworkImage(
                      imageUrl!,
                      thumbnail: true,
                      placeholder: _placeholder,
                      errorBuilder: _placeholder,
                    )
                  else
                    _placeholder(context),
                  if (centerIcon != null)
                    Center(
                      child: Container(
                        padding: EdgeInsets.all(
                          AppDimens.sdp(context, '_6sdp'),
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.45),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          centerIcon,
                          color: Colors.white,
                          size: AppDimens.sdp(context, '_22sdp'),
                        ),
                      ),
                    ),
                  if (badgeLabel != null)
                    Positioned(
                      left: AppDimens.sdp(context, '_6sdp'),
                      bottom: AppDimens.sdp(context, '_6sdp'),
                      child: Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: AppDimens.sdp(context, '_6sdp'),
                          vertical: AppDimens.sdp(context, '_2sdp'),
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.6),
                          borderRadius: BorderRadius.circular(
                            AppDimens.sdp(context, '_6sdp'),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (badgeIcon != null) ...[
                              Icon(
                                badgeIcon,
                                color: Colors.white,
                                size: AppDimens.sdp(context, '_9sdp'),
                              ),
                              SizedBox(width: AppDimens.sdp(context, '_3sdp')),
                            ],
                            Text(
                              badgeLabel!,
                              style: AppTextStyles.medium.copyWith(
                                color: Colors.white,
                                fontSize: AppDimens.ssp(context, '_9ssp'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  if (showMenu)
                    Positioned(
                      right: AppDimens.sdp(context, '_6sdp'),
                      top: AppDimens.sdp(context, '_6sdp'),
                      child: _CardMenuButton(
                        onDownload: onDownload,
                        onDelete: onDelete,
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                AppDimens.sdp(context, '_10sdp'),
                AppDimens.sdp(context, '_8sdp'),
                AppDimens.sdp(context, '_10sdp'),
                AppDimens.sdp(context, '_10sdp'),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.semiBold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(context, '_12ssp'),
                    ),
                  ),
                  SizedBox(height: AppDimens.sdp(context, '_4sdp')),
                  Row(
                    children: [
                      Flexible(
                        child: Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: AppDimens.sdp(context, '_8sdp'),
                            vertical: AppDimens.sdp(context, '_2sdp'),
                          ),
                          decoration: BoxDecoration(
                            color: tagColor.withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(
                              AppDimens.sdp(context, '_20sdp'),
                            ),
                          ),
                          child: Text(
                            tagLabel,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.medium.copyWith(
                              color: tagColor,
                              fontSize: AppDimens.ssp(context, '_9ssp'),
                            ),
                          ),
                        ),
                      ),
                      Flexible(
                        child: Text(
                          ' • $timeAgo',
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.regular.copyWith(
                            color: AppColors.textSecondary,
                            fontSize: AppDimens.ssp(context, '_10ssp'),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _placeholder(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                tint.withValues(alpha: 0.45),
                tint.withValues(alpha: 0.12),
              ],
            ),
          ),
        ),
        Center(
          child: Icon(
            icon,
            color: Colors.white.withValues(alpha: 0.85),
            size: AppDimens.sdp(context, '_28sdp'),
          ),
        ),
      ],
    );
  }
}

/// The "Generation Details" card on a Creation detail page: a small
/// reference-image thumbnail, the generation prompt (with a tap-to-copy
/// button), then a set of stat rows. [duration] is omitted for a
/// catalogue (image) creation — videos only.
class GenerationDetailsCard extends StatelessWidget {
  const GenerationDetailsCard({
    super.key,
    required this.thumbnailIcon,
    required this.thumbnailTint,
    required this.promptLabel,
    required this.promptText,
    required this.aspectRatio,
    required this.outputQuality,
    required this.creditsUsed,
    required this.generatedOn,
    this.duration,
    this.heading,
    this.thumbnailImage,
  });

  /// Optional title shown at the top of the card, e.g. "Generation Details:".
  final String? heading;

  /// Real reference image for the thumbnail; the icon+tint tile is the
  /// fallback when there isn't one.
  final ImageProvider? thumbnailImage;

  final IconData thumbnailIcon;
  final Color thumbnailTint;
  final String promptLabel;

  /// Null hides the prompt section entirely.
  final String? promptText;
  final String aspectRatio;
  final String outputQuality;
  final String creditsUsed;
  final String generatedOn;
  final String? duration;

  @override
  Widget build(BuildContext context) {
    return CardContainer(
      children: [
        _PromptSection(
          heading: heading,
          thumbnailImage: thumbnailImage,
          thumbnailIcon: thumbnailIcon,
          thumbnailTint: thumbnailTint,
          promptLabel: promptLabel,
          promptText: promptText,
          duration: duration,
          aspectRatio: aspectRatio,
          outputQuality: outputQuality,
          creditsUsed: creditsUsed,
          generatedOn: generatedOn,
        ),
      ],
    );
  }
}

/// The Motion Prompt box, then the Source Image thumbnail side by side with
/// a compact Duration/Aspect Ratio/Output Quality/Credits Used/Generated On
/// stack — one single [CardContainer] child, so no divider line splits it
/// from the stats (unlike the old layout, which rendered each stat as its
/// own full-width [MetaRow] below a stacked thumbnail).
class _PromptSection extends StatelessWidget {
  const _PromptSection({
    required this.heading,
    required this.thumbnailImage,
    required this.thumbnailIcon,
    required this.thumbnailTint,
    required this.promptLabel,
    required this.promptText,
    required this.duration,
    required this.aspectRatio,
    required this.outputQuality,
    required this.creditsUsed,
    required this.generatedOn,
  });

  final String? heading;
  final ImageProvider? thumbnailImage;
  final IconData thumbnailIcon;
  final Color thumbnailTint;
  final String promptLabel;

  /// Null hides the prompt box entirely.
  final String? promptText;
  final String? duration;
  final String aspectRatio;
  final String outputQuality;
  final String creditsUsed;
  final String generatedOn;

  Future<void> _copyPrompt(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: promptText!));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(AppStrings.promptCopied)));
  }

  @override
  Widget build(BuildContext context) {
    final labelStyle = AppTextStyles.semiBold.copyWith(
      color: Colors.white,
      fontSize: AppDimens.ssp(context, '_13ssp'),
    );

    return Padding(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Full width even with no prompt box (which used to be the widest
          // child); otherwise the parent column centres a shrunken card body.
          const SizedBox(width: double.infinity),
          if (heading != null) ...[
            Text(
              heading!,
              style: labelStyle.copyWith(
                fontSize: AppDimens.ssp(context, '_15ssp'),
              ),
            ),
            SizedBox(height: AppDimens.sdp(context, '_14sdp')),
          ],
          if (promptText != null) ...[
            Text(promptLabel, style: labelStyle),
            SizedBox(height: AppDimens.sdp(context, '_8sdp')),
            Container(
              width: double.infinity,
              padding: EdgeInsets.fromLTRB(
                AppDimens.sdp(context, '_12sdp'),
                AppDimens.sdp(context, '_12sdp'),
                AppDimens.sdp(context, '_12sdp'),
                AppDimens.sdp(context, '_28sdp'),
              ),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(
                  AppDimens.sdp(context, '_12sdp'),
                ),
                border: Border.all(color: AppColors.fieldBorder),
              ),
              child: Stack(
                children: [
                  Text(
                    promptText!,
                    style: AppTextStyles.regular.copyWith(
                      color: AppColors.textSecondary,
                      fontSize: AppDimens.ssp(context, '_12ssp'),
                      height: 1.4,
                    ),
                  ),
                  Positioned(
                    right: 0,
                    bottom: -AppDimens.sdp(context, '_16sdp'),
                    child: InkWell(
                      onTap: () => _copyPrompt(context),
                      borderRadius: BorderRadius.circular(
                        AppDimens.sdp(context, '_12sdp'),
                      ),
                      child: Padding(
                        padding: EdgeInsets.all(
                          AppDimens.sdp(context, '_4sdp'),
                        ),
                        child: Icon(
                          Icons.copy_rounded,
                          color: AppColors.textSecondary,
                          size: AppDimens.sdp(context, '_16sdp'),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ],
          // IntrinsicHeight + stretch so the vertical divider (a 1-wide
          // Container with no height of its own) fills the row's full
          // height instead of collapsing to zero.
          //
          // The thumbnail is sized off the card's own measured width
          // (LayoutBuilder), not a fixed AppDimens key: most sdp keys in
          // this range (e.g. '_70sdp') resolve to the SAME number on phone
          // and tablet buckets, so a fixed key looked identical — and
          // small — on a tablet. A width proportional to the available
          // card width scales up genuinely on a wider screen.
          LayoutBuilder(
            builder: (context, constraints) {
              final thumbWidth = (constraints.maxWidth * 0.28).clamp(
                84.0,
                170.0,
              );
              return IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(AppStrings.sourceImageLabel, style: labelStyle),
                        SizedBox(height: AppDimens.sdp(context, '_8sdp')),
                        // Expanded, not a fixed aspect-ratio height: a 9:16
                        // height made the photo far taller than the 5 stat
                        // rows beside it (lots of empty space under
                        // "Generated On" while the image kept going).
                        // Filling the row's own stretched height instead
                        // makes the two columns end at the same point,
                        // cropping the photo to fit via BoxFit.cover.
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(
                              AppDimens.sdp(context, '_10sdp'),
                            ),
                            child: Container(
                              width: thumbWidth,
                              height: double.infinity,
                              decoration: BoxDecoration(
                                image: thumbnailImage == null
                                    ? null
                                    : DecorationImage(
                                        image: thumbnailImage!,
                                        fit: BoxFit.cover,
                                      ),
                                // Kept under a real photo too, so a photo
                                // that is slow or fails to load shows the
                                // tinted tile instead of empty space.
                                gradient: LinearGradient(
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                  colors: [
                                    thumbnailTint.withValues(alpha: 0.45),
                                    thumbnailTint.withValues(alpha: 0.12),
                                  ],
                                ),
                              ),
                              child: thumbnailImage != null
                                  ? null
                                  : Icon(
                                      thumbnailIcon,
                                      color: Colors.white.withValues(
                                        alpha: 0.85,
                                      ),
                                      size: AppDimens.sdp(context, '_28sdp'),
                                    ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    SizedBox(width: AppDimens.sdp(context, '_14sdp')),
                    Container(width: 1, color: AppColors.fieldBorder),
                    SizedBox(width: AppDimens.sdp(context, '_14sdp')),
                    Expanded(
                      child: Column(
                        children: [
                          if (duration != null)
                            _CompactMetaRow(
                              icon: Icons.schedule_rounded,
                              label: AppStrings.durationLabel,
                              value: duration!,
                            ),
                          _CompactMetaRow(
                            icon: Icons.aspect_ratio_rounded,
                            label: AppStrings.aspectRatioLabel,
                            value: aspectRatio,
                          ),
                          _CompactMetaRow(
                            icon: Icons.high_quality_rounded,
                            label: AppStrings.outputQualityLabel,
                            value: outputQuality,
                          ),
                          _CompactMetaRow(
                            icon: Icons.toll_rounded,
                            label: AppStrings.creditsUsedLabel,
                            value: creditsUsed,
                          ),
                          _CompactMetaRow(
                            icon: Icons.calendar_today_rounded,
                            label: AppStrings.generatedOnLabel,
                            value: generatedOn,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

/// One label/value stat inside [GenerationDetailsCard]'s compact column next
/// to the Source Image thumbnail — a bare tinted icon and tighter spacing
/// than [MetaRow]'s full-width tile-and-divider row, since five of these
/// share that narrow column.
class _CompactMetaRow extends StatelessWidget {
  const _CompactMetaRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: AppDimens.sdp(context, '_12sdp')),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: AppColors.pinkGradientStart,
            size: AppDimens.sdp(context, '_16sdp'),
          ),
          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
          // A fixed width, not a flex ratio of the whole row: flex split the
          // *entire* remaining card width between label and value, pushing
          // the value far to the right of its own label with a huge gap.
          // '_145sdp' clears "Output Quality"/"Generated On" at this row's
          // biggest font scale (e.g. '_12ssp' runs bigger under the sw600
          // bucket than phone); maxLines+ellipsis is just a safety net.
          SizedBox(
            width: AppDimens.sdp(context, '_145sdp'),
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.regular.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_12ssp'),
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: AppTextStyles.semiBold.copyWith(
                color: Colors.white,
                fontSize: AppDimens.ssp(context, '_12ssp'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The Download / Regenerate / Share / Delete action row shown on the
/// Product and Creation detail pages: Download + Regenerate side by side,
/// Share + Delete side by side below.
class MediaActionButtons extends StatelessWidget {
  const MediaActionButtons({
    super.key,
    this.onDownload,
    this.onRegenerate,
    this.onShare,
    this.onDelete,
  });

  final VoidCallback? onDownload;
  final VoidCallback? onRegenerate;
  final VoidCallback? onShare;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final actionGap = AppDimens.sdp(context, '_10sdp');

    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: AppPillButton(
                label: AppStrings.download,
                icon: Icons.download_rounded,
                onTap: onDownload ?? () {},
              ),
            ),
            SizedBox(width: actionGap),
            Expanded(
              child: AppPillButton(
                label: AppStrings.regenerate,
                icon: Icons.refresh_rounded,
                style: AppPillButtonStyle.tonal,
                onTap: onRegenerate ?? () {},
              ),
            ),
          ],
        ),
        SizedBox(height: actionGap),
        Row(
          children: [
            Expanded(
              child: AppPillButton(
                label: AppStrings.share,
                icon: Icons.share_rounded,
                style: AppPillButtonStyle.tonal,
                onTap: onShare ?? () {},
              ),
            ),
            SizedBox(width: actionGap),
            Expanded(
              child: AppPillButton(
                label: AppStrings.delete,
                icon: Icons.delete_outline_rounded,
                style: AppPillButtonStyle.tonal,
                onTap: onDelete ?? () {},
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Numbered step header for a wizard-style form, e.g. "① Set Up Your
/// Product" on the Catalogue/Motion Studio screens.
class WizardStepHeader extends StatelessWidget {
  const WizardStepHeader({
    super.key,
    required this.number,
    required this.title,
    this.trailingLabel,
  });

  final int number;
  final String title;

  /// Small secondary text after the title, e.g. "(Optional)".
  final String? trailingLabel;

  @override
  Widget build(BuildContext context) {
    final badgeSize = AppDimens.sdp(context, '_22sdp');

    return Row(
      children: [
        Container(
          width: badgeSize,
          height: badgeSize,
          decoration: const BoxDecoration(
            gradient: AppColors.pinkGradient,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            '$number',
            style: AppTextStyles.bold.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_12ssp'),
            ),
          ),
        ),
        SizedBox(width: AppDimens.sdp(context, '_10sdp')),
        Flexible(
          child: Text(
            title,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.semiBold.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_14ssp'),
            ),
          ),
        ),
        if (trailingLabel != null) ...[
          SizedBox(width: AppDimens.sdp(context, '_4sdp')),
          Flexible(
            child: Text(
              '($trailingLabel)',
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.regular.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_12ssp'),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// Compact bordered dropdown field: an optional small icon, a secondary
/// label above a bold value, and a trailing chevron — sized to sit
/// side-by-side with 1-2 siblings in a [Row] of [Expanded]s. Used for
/// "Catalogue For" / "Garment Type" and the Output step's Platform /
/// Aspect Ratio / Resolution fields.
class LabeledDropdownField extends StatelessWidget {
  const LabeledDropdownField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.icon,
    this.tint,
  });

  final String label;
  final String value;
  final VoidCallback onTap;
  final IconData? icon;

  /// When set, renders [icon] inside a small tinted avatar chip (a stand-in
  /// thumbnail) instead of a bare glyph — e.g. "Catalogue For" / "Garment
  /// Type".
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_14sdp'));
    final chipSize = AppDimens.sdp(context, '_18sdp');

    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: AppDimens.sdp(context, '_12sdp'),
            vertical: AppDimens.sdp(context, '_10sdp'),
          ),
          decoration: BoxDecoration(
            color: AppColors.fieldFill,
            borderRadius: radius,
            border: Border.all(color: AppColors.fieldBorder),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (icon != null) ...[
                    if (tint != null)
                      Container(
                        width: chipSize,
                        height: chipSize,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(
                            AppDimens.sdp(context, '_5sdp'),
                          ),
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              tint!.withValues(alpha: 0.5),
                              tint!.withValues(alpha: 0.15),
                            ],
                          ),
                        ),
                        child: Icon(
                          icon,
                          color: Colors.white,
                          size: chipSize * 0.6,
                        ),
                      )
                    else
                      Icon(
                        icon,
                        color: AppColors.textSecondary,
                        // '_13sdp' isn't a real AppDimens key (the table
                        // jumps 12 -> 14) — the lookup silently fell back to
                        // 0, collapsing this icon to nothing.
                        size: AppDimens.sdp(context, '_14sdp'),
                      ),
                    SizedBox(width: AppDimens.sdp(context, '_6sdp')),
                  ],
                  Flexible(
                    child: Text(
                      label,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.regular.copyWith(
                        color: AppColors.textSecondary,
                        fontSize: AppDimens.ssp(context, '_10ssp'),
                      ),
                    ),
                  ),
                ],
              ),
              SizedBox(height: AppDimens.sdp(context, '_4sdp')),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      value,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_12ssp'),
                      ),
                    ),
                  ),
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    color: AppColors.textSecondary,
                    size: AppDimens.sdp(context, '_16sdp'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Full-width dropdown row (icon, secondary label above a bold value,
/// trailing chevron) for a single [CardContainer]-style list, e.g.
/// "Bottom Wear" / "Foot Wear" on the Catalogue Studio screen.
class LabeledDropdownRow extends StatelessWidget {
  const LabeledDropdownRow({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
    this.bordered = false,
    this.tint,
    this.iconBoxSize,
    this.trailingIcon = Icons.chevron_right_rounded,
    this.image,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;
  final IconData trailingIcon;

  /// When true, renders as its own bordered/filled box — for pairing
  /// side-by-side (e.g. "Model" + "Background") rather than sitting inside
  /// a [CardContainer]'s divided list.
  final bool bordered;

  /// When set, the icon box becomes a gradient-tinted thumbnail (a
  /// stand-in product photo) instead of a plain icon chip — e.g.
  /// "Catalogue For" / "Garment Type".
  final Color? tint;

  final double? iconBoxSize;

  /// A real photo for the box instead of [icon] — e.g. the selected garment
  /// type's own thumbnail, or a per-gender illustration. Callers build the
  /// image themselves (`Image.network`/`Image.asset`, with their own error
  /// handling) since the right source differs per caller; this only clips it
  /// into the box. Falls back to [icon] when null.
  final Widget? image;

  @override
  Widget build(BuildContext context) {
    final boxSize = iconBoxSize ?? AppDimens.sdp(context, '_36sdp');
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_14sdp'));

    final content = InkWell(
      onTap: onTap,
      borderRadius: bordered ? radius : null,
      child: Padding(
        padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
        child: Row(
          children: [
            Container(
              width: boxSize,
              height: boxSize,
              decoration: BoxDecoration(
                color: tint == null
                    ? Colors.white.withValues(alpha: 0.06)
                    : null,
                gradient: tint == null
                    ? null
                    : LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          tint!.withValues(alpha: 0.5),
                          tint!.withValues(alpha: 0.15),
                        ],
                      ),
                borderRadius: BorderRadius.circular(
                  AppDimens.sdp(context, '_10sdp'),
                ),
              ),
              child: image == null
                  ? Icon(icon, color: Colors.white, size: boxSize * 0.5)
                  : ClipRRect(
                      borderRadius: BorderRadius.circular(
                        AppDimens.sdp(context, '_10sdp'),
                      ),
                      child: image,
                    ),
            ),
            SizedBox(width: AppDimens.sdp(context, '_12sdp')),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: AppTextStyles.regular.copyWith(
                      color: AppColors.textSecondary,
                      fontSize: AppDimens.ssp(context, '_11ssp'),
                    ),
                  ),
                  SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                  Text(
                    value,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.semiBold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(context, '_13ssp'),
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              trailingIcon,
              color: AppColors.textSecondary,
              size: AppDimens.sdp(context, '_20sdp'),
            ),
          ],
        ),
      ),
    );

    if (!bordered) return content;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: radius,
        border: Border.all(color: AppColors.fieldBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: content,
    );
  }
}

/// Replays an animated GIF at a fraction of its own encoded speed.
///
/// Motion Studio's preset thumbnails are GIFs auto-generated by the admin
/// panel (apps/admin-web/src/lib/gif.ts, via the `gifshot` library) with
/// `frameDuration: 2` and `numFrames: 15` — 2 hundredths of a second per
/// frame, so the whole loop plays in ~0.3s. That timing is baked into the
/// GIF file itself; `Image.network` has no "playback speed" knob, it just
/// honors whatever per-frame delay the file specifies. This widget instead
/// decodes the GIF manually (`dart:ui`'s `instantiateImageCodec`) and steps
/// through frames on its own timer, multiplying each frame's real duration
/// by [speedFactor] so the same file plays back slower without touching the
/// asset or the admin app that generated it.
class SlowGifImage extends StatefulWidget {
  const SlowGifImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.speedFactor = 4,
    this.minFrameDuration = const Duration(milliseconds: 120),
    this.errorBuilder,
  });

  final String url;
  final BoxFit fit;
  final double speedFactor;

  /// Floor applied *after* [speedFactor] — some of these GIFs report a
  /// per-frame delay of only a few milliseconds (or even 0) to the decoder,
  /// so multiplying by [speedFactor] alone can still round to something
  /// imperceptibly short. This guarantees every frame is visible for at
  /// least this long regardless of what the file itself encoded.
  final Duration minFrameDuration;
  final Widget Function(BuildContext context)? errorBuilder;

  @override
  State<SlowGifImage> createState() => _SlowGifImageState();
}

class _SlowGifImageState extends State<SlowGifImage> {
  ui.Codec? _codec;
  ui.Image? _frameImage;
  Timer? _timer;
  bool _disposed = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(SlowGifImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) {
      _timer?.cancel();
      _codec = null;
      _frameImage = null;
      _failed = false;
      _load();
    }
  }

  Future<void> _load() async {
    try {
      // Through the shared disk cache: these presets never change, and a
      // fresh download per tile on every visit was most of this strip's
      // load time.
      final file = await DefaultCacheManager().getSingleFile(
        widget.url,
        key: imageCacheKey(widget.url),
      );
      if (_disposed) return;
      final bytes = await file.readAsBytes();
      if (_disposed) return;
      _codec = await ui.instantiateImageCodec(bytes);
      await _showNextFrame();
    } catch (_) {
      if (!_disposed) setState(() => _failed = true);
    }
  }

  Future<void> _showNextFrame() async {
    final codec = _codec;
    if (_disposed || codec == null) return;
    final frame = await codec.getNextFrame();
    if (_disposed) return;
    setState(() => _frameImage = frame.image);
    final scaled = frame.duration * widget.speedFactor;
    final delay = scaled < widget.minFrameDuration
        ? widget.minFrameDuration
        : scaled;
    _timer = Timer(delay, _showNextFrame);
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) {
      return widget.errorBuilder?.call(context) ?? const SizedBox.shrink();
    }
    final image = _frameImage;
    if (image == null) return const SizedBox.shrink();
    return RawImage(image: image, fit: widget.fit);
  }
}

/// Square-ish selectable thumbnail: a gradient-tinted placeholder with a
/// pink border + check badge when selected, and an optional caption below
/// (e.g. preset names). Used for Model / Preset / Pose pickers in the
/// Catalogue and Motion Studio flows.
class SelectableThumbnailTile extends StatelessWidget {
  const SelectableThumbnailTile({
    super.key,
    required this.icon,
    required this.tint,
    required this.selected,
    required this.onTap,
    this.caption,
    this.size,
    this.width,
    this.height,
    this.radius,
    this.imageUrl,
    this.slowGif = false,
    this.showCheck = true,
  });

  final IconData icon;
  final Color tint;
  final bool selected;
  final VoidCallback onTap;
  final String? caption;

  /// Whether a selected tile also gets the pink check badge. Off for strips
  /// where the pink border alone marks the selection (result-page thumbnails).
  final bool showCheck;

  /// When set, renders this network image instead of the icon+tint
  /// placeholder (falling back to the placeholder on load failure).
  final String? imageUrl;

  /// When true, [imageUrl] is played back via [SlowGifImage] instead of a
  /// plain `Image.network` — for the handful of thumbnails that are actually
  /// admin-generated animated GIFs (Motion Studio's presets) rather than a
  /// static photo, and whose baked-in frame timing plays too fast.
  final bool slowGif;

  /// Convenience for a square tile — equivalent to setting [width] and
  /// [height] to the same value. Ignored if either is set explicitly.
  final double? size;
  final double? width;
  final double? height;
  final double? radius;

  @override
  Widget build(BuildContext context) {
    final tileWidth = width ?? size ?? AppDimens.sdp(context, '_64sdp');
    final tileHeight = height ?? size ?? AppDimens.sdp(context, '_64sdp');
    final borderRadius = BorderRadius.circular(
      radius ?? AppDimens.sdp(context, '_12sdp'),
    );

    return GestureDetector(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              ClipRRect(
                borderRadius: borderRadius,
                child: Container(
                  width: tileWidth,
                  height: tileHeight,
                  decoration: BoxDecoration(
                    borderRadius: borderRadius,
                    gradient: imageUrl == null
                        ? LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              tint.withValues(alpha: 0.45),
                              tint.withValues(alpha: 0.12),
                            ],
                          )
                        : null,
                  ),
                  // A foreground decoration, not part of the BoxDecoration
                  // above: that one paints BEHIND the child, so an opaque
                  // photo (imageUrl case) would fully cover the selection
                  // ring and hide it. Painting the border after the child
                  // keeps it visible on top of the image instead.
                  foregroundDecoration: BoxDecoration(
                    border: Border.all(
                      color: selected
                          ? AppColors.pinkGradientStart
                          : AppColors.fieldBorder,
                      width: selected ? 2 : 1,
                    ),
                    borderRadius: borderRadius,
                  ),
                  // A leading 'assets/' marks a bundled local image (e.g.
                  // Gender's fixed illustrations, which have no API photo)
                  // rather than a server-hosted photo — everything else here
                  // is a real network URL.
                  child: imageUrl != null
                      ? (imageUrl!.startsWith('assets/')
                            ? Image.asset(
                                imageUrl!,
                                width: tileWidth,
                                height: tileHeight,
                                fit: BoxFit.cover,
                              )
                            : slowGif
                            ? SlowGifImage(
                                url: imageUrl!,
                                fit: BoxFit.cover,
                                errorBuilder: (_) => Icon(
                                  icon,
                                  color: Colors.white.withValues(alpha: 0.85),
                                  size: tileWidth * 0.4,
                                ),
                              )
                            : AppNetworkImage(
                                imageUrl!,
                                width: tileWidth,
                                height: tileHeight,
                                thumbnail: true,
                                errorBuilder: (_) => Icon(
                                  icon,
                                  color: Colors.white.withValues(alpha: 0.85),
                                  size: tileWidth * 0.4,
                                ),
                              ))
                      : Icon(
                          icon,
                          color: Colors.white.withValues(alpha: 0.85),
                          size: tileWidth * 0.4,
                        ),
                ),
              ),
              if (selected && showCheck)
                Positioned(
                  top: -AppDimens.sdp(context, '_4sdp'),
                  right: -AppDimens.sdp(context, '_4sdp'),
                  child: Container(
                    padding: EdgeInsets.all(AppDimens.sdp(context, '_2sdp')),
                    decoration: const BoxDecoration(
                      color: AppColors.pinkGradientStart,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.check_rounded,
                      color: Colors.white,
                      size: AppDimens.sdp(context, '_10sdp'),
                    ),
                  ),
                ),
            ],
          ),
          if (caption != null) ...[
            SizedBox(height: AppDimens.sdp(context, '_6sdp')),
            SizedBox(
              width: tileWidth,
              child: Text(
                caption!,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.medium.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_10ssp'),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Plain `fieldFill`-tinted bordered container with padding — the
/// undivided version of [CardContainer], for wrapping a block of mixed
/// content (e.g. a wizard step's fields) rather than a list of rows.
class BorderedCard extends StatelessWidget {
  const BorderedCard({super.key, required this.child, this.padding});

  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding ?? EdgeInsets.all(AppDimens.sdp(context, '_16sdp')),
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_20sdp')),
        border: Border.all(color: AppColors.fieldBorder),
      ),
      child: child,
    );
  }
}

/// Small circular icon button with a `fieldFill` background and border —
/// e.g. the share button in a detail page header.
class CircleIconButton extends StatelessWidget {
  const CircleIconButton({super.key, required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final size = AppDimens.sdp(context, '_36sdp');

    return Material(
      color: AppColors.fieldFill,
      shape: CircleBorder(side: BorderSide(color: AppColors.fieldBorder)),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(
            icon,
            color: Colors.white,
            size: AppDimens.sdp(context, '_16sdp'),
          ),
        ),
      ),
    );
  }
}

/// Lays out exactly [itemCount] tiles in one non-scrolling row, each
/// getting an equal share of the available width and a height derived
/// from [aspectRatio] (width / height) — e.g. the Model and Pose picker
/// rows, which show all their options at once rather than scrolling.
class ThumbnailTileRow extends StatelessWidget {
  const ThumbnailTileRow({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
    this.aspectRatio = 0.81,
    this.spacing,
    this.minTileWidth = 56,
  });

  final int itemCount;
  final Widget Function(
    BuildContext context,
    int index,
    double tileWidth,
    double tileHeight,
  )
  itemBuilder;
  final double aspectRatio;
  final double? spacing;

  /// Floor for a tile's width. Below this, tiles stop shrinking to fit and
  /// the row scrolls horizontally instead — without a floor, a garment
  /// type/gender combo with many items (or, at the other extreme, zero
  /// items — see the itemCount==0 guard below) could compute a negative,
  /// zero, or infinite tile size and crash this widget's layout.
  final double minTileWidth;

  @override
  Widget build(BuildContext context) {
    final gap = spacing ?? AppDimens.sdp(context, '_8sdp');

    // No items is a valid, non-error API response (e.g. a garment type with
    // no poses configured yet for this gender) — render nothing rather than
    // dividing constraints.maxWidth by zero below.
    if (itemCount == 0) {
      return const SizedBox.shrink();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final fitWidth =
            (constraints.maxWidth - gap * (itemCount - 1)) / itemCount;
        final tileWidth = fitWidth < minTileWidth ? minTileWidth : fitWidth;
        final tileHeight = tileWidth / aspectRatio;
        final row = Row(
          children: [
            for (var i = 0; i < itemCount; i++) ...[
              if (i > 0) SizedBox(width: gap),
              itemBuilder(context, i, tileWidth, tileHeight),
            ],
          ],
        );
        return SizedBox(
          height: tileHeight,
          // Below the floor width, items no longer all fit on screen at a
          // usable size — scroll instead of continuing to squeeze them.
          child: fitWidth < minTileWidth
              ? SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  // Don't clip the selected tile's check badge.
                  clipBehavior: Clip.none,
                  child: row,
                )
              : row,
        );
      },
    );
  }
}

/// A single entry for [LimitedThumbnailRow]/the "More" picker sheets —
/// decouples them from any one model type (faces, backgrounds, poses all
/// use this same shape). [imageUrl] is nullable for entries with no photo
/// (e.g. Gender, or a Garment Type with no admin-uploaded thumbnail) —
/// [SelectableThumbnailTile] renders its icon+tint placeholder for those
/// instead of trying (and failing) to load an empty URL.
typedef PickableThumb = ({
  String id,
  String label,
  String? imageUrl,
  Color tint,
});

/// Caps how many items it shows: past [visibleCount] it renders a trailing
/// "More" tile (opening [onMore]) instead of shrinking every tile to fit or
/// scrolling through all of them — mirrors the web app's "View All" link.
/// Used for every compact picker row on the Catalogue/Motion Studio screens
/// (Model, Background, Poses, Lower Garment, Footwear).
///
/// Tile width is `availableWidth / _referenceSlots` — a fixed *divisor*
/// (not a fixed pixel size), so tiles still scale up on a wider screen
/// (tablet) exactly like the rest of the responsive `AppDimens`-scaled UI.
/// What makes every row look identical is that they all divide by the same
/// constant regardless of how many slots that particular row actually shows
/// — dividing by each row's own real slot count used to make a row with an
/// extra leading tile (e.g. Background's "Upload" action, or Lower/Footwear's
/// "None") render visibly smaller tiles than one without, even on the same
/// screen. Callers with a leading tile should pass `visibleCount: 3` so
/// their real slot count (leading + 3 + more = 5) still matches
/// [_referenceSlots] exactly and never needs the scroll fallback below.
class LimitedThumbnailRow extends StatelessWidget {
  const LimitedThumbnailRow({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
    required this.onMore,
    this.visibleCount = 4,
    this.spacing,
    // Was 1 (square) — every photo shown in these rows (headshots,
    // full-body poses, backgrounds) is portrait, so a square tile made
    // `BoxFit.cover` crop hard off the top/bottom to fill the width. 0.81
    // matches this app's other portrait-card convention (MediaHeroImage,
    // the original ThumbnailTileRow default) — tall enough to noticeably
    // reduce that crop while keeping every row's tiles identically shaped.
    this.aspectRatio = 0.81,
    this.leading,
    this.captionAllowance = 0,
  });

  final int itemCount;
  final Widget Function(
    BuildContext context,
    int index,
    double tileWidth,
    double tileHeight,
  )
  itemBuilder;
  final VoidCallback onMore;
  final int visibleCount;
  final double? spacing;
  final double aspectRatio;

  /// Extra height reserved below the image tile for an itemBuilder that
  /// renders a caption (`SelectableThumbnailTile(caption: ...)`) — the row's
  /// own [height] otherwise only fits the plain image, and a caption tacked
  /// on underneath it inside a tile that's the same fixed height overflows.
  /// Every current row omits this (0) because none of them show captions
  /// except the ones that pass it explicitly.
  final double captionAllowance;

  /// An optional fixed leading tile (e.g. Background's "Upload" action, or
  /// Lower/Footwear's "None") that always renders first, sized identically
  /// to the rest and not counted against [visibleCount].
  final Widget Function(double tileWidth, double tileHeight)? leading;

  static const _referenceSlots = 5;
  static const _minTileWidth = 48.0;

  /// Below this row width (a phone) tiles are sized for 3 full slots plus a
  /// half-tile peek of the next, instead of all 5 squeezed in: 5 across a
  /// ~360dp phone made every picker thumbnail noticeably smaller than on a
  /// tablet. The peek shows the row scrolls to the rest (incl. "More").
  static const _phoneMaxWidth = 500.0;

  /// Tile width for a row of [maxWidth]; shared with picker rows built
  /// outside this widget (the Ready-Made Look row) so all rows stay equal.
  static double tileWidthFor(double maxWidth, double gap) {
    final fitWidth = maxWidth < _phoneMaxWidth
        ? (maxWidth - gap * 3) / 3.5
        : (maxWidth - gap * (_referenceSlots - 1)) / _referenceSlots;
    return fitWidth < _minTileWidth ? _minTileWidth : fitWidth;
  }

  @override
  Widget build(BuildContext context) {
    if (itemCount == 0 && leading == null) return const SizedBox.shrink();

    final gap = spacing ?? AppDimens.sdp(context, '_8sdp');
    final showMore = itemCount > visibleCount;
    final shownCount = showMore ? visibleCount : itemCount;

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = tileWidthFor(constraints.maxWidth, gap);
        final height = width / aspectRatio;

        final tiles = <Widget>[
          if (leading != null) leading!(width, height),
          for (var i = 0; i < shownCount; i++)
            itemBuilder(context, i, width, height),
          if (showMore)
            MoreThumbnailTile(width: width, height: height, onTap: onMore),
        ];

        final row = Row(
          // Top-aligned rather than the default center: with a nonzero
          // captionAllowance the row is taller than the plain image tiles
          // (e.g. the "More" tile, which has no caption), and centering
          // would float everything at mismatched vertical offsets instead
          // of keeping every image's top edge level.
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < tiles.length; i++) ...[
              if (i > 0) SizedBox(width: gap),
              tiles[i],
            ],
          ],
        );

        final contentWidth = tiles.length * width + gap * (tiles.length - 1);
        return SizedBox(
          height: height + captionAllowance,
          child: contentWidth > constraints.maxWidth
              ? SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  // Don't clip the selected tile's check badge.
                  clipBehavior: Clip.none,
                  child: row,
                )
              : row,
        );
      },
    );
  }
}

class MoreThumbnailTile extends StatelessWidget {
  const MoreThumbnailTile({
    super.key,
    required this.width,
    required this.height,
    required this.onTap,
  });

  final double width;
  final double height;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.fieldFill,
          border: Border.all(color: AppColors.fieldBorder),
          borderRadius: radius,
        ),
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.grid_view_rounded,
              color: AppColors.textSecondary,
              size: width * 0.32,
            ),
            SizedBox(height: AppDimens.sdp(context, '_4sdp')),
            Text(
              'More',
              style: AppTextStyles.medium.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(context, '_10ssp'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Bottom sheet grid for picking exactly one item — the "More" destination
/// for a [LimitedThumbnailRow] (Model, Background).
/// The captioned grid shared by [showSingleThumbnailPickerSheet] and
/// [showMultiThumbnailPickerSheet]. `GridView`'s `SliverGridDelegateWithFixedCrossAxisCount`
/// sizes each *cell* to divide the available width evenly, but a bare
/// [SelectableThumbnailTile] renders at its own small default size
/// regardless of how big the cell actually is — leaving a tiny thumbnail
/// floating in a much larger, mostly-empty cell. This computes the real
/// cell width via [LayoutBuilder] and passes it through explicitly so every
/// tile actually fills its cell, and derives `childAspectRatio` from that
/// same width plus a caption allowance so the cell's height exactly fits
/// the tile's image + caption with no leftover gap.
class _ThumbnailPickerGrid extends StatelessWidget {
  const _ThumbnailPickerGrid({
    required this.items,
    required this.isSelected,
    required this.onTap,
    this.slowGif = false,
  });

  final List<PickableThumb> items;
  final bool Function(String id) isSelected;
  final void Function(String id) onTap;

  /// See [SelectableThumbnailTile.slowGif] — set for the Motion Preset
  /// "More" sheet, whose items are all animated GIFs, not static photos.
  final bool slowGif;

  static const _crossAxisCount = 3;

  @override
  Widget build(BuildContext context) {
    final crossSpacing = AppDimens.sdp(context, '_10sdp');
    final mainSpacing = AppDimens.sdp(context, '_14sdp');
    final horizontalPadding = AppDimens.sdp(context, '_20sdp');

    return LayoutBuilder(
      builder: (context, constraints) {
        final availableWidth =
            constraints.maxWidth -
            horizontalPadding * 2 -
            crossSpacing * (_crossAxisCount - 1);
        final cellWidth = availableWidth / _crossAxisCount;
        // 0.81 matches LimitedThumbnailRow's own tile ratio — these photos
        // (headshots, full-body poses, backgrounds) are portrait, so the
        // image portion is taller than it is wide, same as the compact row
        // these sheets are the "More" destination for.
        final imageHeight = cellWidth / 0.81;
        // Was '_22sdp' — every cell overflowed by ~4 logical pixels (the
        // caption's real rendered line height, including font
        // ascent/descent, runs a bit taller than a naive fontSize*lineHeight
        // estimate). '_28sdp' clears it with a small margin to spare.
        final captionAllowance = AppDimens.sdp(context, '_28sdp');
        final cellHeight = imageHeight + captionAllowance;

        return GridView.builder(
          shrinkWrap: true,
          padding: EdgeInsets.symmetric(
            horizontal: horizontalPadding,
            vertical: AppDimens.sdp(context, '_8sdp'),
          ),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: _crossAxisCount,
            mainAxisSpacing: mainSpacing,
            crossAxisSpacing: crossSpacing,
            childAspectRatio: cellWidth / cellHeight,
          ),
          itemCount: items.length,
          itemBuilder: (context, index) {
            final item = items[index];
            return SelectableThumbnailTile(
              icon: Icons.image_rounded,
              imageUrl: item.imageUrl,
              slowGif: slowGif,
              tint: item.tint,
              caption: item.label,
              width: cellWidth,
              height: imageHeight,
              selected: isSelected(item.id),
              onTap: () => onTap(item.id),
            );
          },
        );
      },
    );
  }
}

Future<String?> showSingleThumbnailPickerSheet(
  BuildContext context, {
  required String title,
  required List<PickableThumb> items,
  required String? selectedId,
  bool slowGif = false,
}) {
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: AppColors.sheetBackground,
    isScrollControlled: true,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppDimens.sdp(context, '_20sdp')),
      ),
    ),
    builder: (sheetContext) {
      final maxHeight = MediaQuery.sizeOf(sheetContext).height * 0.75;
      return SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxHeight),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(
                  AppDimens.sdp(sheetContext, '_20sdp'),
                  AppDimens.sdp(sheetContext, '_20sdp'),
                  AppDimens.sdp(sheetContext, '_20sdp'),
                  AppDimens.sdp(sheetContext, '_8sdp'),
                ),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    title,
                    style: AppTextStyles.semiBold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(sheetContext, '_15ssp'),
                    ),
                  ),
                ),
              ),
              Flexible(
                child: _ThumbnailPickerGrid(
                  items: items,
                  isSelected: (id) => id == selectedId,
                  onTap: (id) => Navigator.of(sheetContext).pop(id),
                  slowGif: slowGif,
                ),
              ),
              SizedBox(height: AppDimens.sdp(sheetContext, '_12sdp')),
            ],
          ),
        ),
      );
    },
  );
}

/// One filter category for [showFilterableThumbnailPickerSheet] — a catalog
/// tree's top-level node (e.g. "Mini skirts") plus the items under it.
typedef PickableCategory = ({
  String id,
  String label,
  List<PickableThumb> items,
});

/// Bottom sheet grid for picking exactly one item, with a category filter —
/// the "More" destination for Lower Garment / Footwear. Mirrors the web
/// app's own "View more" modal (studio/page.tsx): an "All Garments (N)"
/// dropdown (each catalog category is a filter, not a separate section) atop
/// the same picker grid [showSingleThumbnailPickerSheet] uses.
Future<String?> showFilterableThumbnailPickerSheet(
  BuildContext context, {
  required String title,
  required List<PickableCategory> categories,
  required String? selectedId,
}) {
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: AppColors.sheetBackground,
    isScrollControlled: true,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppDimens.sdp(context, '_20sdp')),
      ),
    ),
    builder: (sheetContext) {
      final maxHeight = MediaQuery.sizeOf(sheetContext).height * 0.8;
      // null = "All Garments" (every category's items, unfiltered).
      String? activeCategoryId;
      return StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          final allItems = [for (final c in categories) ...c.items];
          final active = activeCategoryId == null
              ? null
              : categories.firstWhere((c) => c.id == activeCategoryId);
          final visibleItems = active?.items ?? allItems;
          final triggerLabel = active == null
              ? 'All Garments (${allItems.length})'
              : '${active.label} (${active.items.length})';

          return SafeArea(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxHeight: maxHeight),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: EdgeInsets.fromLTRB(
                      AppDimens.sdp(sheetContext, '_20sdp'),
                      AppDimens.sdp(sheetContext, '_20sdp'),
                      AppDimens.sdp(sheetContext, '_20sdp'),
                      AppDimens.sdp(sheetContext, '_8sdp'),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            style: AppTextStyles.semiBold.copyWith(
                              color: Colors.white,
                              fontSize: AppDimens.ssp(sheetContext, '_15ssp'),
                            ),
                          ),
                        ),
                        InkWell(
                          onTap: () => Navigator.of(sheetContext).pop(),
                          customBorder: const CircleBorder(),
                          child: Padding(
                            padding: EdgeInsets.all(
                              AppDimens.sdp(sheetContext, '_4sdp'),
                            ),
                            child: Icon(
                              Icons.close_rounded,
                              color: AppColors.textSecondary,
                              size: AppDimens.sdp(sheetContext, '_18sdp'),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (categories.length > 1)
                    Padding(
                      padding: EdgeInsets.fromLTRB(
                        AppDimens.sdp(sheetContext, '_20sdp'),
                        0,
                        AppDimens.sdp(sheetContext, '_20sdp'),
                        AppDimens.sdp(sheetContext, '_12sdp'),
                      ),
                      child: Material(
                        color: Colors.transparent,
                        borderRadius: BorderRadius.circular(
                          AppDimens.sdp(sheetContext, '_12sdp'),
                        ),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(
                            AppDimens.sdp(sheetContext, '_12sdp'),
                          ),
                          onTap: () async {
                            final options = [
                              'All Garments (${allItems.length})',
                              for (final c in categories)
                                '${c.label} (${c.items.length})',
                            ];
                            final picked = await pickOptionSheet(
                              sheetContext,
                              title: title,
                              options: options,
                              selected: triggerLabel,
                            );
                            if (picked == null) return;
                            final matchedCategory = categories
                                .where(
                                  (c) =>
                                      '${c.label} (${c.items.length})' ==
                                      picked,
                                )
                                .firstOrNull;
                            setSheetState(
                              () => activeCategoryId = matchedCategory?.id,
                            );
                          },
                          child: Container(
                            padding: EdgeInsets.symmetric(
                              horizontal: AppDimens.sdp(sheetContext, '_14sdp'),
                              vertical: AppDimens.sdp(sheetContext, '_12sdp'),
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.fieldFill,
                              borderRadius: BorderRadius.circular(
                                AppDimens.sdp(sheetContext, '_12sdp'),
                              ),
                              border: Border.all(color: AppColors.fieldBorder),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    triggerLabel,
                                    overflow: TextOverflow.ellipsis,
                                    style: AppTextStyles.medium.copyWith(
                                      color: Colors.white,
                                      fontSize: AppDimens.ssp(
                                        sheetContext,
                                        '_13ssp',
                                      ),
                                    ),
                                  ),
                                ),
                                Icon(
                                  Icons.keyboard_arrow_down_rounded,
                                  color: AppColors.textSecondary,
                                  size: AppDimens.sdp(sheetContext, '_20sdp'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  Flexible(
                    child: visibleItems.isEmpty
                        ? Padding(
                            padding: EdgeInsets.all(
                              AppDimens.sdp(sheetContext, '_20sdp'),
                            ),
                            child: Text(
                              'No items in this category yet.',
                              style: AppTextStyles.medium.copyWith(
                                color: AppColors.textSecondary,
                                fontSize: AppDimens.ssp(sheetContext, '_13ssp'),
                              ),
                            ),
                          )
                        : _ThumbnailPickerGrid(
                            items: visibleItems,
                            isSelected: (id) => id == selectedId,
                            onTap: (id) => Navigator.of(sheetContext).pop(id),
                          ),
                  ),
                  SizedBox(height: AppDimens.sdp(sheetContext, '_12sdp')),
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

/// Bottom sheet grid for toggling a multi-select set — the "More"
/// destination for the Pose picker.
Future<Set<String>?> showMultiThumbnailPickerSheet(
  BuildContext context, {
  required String title,
  required List<PickableThumb> items,
  required Set<String> selectedIds,
}) {
  return showModalBottomSheet<Set<String>>(
    context: context,
    backgroundColor: AppColors.sheetBackground,
    isScrollControlled: true,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppDimens.sdp(context, '_20sdp')),
      ),
    ),
    builder: (sheetContext) {
      final working = {...selectedIds};
      final maxHeight = MediaQuery.sizeOf(sheetContext).height * 0.8;
      return StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          return SafeArea(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxHeight: maxHeight),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: EdgeInsets.fromLTRB(
                      AppDimens.sdp(sheetContext, '_20sdp'),
                      AppDimens.sdp(sheetContext, '_20sdp'),
                      AppDimens.sdp(sheetContext, '_20sdp'),
                      AppDimens.sdp(sheetContext, '_8sdp'),
                    ),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        title,
                        style: AppTextStyles.semiBold.copyWith(
                          color: Colors.white,
                          fontSize: AppDimens.ssp(sheetContext, '_15ssp'),
                        ),
                      ),
                    ),
                  ),
                  Flexible(
                    child: _ThumbnailPickerGrid(
                      items: items,
                      isSelected: (id) => working.contains(id),
                      onTap: (id) => setSheetState(() {
                        if (!working.remove(id)) working.add(id);
                      }),
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.fromLTRB(
                      AppDimens.sdp(sheetContext, '_20sdp'),
                      AppDimens.sdp(sheetContext, '_12sdp'),
                      AppDimens.sdp(sheetContext, '_20sdp'),
                      AppDimens.sdp(sheetContext, '_12sdp'),
                    ),
                    child: GradientButton(
                      label: 'Done (${working.length} selected)',
                      onPressed: () => Navigator.of(sheetContext).pop(working),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

/// Bundled reference photos for [showGarmentUploadTipsSheet] — cropped from
/// the app's own design reference rather than fetched from anywhere, since
/// showing a real garment photo (not an icon placeholder) is the point.
class _UploadTipAssets {
  _UploadTipAssets._();

  static const goodInput = 'assets/images/upload_tips/good_input.png';
  static const badFoldedWrinkled =
      'assets/images/upload_tips/bad_folded_wrinkled.png';
  static const badDarkBlurry = 'assets/images/upload_tips/bad_dark_blurry.png';
  static const badCropped = 'assets/images/upload_tips/bad_cropped.png';
}

/// Full-screen sheet opened from the info icon next to "Upload Your
/// Garment" — a reference example plus quick photography tips, so the user
/// uploads a photo the pipeline can actually work with.
///
/// [instructionImageUrl] is the selected garment type's admin-uploaded
/// do's/don'ts guide (`GarmentType.instructionImageUrl`) — when set, it
/// replaces the bundled static Good/Bad Input example with this live,
/// garment-type-specific one instead, changing every time the user picks a
/// different garment type. Null falls back to the bundled example, for
/// garment types with no admin-uploaded guide.
Future<void> showGarmentUploadTipsSheet(
  BuildContext context, {
  String? instructionImageUrl,
}) {
  return showModalBottomSheet<void>(
    context: context,
    // Transparent so the ClipRRect below — not this call's own Material —
    // paints the sheet's visible background, matching the app's signature
    // glow (the same `AppAssets.backgroundGlow` image every full page uses,
    // via DetailPageScaffold) instead of a flat, unstyled black slab.
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (sheetContext) {
      final screenHeight = MediaQuery.sizeOf(sheetContext).height;
      final topRadius = Radius.circular(AppDimens.sdp(sheetContext, '_20sdp'));
      return ClipRRect(
        borderRadius: BorderRadius.vertical(top: topRadius),
        child: Container(
          color: AppColors.background,
          child: Stack(
            children: [
              Positioned.fill(
                child: Image.asset(AppAssets.backgroundGlow, fit: BoxFit.cover),
              ),
              Center(
                child: ConstrainedBox(
                  // Same responsive width cap DetailPageScaffold uses
                  // everywhere else (650 on phone/sw600, 720 on sw720) — on
                  // phone it's a no-op (every phone is narrower), and on
                  // tablet it lets the card fill the screen properly instead
                  // of sitting pinned at a phone-sized width in the middle.
                  // Safe to reuse now that the example cards below size by
                  // aspect ratio rather than a fixed height, so a wider
                  // container scales them up cleanly instead of distorting
                  // them. The height cap sizes the sheet to its own content
                  // (so "Got It" sits right below the tips, not stranded far
                  // down the screen) while still leaving room to scroll on a
                  // short phone screen.
                  constraints: BoxConstraints(
                    maxWidth: AppDimens.sdp(
                      sheetContext,
                      '_screen_container_width',
                    ),
                    maxHeight: screenHeight * 0.92,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(height: AppDimens.sdp(sheetContext, '_10sdp')),
                      Container(
                        width: AppDimens.sdp(sheetContext, '_36sdp'),
                        height: AppDimens.sdp(sheetContext, '_4sdp'),
                        decoration: BoxDecoration(
                          color: AppColors.fieldBorder,
                          borderRadius: BorderRadius.circular(
                            AppDimens.sdp(sheetContext, '_2sdp'),
                          ),
                        ),
                      ),
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          AppDimens.sdp(sheetContext, '_20sdp'),
                          AppDimens.sdp(sheetContext, '_16sdp'),
                          AppDimens.sdp(sheetContext, '_12sdp'),
                          0,
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    AppStrings.uploadTipsTitle,
                                    style: AppTextStyles.semiBold.copyWith(
                                      color: Colors.white,
                                      fontSize: AppDimens.ssp(
                                        sheetContext,
                                        '_16ssp',
                                      ),
                                    ),
                                  ),
                                  SizedBox(
                                    height: AppDimens.sdp(
                                      sheetContext,
                                      '_4sdp',
                                    ),
                                  ),
                                  Text(
                                    AppStrings.uploadTipsSubtitle,
                                    style: AppTextStyles.medium.copyWith(
                                      color: AppColors.textSecondary,
                                      fontSize: AppDimens.ssp(
                                        sheetContext,
                                        '_12ssp',
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            InkWell(
                              onTap: () => Navigator.of(sheetContext).pop(),
                              customBorder: const CircleBorder(),
                              child: Padding(
                                padding: EdgeInsets.all(
                                  AppDimens.sdp(sheetContext, '_6sdp'),
                                ),
                                child: Icon(
                                  Icons.close_rounded,
                                  color: AppColors.textSecondary,
                                  size: AppDimens.sdp(sheetContext, '_20sdp'),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: SingleChildScrollView(
                          padding: EdgeInsets.fromLTRB(
                            AppDimens.sdp(sheetContext, '_20sdp'),
                            AppDimens.sdp(sheetContext, '_16sdp'),
                            AppDimens.sdp(sheetContext, '_20sdp'),
                            AppDimens.sdp(sheetContext, '_8sdp'),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Each section is its own bordered card — the
                              // reference design groups the example(s) and
                              // Quick Tips in separate outlined panels rather
                              // than running them straight into the plain
                              // background.
                              if (instructionImageUrl != null) ...[
                                BorderedCard(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      _TipsSectionHeader(
                                        icon: Icons.check_circle_rounded,
                                        color: AppColors.success,
                                        label: AppStrings.referenceGuideLabel,
                                      ),
                                      SizedBox(
                                        height: AppDimens.sdp(
                                          sheetContext,
                                          '_10sdp',
                                        ),
                                      ),
                                      ClipRRect(
                                        borderRadius: BorderRadius.circular(
                                          AppDimens.sdp(sheetContext, '_12sdp'),
                                        ),
                                        child: AppNetworkImage(
                                          instructionImageUrl,
                                          width: double.infinity,
                                          fit: BoxFit.contain,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                SizedBox(
                                  height: AppDimens.sdp(sheetContext, '_14sdp'),
                                ),
                              ] else ...[
                                BorderedCard(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      _TipsSectionHeader(
                                        icon: Icons.check_circle_rounded,
                                        color: AppColors.success,
                                        label: AppStrings.goodInputLabel,
                                      ),
                                      SizedBox(
                                        height: AppDimens.sdp(
                                          sheetContext,
                                          '_10sdp',
                                        ),
                                      ),
                                      _TipsExampleCard(
                                        assetPath: _UploadTipAssets.goodInput,
                                        // Matches the bundled reference
                                        // photo's own proportions (320x220) so
                                        // BoxFit.cover never has to stretch it
                                        // into a distorted shape.
                                        aspectRatio: 320 / 220,
                                      ),
                                    ],
                                  ),
                                ),
                                SizedBox(
                                  height: AppDimens.sdp(sheetContext, '_14sdp'),
                                ),
                                BorderedCard(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      _TipsSectionHeader(
                                        icon: Icons.cancel_rounded,
                                        color: AppColors.danger,
                                        label: AppStrings.badInputLabel,
                                      ),
                                      SizedBox(
                                        height: AppDimens.sdp(
                                          sheetContext,
                                          '_10sdp',
                                        ),
                                      ),
                                      Row(
                                        children: [
                                          Expanded(
                                            child: _TipsExampleCard(
                                              assetPath: _UploadTipAssets
                                                  .badFoldedWrinkled,
                                              aspectRatio: 1,
                                              caption: AppStrings
                                                  .badInputFoldedWrinkled,
                                            ),
                                          ),
                                          SizedBox(
                                            width: AppDimens.sdp(
                                              sheetContext,
                                              '_10sdp',
                                            ),
                                          ),
                                          Expanded(
                                            child: _TipsExampleCard(
                                              assetPath: _UploadTipAssets
                                                  .badDarkBlurry,
                                              aspectRatio: 1,
                                              caption:
                                                  AppStrings.badInputDarkBlurry,
                                            ),
                                          ),
                                          SizedBox(
                                            width: AppDimens.sdp(
                                              sheetContext,
                                              '_10sdp',
                                            ),
                                          ),
                                          Expanded(
                                            child: _TipsExampleCard(
                                              assetPath:
                                                  _UploadTipAssets.badCropped,
                                              aspectRatio: 1,
                                              caption:
                                                  AppStrings.badInputCropped,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                                SizedBox(
                                  height: AppDimens.sdp(sheetContext, '_14sdp'),
                                ),
                              ],
                              BorderedCard(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _TipsSectionHeader(
                                      icon: Icons.lightbulb_rounded,
                                      color: Colors.amber,
                                      label: AppStrings.quickTipsLabel,
                                    ),
                                    SizedBox(
                                      height: AppDimens.sdp(
                                        sheetContext,
                                        '_14sdp',
                                      ),
                                    ),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: _QuickTipItem(
                                            svgAsset: AppAssets.catalogueIcon,
                                            label: AppStrings
                                                .quickTipEntireGarment,
                                          ),
                                        ),
                                        Expanded(
                                          child: _QuickTipItem(
                                            icon: Icons.light_mode_rounded,
                                            label:
                                                AppStrings.quickTipGoodLighting,
                                          ),
                                        ),
                                        Expanded(
                                          child: _QuickTipItem(
                                            icon: Icons.image_rounded,
                                            label: AppStrings
                                                .quickTipPlainBackground,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          AppDimens.sdp(sheetContext, '_20sdp'),
                          AppDimens.sdp(sheetContext, '_4sdp'),
                          AppDimens.sdp(sheetContext, '_20sdp'),
                          AppDimens.sdp(sheetContext, '_12sdp'),
                        ),
                        child: GradientButton(
                          label: AppStrings.gotIt,
                          onPressed: () => Navigator.of(sheetContext).pop(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _TipsSectionHeader extends StatelessWidget {
  const _TipsSectionHeader({
    required this.icon,
    required this.color,
    required this.label,
  });

  final IconData icon;
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: color, size: AppDimens.sdp(context, '_18sdp')),
        SizedBox(width: AppDimens.sdp(context, '_8sdp')),
        Text(
          label,
          style: AppTextStyles.semiBold.copyWith(
            color: Colors.white,
            fontSize: AppDimens.ssp(context, '_13ssp'),
          ),
        ),
      ],
    );
  }
}

/// A "good"/"bad" reference photo card. Sized by [aspectRatio] rather than a
/// fixed height so it scales with the available width instead of stretching
/// into a distorted shape on a wider container.
class _TipsExampleCard extends StatelessWidget {
  const _TipsExampleCard({
    required this.assetPath,
    required this.aspectRatio,
    this.caption,
  });

  final String assetPath;
  final double aspectRatio;
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AspectRatio(
          aspectRatio: aspectRatio,
          // Borderless, matching the reference design — a colored (tint)
          // border here used to read fine over the white Good/Folded/Cropped
          // photos, but clashed visibly as a stray diagonal "stroke" over
          // the Dark/Blurry photo's dark, low-contrast corners.
          child: Container(
            decoration: BoxDecoration(
              color: AppColors.photoThumbnailBackground,
              borderRadius: radius,
            ),
            clipBehavior: Clip.antiAlias,
            child: Image.asset(assetPath, fit: BoxFit.cover),
          ),
        ),
        if (caption != null) ...[
          SizedBox(height: AppDimens.sdp(context, '_6sdp')),
          Text(
            caption!,
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.medium.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_10ssp'),
            ),
          ),
        ],
      ],
    );
  }
}

class _QuickTipItem extends StatelessWidget {
  const _QuickTipItem({this.icon, this.svgAsset, required this.label})
    : assert(
        icon != null || svgAsset != null,
        'Provide either icon or svgAsset',
      );

  /// One of the app's own bundled icon assets (e.g. [AppAssets.catalogueIcon]
  /// — the garment/shirt icon already used for Catalogue Studio) rendered
  /// via [SvgPicture.asset], preferred over a generic Material [icon] where
  /// the app already has its own icon for the concept.
  final String? svgAsset;
  final IconData? icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final iconSize = AppDimens.sdp(context, '_20sdp');
    return Column(
      children: [
        Container(
          width: AppDimens.sdp(context, '_44sdp'),
          height: AppDimens.sdp(context, '_44sdp'),
          decoration: BoxDecoration(
            color: AppColors.fieldFill,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.fieldBorder),
          ),
          alignment: Alignment.center,
          child: svgAsset != null
              ? SvgPicture.asset(
                  svgAsset!,
                  width: iconSize,
                  height: iconSize,
                  colorFilter: const ColorFilter.mode(
                    Colors.white,
                    BlendMode.srcIn,
                  ),
                )
              : Icon(icon, color: Colors.white, size: iconSize),
        ),
        SizedBox(height: AppDimens.sdp(context, '_8sdp')),
        Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: AppTextStyles.medium.copyWith(
            color: AppColors.textSecondary,
            fontSize: AppDimens.ssp(context, '_10ssp'),
          ),
        ),
      ],
    );
  }
}

/// Dashed rounded-rect border around [child] — a lightweight
/// `CustomPainter` (no package) used for the "upload a file" drop zones
/// on the Catalogue and Motion Studio screens.
class DashedBorderContainer extends StatelessWidget {
  const DashedBorderContainer({
    super.key,
    required this.child,
    this.borderRadius,
    this.color,
    this.strokeWidth = 1.2,
    this.dashLength = 5,
    this.gapLength = 4,
  });

  final Widget child;
  final double? borderRadius;
  final Color? color;
  final double strokeWidth;
  final double dashLength;
  final double gapLength;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashedRRectPainter(
        radius: borderRadius ?? AppDimens.sdp(context, '_14sdp'),
        color: color ?? AppColors.fieldBorder,
        strokeWidth: strokeWidth,
        dashLength: dashLength,
        gapLength: gapLength,
      ),
      child: child,
    );
  }
}

class _DashedRRectPainter extends CustomPainter {
  _DashedRRectPainter({
    required this.radius,
    required this.color,
    required this.strokeWidth,
    required this.dashLength,
    required this.gapLength,
  });

  final double radius;
  final Color color;
  final double strokeWidth;
  final double dashLength;
  final double gapLength;

  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(radius),
    );
    final path = Path()..addRRect(rrect);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;

    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        final next = distance + dashLength;
        canvas.drawPath(
          metric.extractPath(distance, next.clamp(0, metric.length)),
          paint,
        );
        distance = next + gapLength;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedRRectPainter oldDelegate) {
    return oldDelegate.radius != radius ||
        oldDelegate.color != color ||
        oldDelegate.strokeWidth != strokeWidth ||
        oldDelegate.dashLength != dashLength ||
        oldDelegate.gapLength != gapLength;
  }
}

/// Selectable pill with an icon that stays visible in both states (unlike
/// [FilterChoiceChip], which swaps its icon for a check mark when
/// selected) — e.g. the Camera Movement options (Static / Zoom In / ...)
/// on the Motion Studio screen.
class IconChoiceChip extends StatelessWidget {
  const IconChoiceChip({
    super.key,
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));
    final color = selected ? Colors.white : AppColors.textSecondary;

    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: AppDimens.sdp(context, '_10sdp'),
            vertical: AppDimens.sdp(context, '_12sdp'),
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.pinkGradientStart.withValues(alpha: 0.14)
                : AppColors.fieldFill,
            borderRadius: radius,
            border: Border.all(
              color: selected
                  ? AppColors.pinkGradientStart
                  : AppColors.fieldBorder,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: AppDimens.sdp(context, '_14sdp')),
              SizedBox(width: AppDimens.sdp(context, '_6sdp')),
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.medium.copyWith(
                    color: color,
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

/// Title + subtitle row with a trailing on/off [Switch], for a
/// [CardContainer] list — e.g. "Model Animation" / "Fabric Motion" on the
/// Motion Studio screen.
class ToggleRow extends StatelessWidget {
  const ToggleRow({
    super.key,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_13ssp'),
                  ),
                ),
                SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                Text(
                  subtitle,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_11ssp'),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_10sdp')),
          Switch(
            value: value,
            onChanged: onChanged,
            activeThumbColor: Colors.white,
            activeTrackColor: AppColors.pinkGradientStart,
            inactiveThumbColor: Colors.white.withValues(alpha: 0.8),
            inactiveTrackColor: AppColors.fieldBorder,
            trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
          ),
        ],
      ),
    );
  }
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppTextStyles.semiBold.copyWith(
        color: AppColors.textSecondary,
        fontSize: AppDimens.ssp(context, '_11ssp'),
        letterSpacing: 0.6,
      ),
    );
  }
}

/// Bordered, `fieldFill`-tinted container. With more than one child, each
/// one is separated by a hairline divider — the "menu list"/"row list"
/// look used across Profile, Preferences, Plans and Credit History.
class CardContainer extends StatelessWidget {
  const CardContainer({
    super.key,
    required this.children,
    this.padding,
    this.borderColor,
  });

  final List<Widget> children;
  final EdgeInsetsGeometry? padding;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_18sdp')),
        border: Border.all(color: borderColor ?? AppColors.fieldBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(height: 1, color: AppColors.fieldBorder),
            children[i],
          ],
        ],
      ),
    );
    return content;
  }
}

/// Hero card with a soft pink glow gradient, used for the "Current Plan"
/// and "Available Credits" highlight cards.
class GlowCard extends StatelessWidget {
  const GlowCard({super.key, required this.child, this.padding});

  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding ?? EdgeInsets.all(AppDimens.sdp(context, '_18sdp')),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_20sdp')),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.pinkGradientStart.withValues(alpha: 0.35),
            AppColors.pinkGradientEnd.withValues(alpha: 0.08),
          ],
        ),
        border: Border.all(
          color: AppColors.pinkGradientStart.withValues(alpha: 0.3),
        ),
      ),
      child: child,
    );
  }
}

/// Small stat card: icon chip + big value + label, used side-by-side in
/// Credit History and Invoices.
class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final iconBoxSize = AppDimens.sdp(context, '_32sdp');

    return Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_16sdp')),
        border: Border.all(color: AppColors.fieldBorder),
      ),
      child: Row(
        children: [
          Container(
            width: iconBoxSize,
            height: iconBoxSize,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(
                AppDimens.sdp(context, '_8sdp'),
              ),
            ),
            child: Icon(
              icon,
              color: Colors.white,
              size: AppDimens.sdp(context, '_16sdp'),
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_10sdp')),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.bold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_15ssp'),
                  ),
                ),
                Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_10ssp'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Equal-width segmented control, e.g. All / Added / Used.
class FilterTabs extends StatelessWidget {
  const FilterTabs({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
    this.icons,
    this.svgIcons,
  });

  final List<String> options;
  final String selected;
  final ValueChanged<String> onSelected;

  /// Optional leading icon per option, e.g. the Ready-Made / Create Your Own
  /// mode toggle.
  final Map<String, IconData>? icons;

  /// Optional leading SVG asset per option (takes priority over [icons]) —
  /// e.g. the Catalogue Studio / Motion Studio tabs, which use the app's own
  /// branded icon set instead of Material glyphs.
  final Map<String, String>? svgIcons;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_4sdp')),
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_14sdp')),
        border: Border.all(color: AppColors.fieldBorder),
      ),
      child: Row(
        children: [
          for (final option in options)
            Expanded(
              child: Semantics(
                button: true,
                selected: option == selected,
                label: option,
                child: GestureDetector(
                  // Opaque: the default (deferToChild) only registered taps
                  // on the icon + text itself, so touching the empty part of
                  // a segment did nothing.
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onSelected(option),
                  child: ConstrainedBox(
                    // A comfortable touch target regardless of font scale.
                    constraints: BoxConstraints(
                      minHeight: AppDimens.sdp(context, '_44sdp'),
                    ),
                    child: _FilterTabSegment(
                      selected: option == selected,
                      icon: icons?[option],
                      svgIcon: svgIcons?[option],
                      label: option,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One segment of [FilterTabs]. Selected state is a subtle 20%-opacity
/// pink gradient fill with a 1px pink gradient outline (see
/// [_SelectedTabPainter]).
class _FilterTabSegment extends StatelessWidget {
  const _FilterTabSegment({
    required this.selected,
    required this.label,
    this.icon,
    this.svgIcon,
  });

  final bool selected;
  final String label;
  final IconData? icon;
  final String? svgIcon;

  @override
  Widget build(BuildContext context) {
    final outerRadius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));
    final color = selected ? Colors.white : AppColors.textSecondary;
    final iconSize = AppDimens.sdp(context, '_18sdp');

    final row = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (svgIcon != null) ...[
          SvgPicture.asset(
            svgIcon!,
            width: iconSize,
            height: iconSize,
            colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
          ),
          SizedBox(width: AppDimens.sdp(context, '_6sdp')),
        ] else if (icon != null) ...[
          Icon(icon, color: color, size: iconSize),
          SizedBox(width: AppDimens.sdp(context, '_6sdp')),
        ],
        Flexible(
          child: Text(
            label,
            overflow: TextOverflow.ellipsis,
            style: (selected ? AppTextStyles.semiBold : AppTextStyles.medium)
                .copyWith(
                  color: color,
                  fontSize: AppDimens.ssp(context, '_12ssp'),
                ),
          ),
        ),
      ],
    );

    if (!selected) {
      return Container(
        padding: EdgeInsets.symmetric(
          vertical: AppDimens.sdp(context, '_10sdp'),
          horizontal: AppDimens.sdp(context, '_4sdp'),
        ),
        alignment: Alignment.center,
        child: row,
      );
    }

    return CustomPaint(
      painter: _SelectedTabPainter(radius: outerRadius.topLeft.x),
      child: Container(
        padding: EdgeInsets.symmetric(
          vertical: AppDimens.sdp(context, '_10sdp'),
          horizontal: AppDimens.sdp(context, '_4sdp'),
        ),
        alignment: Alignment.center,
        child: row,
      ),
    );
  }
}

/// Selected-tab surface: a translucent pink->coral fill with a thin pink
/// gradient outline. Painted directly because stacking a translucent fill on
/// a gradient "border" box (the old approach) let that box's opaque gradient
/// show straight through, turning the whole tab solid pink.
class _SelectedTabPainter extends CustomPainter {
  const _SelectedTabPainter({required this.radius});

  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(
      rect.deflate(0.5),
      Radius.circular(radius),
    );

    Shader shader(double alpha) => LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [
        AppColors.pinkGradientStart.withValues(alpha: alpha),
        AppColors.pinkGradientEnd.withValues(alpha: alpha),
      ],
    ).createShader(rect);

    canvas.drawRRect(rrect, Paint()..shader = shader(0.2));
    canvas.drawRRect(
      rrect,
      Paint()
        ..shader = shader(0.6)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
  }

  @override
  bool shouldRepaint(_SelectedTabPainter old) => old.radius != radius;
}

/// Horizontally scrollable pill tabs, e.g. the Tutorials category filter.
class ChipTabs extends StatelessWidget {
  const ChipTabs({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  final List<String> options;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_20sdp'));

    return SizedBox(
      height: AppDimens.sdp(context, '_36sdp'),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: options.length,
        separatorBuilder: (context, index) =>
            SizedBox(width: AppDimens.sdp(context, '_8sdp')),
        itemBuilder: (context, index) {
          final option = options[index];
          final isSelected = option == selected;

          return GestureDetector(
            onTap: () => onSelected(option),
            child: Container(
              padding: EdgeInsets.symmetric(
                horizontal: AppDimens.sdp(context, '_16sdp'),
              ),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: isSelected ? Colors.white : AppColors.fieldFill,
                borderRadius: radius,
                border: Border.all(
                  color: isSelected ? Colors.white : AppColors.fieldBorder,
                ),
              ),
              child: Text(
                option,
                style: AppTextStyles.medium.copyWith(
                  color: isSelected ? Colors.black : AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_12ssp'),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Small "✓ Successful" / "✗ Failed" status indicator.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.label, required this.positive});

  final String label;
  final bool positive;

  @override
  Widget build(BuildContext context) {
    final color = positive ? AppColors.success : AppColors.danger;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          positive ? Icons.check_circle_rounded : Icons.cancel_rounded,
          color: color,
          size: AppDimens.sdp(context, '_12sdp'),
        ),
        SizedBox(width: AppDimens.sdp(context, '_4sdp')),
        Text(
          label,
          style: AppTextStyles.medium.copyWith(
            color: color,
            fontSize: AppDimens.ssp(context, '_11ssp'),
          ),
        ),
      ],
    );
  }
}

/// Pill showing a value with a trailing chevron. Renders as a plain chip
/// when [onTap] is omitted, or a tappable one (e.g. opening a picker) when
/// provided.
class DropdownChip extends StatelessWidget {
  const DropdownChip({super.key, required this.label, this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_20sdp'));

    final content = Container(
      padding: EdgeInsets.symmetric(
        horizontal: AppDimens.sdp(context, '_12sdp'),
        vertical: AppDimens.sdp(context, '_8sdp'),
      ),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.08),
        borderRadius: radius,
        border: Border.all(color: AppColors.fieldBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.medium.copyWith(
                color: Colors.white,
                fontSize: AppDimens.ssp(context, '_12ssp'),
              ),
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_4sdp')),
          Icon(
            Icons.keyboard_arrow_down_rounded,
            color: AppColors.textSecondary,
            size: AppDimens.sdp(context, '_16sdp'),
          ),
        ],
      ),
    );

    if (onTap == null) return content;

    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(onTap: onTap, borderRadius: radius, child: content),
    );
  }
}

/// Bottom sheet used by every "tap a chip, pick one option" control across
/// the detail pages (Profile & Preferences' platform/aspect-ratio/
/// resolution pickers, Credit History's status/date filters, ...).
Future<String?> pickOptionSheet(
  BuildContext context, {
  required String title,
  required List<String> options,
  required String selected,
}) {
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: AppColors.sheetBackground,
    isScrollControlled: true,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppDimens.sdp(context, '_20sdp')),
      ),
    ),
    builder: (sheetContext) {
      final maxHeight = MediaQuery.sizeOf(sheetContext).height * 0.75;
      return SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxHeight),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(
                  AppDimens.sdp(sheetContext, '_20sdp'),
                  AppDimens.sdp(sheetContext, '_20sdp'),
                  AppDimens.sdp(sheetContext, '_20sdp'),
                  AppDimens.sdp(sheetContext, '_8sdp'),
                ),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    title,
                    style: AppTextStyles.semiBold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(sheetContext, '_15ssp'),
                    ),
                  ),
                ),
              ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final option in options)
                      ListTile(
                        onTap: () => Navigator.of(sheetContext).pop(option),
                        title: Text(
                          option,
                          style: AppTextStyles.medium.copyWith(
                            color: option == selected
                                ? Colors.white
                                : AppColors.textSecondary,
                            fontSize: AppDimens.ssp(sheetContext, '_14ssp'),
                          ),
                        ),
                        trailing: option == selected
                            ? const Icon(
                                Icons.check_rounded,
                                color: AppColors.pinkGradientStart,
                              )
                            : null,
                      ),
                  ],
                ),
              ),
              SizedBox(height: AppDimens.sdp(sheetContext, '_12sdp')),
            ],
          ),
        ),
      );
    },
  );
}

/// [highlight] is the call-to-action pill: a fully rounded, pink-tinted
/// glass fill with a rim that fades from pink to a faint white, and larger
/// gradient lettering — louder than [outline], which is the same colour but
/// reads as a secondary action next to other header chips.
enum AppPillButtonStyle { filled, outline, light, tonal, highlight }

/// Small, content-sized pill button (as opposed to the full-width
/// [GradientButton]). Used for actions like "Change Image", "Set
/// Password" and "Upgrade Plan".
class AppPillButton extends StatelessWidget {
  const AppPillButton({
    super.key,
    required this.label,
    required this.onTap,
    this.icon,
    this.trailingIcon,
    this.style = AppPillButtonStyle.filled,
  });

  final String label;
  final VoidCallback onTap;
  final IconData? icon;
  final IconData? trailingIcon;
  final AppPillButtonStyle style;

  @override
  Widget build(BuildContext context) {
    final highlight = style == AppPillButtonStyle.highlight;
    // 999: a true stadium whatever height the larger highlight text gives it.
    final radius = BorderRadius.circular(
      highlight ? 999 : AppDimens.sdp(context, '_20sdp'),
    );
    final fontSize = AppDimens.ssp(context, highlight ? '_14ssp' : '_12ssp');
    final textColor = switch (style) {
      // White only as a mask: the content is painted through a pink
      // gradient below.
      AppPillButtonStyle.highlight => Colors.white,
      AppPillButtonStyle.filled => Colors.white,
      AppPillButtonStyle.outline => AppColors.pinkGradientStart,
      AppPillButtonStyle.light => Colors.black,
      AppPillButtonStyle.tonal => Colors.white,
    };

    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: Ink(
        decoration: BoxDecoration(
          borderRadius: radius,
          gradient: switch (style) {
            AppPillButtonStyle.filled => AppColors.pinkGradient,
            AppPillButtonStyle.highlight => LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [
                AppColors.pinkGradientStart.withValues(alpha: 0.30),
                Color.lerp(
                  AppColors.pinkGradientEnd,
                  Colors.white,
                  0.5,
                )!.withValues(alpha: 0.20),
              ],
            ),
            _ => null,
          },
          color: switch (style) {
            AppPillButtonStyle.light => Colors.white,
            AppPillButtonStyle.tonal => AppColors.fieldFill,
            _ => null,
          },
          border: switch (style) {
            AppPillButtonStyle.outline => Border.all(
              color: AppColors.pinkGradientStart.withValues(alpha: 0.6),
            ),
            AppPillButtonStyle.tonal => Border.all(
              color: AppColors.fieldBorder,
            ),
            // highlight's rim is a gradient, which Border can't draw — see
            // _PillRimPainter.
            _ => null,
          },
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: radius,
          child: CustomPaint(
            foregroundPainter: highlight ? const _PillRimPainter() : null,
            child: Padding(
              padding: EdgeInsets.symmetric(
                horizontal: AppDimens.sdp(
                  context,
                  highlight ? '_18sdp' : '_14sdp',
                ),
                vertical: AppDimens.sdp(context, '_10sdp'),
              ),
              child: _PillGradientMask(
                enabled: highlight,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (icon != null) ...[
                      Icon(
                        icon,
                        size: AppDimens.sdp(context, '_14sdp'),
                        color: textColor,
                      ),
                      SizedBox(width: AppDimens.sdp(context, '_6sdp')),
                    ],
                    Flexible(
                      child: Text(
                        label,
                        overflow: TextOverflow.ellipsis,
                        style:
                            (highlight
                                    ? AppTextStyles.bold
                                    : AppTextStyles.semiBold)
                                .copyWith(color: textColor, fontSize: fontSize),
                      ),
                    ),
                    if (trailingIcon != null) ...[
                      SizedBox(
                        width: AppDimens.sdp(
                          context,
                          highlight ? '_12sdp' : '_6sdp',
                        ),
                      ),
                      Icon(
                        trailingIcon,
                        size: AppDimens.sdp(
                          context,
                          highlight ? '_22sdp' : '_15sdp',
                        ),
                        color: textColor,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The highlight pill's thin rim: full pink along the top edge, fading to a
/// muted, paler pink along the bottom.
class _PillRimPainter extends CustomPainter {
  const _PillRimPainter();

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 1.2;
    final rect = (Offset.zero & size).deflate(stroke / 2);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..shader = LinearGradient(
        begin: const Alignment(-0.6, -1),
        end: const Alignment(0.6, 1),
        colors: [
          AppColors.pinkGradientStart,
          Color.lerp(
            AppColors.pinkGradientEnd,
            Colors.white,
            0.35,
          )!.withValues(alpha: 0.5),
        ],
      ).createShader(rect);
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, Radius.circular(rect.height / 2)),
      paint,
    );
  }

  @override
  bool shouldRepaint(_PillRimPainter oldDelegate) => false;
}

/// Paints a pill's label and icons through the pink gradient (left to right)
/// instead of a flat colour. A no-op wrapper when not [enabled].
class _PillGradientMask extends StatelessWidget {
  const _PillGradientMask({required this.enabled, required this.child});

  final bool enabled;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!enabled) return child;
    return ShaderMask(
      blendMode: BlendMode.srcIn,
      // Starts a step lighter than the brand magenta: at full strength the
      // first letters sank into the pink-tinted fill behind them.
      shaderCallback: (bounds) => LinearGradient(
        colors: [
          Color.lerp(
            AppColors.pinkGradientStart,
            AppColors.pinkGradientEnd,
            0.3,
          )!,
          AppColors.pinkGradientEnd,
        ],
      ).createShader(bounds),
      child: child,
    );
  }
}

/// Labeled text field styled to match the app's dark form fields. Used for
/// Profile & Preferences and Contact Us.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    this.label,
    required this.controller,
    this.hint,
    this.readOnly = false,
    this.helperText,
    this.keyboardType,
    this.maxLines = 1,
    this.maxLength,
    this.inputFormatters,
    this.errorText,
    this.textCapitalization = TextCapitalization.none,
  });

  final List<TextInputFormatter>? inputFormatters;

  /// Shown under the field in red - inline validation.
  final String? errorText;
  final TextCapitalization textCapitalization;

  /// Omit to render the field with no label row above it, e.g. an
  /// optional free-text prompt introduced by its own section header.
  final String? label;
  final TextEditingController controller;
  final String? hint;
  final bool readOnly;
  final String? helperText;
  final TextInputType? keyboardType;
  final int maxLines;
  final int? maxLength;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_16sdp'));
    final fontSize = AppDimens.ssp(context, '_14ssp');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!,
            style: AppTextStyles.medium.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_13ssp'),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
        ],
        TextField(
          controller: controller,
          readOnly: readOnly,
          keyboardType: keyboardType,
          maxLines: maxLines,
          maxLength: maxLength,
          inputFormatters: inputFormatters,
          textCapitalization: textCapitalization,
          style: AppTextStyles.regular.copyWith(
            color: readOnly ? AppColors.textSecondary : Colors.white,
            fontSize: fontSize,
          ),
          cursorColor: Colors.white,
          decoration: InputDecoration(
            hintText: hint,
            errorText: errorText,
            errorStyle: AppTextStyles.regular.copyWith(
              color: AppColors.danger,
              fontSize: AppDimens.ssp(context, '_11ssp'),
            ),
            hintStyle: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: fontSize,
            ),
            counterStyle: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_10ssp'),
            ),
            filled: true,
            fillColor: AppColors.fieldFill,
            contentPadding: EdgeInsets.symmetric(
              horizontal: AppDimens.sdp(context, '_16sdp'),
              vertical: AppDimens.sdp(context, '_14sdp'),
            ),
            border: OutlineInputBorder(
              borderRadius: radius,
              borderSide: BorderSide(color: AppColors.fieldBorder),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: radius,
              borderSide: BorderSide(color: AppColors.fieldBorder),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: radius,
              borderSide: const BorderSide(color: AppColors.pinkGradientEnd),
            ),
          ),
        ),
        if (helperText != null) ...[
          SizedBox(height: AppDimens.sdp(context, '_6sdp')),
          Text(
            helperText!,
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_11ssp'),
            ),
          ),
        ],
      ],
    );
  }
}

/// Pill-shaped search field with a leading search icon.
class AppSearchField extends StatelessWidget {
  const AppSearchField({
    super.key,
    required this.controller,
    required this.hint,
  });

  final TextEditingController controller;
  final String hint;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_24sdp'));
    final fontSize = AppDimens.ssp(context, '_13ssp');

    return TextField(
      controller: controller,
      style: AppTextStyles.regular.copyWith(
        color: Colors.white,
        fontSize: fontSize,
      ),
      cursorColor: Colors.white,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: AppTextStyles.regular.copyWith(
          color: AppColors.textSecondary,
          fontSize: fontSize,
        ),
        prefixIcon: Icon(
          Icons.search_rounded,
          color: AppColors.textSecondary,
          size: AppDimens.sdp(context, '_20sdp'),
        ),
        filled: true,
        fillColor: AppColors.fieldFill,
        contentPadding: EdgeInsets.symmetric(
          vertical: AppDimens.sdp(context, '_14sdp'),
        ),
        border: OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: AppColors.fieldBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: AppColors.fieldBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: radius,
          borderSide: const BorderSide(color: AppColors.pinkGradientEnd),
        ),
      ),
    );
  }
}
