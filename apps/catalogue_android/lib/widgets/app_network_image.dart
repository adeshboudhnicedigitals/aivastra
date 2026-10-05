import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/widgets.dart';

/// The cache identity of a remote image.
///
/// Most photos here are served through presigned URLs, and the API signs a
/// fresh one on every list fetch — same object, different query string. Keyed
/// on the full URL, every refresh and every app start would re-download
/// every thumbnail. The path alone names the object, so that is the key; the
/// query is only dropped when it is a signature, since elsewhere it can be
/// what distinguishes one image from another.
String imageCacheKey(String url) {
  final query = url.indexOf('?');
  if (query < 0 || !url.contains('X-Amz-Signature=', query)) return url;
  return url.substring(0, query);
}

/// [AppNetworkImage]'s disk-cached source, for the places that need an
/// [ImageProvider] rather than a widget (a `DecorationImage`, say).
ImageProvider appImageProvider(String url) =>
    CachedNetworkImageProvider(url, cacheKey: imageCacheKey(url));

/// The app's one way to show a remote image: kept on disk between launches
/// (see [imageCacheKey]) and, for [thumbnail]s, decoded at roughly the size
/// it is drawn rather than the file's own — a 64dp tile holding a decoded
/// 512px photo is where a long strip's memory goes.
class AppNetworkImage extends StatelessWidget {
  const AppNetworkImage(
    this.url, {
    super.key,
    this.fit = BoxFit.cover,
    this.width,
    this.height,
    this.thumbnail = false,
    this.placeholder,
    this.errorBuilder,
  });

  final String url;
  final BoxFit fit;
  final double? width;
  final double? height;

  /// Decode down to the laid-out size. Leave off for anything the user can
  /// zoom or view fullscreen.
  final bool thumbnail;

  /// Shown while loading; nothing by default.
  final WidgetBuilder? placeholder;

  /// Shown when the image can't be loaded; nothing by default.
  final WidgetBuilder? errorBuilder;

  Widget _image(int? decodeWidth) {
    return CachedNetworkImage(
      imageUrl: url,
      cacheKey: imageCacheKey(url),
      fit: fit,
      width: width,
      height: height,
      memCacheWidth: decodeWidth,
      fadeInDuration: const Duration(milliseconds: 120),
      fadeOutDuration: Duration.zero,
      placeholder: placeholder == null ? null : (c, _) => placeholder!(c),
      errorWidget: (c, _, _) =>
          errorBuilder?.call(c) ?? const SizedBox.shrink(),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!thumbnail) return _image(null);

    final dpr = MediaQuery.devicePixelRatioOf(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final logical = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : width;
        if (logical == null || !logical.isFinite || logical <= 0) {
          return _image(null);
        }
        // 1.5x headroom: with BoxFit.cover a photo wider than its box is
        // scaled by height and needs more than the box's width in pixels.
        // Rounded up to a step so near-identical tiles share one decode.
        final pixels = logical * dpr * 1.5;
        return _image((pixels / 128).ceil() * 128);
      },
    );
  }
}
