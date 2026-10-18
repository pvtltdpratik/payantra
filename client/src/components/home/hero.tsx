import { HERO_FADE } from "@/lib/motion";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { HeroMotion } from "@/components/motion/hero-motion";
import { Magnet } from "@/components/reactbits";
import { ShinyText } from "@/components/reactbits";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";
import { getBanners, getPublicSettings } from "@/services/home";
import { HeroArt } from "./hero-art";
import { HeroStage } from "./hero-stage";

/** Under the buttons: the live delivery/returns promise and, if an admin has set one, a spotlight link. */
async function HeroExtras() {
  const [settings, spotlight] = await Promise.all([getPublicSettings(), getBanners("HOME_HERO")]);
  const promise = settings
    ? [settings.shipping.freeThreshold === 0 ? "Free delivery on every order" : `Free delivery over ${formatINR(settings.shipping.freeThreshold)}`, `${settings.returns.returnWindowDays}-day returns`]
    : [];
  const link = spotlight[0];

  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-primary-foreground/80" {...HERO_FADE}>
      {promise.length > 0 && <p data-testid="hero-promise">{promise.join("  ·  ")}</p>}
      {link?.linkUrl && (
        <Link href={link.linkUrl} className="inline-flex items-center gap-1.5 font-medium text-gold underline-offset-4 hover:underline" data-testid="hero-spotlight">
          {link.title}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      )}
    </div>
  );
}

/**
 * The first screen. Server-rendered and complete on its own: the headline, copy and both calls to action are in the
 * HTML, and the static SVG scene is behind them. Everything else is progressive: the 3D scene (capable desktops),
 * the entrance animation (desktop) and the parallax (fine pointers).
 */
export function Hero() {
  return (
    <section
      data-hero-root
      aria-labelledby="hero-heading"
      className="relative isolate min-h-[min(92svh,860px)] overflow-hidden bg-[#260a13] text-primary-foreground"
    >
      <div data-hero-art className="absolute inset-x-0 -top-[10%] -z-10 h-[120%]">
        <HeroArt className="silk-drift size-full" />
      </div>
      <HeroStage />

      <div data-hero-copy className="relative z-10 mx-auto flex min-h-[inherit] max-w-7xl flex-col justify-center px-4 py-20 sm:px-6 lg:py-24">
        <p {...HERO_FADE} className="text-xs font-medium uppercase tracking-[0.35em]">
          <ShinyText text="Indian fashion, reimagined" color="#c8a45d" shineColor="#fff3d1" speed={3} trigger="view" />
        </p>
        <h1 id="hero-heading" data-hero-headline className="mt-5 max-w-3xl text-[2.9rem] font-semibold leading-[1.03] text-[#fbf7f0] sm:text-7xl lg:text-[5.4rem]">
          Woven in tradition,
          <br />
          worn for today
        </h1>
        <p {...HERO_FADE} className="mt-6 max-w-xl text-base leading-relaxed text-primary-foreground/85 sm:text-lg">
          Sarees, kurtas, lehengas and Indo-western pieces from skilled weavers and designers across India. Heirloom craft, made for the way you live now.
        </p>
        <div {...HERO_FADE} className="mt-10 flex flex-wrap items-center gap-3">
          <Magnet padding={90} magnetStrength={3} maxOffset={14} wrapperClassName="inline-block">
            <Button size="lg" className="h-12 bg-gold px-7 text-base font-semibold text-[#2a1a17] hover:bg-[#d8b66f]" nativeButton={false} render={<Link href="/shop" />}>
              Explore Collection
            </Button>
          </Magnet>
          <Button
            size="lg"
            variant="outline"
            className="h-12 border-white/40 bg-transparent px-7 text-base text-white hover:bg-white/10 hover:text-white"
            nativeButton={false}
            render={<Link href="#story" />}
          >
            Discover Our Story
          </Button>
        </div>
        <Suspense fallback={<div className="mt-8 h-6" {...HERO_FADE} />}>
          <HeroExtras />
        </Suspense>
      </div>

      <HeroMotion />
    </section>
  );
}
