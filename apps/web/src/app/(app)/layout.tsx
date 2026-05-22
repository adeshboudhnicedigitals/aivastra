import { Sidebar } from '@/components/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="av-app">
      <Sidebar />
      <main className="av-main">{children}</main>
    </div>
  );
}
