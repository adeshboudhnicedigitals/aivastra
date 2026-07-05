import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuthStore } from '../../store/auth';
import { useAppTheme } from '../../store/theme';
import { Radius, Spacing, Typography } from '../../styles/tokens';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const login = useAuthStore((state) => state.login);
  const { colors } = useAppTheme();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleLogin() {
    setError('');
    if (!email.trim() || !password) return setError('Email and password are required');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (cause) {
      if (mounted.current) {
        setError(
          (cause as Error).message === 'EMAIL_NOT_VERIFIED'
            ? 'Email not verified — check your inbox'
            : 'Invalid credentials',
        );
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.root, { backgroundColor: colors.bg }]}
    >
      <View style={[styles.orb, { backgroundColor: colors.accentContainer }]} />
      <View style={[styles.orbTwo, { backgroundColor: colors.errorContainer }]} />
      <View style={styles.brand}>
        <Image
          source={require('../../../../assets/admin_logo.png')}
          style={styles.logo}
          resizeMode="cover"
        />
        <Text style={[Typography.h2, { color: colors.text }]}>AIVASTRA ADMIN</Text>
      </View>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.glass, borderColor: colors.border, shadowColor: colors.shadow },
        ]}
      >
        <Text style={[styles.cardTitle, { color: colors.text }]}>Welcome back</Text>
        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.errorContainer }]}>
            <MaterialCommunityIcons color={colors.error} name="alert-circle-outline" size={18} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        ) : null}
        <View
          style={[
            styles.inputShell,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <MaterialCommunityIcons color={colors.textMuted} name="email-outline" size={20} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={setEmail}
            onSubmitEditing={() => passwordRef.current?.focus()}
            placeholder="admin@example.com"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            style={[styles.input, { color: colors.text }]}
            value={email}
          />
        </View>
        <View
          style={[
            styles.inputShell,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <MaterialCommunityIcons color={colors.textMuted} name="lock-outline" size={20} />
          <TextInput
            ref={passwordRef}
            onChangeText={setPassword}
            onSubmitEditing={() => void handleLogin()}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            returnKeyType="go"
            secureTextEntry={!showPassword}
            style={[styles.input, { color: colors.text }]}
            value={password}
          />
          <TouchableOpacity
            onPress={() => setShowPassword((prev) => !prev)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              color={colors.textMuted}
              name={showPassword ? 'eye-off' : 'eye'}
              size={22}
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          disabled={loading}
          onPress={() => void handleLogin()}
          style={[styles.button, { backgroundColor: colors.accent }, loading && styles.disabled]}
        >
          {loading ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <>
              <Text style={[styles.buttonText, { color: colors.onAccent }]}>Sign in securely</Text>
              <MaterialCommunityIcons color={colors.onAccent} name="arrow-right" size={20} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xxl,
    paddingBottom: 120,
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    right: -120,
    top: -80,
    opacity: 0.74,
  },
  orbTwo: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    left: -100,
    bottom: 20,
    opacity: 0.58,
  },
  brand: { marginBottom: Spacing.xxl, alignItems: 'center' },
  logo: {
    width: 138,
    height: 138,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  eyebrow: { ...Typography.label, marginBottom: Spacing.xs },
  subtitle: { ...Typography.body, maxWidth: 340, marginTop: Spacing.sm },
  card: {
    padding: Spacing.xl,
    borderWidth: 1,
    borderRadius: Radius.xxl,
    gap: Spacing.md,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 6,
  },
  cardTitle: { ...Typography.h2, marginBottom: Spacing.xs },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  errorText: { ...Typography.captionBold, flex: 1 },
  inputShell: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  input: { ...Typography.body, flex: 1, paddingVertical: 12 },

  button: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.full,
    marginTop: Spacing.sm,
  },
  buttonText: { ...Typography.bodyBold },
  disabled: { opacity: 0.6 },
});
