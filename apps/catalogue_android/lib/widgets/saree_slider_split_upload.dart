import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../utils/app_strings.dart';
import 'app_loader.dart';
import 'auth_widgets.dart';
import 'detail_page_widgets.dart';
import 'gradient_button.dart';

const _maxSareeSplitPhotoBytes = 20 * 1024 * 1024;

/// Decodes [bytes] just far enough to read its dimensions — run via
/// [compute] since decoding a near-20MB photo is real CPU work that would
/// otherwise jank the picker/rotate interaction it's awaited under.
({int width, int height}) _sareePhotoSize(Uint8List bytes) {
  final decoded = img.decodeImage(bytes);
  if (decoded == null) {
    throw const FormatException('Could not read the selected image.');
  }
  return (width: decoded.width, height: decoded.height);
}

/// Rotates [bytes] 90° clockwise and re-encodes as JPEG. Always clockwise —
/// calling it repeatedly cycles through all four orientations, same as the
/// web app's handleRotateSliderSplit.
Uint8List _rotateSareePhoto(Uint8List bytes) {
  final decoded = img.decodeImage(bytes);
  if (decoded == null) {
    throw const FormatException('Could not read the selected image.');
  }
  return Uint8List.fromList(
    img.encodeJpg(img.copyRotate(decoded, angle: 90), quality: 92),
  );
}

/// Crops [bytes] into Body (top) + Pallu (bottom) at the given split ratio
/// (fraction of height given to Body) and re-encodes both as JPEG — mirrors
/// the web app's handleConfirmSplit exactly, just via the `image` package's
/// canvas instead of an HTML `<canvas>`.
({Uint8List body, Uint8List pallu}) _splitSareePhoto(
  (Uint8List bytes, double splitRatio) args,
) {
  final (bytes, splitRatio) = args;
  final decoded = img.decodeImage(bytes);
  if (decoded == null) {
    throw const FormatException('Could not read the selected image.');
  }
  final totalHeight = decoded.height;
  final bodyHeight = (totalHeight * splitRatio).round().clamp(
    1,
    totalHeight - 1,
  );
  final palluHeight = totalHeight - bodyHeight;
  final body = img.copyCrop(
    decoded,
    x: 0,
    y: 0,
    width: decoded.width,
    height: bodyHeight,
  );
  final pallu = img.copyCrop(
    decoded,
    x: 0,
    y: bodyHeight,
    width: decoded.width,
    height: palluHeight,
  );
  return (
    body: Uint8List.fromList(img.encodeJpg(body, quality: 92)),
    pallu: Uint8List.fromList(img.encodeJpg(pallu, quality: 92)),
  );
}

/// Lets the user upload one full saree photo and split it into Body + Pallu
/// client-side by dragging a line across it, instead of photographing the
/// two parts separately — mirrors the web app's studio page exactly
/// (catalogues-web's studio/page.tsx, handleConfirmSplit). The two crops are
/// handed to [onConfirm], which the caller wires to the exact same upload
/// path the two-box Body/Pallu mode already uses
/// (CatalogueSelectionController.pickAndUploadUpper/pickAndUploadPallu), so
/// submission, validation and the dispatcher never need to know this mode
/// exists.
class SareeSliderSplitUpload extends StatefulWidget {
  const SareeSliderSplitUpload({
    super.key,
    required this.isUploadingUpper,
    required this.upperUploaded,
    required this.isUploadingPallu,
    required this.palluUploaded,
    required this.onConfirm,
    required this.onReset,
  });

  final bool isUploadingUpper;
  final bool upperUploaded;
  final bool isUploadingPallu;
  final bool palluUploaded;

  /// Called once the split is confirmed, with the two cropped files.
  final Future<void> Function(File body, File pallu) onConfirm;

  /// Clears both uploaded keys and resets this widget back to the empty
  /// dropzone — called on the shared remove button, and whenever the caller
  /// itself needs to reset this mode (e.g. the mode toggle flips off).
  final VoidCallback onReset;

