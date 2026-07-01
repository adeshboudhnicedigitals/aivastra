import { type ReactNode, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

interface Props {
  title: string;
  children: ReactNode;
  initiallyExpanded?: boolean;
}
export function AccordionSection({ title, children, initiallyExpanded = true }: Props) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const { colors } = useAppTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.chevron, { color: colors.accent }]}>{expanded ? '−' : '+'}</Text>
      </TouchableOpacity>
      {expanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { borderRadius: Radius.xl, borderWidth: 1, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
  },
  title: { ...Typography.h3 },
  chevron: { ...Typography.h3 },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
});
