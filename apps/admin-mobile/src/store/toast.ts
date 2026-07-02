import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastEntry {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastStore {
  queue: ToastEntry[];
  show: (message: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  queue: [],
  show: (message, variant = 'info') => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    set((state) => ({ queue: [...state.queue, { id, message, variant }].slice(-3) }));
  },
  dismiss: (id) => set((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) })),
}));
