import { Stack } from 'expo-router';
import { useAppTheme } from '../../../../store/theme';
export default function Layout() {
  const { colors } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="add" options={{ title: 'Add Pose Asset' }} />
      <Stack.Screen name="[id]" options={{ title: 'Pose Asset' }} />
    </Stack>
  );
}
