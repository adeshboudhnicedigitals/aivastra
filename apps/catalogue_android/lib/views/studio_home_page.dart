import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/studio/application/catalogue_selection_controller.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import '../widgets/app_refresh_scroll_view.dart';
import '../widgets/credits_badge.dart';
import '../widgets/detail_page_widgets.dart';
import 'catalogue_studio_form.dart';
import 'motion_studio_form.dart';

class StudioHomePage extends ConsumerStatefulWidget {
  const StudioHomePage({super.key, this.initialMotionSourceJobId});

  /// When set, starts on the Motion Studio tab with this image job preselected
  /// as its source.
  final String? initialMotionSourceJobId;

  @override
  ConsumerState<StudioHomePage> createState() => _StudioHomePageState();
}

class _StudioHomePageState extends ConsumerState<StudioHomePage> {
  late String _mode = widget.initialMotionSourceJobId != null
      ? AppStrings.motionStudioTab
      : AppStrings.catalogueStudioTab;

  /// Reloads everything the two studio forms read from the server: the
  /// balance and the reference data (garment types, models, backgrounds,
  /// poses, templates, lower/shoe catalogues, saved presets, resolutions,
  /// sample videos and the Motion source catalogues). Invalidating a family
  /// provider drops every cached key at once; only what's on screen reloads
  /// now, the rest on next use. The user's in-progress choices live in the
  /// selection controllers and are untouched.
  Future<void> _refresh() async {
    final gender = ref.read(catalogueSelectionControllerProvider).gender;

    ref.invalidate(creditsSummaryProvider);
    ref.invalidate(garmentTypesProvider);
    ref.invalidate(facesProvider);
    ref.invalidate(backgroundsProvider);
    ref.invalidate(backgroundCategoriesProvider);
    ref.invalidate(posesProvider);
    ref.invalidate(catalogueTemplatesProvider);
    ref.invalidate(lowerCatalogProvider);
    ref.invalidate(shoeCatalogProvider);
    ref.invalidate(posePresetsProvider);
    ref.invalidate(resolutionsConfigProvider);
    ref.invalidate(myBackgroundsProvider);
    ref.invalidate(sampleVideosProvider);
    ref.invalidate(userCataloguesProvider);

    await Future.wait([
      awaitQuietly(ref.read(creditsSummaryProvider.future)),
      awaitQuietly(ref.read(garmentTypesProvider(gender).future)),
      awaitQuietly(ref.read(facesProvider(gender).future)),
      awaitQuietly(ref.read(resolutionsConfigProvider.future)),
      if (_mode == AppStrings.motionStudioTab) ...[
        awaitQuietly(ref.read(userCataloguesProvider.future)),
        awaitQuietly(ref.read(sampleVideosProvider.future)),
      ],
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = AppDimens.sdp(context, '_16sdp');
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');
    final sectionGap = AppDimens.sdp(context, '_20sdp');

    return Center(
      heightFactor: 1,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: AppRefreshScrollView(
          onRefresh: _refresh,
          padding: EdgeInsets.fromLTRB(
            horizontalPadding,
            AppDimens.sdp(context, '_16sdp'),
            horizontalPadding,
            // _112sdp (the other tabs' bottom-clearance value) still left
            // the Generate Catalogue button peeking slightly under the
            // floating nav bar (extendBody: true on HomePage's Scaffold) —
            // _130sdp gives it real breathing room above the bar.
            AppDimens.sdp(context, '_130sdp'),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Image.asset(
                    AppAssets.logo,
                    height: AppDimens.sdp(context, '_32sdp'),
                  ),
                  const Spacer(),
                  Consumer(
                    builder: (context, ref, _) {
                      final credits = ref.watch(creditsSummaryProvider).value;
                      return CreditsBadge(credits: credits?.balance);
                    },
                  ),
                ],
              ),
              SizedBox(height: sectionGap),
              Text(
                AppStrings.heroTitle,
                style: AppTextStyles.bold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_20ssp'),
                ),
              ),
              SizedBox(height: AppDimens.sdp(context, '_4sdp')),
              Text(
                AppStrings.heroSubtitle,
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
              SizedBox(height: sectionGap),
              FilterTabs(
                options: const [
                  AppStrings.catalogueStudioTab,
                  AppStrings.motionStudioTab,
                ],
                selected: _mode,
                icons: const {
                  AppStrings.motionStudioTab: Icons.movie_creation_outlined,
                },
                svgIcons: const {
                  AppStrings.catalogueStudioTab: AppAssets.catalogueIcon,
                },
                onSelected: (value) => setState(() => _mode = value),
              ),
              SizedBox(height: sectionGap),
              // Both forms stay mounted (the inactive one is just offstage):
              // switching tabs is instant instead of rebuilding a whole
              // form, and a picked garment/source photo isn't lost when you
              // flip to the other tab and back.
              Offstage(
                offstage: _mode != AppStrings.catalogueStudioTab,
                child: const CatalogueStudioForm(),
              ),
              Offstage(
                offstage: _mode != AppStrings.motionStudioTab,
                child: MotionStudioForm(
                  initialSourceJobId: widget.initialMotionSourceJobId,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
