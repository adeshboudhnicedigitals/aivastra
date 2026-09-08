import { useState } from 'react';
import { apiErrorMessage, apiFetch } from '../../lib/data';

type DownloadUrlResponse =
  | { configured: false }
  | { configured: true; found: false }
  | { configured: true; found: true; url: string; expiresIn: number };

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function ProdSnapshotTab({ toast }: Props) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const data = await apiFetch<DownloadUrlResponse>('/admin/prod-snapshot/download-url');
      if (!data.configured) {
        toast({
          kind: 'error',
          title: 'Not configured',
          body: 'DEV_SNAPSHOT_* env vars are not set.',
        });
        return;
      }
      if (!data.found) {
        toast({
          kind: 'error',
          title: 'No snapshot yet',
          body: 'Ask an operator to run the export.',
        });
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = data.url;
      anchor.download = 'latest.dump.age';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to get download link',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="card settings-card">
      <div className="card-body">
        <button
          className="btn btn--primary"
          onClick={() => void handleDownload()}
          disabled={downloading}
        >
          {downloading ? 'Preparing download…' : 'Download DB snapshot'}
        </button>
      </div>
    </div>
  );
}
