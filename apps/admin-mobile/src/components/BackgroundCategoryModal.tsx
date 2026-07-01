import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';
import type { BackgroundCategory } from '../types';

export function BackgroundCategoryModal({
  visible,
  category,
  typeId,
  submitting,
  onClose,
  onSaved,
  onDelete,
}: {
  visible: boolean;
  category: BackgroundCategory | null;
  typeId: number | null;
  submitting: boolean;
  onClose: () => void;
  onSaved: (label: string, isActive: boolean) => void;
  onDelete?: (cat: BackgroundCategory) => void;
}) {
  const { colors } = useAppTheme();
  const [label, setLabel] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (visible) {
      setLabel(category?.label ?? '');
      setIsActive(category?.isActive ?? true);
    }
  }, [category, visible]);

  const valid = label.trim().length > 0;
  const isEdit = category !== null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.root, { backgroundColor: colors.bg }]}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {isEdit ? 'Edit Category' : 'New Category'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Label</Text>
            <TextInput
              maxLength={100}
              onChangeText={setLabel}
              placeholder="Category label"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={label}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>Active</Text>
              <Text style={[styles.help, { color: colors.textSecondary }]}>
                Available for asset assignment
              </Text>
            </View>
            <Switch onValueChange={setIsActive} value={isActive} />
          </View>

          {isEdit && onDelete ? (
            <TouchableOpacity
              onPress={() => onDelete(category!)}
              style={[styles.deleteBtn, { borderColor: colors.error }]}
            >
              <Text style={[styles.deleteLabel, { color: colors.error }]}>Delete Category</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            disabled={!valid || submitting || !typeId}
            onPress={() => onSaved(label.trim(), isActive)}
            style={[
              styles.submit,
              { backgroundColor: colors.accent },
              (!valid || submitting) && styles.disabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.submitLabel, { color: colors.onAccent }]}>Done</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...Typography.h2 },
  close: { ...Typography.bodyBold },
  field: { gap: Spacing.sm },
  fieldLabel: { ...Typography.captionBold },
  input: {
    minHeight: 52,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
    ...Typography.body,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  help: { ...Typography.caption, marginTop: 2 },
  deleteBtn: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  deleteLabel: { ...Typography.bodyBold },
  submit: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    marginTop: Spacing.md,
  },
  submitLabel: { ...Typography.bodyBold },
  disabled: { opacity: 0.45 },
});
