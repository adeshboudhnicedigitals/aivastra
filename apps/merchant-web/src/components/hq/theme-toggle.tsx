'use client';
import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from '@/components/icons';
import { C } from '@/components/tokens';

// Same single button as the retailer top bar. A first visit follows the device (see the inline
// script in layout.tsx); once someone clicks, their choice is stored and wins.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // storage blocked: the toggle still works for this page view
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 38,
        width: 38,
        borderRadius: 48,
        border: `1px solid ${C.border2}`,
        background: C.white,
        color: C.text,
        cursor: 'pointer',
      }}
    >
      {dark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
