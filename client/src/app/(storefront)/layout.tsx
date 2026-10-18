import { Suspense } from "react";
import { AnnouncementBar, AnnouncementFallback } from "@/components/home/announcement-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ScrollReveal } from "@/components/motion/scroll-reveal";
import { SmoothScroll } from "@/components/motion/smooth-scroll";

export default function StorefrontLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Suspense fallback={<AnnouncementFallback />}>
        <AnnouncementBar />
      </Suspense>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <SmoothScroll />
      <ScrollReveal />
    </>
  );
}
