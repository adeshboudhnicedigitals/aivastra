import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/app_routes.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/application/auth_providers.dart';
import '../features/studio/application/studio_reference_providers.dart';
import '../utils/app_strings.dart';
import '../widgets/credits_badge.dart';
import '../widgets/detail_page_widgets.dart';

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final horizontalPadding = AppDimens.sdp(context, '_16sdp');
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');
    final sectionGap = AppDimens.sdp(context, '_34sdp');

    // No SafeArea here: HomePage's own SafeArea already reserves the top
    // inset for every tab, so an extra one here was redundant.
    //
    // heightFactor: 1 makes Center shrink-wrap to its child's height.
    // Without it, Center expands to fill all available height and then
    // vertically centers its child within that, which pushed "My Profile"
    // ~130dp down from the top instead of sitting right below the status
    // bar (the same class of bug fixed earlier in AppBottomNavBar).
    return Center(
      heightFactor: 1,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            horizontalPadding,
            AppDimens.sdp(context, '_16sdp'),
            horizontalPadding,
            AppDimens.sdp(context, '_112sdp'),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _ProfileHeader(),
              SizedBox(height: sectionGap),
              const _UserCard(),
              SizedBox(height: sectionGap),
              const _SectionLabel(AppStrings.accountSection),
              SizedBox(height: AppDimens.sdp(context, '_10sdp')),
              _ProfileCard(
                children: [
                  _ProfileMenuTile(
                    icon: Icons.person_outline_rounded,
                    title: AppStrings.profileAndPreferences,
                    subtitle: AppStrings.profileAndPreferencesSubtitle,
                    onTap: () => context.push(AppRoutes.profilePreferences),
                  ),
                ],
              ),
              SizedBox(height: sectionGap),
              const _SectionLabel(AppStrings.creditsAndBillingSection),
              SizedBox(height: AppDimens.sdp(context, '_10sdp')),
              _ProfileCard(
                children: [
                  _ProfileMenuTile(
                    icon: Icons.credit_card_outlined,
                    title: AppStrings.plansAndBilling,
                    subtitle: AppStrings.plansAndBillingSubtitle,
                    onTap: () => context.push(AppRoutes.plansBilling),
                  ),
                  _ProfileMenuTile(
                    icon: Icons.history_rounded,
                    title: AppStrings.creditHistory,
                    subtitle: AppStrings.creditHistorySubtitle,
                    onTap: () => context.push(AppRoutes.creditHistory),
                  ),
                  _ProfileMenuTile(
                    icon: Icons.receipt_long_outlined,
                    title: AppStrings.invoices,
                    subtitle: AppStrings.invoicesSubtitle,
                    onTap: () => context.push(AppRoutes.invoices),
                  ),
                ],
              ),
              SizedBox(height: sectionGap),
              const _SectionLabel(AppStrings.supportSection),
              SizedBox(height: AppDimens.sdp(context, '_10sdp')),
              _ProfileCard(
                children: [
                  _ProfileMenuTile(
                    icon: Icons.play_circle_outline_rounded,
                    title: AppStrings.tutorials,
                    subtitle: AppStrings.tutorialsSubtitle,
                    onTap: () => context.push(AppRoutes.tutorials),
                  ),
                  _ProfileMenuTile(
                    icon: Icons.support_agent_rounded,
                    title: AppStrings.contactUs,
                    subtitle: AppStrings.contactUsSubtitle,
                    onTap: () => context.push(AppRoutes.contactUs),
                  ),
                ],
              ),
              SizedBox(height: sectionGap),
              const _LogoutButton(),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader();

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                AppStrings.myProfile,
                style: AppTextStyles.bold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_22ssp'),
                ),
              ),
              SizedBox(height: AppDimens.sdp(context, '_4sdp')),
              Text(
                AppStrings.manageAccountSubtitle,
                style: AppTextStyles.regular.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ],
          ),
        ),
        SizedBox(width: AppDimens.sdp(context, '_12sdp')),
        Consumer(
          builder: (context, ref, _) {
            final credits = ref.watch(creditsSummaryProvider).value;
            return CreditsBadge(credits: credits?.balance);
          },
        ),
      ],
    );
  }
}

class _UserCard extends ConsumerWidget {
  const _UserCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final avatarRadius = AppDimens.sdp(context, '_28sdp');
    final user = ref.watch(currentUserProvider);
    final profile = ref.watch(currentProfileProvider);
    final displayName =
        profile?.displayName ??
        user?.displayName ??
        AppStrings.placeholderUserName;
    final email =
        profile?.email ?? user?.email ?? AppStrings.placeholderUserEmail;
    final tier = profile?.tier ?? user?.tier;
    final initials = _initialsOf(displayName);

