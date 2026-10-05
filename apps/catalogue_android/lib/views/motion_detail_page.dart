import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../core/network/app_exception.dart';
import '../core/utils/relative_date.dart';
import '../core/utils/save_media.dart';
import '../core/utils/share_media.dart';
import '../features/studio/application/motion_result_controller.dart';
import '../features/studio/application/studio_providers.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/catalog_video_row.dart';
import '../features/studio/data/models/job_row.dart';
import '../features/studio/data/models/sample_video.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/credits_badge.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/generating_animation.dart';
import '../widgets/motion_video_player.dart';
import 'home_page.dart';
import 'motion_result_page.dart';

/// Frame ratio (width / height) of the player and the generating box - a
/// touch wider than tall, per the design.
const _frameAspect = 1.05;

/// A motion video opened from My Creations (or Recent Creations). A separate
/// screen from the generation result page (`MotionResultPage`, "Your Motion
/// Video is Ready!"): the player has no card around it, the actions sit in a
/// row under it, and the preset's own details (title, prompt, length, quality)
/// are looked up from the video's preset since the job row doesn't carry them.
class MotionDetailPage extends ConsumerStatefulWidget {
  const MotionDetailPage({super.key, required this.jobId});

  final String jobId;

  @override
  ConsumerState<MotionDetailPage> createState() => _MotionDetailPageState();
}

class _MotionDetailPageState extends ConsumerState<MotionDetailPage> {
  // Reported by the player once the video loads.
  double? _videoAspect;
  Duration? _videoDuration;

