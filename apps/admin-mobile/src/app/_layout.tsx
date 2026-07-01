import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Toast } from '../components/Toast';
import { useAuthStore } from '../store/auth';
import { useAppTheme, useThemeStore } from '../store/theme';

function AuthGate({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const isLoading = useAuthStore((state) => state.isLoading);
  const segments = useSegments();
  const router = useRouter();
  const { colors } = useAppTheme();

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!token && !inAuthGroup) router.replace('/(auth)/login');
    else if (token && inAuthGroup) router.replace('/(tabs)/home');
  }, [token, isLoading, segments, router]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && token) void useAuthStore.getState().bootstrap();
    });
    return () => subscription.remove();
  }, [token]);

  if (isLoading)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  return <>{children}</>;
}

export default function RootLayout() {
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const loadTheme = useThemeStore((state) => state.load);
  const { colors, isDark } = useAppTheme();
  useEffect(() => {
    void bootstrap();
    void loadTheme();
  }, [bootstrap, loadTheme]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AuthGate>
        <Slot />
      </AuthGate>
      <Toast />
    </GestureHandlerRootView>
  );
}
