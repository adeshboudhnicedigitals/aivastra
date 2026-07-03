import { ChatWidget } from '@/components/chat-widget';
import { JobStreamProvider } from '@/components/job-stream-provider';
import { Sidebar } from '@/components/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <JobStreamProvider>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {children}
        </div>
        <ChatWidget />
      </div>
    </JobStreamProvider>
  );
}
