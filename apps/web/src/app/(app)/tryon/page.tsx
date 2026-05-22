'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Upload, ChevronRight, ChevronLeft, Check, Loader2 } from 'lucide-react';

interface Subcategory { id: string; slug: string; label: string }
interface FaceItem { id: string; label: string; thumbnailUrl: string; gender: string }
interface BackgroundItem { id: string; label: string; thumbnailUrl: string; previewUrl: string }
interface PoseItem { id: string; label: string; thumbnailUrl: string; showsLower: boolean; showsShoes: boolean }

const GENDERS = [
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
  { value: 'girls', label: 'Girls' },
  { value: 'boys', label: 'Boys' },
];

// Step order: Category → Model → Background → Pose → Garment → Review
const STEPS = ['Category', 'Model', 'Background', 'Pose', 'Garment', 'Review'];

function SelectCard({ selected, onClick, imageUrl, label }: { selected: boolean; onClick: () => void; imageUrl: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative overflow-hidden transition-all focus-visible:outline-none sketch-card-sm',
        selected ? 'ring-2 ring-primary ring-offset-1' : 'hover:ring-1 hover:ring-foreground/50',
      )}
      style={{ borderRadius: '4px' }}
    >
      <div className="aspect-[3/4] w-full relative">
        <Image src={imageUrl} alt={label} fill className="object-cover" sizes="200px" />
      </div>
      <div className="p-2 text-center">
        <p className="font-body text-xs font-medium truncate">{label}</p>
      </div>
      {selected && (
        <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary border border-foreground">
          <Check className="h-3 w-3 text-foreground" />
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
    enabled: !!gender && step >= 1,
  });

  // Backgrounds filtered by faceId + subcategoryId
  // previewUrl = template pose thumbnail (model × bg composite) instead of raw background
  const { data: backgrounds } = useQuery<{ items: BackgroundItem[] }>({
    queryKey: ['backgrounds', faceId, subcategoryId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (faceId) params.set('faceId', faceId);
      if (subcategoryId) params.set('subcategoryId', subcategoryId);
      return api.get(`/v1/models/backgrounds?${params}`);
    },
    enabled: !!faceId && step >= 2,
  });

  const { data: poses } = useQuery<{ items: PoseItem[] }>({
    queryKey: ['poses', subcategoryId, faceId, backgroundId],
    queryFn: () => api.get(`/v1/models/poses?subcategoryId=${subcategoryId}&faceId=${faceId}&backgroundId=${backgroundId}`),
    enabled: !!(subcategoryId && faceId && backgroundId && step >= 3),
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

  function handleFaceSelect(id: string) {
    setFaceId(id);
    // Reset downstream when face changes
    setBackgroundId('');
    setPoseId('');
  }

  function handleBackgroundSelect(id: string) {
    setBackgroundId(id);
    // Reset pose when background changes
    setPoseId('');
  }

  const canNext = () => {
    if (step === 0) return !!gender && !!subcategoryId;
    if (step === 1) return !!faceId;
    if (step === 2) return !!backgroundId;
    if (step === 3) return !!poseId;
    if (step === 4) return !!garmentKey && !isUploading;
    return true;
  };

  const selectedFace = faces?.items.find((f) => f.id === faceId);
  const selectedBg = backgrounds?.items.find((b) => b.id === backgroundId);
  const selectedPose = poses?.items.find((p) => p.id === poseId);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="font-hand text-4xl">New Virtual Try-On</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">Build your look step by step.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={cn(
              'flex items-center rounded-full px-3 py-1 font-body text-[10px] uppercase tracking-wide border transition-colors',
              i === step ? 'border-foreground bg-foreground text-background' :
              i < step ? 'border-primary bg-accent text-foreground' :
              'border-foreground/30 text-muted-foreground',
            )}>
              {i < step ? <Check className="h-3 w-3" /> : s}
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('h-px w-4', i < step ? 'bg-primary' : 'bg-foreground/20')} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="sketch-card p-6">
        {/* Step 0: Category */}
        {step === 0 && (
          <div className="space-y-6">
            <h2 className="font-hand text-2xl">Select Category</h2>
            <div>
              <p className="mb-3 font-hand text-[17px] text-muted-foreground">Gender</p>
              <div className="flex flex-wrap gap-2">
                {GENDERS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => { setGender(g.value); setSubcategoryId(''); }}
                    className={cn(
                      'rounded-full border px-4 py-1.5 font-hand text-[17px] transition-colors',
                      gender === g.value
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-foreground/50 text-muted-foreground hover:border-foreground hover:text-foreground',
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            {gender && (
              <div>
                <p className="mb-3 font-hand text-[17px] text-muted-foreground">Garment type</p>
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
                          'rounded-full border px-4 py-1.5 font-hand text-[17px] transition-colors',
                          subcategoryId === s.id
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-foreground/50 text-muted-foreground hover:border-foreground hover:text-foreground',
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

        {/* Step 1: Select model/face */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-hand text-2xl">Select Model</h2>
            <p className="font-body text-sm text-muted-foreground">Choose the model that will wear your garment.</p>
            {!faces ? (
              <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {faces.items.map((f) => (
                  <SelectCard key={f.id} selected={faceId === f.id} onClick={() => handleFaceSelect(f.id)} imageUrl={f.thumbnailUrl} label={f.label} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Select background (filtered by face) */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-hand text-2xl">Select Background</h2>
            <p className="font-body text-sm text-muted-foreground">
              Preview of <span className="font-medium text-foreground">{selectedFace?.label ?? 'selected model'}</span> in each background. Pick one to continue.
            </p>
            {!backgrounds ? (
              <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : backgrounds.items.length === 0 ? (
              <p className="font-body text-sm text-muted-foreground">No backgrounds available for this model yet. Try a different model.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {backgrounds.items.map((b) => (
                  <SelectCard key={b.id} selected={backgroundId === b.id} onClick={() => handleBackgroundSelect(b.id)} imageUrl={b.previewUrl} label={b.label} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Select pose (face × background subset) */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-hand text-2xl">Select Pose</h2>
            <p className="font-body text-sm text-muted-foreground">
              Showing poses for <span className="font-medium text-foreground">{selectedFace?.label}</span> on <span className="font-medium text-foreground">{selectedBg?.label}</span>.
            </p>
            {!poses ? (
              <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : poses.items.length === 0 ? (
              <p className="font-body text-sm text-muted-foreground">No poses for this combination. Go back and try a different background.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {poses.items.map((p) => (
                  <SelectCard key={p.id} selected={poseId === p.id} onClick={() => setPoseId(p.id)} imageUrl={p.thumbnailUrl} label={p.label} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Upload garment */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="font-hand text-2xl">Upload Garment</h2>
            <p className="font-body text-sm text-muted-foreground">Clear photo on white background gives best results.</p>
            <div
              className={cn(
                'flex flex-col items-center justify-center rounded p-12 transition-colors cursor-pointer sketch-border',
                garmentFile ? 'bg-accent/30' : 'hover:bg-secondary border-dashed',
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
                  <p className="font-hand text-lg">Uploading… {uploadProgress}%</p>
                  <div className="h-2 w-48 rounded-full border border-foreground overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              ) : garmentFile ? (
                <div className="flex flex-col items-center gap-3">
                  <Check className="h-8 w-8 text-primary" />
                  <p className="font-hand text-lg">{garmentFile.name}</p>
                  <p className="font-body text-xs text-muted-foreground">Click to replace</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-hand text-lg">Drop or click to upload</p>
                    <p className="font-body text-xs text-muted-foreground">JPEG, PNG, WebP · max 10MB</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Review & submit */}
        {step === 5 && (
          <div className="space-y-5">
            <h2 className="font-hand text-2xl">Review & Submit</h2>
            <p className="font-body text-sm text-muted-foreground">Your try-on will use 1 credit. Results take about 1–2 minutes.</p>

            <div className="sketch-card-sm p-4 space-y-2">
              {[
                ['Model', selectedFace?.label ?? '—'],
                ['Background', selectedBg?.label ?? '—'],
                ['Pose', selectedPose?.label ?? '—'],
                ['Garment', garmentFile?.name ?? '—'],
                ['Credits charged', '1'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between font-body text-sm">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium text-foreground">{v}</span>
                </div>
              ))}
            </div>

            {submitError && (
              <p className="rounded border border-destructive bg-destructive/10 px-3 py-2 font-body text-sm text-destructive">{submitError}</p>
            )}
            <Button onClick={handleSubmit} disabled={isSubmitting} size="lg">
              {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : 'Start Try-On →'}
            </Button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
          <ChevronLeft className="mr-1 h-4 w-4" />Back
        </Button>
        {step < STEPS.length - 1 && (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>
            Next<ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
