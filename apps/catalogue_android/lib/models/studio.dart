import 'package:flutter/widgets.dart';

/// A selectable thumbnail option in the Catalogue/Motion Studio flows —
/// a model, a look preset, a pose or a motion preset. No real media yet,
/// so each is rendered as a gradient-tinted icon placeholder (same
/// approach as the rest of the app's mock content).
class StudioThumbnail {
  const StudioThumbnail({
    required this.id,
    required this.icon,
    required this.tint,
    this.caption,
  });

  final String id;
  final IconData icon;
  final Color tint;
  final String? caption;
}
