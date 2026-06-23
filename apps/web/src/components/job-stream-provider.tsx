'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import { createSSEConnection } from '@/lib/sse';

export interface JobStatusEvent {
  jobId: string;
  userId: string;
  type: 'STATUS';
  status: string;
  resultKey?: string;
  workerId?: string;
  errorCode?: string;
}

type Subscriber = (evt: JobStatusEvent) => void;

interface JobStreamContextValue {
  subscribe: (fn: Subscriber) => () => void;
}

const JobStreamContext = createContext<JobStreamContextValue | null>(null);

export function JobStreamProvider({ children }: { children: React.ReactNode }) {
  const subscribers = useRef<Set<Subscriber>>(new Set());

  useEffect(() => {
    const conn = createSSEConnection<JobStatusEvent>('/v1/jobs/stream', (e) => {
      if (e.type === 'STATUS') {
        for (const fn of subscribers.current) fn(e.data);
      }
    });
    return () => conn.close();
  }, []);

  const value: JobStreamContextValue = {
    subscribe: (fn) => {
      subscribers.current.add(fn);
      return () => subscribers.current.delete(fn);
    },
  };

  return <JobStreamContext.Provider value={value}>{children}</JobStreamContext.Provider>;
}

export function useJobStreamContext(): JobStreamContextValue {
  const ctx = useContext(JobStreamContext);
  if (!ctx) throw new Error('useJobStreamContext must be used inside JobStreamProvider');
  return ctx;
}
