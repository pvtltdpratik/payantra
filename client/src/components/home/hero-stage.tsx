"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { whenIdle } from "@/lib/gsap";
import { canRunHeroScene } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Loaded only if the device qualifies, and only when the browser is idle: three.js never touches the initial load.
const HeroCanvas = dynamic(() => import("./hero-canvas"), { ssr: false });

type Mode = "static" | "loading" | "scene";

/** If the 3D scene throws (a driver bug, a lost context, a failed chunk), quietly keep the static hero. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Sits over the static hero art. Stays out of the way (renders an empty box) unless the visitor is on a capable
 * desktop with motion allowed; then it loads the 3D scene in idle time and fades it in once its first frame is drawn.
 * The scene renders only while the hero is on screen, the tab is visible and the visitor has not paused it.
 */
export function HeroStage() {
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("static");
  const [source, setSource] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => {
    if (!canRunHeroScene()) return;
    const root = box.current?.closest<HTMLElement>("[data-hero-root]") ?? null;
    return whenIdle(() => {
      setSource(root);
      setMode("loading");
    }, 2500);
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || mode === "static") return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    const onVisibility = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  const fallBack = () => {
    setMode("static");
    setReady(false);
  };
  const running = onScreen && tabVisible && !paused;

  return (
    <>
      <div ref={box} className="pointer-events-none absolute inset-0" aria-hidden="true" data-testid="hero-stage" data-mode={mode} data-ready={ready}>
        {mode !== "static" && source && (
          <div className={cn("absolute inset-0 transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}>
            <SceneBoundary onError={fallBack}>
              <HeroCanvas
                eventSource={source}
                running={running}
                onReady={() => {
                  setReady(true);
                  setMode("scene");
                }}
                onFail={fallBack}
              />
            </SceneBoundary>
            {/* Keeps the headline readable over the brighter 3D cloth (the static artwork has the same fade). */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#260a13]/90 via-[#260a13]/50 to-transparent lg:via-[#260a13]/35" />
          </div>
        )}
      </div>

      {mode === "scene" && ready && (
        // A looping animation lasting more than five seconds must be pausable (WCAG 2.2.2).
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          data-testid="hero-pause"
          className="absolute bottom-5 right-5 z-20 inline-flex h-10 items-center gap-2 rounded-full border border-white/25 bg-black/30 px-4 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/45 focus-visible:outline-2"
        >
          {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
          {paused ? "Play animation" : "Pause animation"}
        </button>
      )}
    </>
  );
}
