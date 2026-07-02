import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';
import type { JobStatus } from '../types';

export type JobFilter = 'ALL' | Exclude<JobStatus, 'PREPROCESSING' | 'UPLOADING'>;

export interface FilterChipOption<T extends string> {
  label: string;
  value: T;
}

interface FilterChipsProps<T extends string> {
  options: readonly FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export const JOB_FILTER_OPTIONS: readonly FilterChipOption<JobFilter>[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Queued', value: 'QUEUED' },
  { label: 'Generating', value: 'GENERATING' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

export function FilterChips<T extends string>({ options, value, onChange }: FilterChipsProps<T>) {
  const { colors } = useAppTheme();
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected }}
            activeOpacity={0.75}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.accent : colors.surface,
                borderColor: selected ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[styles.label, { color: selected ? colors.onAccent : colors.textSecondary }]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  label: {
    ...Typography.captionBold,
  },
});
