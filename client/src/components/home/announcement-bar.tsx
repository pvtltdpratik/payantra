import Link from "next/link";
import { getBanners } from "@/services/home";

const DEFAULT_TEXT = "Handcrafted Indian fashion, delivered across India";
const BAR = "flex h-9 items-center justify-center bg-primary px-4 text-center text-xs tracking-wide text-primary-foreground print:hidden";

/**
 * The thin bar above the header. An admin's ANNOUNCEMENT banner replaces the default line (and may link
 * somewhere); with none, the default stays, so the bar is never empty and never changes height.
 */
export async function AnnouncementBar() {
  const [banner] = await getBanners("ANNOUNCEMENT");
  const text = banner ? [banner.title, banner.subtitle].filter(Boolean).join(" · ") : DEFAULT_TEXT;
  return (
    <p className={BAR} data-testid="announcement-bar">
      {banner?.linkUrl ? (
        <Link href={banner.linkUrl} className="truncate underline-offset-4 hover:underline">
          {text}
        </Link>
      ) : (
        <span className="truncate">{text}</span>
      )}
    </p>
  );
}

/** Same box, default text: what shows while the banner loads. */
export const AnnouncementFallback = () => (
  <p className={BAR}>
    <span className="truncate">{DEFAULT_TEXT}</span>
  </p>
);
