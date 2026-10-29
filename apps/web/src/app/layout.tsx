import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { GitBranch, FolderGit2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'GitScope — Local-First Git Analytics',
  description: 'Explore Git repository history, commit activity, and file evolution locally.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased selection:bg-blue-600 selection:text-white">
        <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="flex items-center gap-2 font-semibold tracking-tight text-white hover:text-blue-400 transition-colors"
              >
                <FolderGit2 className="h-5 w-5 text-blue-500" />
                <span>GitScope</span>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                  Local-First
                </span>
              </Link>
              <nav className="flex items-center gap-4 text-sm text-neutral-400">
                <Link href="/" className="hover:text-white transition-colors">
                  Repositories
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3 text-xs text-neutral-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                <span>API Local (Port 4000)</span>
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
