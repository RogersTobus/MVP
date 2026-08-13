import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "콘텐츠 스튜디오",
  description: "네이버 블로그 콘텐츠를 기획하고 검토하는 로컬 업무 도구",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
