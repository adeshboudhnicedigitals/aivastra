'use client';
import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { api } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

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
  { value: 'women', label: 'Women', img: '/assets/seg-women.png' },
  { value: 'men', label: 'Men', img: null },
  { value: 'girls', label: 'Girls', img: null },
  { value: 'boys', label: 'Boys', img: null },
];

const PLATFORMS = ['Amazon', 'Myntra', 'Flipkart', 'Ajio', 'Shopify', 'Meesho'];
const ASPECTS = ['1:1', '4:5', '3:4', '9:16', '16:9'];

const STEPS = ['Setup', 'AI Models', 'Backgrounds', 'Generate'];
// Map internal step index (0–4) to visible stepper index (0–3)
function visibleStep(s: number) { return Math.min(s, 3); }

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

// ── Visual card (gender / outfit type selection) ───────────────────────
function VisualCard({ selected, onClick, img, label, w = 100, h = 110 }: { selected: boolean; onClick: () => void; img: string | null; label: string; w?: number; h?: number }) {
  const grad = 'linear-gradient(135deg, #F55C7A 0%, #F6B553 100%)';
  return (
    <button type="button" onClick={onClick} style={{ cursor: 'pointer', textAlign: 'center', background: 'none', border: 'none', padding: 0, flexShrink: 0 }}>
      <div style={{
        width: w, height: h, borderRadius: 8, overflow: 'hidden', position: 'relative',
        border: selected ? '2px solid transparent' : '2px solid var(--line)',
        background: selected ? grad : 'none',
        padding: selected ? 2 : 0, boxSizing: 'border-box',
      }}>
        <div style={{ width: '100%', height: '100%', borderRadius: selected ? 6 : 6, overflow: 'hidden', background: '#f0f0f0' }}>
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #f5f5f5, #e8e8e8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#aaa' }}>{label}</div>
          )}
        </div>
        {selected && (
          <div style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%', background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckIcon size={11} />
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginTop: 8 }}>{label}</div>
    </button>
  );
}

// ── Selection card (model / bg / pose / catalog) ──────────────────────
function SelCard({ selected, onClick, imageUrl, label }: { selected: boolean; onClick: () => void; imageUrl: string; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`av-sel-card ${selected ? 'on' : ''}`}>
      <div className="av-sel-img">
        <Image src={imageUrl} alt={label} width={160} height={213} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div className="av-sel-overlay" />
        <div className="av-sel-check"><CheckIcon size={22} /></div>
      </div>
      <div className="av-sel-label">{label}</div>
    </button>
  );
}

