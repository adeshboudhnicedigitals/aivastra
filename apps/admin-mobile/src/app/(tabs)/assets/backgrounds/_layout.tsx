import { Stack } from 'expo-router';
import { useAppTheme } from '../../../../store/theme';
export default function BackgroundsLayout() {
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
      <Stack.Screen name="[id]" options={{ title: 'Background' }} />
      <Stack.Screen name="category/[id]" options={{ title: 'Category', headerShown: false }} />
    </Stack>
  );
}
