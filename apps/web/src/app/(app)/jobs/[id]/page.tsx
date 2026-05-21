'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';

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
    <div className="flex items-center gap-2">
      {STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
            i < currentIdx ? 'bg-primary text-primary-foreground' :
            i === currentIdx ? 'bg-primary/20 text-primary ring-2 ring-primary' :
            'bg-muted text-muted-foreground'
          }`}>
            {i < currentIdx ? <CheckCircle className="h-4 w-4" /> : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 w-8 ${i < currentIdx ? 'bg-primary' : 'bg-muted'}`} />
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

  // SSE for live progress
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
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link>
        </Button>
        <h1 className="text-xl font-bold">Try-on #{job.id.slice(0, 8)}</h1>
        <Badge variant={job.status === 'COMPLETED' ? 'success' : job.status === 'FAILED' ? 'destructive' : 'processing'}>
          {job.status}
        </Badge>
      </div>

      {/* Progress steps */}
      {job.status !== 'FAILED' && (
        <div className="rounded-xl border p-6">
          <p className="mb-4 text-sm font-medium text-muted-foreground">Progress</p>
          <StepIndicator currentStatus={job.status} />
          {!TERMINAL.includes(job.status) && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing your try-on…
            </div>
          )}
        </div>
      )}

      {/* Result image */}
      {job.status === 'COMPLETED' && (
        <div className="rounded-xl border p-6">
          <p className="mb-4 text-sm font-medium text-muted-foreground">Result</p>
          {resultUrl ? (
            <div className="space-y-4">
              <img
                src={resultUrl}
                alt="Try-on result"
                className="w-full max-w-lg rounded-lg object-contain shadow-md"
              />
              <Button asChild variant="outline" size="sm">
                <a href={resultUrl} download={`tryon-${job.id}.png`}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </a>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading result…
            </div>
          )}
        </div>
      )}

      {/* Failure state */}
      {job.status === 'FAILED' && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            <p className="font-medium text-destructive">Job failed</p>
          </div>
          {job.errorCode && <p className="mt-1 text-sm text-muted-foreground">Error: {job.errorCode}</p>}
          <p className="mt-2 text-sm text-muted-foreground">Your credits have been refunded.</p>
          <Button asChild className="mt-4" size="sm">
            <Link href="/tryon">Try again</Link>
          </Button>
        </div>
      )}

      {/* Job metadata */}
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">
        <p>Created: {new Date(job.createdAt).toLocaleString()}</p>
        <p>Credits charged: {job.creditsCharged}</p>
      </div>
    </div>
  );
}
