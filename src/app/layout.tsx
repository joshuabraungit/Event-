import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sponsor Signals",
  description: "Find brands that may fit your event, with the evidence behind each suggestion.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="inner">
            <Link href="/" className="brand">
              Sponsor <span>Signals</span>
            </Link>
            <nav className="nav">
              <Link href="/">Events</Link>
              <Link href="/events/new">New event</Link>
              <Link href="/sources">Sources</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
