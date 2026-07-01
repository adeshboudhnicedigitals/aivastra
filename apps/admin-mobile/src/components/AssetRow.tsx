import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

export function AssetRow({
  thumbnailUri,
  label,
  subtitle,
  badge,
  badgeColor,
  isActive,
  selected,
  onPress,
}: {
  thumbnailUri?: string | null;
  label: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  isActive: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const showCheckbox = selected !== undefined;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderColor: selected ? colors.accent : colors.border },
        !isActive && styles.inactive,
        selected && styles.selected,
      ]}
    >
      {showCheckbox ? (
        <MaterialCommunityIcons
          color={selected ? colors.accent : colors.textMuted}
          name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
          size={24}
        />
      ) : null}
      {thumbnailUri ? (
        <Image contentFit="cover" source={{ uri: thumbnailUri }} style={styles.thumbnail} />
      ) : (
        <View
          style={[styles.thumbnail, styles.placeholder, { backgroundColor: colors.surfaceVariant }]}
        >
          <MaterialCommunityIcons color={colors.textMuted} name="image-outline" size={20} />
        </View>
      )}
      <View style={styles.content}>
        <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>
          {label}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.subtitle, { color: colors.textSecondary }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: badgeColor ?? colors.surfaceVariant }]}>
          <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{badge}</Text>
        </View>
      ) : null}
      {!showCheckbox ? (
        <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={22} />
      ) : null}
    </TouchableOpacity>
  );
}
const styles = StyleSheet.create({
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  inactive: { opacity: 0.5 },
  selected: { borderWidth: 2 },
  thumbnail: { width: 42, height: 42, borderRadius: Radius.md },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0 },
  label: { ...Typography.bodyBold },
  subtitle: { ...Typography.caption, marginTop: 2 },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.label },
});
