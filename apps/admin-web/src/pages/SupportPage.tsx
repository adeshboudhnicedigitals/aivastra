import type { SupportPage as SupportTab } from '../components/SupportSidebar';
import SupportDashboardPanel from './support/SupportDashboardPanel';
import SupportJobsPanel from './support/SupportJobsPanel';
import SupportTicketsPanel from './support/SupportTicketsPanel';
import SupportUsersPanel from './support/SupportUsersPanel';

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string) => void;
  tab: SupportTab;
  onNavigateTab: (tab: SupportTab) => void;
}

export default function SupportPage({ toast, onNav, tab, onNavigateTab }: Props) {
  if (tab === 'dashboard') {
    return <SupportDashboardPanel toast={toast} onNav={onNav} onNavigateTab={onNavigateTab} />;
  }
  if (tab === 'tickets') {
    return <SupportTicketsPanel toast={toast} onNav={onNav} />;
  }
  if (tab === 'jobs') {
    return <SupportJobsPanel toast={toast} onNav={onNav} />;
  }
  return <SupportUsersPanel toast={toast} onNav={onNav} />;
}
