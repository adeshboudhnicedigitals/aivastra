import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiFetch } from '../lib/api';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

interface Props {
  visible: boolean;
  userId: string;
  userEmail: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function GrantCreditsModal({ visible, userId, userEmail, onClose, onSuccess }: Props) {
  const { colors } = useAppTheme();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const numericAmount = Number(amount);
  const valid = Number.isInteger(numericAmount) && numericAmount >= 1 && numericAmount <= 10_000;
  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch<{ ok: boolean }>('/admin/credits/grant', {
        method: 'POST',
        body: JSON.stringify({ userId, amount: numericAmount, reason: reason.trim() || undefined }),
      });
      setAmount('');
      setReason('');
      onSuccess();
      onClose();
    } catch (cause) {
      Alert.alert('Grant failed', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }
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
            <View>
              <Text style={[styles.title, { color: colors.text }]}>Grant credits</Text>
              <Text numberOfLines={1} style={[styles.email, { color: colors.textSecondary }]}>
                {userEmail}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.close, { backgroundColor: colors.surfaceVariant }]}
            >
              <Text style={[styles.closeLabel, { color: colors.text }]}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Amount</Text>
          <TextInput
            keyboardType="number-pad"
            maxLength={5}
            onChangeText={(value) => setAmount(value.replace(/\D/g, ''))}
            placeholder="1–10000"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            value={amount}
          />
          <Text style={[styles.label, { color: colors.textSecondary }]}>Reason</Text>
          <TextInput
            maxLength={200}
            multiline
            onChangeText={setReason}
            placeholder="Optional reason"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              styles.reason,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            textAlignVertical="top"
            value={reason}
          />
          <Text style={[styles.counter, { color: colors.textMuted }]}>{reason.length}/200</Text>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!valid || submitting}
            onPress={() => void submit()}
            style={[
              styles.submit,
              { backgroundColor: colors.accent },
              (!valid || submitting) && styles.disabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.submitLabel, { color: colors.onAccent }]}>Grant credits</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  title: { ...Typography.h2 },
  email: { ...Typography.caption, marginTop: 2, maxWidth: 260 },
  close: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  closeLabel: { fontSize: 24, lineHeight: 26 },
  label: { ...Typography.captionBold, marginTop: Spacing.sm },
  input: {
    minHeight: 54,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
    ...Typography.body,
  },
  reason: { minHeight: 120, paddingTop: Spacing.lg },
  counter: { ...Typography.caption, textAlign: 'right' },
  submit: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    marginTop: Spacing.lg,
  },
  submitLabel: { ...Typography.bodyBold },
  disabled: { opacity: 0.45 },
});
