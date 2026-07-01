import { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

export interface PickerOption {
  id: string;
  label: string;
  subtitle?: string;
}
export function PickerModal({
  visible,
  title,
  options,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { colors } = useAppTheme();
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () =>
      options.filter((item) =>
        `${item.label} ${item.subtitle ?? ''}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [options, search],
  );
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          onChangeText={setSearch}
          placeholder="Search"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.search,
            {
              backgroundColor: colors.surfaceVariant,
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          value={search}
        />
        <FlatList
          contentContainerStyle={styles.list}
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => {
                onSelect(item.id);
                onClose();
              }}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.label, { color: colors.text }]}>{item.label}</Text>
              {item.subtitle ? (
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                  {item.subtitle}
                </Text>
              ) : null}
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, padding: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.h2 },
  close: { ...Typography.bodyBold },
  search: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    marginVertical: Spacing.lg,
    ...Typography.body,
  },
  list: { gap: Spacing.sm, paddingBottom: Spacing.xxxl },
  row: { padding: Spacing.lg, borderWidth: 1, borderRadius: Radius.lg },
  label: { ...Typography.bodyBold },
  subtitle: { ...Typography.caption, marginTop: 2 },
});
