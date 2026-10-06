import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/app_exception.dart';
import '../core/utils/save_media.dart';
import '../core/utils/share_media.dart';
import '../features/studio/application/catalogue_result_controller.dart';
import '../features/studio/application/studio_providers.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../features/studio/data/models/job_row.dart';
import '../utils/app_strings.dart';
import '../widgets/app_loader.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/generating_animation.dart';

/// Everything a catalogue page can DO to one of its images - download,
/// share, regenerate, delete, save the look as a preset - shared by the two
/// separate screens that show a catalogue: the generation result page
/// (`CatalogueResultPage`) and the My Creations detail page
/// (`CatalogueDetailPage`). Each owns its own layout; this owns the behaviour
/// so the two can't drift apart.
mixin CatalogueActions<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  String get catalogueId;

  int selectedIndex = 0;

  Future<void> openUrl(String url) =>
      launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);

  void toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  /// Fetches a fresh download URL for [job] (which also stamps it as
  /// downloaded server-side) and saves the image into the gallery. Falls
  /// back to opening the URL in the browser if the gallery save isn't
  /// possible on this device.
  Future<bool> saveJob(JobRow job) async {
    final controller = ref.read(
      catalogueResultControllerProvider(catalogueId).notifier,
    );
    final url = await controller.download(job.id);
    try {
      await saveRemoteMediaToGallery(
        url: url,
        baseName: 'aivastra-${job.id.substring(0, 8)}',
        isVideo: false,
      );
      return true;
    } catch (_) {
      await openUrl(url);
      return false;
    }
  }

  Future<void> downloadJob(JobRow job) async {
    toast('Downloading…');
    try {
      final saved = await saveJob(job);
      toast(saved ? 'Saved to your gallery' : 'Opened in your browser');
    } catch (_) {
      toast('Could not download this image. Please try again.');
    }
  }

  Future<void> shareJob(JobRow job) async {
    final url = ref.read(jobResultUrlProvider(job.id)).value;
    if (url == null) return;
    await shareRemoteMedia(url: url, filename: '${job.id}.jpg');
  }

  // Same approach as the web app's own "Download All" (generation-panel.tsx):
  // no batch/zip endpoint — just download every completed job's image one
  // after another.
  Future<void> downloadAll(List<JobRow> jobs) async {
    final completed = jobs.where((j) => j.isCompleted).toList();
    toast('Downloading ${completed.length} images…');
    var saved = 0;
    for (final job in completed) {
      try {
        if (await saveJob(job)) saved++;
      } catch (_) {
        // Keep going — one failed image shouldn't stop the rest.
      }
      if (!mounted) return;
    }
    toast(
      saved == completed.length
          ? 'Saved ${completed.length} images to your gallery'
          : saved == 0
          ? 'Could not download the images. Please try again.'
          : 'Saved $saved of ${completed.length} images',
    );
  }

  Future<void> regenerate(JobRow job) async {
    final controller = ref.read(
      catalogueResultControllerProvider(catalogueId).notifier,
    );
    try {
      final reasons = await controller.regenerateReasons(job.id);
      if (!mounted) return;
      if (reasons.isEmpty) {
        // Nothing configured server-side: regenerating would be rejected.
        toast('Regeneration is not available right now.');
        return;
      }
      final reason = await pickOptionSheet(
        context,
        title: 'Why regenerate this image?',
        options: reasons,
        selected: reasons.first,
      );
      if (reason == null) return;
      await controller.regenerate(job.id, reason);
      toast('Regenerating your image…');
    } on AppException catch (e) {
      // Server messages are already user-facing, e.g. the daily free
      // regeneration limit, or "already downloaded".
      toast(messageOf(e));
    } catch (_) {
      toast('Could not regenerate this image. Please try again.');
    }
  }

  String messageOf(AppException e) => e.when(
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

  Future<void> deleteJob(JobRow job, int remainingJobs) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.sheetBackground,
        title: const Text(
          'Delete this image?',
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
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final controller = ref.read(
      catalogueResultControllerProvider(catalogueId).notifier,
    );
    try {
      final stillHasImages = await controller.deleteJob(job.id);
      // My Creations lists these; make it re-fetch.
      ref.invalidate(allCataloguesProvider);
      ref.invalidate(userCataloguesProvider);
      if (!mounted) return;
      if (!stillHasImages) {
        // That was the catalogue's last image - nothing left to show.
        Navigator.of(context).pop();
        return;
      }
      setState(() => selectedIndex = 0);
      toast('Image deleted');
    } on AppException catch (e) {
      // The server's own reason, e.g. "cannot delete an active job".
      toast(messageOf(e));
    } catch (_) {
      toast('Could not delete this image. Please try again.');
    }
  }

  Future<void> saveAsPreset(
    String? gender,
    String? garmentTypeId,
    List<String>? poseIds,
  ) async {
    if (gender == null ||
        garmentTypeId == null ||
        poseIds == null ||
        poseIds.isEmpty) {
      return;
    }
    final name = await promptForName();
    if (name == null || name.isEmpty) return;
    await ref
        .read(studioRepositoryProvider)
        .savePosePreset(
          name: name,
          gender: gender,
          garmentTypeId: garmentTypeId,
          poseIds: poseIds,
        );
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Preset saved.')));
  }

  Future<String?> promptForName() {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.sheetBackground,
        title: const Text(
          'Save look as preset',
          style: TextStyle(color: Colors.white),
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(hintText: 'Preset name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  /// Opens [jobs] starting at [initialIndex] in the fullscreen viewer, which
  /// carries its own forward/backward arrows and swipe — the same set and
  /// order as the thumbnail strip below the hero card, so paging through the
  /// expanded view lines up with it exactly.
  void openFullscreen(List<JobRow> jobs, int initialIndex) {
    if (jobs.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) =>
            FullscreenImageViewer(jobs: jobs, initialIndex: initialIndex),
      ),
    );
  }
}

class JobHeroCard extends StatelessWidget {
  const JobHeroCard({
    super.key,
    required this.job,
    required this.resultUrl,
    required this.onDownload,
    required this.onRegenerate,
    required this.canRegenerate,
    required this.onFullscreen,
    this.onPrevious,
    this.onNext,
    this.aspectRatio = 0.8,
  });

  final double aspectRatio;

  final JobRow job;
  final String? resultUrl;
  final VoidCallback onDownload;
  final VoidCallback onRegenerate;
  final bool canRegenerate;
  final VoidCallback onFullscreen;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final cornerRadius = AppDimens.sdp(context, '_12sdp');

    return ClipRRect(
      borderRadius: BorderRadius.circular(cornerRadius),
      child: Stack(
        children: [
          MediaHeroImage(
            icon: job.isFailed
                ? Icons.error_outline_rounded
                : Icons.checkroom_rounded,
            tint: AppColors.pinkGradientStart,
            imageUrl: resultUrl,
            showFullscreenButton: false,
            aspectRatio: aspectRatio,
            radius: cornerRadius,
          ),
          if (!job.isTerminal)
            const Positioned.fill(child: GeneratingAnimation()),
          if (onPrevious != null)
            Positioned(
              left: AppDimens.sdp(context, '_8sdp'),
              top: 0,
              bottom: 0,
              child: Center(
                child: NavArrow(
                  icon: Icons.chevron_left_rounded,
                  onTap: onPrevious!,
                ),
              ),
            ),
          if (onNext != null)
            Positioned(
              right: AppDimens.sdp(context, '_8sdp'),
              top: 0,
              bottom: 0,
              child: Center(
                child: NavArrow(
                  icon: Icons.chevron_right_rounded,
                  onTap: onNext!,
                ),
              ),
            ),
          if (canRegenerate)
            Positioned(
              left: AppDimens.sdp(context, '_12sdp'),
              bottom: AppDimens.sdp(context, '_12sdp'),
              // Translucent-black pill over the photo (not the opaque tonal
              // style) so the image shows through, as in the reference.
              child: Material(
                color: Colors.black.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(
                  AppDimens.sdp(context, '_20sdp'),
                ),
                child: InkWell(
                  onTap: onRegenerate,
                  borderRadius: BorderRadius.circular(
                    AppDimens.sdp(context, '_20sdp'),
                  ),
                  child: Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: AppDimens.sdp(context, '_12sdp'),
                      vertical: AppDimens.sdp(context, '_8sdp'),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.repeat_rounded,
                          color: Colors.white,
                          size: AppDimens.sdp(context, '_14sdp'),
                        ),
                        SizedBox(width: AppDimens.sdp(context, '_6sdp')),
                        Text(
                          AppStrings.regenerate,
                          style: AppTextStyles.medium.copyWith(
                            color: Colors.white,
                            fontSize: AppDimens.ssp(context, '_11ssp'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          if (job.isCompleted)
            Positioned(
              right: AppDimens.sdp(context, '_12sdp'),
              bottom: AppDimens.sdp(context, '_12sdp'),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ExpandIconButton(onTap: onFullscreen),
                  SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                  CircleOverlayButton(
                    icon: Icons.download_rounded,
                    onTap: onDownload,
                    filled: true,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class NavArrow extends StatelessWidget {
  const NavArrow({super.key, required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Bigger, frosted-glass arrows so they read clearly over any photo.
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: GlassCircle(
        size: AppDimens.sdp(context, '_38sdp'),
        child: Icon(
          icon,
          color: Colors.white,
          size: AppDimens.sdp(context, '_26sdp'),
        ),
      ),
    );
  }
}

class CircleOverlayButton extends StatelessWidget {
  const CircleOverlayButton({
    super.key,
    required this.icon,
    required this.onTap,
    this.filled = false,
  });

  final IconData icon;
  final VoidCallback onTap;

  /// Solid pink circle (for Download) instead of the plain translucent-black
  /// one every other overlay button uses — matches the reference design's
  /// visual distinction between the two.
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      customBorder: const CircleBorder(),
      child: Container(
        padding: EdgeInsets.all(AppDimens.sdp(context, '_10sdp')),
        decoration: BoxDecoration(
          color: filled
              ? AppColors.pinkGradientStart
              : Colors.black.withValues(alpha: 0.45),
          shape: BoxShape.circle,
        ),
        child: Icon(
          icon,
          color: Colors.white,
          size: AppDimens.sdp(context, '_16sdp'),
        ),
      ),
    );
  }
}

/// Fullscreen viewer for a catalogue's images — swipe (the [PageView]) or the
/// [NavArrow] buttons both move between [jobs], starting at [initialIndex].
/// A job still generating or that failed shows the same placeholder the hero
/// card does, rather than nothing.
class FullscreenImageViewer extends ConsumerStatefulWidget {
  const FullscreenImageViewer({
    super.key,
    required this.jobs,
    required this.initialIndex,
  });

  final List<JobRow> jobs;
  final int initialIndex;

  @override
  ConsumerState<FullscreenImageViewer> createState() =>
      _FullscreenImageViewerState();
}

class _FullscreenImageViewerState extends ConsumerState<FullscreenImageViewer> {
  late final _controller = PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;

  // True while the current image is zoomed in or has two fingers on it.
  // The PageView's horizontal drag and the image's pinch/pan compete for
  // the same touches, and the drag usually won: a pinch slid to the next
  // image, or did nothing. Paging by swipe is switched off for as long as
  // the image needs the gesture; the arrows still work.
  bool _imageHasGesture = false;

  void _setImageHasGesture(bool value) {
    if (value == _imageHasGesture || !mounted) return;
    setState(() => _imageHasGesture = value);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _go(int delta) {
    final count = widget.jobs.length;
    _controller.animateToPage(
      (_index + delta + count) % count,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final jobs = widget.jobs;

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: PageView.builder(
                controller: _controller,
                physics: _imageHasGesture
                    ? const NeverScrollableScrollPhysics()
                    : null,
                itemCount: jobs.length,
                onPageChanged: (i) => setState(() {
                  _index = i;
                  _imageHasGesture = false;
                }),
                itemBuilder: (context, i) => _FullscreenPage(
                  job: jobs[i],
                  active: i == _index,
                  onGestureChanged: _setImageHasGesture,
                ),
              ),
            ),
            Positioned(
              top: AppDimens.sdp(context, '_12sdp'),
              left: AppDimens.sdp(context, '_12sdp'),
              child: BackIconButton(onTap: () => Navigator.of(context).pop()),
            ),
            if (jobs.length > 1) ...[
              Positioned(
                left: AppDimens.sdp(context, '_12sdp'),
                top: 0,
                bottom: 0,
                child: Center(
                  child: NavArrow(
                    icon: Icons.chevron_left_rounded,
                    onTap: () => _go(-1),
                  ),
                ),
              ),
              Positioned(
                right: AppDimens.sdp(context, '_12sdp'),
                top: 0,
                bottom: 0,
                child: Center(
                  child: NavArrow(
                    icon: Icons.chevron_right_rounded,
                    onTap: () => _go(1),
                  ),
                ),
              ),
              Positioned(
                bottom: AppDimens.sdp(context, '_20sdp'),
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: AppDimens.sdp(context, '_12sdp'),
                      vertical: AppDimens.sdp(context, '_6sdp'),
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(
                        AppDimens.sdp(context, '_20sdp'),
                      ),
                    ),
                    child: Text(
                      '${_index + 1} / ${jobs.length}',
                      style: AppTextStyles.medium.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_12ssp'),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _FullscreenPage extends ConsumerWidget {
  const _FullscreenPage({
    required this.job,
    required this.active,
    required this.onGestureChanged,
  });

  final JobRow job;

  /// Whether this is the page on screen (neighbours stay built off-screen).
  final bool active;
  final ValueChanged<bool> onGestureChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!job.isTerminal) return const GeneratingAnimation();
    if (job.isFailed) {
      return const Center(
        child: Icon(
          Icons.error_outline_rounded,
          color: Colors.white38,
          size: 48,
        ),
      );
    }

    final urlAsync = ref.watch(jobResultUrlProvider(job.id));
    return urlAsync.when(
      loading: () => const Center(child: AppLoader()),
      error: (_, _) => const Center(
        child: Icon(
          Icons.broken_image_outlined,
          color: Colors.white38,
          size: 48,
        ),
      ),
      data: (url) => _ZoomableImage(
        url: url,
        active: active,
        onGestureChanged: onGestureChanged,
      ),
    );
  }
}

/// One fullscreen image: pinch to zoom, drag to pan while zoomed, double-tap
/// to zoom in on the tapped spot (and again to zoom back out).
class _ZoomableImage extends StatefulWidget {
  const _ZoomableImage({
    required this.url,
    required this.active,
    required this.onGestureChanged,
  });

  final String url;
  final bool active;

  /// Reports whether this image currently needs touches for itself — see
  /// `_imageHasGesture` on the viewer.
  final ValueChanged<bool> onGestureChanged;

  @override
  State<_ZoomableImage> createState() => _ZoomableImageState();
}

class _ZoomableImageState extends State<_ZoomableImage>
    with SingleTickerProviderStateMixin {
  static const _doubleTapScale = 2.5;

  final _transform = TransformationController();
  late final _zoomAnimation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 220),
  );
  Animation<Matrix4>? _zoomTween;
  Offset _doubleTapPosition = Offset.zero;
  int _pointers = 0;

  bool get _zoomed => _transform.value.getMaxScaleOnAxis() > 1.01;

  @override
  void initState() {
    super.initState();
    _transform.addListener(_reportGesture);
    _zoomAnimation.addListener(() {
      final tween = _zoomTween;
      if (tween != null) _transform.value = tween.value;
    });
  }

  @override
  void didUpdateWidget(_ZoomableImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Swiped (or arrowed) away: come back to it unzoomed.
    if (oldWidget.active && !widget.active) {
      _zoomAnimation.stop();
      _transform.value = Matrix4.identity();
    }
  }

  @override
  void dispose() {
    _zoomAnimation.dispose();
    _transform.dispose();
    super.dispose();
  }

  void _reportGesture() {
    if (!widget.active) return;
    final busy = _pointers >= 2 || _zoomed;
    // The first report can land mid-build (a pointer event during layout),
    // where the viewer can't setState.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onGestureChanged(busy);
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  void _pointerDown(PointerDownEvent _) {
    _pointers++;
    // Synchronously on the second finger, so the page drag is gone before
    // the fingers have moved far enough for it to claim the gesture.
    if (_pointers >= 2 && widget.active) widget.onGestureChanged(true);
  }

  void _pointerUp(PointerEvent _) {
    _pointers = (_pointers - 1).clamp(0, 10);
    _reportGesture();
  }

  void _toggleZoom() {
    final Matrix4 target;
    if (_zoomed) {
      target = Matrix4.identity();
    } else {
      // Scale about the tapped point, so that point stays under the finger.
      final p = _doubleTapPosition;
      target = Matrix4.diagonal3Values(_doubleTapScale, _doubleTapScale, 1)
        ..setTranslationRaw(
          -p.dx * (_doubleTapScale - 1),
          -p.dy * (_doubleTapScale - 1),
          0,
        );
    }
    _zoomTween = Matrix4Tween(
      begin: _transform.value,
      end: target,
    ).animate(CurvedAnimation(parent: _zoomAnimation, curve: Curves.easeOut));
    _zoomAnimation.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: _pointerDown,
      onPointerUp: _pointerUp,
      onPointerCancel: _pointerUp,
      child: GestureDetector(
        onDoubleTapDown: (details) =>
            _doubleTapPosition = details.localPosition,
        onDoubleTap: _toggleZoom,
        child: InteractiveViewer(
          transformationController: _transform,
          minScale: 1,
          maxScale: 4,
          child: Center(
            child: AppNetworkImage(widget.url, fit: BoxFit.contain),
          ),
        ),
      ),
    );
  }
}
