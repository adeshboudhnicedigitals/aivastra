'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ProfileCompletionModal } from './profile-completion-modal';
import type { UnlimitedPlanReminderStage } from './unlimited-plan-reminder-modal';
import { UnlimitedPlanReminderModal } from './unlimited-plan-reminder-modal';

interface MeResponse {
  email: string | null;
  phone: string | null;
  companyName: string | null;
}

interface UnlimitedPlanLoginCheckResponse {
  show: boolean;
  stage: UnlimitedPlanReminderStage | null;
  daysRemaining: number | null;
  endDateLabel: string | null;
}

export function ProfileGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
    retry: false,
  });

  // Force-checks (and, server-side, resends) the unlimited-plan expiry
  // reminder right after login. Deliberately NOT a cached useQuery: the
  // QueryClient (components/providers.tsx) is created once per browser tab
  // and survives client-side navigation, including a logout -> login round
  // trip in the same tab — a cached result under a fixed key would silently
  // reuse the first login's (or a different user's) stale answer instead of
  // hitting the endpoint again. A plain effect fires exactly once per
  // ProfileGate mount, which happens on every login redirect and every hard
  // reload — matching "every time" for now; see the API route's own comment
  // for the later once/twice-a-day throttling plan.
  const [reminder, setReminder] = useState<UnlimitedPlanLoginCheckResponse | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    api
      .post<UnlimitedPlanLoginCheckResponse>('/v1/unlimited-plan/login-check', {})
      .then(setReminder)
      .catch(() => {
        // Non-fatal — a failed check just means no popup this time.
      });
  }, []);

  const complete = Boolean(data?.phone && /^\d{10}$/.test(data.phone) && data?.email);

  if (isLoading && !data) {
    return <div style={{ flex: 1, background: '#fff' }} />;
  }

  return (
    <>
      {children}
      <ProfileCompletionModal
        open={Boolean(data && !complete)}
        email={data?.email ?? null}
        phone={data?.phone ?? null}
        companyName={data?.companyName ?? null}
      />
      <UnlimitedPlanReminderModal
        open={Boolean(reminder?.show) && !reminderDismissed}
        stage={reminder?.stage ?? null}
        daysRemaining={reminder?.daysRemaining ?? null}
        endDateLabel={reminder?.endDateLabel ?? null}
        onClose={() => setReminderDismissed(true)}
      />
    </>
  );
}
