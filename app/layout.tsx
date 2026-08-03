import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReadMySaju 결제 대시보드",
  description: "PortOne 실시간 매출 모니터링",
};

// hydration 전에 테마 class 를 심어 다크모드 첫 페인트 깜빡임(FOUC)을 막는다.
// localStorage("rmsf_theme") 우선, 없으면 OS prefers-color-scheme.
const themeInitScript = `(function(){try{var t=localStorage.getItem("rmsf_theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark");}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
