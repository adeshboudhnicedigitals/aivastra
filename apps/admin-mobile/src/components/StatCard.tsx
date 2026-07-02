import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatNumber } from '../lib/format';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

interface BaseProps {
  label: string;
  value: number | string;
  icon?: ReactNode;
  alert?: boolean;
  featured?: boolean;
  onPress?: () => void;
}
type Props = BaseProps &
  ({ delta?: number | null; subtitle?: never } | { delta?: never; subtitle?: string });

export function StatCard({
  label,
  value,
  icon,
  delta,
  subtitle,
  alert = false,
  featured = false,
  onPress,
}: Props) {
  const { colors } = useAppTheme();
  const deltaColor =
    delta && delta > 0 ? colors.success : delta && delta < 0 ? colors.error : colors.textMuted;
  const content = (
    <>
      <View style={styles.labelRow}>
        {icon}
        <Text
          style={[
            styles.label,
            { color: featured ? colors.onAccentContainer : colors.textSecondary },
          ]}
        >
          {label}
        </Text>
      </View>
      <Text
        style={[
          styles.value,
          { color: alert ? colors.error : featured ? colors.onAccentContainer : colors.text },
        ]}
      >
        {typeof value === 'number' ? formatNumber(value) : value}
      </Text>
      {delta !== null && delta !== undefined ? (
        <View style={styles.metaRow}>
          <Text style={[styles.delta, { color: deltaColor }]}>
            {delta > 0 ? '↑ ' : delta < 0 ? '↓ ' : ''}
            {formatNumber(Math.round(Math.abs(delta) * 10) / 10)}%
          </Text>
          <Text
            style={[styles.meta, { color: featured ? colors.onAccentContainer : colors.textMuted }]}
          >
            vs yesterday
          </Text>
        </View>
      ) : subtitle ? (
        <Text
          style={[styles.meta, { color: featured ? colors.onAccentContainer : colors.textMuted }]}
        >
          {subtitle}
        </Text>
      ) : null}
    </>
  );
  const cardStyle = [
    styles.card,
    {
      backgroundColor: featured
        ? colors.accentContainer
        : alert
          ? colors.errorContainer
          : colors.glass,
      borderColor: alert ? colors.error : colors.border,
      shadowColor: colors.shadow,
    },
  ];
  return onPress ? (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.82}
      onPress={onPress}
      style={cardStyle}
    >
      {content}
    </TouchableOpacity>
  ) : (
    <View style={cardStyle}>{content}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 142,
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.xl,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 3,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  label: { ...Typography.captionBold, flexShrink: 1 },
  value: { fontSize: 30, fontWeight: '800', lineHeight: 34, fontVariant: ['tabular-nums'] },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm },
  delta: { ...Typography.captionBold },
  meta: { ...Typography.caption, marginTop: Spacing.sm },
});
