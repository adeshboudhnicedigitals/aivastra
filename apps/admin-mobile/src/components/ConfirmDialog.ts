import { Alert } from 'react-native';

export function confirmAction(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}): void {
  Alert.alert(opts.title, opts.message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: opts.confirmLabel ?? 'Confirm',
      style: opts.destructive ? 'destructive' : 'default',
      onPress: async () => {
        try {
          await opts.onConfirm();
        } catch (cause) {
          Alert.alert(
            'Action failed',
            cause instanceof Error ? cause.message : 'Please try again.',
          );
        }
      },
    },
  ]);
}
