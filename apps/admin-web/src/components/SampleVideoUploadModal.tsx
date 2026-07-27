import { useState } from 'react';
import { apiFetch } from '../lib/data';

interface PresignResult { videoUploadUrl: string; videoR2Key: string; thumbnailUploadUrl: string; thumbnailR2Key: string }
export interface SampleVideo { id: string; title: string; videoR2Key: string; thumbnailR2Key: string; prompt: string; isActive: boolean; sortOrder: number; videoUrl: string; thumbnailUrl: string }

async function putFile(url: string, file: Blob, contentType: string): Promise<void> {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!response.ok) throw new Error(`Upload failed (status ${response.status})`);
}

export function SampleVideoUploadModal({ onClose, onDone, toast }: { onClose: () => void; onDone: (created: SampleVideo) => void; toast: (t: { kind?: 'error'; title: string; body?: string }) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [uploading, setUploading] = useState(false);
  const canSubmit = Boolean(title.trim() && prompt.trim());
  const submit = async () => {
    if (!videoFile || !thumbnailFile || !canSubmit) return;
    setUploading(true);
    try {
      const presign = await apiFetch<PresignResult>('/admin/assets/sample-videos/presign', { method: 'POST', body: JSON.stringify({ videoContentType: 'video/mp4', thumbnailContentType: thumbnailFile.type }) });
      await Promise.all([putFile(presign.videoUploadUrl, videoFile, 'video/mp4'), putFile(presign.thumbnailUploadUrl, thumbnailFile, thumbnailFile.type)]);
      const created = await apiFetch<SampleVideo>('/admin/assets/sample-videos', { method: 'POST', body: JSON.stringify({ title: title.trim(), videoR2Key: presign.videoR2Key, thumbnailR2Key: presign.thumbnailR2Key, prompt: prompt.trim(), sortOrder }) });
      toast({ title: 'Sample video uploaded' }); onDone(created);
    } catch (error) { toast({ kind: 'error', title: 'Upload failed', body: error instanceof Error ? error.message : 'Failed' }); }
    finally { setUploading(false); }
  };
  return <div className="modal-overlay" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}><h3>Add Sample Video</h3>{step === 1 ? <><label>Sample video file (.mp4)<input type="file" accept="video/mp4" onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} /></label><label>Poster thumbnail (image)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setThumbnailFile(e.target.files?.[0] ?? null)} /></label><div className="modal-actions"><button onClick={onClose}>Cancel</button><button disabled={!videoFile || !thumbnailFile} onClick={() => setStep(2)}>Next</button></div></> : <><label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label><label>PixVerse prompt<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} rows={4} /></label><label>Sort order<input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} /></label><div className="modal-actions"><button onClick={() => setStep(1)} disabled={uploading}>Back</button><button disabled={!canSubmit || uploading} onClick={submit}>{uploading ? 'Uploading...' : 'Create'}</button></div></>}</div></div>;
}