    return Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_16sdp')),
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_20sdp')),
        border: Border.all(color: AppColors.fieldBorder),
      ),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              CircleAvatar(
                radius: avatarRadius,
                backgroundColor: const Color(0xFF2A2A2A),
                child: Text(
                  initials,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_16ssp'),
                  ),
                ),
              ),
              Positioned(
                bottom: -2,
                right: -2,
                child: Container(
                  padding: EdgeInsets.all(AppDimens.sdp(context, '_4sdp')),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A1A),
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.background, width: 2),
                  ),
                  child: Icon(
                    Icons.camera_alt_outlined,
                    size: AppDimens.sdp(context, '_12sdp'),
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(width: AppDimens.sdp(context, '_14sdp')),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  displayName,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_15ssp'),
                  ),
                ),
                SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                Text(
                  email,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_12ssp'),
                  ),
                ),
                SizedBox(height: AppDimens.sdp(context, '_8sdp')),
                Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: AppDimens.sdp(context, '_10sdp'),
                    vertical: AppDimens.sdp(context, '_4sdp'),
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(
                      AppDimens.sdp(context, '_20sdp'),
                    ),
                    gradient: const LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [
                        AppColors.pinkGradientStart,
                        AppColors.pinkGradientEnd,
                      ],
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.workspace_premium_rounded,
                        size: AppDimens.sdp(context, '_12sdp'),
                        color: Colors.white,
                      ),
                      SizedBox(width: AppDimens.sdp(context, '_4sdp')),
                      Text(
                        tier ?? AppStrings.proPlan,
                        style: AppTextStyles.semiBold.copyWith(
                          color: Colors.white,
                          fontSize: AppDimens.ssp(context, '_11ssp'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Icon(
            Icons.chevron_right_rounded,
            color: AppColors.textSecondary,
            size: AppDimens.sdp(context, '_20sdp'),
          ),
        ],
      ),
    );
  }

  String _initialsOf(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppTextStyles.semiBold.copyWith(
        color: AppColors.textSecondary,
        fontSize: AppDimens.ssp(context, '_11ssp'),
        letterSpacing: 0.6,
      ),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.fieldFill,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_18sdp')),
        border: Border.all(color: AppColors.fieldBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(height: 1, color: AppColors.fieldBorder),
            children[i],
          ],
        ],
      ),
    );
  }
}

class _ProfileMenuTile extends StatelessWidget {
  const _ProfileMenuTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: AppTextStyles.semiBold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(context, '_13ssp'),
                    ),
                  ),
                  SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                  Text(
                    subtitle,
                    style: AppTextStyles.regular.copyWith(
                      color: AppColors.textSecondary,
                      fontSize: AppDimens.ssp(context, '_11ssp'),
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              color: AppColors.textSecondary,
              size: AppDimens.sdp(context, '_18sdp'),
            ),
          ],
        ),
      ),
    );
  }
}

/// A tap on Logout is destructive and instant (no undo), so it's confirmed
/// first rather than signing the user out immediately.
Future<bool> _confirmLogout(BuildContext context) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => Dialog(
      backgroundColor: AppColors.sheetBackground,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(
          AppDimens.sdp(dialogContext, '_20sdp'),
        ),
      ),
      child: Padding(
        padding: EdgeInsets.all(AppDimens.sdp(dialogContext, '_24sdp')),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              AppStrings.logoutConfirmTitle,
              style: AppTextStyles.bold.copyWith(
                color: Colors.white,
                fontSize: AppDimens.ssp(dialogContext, '_18ssp'),
              ),
            ),
            SizedBox(height: AppDimens.sdp(dialogContext, '_10sdp')),
            Text(
              AppStrings.logoutConfirmBody,
              style: AppTextStyles.regular.copyWith(
                color: AppColors.textSecondary,
                fontSize: AppDimens.ssp(dialogContext, '_14ssp'),
              ),
            ),
            SizedBox(height: AppDimens.sdp(dialogContext, '_24sdp')),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: Text(
                    AppStrings.cancel,
                    style: AppTextStyles.semiBold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(dialogContext, '_14ssp'),
                    ),
                  ),
                ),
                SizedBox(width: AppDimens.sdp(dialogContext, '_8sdp')),
                AppPillButton(
                  label: AppStrings.logoutConfirmAction,
                  onTap: () => Navigator.of(dialogContext).pop(true),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
  return result ?? false;
}

class _LogoutButton extends ConsumerWidget {
  const _LogoutButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_20sdp'));

    return Material(
      color: AppColors.danger.withValues(alpha: 0.08),
      borderRadius: radius,
      child: InkWell(
        borderRadius: radius,
        onTap: () async {
          final confirmed = await _confirmLogout(context);
          if (!confirmed || !context.mounted) return;
          await ref.read(authControllerProvider.notifier).logout();
          if (context.mounted) context.go(AppRoutes.login);
        },
        child: Container(
          padding: EdgeInsets.symmetric(
            vertical: AppDimens.sdp(context, '_16sdp'),
          ),
          decoration: BoxDecoration(
            borderRadius: radius,
            border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.logout_rounded,
                color: AppColors.danger,
                size: AppDimens.sdp(context, '_18sdp'),
              ),
              SizedBox(width: AppDimens.sdp(context, '_8sdp')),
              Text(
                AppStrings.logOut,
                style: AppTextStyles.semiBold.copyWith(
                  color: AppColors.danger,
                  fontSize: AppDimens.ssp(context, '_14ssp'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
