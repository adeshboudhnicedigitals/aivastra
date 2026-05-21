'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginBody } from '@aivastra/types';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type LoginForm = z.infer<typeof LoginBody>;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/dashboard';
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(LoginBody),
  });

  async function onSubmit(data: LoginForm) {
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: { message?: string } };
      setError(body.error?.message ?? 'Login failed');
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <h1 className="font-hand text-5xl text-foreground">AI Vastra</h1>
          <p className="mt-2 font-body text-sm text-muted-foreground">Sign in to your atelier.</p>
        </div>

        {/* Card */}
        <div className="sketch-card p-7">
          <div className="mb-5 flex gap-2">
            <span className="rounded-full border border-foreground bg-foreground px-3 py-0.5 font-body text-[10px] uppercase tracking-[0.08em] text-background">Login</span>
            <Link href="/register" className="rounded-full border border-foreground px-3 py-0.5 font-body text-[10px] uppercase tracking-[0.08em] text-muted-foreground hover:bg-secondary transition-colors">Sign up</Link>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="font-hand text-[17px] text-foreground block" htmlFor="email">Email</label>
              <Input id="email" type="email" placeholder="you@brand.com" autoComplete="email" {...register('email')} />
              {errors.email && <p className="font-body text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="font-hand text-[17px] text-foreground block" htmlFor="password">Password</label>
              <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
              {errors.password && <p className="font-body text-xs text-destructive">{errors.password.message}</p>}
            </div>
            {error && (
              <p className="rounded border border-destructive bg-destructive/10 px-3 py-2 font-body text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full justify-center" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in →'}
            </Button>
          </form>

          <p className="mt-5 text-center font-body text-sm text-muted-foreground">
            New to AI Vastra?{' '}
            <Link href="/register" className="text-foreground underline underline-offset-2 hover:text-primary">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
