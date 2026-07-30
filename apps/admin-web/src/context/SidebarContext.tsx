import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

export interface SidebarContextValue {
  isDrawerMode: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export const SIDEBAR_DRAWER_ID = 'admin-sidebar-drawer';

export function useSidebarContext(): SidebarContextValue {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error('useSidebarContext must be used within a SidebarProvider');
  }
  return value;
}

export function SidebarProvider({
  isDrawerMode,
  currentPage,
  children,
}: {
  isDrawerMode: boolean;
  currentPage: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Reset to closed every time drawer mode turns on
  useLayoutEffect(() => {
    if (isDrawerMode) close();
  }, [isDrawerMode, close]);

  // Close on any navigation
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentPage is the trigger
  useEffect(() => {
    close();
  }, [currentPage, close]);

  // ESC closes when open in drawer mode
  useEffect(() => {
    if (!(isOpen && isDrawerMode)) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, isDrawerMode, close]);

  // Body scroll lock when drawer is open
  useEffect(() => {
    if (!(isOpen && isDrawerMode)) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen, isDrawerMode]);

  const value = useMemo<SidebarContextValue>(
    () => ({ isDrawerMode, isOpen, open, close, toggle }),
    [isDrawerMode, isOpen, open, close, toggle],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
