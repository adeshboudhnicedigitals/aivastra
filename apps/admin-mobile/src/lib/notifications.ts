import { Vibration } from 'react-native';
import type { JobStatus } from '../types';

export type NotificationEvent = JobStatus;
export const NOTIFICATION_EVENTS: NotificationEvent[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export interface NotificationConfig {
  soundEnabled: boolean;
  soundEvents: NotificationEvent[];
  slackEnabled: boolean;
  slackUrl: string;
  slackEvents: NotificationEvent[];
}

export const defaultNotificationConfig: NotificationConfig = {
  soundEnabled: false,
  soundEvents: ['FAILED'],
  slackEnabled: false,
  slackUrl: '',
  slackEvents: ['FAILED'],
};

// ponytail: no bundled audio asset exists and expo-av/expo-audio aren't installed —
// a device vibration pulse is the zero-dependency stand-in for "sound alerts".
// Swap for a real Audio.Sound once a notification asset + expo-audio are added.
export function playNotificationSound(): void {
  Vibration.vibrate(200);
}

export async function triggerNotifications(
  config: NotificationConfig,
  status: JobStatus,
  jobId: string,
): Promise<void> {
  if (config.soundEnabled && config.soundEvents.includes(status)) {
    playNotificationSound();
  }

  if (config.slackEnabled && config.slackUrl && config.slackEvents.includes(status)) {
    await triggerSlackNotification(config.slackUrl, jobId, status);
  }
}

async function triggerSlackNotification(
  webhookUrl: string,
  jobId: string,
  status: JobStatus,
): Promise<void> {
  try {
    const message = {
      text: `Job ${jobId.slice(0, 8)} ${status.toLowerCase()}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Job Update:* \`${jobId.slice(0, 8)}\` → *${status}*`,
          },
        },
      ],
    };
    await fetch(webhookUrl, {
      method: 'POST',
      body: JSON.stringify(message),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // noop on webhook failure
  }
}
