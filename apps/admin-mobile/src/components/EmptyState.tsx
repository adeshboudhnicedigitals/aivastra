import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

interface Props {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}
export function EmptyState({ title, message, actionLabel, onAction }: Props) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.root}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onAction}
          style={[styles.button, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.buttonLabel, { color: colors.onAccent }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  title: { ...Typography.h3, textAlign: 'center' },
  message: { ...Typography.body, textAlign: 'center', marginTop: Spacing.sm },
  button: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  buttonLabel: { ...Typography.bodyBold },
});
