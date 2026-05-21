'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Sparkles, LayoutDashboard, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CreditsResponse { balance: number }

export function Navbar() {
  const router = useRouter();
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
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-primary">
          <Sparkles className="h-5 w-5" />
          Aivastra
        </Link>
        <nav className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Link>
          <Link href="/tryon" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <Sparkles className="h-4 w-4" />
            Try On
          </Link>
          {credits !== undefined && (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {credits.balance} credits
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </nav>
      </div>
    </header>
  );
}
