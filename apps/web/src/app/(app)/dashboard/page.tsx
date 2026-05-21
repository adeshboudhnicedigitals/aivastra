'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface Job {
  id: string;
  status: string;
  createdAt: string;
  creditsCharged: number;
}

const STATUS_BADGE: Record<string, 'default' | 'processing' | 'success' | 'destructive' | 'warning'> = {
  QUEUED: 'warning',
  PREPROCESSING: 'processing',
  GENERATING: 'processing',
  UPLOADING: 'processing',
  COMPLETED: 'success',
  FAILED: 'destructive',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  QUEUED: <Clock className="h-4 w-4 text-muted-foreground" />,
  PREPROCESSING: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
  GENERATING: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
  UPLOADING: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
  COMPLETED: <CheckCircle className="h-4 w-4 text-green-700" />,
  FAILED: <XCircle className="h-4 w-4 text-destructive" />,
};

export default function DashboardPage() {
  const { data: jobs, isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/v1/jobs'),
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs) return false;
      const hasActive = jobs.some((j) => !['COMPLETED', 'FAILED'].includes(j.status));
      return hasActive ? 3000 : false;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-hand text-4xl">Your Try-Ons</h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">Track your virtual try-on jobs</p>
        </div>
        <Button asChild>
          <Link href="/tryon">New Try-On →</Link>
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && (!jobs || jobs.length === 0) && (
        <div className="sketch-card flex flex-col items-center justify-center py-16 text-center">
          <p className="font-hand text-2xl">No try-ons yet.</p>
          <p className="mt-2 font-body text-sm text-muted-foreground">Create your first virtual try-on to get started.</p>
          <Button asChild className="mt-6">
            <Link href="/tryon">Get started →</Link>
          </Button>
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div className="sketch-card divide-y divide-foreground/10" style={{ padding: 0 }}>
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex items-center gap-4 px-5 py-4 hover:bg-secondary/50 transition-colors first:rounded-t last:rounded-b"
            >
              <div className="flex-shrink-0">{STATUS_ICON[job.status] ?? <Clock className="h-4 w-4" />}</div>
              <div className="flex-1 min-w-0">
                <p className="font-hand text-lg truncate">Try-on #{job.id.slice(0, 8)}</p>
                <p className="font-body text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={STATUS_BADGE[job.status] ?? 'default'}>{job.status}</Badge>
                <span className="font-body text-xs text-muted-foreground">{job.creditsCharged}c</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
