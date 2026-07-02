import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatDate, humanizeStatus } from '../lib/format';
import { useAppTheme } from '../store/theme';
import { Radius, Spacing, Typography } from '../styles/tokens';
import type { JobEvent } from '../types';

interface EventTimelineProps {
  events: JobEvent[];
}

function payloadText(payload: JobEvent['payload']): string | null {
  if (!payload) return null;
  const parts: string[] = [];
  if (typeof payload.workerId === 'string') parts.push(`Worker ${payload.workerId}`);
  if (typeof payload.errorCode === 'string') parts.push(`Error ${payload.errorCode}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function EventTimeline({ events }: EventTimelineProps) {
  const { colors } = useAppTheme();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (events.length === 0)
    return <Text style={[styles.empty, { color: colors.textSecondary }]}>No events recorded.</Text>;

  function toggle(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyPayload(event: JobEvent) {
    if (!event.payload) return;
    await Clipboard.setStringAsync(JSON.stringify(event.payload, null, 2));
    setCopiedId(event.id);
    setTimeout(() => setCopiedId((current) => (current === event.id ? null : current)), 1500);
  }

  return (
    <View style={styles.timeline}>
      {events.map((event, index) => {
        const detail = payloadText(event.payload);
        const hasPayload = Boolean(event.payload && Object.keys(event.payload).length > 0);
        const expanded = expandedIds.has(event.id);
        return (
          <View key={event.id} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              {index < events.length - 1 ? (
                <View style={[styles.line, { backgroundColor: colors.border }]} />
              ) : null}
            </View>
            <View style={styles.content}>
              <TouchableOpacity
                accessibilityLabel={`${humanizeStatus(event.eventType)}, ${formatDate(event.createdAt)}${detail ? `, ${detail}` : ''}`}
                accessibilityRole={hasPayload ? 'button' : undefined}
                accessibilityState={hasPayload ? { expanded } : undefined}
                activeOpacity={hasPayload ? 0.7 : 1}
                disabled={!hasPayload}
                onPress={() => toggle(event.id)}
                style={styles.eventHeader}
              >
                <View style={styles.eventHeading}>
                  <Text style={[styles.title, { color: colors.text }]}>
                    {humanizeStatus(event.eventType)}
                  </Text>
                  {hasPayload ? (
                    <Text style={[styles.expandLabel, { color: colors.accent }]}>
                      {expanded ? 'Hide JSON' : 'View JSON'}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.time, { color: colors.textMuted }]}>
                  {formatDate(event.createdAt)}
                </Text>
                {detail ? (
                  <Text style={[styles.detail, { color: colors.textSecondary }]}>{detail}</Text>
                ) : null}
              </TouchableOpacity>
              {expanded && event.payload ? (
                <View style={[styles.payloadBox, { backgroundColor: colors.bgSecondary }]}>
                  <Text selectable style={[styles.payload, { color: colors.textSecondary }]}>
                    {JSON.stringify(event.payload, null, 2)}
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void copyPayload(event)}
                    style={[styles.copyButton, { backgroundColor: colors.surface }]}
                  >
                    <Text style={[styles.copyLabel, { color: colors.accent }]}>
                      {copiedId === event.id ? 'Copied' : 'Copy JSON'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  timeline: { gap: 0 },
  row: { flexDirection: 'row', gap: Spacing.md },
  rail: { width: 14, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: Radius.full, marginTop: Spacing.xs },
  line: { flex: 1, width: 2, minHeight: 44 },
  content: { flex: 1, paddingBottom: Spacing.lg },
  eventHeader: { gap: Spacing.xs },
  eventHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  title: { ...Typography.bodyBold },
  expandLabel: { ...Typography.captionBold },
  time: { ...Typography.caption },
  detail: { ...Typography.caption },
  payloadBox: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    gap: Spacing.md,
  },
  payload: { ...Typography.code },
  copyButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  copyLabel: { ...Typography.captionBold },
  empty: { ...Typography.body },
});
