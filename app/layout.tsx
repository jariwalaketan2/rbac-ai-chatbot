import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Bebas_Neue, JetBrains_Mono, Outfit } from 'next/font/google';

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const outfit = Outfit({
  weight: ['300', '400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PulseMetrics Assistant — POC',
  description: 'Context-aware AI chatbot with RBAC + ABAC enforcement.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${bebasNeue.variable} ${jetbrainsMono.variable} ${outfit.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
