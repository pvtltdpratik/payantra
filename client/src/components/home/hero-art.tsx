/**
 * The hero's static scene: flowing maroon silk, champagne-gold zari highlights and a gold ring set with a ruby.
 * Pure inline SVG, so it paints with the first HTML (no image to download, no JavaScript, no layout shift) and is
 * what phones, low-power devices and anyone preferring reduced motion see. On capable desktops the 3D scene fades
 * in over it. The drift animation is CSS-only and switched off without `data-motion="ok"`.
 */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      data-testid="hero-art"
    >
      <defs>
        <radialGradient id="ha-bg" cx="68%" cy="42%" r="85%">
          <stop offset="0" stopColor="#7a2338" />
          <stop offset="0.55" stopColor="#4d1424" />
          <stop offset="1" stopColor="#260a13" />
        </radialGradient>
        <linearGradient id="ha-silk-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b2a43" />
          <stop offset="0.5" stopColor="#5c1a2b" />
          <stop offset="1" stopColor="#35101c" />
        </linearGradient>
        <linearGradient id="ha-silk-b" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8344f" />
          <stop offset="0.45" stopColor="#6e2034" />
          <stop offset="1" stopColor="#2b0c16" />
        </linearGradient>
        <linearGradient id="ha-silk-c" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#3b1220" />
          <stop offset="0.6" stopColor="#7d2a40" />
          <stop offset="1" stopColor="#c0566c" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="ha-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3dfa8" />
          <stop offset="0.45" stopColor="#c8a45d" />
          <stop offset="1" stopColor="#8d6a2b" />
        </linearGradient>
        <radialGradient id="ha-ruby" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ff8da1" />
          <stop offset="0.45" stopColor="#b3203a" />
          <stop offset="1" stopColor="#5c0f1e" />
        </radialGradient>
        <radialGradient id="ha-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#f3dfa8" stopOpacity="0.45" />
          <stop offset="1" stopColor="#f3dfa8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ha-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1d0710" stopOpacity="0.92" />
          <stop offset="0.5" stopColor="#1d0710" stopOpacity="0.35" />
          <stop offset="1" stopColor="#1d0710" stopOpacity="0" />
        </linearGradient>
        <pattern id="ha-weave" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <rect width="14" height="14" fill="none" />
          <path d="M0 7h14M7 0v14" stroke="#fff" strokeOpacity="0.035" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="1600" height="900" fill="url(#ha-bg)" />

      <g className="silk-drift">
        {/* Three overlapping drapes of silk */}
        <path d="M-80 640 C 220 520, 420 780, 760 650 S 1260 380, 1700 520 L1700 980 L-80 980 Z" fill="url(#ha-silk-a)" />
        <path d="M300 -40 C 560 200, 520 420, 820 470 S 1300 330, 1700 120 L1700 -40 Z" fill="url(#ha-silk-b)" opacity="0.92" />
        <path d="M600 980 C 760 760, 1000 840, 1180 640 S 1500 460, 1700 560 L1700 980 Z" fill="url(#ha-silk-c)" opacity="0.9" />

        {/* Fold highlights: fine zari lines following the drape */}
        <g fill="none" stroke="url(#ha-gold)" strokeLinecap="round">
          <path d="M-60 660 C 240 540, 440 800, 780 672 S 1280 408, 1680 548" strokeWidth="2.2" opacity="0.75" />
          <path d="M-60 700 C 250 584, 450 836, 790 710 S 1290 452, 1680 590" strokeWidth="1" opacity="0.45" />
          <path d="M-60 740 C 260 628, 462 872, 800 750 S 1300 498, 1680 634" strokeWidth="0.8" opacity="0.3" />
          <path d="M320 -20 C 580 214, 540 432, 836 486 S 1316 346, 1680 142" strokeWidth="1.6" opacity="0.6" />
          <path d="M360 -20 C 612 222, 578 446, 866 502 S 1340 364, 1680 176" strokeWidth="0.8" opacity="0.35" />
          <path d="M640 960 C 794 764, 1020 850, 1198 656 S 1510 480, 1680 580" strokeWidth="1.4" opacity="0.55" />
        </g>

        {/* Soft sheen where the light catches a fold */}
        <ellipse cx="1080" cy="470" rx="320" ry="90" fill="#f3dfa8" opacity="0.07" transform="rotate(-14 1080 470)" />
        <ellipse cx="520" cy="700" rx="260" ry="60" fill="#f3dfa8" opacity="0.06" transform="rotate(10 520 700)" />
      </g>

      {/* Jewellery: a gold ring with a ruby, floating off to the right */}
      <g transform="translate(1180 330)">
        <circle r="210" fill="url(#ha-glow)" />
        <g transform="rotate(-18)">
          <ellipse rx="150" ry="150" fill="none" stroke="url(#ha-gold)" strokeWidth="26" />
          <ellipse rx="150" ry="150" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="3" transform="translate(-8 -8) scale(0.985)" />
          <ellipse rx="150" ry="150" fill="none" stroke="#5a3d12" strokeOpacity="0.45" strokeWidth="4" transform="translate(9 9) scale(1.01)" />
          {/* ruby setting */}
          <g transform="translate(0 -150)">
            <path d="M-34 6 L-22 -26 L22 -26 L34 6 L0 52 Z" fill="url(#ha-gold)" />
            <path d="M-24 2 L-15 -19 L15 -19 L24 2 L0 36 Z" fill="url(#ha-ruby)" />
            <path d="M-15 -19 L0 -4 L15 -19 M-24 2 L0 -4 L24 2 M0 -4 L0 36" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" />
          </g>
        </g>
        {/* tiny gold beads orbiting it */}
        {[
          [-230, -60, 7],
          [-196, 120, 4.5],
          [215, 40, 6],
          [150, -190, 4],
          [40, 205, 5.5],
        ].map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="url(#ha-gold)" />
        ))}
      </g>

      <rect width="1600" height="900" fill="url(#ha-weave)" />
      {/* Darkens the left so the headline always has strong contrast over the artwork. */}
      <rect width="1600" height="900" fill="url(#ha-fade)" />
    </svg>
  );
}
