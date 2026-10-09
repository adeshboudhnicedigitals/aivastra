'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationJob } from '@/app/(app)/studio/generation-panel';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { isSupportedImageBytes } from '@/lib/image-validation';
import type { FabricGarmentTypeOption } from './types';

export interface FaceItem {
  id: string;
  label: string;
  thumbnailUrl: string;
}
export interface BackgroundItem {
  id: string;
  label: string;
  thumbnailUrl: string;
}
export interface PoseItem {
  id: string;
  label: string;
  thumbnailUrl: string;
  hasLower: boolean;
  hasShoes: boolean;
  hasAccessory: boolean;
}
export interface CatalogItem {
  id: string;
  label: string;
  thumbnailUrl: string;
}
interface CatalogNode {
  id: number;
  slug: string;
  label: string;
  children: CatalogNode[];
  items: CatalogItem[];
}
interface GarmentTypeDefaults {
  id: string;
  defaultLowerCatalogId?: string | null;
  defaultShoeCatalogId?: string | null;
}

export type PipelineStage = 'garment' | 'claiming' | 'photos' | null;

function flattenNode(node: CatalogNode): CatalogItem[] {
  return [...node.items, ...node.children.flatMap((c) => flattenNode(c))];
}

// Single-page flow mirroring Studio's own stacked wizard: fabric upload and
// garment-type preset at the top, then — as soon as the preset is linked to a
// Studio garment type (garmentTypeId) — the same face/background/pose(/lower/
// shoes/accessory) steps Studio uses, all visible together below it, with ONE
// submit button at the bottom. There is no "phase swap" — every step is on
// screen at once, exactly like studio/page.tsx's own numbered wizard.
//
// Clicking submit runs a two-stage pipeline behind that single button: the
// fabric photo is turned into a garment image first
// (POST /v1/jobs/fabric-to-garment), then — once that job completes — the
// result is claimed (apps/api/src/modules/jobs/claimFabricToGarmentResult.ts)
// and fed straight into the same unmodified POST /v1/jobs/tryon Studio's own
// page calls, carrying the face/background/pose/etc the user already picked
// up front. If the selected preset isn't linked to a garment type, the
// pipeline stops after the first stage — same as before this flow existed.
// Studio's own page/logic is never imported or touched for this, only its
// exported, prop-driven pieces (generation-panel, select-modal, shared-cards,
// accessory-step) — same precedent as embed-studio-wizard.tsx.
export function useFabricToShoot() {
  const qc = useQueryClient();

  // ---- Upload ----
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [r2Key, setR2Key] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  // ---- Gender + preset (garment type) — two separate steps, same as
  // Studio's own "Create Catalogue For" then "Select Your Garment Type". ----
  // Defaults to 'women', same as Studio's own `useState('women')` — so Step 3
  // (garment type) and the Studio-style steps below it are populated and
  // visible immediately, rather than waiting on an explicit gender tap.
  const [gender, setGenderRaw] = useState<'women' | 'men' | 'boys' | 'girls' | null>('women');
  const [presetId, setPresetIdRaw] = useState<string | null>(null);

  const {
    data: presetsData,
    isLoading: presetsLoading,
    isError: presetsError,
    refetch: refetchPresets,
  } = useQuery<{
    items: FabricGarmentTypeOption[];
    creditsCost: number;
  }>({
    queryKey: ['fabric-garment-types'],
    queryFn: () => api.get('/v1/fabric-garment-types'),
    staleTime: 5 * 60_000,
  });
  const presets = presetsData?.items ?? [];
  const creditsCost = presetsData?.creditsCost;
  // Only offer genders that actually have a preset — same spirit as Studio's
  // GENDERS list, but data-driven since fabric-to-garment's gender coverage
  // depends on what's configured.
  const availableGenders = (['women', 'men', 'boys', 'girls'] as const).filter((g) =>
    presets.some((p) => p.genderSlug === g),
  );
  const genderPresets = presets.filter((p) => p.genderSlug === gender);
  const selectedPreset = presets.find((p) => p.id === presetId) ?? null;
  const garmentTypeId = selectedPreset?.garmentTypeId ?? null;
  // A linked preset continues straight into Studio's steps below the upload
  // card; an unlinked one stops at the generated garment image, same as
  // before this flow existed.
  const hasGarmentType = !!gender && !!garmentTypeId;
  // Show the Studio steps by default (no preset picked yet — same as Studio
  // showing Face/Background/Pose before a garment type is chosen) and once a
  // linked preset is picked. Only an explicitly-chosen, permanently-unlinked
  // preset falls back to the garment-only card.
  const showStudioFlow = !presetId || !!garmentTypeId;

  const { data: creditsData } = useQuery<{
    balance: number;
    unlimitedPlan?: { status: 'active' | 'expiring_soon' | 'expired' | 'revoked' | 'none' } | null;
  }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });
  const isUnlimitedPlan =
    creditsData?.unlimitedPlan?.status === 'active' ||
    creditsData?.unlimitedPlan?.status === 'expiring_soon';
  const balance = creditsData?.balance;
  const insufficientCredits =
    !isUnlimitedPlan &&
    typeof creditsCost === 'number' &&
    typeof balance === 'number' &&
    balance < creditsCost;

  // ---- Studio-style steps — fetched as soon as a linked preset is picked,
  // not gated behind the fabric job completing. ----
  const [faceId, setFaceId] = useState<string | null>(null);
  const [backgroundId, setBackgroundId] = useState<string | null>(null);
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [lowerCatalogId, setLowerCatalogId] = useState<string | null>(null);
  const [shoeCatalogId, setShoeCatalogId] = useState<string | null>(null);
  const [accessoryCatalogIds, setAccessoryCatalogIds] = useState<string[]>([]);

  function setPresetId(id: string | null) {
    setPresetIdRaw(id);
    setFaceId(null);
    setBackgroundId(null);
    setPoseIds([]);
    setLowerCatalogId(null);
    setShoeCatalogId(null);
    setAccessoryCatalogIds([]);
  }

  // Same reset Studio's own gender card performs: a new audience invalidates
  // whichever garment type (and everything downstream of it) was picked for
  // the old one.
  function setGender(next: 'women' | 'men' | 'boys' | 'girls') {
    setGenderRaw(next);
    setPresetId(null);
  }

  // Mirrors Studio's own `didAutoGarment` effect (studio/page.tsx) — as soon
  // as presets for the current gender are available and nothing is picked
  // yet, auto-select the first one so every step below (face, background,
  // pose, ...) is populated and visible immediately instead of waiting on an
  // explicit tap, exactly like Studio auto-picking a garment type on load.
  const didAutoPreset = useRef<'women' | 'men' | 'boys' | 'girls' | null>(null);
  useEffect(() => {
    if (genderPresets.length && !presetId && didAutoPreset.current !== gender) {
      setPresetId(genderPresets[0]?.id ?? null);
      didAutoPreset.current = gender;
    }
  }, [genderPresets, presetId, gender]);

  // Face/background only need gender, same as Studio's own queries — they
  // must not wait on a garment-type pick, or the sections below the upload
  // card would sit empty until auto-select (or the user) chooses one.
  const { data: facesData } = useQuery<{ items: FaceItem[] }>({
    queryKey: ['models-faces', gender],
    queryFn: () => api.get(`/v1/models/faces?gender=${gender}`),
    enabled: !!gender,
  });
  const faces = facesData?.items ?? [];
  useEffect(() => {
    if (faces.length && !faces.some((f) => f.id === faceId)) {
      setFaceId(faces[0]?.id ?? null);
    }
  }, [faces, faceId]);

  const { data: backgroundsData } = useQuery<{ items: BackgroundItem[] }>({
    queryKey: ['models-backgrounds', gender],
    queryFn: () => api.get(`/v1/models/backgrounds?gender=${gender}`),
    enabled: !!gender,
  });
  const backgrounds = backgroundsData?.items ?? [];
  useEffect(() => {
    if (backgrounds.length && !backgroundId) {
      setBackgroundId(backgrounds[0]?.id ?? null);
    }
  }, [backgrounds, backgroundId]);

  const { data: posesData } = useQuery<{ items: PoseItem[] }>({
    queryKey: ['models-poses', gender, garmentTypeId],
    queryFn: () => api.get(`/v1/models/poses?gender=${gender}&garmentTypeId=${garmentTypeId}`),
    enabled: hasGarmentType,
  });
  const poses = posesData?.items ?? [];

  const selectedPoses = poses.filter((p) => poseIds.includes(p.id));
  const needsLower = selectedPoses.some((p) => p.hasLower);
  const needsShoes = selectedPoses.some((p) => p.hasShoes);
  const needsAccessory = selectedPoses.some((p) => p.hasAccessory);
  const poseIdsParam = poseIds.length > 0 ? `&poseIds=${poseIds.join(',')}` : '';

  const { data: garmentTypesData } = useQuery<{ items: GarmentTypeDefaults[] }>({
    queryKey: ['models-garment-types', gender],
    queryFn: () => api.get(`/v1/models/garment-types?gender=${gender}`),
    enabled: hasGarmentType,
  });
  const selectedGarmentType = garmentTypesData?.items.find((g) => g.id === garmentTypeId) ?? null;

  const { data: lowerCatalogData } = useQuery<{ tree: CatalogNode[] }>({
    queryKey: ['catalog-lower', gender, garmentTypeId, poseIds.join(',')],
    queryFn: () =>
      api.get(`/v1/catalog/lower?gender=${gender}&garmentTypeId=${garmentTypeId}${poseIdsParam}`),
    enabled: hasGarmentType && needsLower,
  });
  const lowerItems = useMemo(
    () => (lowerCatalogData?.tree.filter((n) => n.slug !== 'other') ?? []).flatMap(flattenNode),
    [lowerCatalogData],
  );

  const { data: shoeCatalogData } = useQuery<{ tree: CatalogNode[] }>({
    queryKey: ['catalog-shoe', gender, garmentTypeId, poseIds.join(',')],
    queryFn: () =>
      api.get(`/v1/catalog/shoe?gender=${gender}&garmentTypeId=${garmentTypeId}${poseIdsParam}`),
    enabled: hasGarmentType && needsShoes,
  });
  const shoeItems = useMemo(
    () => (shoeCatalogData?.tree.filter((n) => n.slug !== 'other') ?? []).flatMap(flattenNode),
    [shoeCatalogData],
  );

  const { data: accessoryCatalogData } = useQuery<{ tree: CatalogNode[] }>({
    queryKey: ['catalog-accessory', gender, garmentTypeId, poseIds.join(',')],
    queryFn: () =>
      api.get(
        `/v1/catalog/accessory?gender=${gender}&garmentTypeId=${garmentTypeId}${poseIdsParam}`,
      ),
    enabled: hasGarmentType && needsAccessory,
  });
  const accessoryCategories = useMemo(
    () =>
      (accessoryCatalogData?.tree.filter((n) => n.slug !== 'other') ?? []).map((node) => ({
        id: node.id,
        label: node.label,
        items: flattenNode(node),
      })),
    [accessoryCatalogData],
  );
  const visibleAccessoryIds = accessoryCatalogIds.filter((id) =>
    accessoryCategories.some((c) => c.items.some((i) => i.id === id)),
  );

  function togglePose(id: string) {
    setPoseIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      const nextPoses = poses.filter((p) => next.includes(p.id));
      if (!nextPoses.some((p) => p.hasLower)) setLowerCatalogId(null);
      if (!nextPoses.some((p) => p.hasShoes)) setShoeCatalogId(null);
      if (!nextPoses.some((p) => p.hasAccessory)) setAccessoryCatalogIds([]);
      return next;
    });
  }

  // Single-select per category — matches Studio's own toggleAccessory.
  function toggleAccessory(categoryId: number, itemId: string) {
    setAccessoryCatalogIds((prev) => {
      if (prev.includes(itemId)) return prev.filter((id) => id !== itemId);
      const category = accessoryCategories.find((c) => c.id === categoryId);
      const otherCategoryIds = category
        ? prev.filter((id) => !category.items.some((i) => i.id === id))
        : prev;
      return [...otherCategoryIds, itemId];
    });
  }

  // Abort any in-flight upload on unmount.
  useEffect(() => {
    return () => uploadAbortRef.current?.abort();
  }, []);

  // Revoke the previous preview's blob URL whenever `previewUrl` changes away
  // from it — a new upload, clearing on submit, or unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // ---- Pipeline: one submit button, two chained jobs ----
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [activeGeneration, setActiveGeneration] = useState<{
    catalogueId: string;
    jobs: GenerationJob[];
  } | null>(null);

  function resetResult() {
    setJobStatus(null);
    setResultUrl(null);
    setActiveGeneration(null);
    setPipelineStage(null);
  }

  async function handleUpload(nextFile: File) {
    if (uploading) return;
    if (nextFile.size > 20 * 1024 * 1024) {
      setUploadError('File exceeds 20 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(nextFile))) {
      setUploadError('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setUploadError(null);
    setPipelineError(null);
    resetResult();
    setUploading(true);
    setUploadProgress(0);
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    const nextPreviewUrl = URL.createObjectURL(nextFile);
    try {
      const { uploadUrl, r2Key: key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: nextFile.type, contentLength: nextFile.size });
      await api.uploadToR2WithProgress(uploadUrl, nextFile, setUploadProgress, abort.signal);
      setPreviewUrl(nextPreviewUrl);
      setR2Key(key);
    } catch (e) {
      URL.revokeObjectURL(nextPreviewUrl);
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : '';
      setUploadError(
        msg.includes('403')
          ? 'Upload session expired. Please re-upload your image and try again.'
          : `Upload failed: ${msg}`,
      );
    } finally {
      setUploading(false);
    }
  }

  function removeFile() {
    setPreviewUrl(null);
    setR2Key(null);
  }

  // Stage 2: claimed garment key -> the same POST /v1/jobs/tryon Studio uses.
  async function runPhaseB(garmentKey: string) {
    setPipelineStage('photos');
    try {
      const effectiveLowerId =
        lowerCatalogId ?? (needsLower ? selectedGarmentType?.defaultLowerCatalogId : undefined);
      const effectiveShoeId =
        shoeCatalogId ?? (needsShoes ? selectedGarmentType?.defaultShoeCatalogId : undefined);
      const { catalogueId, jobIds } = await api.post<{ catalogueId: string; jobIds: string[] }>(
        '/v1/jobs/tryon',
        {
          inputs: {
            upperGarmentKey: garmentKey,
            faceId,
            backgroundId,
            poseIds,
            garmentTypeId: garmentTypeId ?? undefined,
            lowerCatalogId: effectiveLowerId ?? undefined,
            shoeCatalogId: effectiveShoeId ?? undefined,
            accessoryCatalogIds:
              needsAccessory && visibleAccessoryIds.length > 0 ? visibleAccessoryIds : undefined,
          },
          aspectRatio: '1:1',
          resolution: '2K',
        },
      );
      qc.invalidateQueries({ queryKey: ['credits'] });
      setActiveGeneration({
        catalogueId,
        jobs: jobIds.map((id, i) => {
          const pose = poses.find((p) => p.id === poseIds[i]);
          return {
            id,
            poseId: poseIds[i] ?? '',
            label: pose?.label ?? `Look ${i + 1}`,
            thumbnailUrl: pose?.thumbnailUrl ?? '',
          };
        }),
      });
    } catch (err) {
      setPipelineError(
        err instanceof Error ? err.message : 'Failed to start the photoshoot generation',
      );
    } finally {
      setPipelineRunning(false);
    }
  }

  // Not wrapped in useCallback: useJobStream stores the latest callback in a
  // ref and only (re-)subscribes when its `subscribe` function identity
  // changes, so a plain closure here is cheap and always sees the current
  // pendingJobId/hasGarmentType/runPhaseB (which itself closes over the
  // current face/background/pose/etc selections) without any dependency-list
  // bookkeeping.
  useJobStream((evt) => {
    if (!pendingJobId || evt.jobId !== pendingJobId) return;
    setJobStatus(evt.status);
    if (evt.status === 'COMPLETED') {
      const jobId = pendingJobId;
      setPendingJobId(null);
      api
        .get<{ url: string }>(`/v1/jobs/${jobId}/result`)
        .then(({ url }) => setResultUrl(url))
        .catch(() => {});
      setPipelineStage('claiming');
      api
        .post<{ garmentKey: string }>(
          `/v1/jobs/fabric-to-garment/${jobId}/claim-garment`,
          undefined,
        )
        .then(({ garmentKey }) => {
          if (hasGarmentType) {
            return runPhaseB(garmentKey);
          }
          setPipelineStage(null);
          setPipelineRunning(false);
        })
        .catch(() => {
          setPipelineError('Could not prepare this garment for the photoshoot step.');
          setPipelineRunning(false);
          setPipelineStage(null);
        });
    } else if (evt.status === 'FAILED') {
      setPendingJobId(null);
      setPipelineError('Garment generation failed. Please try again.');
      setPipelineRunning(false);
      setPipelineStage(null);
    }
  });

  const blockReason = !r2Key
    ? 'Upload a fabric photo to continue'
    : !presetId
      ? 'Pick a garment type to continue'
      : hasGarmentType && !faceId
        ? 'Select a model face to continue'
        : hasGarmentType && !backgroundId
          ? 'Select a background to continue'
          : hasGarmentType && poseIds.length === 0
            ? 'Select at least one pose to continue'
            : insufficientCredits
              ? `You need at least ${creditsCost} credits and have ${balance}. Top up to continue.`
              : undefined;

  const canSubmit =
    !!r2Key &&
    !!presetId &&
    !pipelineRunning &&
    !insufficientCredits &&
    (!hasGarmentType || (!!faceId && !!backgroundId && poseIds.length > 0));

  async function submit() {
    if (!canSubmit) return;
    setPipelineRunning(true);
    setPipelineError(null);
    resetResult();
    setPipelineStage('garment');
    try {
      const { jobId } = await api.post<{ jobId: string }>('/v1/jobs/fabric-to-garment', {
        productImageKey: r2Key,
        fabricGarmentTypeId: presetId,
      });
      // Credits were deducted server-side.
      qc.invalidateQueries({ queryKey: ['credits'] });
      setJobStatus('QUEUED');
      setPendingJobId(jobId);
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : 'Failed to start generation');
      setPipelineRunning(false);
      setPipelineStage(null);
    }
  }

  function generateAnother() {
    removeFile();
    setPresetId(null);
    didAutoPreset.current = null;
    setPipelineError(null);
    resetResult();
  }

  return {
    // Upload
    previewUrl,
    uploading,
    uploadProgress,
    uploadError,
    handleUpload,
    removeFile,
    // Gender + presets — two separate steps, same as Studio
    gender,
    setGender,
    availableGenders,
    presets,
    genderPresets,
    presetsLoading,
    presetsError,
    refetchPresets,
    creditsCost,
    presetId,
    setPresetId,
    selectedPreset,
    balance,
    isUnlimitedPlan,
    insufficientCredits,
    // Studio-style steps — visible by default, same as Studio
    hasGarmentType,
    showStudioFlow,
    faces,
    faceId,
    setFaceId,
    backgrounds,
    backgroundId,
    setBackgroundId,
    poses,
    poseIds,
    togglePose,
    needsLower,
    needsShoes,
    needsAccessory,
    lowerItems,
    lowerCatalogId,
    setLowerCatalogId,
    shoeItems,
    shoeCatalogId,
    setShoeCatalogId,
    accessoryCategories,
    accessoryCatalogIds: visibleAccessoryIds,
    toggleAccessory,
    // Pipeline (one submit, two chained jobs under the hood)
    canSubmit,
    blockReason,
    submit,
    pipelineRunning,
    pipelineStage,
    pipelineError,
    jobStatus,
    resultUrl,
    activeGeneration,
    generateAnother,
  };
}
