import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

export function ImagePickerButton({
  uri,
  onPick,
  size = 120,
  disabled = false,
  label,
}: {
  uri: string | null;
  onPick: (uri: string, mimeType: string) => void;
  size?: number;
  disabled?: boolean;
  label?: string;
}) {
  const { colors } = useAppTheme();
  async function pick() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted)
      return Alert.alert('Photo access required', 'Allow photo access to select an image.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) onPick(asset.uri, asset.mimeType ?? 'image/jpeg');
  }
  return (
    <View style={styles.root}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}
      <TouchableOpacity
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => void pick()}
        style={[
          styles.picker,
          {
            width: size,
            height: size,
            borderColor: colors.border,
            backgroundColor: colors.surfaceVariant,
          },
          disabled && styles.disabled,
        ]}
      >
        {uri ? (
          <Image contentFit="cover" source={{ uri }} style={styles.image} />
        ) : (
          <>
            <MaterialCommunityIcons color={colors.accent} name="camera-plus-outline" size={28} />
            <Text style={[styles.placeholder, { color: colors.textSecondary }]}>Tap to select</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: Spacing.sm },
  label: { ...Typography.captionBold },
  picker: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.lg,
  },
  image: { width: '100%', height: '100%' },
  placeholder: { ...Typography.caption, textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
