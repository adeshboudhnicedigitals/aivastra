'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface Job {
  id: string;
  status: string;
  createdAt: string;
  creditsCharged: number;
  errorCode?: string;
}

const TERMINAL = ['COMPLETED', 'FAILED'];
const STEPS = ['QUEUED', 'PREPROCESSING', 'GENERATING', 'UPLOADING', 'COMPLETED'];

function StepIndicator({ currentStatus }: { currentStatus: string }) {
  const currentIdx = STEPS.indexOf(currentStatus);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <div className={[
            'flex h-7 w-7 items-center justify-center rounded-full border font-body text-xs font-medium',
            i < currentIdx ? 'border-primary bg-primary text-foreground' :
            i === currentIdx ? 'border-foreground bg-foreground text-background' :
            'border-foreground/30 text-muted-foreground',
          ].join(' ')}>
            {i < currentIdx ? <CheckCircle className="h-4 w-4" /> : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-px w-8 ${i < currentIdx ? 'bg-primary' : 'bg-foreground/20'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const { data: job } = useQuery<Job>({
    queryKey: ['jobs', id],
    queryFn: () => api.get(`/v1/jobs/${id}`),
    refetchInterval: (query) => {
      const j = query.state.data;
      if (!j || TERMINAL.includes(j.status)) return false;
      return 5000;
    },
  });

  useEffect(() => {
    if (!job || TERMINAL.includes(job.status)) return;
    const token = document.cookie.match(/(?:^|; )access_token=([^;]*)/)?.[1];
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const es = new EventSource(
      `${apiUrl}/v1/jobs/${id}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    );
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as { status?: string };
        if (payload.status) {
          qc.setQueryData<Job>(['jobs', id], (prev) => prev ? { ...prev, status: payload.status! } : prev);
          if (TERMINAL.includes(payload.status)) es.close();
        }
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [id, job?.status, qc]);

  async function loadResult() {
    const data = await api.get<{ url: string }>(`/v1/jobs/${id}/result`);
    setResultUrl(data.url);
  }

  useEffect(() => {
    if (job?.status === 'COMPLETED' && !resultUrl) loadResult();
  }, [job?.status]);

  if (!job) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link>
        </Button>
        <h1 className="font-hand text-2xl">Try-on #{job.id.slice(0, 8)}</h1>
        <Badge variant={job.status === 'COMPLETED' ? 'success' : job.status === 'FAILED' ? 'destructive' : 'processing'}>
          {job.status}
        </Badge>
      </div>

      {/* Progress */}
      {job.status !== 'FAILED' && (
        <div className="sketch-card p-6">
          <p className="mb-4 font-hand text-lg text-muted-foreground">Progress</p>
          <StepIndicator currentStatus={job.status} />
          {!TERMINAL.includes(job.status) && (
            <div className="mt-4 flex items-center gap-2 font-body text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing your try-on…
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {job.status === 'COMPLETED' && (
        <div className="sketch-card p-6">
          <p className="mb-4 font-hand text-lg text-muted-foreground">Result</p>
          {resultUrl ? (
            <div className="space-y-4">
              <img
                src={resultUrl}
                alt="Try-on result"
                className="w-full max-w-lg object-contain"
                style={{ border: '1.5px solid hsl(var(--foreground))', borderRadius: '4px' }}
              />
              <Button asChild variant="outline" size="sm">
                <a href={resultUrl} download={`tryon-${job.id}.png`}>
                  <Download className="mr-2 h-4 w-4" />Download
                </a>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-body text-sm">Loading result…</span>
            </div>
          )}
        </div>
      )}

      {/* Failure */}
      {job.status === 'FAILED' && (
        <div className="sketch-card p-6" style={{ borderColor: 'hsl(var(--destructive))' }}>
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            <p className="font-hand text-xl text-destructive">Job failed</p>
          </div>
          {job.errorCode && <p className="mt-1 font-body text-sm text-muted-foreground">Error: {job.errorCode}</p>}
          <p className="mt-2 font-body text-sm text-muted-foreground">Your credits have been refunded.</p>
          <Button asChild className="mt-4" size="sm">
            <Link href="/tryon">Try again →</Link>
          </Button>
        </div>
      )}

      {/* Metadata */}
      <div className="sketch-card-sm p-4 font-body text-sm text-muted-foreground space-y-1">
        <p>Created: {new Date(job.createdAt).toLocaleString()}</p>
        <p>Credits charged: {job.creditsCharged}</p>
      </div>
    </div>
  );
}
