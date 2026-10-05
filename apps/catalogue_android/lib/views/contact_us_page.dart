import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/app_exception.dart';
import '../features/auth/application/auth_providers.dart';
import '../features/support/support_providers.dart';
import '../utils/app_strings.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/detail_page_widgets.dart';
import '../widgets/gradient_button.dart';

class ContactUsPage extends ConsumerStatefulWidget {
  const ContactUsPage({super.key});

  @override
  ConsumerState<ContactUsPage> createState() => _ContactUsPageState();
}

// Same contact details and social links as the web app's Contact Us page.
const _supportPhone = '+91 7729883692';

class _ContactUsPageState extends ConsumerState<ContactUsPage> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _messageController = TextEditingController();

  bool _prefilled = false;
  bool _sending = false;
  String? _error;

  static const _socialLinks = [
    _SocialLink(
      icon: FontAwesomeIcons.facebookF,
      url: 'https://www.facebook.com/Aivastra/',
    ),
    _SocialLink(
      icon: FontAwesomeIcons.linkedinIn,
      url: 'https://www.linkedin.com/company/aivastra/',
    ),
    _SocialLink(
      icon: FontAwesomeIcons.youtube,
      url: 'https://www.youtube.com/@ai.vastra_tryon',
    ),
    _SocialLink(
      icon: FontAwesomeIcons.instagram,
      url: 'https://www.instagram.com/ai_vastra/',
    ),
  ];

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  /// Fills name / email / phone from the signed-in profile, once.
  void _prefill() {
    final profile = ref.read(currentProfileProvider);
    if (_prefilled || profile == null) return;
    _prefilled = true;
    _nameController.text = profile.displayName ?? '';
    _emailController.text = profile.email ?? '';
    _phoneController.text = profile.phone ?? '';
  }

  Future<void> _open(String url) async {
    final ok = await launchUrl(
      Uri.parse(url),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open that link.')),
      );
    }
  }

  static String _messageOf(AppException e) => e.when(
    badRequest: (m) => m,
    unauthorized: (m) => m,
    emailNotVerified: (m) => m,
    forbidden: (m) => m,
    deviceLimitReached: (m, _, _, _) => m,
    invalidRefresh: (m) => m,
    rateLimited: (m) =>
        'You are sending messages too fast. Please wait a moment.',
    network: (m) => m,
    server: (m) => m,
    unknown: (m) => m,
  );

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    final email = _emailController.text.trim();
    final phone = _phoneController.text.trim();
    final message = _messageController.text.trim();

    // Same checks as the web form.
    String? error;
    if (name.isEmpty) {
      error = 'Please enter your full name.';
    } else if (email.isEmpty || !email.contains('@')) {
      error = 'Please enter a valid email address.';
    } else if (phone.replaceAll(RegExp(r'\D'), '').length < 10) {
      error = 'Please enter a valid 10-digit phone number.';
    }
    if (error != null) {
      setState(() => _error = error);
      return;
    }

    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(contactSubmitterProvider)(
        name: name,
        email: email,
        phone: phone,
        message: message.isEmpty ? null : message,
      );
      if (!mounted) return;
      _messageController.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Message sent. Our team will get back to you soon.'),
        ),
      );
    } on AppException catch (e) {
      if (mounted) setState(() => _error = _messageOf(e));
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Failed to send message. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    _prefill();
    final rowGap = AppDimens.sdp(context, '_12sdp');
    final sectionGap = AppDimens.sdp(context, '_24sdp');
    final fieldGap = AppDimens.sdp(context, '_16sdp');
    final labelGap = AppDimens.sdp(context, '_10sdp');

    return DetailPageScaffold(
      title: AppStrings.contactUs,
      subtitle: AppStrings.contactUsPageSubtitle,
      children: [
        CardContainer(
          children: [
            _ContactInfoRow(
              icon: Icons.mail_outline_rounded,
              label: AppStrings.email,
              value: AppStrings.supportEmailValue,
              onTap: () => _open('mailto:${AppStrings.supportEmailValue}'),
            ),
          ],
        ),
        SizedBox(height: rowGap),
        CardContainer(
          children: [
            _ContactInfoRow(
              icon: Icons.phone_outlined,
              label: AppStrings.phoneLabel,
              value: _supportPhone,
              onTap: () => _open('tel:${_supportPhone.replaceAll(' ', '')}'),
            ),
          ],
        ),
        SizedBox(height: sectionGap),
        const SectionLabel(AppStrings.sendUsMessageSection),
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
              ),
              SizedBox(height: fieldGap),
              AppTextField(
                label: AppStrings.emailAddress,
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
              ),
              SizedBox(height: fieldGap),
              AppTextField(
                label: AppStrings.phoneNumber,
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                maxLength: 15,
              ),
              SizedBox(height: fieldGap),
              AppTextField(
                label: AppStrings.yourMessage,
                controller: _messageController,
                hint: AppStrings.typeMessageHint,
                maxLines: 5,
                maxLength: 300,
              ),
              if (_error != null) ...[
                SizedBox(height: fieldGap),
                InlineErrorBanner(message: _error!),
              ],
              SizedBox(height: AppDimens.sdp(context, '_4sdp')),
              GradientButton(
                label: AppStrings.submitMessage,
                isLoading: _sending,
                onPressed: _sending ? null : _submit,
                icon: Icon(
                  Icons.send_rounded,
                  color: Colors.white,
                  size: AppDimens.sdp(context, '_16sdp'),
                ),
                iconPosition: GradientButtonIconPosition.trailing,
              ),
            ],
          ),
        ),
        SizedBox(height: sectionGap),
        Text(
          AppStrings.followUsOn,
          textAlign: TextAlign.center,
          style: AppTextStyles.medium.copyWith(
            color: AppColors.textSecondary,
            fontSize: AppDimens.ssp(context, '_12ssp'),
          ),
        ),
        SizedBox(height: AppDimens.sdp(context, '_12sdp')),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < _socialLinks.length; i++) ...[
              _SocialButton(
                link: _socialLinks[i],
                onTap: () => _open(_socialLinks[i].url),
              ),
              if (i != _socialLinks.length - 1)
                SizedBox(width: AppDimens.sdp(context, '_14sdp')),
            ],
          ],
        ),
      ],
    );
  }
}

class _ContactInfoRow extends StatelessWidget {
  const _ContactInfoRow({
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
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_13ssp'),
                  ),
                ),
                SizedBox(height: AppDimens.sdp(context, '_2sdp')),
                Text(
                  value,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_11ssp'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SocialLink {
  const _SocialLink({required this.icon, required this.url});

  final FaIconData icon;
  final String url;
}

class _SocialButton extends StatelessWidget {
  const _SocialButton({required this.link, required this.onTap});

  final _SocialLink link;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final size = AppDimens.sdp(context, '_40sdp');

    return Material(
      // A solid dark circle (not the barely-visible fieldFill tint every
      // other icon badge uses) — this one sits over the page's own glow
      // background rather than a card, so a faint fill disappeared into it.
      color: Colors.black.withValues(alpha: 0.35),
      shape: CircleBorder(side: BorderSide(color: AppColors.fieldBorder)),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: size,
          height: size,
          // Explicitly centered — FontAwesome glyphs sit off-centre in their
          // own bounding box, so without this they visually drift toward the
          // top-left of the circle.
          child: Center(
            child: FaIcon(
              link.icon,
              color: Colors.white,
              size: AppDimens.sdp(context, '_16sdp'),
            ),
          ),
        ),
      ),
    );
  }
}
