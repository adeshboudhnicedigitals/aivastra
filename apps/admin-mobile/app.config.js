const API_URL = process.env.ADMIN_MOBILE_API_URL || 'https://app.aivastra.com';
const STORAGE_URL = process.env.EXPO_PUBLIC_STORAGE_URL || '';
const ALLOW_CLEARTEXT = process.env.APP_ENV === 'development';
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || 'c1c815e3-1a59-4965-874f-c494e08702b2';
const BUILD_NUMBER = process.env.BUILD_NUMBER || '1';

export default {
  expo: {
    name: 'Ai Vastra Admin',
    slug: 'aivastra-admin-mobile',
    version: '1.0.1',
    scheme: 'aivastra-admin',
    icon: './assets/admin_logo.png',
    splash: {
      image: './assets/admin_logo.png',
      resizeMode: 'contain',
      backgroundColor: '#F8F7FC',
    },
    extra: {
      apiUrl: API_URL,
      storageUrl: STORAGE_URL,
      eas: { projectId: EAS_PROJECT_ID },
    },
    ios: {
      supportsTablet: false,
      buildNumber: BUILD_NUMBER,
    },
    android: {
      package: 'ai.aivastra.admin',
      versionCode: parseInt(BUILD_NUMBER, 10) || 1,
      adaptiveIcon: {
        foregroundImage: './assets/admin_logo.png',
        backgroundColor: '#F8F7FC',
      },
      ...(ALLOW_CLEARTEXT && { usesCleartextTraffic: true }),
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-image-picker',
        {
          photosPermission: 'Allow Ai Vastra Admin to access your photos for uploads.',
        },
      ],
      [
        'expo-media-library',
        {
          photosPermission: 'Allow Ai Vastra Admin to save images to your library.',
          savePhotosPermission: 'Allow Ai Vastra Admin to save images.',
          isAccessMediaLocationEnabled: true,
        },
      ],
    ],
  },
};
