import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/app_exception.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/application/auth_providers.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/gradient_button.dart';

// Same rules the server (and the web settings page) enforce.
final _phoneRegex = RegExp(r'^\d{10}$');
final _gstinRegex = RegExp(
  r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
);

/// Profile & Preferences, wired to `GET/PATCH /v1/me` (the same endpoints as
/// the web app's settings page) and `PATCH /v1/me/password`.
class ProfilePreferencesPage extends ConsumerStatefulWidget {
  const ProfilePreferencesPage({super.key});

  @override
  ConsumerState<ProfilePreferencesPage> createState() =>
      _ProfilePreferencesPageState();
}

class _ProfilePreferencesPageState
    extends ConsumerState<ProfilePreferencesPage> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _companyController = TextEditingController();
  final _gstinController = TextEditingController();

  String _platform = 'Amazon';
  String _aspectRatio = '1:1';
  String _resolution = 'HD';

  bool _prefilled = false;
  bool _emailEditable = false;
  bool _saving = false;
  String? _nameError;
  String? _phoneError;
  String? _gstinError;

  // Allowed values, straight from the server's schema / the web settings page.
  static const _platformOptions = [
    'Amazon',
    'Flipkart',
    'Myntra',
    'AJIO',
    'Meesho',
    'Nykaa Fashion',
    'Shopify',
  ];
  static const _aspectRatioOptions = ['1:1', '2:3', '3:4', '4:5'];
  static const _resolutionOptions = ['HD', '2K', '4K'];

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _companyController.dispose();
    _gstinController.dispose();
    super.dispose();
  }

  /// Fills the form from the loaded profile - once, so later profile
  /// refreshes never overwrite what the user is typing.
  void _prefill() {
    final profile = ref.read(currentProfileProvider);
    if (_prefilled || profile == null) return;
    _prefilled = true;
    _nameController.text = profile.displayName ?? '';
    _emailController.text = profile.email ?? '';
    // Once an email is on file it can't be changed here (same as web).
    _emailEditable = (profile.email ?? '').isEmpty;
    _phoneController.text = profile.phone ?? '';
    _companyController.text = profile.companyName ?? '';
    _gstinController.text = profile.gstin ?? '';
    if (_platformOptions.contains(profile.defaultPlatform)) {
      _platform = profile.defaultPlatform!;
    }
    if (_aspectRatioOptions.contains(profile.defaultAspectRatio)) {
      _aspectRatio = profile.defaultAspectRatio!;
    }
    if (_resolutionOptions.contains(profile.defaultResolution)) {
      _resolution = profile.defaultResolution!;
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  static String _messageOf(AppException e) => e.when(
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

  Future<void> _pickOption({
    required String title,
    required List<String> options,
    required String selected,
    required ValueChanged<String> onSelected,
  }) async {
    final result = await pickOptionSheet(
      context,
      title: title,
      options: options,
      selected: selected,
    );
    if (result != null) onSelected(result);
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    final phone = _phoneController.text.trim();
    final gstin = _gstinController.text.trim().toUpperCase();
    final email = _emailController.text.trim();

    setState(() {
      _nameError = name.isEmpty ? 'Enter your name' : null;
      _phoneError = phone.isNotEmpty && !_phoneRegex.hasMatch(phone)
          ? 'Enter a 10-digit mobile number'
          : null;
      _gstinError = gstin.isNotEmpty && !_gstinRegex.hasMatch(gstin)
          ? 'Invalid GSTIN format'
          : null;
    });
    if (_nameError != null || _phoneError != null || _gstinError != null) {
      return;
    }

    final company = _companyController.text.trim();
    setState(() => _saving = true);
    try {
      await ref.read(authControllerProvider.notifier).updateProfile({
        'displayName': name,
        // Only sent while no email is on file - the server has no rule against
        // changing one, but the app follows the web app here.
        if (_emailEditable && email.isNotEmpty) 'email': email,
        // Explicit null clears a field on the server (phone / companyName
        // accept null); gstin clears with an empty string instead.
        'phone': phone.isEmpty ? null : phone,
        'companyName': company.isEmpty ? null : company,
        'gstin': gstin,
        'defaultResolution': _resolution,
        'defaultAspectRatio': _aspectRatio,
        'defaultPlatform': _platform,
      });
      _toast(AppStrings.profileUpdated);
    } on AppException catch (e) {
      // The server's own words, e.g. "This mobile number is already assigned
      // to another email address."
      _toast(_messageOf(e));
    } catch (_) {
      _toast('Could not save your profile. Please try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _openPasswordSheet(bool hasPassword) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.sheetBackground,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppDimens.sdp(context, '_20sdp')),
        ),
      ),
      builder: (_) => _PasswordSheet(hasPassword: hasPassword),
    );
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(currentProfileProvider);
    _prefill();

    final fieldGap = AppDimens.sdp(context, '_16sdp');
    final sectionGap = AppDimens.sdp(context, '_28sdp');
    final labelGap = AppDimens.sdp(context, '_10sdp');
    final hasPassword = profile?.hasPassword ?? true;

    return DetailPageScaffold(
      title: AppStrings.profilePreferencesTitle,
      subtitle: AppStrings.profilePreferencesSubtitle,
      children: [
        const SectionLabel(AppStrings.accountSection),
        SizedBox(height: labelGap),
        Container(
          padding: EdgeInsets.all(AppDimens.sdp(context, '_16sdp')),
          decoration: BoxDecoration(
            color: AppColors.fieldFill,
            borderRadius: BorderRadius.circular(
              AppDimens.sdp(context, '_20sdp'),
            ),
            border: Border.all(color: AppColors.fieldBorder),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppTextField(
                label: AppStrings.fullName,
                controller: _nameController,
                maxLength: 60,
                errorText: _nameError,
              ),
              SizedBox(height: fieldGap),
              AppTextField(
                label: AppStrings.emailAddress,
                controller: _emailController,
                readOnly: !_emailEditable,
                helperText: _emailEditable
                    ? null
                    : AppStrings.emailCannotBeChanged,
                keyboardType: TextInputType.emailAddress,
              ),
              SizedBox(height: fieldGap),
              AppTextField(
                label: AppStrings.phoneNumber,
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                maxLength: 10,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                errorText: _phoneError,
              ),
              SizedBox(height: fieldGap),
              AppTextField(
                label: AppStrings.companyName,
                controller: _companyController,
                hint: AppStrings.enterCompanyName,
                maxLength: 160,
              ),
              SizedBox(height: fieldGap),
              AppTextField(
                label: AppStrings.gstin,
                controller: _gstinController,
                hint: AppStrings.enterGstin,
                maxLength: 15,
                textCapitalization: TextCapitalization.characters,
                errorText: _gstinError,
              ),
            ],
          ),
        ),
        SizedBox(height: sectionGap),
        const SectionLabel(AppStrings.preferencesSection),
        SizedBox(height: labelGap),
        CardContainer(
          children: [
            _PreferenceRow(
              icon: Icons.public_rounded,
              label: AppStrings.defaultPlatform,
              value: _platform,
              onTap: () => _pickOption(
                title: AppStrings.defaultPlatform,
                options: _platformOptions,
                selected: _platform,
                onSelected: (value) => setState(() => _platform = value),
              ),
            ),
            _PreferenceRow(
              icon: Icons.crop_rounded,
              label: AppStrings.defaultAspectRatio,
              value: _aspectRatio,
              onTap: () => _pickOption(
                title: AppStrings.defaultAspectRatio,
                options: _aspectRatioOptions,
                selected: _aspectRatio,
                onSelected: (value) => setState(() => _aspectRatio = value),
              ),
            ),
            _PreferenceRow(
              icon: Icons.high_quality_rounded,
              label: AppStrings.defaultResolution,
              value: _resolution,
              onTap: () => _pickOption(
                title: AppStrings.defaultResolution,
                options: _resolutionOptions,
                selected: _resolution,
                onSelected: (value) => setState(() => _resolution = value),
              ),
            ),
          ],
        ),
        SizedBox(height: sectionGap),
        GradientButton(
          label: AppStrings.saveChanges,
          isLoading: _saving,
          onPressed: _saving ? null : _save,
        ),
        SizedBox(height: sectionGap),
        const SectionLabel(AppStrings.securitySection),
        SizedBox(height: labelGap),
        CardContainer(
          children: [
            _PasswordRow(
              hasPassword: hasPassword,
              onTap: () => _openPasswordSheet(hasPassword),
            ),
          ],
        ),
      ],
    );
  }
}

