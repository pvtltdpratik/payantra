/**
 * Development placeholder artwork: /placeholder/5c1a2b?label=Silk%20Saree&v=2
 * Renders a tasteful woven-textile SVG in the given colour so the storefront looks
 * right before real product photography is uploaded. Not used for real products.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function isDark(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
}

function wrap(label: string, max = 22): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export async function GET(req: Request, ctx: { params: Promise<{ hex: string }> }) {
  const { hex } = await ctx.params;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return new Response("Invalid colour", { status: 400 });

  const url = new URL(req.url);
  const label = (url.searchParams.get("label") ?? "").slice(0, 80);
  const v = Math.min(3, Math.max(1, Number(url.searchParams.get("v")) || 1));

  const dark = isDark(hex);
  const ink = dark ? "#fbf7f0" : "#2a1a17";
  const lines = wrap(label);

  const motif =
    v === 1
      ? `<g fill="none" stroke="#c8a45d" stroke-width="2" opacity=".9">
           ${[60, 110, 160, 210].map((r) => `<circle cx="400" cy="440" r="${r}" opacity="${1 - r / 300}"/>`).join("")}
           <path d="M400 230 C 440 330, 540 360, 590 440 C 540 520, 440 550, 400 650 C 360 550, 260 520, 210 440 C 260 360, 360 330, 400 230 Z"/>
         </g>`
      : v === 2
        ? `<g stroke="#c8a45d" stroke-width="3" opacity=".7">
             ${Array.from({ length: 14 }, (_, i) => `<line x1="${-100 + i * 70}" y1="140" x2="${100 + i * 70}" y2="760"/>`).join("")}
           </g>`
        : `<g fill="#c8a45d" opacity=".55">
             ${Array.from({ length: 6 }, (_, r) => Array.from({ length: 5 }, (_, c) => ((r + c) % 2 === 0 ? `<rect x="${130 + c * 110}" y="${180 + r * 100}" width="90" height="80" rx="4"/>` : "")).join("")).join("")}
           </g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" role="img" aria-label="${esc(label || "Product image")}">
  <defs>
    <pattern id="weave" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="24" height="24" fill="#${hex}"/>
      <rect width="12" height="12" fill="#ffffff" opacity=".06"/>
      <rect x="12" y="12" width="12" height="12" fill="#000000" opacity=".08"/>
    </pattern>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".18"/>
      <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".25"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1000" fill="url(#weave)"/>
  <rect width="800" height="1000" fill="url(#sheen)"/>
  <rect x="28" y="28" width="744" height="944" fill="none" stroke="#c8a45d" stroke-width="3"/>
  <rect x="44" y="44" width="712" height="912" fill="none" stroke="#c8a45d" stroke-width="1" opacity=".6"/>
  ${motif}
  <text x="400" y="110" text-anchor="middle" font-family="Georgia, serif" font-size="26" letter-spacing="10" fill="${ink}" opacity=".85">PAYANTRA</text>
  <g font-family="Georgia, serif" font-size="40" fill="${ink}" text-anchor="middle">
    ${lines.map((l, i) => `<text x="400" y="${860 + (i - (lines.length - 1) / 2) * 48}">${esc(l)}</text>`).join("")}
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
