import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "软件工程刷题工作台",
  description: "ZJU Software Engineering quiz and review workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
