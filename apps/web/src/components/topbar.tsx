'use client';
import { useRouter } from 'next/navigation';

const SignOutIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

export function TopBar() {
  const router = useRouter();

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      className="av-topbar-btn av-topbar-signout"
      onClick={handleSignOut}
      title="Sign out"
      style={{ position: 'fixed', top: 14, right: 68, zIndex: 100 }}
    >
      <SignOutIcon /> Sign out
    </button>
  );
}
