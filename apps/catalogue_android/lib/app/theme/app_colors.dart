import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  static const pinkGradientStart = Color(0xFFDB2691);
  static const pinkGradientEnd = Color(0xFFF76F7A);

  static const pinkGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [pinkGradientStart, pinkGradientEnd],
  );

  static const background = Color(0xFF000000);
  static const textSecondary = Color(0xB3FFFFFF);
  static const fieldFill = Color(0x14FFFFFF);
  static const fieldBorder = Color(0x26FFFFFF);
  static const danger = Color(0xFFFF6B6B);

  /// Positive/success state: successful transactions, paid invoices,
  /// credited amounts.
  static const success = Color(0xFF22C55E);

  /// Tint used for the "catalogue" family of icons/tags (Credit History
  /// activity icons, Tutorials category tags).
  static const violet = Color(0xFF8B5CF6);

  /// Tint used for neutral/informational icons (e.g. refunds) that are
  /// neither the pink brand accent nor the catalogue violet.
  static const infoBlue = Color(0xFF60A5FA);

  /// Tint used for the "Girl" category in Products/My Creations, distinct
  /// from the brand pink and the catalogue violet.
  static const lavender = Color(0xFFB388FF);

  /// Background for dark bottom sheets (option pickers).
  static const sheetBackground = Color(0xFF141414);

  /// Fallback background behind avatar initials when no photo is set.
  static const avatarPlaceholder = Color(0xFF2A2A2A);

  /// Light neutral backing for an uploaded product photo thumbnail (e.g.
  /// "Upload Your Garment"), mimicking a real catalogue photo shot on a
  /// plain white/light background rather than a colored tint.
  static const photoThumbnailBackground = Color(0xFFEDEAE7);
}
