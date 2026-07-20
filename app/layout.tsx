import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgriFortress',
  description: 'Farm-to-farm supply chain on the Imajin network',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        {children}
      </body>
    </html>
  );
}
