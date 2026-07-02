import { Stack } from 'expo-router';
import { useAppTheme } from '../../../store/theme';

export default function AssetsLayout() {
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
      <Stack.Screen name="faces" options={{ headerShown: false }} />
      <Stack.Screen name="backgrounds" options={{ headerShown: false }} />
      <Stack.Screen name="garment-types" options={{ headerShown: false }} />
      <Stack.Screen name="pose-assets" options={{ headerShown: false }} />
      <Stack.Screen name="poses" options={{ headerShown: false }} />
      <Stack.Screen name="catalog" options={{ headerShown: false }} />
    </Stack>
  );
}
