import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { C } from '@/components/tokens';
import { ToastProvider } from '@/components/ui/toast';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AiVastra Merchant',
  description: 'AiVastra merchant portal',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading x-nonce also opts the tree into dynamic rendering, which Next needs
  // to stamp the per-request CSP nonce onto its own scripts.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {nonce ? <meta name="csp-nonce" content={nonce} /> : null}
        {/* Apply the saved theme before first paint to avoid a flash. */}
        <script
          nonce={nonce}
          // The browser blanks the nonce attribute after parsing, so React sees a harmless
          // server/client difference on this one tag (the CSP nonce).
          suppressHydrationWarning
          // biome-ignore lint/security/noDangerouslySetInnerHtml: theme flash prevention requires an inline script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&location.pathname.indexOf('/hq')>=0&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={jakarta.variable}
        style={{ background: C.bg, color: C.text }}
        suppressHydrationWarning
      >
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
