import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:video_player/video_player.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../utils/app_constants.dart';
import 'app_loader.dart';

/// Video frame for the Motion result page. The player chrome (play/pause,
/// time, mute, fullscreen, seek bar) exists only here — once the video is
/// loaded and watchable — so nothing player-like shows while a video is still
/// being generated (that state uses `GeneratingAnimation` instead).
///
/// The frame is a black, rounded box; the video is letterboxed inside it and
/// the controls sit on a bottom gradient over the video.
class MotionVideoPlayer extends StatefulWidget {
  const MotionVideoPlayer({
    super.key,
    required this.videoUrl,
    this.frameAspectRatio = 0.8,
    this.onInfo,
  });

  final String videoUrl;

  /// Aspect ratio of the frame the video is letterboxed in. Constant, so the
  /// layout doesn't jump when the video finishes loading.
  final double frameAspectRatio;

  /// Reports the video's own aspect ratio and length once known, for the
  /// Generation Details rows.
  final void Function(double aspectRatio, Duration duration)? onInfo;

  @override
  State<MotionVideoPlayer> createState() => _MotionVideoPlayerState();
}

class _MotionVideoPlayerState extends State<MotionVideoPlayer> {
  late VideoPlayerController _controller;
  bool _failed = false;
  bool _muted = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void didUpdateWidget(MotionVideoPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.videoUrl != widget.videoUrl) {
      _controller.dispose();
      _failed = false;
      _init();
    }
  }

  void _init() {
    final controller = VideoPlayerController.networkUrl(
      Uri.parse(widget.videoUrl),
    );
    _controller = controller;
    controller
        .initialize()
        .then((_) {
          if (!mounted || _controller != controller) return;
          widget.onInfo?.call(
            controller.value.aspectRatio,
            controller.value.duration,
          );
          setState(() {});
        })
        .catchError((_) {
          if (mounted && _controller == controller) {
            setState(() => _failed = true);
          }
        });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _togglePlay() {
    _controller.value.isPlaying ? _controller.pause() : _controller.play();
  }

  void _toggleMute() {
    setState(() => _muted = !_muted);
    _controller.setVolume(_muted ? 0 : 1);
  }

  void _openFullscreen() {
    Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _FullscreenVideo(controller: _controller),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_12sdp'));

    Widget frameChild;
    if (_failed) {
      frameChild = Center(
        child: Text(
          'Could not play this video.',
          style: AppTextStyles.regular.copyWith(
            color: AppColors.textSecondary,
            fontSize: AppDimens.ssp(context, '_12ssp'),
          ),
        ),
      );
    } else if (!_controller.value.isInitialized) {
      frameChild = const AppLoader();
    } else {
      frameChild = Stack(
        fit: StackFit.expand,
        children: [
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _togglePlay,
            child: Center(
              child: AspectRatio(
                aspectRatio: _controller.value.aspectRatio,
                child: VideoPlayer(_controller),
              ),
            ),
          ),
          // Center play button, shown on top of the frame whenever the video
          // is paused (including the very first frame) so it's obvious the
          // thumbnail is actually playable.
          Positioned.fill(
            child: IgnorePointer(
              child: ValueListenableBuilder<VideoPlayerValue>(
                valueListenable: _controller,
                builder: (context, value, _) {
                  return AnimatedOpacity(
                    opacity: value.isPlaying ? 0 : 1,
                    duration: const Duration(milliseconds: 200),
                    child: Center(
                      child: Container(
                        width: AppDimens.sdp(context, '_48sdp'),
                        height: AppDimens.sdp(context, '_48sdp'),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.45),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.play_arrow_rounded,
                          color: Colors.white,
                          size: AppDimens.sdp(context, '_28sdp'),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _Controls(
              controller: _controller,
              muted: _muted,
              onPlayPause: _togglePlay,
              onMute: _toggleMute,
              onFullscreen: _openFullscreen,
            ),
          ),
        ],
      );
    }

    return ClipRRect(
      borderRadius: radius,
      child: AspectRatio(
        aspectRatio: widget.frameAspectRatio,
        child: ColoredBox(color: Colors.black, child: frameChild),
      ),
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({
    required this.controller,
    required this.muted,
    required this.onPlayPause,
    required this.onMute,
    required this.onFullscreen,
  });

  final VideoPlayerController controller;
  final bool muted;
  final VoidCallback onPlayPause;
  final VoidCallback onMute;
  final VoidCallback onFullscreen;

  static String _fmt(Duration d) =>
      '${d.inMinutes.remainder(60)}:${d.inSeconds.remainder(60).toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final iconSize = AppDimens.sdp(context, '_18sdp');

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.transparent, Colors.black.withValues(alpha: 0.75)],
        ),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          AppDimens.sdp(context, '_12sdp'),
          AppDimens.sdp(context, '_16sdp'),
          AppDimens.sdp(context, '_12sdp'),
          AppDimens.sdp(context, '_10sdp'),
        ),
        // Only this subtree rebuilds as the video plays.
        child: ValueListenableBuilder<VideoPlayerValue>(
          valueListenable: controller,
          builder: (context, value, _) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    GestureDetector(
                      onTap: onPlayPause,
                      child: Icon(
                        value.isPlaying
                            ? Icons.pause_rounded
                            : Icons.play_arrow_rounded,
                        color: Colors.white,
                        size: iconSize + 4,
                      ),
                    ),
                    SizedBox(width: AppDimens.sdp(context, '_8sdp')),
                    Text(
                      '${_fmt(value.position)} / ${_fmt(value.duration)}',
                      style: AppTextStyles.medium.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_11ssp'),
                      ),
                    ),
                    const Spacer(),
                    GestureDetector(
                      onTap: onMute,
                      child: Icon(
                        muted
                            ? Icons.volume_off_rounded
                            : Icons.volume_up_rounded,
                        color: Colors.white,
                        size: iconSize,
                      ),
                    ),
                    SizedBox(width: AppDimens.sdp(context, '_12sdp')),
                    GestureDetector(
                      onTap: onFullscreen,
                      child: SvgPicture.asset(
                        AppAssets.expandIcon,
                        width: iconSize + 10,
                        height: iconSize + 10,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: AppDimens.sdp(context, '_6sdp')),
                _SeekBar(
                  progress: value.duration.inMilliseconds == 0
                      ? 0
                      : value.position.inMilliseconds /
                            value.duration.inMilliseconds,
                  onSeek: (fraction) => controller.seekTo(
                    Duration(
                      milliseconds: (value.duration.inMilliseconds * fraction)
                          .round(),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Tap / drag seek bar: pink gradient fill over a faint track, with a dot at
/// the playhead.
class _SeekBar extends StatelessWidget {
  const _SeekBar({required this.progress, required this.onSeek});

  final double progress;
  final ValueChanged<double> onSeek;

  @override
  Widget build(BuildContext context) {
    final trackHeight = AppDimens.sdp(context, '_3sdp');
    final dot = AppDimens.sdp(context, '_10sdp');

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final p = progress.clamp(0.0, 1.0);
        void seekAt(double dx) => onSeek((dx / width).clamp(0.0, 1.0));

        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: (d) => seekAt(d.localPosition.dx),
          onHorizontalDragUpdate: (d) => seekAt(d.localPosition.dx),
          child: SizedBox(
            height: dot + 6,
            child: Stack(
              alignment: Alignment.centerLeft,
              children: [
                Container(
                  height: trackHeight,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.25),
                    borderRadius: BorderRadius.circular(trackHeight),
                  ),
                ),
                Container(
                  height: trackHeight,
                  width: width * p,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [AppColors.violet, AppColors.pinkGradientStart],
                    ),
                    borderRadius: BorderRadius.circular(trackHeight),
                  ),
                ),
                Positioned(
                  left: (width * p - dot / 2).clamp(0.0, width - dot),
                  child: Container(
                    width: dot,
                    height: dot,
                    decoration: const BoxDecoration(
                      color: AppColors.pinkGradientStart,
                      shape: BoxShape.circle,
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
}

/// Full-screen playback of the same controller (so position, volume and
/// play state carry over both ways).
class _FullscreenVideo extends StatelessWidget {
  const _FullscreenVideo({required this.controller});

  final VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => controller.value.isPlaying
                  ? controller.pause()
                  : controller.play(),
              child: Center(
                child: AspectRatio(
                  aspectRatio: controller.value.aspectRatio,
                  child: VideoPlayer(controller),
                ),
              ),
            ),
            Positioned.fill(
              child: IgnorePointer(
                child: ValueListenableBuilder<VideoPlayerValue>(
                  valueListenable: controller,
                  builder: (context, value, _) {
                    return AnimatedOpacity(
                      opacity: value.isPlaying ? 0 : 1,
                      duration: const Duration(milliseconds: 200),
                      child: Center(
                        child: Container(
                          width: AppDimens.sdp(context, '_48sdp'),
                          height: AppDimens.sdp(context, '_48sdp'),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.45),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.play_arrow_rounded,
                            color: Colors.white,
                            size: AppDimens.sdp(context, '_28sdp'),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _Controls(
                controller: controller,
                muted: controller.value.volume == 0,
                onPlayPause: () => controller.value.isPlaying
                    ? controller.pause()
                    : controller.play(),
                onMute: () =>
                    controller.setVolume(controller.value.volume == 0 ? 1 : 0),
                onFullscreen: () => Navigator.of(context).pop(),
              ),
            ),
            Positioned(
              top: AppDimens.sdp(context, '_8sdp'),
              left: AppDimens.sdp(context, '_8sdp'),
              child: IconButton(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close_rounded, color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
