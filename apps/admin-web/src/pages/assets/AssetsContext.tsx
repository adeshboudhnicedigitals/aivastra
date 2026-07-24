import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type {
  CatalogItem,
  GarmentType,
  GenderSlug,
  ModelBackground,
  ModelFace,
  WorkflowOption,
} from '../../types';

export type AssetTab =
  | 'garment-types'
  | 'faces'
  | 'backgrounds'
  | 'lower'
  | 'shoe'
  | 'pose-assets'
  | 'catalogue-templates'
  | 'saree-styles';
export type GenderFilter = 'all' | GenderSlug;

const VALID_TABS: AssetTab[] = [
  'garment-types',
  'faces',
  'backgrounds',
  'lower',
  'shoe',
  'pose-assets',
  'catalogue-templates',
  'saree-styles',
];

export type Toast = (t: { kind?: 'error'; title: string; body?: string }) => void;

interface AssetsContextValue {
  // Navigation
  activeTab: AssetTab;
  setActiveTab: (tab: AssetTab) => void;
  genderFilter: GenderFilter;
  setGenderFilter: (f: GenderFilter) => void;
  // Shared data
  faces: ModelFace[];
  setFaces: React.Dispatch<React.SetStateAction<ModelFace[]>>;
  loadFaces: () => void;
  allBackgrounds: ModelBackground[];
  setAllBackgrounds: React.Dispatch<React.SetStateAction<ModelBackground[]>>;
  loadAllBackgrounds: () => void;
  garmentTypes: GarmentType[];
  setGarmentTypes: React.Dispatch<React.SetStateAction<GarmentType[]>>;
  loadGarmentTypes: () => Promise<void>;
  workflows: WorkflowOption[];
  setWorkflows: React.Dispatch<React.SetStateAction<WorkflowOption[]>>;
  // Catalog items (used for garment-type coverage indicator)
  catalogItems: CatalogItem[];
  setCatalogItems: React.Dispatch<React.SetStateAction<CatalogItem[]>>;
  // UI helpers
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  previewUrl: string | null;
  setPreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
  storagePublicUrl: string | null;
  toast: Toast;
}

const AssetsContext = createContext<AssetsContextValue | null>(null);

export function useAssetsContext() {
  const ctx = useContext(AssetsContext);
  if (!ctx) throw new Error('useAssetsContext must be used inside AssetsProvider');
  return ctx;
}

export function AssetsProvider({ toast, children }: { toast: Toast; children: React.ReactNode }) {
  const { storagePublicUrl } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as AssetTab | null;
  const activeTab: AssetTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'garment-types';
  const setActiveTab = useCallback(
    (tab: AssetTab) => setSearchParams({ tab }, { replace: true }),
    [setSearchParams],
  );

  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [faces, setFaces] = useState<ModelFace[]>([]);
  const [allBackgrounds, setAllBackgrounds] = useState<ModelBackground[]>([]);
  const [garmentTypes, setGarmentTypes] = useState<GarmentType[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);

  const loadFaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelFace[] }>('/admin/assets/faces');
      setFaces(res.items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load faces',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadAllBackgrounds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelBackground[] }>('/admin/assets/backgrounds');
      setAllBackgrounds(res.items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load backgrounds',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadGarmentTypes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: GarmentType[] }>('/admin/assets/garment-types');
      setGarmentTypes(res.items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load garment types',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Preload shared data on mount so filters/dropdowns are populated immediately
  useEffect(() => {
    apiFetch<{ items: ModelFace[] }>('/admin/assets/faces')
      .then((r) => setFaces(r.items))
      .catch(() => {});
    apiFetch<{ items: ModelBackground[] }>('/admin/assets/backgrounds')
      .then((r) => setAllBackgrounds(r.items))
      .catch(() => {});
    apiFetch<CatalogItem[]>('/admin/catalog/items')
      .then((items) => setCatalogItems(items))
      .catch(() => {});
    apiFetch<{ items: GarmentType[] }>('/admin/assets/garment-types')
      .then((r) => setGarmentTypes(r.items))
      .catch(() => {});
  }, []);

  const value = useMemo<AssetsContextValue>(
    () => ({
      activeTab,
      setActiveTab,
      genderFilter,
      setGenderFilter,
      faces,
      setFaces,
      loadFaces,
      allBackgrounds,
      setAllBackgrounds,
      loadAllBackgrounds,
      garmentTypes,
      setGarmentTypes,
      loadGarmentTypes,
      workflows,
      setWorkflows,
      catalogItems,
      setCatalogItems,
      loading,
      setLoading,
      previewUrl,
      setPreviewUrl,
      storagePublicUrl,
      toast,
    }),
    [
      activeTab,
      setActiveTab,
      genderFilter,
      faces,
      loadFaces,
      allBackgrounds,
      loadAllBackgrounds,
      garmentTypes,
      loadGarmentTypes,
      workflows,
      catalogItems,
      loading,
      previewUrl,
      storagePublicUrl,
      toast,
    ],
  );

  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}
