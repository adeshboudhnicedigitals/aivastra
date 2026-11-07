import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { C } from '@/components/tokens';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
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
          // biome-ignore lint/security/noDangerouslySetInnerHtml: theme flash prevention requires an inline script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={poppins.variable}
        style={{ background: C.bg, color: C.text }}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