// ── Section header inside step ─────────────────────────────────────────
function SectionHead({ title, sub, badge }: { title: string; sub?: string; badge?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', margin: 0 }}>{title}</h3>
        {badge && (
          <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: 'rgba(246,181,83,0.15)', color: 'var(--amber)', border: '1px solid rgba(246,181,83,0.25)' }}>
            {badge}
          </span>
        )}
      </div>
      {sub && <p style={{ fontSize: 13, color: 'var(--mute)', margin: 0 }}>{sub}</p>}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export default function TryOnPage(): React.ReactElement {
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

  // Filter state for model/background steps
  const [modelFilter, setModelFilter] = useState('All');
  const [bgFilter, setBgFilter] = useState('All');

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* TopBar with stepper */}
      <div className="av-topbar">
        <div>
          <div className="av-topbar-title">Create Catalogue</div>
          <div className="av-topbar-sub">Create premium AI catalogue shoots from flat lay garments in minutes.</div>
        </div>
        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {STEPS.map((s, i) => {
            const vs = visibleStep(step);
            const done = i < vs;
            const active = i === vs;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? '#141414' : done ? 'var(--grad)' : 'var(--line)',
                    fontSize: 10, fontWeight: 600, color: (active || done) ? '#FEFEFE' : 'var(--mute)', flexShrink: 0,
                  }}>
                    {done ? <CheckIcon /> : i + 1}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 500, color: active ? 'var(--ink)' : 'var(--mute)', whiteSpace: 'nowrap' }}>{s}</span>
                </div>
                {i < STEPS.length - 1 && <div style={{ width: 32, height: 1, background: 'var(--line)', margin: '0 8px' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div>

          {/* ── Step 0: Setup ────────────────────────── */}
          {step === 0 && (
            <>
              {/* Catalogue For (visual cards) */}
              <section>
                <SectionHead title="Catalogue For" />
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {GENDERS.map((g) => (
                    <VisualCard
                      key={g.value}
                      img={g.img}
                      label={g.label}
                      selected={gender === g.value}
                      onClick={() => { setGender(g.value); setSubcategoryId(''); }}
                      w={100} h={110}
                    />
                  ))}
                </div>
              </section>

              {/* Outfit Type (visual cards from API) */}
              <section>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', margin: 0 }}>Outfit Type</h3>
                </div>
                {!gender ? (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>Select a gender first.</p>
                ) : !subcategories ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--mute)' }}><SpinnerIcon /> Loading…</div>
                ) : (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {subcategories.items.map((s) => {
                      const OUTFIT_IMG: Record<string, string> = {
                        kurta: `${BASE}/assets/outfit-kurta.png`,
                        saree: `${BASE}/assets/outfit-saree.png`,
                        top: `${BASE}/assets/outfit-top.png`,
                      };
                      const imgKey = Object.keys(OUTFIT_IMG).find((k) => s.slug.toLowerCase().includes(k) || s.label.toLowerCase().includes(k));
                      return (
                        <VisualCard
                          key={s.id}
                          img={imgKey ? (OUTFIT_IMG[imgKey] ?? null) : null}
                          label={s.label}
                          selected={subcategoryId === s.id}
                          onClick={() => setSubcategoryId(subcategoryId === s.id ? '' : s.id)}
                          w={100} h={110}
                        />
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Platform + Aspect Ratio row */}
              <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                <section style={{ flex: 1, minWidth: 260 }}>
                  <SectionHead title="Publishing Platform" />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {PLATFORMS.map((p) => (
                      <button key={p} type="button" onClick={() => setPlatform(p)} style={{
                        padding: '7px 14px', borderRadius: 8,
                        border: `1px solid ${platform === p ? 'var(--peach)' : 'var(--line)'}`,
                        background: platform === p ? 'rgba(245,92,122,0.08)' : 'var(--surface)',
                        color: platform === p ? 'var(--peach)' : 'var(--ink)',
                        fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      }}>{p}</button>
                    ))}
                  </div>
                </section>
                <section style={{ flex: 1, minWidth: 180 }}>
                  <SectionHead title="Aspect Ratio" />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ASPECTS.map((a) => (
                      <button key={a} type="button" onClick={() => setAspect(a)} style={{
                        padding: '7px 14px', borderRadius: 8,
                        border: `1px solid ${aspect === a ? 'var(--peach)' : 'var(--line)'}`,
                        background: aspect === a ? 'rgba(245,92,122,0.08)' : 'var(--surface)',
                        color: aspect === a ? 'var(--peach)' : 'var(--ink)',
                        fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      }}>{a}</button>
                    ))}
                  </div>
                </section>
              </div>

              {/* Upload Garment Image */}
              <section>
                <SectionHead title="Upload Garment Image" />
                <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {/* Upload zone */}
                  <label
                    style={{
                      flex: 1, minWidth: 200, maxWidth: 320,
                      border: '1.5px dashed var(--line)', borderRadius: 10,
                      padding: '28px 20px', textAlign: 'center', background: 'var(--surface)', cursor: 'pointer', display: 'block', position: 'relative',
                    }}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f && ['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) handleGarmentUpload(f);
                    }}
                  >
                    {garmentFile ? (
                      <div style={{ position: 'relative', width: '100%', paddingBottom: '140%' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={URL.createObjectURL(garmentFile)} alt={garmentFile.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                        <button type="button" onClick={(e) => { e.preventDefault(); setGarmentFile(null); setGarmentKey(''); }}
                          style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <XIcon />
                        </button>
                        {isUploading && (
                          <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, background: 'rgba(255,255,255,0.95)', borderRadius: 8, padding: '6px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)' }}><SpinnerIcon /> {uploadProgress}%</div>
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
                        <div style={{ fontSize: 36, marginBottom: 10, opacity: .4 }}>👗</div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', marginBottom: 6 }}>Upload Top Wear</div>
                        <div style={{ fontSize: 12, color: 'var(--mute)', marginBottom: 14 }}>Drag & drop · JPG, PNG · Max 10MB</div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                          <UploadIcon /> Browse Image
                        </div>
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

                  {/* Tip panel */}
                  <div style={{ flex: 1.2, minWidth: 240, background: '#FAFAFA', borderRadius: 10, border: '1px solid var(--line)', padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <span style={{ fontSize: 14 }}>💡</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--mute)' }}>Use clean flat lay images for best AI catalogue results.</span>
                    </div>
                    <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {['Even, diffuse daylight', 'Minimal wrinkles, garment laid flat', 'Plain, contrasting background'].map((tip) => (
                        <li key={tip} style={{ fontSize: 12, color: 'var(--mute)' }}>{tip}</li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(245,92,122,0.06)', fontSize: 12, color: 'var(--mute)' }}>
                      ❌ Avoid: blurry images, cluttered backgrounds, cropped garments, heavy shadows.
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* ── Step 1: Model ────────────────────────── */}
          {step === 1 && (
            <div>
              <SectionHead title="Choose your model" sub="Select the model that will wear your garment." />
              {/* Filter pills */}
              {faces && faces.items.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                  {['All', ...Array.from(new Set(faces.items.map((f) => f.gender)))].map((f) => (
                    <button key={f} type="button" onClick={() => setModelFilter(f)} style={{
                      padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: modelFilter === f ? 'var(--ink)' : 'var(--surface)',
                      color: modelFilter === f ? '#FEFEFE' : 'var(--ink)',
                      fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                      boxShadow: modelFilter === f ? 'none' : '0 0 0 1px var(--line)',
                    }}>{f === 'All' ? `All (${faces.items.length})` : f}</button>
                  ))}
                </div>
              )}
              {!faces ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><SpinnerIcon /></div>
              ) : (
                <div className="av-sel-grid">
                  {faces.items
                    .filter((f) => modelFilter === 'All' || f.gender === modelFilter)
                    .map((f) => (
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
              {/* Filter pills */}
              {backgrounds && backgrounds.items.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                  {['All', 'Studio', 'Outdoor', 'Indoor', 'Festive', 'Minimal'].map((f) => (
                    <button key={f} type="button" onClick={() => setBgFilter(f)} style={{
                      padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: bgFilter === f ? 'var(--ink)' : 'var(--surface)',
                      color: bgFilter === f ? '#FEFEFE' : 'var(--ink)',
                      fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                      boxShadow: bgFilter === f ? 'none' : '0 0 0 1px var(--line)',
                    }}>{f === 'All' ? `Most Popular` : f}</button>
                  ))}
                </div>
              )}
              {!backgrounds ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><SpinnerIcon /></div>
              ) : backgrounds.items.length === 0 ? (
                <p style={{ fontSize: 14, color: 'var(--mute)' }}>No backgrounds available for this model yet. Try a different model.</p>
              ) : (
                <div className="av-sel-grid">
                  {backgrounds.items.map((b) => (
                    <SelCard key={b.id} selected={backgroundId === b.id} onClick={() => handleBackgroundSelect(b.id)} imageUrl={b.thumbnailUrl} label={b.label} />
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
                  <button type="button" onClick={() => setPoseIds([])} style={{ fontSize: 12, color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Clear all</button>
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