  String get jobId => widget.jobId;

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  String _messageOf(AppException e) => e.when(
    badRequest: (m) => m,
    unauthorized: (m) => m,
    emailNotVerified: (m) => m,
    forbidden: (m) => m,
    deviceLimitReached: (m, _, _, _) => m,
    invalidRefresh: (m) => m,
    rateLimited: (m) => m,
    network: (m) => m,
    server: (m) => m,
    unknown: (m) => m,
  );

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
        // Gallery save unavailable (e.g. Android 9 or older).
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
        _toast('Opened in your browser');
      }
    } catch (_) {
      _toast('Could not download this video. Please try again.');
    }
  }

  Future<void> _share() async {
    try {
      final url = await ref
          .read(motionResultControllerProvider(jobId).notifier)
          .resultVideoUrl();
      await shareRemoteMedia(url: url, filename: '$jobId.mp4');
    } catch (_) {
      _toast('Could not share this video. Please try again.');
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.sheetBackground,
        title: const Text(
          'Delete this video?',
          style: TextStyle(color: Colors.white),
        ),
        content: const Text(
          'This cannot be undone.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text(
              'Delete',
              style: TextStyle(color: AppColors.pinkGradientStart),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(studioRepositoryProvider).deleteJob(jobId);
      ref.invalidate(userCatalogVideosProvider);
      if (mounted) Navigator.of(context).pop();
    } on AppException catch (e) {
      // The server's own reason, e.g. "cannot delete an active job".
      _toast(_messageOf(e));
    } catch (_) {
      _toast('Could not delete this video. Please try again.');
    }
  }

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
    final gap = AppDimens.sdp(context, '_14sdp');
    final jobAsync = ref.watch(motionResultControllerProvider(jobId));
    final videos = ref.watch(userCatalogVideosProvider).value;
    final row = videos?.where((v) => v.id == jobId).firstOrNull;
    final samples = ref.watch(sampleVideosProvider).value?.items;
    final sample = row?.sampleVideoId == null
        ? null
        : samples?.where((s) => s.id == row!.sampleVideoId).firstOrNull;

    return DetailPageScaffold(
      title: sample?.title ?? 'Motion Video',
      subtitle: null,
      headerTrailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Consumer(
            builder: (context, ref, _) {
              final credits = ref.watch(creditsSummaryProvider).value;
              return CreditsBadge(credits: credits?.balance);
            },
          ),
          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
          AppPillButton(
            label: AppStrings.createNew,
            trailingIcon: Icons.arrow_right_alt_rounded,
            style: AppPillButtonStyle.highlight,
            // HomePage supplies the Scaffold the studio widgets need.
            onTap: () => Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (_) => const HomePage()),
              (route) => false,
            ),
          ),
        ],
      ),
      children: [
        jobAsync.when(
          loading: () => const AppLoader.section(),
          error: (_, _) =>
              const InlineErrorBanner(message: 'Could not load this video.'),
          data: (job) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _media(context, job, row),
              SizedBox(height: gap),
              _actions(context, job),
              if (job.isCompleted) ...[
                SizedBox(height: gap),
                _details(job, row, sample),
              ],
              SizedBox(height: gap),
              RecentVideosCard(
                excludeJobId: jobId,
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

  Widget _media(BuildContext context, JobRow job, CatalogVideoRow? row) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_14sdp'));
    if (job.isFailed) {
      return InlineErrorBanner(
        message: job.errorMessage ?? 'This video could not be generated.',
      );
    }
    if (!job.isTerminal) {
      return ClipRRect(
        borderRadius: radius,
        child: const AspectRatio(
          aspectRatio: _frameAspect,
          child: GeneratingAnimation(steps: motionGeneratingSteps),
        ),
      );
    }
    // The list already carries a presigned URL; fall back to fetching one.
    final url = row?.videoUrl ?? ref.watch(jobResultUrlProvider(job.id)).value;
    if (url == null) {
      return ClipRRect(
        borderRadius: radius,
        child: const AspectRatio(
          aspectRatio: _frameAspect,
          child: ColoredBox(
            color: Colors.black,
            child: AppLoader(),
          ),
        ),
      );
    }
    return MotionVideoPlayer(
      videoUrl: url,
      frameAspectRatio: _frameAspect,
      onInfo: (aspect, duration) => setState(() {
        _videoAspect = aspect;
        _videoDuration = duration;
      }),
    );
  }

  Widget _actions(BuildContext context, JobRow job) {
    final s = AppDimens.sdp(context, '_8sdp');
    return Row(
      children: [
        Expanded(
          flex: 5,
          child: AppPillButton(
            label: AppStrings.download,
            icon: Icons.download_rounded,
            style: AppPillButtonStyle.filled,
            onTap: job.isCompleted ? _download : () {},
          ),
        ),
        SizedBox(width: s),
        Expanded(
          flex: 6,
          child: AppPillButton(
            label: AppStrings.regenerate,
            icon: Icons.refresh_rounded,
            style: AppPillButtonStyle.tonal,
            // The regenerate endpoint always re-runs the dedicated
            // image-to-image workflow against the original job's own result
            // (see apps/api/src/modules/jobs/regenerate.ts) — there is no
            // video-aware path, so wiring this to a real call would submit a
            // job that's doomed to fail and burn the user's free-regenerate
            // daily quota for nothing. Surface that honestly instead.
            onTap: () => _toast(
              'Regenerate isn\'t available for motion videos yet.',
            ),
          ),
        ),
        SizedBox(width: s),
        Expanded(
          flex: 4,
          child: AppPillButton(
            label: AppStrings.share,
            icon: Icons.share_outlined,
            style: AppPillButtonStyle.tonal,
            onTap: job.isCompleted ? _share : () {},
          ),
        ),
        SizedBox(width: s),
        Expanded(
          flex: 4,
          child: AppPillButton(
            label: AppStrings.delete,
            icon: Icons.delete_outline_rounded,
            style: AppPillButtonStyle.tonal,
            onTap: _delete,
          ),
        ),
      ],
    );
  }

  Widget _details(JobRow job, CatalogVideoRow? row, SampleVideo? sample) {
    final seconds = sample?.duration ?? _videoDuration?.inSeconds;
    final thumb = row?.thumbnailUrl;
    return GenerationDetailsCard(
      heading: AppStrings.generationDetailsSection,
      thumbnailImage: thumb == null ? null : appImageProvider(thumb),
      thumbnailIcon: Icons.directions_walk_rounded,
      thumbnailTint: AppColors.pinkGradientStart,
      promptLabel: AppStrings.motionPromptLabel,
      // Hidden on this page — not shown in Generation Details here.
      promptText: null,
      duration: seconds == null || seconds == 0 ? null : '$seconds Seconds',
      aspectRatio: _videoAspect == null ? '—' : _aspectLabel(_videoAspect!),
      outputQuality: sample?.quality ?? '—',
      creditsUsed: job.creditsCharged == null
          ? '—'
          : '${job.creditsCharged} Credits',
      generatedOn: formatGeneratedOn(job.completedAt ?? job.createdAt),
    );
  }
}
