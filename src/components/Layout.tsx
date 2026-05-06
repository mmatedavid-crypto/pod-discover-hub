import { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { FeedbackButton } from "./FeedbackButton";
import LiveIndexBar from "./LiveIndexBar";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <LiveIndexBar />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <FeedbackButton />
    </div>
  );
}
