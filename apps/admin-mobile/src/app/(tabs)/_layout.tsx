import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { canAccessAssets } from '../../lib/roles';
import { useAuthStore } from '../../store/auth';
import { useAppTheme } from '../../store/theme';
import { Typography } from '../../styles/tokens';

const ICONS = {
  home: 'view-dashboard-outline',
  jobs: 'progress-wrench',
  assets: 'image-multiple-outline',
  more: 'dots-grid',
} as const;

export default function TabsLayout() {
  const role = useAuthStore((state) => state.role);
  const { colors } = useAppTheme();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { ...Typography.h3 },
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          position: 'absolute',
          height: 72,
          paddingTop: 8,
          paddingBottom: 10,
          marginHorizontal: 16,
          marginBottom: 12,
          borderRadius: 24,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: colors.glass,
          elevation: 10,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { ...Typography.label },
        tabBarIcon: ({ color, size }) => (
          <MaterialCommunityIcons
            color={color}
            name={ICONS[route.name as keyof typeof ICONS] ?? 'circle-outline'}
            size={size + 2}
          />
        ),
      })}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', headerShown: false }} />
      <Tabs.Screen name="jobs" options={{ title: 'Jobs', headerTitle: 'Job operations' }} />
      <Tabs.Screen
        name="assets"
        options={{
          title: 'Assets',
          headerShown: false,
          href: canAccessAssets(role) ? undefined : null,
        }}
      />
      <Tabs.Screen name="more" options={{ title: 'More', headerTitle: 'Admin tools' }} />
    </Tabs>
  );
}
