import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { QueryProvider } from '@/providers/QueryProvider';
import { SentryProvider } from '@/providers/SentryProvider';
import { ToastProvider } from '@/providers/ToastProvider';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'MultiChat AI — Chat with GPT, Gemini & GLM',
  description:
    'A production-ready multi-model AI chat platform with advanced memory, voice input, and file uploads.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <SentryProvider>
              {children}
              <ToastProvider />
            </SentryProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
