import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/utils/relative_date.dart';
import '../core/utils/save_media.dart';
import '../core/utils/share_media.dart';
import '../features/studio/application/motion_result_controller.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/catalog_video_row.dart';
import '../features/studio/data/models/job_row.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/credits_badge.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/generating_animation.dart';
import '../widgets/motion_video_player.dart';
import 'motion_detail_page.dart';
import 'my_creations_page.dart';

/// Status steps for a video in progress — same animation as the catalogue
/// result page, with runway/camera wording and icons.
const motionGeneratingSteps = [
  (icon: Icons.checkroom_rounded, text: 'Getting your model ready…'),
  (
    icon: Icons.directions_walk_rounded,
    text: 'Choreographing the runway walk…',
  ),
  (icon: Icons.videocam_outlined, text: 'Rolling the cameras…'),
  (icon: Icons.content_cut_rounded, text: 'Editing the final cut…'),
  (icon: Icons.diamond_outlined, text: 'Adding the finishing touches…'),
];

/// Frame ratio of the player / generating box (width ÷ height).
const _frameAspect = 0.8;

class MotionResultPage extends ConsumerStatefulWidget {
  const MotionResultPage({
    super.key,
    required this.jobId,
    this.title,
    this.promptText,
    this.duration,
    this.quality,
    this.sourceImage,
  });

  final String jobId;

  /// Carried over from the submission (the job row itself doesn't echo
  /// back the preset name/prompt/duration/quality that were requested).
  final String? title;
  final String? promptText;
  final int? duration;
  final String? quality;

  /// The image the video was made from, for the Generation Details card.
  final ImageProvider? sourceImage;

  @override
  ConsumerState<MotionResultPage> createState() => _MotionResultPageState();
}

class _MotionResultPageState extends ConsumerState<MotionResultPage> {
  // Reported by the player once the video loads — fills the details rows
  // that the submission didn't carry (e.g. when opened from Recent Creations).
  double? _videoAspect;
  Duration? _videoDuration;

  String get jobId => widget.jobId;

  Future<void> _openUrl(String url) =>
      launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);

  Future<void> _share() async {
    final url = ref.read(jobResultUrlProvider(jobId)).value;
    if (url == null) return;
    await shareRemoteMedia(url: url, filename: '$jobId.mp4');
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _download() async {
    _toast('Downloading…');
    try {
      final url = await ref
          .read(motionResultControllerProvider(jobId).notifier)
          .download();
      try {
        await saveRemoteMediaToGallery(
          url: url,
          baseName: 'aivastra-${jobId.substring(0, 8)}',
          isVideo: true,
        );
        _toast('Saved to your gallery');
      } catch (_) {
        await _openUrl(url);
        _toast('Opened in your browser');
      }
    } catch (_) {
      _toast('Could not download this video. Please try again.');
    }
  }

  void _onVideoInfo(double aspect, Duration duration) {
    setState(() {
      _videoAspect = aspect;
      _videoDuration = duration;
    });
  }

  /// "9:16 (Portrait)" etc. — nearest common ratio to the video's own.
  static String _aspectLabel(double r) {
    const known = [
      ('9:16', 9 / 16, 'Portrait'),
      ('3:4', 3 / 4, 'Portrait'),
      ('4:5', 4 / 5, 'Portrait'),
      ('1:1', 1.0, 'Square'),
      ('4:3', 4 / 3, 'Landscape'),
      ('16:9', 16 / 9, 'Landscape'),
    ];
    var best = known.first;
    for (final k in known) {
      if ((math.log(r / k.$2)).abs() < (math.log(r / best.$2)).abs()) best = k;
    }
    return '${best.$1} (${best.$3})';
  }

  @override
  Widget build(BuildContext context) {
    final sectionGap = AppDimens.sdp(context, '_16sdp');
    final jobAsync = ref.watch(motionResultControllerProvider(jobId));
    final job = jobAsync.value;

    final bottomBar = job == null
        ? null
        : Row(
            children: [
              Expanded(
                child: AppPillButton(
                  label: AppStrings.generateAgain,
                  icon: Icons.repeat_rounded,
                  style: AppPillButtonStyle.tonal,
                  onTap: () => Navigator.of(context).pop(),
                ),
              ),
              SizedBox(width: AppDimens.sdp(context, '_12sdp')),
              Expanded(
                child: AppPillButton(
                  label: AppStrings.downloadVideo,
                  icon: Icons.download_rounded,
                  style: AppPillButtonStyle.filled,
                  // AppPillButton has no disabled state — no-op until the
                  // video exists.
                  onTap: job.isCompleted ? _download : () {},
                ),
              ),
            ],
          );

    return DetailPageScaffold(
      title: AppStrings.motionReadyTitle,
      subtitle: null,
      bottomBar: bottomBar,
      headerTrailing: Consumer(
        builder: (context, ref, _) {
          final credits = ref.watch(creditsSummaryProvider).value;
          return CreditsBadge(credits: credits?.balance);
        },
      ),
      children: [
        jobAsync.when(
          loading: () => const AppLoader.section(),
          error: (_, _) =>
              const InlineErrorBanner(message: 'Could not load this video.'),
          data: (job) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _playerCard(context, job),
              if (job.isCompleted) ...[
                SizedBox(height: sectionGap),
                _detailsCard(job),
              ],
              SizedBox(height: sectionGap),
              RecentVideosCard(
                excludeJobId: jobId,
                // Videos already in the account open on their own detail page.
                onOpen: (context, v) => Navigator.of(context).pushReplacement(
                  MaterialPageRoute(
                    builder: (_) => MotionDetailPage(jobId: v.id),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _playerCard(BuildContext context, JobRow job) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));
    final Widget media;
    if (job.isFailed) {
      media = InlineErrorBanner(
        message: job.errorMessage ?? 'This video could not be generated.',
      );
    } else if (!job.isTerminal) {
      media = ClipRRect(
        borderRadius: radius,
        child: const AspectRatio(
          aspectRatio: _frameAspect,
          child: GeneratingAnimation(steps: motionGeneratingSteps),
        ),
      );
    } else {
      final url = ref.watch(jobResultUrlProvider(job.id)).value;
      media = url == null
          ? ClipRRect(
              borderRadius: radius,
              child: const AspectRatio(
                aspectRatio: _frameAspect,
                child: ColoredBox(color: Colors.black, child: AppLoader()),
              ),
            )
          : MotionVideoPlayer(
              videoUrl: url,
              frameAspectRatio: _frameAspect,
              onInfo: _onVideoInfo,
            );
    }

    return BorderedCard(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_12sdp')),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.title?.isNotEmpty == true
                      ? widget.title!
                      : 'Motion Video',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_15ssp'),
                  ),
                ),
              ),
              SizedBox(width: AppDimens.sdp(context, '_10sdp')),
              CircleIconButton(
                icon: Icons.share_outlined,
                onTap: job.isCompleted ? _share : () {},
              ),
            ],
          ),
          SizedBox(height: AppDimens.sdp(context, '_12sdp')),
          media,
        ],
      ),
    );
  }

  Widget _detailsCard(JobRow job) {
    final seconds = widget.duration ?? _videoDuration?.inSeconds;
    return GenerationDetailsCard(
      heading: AppStrings.generationDetailsSection,
      thumbnailImage: widget.sourceImage,
      thumbnailIcon: Icons.directions_walk_rounded,
      thumbnailTint: AppColors.pinkGradientStart,
      promptLabel: AppStrings.motionPromptLabel,
      promptText: widget.promptText?.isNotEmpty == true
          ? widget.promptText!
          : 'Generated from a Motion Studio preset.',
      duration: seconds == null || seconds == 0 ? null : '$seconds Seconds',
      aspectRatio: _videoAspect == null ? '—' : _aspectLabel(_videoAspect!),
      outputQuality: widget.quality ?? '—',
      creditsUsed: job.creditsCharged == null
          ? '—'
          : '${job.creditsCharged} Credits',
      generatedOn: formatGeneratedOn(job.completedAt ?? job.createdAt),
    );
  }
}

