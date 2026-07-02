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
import type { UploadPhase } from '../lib/upload';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';
import { type FilterChipOption, FilterChips } from './FilterChips';
import { ImagePickerButton } from './ImagePickerButton';
import { UploadProgress } from './UploadProgress';

export type AssetGender = 'all' | 'men' | 'women' | 'boys' | 'girls';
const FACE_GENDERS: readonly FilterChipOption<AssetGender>[] = [
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Boys', value: 'boys' },
  { label: 'Girls', value: 'girls' },
];
const BG_GENDERS: readonly FilterChipOption<AssetGender>[] = [
  { label: 'All', value: 'all' },
  ...FACE_GENDERS,
];

export interface AssetFormValue {
  uri: string;
  mimeType: string;
  label: string;
  gender: AssetGender;
  sortOrder: number;
  isWhiteBg: boolean;
}
export function AssetFormModal({
  visible,
  kind,
  submitting,
  phase,
  progress,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  kind: 'face' | 'background';
  submitting: boolean;
  phase: UploadPhase;
  progress: number;
  onClose: () => void;
  onSubmit: (value: AssetFormValue) => void;
}) {
  const { colors } = useAppTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [label, setLabel] = useState('');
  const [gender, setGender] = useState<AssetGender>(kind === 'face' ? 'men' : 'all');
  const [sortOrder, setSortOrder] = useState('0');
  const [white, setWhite] = useState(false);
  useEffect(() => {
    if (!visible) {
      setUri(null);
      setLabel('');
      setSortOrder('0');
      setWhite(false);
      setGender(kind === 'face' ? 'men' : 'all');
    }
  }, [kind, visible]);
  const valid = Boolean(uri && label.trim());
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
            <Text style={[styles.title, { color: colors.text }]}>Add {kind}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
          </View>
          <ImagePickerButton
            disabled={submitting}
            label={kind === 'face' ? 'Face Image' : 'Background Image'}
            onPick={(nextUri, nextMime) => {
              setUri(nextUri);
              setMimeType(nextMime);
            }}
            size={180}
            uri={uri}
          />
          <Field label="Label" colors={colors}>
            <TextInput
              maxLength={100}
              onChangeText={setLabel}
              placeholder="Display label"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={label}
            />
          </Field>
          <Field label="Gender" colors={colors}>
            <FilterChips
              onChange={setGender}
              options={kind === 'face' ? FACE_GENDERS : BG_GENDERS}
              value={gender}
            />
          </Field>
          <Field label="Sort order" colors={colors}>
            <TextInput
              keyboardType="number-pad"
              onChangeText={setSortOrder}
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={sortOrder}
            />
          </Field>
          {kind === 'background' ? (
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>White background</Text>
                <Text style={[styles.help, { color: colors.textSecondary }]}>
                  Enabling this unsets the previous white background.
                </Text>
              </View>
              <Switch onValueChange={setWhite} value={white} />
            </View>
          ) : null}
          <UploadProgress phase={phase} progress={progress} />
          <TouchableOpacity
            disabled={!valid || submitting}
            onPress={() =>
              uri &&
              onSubmit({
                uri,
                mimeType,
                label: label.trim(),
                gender,
                sortOrder: Number(sortOrder) || 0,
                isWhiteBg: white,
              })
            }
            style={[
              styles.submit,
              { backgroundColor: colors.accent },
              (!valid || submitting) && styles.disabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.submitLabel, { color: colors.onAccent }]}>Upload and save</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
function Field({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      {children}
    </View>
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
  submit: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  submitLabel: { ...Typography.bodyBold },
  disabled: { opacity: 0.45 },
});
