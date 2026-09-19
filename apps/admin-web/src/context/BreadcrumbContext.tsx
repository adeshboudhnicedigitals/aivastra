import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface Crumb {
  label: string;
  href: string;
}

interface BreadcrumbContextValue {
  crumbs: Crumb[];
  setCrumb: (depth: number, crumb: Crumb | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function useBreadcrumbContext(): BreadcrumbContextValue {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) throw new Error('useBreadcrumbContext must be used inside BreadcrumbProvider');
  return ctx;
}

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Record<number, Crumb>>({});

  const setCrumb = useCallback((depth: number, crumb: Crumb | null) => {
    setEntries((prev) => {
      if (crumb === null) {
        if (!(depth in prev)) return prev;
        const next = { ...prev };
        delete next[depth];
        return next;
      }
      const existing = prev[depth];
      if (existing && existing.label === crumb.label && existing.href === crumb.href) return prev;
      return { ...prev, [depth]: crumb };
    });
  }, []);

  const crumbs = useMemo(
    () =>
      Object.keys(entries)
        .map(Number)
        .sort((a, b) => a - b)
        .map((depth) => entries[depth]),
    [entries],
  );

  const value = useMemo(() => ({ crumbs, setCrumb }), [crumbs, setCrumb]);

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/**
 * Registers a breadcrumb at a fixed `depth` (a level number the caller
 * chooses, not mount order) for as long as the calling component is mounted
 * with a non-null `crumb`; clears it on unmount or when `crumb` becomes null.
 * Using an explicit depth instead of mount-order keeps the trail correct
 * under React StrictMode's mount→unmount→mount double-invoke.
 */
export function useCrumb(depth: number, crumb: Crumb | null): void {
  const { setCrumb } = useBreadcrumbContext();
  const label = crumb?.label ?? null;
  const href = crumb?.href ?? null;
  useEffect(() => {
    setCrumb(depth, label !== null && href !== null ? { label, href } : null);
    return () => setCrumb(depth, null);
  }, [depth, label, href, setCrumb]);
}
