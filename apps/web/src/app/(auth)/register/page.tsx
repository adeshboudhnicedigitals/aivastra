'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterBody } from '@aivastra/types';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type RegisterForm = z.infer<typeof RegisterBody>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterForm>({
    resolver: zodResolver(RegisterBody),
  });

  async function onSubmit(data: RegisterForm) {
    setError('');
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: { message?: string } };
      setError(body.error?.message ?? 'Registration failed');
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-hand text-5xl text-foreground">AI Vastra</h1>
          <p className="mt-2 font-body text-sm text-muted-foreground">Create your atelier account.</p>
        </div>

        <div className="sketch-card p-7">
          <div className="mb-5 flex gap-2">
            <Link href="/login" className="rounded-full border border-foreground px-3 py-0.5 font-body text-[10px] uppercase tracking-[0.08em] text-muted-foreground hover:bg-secondary transition-colors">Login</Link>
            <span className="rounded-full border border-foreground bg-foreground px-3 py-0.5 font-body text-[10px] uppercase tracking-[0.08em] text-background">Sign up</span>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="font-hand text-[17px] text-foreground block" htmlFor="displayName">Your name</label>
              <Input id="displayName" type="text" placeholder="Priya Sharma" {...register('displayName')} />
              {errors.displayName && <p className="font-body text-xs text-destructive">{errors.displayName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="font-hand text-[17px] text-foreground block" htmlFor="email">Email</label>
              <Input id="email" type="email" placeholder="you@brand.com" autoComplete="email" {...register('email')} />
              {errors.email && <p className="font-body text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="font-hand text-[17px] text-foreground block" htmlFor="password">Password</label>
              <Input id="password" type="password" placeholder="Min 8 characters" autoComplete="new-password" {...register('password')} />
              {errors.password && <p className="font-body text-xs text-destructive">{errors.password.message}</p>}
            </div>
            {error && (
              <p className="rounded border border-destructive bg-destructive/10 px-3 py-2 font-body text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full justify-center" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account →'}
            </Button>
          </form>

          <p className="mt-5 text-center font-body text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-foreground underline underline-offset-2 hover:text-primary">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
