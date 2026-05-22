'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { api } from '@/lib/api';

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

const PLATFORMS = ['Amazon', 'Myntra', 'Flipkart', 'Ajio', 'Shopify', 'Meesho'];
const ASPECTS = ['1:1', '4:5', '3:4', '9:16', '16:9'];

const STEPS = [
  'Setup Your Catalogue',
  'Select AI Models',
  'Select Backgrounds',
  'Choose Templates & Generate',
];

// ── Icons ──────────────────────────────────────────────────────────────
const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={size > 14 ? 2.6 : 2.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5L20 7"/>
  </svg>
);
const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 6l12 12M6 18L18 6"/>
  </svg>
);
const UploadIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>
  </svg>
);
const SpinnerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="av-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);
const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6"/>
  </svg>
);
const BoltIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
  </svg>
);

// ── Dropdown Select ────────────────────────────────────────────────────
function Select({ value, options, onChange, placeholder }: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }, []);
  useEffect(() => {
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [close]);
  return (
    <div className="av-select" ref={ref}>
      <button type="button" className={`av-select-trigger ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span>{value || <span style={{ color: 'var(--mute-2)' }}>{placeholder}</span>}</span>
        <span className="av-select-chev"><ChevronDown /></span>
      </button>
      <div className={`av-select-menu ${open ? 'open' : ''}`} role="listbox">
        {options.map((opt) => (
          <button key={opt} type="button" className={`av-select-opt ${opt === value ? 'selected' : ''}`}
            onClick={() => { onChange(opt); setOpen(false); }}>
            <span>{opt}</span>
            <span className="av-select-check"><CheckIcon /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Selection card (model / bg / pose) ────────────────────────────────
function SelCard({ selected, onClick, imageUrl, label }: { selected: boolean; onClick: () => void; imageUrl: string; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`av-sel-card ${selected ? 'on' : ''}`}>
      <div className="av-sel-img">
        <Image src={imageUrl} alt={label} width={160} height={213} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div className="av-sel-label">{label}</div>
      <div className="av-sel-check"><CheckIcon size={12} /></div>
    </button>
  );
}

// ── Guide panel ────────────────────────────────────────────────────────
function Guide() {
  return (
    <div className="av-guide">
      <div className="av-guide-item">
        <div className="av-guide-head">
          <div className="av-guide-badge ok"><CheckIcon size={13} /></div>
          <div className="av-guide-title">Works Best</div>
        </div>
        <div className="av-guide-body">Clean flat lay images with proper lighting, fully visible garments and plain backgrounds generate the most accurate, realistic catalogues.</div>
        <ul className="av-guide-list">
          <li>Even, diffuse daylight</li>
          <li>Minimal wrinkles, garment laid flat</li>
          <li>Plain, contrasting background</li>
        </ul>
      </div>
      <div className="av-guide-item">
        <div className="av-guide-head">
          <div className="av-guide-badge no"><XIcon /></div>
          <div className="av-guide-title">Avoid These</div>
        </div>
        <div className="av-guide-body">Blurry images, cluttered backgrounds, cropped garments, heavy shadows, folded outfits and mannequin photos reduce output quality.</div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export default function TryOnPage() {
  const router = useRouter();

  // Wizard step (0–3)
  const [step, setStep] = useState(0);

  // Step 0: setup
  const [gender, setGender] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [platform, setPlatform] = useState('Amazon');
  const [aspect, setAspect] = useState('1:1');
  const [resolution, setResolution] = useState('2K');
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentKey, setGarmentKey] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [sampleIdx, setSampleIdx] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Steps 1–3
  const [faceId, setFaceId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');
  const [poseId, setPoseId] = useState('');

  // Submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Toast
  const [toast, setToast] = useState('');
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }, []);

  // API queries
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

  const { data: backgrounds } = useQuery<{ items: BackgroundItem[] }>({
    queryKey: ['backgrounds', faceId, subcategoryId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (faceId) p.set('faceId', faceId);
      if (subcategoryId) p.set('subcategoryId', subcategoryId);
      return api.get(`/v1/models/backgrounds?${p}`);
    },
    enabled: !!faceId && step >= 2,
  });

  const { data: poses } = useQuery<{ items: PoseItem[] }>({
    queryKey: ['poses', subcategoryId, faceId, backgroundId],
    queryFn: () => api.get(`/v1/models/poses?subcategoryId=${subcategoryId}&faceId=${faceId}&backgroundId=${backgroundId}`),
    enabled: !!(subcategoryId && faceId && backgroundId && step >= 3),
  });

  // Garment upload
  async function handleGarmentUpload(file: File) {
    setGarmentFile(file);
    setSampleIdx(0);
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
      showToast(`Upload failed: ${(e as Error).message}`);
      setGarmentFile(null);
    } finally {
      setIsUploading(false);
    }
  }

  function handleFaceSelect(id: string) {
    setFaceId(id);
    setBackgroundId('');
    setPoseId('');
  }
  function handleBackgroundSelect(id: string) {
    setBackgroundId(id);
    setPoseId('');
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

  // Validation
  const canNext = (): boolean => {
    if (step === 0) return !!gender && !!subcategoryId && (!!garmentFile || !!garmentKey);
    if (step === 1) return !!faceId;
    if (step === 2) return !!backgroundId;
    return !!poseId;
  };

  function goNext() {
    if (step < 3) {
      setStep((s) => s + 1);
      showToast(`Step ${step + 2} · ${STEPS[step + 1]}`);
    }
  }
  function goBack() { if (step > 0) setStep((s) => s - 1); }

  const selectedFace = faces?.items.find((f) => f.id === faceId);
  const selectedBg = backgrounds?.items.find((b) => b.id === backgroundId);
  const selectedPose = poses?.items.find((p) => p.id === poseId);

  return (
    <div className="av-main-inner">
      {/* Page header */}
      <div className="av-page-head">
        <h1>Start Creating Catalogue</h1>
        <p>Generate premium ecommerce-ready model shoots from flat lay garments in minutes.</p>
      </div>

      {/* Stepper */}
      <div className="av-stepper">
        {STEPS.map((label, i) => {
          const state = i < step ? 'done' : i === step ? 'active' : '';
          return (
            <div key={i} className={`av-step ${state}`}>
              <div className="av-step-num">
                {state === 'done' ? <CheckIcon /> : i + 1}
              </div>
              <div className="av-step-label">{label}</div>
            </div>
          );
        })}
      </div>

      {/* Content grid */}
      <div className="av-work">
        <div className="av-card">

          {/* ── Step 0: Setup ────────────────────────── */}
          {step === 0 && (
            <>
              <div className="av-row-2">
                <div className="av-field">
                  <label className="av-field-label">Catalogue For</label>
                  <Select value={gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : ''} options={GENDERS.map((g) => g.label)} onChange={(v) => { setGender(v.toLowerCase()); setSubcategoryId(''); }} placeholder="Select gender" />
                </div>
                <div className="av-field">
                  <label className="av-field-label">Outfit Type</label>
                  <Select
                    value={subcategories?.items.find((s) => s.id === subcategoryId)?.label ?? ''}
                    options={subcategories?.items.map((s) => s.label) ?? []}
                    onChange={(v) => setSubcategoryId(subcategories?.items.find((s) => s.label === v)?.id ?? '')}
                    placeholder={gender ? 'Select type' : 'Pick gender first'}
                  />
                </div>
              </div>

              <div className="av-field">
                <label className="av-field-label">Publishing Platform</label>
                <div className="av-chips">
                  {PLATFORMS.map((p) => (
                    <button key={p} type="button" className={`av-chip ${platform === p ? 'on' : ''}`} onClick={() => setPlatform(p)}>{p}</button>
                  ))}
                </div>
              </div>

              <div className="av-field">
                <label className="av-field-label">Aspect Ratio</label>
                <div className="av-chips">
                  {ASPECTS.map((a) => (
                    <button key={a} type="button" className={`av-chip ${aspect === a ? 'on' : ''}`} onClick={() => setAspect(a)}>{a}</button>
                  ))}
                </div>
              </div>

              <div className="av-field">
                <label className="av-field-label">Output Resolution</label>
                <div className="av-radio-row">
                  {[{ id: '2K', meta: '4 credits' }, { id: '4K', meta: '8 credits' }].map((o) => (
                    <button key={o.id} type="button" className={`av-radio ${resolution === o.id ? 'on' : ''}`} onClick={() => setResolution(o.id)}>
                      <span className="av-radio-dot" />
                      <span className="av-radio-ttl">{o.id}</span>
                      <span className="av-radio-meta">({o.meta})</span>
                    </button>
                  ))}
                </div>
                <div className="av-helper-row">
                  <span className="av-helper-pip" />
                  Credits deduct from your balance at generation time.
                </div>
              </div>

              <div className="av-field">
                <label className="av-field-label">
                  Upload Product <span className="av-field-hint">or pick a sample</span>
                </label>
                <div className="av-upload-grid">
                  <label
                    className={`av-dropzone ${!garmentFile ? '' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('over');
                      const f = e.dataTransfer.files?.[0];
                      if (f && ['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) handleGarmentUpload(f);
                    }}
                  >
                    {garmentFile ? (
                      <div className="av-uploaded">
                        <img src={URL.createObjectURL(garmentFile)} alt={garmentFile.name} />
                        <button className="av-uploaded-rm" type="button" onClick={(e) => { e.preventDefault(); setGarmentFile(null); setGarmentKey(''); }}>
                          <XIcon />
                        </button>
                        {isUploading && (
                          <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, background: 'rgba(255,255,255,0.9)', borderRadius: 8, padding: '6px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)' }}>
                              <SpinnerIcon /> Uploading… {uploadProgress}%
                            </div>
                            <div style={{ marginTop: 4, height: 4, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--grad)', borderRadius: 99, transition: 'width .3s' }} />
                            </div>
                          </div>
                        )}
                        {garmentKey && (
                          <div style={{ position: 'absolute', top: 8, left: 8, background: 'var(--mint)', color: 'white', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <CheckIcon size={10} /> Uploaded
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="av-dropzone-ico"><UploadIcon /></div>
                        <div className="av-dropzone-ttl">Drag & drop or click to browse</div>
                        <div className="av-dropzone-sub">Supported formats: JPG, PNG, WebP · Max 10MB</div>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleGarmentUpload(f); }}
                    />
                  </label>

                  <div className="av-samples">
                    <h4>Or use a sample product</h4>
                    <div className="av-samples-grid">
                      {[1, 2].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`av-sample ${sampleIdx === n ? 'on' : ''}`}
                          onClick={() => {
                            setSampleIdx(sampleIdx === n ? 0 : n);
                            if (garmentFile) { setGarmentFile(null); setGarmentKey(''); }
                          }}
                        >
                          <img src={`/samples/sample-${n}.png`} alt={`Sample ${n}`} />
                          <span className="av-sample-check"><CheckIcon size={11} /></span>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--mute)', lineHeight: 1.5 }}>
                      Try the generator first with a curated sample garment.
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Step 1: Model ────────────────────────── */}
          {step === 1 && (
            <div>
              <h2 style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Select AI Model</h2>
              <p style={{ fontSize: 14, color: 'var(--mute)', margin: '0 0 20px' }}>Choose the model that will wear your garment.</p>
              {!faces ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><SpinnerIcon /></div>
              ) : (
                <div className="av-sel-grid">
                  {faces.items.map((f) => (
                    <SelCard key={f.id} selected={faceId === f.id} onClick={() => handleFaceSelect(f.id)} imageUrl={f.thumbnailUrl} label={f.label} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Background ───────────────────── */}
          {step === 2 && (
            <div>
              <h2 style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Select Background</h2>
              <p style={{ fontSize: 14, color: 'var(--mute)', margin: '0 0 20px' }}>
                Preview of <strong style={{ color: 'var(--ink)' }}>{selectedFace?.label ?? 'model'}</strong> in each background. Pick one to continue.
              </p>
              {!backgrounds ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><SpinnerIcon /></div>
              ) : backgrounds.items.length === 0 ? (
                <p style={{ fontSize: 14, color: 'var(--mute)' }}>No backgrounds available for this model yet. Try a different model.</p>
              ) : (
                <div className="av-sel-grid">
                  {backgrounds.items.map((b) => (
                    <SelCard key={b.id} selected={backgroundId === b.id} onClick={() => handleBackgroundSelect(b.id)} imageUrl={b.previewUrl} label={b.label} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Pose + Generate ──────────────── */}
          {step === 3 && (
            <div>
              <h2 style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Choose Template & Generate</h2>
              <p style={{ fontSize: 14, color: 'var(--mute)', margin: '0 0 20px' }}>
                Showing poses for <strong style={{ color: 'var(--ink)' }}>{selectedFace?.label}</strong> on <strong style={{ color: 'var(--ink)' }}>{selectedBg?.label}</strong>.
              </p>
              {!poses ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><SpinnerIcon /></div>
              ) : poses.items.length === 0 ? (
                <p style={{ fontSize: 14, color: 'var(--mute)' }}>No poses for this combination. Go back and try a different background.</p>
              ) : (
                <div className="av-sel-grid">
                  {poses.items.map((p) => (
                    <SelCard key={p.id} selected={poseId === p.id} onClick={() => setPoseId(p.id)} imageUrl={p.thumbnailUrl} label={p.label} />
                  ))}
                </div>
              )}

              {/* Review summary */}
              {poseId && (
                <div className="av-review">
                  {[
                    ['Model', selectedFace?.label ?? '—'],
                    ['Background', selectedBg?.label ?? '—'],
                    ['Pose', selectedPose?.label ?? '—'],
                    ['Garment', garmentFile?.name ?? (sampleIdx > 0 ? `Sample ${sampleIdx}` : '—')],
                    ['Credits charged', '1'],
                  ].map(([k, v]) => (
                    <div key={k} className="av-review-row">
                      <span className="av-review-key">{k}</span>
                      <span className="av-review-val">{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {submitError && (
                <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, border: '1px solid #f55c7a', background: 'rgba(245,92,122,0.06)', fontSize: 14, color: '#c0392b' }}>
                  {submitError}
                </div>
              )}

              {isUploading && (
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--mute)' }}>
                  <SpinnerIcon /> Uploading garment… {uploadProgress}%
                </div>
              )}
            </div>
          )}
        </div>

        {/* Guide panel */}
        <aside><Guide /></aside>
      </div>

      {/* Sticky footer */}
      <div className="av-footer">
        <button type="button" className="av-btn av-btn-ghost" onClick={step === 0 ? () => { setGender(''); setSubcategoryId(''); setFaceId(''); setBackgroundId(''); setPoseId(''); setGarmentFile(null); setGarmentKey(''); setSampleIdx(0); setStep(0); showToast('Setup reset'); } : goBack}>
          {step === 0 ? 'Reset' : '← Back'}
        </button>

        {step < 3 ? (
          <button type="button" className="av-btn av-btn-primary" onClick={goNext} disabled={!canNext()}>
            Next Step →
          </button>
        ) : (
          <button
            type="button"
            className="av-btn av-btn-primary"
            onClick={handleSubmit}
            disabled={!poseId || !garmentKey || isUploading || isSubmitting}
            style={{ gap: 8 }}
          >
            {isSubmitting ? (
              <><SpinnerIcon /> Generating…</>
            ) : isUploading ? (
              <><SpinnerIcon /> Uploading…</>
            ) : (
              <><BoltIcon /> Generate</>
            )}
          </button>
        )}
      </div>

      {/* Toast */}
      <div className={`av-toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
