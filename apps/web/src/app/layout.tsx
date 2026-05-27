import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ai Vastra — AI catalogues for fashion brands',
  description: 'Generate premium ecommerce model shoots from your garment photos in minutes. No studio, no shoot day.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: 'light' }}>
      <body className={poppins.variable}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
