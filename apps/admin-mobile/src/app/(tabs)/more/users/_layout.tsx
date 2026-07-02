import { Stack } from 'expo-router';
import { useAppTheme } from '../../../../store/theme';

export default function UsersLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Users' }} />
      <Stack.Screen name="[id]" options={{ title: 'User' }} />
    </Stack>
  );
}
