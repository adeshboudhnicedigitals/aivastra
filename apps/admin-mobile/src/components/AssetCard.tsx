import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';
import type { CategoryTag } from '../types';
export function AssetCard({
  thumbnailUri,
  label,
  isActive,
  selected = false,
  specialTag,
  onPress,
  onLongPress,
}: {
  thumbnailUri: string | null;
  label: string;
  isActive: boolean;
  selected?: boolean;
  specialTag?: CategoryTag | null;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const cardWidth = (width - Spacing.lg * 2 - Spacing.md) / 2;
  const tagLabel = specialTag ? specialTag.charAt(0).toUpperCase() + specialTag.slice(1) : null;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.8}
      onLongPress={onLongPress}
      onPress={onPress}
      style={[
        styles.card,
        {
          width: cardWidth,
          backgroundColor: colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        selected && styles.selected,
      ]}
    >
      <View style={[styles.imageShell, { backgroundColor: colors.surfaceVariant }]}>
        {thumbnailUri ? (
          <Image contentFit="cover" source={{ uri: thumbnailUri }} style={styles.image} />
        ) : (
          <MaterialCommunityIcons color={colors.textMuted} name="image-off-outline" size={34} />
        )}
        {!isActive ? (
          <View style={styles.overlay}>
            <Text style={styles.inactive}>Inactive</Text>
          </View>
        ) : null}
        {selected ? (
          <View style={[styles.check, { backgroundColor: colors.accent }]}>
            <MaterialCommunityIcons color={colors.onAccent} name="check" size={17} />
          </View>
        ) : null}
        {tagLabel ? (
          <View style={[styles.tag, { backgroundColor: colors.accentContainer }]}>
            <Text style={[styles.tagLabel, { color: colors.onAccentContainer }]}>{tagLabel}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}
const styles = StyleSheet.create({
  card: { padding: Spacing.sm, borderWidth: 1, borderRadius: Radius.lg, gap: Spacing.sm },
  selected: { borderWidth: 2 },
  imageShell: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: Radius.md,
  },
  image: { width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  inactive: {
    ...Typography.captionBold,
    color: '#FFFFFF',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: Radius.full,
  },
  check: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  tag: {
    position: 'absolute',
    bottom: Spacing.sm,
    left: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  tagLabel: { ...Typography.label, fontSize: 10 },
  label: { ...Typography.captionBold },
});
