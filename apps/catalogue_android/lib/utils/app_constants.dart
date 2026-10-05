class AppAssets {
  AppAssets._();

  static const logo = 'assets/images/ai_vastra_logo.png';
  static const backgroundGlow = 'assets/images/app_bg.png';

  /// The Splash page's own background — two soft arc glows (top-left blue,
  /// bottom-right purple), distinct from [backgroundGlow]'s single centered
  /// blob used everywhere else. Onboarding uses this one too, to read as a
  /// continuation of the splash moment rather than jumping straight to the
  /// app-shell look.
  static const splashBackground = 'assets/images/splash_screen_bg.png';

  static const onboardingImage1 = 'assets/images/onboarding_img_1.png';
  static const onboardingImage2 = 'assets/images/onboarding_img_2.png';
  static const onboardingImage3 = 'assets/images/onboarding_img_3.png';

  // "Catalogue For" avatars — matches the web app's own per-gender
  // illustrations (studio/page.tsx's GENDERS, seg-women/men/boy/girl.png),
  // since the API has no per-gender photo to fetch (gender isn't a
  // catalog-driven concept, just four fixed values).
  static const genderWomen = 'assets/images/gender_women.png';
  static const genderMen = 'assets/images/gender_men.png';
  static const genderBoy = 'assets/images/gender_boy.png';
  static const genderGirl = 'assets/images/gender_girl.png';

  static const googleIcon = 'assets/icons/google_icon.svg';
  static const emailIcon = 'assets/icons/email_icon.svg';
  static const lockIcon = 'assets/icons/lock_icon.svg';
  static const profileIcon = 'assets/icons/profile_icon.svg';
  static const homeIcon = 'assets/icons/home_icon.svg';
  static const catalogueIcon = 'assets/icons/catalogue_icon.svg';
  static const studioIcon = 'assets/icons/studio_icon.svg';
  static const creditIcon = 'assets/icons/credit_icon.svg';
  static const addCreditsIcon = 'assets/icons/add_credits_icon.svg';
  static const notificationIcon = 'assets/icons/notification_icon.svg';
  static const productsIcon = 'assets/icons/products_icon.svg';
  static const myCreationsIcon = 'assets/icons/my_creations_icon.svg';
  static const expandIcon = 'assets/icons/expand_ic.svg';
}
