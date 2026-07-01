import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

interface SmartSearchProps {
  onSubmit: (query: string) => void;
}

export function SmartSearch({ onSubmit }: SmartSearchProps) {
  const { colors } = useAppTheme();
  const [query, setQuery] = useState('');
  const submit = () => {
    const value = query.trim();
    if (value) onSubmit(value);
  };
  return (
    <View
      style={[
        styles.shell,
        { backgroundColor: colors.glass, borderColor: colors.border, shadowColor: colors.shadow },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.accentContainer }]}>
        <MaterialCommunityIcons color={colors.onAccentContainer} name="creation" size={20} />
      </View>
      <TextInput
        accessibilityLabel="Smart admin search"
        onChangeText={setQuery}
        onSubmitEditing={submit}
        placeholder="Ask about failed jobs, queues, or paste a job ID"
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        style={[styles.input, { color: colors.text }]}
        value={query}
      />
      <TouchableOpacity
        accessibilityLabel="Run smart search"
        accessibilityRole="button"
        onPress={submit}
        style={[styles.submit, { backgroundColor: colors.accent }]}
      >
        <MaterialCommunityIcons color={colors.onAccent} name="arrow-up" size={20} />
      </TouchableOpacity>
      <Text style={[styles.hint, { color: colors.textMuted }]}>Smart shortcuts</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
    borderWidth: 1,
    borderRadius: Radius.xl,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  input: { ...Typography.body, flex: 1, minWidth: 0, paddingVertical: Spacing.sm },
  submit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  hint: {
    ...Typography.label,
    position: 'absolute',
    left: 64,
    bottom: 8,
    textTransform: 'uppercase',
  },
});
