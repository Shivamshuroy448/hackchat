import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HackChat — team chatbox for hackathons",
  description:
    "Share code and files with your hackathon team. Join with a team code, no accounts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
