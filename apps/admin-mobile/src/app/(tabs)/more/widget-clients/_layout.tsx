import { Stack } from 'expo-router';
import { useAppTheme } from '../../../../store/theme';

export default function WidgetClientsLayout() {
  const { colors } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bgSecondary },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Widget Clients' }} />
      <Stack.Screen name="[id]" options={{ title: 'Widget Client' }} />
    </Stack>
  );
}
