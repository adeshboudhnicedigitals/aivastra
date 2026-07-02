import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

export type AssetTabKey =
  | 'garment-types'
  | 'faces'
  | 'backgrounds'
  | 'pose-assets'
  | 'lower'
  | 'shoe';

// Mirrors apps/admin-web/src/pages/AssetsPage.tsx's TABS — same 6 sections, same order,
// same default ('garment-types').
const TABS: { key: AssetTabKey; label: string }[] = [
  { key: 'garment-types', label: 'Garment Types' },
  { key: 'faces', label: 'Model Faces' },
  { key: 'backgrounds', label: 'Backgrounds' },
  { key: 'pose-assets', label: 'Pose Assets' },
  { key: 'lower', label: 'Lower garments' },
  { key: 'shoe', label: 'Shoes' },
];

function routeFor(key: AssetTabKey) {
  if (key === 'lower' || key === 'shoe') {
    return { pathname: '/(tabs)/assets/catalog' as const, params: { type: key } };
  }
  return { pathname: `/(tabs)/assets/${key}` as const };
}

export function AssetsTabBar({ active }: { active: AssetTabKey }) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { top } = useSafeAreaInsets();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.row, { paddingTop: top + Spacing.sm }]}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            // biome-ignore lint/suspicious/noExplicitAny: expo-router href typing doesn't narrow across the union built in routeFor
            onPress={() => router.replace(routeFor(tab.key) as any)}
            style={[
              styles.chip,
              {
                backgroundColor: isActive ? colors.accent : colors.surfaceVariant,
                borderColor: isActive ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[styles.label, { color: isActive ? colors.onAccent : colors.textSecondary }]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  label: { ...Typography.captionBold },
});