class _PreferenceRow extends StatelessWidget {
  const _PreferenceRow({
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final iconBoxSize = AppDimens.sdp(context, '_36sdp');

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
        child: Row(
          children: [
            Container(
              width: iconBoxSize,
              height: iconBoxSize,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(
                  AppDimens.sdp(context, '_10sdp'),
                ),
              ),
              child: Icon(
                icon,
                color: Colors.white,
                size: AppDimens.sdp(context, '_18sdp'),
              ),
            ),
            SizedBox(width: AppDimens.sdp(context, '_12sdp')),
            Expanded(
              child: Text(
                label,
                style: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ),
            SizedBox(width: AppDimens.sdp(context, '_8sdp')),
            DropdownChip(label: value),
          ],
        ),
      ),
    );
  }
}

class _PasswordRow extends StatelessWidget {
  const _PasswordRow({required this.hasPassword, required this.onTap});

  final bool hasPassword;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final iconBoxSize = AppDimens.sdp(context, '_36sdp');

    return Padding(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_14sdp')),
      child: Row(
        children: [
          Container(
            width: iconBoxSize,
            height: iconBoxSize,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(
                AppDimens.sdp(context, '_10sdp'),
              ),
            ),
            child: Icon(
              Icons.lock_outline_rounded,
              color: Colors.white,
              size: AppDimens.sdp(context, '_18sdp'),
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_12sdp')),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  AppStrings.password,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_13ssp'),
                  ),
                ),
                SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                Text(
                  hasPassword
                      ? AppStrings.changePasswordSubtitle
                      : AppStrings.setPasswordSubtitle,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_11ssp'),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
          AppPillButton(
            label: hasPassword
                ? AppStrings.changePassword
                : AppStrings.setPassword,
            onTap: onTap,
          ),
        ],
      ),
    );
  }
}

