import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/tutorials/tutorial_data.dart';
import '../utils/app_strings.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/tutorial_video_player.dart';

/// Tutorials - the same library the web app shows (there is no tutorials API;
/// see `tutorial_data.dart`). Each card plays its video in a dialog on this
/// page (`tutorial_video_player.dart`).
class TutorialsPage extends StatefulWidget {
  const TutorialsPage({super.key});

  @override
  State<TutorialsPage> createState() => _TutorialsPageState();
}

class _TutorialsPageState extends State<TutorialsPage> {
  final _searchController = TextEditingController();
  String _query = '';
  String _category = tutorialTabs.first;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_onQueryChanged);
  }

  @override
  void dispose() {
    _searchController.removeListener(_onQueryChanged);
    _searchController.dispose();
    super.dispose();
  }

  void _onQueryChanged() {
    setState(() => _query = _searchController.text);
  }

  List<Tutorial> get _visibleTutorials {
    final q = _query.trim().toLowerCase();
    return tutorials.where((t) {
      final matchesCategory =
          _category == tutorialTabs.first || t.category == _category;
      final matchesQuery =
          q.isEmpty ||
          t.title.toLowerCase().contains(q) ||
          t.tag.toLowerCase().contains(q);
      return matchesCategory && matchesQuery;
    }).toList();
  }

  void _open(Tutorial t) => showTutorialPlayer(context, t);

  @override
  Widget build(BuildContext context) {
    final sectionGap = AppDimens.sdp(context, '_16sdp');
    final visible = _visibleTutorials;

    return DetailPageScaffold(
      title: AppStrings.tutorials,
      subtitle: AppStrings.tutorialsSubtitle,
      children: [
        AppSearchField(
          controller: _searchController,
          hint: AppStrings.searchTutorialsHint,
        ),
        SizedBox(height: sectionGap),
        ChipTabs(
          options: tutorialTabs,
          selected: _category,
          onSelected: (value) => setState(() => _category = value),
        ),
        SizedBox(height: sectionGap),
        if (visible.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(
              vertical: AppDimens.sdp(context, '_40sdp'),
            ),
            child: Center(
              child: Text(
                _query.trim().isEmpty
                    ? AppStrings.comingSoon
                    : 'No tutorials match your search.',
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ),
          )
        else
          _TutorialList(visible: visible, onOpen: _open),
      ],
    );
  }
}

/// Lays the cards out one per row on phone (and on web — a wide browser
/// window still gets a single, wider card rather than splitting into
/// columns), or 2 per row on a native tablet-width screen.
/// [AppDimens.isTablet] alone would also fire for a wide desktop browser
/// (it just reads [MediaQuery] width), so [kIsWeb] is checked first.
class _TutorialList extends StatelessWidget {
  const _TutorialList({required this.visible, required this.onOpen});

  final List<Tutorial> visible;
  final ValueChanged<Tutorial> onOpen;

  @override
  Widget build(BuildContext context) {
    final gap = AppDimens.sdp(context, '_12sdp');
    final twoColumns = !kIsWeb && AppDimens.isTablet(context);

    if (!twoColumns) {
      return Column(
        children: [
          for (var i = 0; i < visible.length; i++) ...[
            _TutorialCard(
              tutorial: visible[i],
              onTap: () => onOpen(visible[i]),
            ),
            if (i != visible.length - 1) SizedBox(height: gap),
          ],
        ],
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final itemWidth = (constraints.maxWidth - gap) / 2;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final t in visible)
              SizedBox(
                width: itemWidth,
                child: _TutorialCard(tutorial: t, onTap: () => onOpen(t)),
              ),
          ],
        );
      },
    );
  }
}

class _TutorialCard extends StatelessWidget {
  const _TutorialCard({required this.tutorial, required this.onTap});

  final Tutorial tutorial;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tagColor = tutorial.tag == 'Catalogue'
        ? AppColors.violet
        : AppColors.pinkGradientStart;

    return CardContainer(
      children: [
        InkWell(
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
            // Thumbnail width as a share of the card's own measured width,
            // not a fixed AppDimens key: this card can be a full-width row
            // (phone/web) or half a 2-column grid cell (tablet), and a
            // fixed size looked cramped relative to a wider card and
            // oversized relative to a narrower one.
            child: LayoutBuilder(
              builder: (context, constraints) {
                final thumbWidth = (constraints.maxWidth * 0.34).clamp(
                  96.0,
                  160.0,
                );
                // IntrinsicHeight + stretch: the row is as tall as the taller
                // of the two sides and both fill it, so the thumbnail and the
                // text block always end level whatever the title's length.
                return IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _TutorialThumbnail(
                        imageUrl: tutorial.thumbnailUrl,
                        duration: tutorial.duration,
                        tint: tagColor,
                        width: thumbWidth,
                      ),
                      SizedBox(width: AppDimens.sdp(context, '_12sdp')),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            _TutorialTag(label: tutorial.tag, color: tagColor),
                            SizedBox(height: AppDimens.sdp(context, '_8sdp')),
                            Text(
                              tutorial.title,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: AppTextStyles.semiBold.copyWith(
                                color: Colors.white,
                                fontSize: AppDimens.ssp(context, '_14ssp'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

class _TutorialThumbnail extends StatelessWidget {
  const _TutorialThumbnail({
    required this.imageUrl,
    required this.duration,
    required this.tint,
    required this.width,
  });

  final String imageUrl;
  final String duration;
  final Color tint;
  final double width;

  @override
  Widget build(BuildContext context) {
    // At least a real 16:9 video frame; the card's row stretches it taller
    // when the text beside it needs more room, and the image crops to cover.
    final minHeight = width * 9 / 16;
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));

    return ClipRRect(
      borderRadius: radius,
      child: SizedBox(
        width: width,
        child: Stack(
          fit: StackFit.passthrough,
          children: [
            // The only non-positioned child, so it alone decides the height
            // this thumbnail asks for — the image must not, or the row would
            // jump when it finishes loading.
            SizedBox(height: minHeight),
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      tint.withValues(alpha: 0.35),
                      tint.withValues(alpha: 0.1),
                    ],
                  ),
                ),
              ),
            ),
            // The video's own YouTube thumbnail; the tinted tile shows while
            // it loads or if it can't. Decoded at display size, not the
            // file's, to keep a long list light on memory.
            Positioned.fill(child: AppNetworkImage(imageUrl, thumbnail: true)),
            Center(
              child: Icon(
                Icons.play_circle_fill_rounded,
                color: Colors.white.withValues(alpha: 0.9),
                size: AppDimens.sdp(context, '_26sdp'),
              ),
            ),
            Positioned(
              right: AppDimens.sdp(context, '_4sdp'),
              bottom: AppDimens.sdp(context, '_4sdp'),
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
                child: Text(
                  duration,
                  style: AppTextStyles.medium.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_9ssp'),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TutorialTag extends StatelessWidget {
  const _TutorialTag({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: AppDimens.sdp(context, '_8sdp'),
        vertical: AppDimens.sdp(context, '_3sdp'),
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_20sdp')),
      ),
      child: Text(
        label,
        style: AppTextStyles.medium.copyWith(
          color: color,
          fontSize: AppDimens.ssp(context, '_10ssp'),
        ),
      ),
    );
  }
}
