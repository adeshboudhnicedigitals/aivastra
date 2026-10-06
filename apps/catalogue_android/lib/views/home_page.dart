import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import '../widgets/app_bottom_nav_bar.dart';
import 'my_creations_page.dart';
import 'products_page.dart';
import 'profile_page.dart';
import 'studio_home_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({
    super.key,
    this.initialMotionSourceJobId,
    this.initialTabIndex = 0,
  });

  /// Which bottom-nav tab to open on: 0 Home, 1 My Creations, 2 Products,
  /// 3 Profile.
  final int initialTabIndex;

  /// Opens the Motion Studio tab with this completed image job already
  /// chosen as the source (used by the catalogue result page's Try Motion).
  final String? initialMotionSourceJobId;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage>
    with SingleTickerProviderStateMixin {
  late int _currentIndex = widget.initialTabIndex;

  // Bottom-nav tabs are peers (no forward/back relationship the way a pushed
  // page has), so a full-width push-style slide would look wrong bouncing
  // between them — a subtle slide toward the tapped tab's side reads as
  // "switched to a sibling" without implying a hierarchy. The IndexedStack
  // itself never rebuilds (its children keep their state); only this wrapper
  // animates on top of it. Slide only, no fade: fading means compositing
  // the whole tab — an image grid, usually — offscreen on every frame of
  // the transition, which is what made switching tabs hitch.
  static const _tabTransition = Duration(milliseconds: 220);

  // A tab is built the first time it is opened, then kept. Building all four
  // up front fired every tab's requests and image loads at once on launch.
  late final Set<int> _openedTabs = {widget.initialTabIndex};
  late final AnimationController _tabAnimController = AnimationController(
    vsync: this,
    duration: _tabTransition,
    value: 1,
  );
  late Animation<Offset> _tabSlide = _slideFor(1);

  Animation<Offset> _slideFor(double directionSign) => Tween<Offset>(
    begin: Offset(directionSign * 0.06, 0),
    end: Offset.zero,
  ).animate(CurvedAnimation(parent: _tabAnimController, curve: Curves.easeOut));

  void _selectTab(int index) {
    if (index == _currentIndex) return;
    setState(() {
      _tabSlide = _slideFor(index > _currentIndex ? 1 : -1);
      _currentIndex = index;
      _openedTabs.add(index);
    });
    _tabAnimController
      ..value = 0
      ..forward();
  }

  @override
  void dispose() {
    _tabAnimController.dispose();
    super.dispose();
  }

  static const _tabs = [
    _TabContent(iconAsset: AppAssets.homeIcon, label: AppStrings.navHome),
    _TabContent(
      iconAsset: AppAssets.myCreationsIcon,
      label: AppStrings.navMyCreations,
    ),
    _TabContent(
      iconAsset: AppAssets.productsIcon,
      label: AppStrings.navProducts,
    ),
    _TabContent(iconAsset: AppAssets.profileIcon, label: AppStrings.navProfile),
  ];

  @override
  Widget build(BuildContext context) {
    // Back on any tab other than Home returns to Home; only Home lets the
    // system close the app. Pages pushed over this route pop first as usual.
    return PopScope(
      canPop: _currentIndex == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          setState(() {
            _currentIndex = 0;
            _openedTabs.add(0);
          });
        }
      },
      child: _buildScaffold(context),
    );
  }

  Widget _buildScaffold(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      extendBody: true,
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset(AppAssets.backgroundGlow, fit: BoxFit.cover),
          ),
          SafeArea(
            bottom: false,
            child: SlideTransition(
              position: _tabSlide,
              child: IndexedStack(
                index: _currentIndex,
                children: [
                  for (var i = 0; i < _tabs.length; i++)
                    if (!_openedTabs.contains(i))
                      const SizedBox.shrink()
                    else if (i == 0)
                      StudioHomePage(
                        initialMotionSourceJobId:
                            widget.initialMotionSourceJobId,
                      )
                    else if (i == 1)
                      const MyCreationsPage()
                    else if (i == 2)
                      const ProductsPage()
                    else if (i == 3)
                      const ProfilePage()
                    else
                      _TabPlaceholder(tab: _tabs[i]),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: AppBottomNavBar(
        currentIndex: _currentIndex,
        onTap: _selectTab,
      ),
    );
  }
}

class _TabContent {
  const _TabContent({required this.iconAsset, required this.label});

  final String iconAsset;
  final String label;
}

class _TabPlaceholder extends StatelessWidget {
  const _TabPlaceholder({required this.tab});

  final _TabContent tab;

  @override
  Widget build(BuildContext context) {
    final iconSize = AppDimens.sdp(context, '_48sdp');

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SvgPicture.asset(
            tab.iconAsset,
            width: iconSize,
            height: iconSize,
            colorFilter: const ColorFilter.mode(
              AppColors.textSecondary,
              BlendMode.srcIn,
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          Text(
            tab.label,
            style: AppTextStyles.semiBold.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_20ssp'),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_6sdp')),
          Text(
            AppStrings.comingSoon,
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_14ssp'),
            ),
          ),
        ],
      ),
    );
  }
}
