import type { Metadata } from 'next';

import '@coinbase/cds-icons/fonts/web/icon-font.css';
import '@coinbase/cds-web/defaultFontStyles';
import '@coinbase/cds-web/globalStyles';

import '@/theme/direction.css';
import '@/theme/motion.css';
import '@/theme/type.css';

import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'KRW IRS Monitor',
  description: 'v2 spike — CDS component layer',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
