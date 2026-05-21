'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Upload, ChevronRight, ChevronLeft, Check, Loader2 } from 'lucide-react';

// --- Types ---
interface Subcategory { id: string; slug: string; label: string }
interface FaceItem { id: string; label: string; thumbnailUrl: string; gender: string }
interface BackgroundItem { id: string; label: string; thumbnailUrl: string }
interface PoseItem { id: string; label: string; thumbnailUrl: string; showsLower: boolean; showsShoes: boolean }

const GENDERS = [
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
  { value: 'girls', label: 'Girls' },
  { value: 'boys', label: 'Boys' },
];

const STEPS = ['Category', 'Garment', 'Face', 'Background', 'Pose', 'Review'];

// --- Selection card component ---
function SelectCard({ selected, onClick, imageUrl, label }: { selected: boolean; onClick: () => void; imageUrl: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative rounded-xl border-2 overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-muted-foreground',
      )}
    >
      <div className="aspect-[3/4] w-full relative">
        <Image src={imageUrl} alt={label} fill className="object-cover" sizes="200px" />
      </div>
      <div className="p-2 text-center">
        <p className="text-xs font-medium truncate">{label}</p>
      </div>
      {selected && (
        <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
          <Check className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
      )}
    </button>
  );
}

export default function TryOnPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState<string>('');
  const [subcategoryId, setSubcategoryId] = useState<string>('');
  const [faceId, setFaceId] = useState<string>('');
  const [backgroundId, setBackgroundId] = useState<string>('');
  const [poseId, setPoseId] = useState<string>('');
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentKey, setGarmentKey] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: subcategories } = useQuery<{ items: Subcategory[] }>({
    queryKey: ['subcategories', gender],
    queryFn: () => api.get(`/v1/models/subcategories?gender=${gender}`),
    enabled: !!gender,
  });

  const { data: faces } = useQuery<{ items: FaceItem[] }>({
    queryKey: ['faces', gender],
    queryFn: () => api.get(`/v1/models/faces?gender=${gender}`),
    enabled: !!gender && step >= 2,
  });

  const { data: backgrounds } = useQuery<{ items: BackgroundItem[] }>({
    queryKey: ['backgrounds'],
    queryFn: () => api.get('/v1/models/backgrounds'),
    enabled: step >= 3,
  });

  const { data: poses } = useQuery<{ items: PoseItem[] }>({
    queryKey: ['poses', subcategoryId, faceId, backgroundId],
    queryFn: () => api.get(`/v1/models/poses?subcategoryId=${subcategoryId}&faceId=${faceId}&backgroundId=${backgroundId}`),
    enabled: !!(subcategoryId && faceId && backgroundId && step >= 4),
  });

  async function handleGarmentUpload(file: File) {
    setGarmentFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const { uploadUrl, r2Key } = await api.post<{ uploadUrl: string; r2Key: string; expiresIn: number }>(
        '/v1/uploads/presign',
        { contentType: file.type, contentLength: file.size },
      );
      await api.uploadToR2WithProgress(uploadUrl, file, setUploadProgress);
      setGarmentKey(r2Key);
    } catch (e) {
      alert(`Upload failed: ${(e as Error).message}`);
      setGarmentFile(null);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSubmit() {
    if (!garmentKey || !faceId || !backgroundId || !poseId) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const { jobId } = await api.post<{ jobId: string }>('/v1/jobs/tryon', {
        inputs: { upperGarmentKey: garmentKey, faceId, backgroundId, poseId },
      });
      router.push(`/jobs/${jobId}`);
    } catch (e) {
      setSubmitError((e as Error).message);
      setIsSubmitting(false);
    }
  }

  const canNext = () => {
    if (step === 0) return !!gender && !!subcategoryId;
    if (step === 1) return !!garmentKey && !isUploading;
    if (step === 2) return !!faceId;
    if (step === 3) return !!backgroundId;
    if (step === 4) return !!poseId;
    return true;
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div>
        <h1 className="text-2xl font-bold">New Virtual Try-On</h1>
        <div className="mt-4 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className={cn(
                'flex h-7 items-center rounded-full px-3 text-xs font-medium transition-colors',
                i === step ? 'bg-primary text-primary-foreground' :
                i < step ? 'bg-primary/20 text-primary' :
                'bg-muted text-muted-foreground',
              )}>
                {i < step ? <Check className="h-3.5 w-3.5" /> : s}
              </div>
              {i < STEPS.length - 1 && <div className={cn('h-px w-4', i < step ? 'bg-primary' : 'bg-muted')} />}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="rounded-xl border p-6">
        {/* Step 0: Category */}
        {step === 0 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Select Category</h2>
            <div>
              <p className="mb-3 text-sm font-medium text-muted-foreground">Gender</p>
              <div className="flex flex-wrap gap-2">
                {GENDERS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => { setGender(g.value); setSubcategoryId(''); }}
                    className={cn(
                      'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                      gender === g.value ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-muted-foreground',
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            {gender && (
              <div>
                <p className="mb-3 text-sm font-medium text-muted-foreground">Garment type</p>
                {!subcategories ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {subcategories.items.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSubcategoryId(s.id)}
                        className={cn(
                          'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                          subcategoryId === s.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-muted-foreground',
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 1: Upload garment */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Upload Garment</h2>
            <p className="text-sm text-muted-foreground">Upload a clear photo of the garment on a white background for best results.</p>
            <div
              className={cn(
                'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors cursor-pointer',
                garmentFile ? 'border-primary/40 bg-primary/5' : 'hover:border-muted-foreground',
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleGarmentUpload(f); }}
              />
              {isUploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm font-medium">Uploading… {uploadProgress}%</p>
                  <div className="h-2 w-48 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              ) : garmentFile ? (
                <div className="flex flex-col items-center gap-3">
                  <Check className="h-8 w-8 text-primary" />
                  <p className="text-sm font-medium">{garmentFile.name}</p>
                  <p className="text-xs text-muted-foreground">Click to replace</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Click to upload</p>
                    <p className="text-xs text-muted-foreground">JPEG, PNG, WebP · max 10MB</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Select face */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Select Model</h2>
            {!faces ? (
              <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {faces.items.map((f) => (
                  <SelectCard key={f.id} selected={faceId === f.id} onClick={() => setFaceId(f.id)} imageUrl={f.thumbnailUrl} label={f.label} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Select background */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Select Background</h2>
            {!backgrounds ? (
              <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {backgrounds.items.map((b) => (
                  <SelectCard key={b.id} selected={backgroundId === b.id} onClick={() => setBackgroundId(b.id)} imageUrl={b.thumbnailUrl} label={b.label} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Select pose */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Select Pose</h2>
            {!poses ? (
              <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : poses.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No poses available for this combination. Try a different model or background.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {poses.items.map((p) => (
                  <SelectCard key={p.id} selected={poseId === p.id} onClick={() => setPoseId(p.id)} imageUrl={p.thumbnailUrl} label={p.label} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Review & submit */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Review & Submit</h2>
            <p className="text-sm text-muted-foreground">Your try-on will use 1 credit. Results take about 1–2 minutes.</p>
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Garment</span><span className="font-medium">{garmentFile?.name ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Credits charged</span><span className="font-medium">1</span></div>
            </div>
            {submitError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{submitError}</p>}
            <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : 'Start Try-On'}
            </Button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
          <ChevronLeft className="mr-1 h-4 w-4" />Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>
            Next<ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
