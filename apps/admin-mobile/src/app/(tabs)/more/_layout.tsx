import { Stack } from 'expo-router';
import { useAppTheme } from '../../../store/theme';

export default function MoreLayout() {
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
      <Stack.Screen name="users" options={{ headerShown: false }} />
      <Stack.Screen name="workflows" options={{ headerShown: false }} />
      <Stack.Screen name="recycle-bin" options={{ title: 'Recycle Bin' }} />
      <Stack.Screen name="workers" options={{ title: 'Workers' }} />
      <Stack.Screen name="settings" options={{ title: 'Credit Plans' }} />
      <Stack.Screen name="config" options={{ title: 'System Config' }} />
      <Stack.Screen name="tryon" options={{ headerShown: false }} />
      <Stack.Screen name="saree" options={{ headerShown: false }} />
      <Stack.Screen name="contacts" options={{ headerShown: false }} />
    </Stack>
  );
}
