import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { NOTIFICATION_EVENTS, type NotificationEvent } from '../lib/notifications';
import { useNotificationConfig } from '../store/notifications';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';

interface EventCheckboxProps {
  event: NotificationEvent;
  checked: boolean;
  onChange: (checked: boolean) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}

function EventCheckbox({ event, checked, onChange, colors }: EventCheckboxProps) {
  return (
    <TouchableOpacity
      onPress={() => onChange(!checked)}
      style={[
        styles.eventCheckbox,
        { backgroundColor: colors.surface, borderColor: colors.border },
        checked && { backgroundColor: colors.accentContainer, borderColor: colors.accent },
      ]}
    >
      {checked && <MaterialCommunityIcons color={colors.accent} name="check" size={18} />}
      <Text style={[styles.eventLabel, { color: colors.text }]}>{event}</Text>
    </TouchableOpacity>
  );
}

export function NotificationsSection() {
  const { colors } = useAppTheme();
  const config = useNotificationConfig();
  const load = useNotificationConfig((s) => s.load);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    void load().then(() => setInitialized(true));
  }, [load]);

  if (!initialized) return null;

  return (
    <>
      {/* Sound Alerts */}
      <View style={styles.subsection}>
        <Text style={[styles.subsectionTitle, { color: colors.text }]}>Sound Alerts</Text>
        <View
          style={[
            styles.toggleRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.toggleLeft}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>
              Enable sound notifications
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Play sound on job state changes
            </Text>
          </View>
          <Switch
            value={config.soundEnabled}
            onValueChange={(v) => void config.update({ soundEnabled: v })}
          />
        </View>
        {config.soundEnabled && (
          <View style={styles.eventGrid}>
            {NOTIFICATION_EVENTS.map((event) => (
              <EventCheckbox
                key={event}
                event={event}
                checked={config.soundEvents.includes(event)}
                onChange={(checked) => {
                  const nextEvents = checked
                    ? [...config.soundEvents, event]
                    : config.soundEvents.filter((e) => e !== event);
                  void config.update({ soundEvents: nextEvents });
                }}
                colors={colors}
              />
            ))}
          </View>
        )}
      </View>

      {/* Email Alerts — no backend email service exists yet; kept visibly disabled
          rather than a toggle that would silently do nothing when turned on. */}
      <View style={styles.subsection}>
        <Text style={[styles.subsectionTitle, { color: colors.text }]}>Email Alerts</Text>
        <View
          style={[
            styles.toggleRow,
            { backgroundColor: colors.surfaceVariant, borderColor: colors.border, opacity: 0.5 },
          ]}
        >
          <View style={styles.toggleLeft}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>
              Enable email notifications (Coming soon)
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Receive emails on job events
            </Text>
          </View>
          <Switch value={false} disabled />
        </View>
      </View>

      {/* Slack Webhook */}
      <View style={styles.subsection}>
        <Text style={[styles.subsectionTitle, { color: colors.text }]}>Slack Notifications</Text>
        <View
          style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Webhook URL</Text>
          <TextInput
            editable
            value={config.slackUrl}
            onChangeText={(v) => void config.update({ slackUrl: v })}
            placeholder="https://hooks.slack.com/services/..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.text }]}
          />
        </View>
        {config.slackUrl && (
          <View style={styles.eventGrid}>
            {NOTIFICATION_EVENTS.map((event) => (
              <EventCheckbox
                key={event}
                event={event}
                checked={config.slackEvents.includes(event)}
                onChange={(checked) => {
                  const nextEvents = checked
                    ? [...config.slackEvents, event]
                    : config.slackEvents.filter((e) => e !== event);
                  void config.update({ slackEvents: nextEvents });
                }}
                colors={colors}
              />
            ))}
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  subsection: { gap: Spacing.md, marginBottom: Spacing.lg },
  subsectionTitle: { ...Typography.h3, marginBottom: Spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  toggleLeft: { flex: 1 },
  toggleLabel: { ...Typography.bodyBold },
  subtitle: { ...Typography.caption, marginTop: 2 },
  eventGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  eventCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  eventLabel: { ...Typography.caption },
  field: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  fieldLabel: { ...Typography.label, marginBottom: Spacing.sm },
  input: { ...Typography.body, paddingVertical: Spacing.sm },
});
