import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "braveworld — KRW IRS",
  description: "All-day KRW IRS market monitor",
};

// Apply the persisted theme before first paint to avoid a light flash.
const THEME_INIT = `try{if(localStorage.getItem("bw-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: THEME_INIT stamps data-theme pre-hydration
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
