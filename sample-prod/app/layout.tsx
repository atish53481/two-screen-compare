import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sample PROD Application',
  description: 'Production version - stable and certified',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-white">
        {children}
      </body>
    </html>
  );
}