/// "Recent Creations": the account's other videos, four across. Shared by the
/// generation page and the My Creations detail page; [onOpen] decides where a
/// tap goes.
class RecentVideosCard extends ConsumerWidget {
  const RecentVideosCard({
    super.key,
    required this.excludeJobId,
    required this.onOpen,
  });

  final String excludeJobId;
  final void Function(BuildContext context, CatalogVideoRow video) onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final videosAsync = ref.watch(userCatalogVideosProvider);
    final videos =
        (videosAsync.value ?? const <CatalogVideoRow>[])
            .where((v) => v.id != excludeJobId)
            .toList()
          ..sort(
            (a, b) =>
                parseApiDate(b.createdAt).compareTo(parseApiDate(a.createdAt)),
          );
    final recent = videos.take(4).toList();
    if (recent.isEmpty) return const SizedBox.shrink();

    final gap = AppDimens.sdp(context, '_8sdp');

    return BorderedCard(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_12sdp')),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  AppStrings.recentCreationsSection,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_14ssp'),
                  ),
                ),
              ),
              GestureDetector(
                onTap: () => pushMyCreationsPage(context),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      AppStrings.viewAll,
                      style: AppTextStyles.medium.copyWith(
                        color: AppColors.pinkGradientStart,
                        fontSize: AppDimens.ssp(context, '_12ssp'),
                      ),
                    ),
                    Icon(
                      Icons.chevron_right_rounded,
                      color: AppColors.pinkGradientStart,
                      size: AppDimens.sdp(context, '_16sdp'),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: AppDimens.sdp(context, '_12sdp')),
          LayoutBuilder(
            builder: (context, constraints) {
              // Four equal slots whether or not there are four videos, so a
              // short list doesn't stretch its tiles.
              final tileWidth = (constraints.maxWidth - gap * 3) / 4;
              return Row(
                children: [
                  for (var i = 0; i < recent.length; i++) ...[
                    if (i > 0) SizedBox(width: gap),
                    _RecentVideoTile(
                      video: recent[i],
                      onOpen: onOpen,
                      width: tileWidth,
                      height: tileWidth / 0.72,
                    ),
                  ],
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _RecentVideoTile extends StatelessWidget {
  const _RecentVideoTile({
    required this.video,
    required this.onOpen,
    required this.width,
    required this.height,
  });

  final CatalogVideoRow video;
  final void Function(BuildContext context, CatalogVideoRow video) onOpen;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_8sdp'));
    final thumb = video.thumbnailUrl;

    return GestureDetector(
      onTap: () => onOpen(context, video),
      child: ClipRRect(
        borderRadius: radius,
        child: SizedBox(
          width: width,
          height: height,
          child: Stack(
            fit: StackFit.expand,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      AppColors.violet.withValues(alpha: 0.45),
                      AppColors.violet.withValues(alpha: 0.12),
                    ],
                  ),
                ),
              ),
              if (thumb != null) AppNetworkImage(thumb, thumbnail: true),
              Center(
                child: Container(
                  padding: EdgeInsets.all(AppDimens.sdp(context, '_4sdp')),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.5),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.play_arrow_rounded,
                    color: Colors.white,
                    size: AppDimens.sdp(context, '_14sdp'),
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
