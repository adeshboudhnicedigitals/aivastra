import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/app_routes.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/providers/core_providers.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import '../widgets/gradient_button.dart';

class _OnboardingItem {
  const _OnboardingItem({
    required this.image,
    required this.title,
    required this.subtitle,
  });

  final String image;
  final String title;
  final String subtitle;
}

const _items = [
  _OnboardingItem(
    image: AppAssets.onboardingImage1,
    title: AppStrings.onboardingTitle1,
    subtitle: AppStrings.onboardingSubtitle1,
  ),
  _OnboardingItem(
    image: AppAssets.onboardingImage2,
    title: AppStrings.onboardingTitle2,
    subtitle: AppStrings.onboardingSubtitle2,
  ),
  _OnboardingItem(
    image: AppAssets.onboardingImage3,
    title: AppStrings.onboardingTitle3,
    subtitle: AppStrings.onboardingSubtitle3,
  ),
];

class OnboardingPage extends ConsumerStatefulWidget {
  const OnboardingPage({super.key});

  @override
  ConsumerState<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends ConsumerState<OnboardingPage> {
  final _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _goToLogin() {
    ref.read(localPrefsProvider).setOnboardingSeen();
    context.go(AppRoutes.login);
  }

  void _next() {
    if (_index == _items.length - 1) {
      _goToLogin();
      return;
    }
    _controller.nextPage(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');
    final isLast = _index == _items.length - 1;
    final horizontalPadding = AppDimens.sdp(context, '_24sdp');

    return Scaffold(
      backgroundColor: AppColors.background,
      // The Splash page's own background, instead of each slide's own
      // full-bleed photo — the illustrations below are self-contained
      // graphics (product + arrows + result shots), not screen-filling
      // photos, and onboarding follows splash directly in the launch flow.
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset(AppAssets.splashBackground, fit: BoxFit.cover),
          ),
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: EdgeInsets.only(
                    top: AppDimens.sdp(context, '_16sdp'),
                  ),
                  child: Image.asset(
                    AppAssets.logo,
                    height: AppDimens.sdp(context, '_40sdp'),
                  ),
                ),
                Expanded(
                  child: PageView.builder(
                    controller: _controller,
                    itemCount: _items.length,
                    onPageChanged: (i) => setState(() => _index = i),
                    itemBuilder: (context, i) =>
                        _OnboardingSlide(item: _items[i]),
                  ),
                ),
                Center(
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: maxWidth),
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(
                        horizontalPadding,
                        0,
                        horizontalPadding,
                        AppDimens.sdp(context, '_20sdp'),
                      ),
                      child: isLast
                          ? Column(
                              children: [
                                _PageIndicator(
                                  count: _items.length,
                                  index: _index,
                                ),
                                SizedBox(
                                  height: AppDimens.sdp(context, '_20sdp'),
                                ),
                                GradientButton(
                                  label: AppStrings.getStarted,
                                  onPressed: _goToLogin,
                                  iconPosition:
                                      GradientButtonIconPosition.trailing,
                                  icon: Icon(
                                    Icons.arrow_forward,
                                    color: Colors.white,
                                    size: AppDimens.sdp(context, '_18sdp'),
                                  ),
                                ),
                              ],
                            )
                          : Row(
                              children: [
                                TextButton(
                                  onPressed: _goToLogin,
                                  style: TextButton.styleFrom(
                                    padding: EdgeInsets.zero,
                                    minimumSize: const Size(0, 32),
                                    tapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                  ),
                                  child: Text(
                                    AppStrings.skip,
                                    style: AppTextStyles.medium.copyWith(
                                      color: AppColors.textSecondary,
                                      fontSize: AppDimens.ssp(
                                        context,
                                        '_14ssp',
                                      ),
                                    ),
                                  ),
                                ),
                                Expanded(
                                  child: Center(
                                    child: _PageIndicator(
                                      count: _items.length,
                                      index: _index,
                                    ),
                                  ),
                                ),
                                _NextButton(onPressed: _next),
                              ],
                            ),
                    ),
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

class _OnboardingSlide extends StatelessWidget {
  const _OnboardingSlide({required this.item});

  final _OnboardingItem item;

  @override
  Widget build(BuildContext context) {
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');
    final horizontalPadding = AppDimens.sdp(context, '_24sdp');

    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // The illustration is its own self-contained graphic (product
              // photo + arrows + result shots) rather than a screen-filling
              // photo, so it's shown whole (contain), not cropped (cover).
              Expanded(
                child: Padding(
                  padding: EdgeInsets.symmetric(
                    vertical: AppDimens.sdp(context, '_16sdp'),
                  ),
                  child: Image.asset(item.image, fit: BoxFit.contain),
                ),
              ),
              Text(
                item.title,
                style: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_22ssp'),
                ),
              ),
              SizedBox(height: AppDimens.sdp(context, '_6sdp')),
              Text(
                item.subtitle,
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_14ssp'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PageIndicator extends StatelessWidget {
  const _PageIndicator({required this.count, required this.index});

  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    final dotSize = AppDimens.sdp(context, '_6sdp');
    final spacing = AppDimens.sdp(context, '_3sdp');

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(count, (i) {
        final isActive = i == index;
        return Container(
          margin: EdgeInsets.symmetric(horizontal: spacing),
          width: dotSize,
          height: dotSize,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isActive
                ? AppColors.pinkGradientStart
                : AppColors.fieldBorder,
          ),
        );
      }),
    );
  }
}

class _NextButton extends StatelessWidget {
  const _NextButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final size = AppDimens.sdp(context, '_48sdp');

    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onPressed,
        customBorder: const CircleBorder(),
        child: Container(
          width: size,
          height: size,
          decoration: const BoxDecoration(
            gradient: AppColors.pinkGradient,
            shape: BoxShape.circle,
          ),
          child: Icon(
            Icons.arrow_forward,
            color: Colors.white,
            size: AppDimens.sdp(context, '_20sdp'),
          ),
        ),
      ),
    );
  }
}