/// Set / change password. Accounts that already have a password must give the
/// current one (the server enforces it); accounts without one - Google
/// sign-ins - just set a new one. The server drops every session when a
/// password changes, so a successful change signs this device out.
class _PasswordSheet extends ConsumerStatefulWidget {
  const _PasswordSheet({required this.hasPassword});

  final bool hasPassword;

  @override
  ConsumerState<_PasswordSheet> createState() => _PasswordSheetState();
}

class _PasswordSheetState extends ConsumerState<_PasswordSheet> {
  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _showCurrent = false;
  bool _showNew = false;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final current = _currentController.text;
    final next = _newController.text;
    String? error;
    if (widget.hasPassword && current.isEmpty) {
      error = 'Enter your current password.';
    } else if (next.length < 8) {
      error = 'New password must be at least 8 characters.';
    } else if (next != _confirmController.text) {
      error = 'Passwords do not match.';
    }
    if (error != null) {
      setState(() => _error = error);
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      // On success the controller signs this device out, and the router sends
      // the user to the login screen.
      await ref
          .read(authControllerProvider.notifier)
          .changePassword(
            currentPassword: widget.hasPassword ? current : null,
            newPassword: next,
          );
      if (mounted) Navigator.of(context).pop();
    } on AppException catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = _ProfilePreferencesPageState._messageOf(e);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = 'Could not update your password. Please try again.';
        });
      }
    }
  }

  Widget _eye(bool shown, VoidCallback onTap) => IconButton(
    splashRadius: 20,
    icon: Icon(
      shown ? Icons.visibility_outlined : Icons.visibility_off_outlined,
      color: AppColors.textSecondary,
      size: AppDimens.sdp(context, '_20sdp'),
    ),
    onPressed: onTap,
  );

  @override
  Widget build(BuildContext context) {
    final gap = AppDimens.sdp(context, '_14sdp');

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(AppDimens.sdp(context, '_20sdp')),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                widget.hasPassword
                    ? AppStrings.changePassword
                    : AppStrings.setPassword,
                style: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_18ssp'),
                ),
              ),
              SizedBox(height: AppDimens.sdp(context, '_6sdp')),
              Text(
                AppStrings.passwordChangeSignOutNote,
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_12ssp'),
                ),
              ),
              SizedBox(height: AppDimens.sdp(context, '_18sdp')),
              if (widget.hasPassword) ...[
                const FieldLabel(AppStrings.currentPassword),
                SizedBox(height: AppDimens.sdp(context, '_8sdp')),
                AuthTextField(
                  controller: _currentController,
                  hint: AppStrings.enterCurrentPassword,
                  prefixIconAsset: AppAssets.lockIcon,
                  obscureText: !_showCurrent,
                  suffixIcon: _eye(
                    _showCurrent,
                    () => setState(() => _showCurrent = !_showCurrent),
                  ),
                ),
                SizedBox(height: gap),
              ],
              const FieldLabel(AppStrings.newPassword),
              SizedBox(height: AppDimens.sdp(context, '_8sdp')),
              AuthTextField(
                controller: _newController,
                hint: AppStrings.atLeast8Characters,
                prefixIconAsset: AppAssets.lockIcon,
                obscureText: !_showNew,
                suffixIcon: _eye(
                  _showNew,
                  () => setState(() => _showNew = !_showNew),
                ),
              ),
              SizedBox(height: gap),
              const FieldLabel(AppStrings.confirmPassword),
              SizedBox(height: AppDimens.sdp(context, '_8sdp')),
              AuthTextField(
                controller: _confirmController,
                hint: AppStrings.reEnterYourPassword,
                prefixIconAsset: AppAssets.lockIcon,
                obscureText: !_showNew,
              ),
              if (_error != null) ...[
                SizedBox(height: gap),
                InlineErrorBanner(message: _error!),
              ],
              SizedBox(height: AppDimens.sdp(context, '_20sdp')),
              GradientButton(
                label: widget.hasPassword
                    ? AppStrings.changePassword
                    : AppStrings.setPassword,
                isLoading: _saving,
                onPressed: _saving ? null : _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
