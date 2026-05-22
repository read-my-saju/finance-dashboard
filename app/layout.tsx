import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReadMySaju 결제 대시보드",
  description: "PortOne 실시간 매출 모니터링",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
