'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface CreditsResponse { balance: number }

const NAV_LINKS = [
  { href: '/dashboard', label: 'My Try-Ons' },
  { href: '/tryon', label: 'New Try-On' },
];

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: credits } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 bg-background border-b border-foreground">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        {/* Brand */}
        <Link href="/dashboard" className="flex items-center gap-2 font-hand text-2xl text-foreground">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-foreground">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform="rotate(35 7 7)"/>
              <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform="rotate(35 7 7)"/>
            </svg>
          </span>
          AI Vastra
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={[
                'px-3 py-1.5 font-hand text-[17px] rounded-full border transition-colors',
                pathname === l.href
                  ? 'border-foreground bg-secondary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-foreground',
              ].join(' ')}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {credits !== undefined && (
            <Link
              href="/credits"
              className="inline-flex items-center gap-1.5 rounded-full border border-foreground px-3 py-1 font-body text-xs uppercase tracking-wide hover:bg-secondary transition-colors"
            >
              <span className="text-primary font-bold">{credits.balance}</span>
              <span className="text-muted-foreground">credits</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-foreground">get more</span>
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="font-hand text-[16px] text-muted-foreground hover:text-foreground border border-transparent hover:border-foreground rounded-full px-3 py-1 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
