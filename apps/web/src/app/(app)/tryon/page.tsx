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
interface CatalogItem { id: string; label: string; thumbnailUrl: string }
interface CatalogNode { id: number; slug: string; label: string; children: CatalogNode[]; items: CatalogItem[] }

function flattenCatalog(nodes: CatalogNode[]): CatalogItem[] {
  return nodes.flatMap((n) => [...n.items, ...flattenCatalog(n.children)]);
}

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
  'Choose Templates',
  'Lower & Shoes',
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
const ShirtIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/>
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

// ── Selection card (model / bg / pose / catalog) ──────────────────────
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

// ── Section header inside step ─────────────────────────────────────────
function SectionHead({ title, sub, badge }: { title: string; sub?: string; badge?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h2 style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em', margin: 0 }}>{title}</h2>
        {badge && (
          <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: 'rgba(246,181,83,0.15)', color: 'var(--amber)', border: '1px solid rgba(246,181,83,0.25)' }}>
            {badge}
          </span>
        )}
      </div>
      {sub && <p style={{ fontSize: 14, color: 'var(--mute)', margin: 0 }}>{sub}</p>}
    </div>
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

  // Wizard step (0–4)
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

  // Steps 1–4
  const [faceId, setFaceId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [lowerCatalogId, setLowerCatalogId] = useState('');
  const [shoeCatalogId, setShoeCatalogId] = useState('');

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

  const selectedPoses = poses?.items.filter((p) => poseIds.includes(p.id)) ?? [];
  const needsLower = selectedPoses.some((p) => p.showsLower);
  const needsShoes = selectedPoses.some((p) => p.showsShoes);

  const { data: lowerCatalog } = useQuery<{ type: string; tree: CatalogNode[] }>({
    queryKey: ['catalog', 'lower', gender],
    queryFn: () => api.get(`/v1/catalog/lower${gender ? `?gender=${gender}` : ''}`),
    enabled: step >= 4 && needsLower,
  });

  const { data: shoesCatalog } = useQuery<{ type: string; tree: CatalogNode[] }>({
    queryKey: ['catalog', 'shoe', gender],
    queryFn: () => api.get(`/v1/catalog/shoe${gender ? `?gender=${gender}` : ''}`),
    enabled: step >= 4 && needsShoes,
  });

  const lowerItems = lowerCatalog ? flattenCatalog(lowerCatalog.tree) : [];
  const shoeItems = shoesCatalog ? flattenCatalog(shoesCatalog.tree) : [];

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
    setPoseIds([]);
    setLowerCatalogId('');
    setShoeCatalogId('');
  }
  function handleBackgroundSelect(id: string) {
    setBackgroundId(id);
    setPoseIds([]);
    setLowerCatalogId('');
    setShoeCatalogId('');
  }
  function handlePoseSelect(id: string) {
    setPoseIds((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);
    setLowerCatalogId('');
    setShoeCatalogId('');
  }

  async function handleSubmit() {
    if (!garmentKey || !faceId || !backgroundId || poseIds.length === 0) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const { catalogueId } = await api.post<{ catalogueId: string }>('/v1/jobs/tryon', {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          backgroundId,
          poseIds,
          lowerCatalogId: lowerCatalogId || undefined,
          shoeCatalogId: shoeCatalogId || undefined,
        },
      });
      router.push(`/catalogues/${catalogueId}`);
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
    if (step === 3) return poseIds.length > 0;
    return true;
  };

  const canGenerate =
    poseIds.length > 0 && !!garmentKey && !isUploading && !isSubmitting &&
    (!needsLower || !!lowerCatalogId) &&
    (!needsShoes || !!shoeCatalogId);

  function goNext() {
    if (step < 4) {
      setStep((s) => s + 1);
      showToast(`Step ${step + 2} · ${STEPS[step + 1]}`);
    }
  }
  function goBack() { if (step > 0) setStep((s) => s - 1); }

  const selectedFace = faces?.items.find((f) => f.id === faceId);
  const selectedBg = backgrounds?.items.find((b) => b.id === backgroundId);
  const selectedLower = lowerItems.find((i) => i.id === lowerCatalogId);
  const selectedShoe = shoeItems.find((i) => i.id === shoeCatalogId);

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
                    className="av-dropzone"
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
              <SectionHead title="Select AI Model" sub="Choose the model that will wear your garment." />
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
              <SectionHead
                title="Select Background"
                sub={`Preview of ${selectedFace?.label ?? 'model'} in each background. Pick one to continue.`}
              />
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

          {/* ── Step 3: Pose ─────────────────────────── */}
          {step === 3 && (
            <div>
              <SectionHead
                title="Choose Template"
                sub={`Poses for ${selectedFace?.label ?? 'model'} on ${selectedBg?.label ?? 'background'}. Select one or more.`}
              />
              {poseIds.length > 0 && (
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--peach)' }}>{poseIds.length} selected</span>
                  <button type="button" onClick={() => setPoseIds([])} style={{ fontSize: 12, color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
                </div>
              )}
              {!poses ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><SpinnerIcon /></div>
              ) : poses.items.length === 0 ? (
                <p style={{ fontSize: 14, color: 'var(--mute)' }}>No poses for this combination. Go back and try a different background.</p>
              ) : (
                <div className="av-sel-grid">
                  {poses.items.map((p) => (
                    <div key={p.id} style={{ position: 'relative' }}>
                      <SelCard selected={poseIds.includes(p.id)} onClick={() => handlePoseSelect(p.id)} imageUrl={p.thumbnailUrl} label={p.label} />
                      {(p.showsLower || p.showsShoes) && (
                        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none' }}>
                          {p.showsLower && (
                            <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(246,181,83,0.92)', color: '#7a5200', letterSpacing: '.02em' }}>LOWER</span>
                          )}
                          {p.showsShoes && (
                            <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(32,158,70,0.92)', color: 'white', letterSpacing: '.02em' }}>SHOES</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {(needsLower || needsShoes) && poseIds.length > 0 && (
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, background: 'rgba(246,181,83,0.08)', border: '1px solid rgba(246,181,83,0.2)' }}>
                  <span style={{ fontSize: 18 }}>👕</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>This template needs additional items</p>
                    <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0' }}>
                      Next step: pick {[needsLower && 'lower garment', needsShoes && 'shoes'].filter(Boolean).join(' & ')}.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Lower & Shoes ────────────────── */}
          {step === 4 && (
            <div>
              {!needsLower && !needsShoes ? (
                /* Pose needs neither — show info + jump to review */
                <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', marginBottom: 14, color: 'var(--mute)' }}>
                    <ShirtIcon />
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 6px' }}>No extra garments needed</p>
                  <p style={{ fontSize: 13, color: 'var(--mute)', margin: 0, maxWidth: 320 }}>
                    The selected template is a close-up crop — no lower garment or shoes will be visible in the output.
                  </p>
                </div>
              ) : (
                <>
                  {/* Lower garment section */}
                  {needsLower && (
                    <div style={{ marginBottom: 28 }}>
                      <SectionHead
                        title="Lower Garment"
                        sub="Select a bottom — pants, skirt or shorts — that pairs with your top."
                        badge="Required"
                      />
                      {!lowerCatalog ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}><SpinnerIcon /></div>
                      ) : lowerItems.length === 0 ? (
                        <p style={{ fontSize: 14, color: 'var(--mute)' }}>No lower garment options available yet.</p>
                      ) : (
                        <div className="av-sel-grid">
                          {lowerItems.map((item) => (
                            <SelCard
                              key={item.id}
                              selected={lowerCatalogId === item.id}
                              onClick={() => setLowerCatalogId(lowerCatalogId === item.id ? '' : item.id)}
                              imageUrl={item.thumbnailUrl}
                              label={item.label}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Shoes section */}
                  {needsShoes && (
                    <div style={{ marginBottom: 28 }}>
                      {needsLower && <div style={{ height: 1, background: 'var(--line)', marginBottom: 28 }} />}
                      <SectionHead
                        title="Shoes"
                        sub="Pick a footwear style to complete the look."
                        badge="Required"
                      />
                      {!shoesCatalog ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}><SpinnerIcon /></div>
                      ) : shoeItems.length === 0 ? (
                        <p style={{ fontSize: 14, color: 'var(--mute)' }}>No shoe options available yet.</p>
                      ) : (
                        <div className="av-sel-grid">
                          {shoeItems.map((item) => (
                            <SelCard
                              key={item.id}
                              selected={shoeCatalogId === item.id}
                              onClick={() => setShoeCatalogId(shoeCatalogId === item.id ? '' : item.id)}
                              imageUrl={item.thumbnailUrl}
                              label={item.label}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Divider */}
              <div style={{ height: 1, background: 'var(--line)', margin: '4px 0 20px' }} />

              {/* Review summary */}
              <SectionHead title="Review & Generate" sub="Confirm your selections before generating." />
              <div className="av-review">
                {[
                  ['Model', selectedFace?.label ?? '—'],
                  ['Background', selectedBg?.label ?? '—'],
                  ['Poses', poseIds.length > 0 ? `${poseIds.length} selected` : '—'],
                  ['Garment', garmentFile?.name ?? (sampleIdx > 0 ? `Sample ${sampleIdx}` : '—')],
                  ...(needsLower ? [['Lower', selectedLower?.label ?? '—'] as [string, string]] : []),
                  ...(needsShoes ? [['Shoes', selectedShoe?.label ?? '—'] as [string, string]] : []),
                  ['Credits charged', String(poseIds.length)],
                ].map(([k, v]) => (
                  <div key={k} className="av-review-row">
                    <span className="av-review-key">{k}</span>
                    <span className="av-review-val" style={{ color: v === '—' ? 'var(--mute)' : undefined }}>{v}</span>
                  </div>
                ))}
              </div>

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
        <button type="button" className="av-btn av-btn-ghost" onClick={step === 0 ? () => { setGender(''); setSubcategoryId(''); setFaceId(''); setBackgroundId(''); setPoseIds([]); setLowerCatalogId(''); setShoeCatalogId(''); setGarmentFile(null); setGarmentKey(''); setSampleIdx(0); setStep(0); showToast('Setup reset'); } : goBack}>
          {step === 0 ? 'Reset' : '← Back'}
        </button>

        {step < 4 ? (
          <button type="button" className="av-btn av-btn-primary" onClick={goNext} disabled={!canNext()}>
            Next Step →
          </button>
        ) : (
          <button
            type="button"
            className="av-btn av-btn-primary"
            onClick={handleSubmit}
            disabled={!canGenerate}
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
