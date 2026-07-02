import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

export function BackgroundCategoryCard({
  thumbnailUri,
  label,
  itemCount,
  isActive,
  onPress,
  onLongPress,
}: {
  thumbnailUri: string | null;
  label: string;
  itemCount: number;
  isActive: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const cardWidth = (width - Spacing.lg * 2 - Spacing.md) / 2;

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
          borderColor: colors.border,
        },
        !isActive && styles.inactiveCard,
      ]}
    >
      <View style={[styles.imageShell, { backgroundColor: colors.surfaceVariant }]}>
        {thumbnailUri ? (
          <Image contentFit="cover" source={{ uri: thumbnailUri }} style={styles.image} />
        ) : (
          <MaterialCommunityIcons color={colors.textMuted} name="folder-outline" size={40} />
        )}
        {!isActive ? (
          <View style={styles.overlay}>
            <Text style={styles.inactive}>Inactive</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>
          {label}
        </Text>
        <Text style={[styles.count, { color: colors.textSecondary }]}>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.sm, borderWidth: 1, borderRadius: Radius.lg, gap: Spacing.sm },
  inactiveCard: { opacity: 0.55 },
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
  info: { gap: 2 },
  label: { ...Typography.captionBold },
  count: { ...Typography.label, fontSize: 11 },
});