  @override
  State<SareeSliderSplitUpload> createState() =>
      _SareeSliderSplitUploadState();
}

class _SareeSliderSplitUploadState extends State<SareeSliderSplitUpload> {
  final _picker = ImagePicker();

  Uint8List? _photoBytes;
  int _naturalWidth = 1;
  int _naturalHeight = 1;
  double _splitRatio = 0.5;
  bool _confirmed = false;
  File? _confirmedBodyFile;
  File? _confirmedPalluFile;
  bool _loadingPhoto = false;
  bool _rotating = false;
  bool _splitting = false;
  String? _error;

  Future<void> _pickPhoto() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery);
    if (picked == null) return;
    final file = File(picked.path);
    if (await file.length() > _maxSareeSplitPhotoBytes) {
      setState(
        () => _error = 'File exceeds 20 MB. Please choose a smaller image.',
      );
      return;
    }
    setState(() {
      _loadingPhoto = true;
      _error = null;
    });
    try {
      final bytes = await file.readAsBytes();
      final size = await compute(_sareePhotoSize, bytes);
      setState(() {
        _photoBytes = bytes;
        _naturalWidth = size.width;
        _naturalHeight = size.height;
        _splitRatio = 0.5;
        _confirmed = false;
      });
    } catch (_) {
      setState(
        () => _error =
            'Unsupported file type. Please upload a JPEG, PNG, or WebP '
            'image.',
      );
    } finally {
      if (mounted) setState(() => _loadingPhoto = false);
    }
  }

  Future<void> _rotate() async {
    final bytes = _photoBytes;
    if (bytes == null || _rotating) return;
    setState(() => _rotating = true);
    try {
      final rotated = await compute(_rotateSareePhoto, bytes);
      final size = await compute(_sareePhotoSize, rotated);
      setState(() {
        _photoBytes = rotated;
        _naturalWidth = size.width;
        _naturalHeight = size.height;
      });
    } catch (_) {
      setState(
        () => _error = 'Could not rotate the image. Please try again.',
      );
    } finally {
      if (mounted) setState(() => _rotating = false);
    }
  }

  void _updateSplitRatio(double localDy, double areaHeight) {
    if (areaHeight <= 0) return;
    setState(() => _splitRatio = (localDy / areaHeight).clamp(0.05, 0.95));
  }

  Future<void> _confirmSplit() async {
    final bytes = _photoBytes;
    if (bytes == null || _splitting) return;
    setState(() {
      _splitting = true;
      _error = null;
    });
    try {
      final crops = await compute(_splitSareePhoto, (bytes, _splitRatio));
      final dir = await getTemporaryDirectory();
      final stamp = DateTime.now().microsecondsSinceEpoch;
      final bodyFile = await File(
        '${dir.path}/saree_split_body_$stamp.jpg',
      ).writeAsBytes(crops.body);
      final palluFile = await File(
        '${dir.path}/saree_split_pallu_$stamp.jpg',
      ).writeAsBytes(crops.pallu);
      if (!mounted) return;
      setState(() {
        _confirmed = true;
        _confirmedBodyFile = bodyFile;
        _confirmedPalluFile = palluFile;
      });
      await widget.onConfirm(bodyFile, palluFile);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not process the image split. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _splitting = false);
    }
  }

  void _resetAll() {
    setState(() {
      _photoBytes = null;
      _naturalWidth = 1;
      _naturalHeight = 1;
      _splitRatio = 0.5;
      _confirmed = false;
      _confirmedBodyFile = null;
      _confirmedPalluFile = null;
      _error = null;
    });
    widget.onReset();
  }

  @override
  Widget build(BuildContext context) {
    final content = _photoBytes == null
        ? _buildDropzone(context)
        : !_confirmed
        ? _buildSplitEditor(context)
        : _buildConfirmedPreview(context);
    if (_error == null) return content;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        content,
        SizedBox(height: AppDimens.sdp(context, '_8sdp')),
        InlineErrorBanner(message: _error!),
      ],
    );
  }

  Widget _buildDropzone(BuildContext context) {
    final radiusValue = AppDimens.sdp(context, '_14sdp');
    return DashedBorderContainer(
      borderRadius: radiusValue,
      child: InkWell(
        onTap: _loadingPhoto ? null : _pickPhoto,
        borderRadius: BorderRadius.circular(radiusValue),
        child: Container(
          width: double.infinity,
          alignment: Alignment.center,
          padding: EdgeInsets.symmetric(
            vertical: AppDimens.sdp(context, '_20sdp'),
            horizontal: AppDimens.sdp(context, '_8sdp'),
          ),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.03),
            borderRadius: BorderRadius.circular(radiusValue),
          ),
          child: _loadingPhoto
              ? const AppLoader.small()
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.add_photo_alternate_outlined,
                      color: Colors.white,
                      size: AppDimens.sdp(context, '_26sdp'),
                    ),
                    SizedBox(height: AppDimens.sdp(context, '_6sdp')),
                    Text(
                      AppStrings.sareeSliderSplitUploadLabel,
                      textAlign: TextAlign.center,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_13ssp'),
                      ),
                    ),
                    SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                    Text(
                      AppStrings.sareeSliderSplitUploadHint,
                      textAlign: TextAlign.center,
                      style: AppTextStyles.regular.copyWith(
                        color: AppColors.textSecondary,
                        fontSize: AppDimens.ssp(context, '_10ssp'),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _buildSplitEditor(BuildContext context) {
    final radiusValue = AppDimens.sdp(context, '_14sdp');
    return Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_12sdp')),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(radiusValue),
        border: Border.all(color: AppColors.fieldBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: AppDimens.sdp(context, '_240sdp'),
              ),
              child: AspectRatio(
                aspectRatio: _naturalWidth / _naturalHeight,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(
                    AppDimens.sdp(context, '_10sdp'),
                  ),
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final areaHeight = constraints.maxHeight;
                      final splitY = areaHeight * _splitRatio;
                      return GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onPanDown: (d) =>
                            _updateSplitRatio(d.localPosition.dy, areaHeight),
                        onPanUpdate: (d) =>
                            _updateSplitRatio(d.localPosition.dy, areaHeight),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Image.memory(_photoBytes!, fit: BoxFit.cover),
                            Positioned(
                              left: 0,
                              right: 0,
                              top: 0,
                              height: splitY,
                              child: Container(
                                color: Colors.black.withValues(alpha: 0.18),
                              ),
                            ),
                            Positioned(
                              left: 0,
                              right: 0,
                              top: splitY - 1,
                              child: Container(
                                height: 2,
                                color: AppColors.success,
                              ),
                            ),
                            Positioned(
                              top: splitY - AppDimens.sdp(context, '_8sdp'),
                              left: 0,
                              right: 0,
                              child: Center(
                                child: Container(
                                  width: AppDimens.sdp(context, '_40sdp'),
                                  height: AppDimens.sdp(context, '_16sdp'),
                                  decoration: BoxDecoration(
                                    color: AppColors.success,
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(
                                      color: Colors.white,
                                      width: 2,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            Positioned(
                              left: AppDimens.sdp(context, '_8sdp'),
                              top: AppDimens.sdp(context, '_8sdp'),
                              child: const _SplitRegionTag(label: 'Body'),
                            ),
                            Positioned(
                              left: AppDimens.sdp(context, '_8sdp'),
                              bottom: AppDimens.sdp(context, '_8sdp'),
                              child: const _SplitRegionTag(label: 'Pallu'),
                            ),
                            Positioned(
                              top: AppDimens.sdp(context, '_6sdp'),
                              right: AppDimens.sdp(context, '_38sdp'),
                              child: _RoundIconButton(
                                icon: Icons.rotate_right_rounded,
                                loading: _rotating,
                                onTap: _rotating ? null : _rotate,
                              ),
                            ),
                            Positioned(
                              top: AppDimens.sdp(context, '_6sdp'),
                              right: AppDimens.sdp(context, '_6sdp'),
                              child: _RoundIconButton(
                                icon: Icons.close_rounded,
                                onTap: _resetAll,
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          Text(
            AppStrings.sareeSliderSplitDragHint,
            textAlign: TextAlign.center,
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_10ssp'),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_10sdp')),
          Center(
            child: GradientButton(
              label: _splitting
                  ? AppStrings.sareeSliderSplitProcessingLabel
                  : AppStrings.sareeSliderSplitConfirmLabel,
              isLoading: _splitting,
              onPressed: (_splitting || _rotating) ? null : _confirmSplit,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConfirmedPreview(BuildContext context) {
    final radiusValue = AppDimens.sdp(context, '_14sdp');
    return DashedBorderContainer(
      borderRadius: radiusValue,
      child: Container(
        padding: EdgeInsets.all(AppDimens.sdp(context, '_8sdp')),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.03),
          borderRadius: BorderRadius.circular(radiusValue),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _ConfirmedCropTile(
                label: 'Body',
                file: _confirmedBodyFile,
                uploading: widget.isUploadingUpper,
                uploaded: widget.upperUploaded,
              ),
            ),
            SizedBox(width: AppDimens.sdp(context, '_10sdp')),
            Expanded(
              child: _ConfirmedCropTile(
                label: 'Pallu',
                file: _confirmedPalluFile,
                uploading: widget.isUploadingPallu,
                uploaded: widget.palluUploaded,
              ),
            ),
            SizedBox(width: AppDimens.sdp(context, '_8sdp')),
            _RoundIconButton(icon: Icons.close_rounded, onTap: _resetAll),
          ],
        ),
      ),
    );
  }
}

class _SplitRegionTag extends StatelessWidget {
  const _SplitRegionTag({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: AppDimens.sdp(context, '_8sdp'),
        vertical: AppDimens.sdp(context, '_2sdp'),
      ),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_6sdp')),
      ),
      child: Text(
        label,
        style: AppTextStyles.semiBold.copyWith(
          color: Colors.white,
          fontSize: AppDimens.ssp(context, '_11ssp'),
        ),
      ),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({
    required this.icon,
    required this.onTap,
    this.loading = false,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      customBorder: const CircleBorder(),
      child: Container(
        width: AppDimens.sdp(context, '_24sdp'),
        height: AppDimens.sdp(context, '_24sdp'),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.55),
          shape: BoxShape.circle,
        ),
        child: loading
            ? const AppLoader.small()
            : Icon(
                icon,
                color: Colors.white,
                size: AppDimens.sdp(context, '_14sdp'),
              ),
      ),
    );
  }
}

class _ConfirmedCropTile extends StatelessWidget {
  const _ConfirmedCropTile({
    required this.label,
    required this.file,
    required this.uploading,
    required this.uploaded,
  });

  final String label;
  final File? file;
  final bool uploading;
  final bool uploaded;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_10sdp'));
    return AspectRatio(
      aspectRatio: 1.05,
      child: ClipRRect(
        borderRadius: radius,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Container(
              color: AppColors.photoThumbnailBackground,
              child: file != null
                  ? Image.file(file!, fit: BoxFit.cover)
                  : null,
            ),
            Positioned(
              left: AppDimens.sdp(context, '_6sdp'),
              top: AppDimens.sdp(context, '_6sdp'),
              child: _SplitRegionTag(label: label),
            ),
            if (uploading)
              Positioned.fill(
                child: ColoredBox(
                  color: Colors.black38,
                  child: Center(child: const AppLoader.small()),
                ),
              )
            else if (uploaded)
              Positioned(
                top: AppDimens.sdp(context, '_6sdp'),
                right: AppDimens.sdp(context, '_6sdp'),
                child: Icon(
                  Icons.check_circle_rounded,
                  color: AppColors.success,
                  size: AppDimens.sdp(context, '_18sdp'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
