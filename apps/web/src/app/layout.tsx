import type { Metadata } from 'next';
import { Caveat, Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const caveat = Caveat({ subsets: ['latin'], variable: '--font-hand' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'AI Vastra — Virtual Try-On',
  description: 'See how clothes look before you make them',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${caveat.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
