/**
 * Public contact details and social links, read from NEXT_PUBLIC_* env vars (inlined at build). Anything that is not
 * configured is left out of the UI: the site never shows a made-up phone number or a dead social link.
 */
const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** Only http(s) URLs are accepted, so a typo in the env can't produce a `javascript:` link. */
function httpUrl(v: string | undefined) {
  const s = clean(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const contact = {
  email: clean(process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
  phone: clean(process.env.NEXT_PUBLIC_SUPPORT_PHONE),
  hours: clean(process.env.NEXT_PUBLIC_SUPPORT_HOURS),
};

export const socials = [
  { key: "instagram", label: "Instagram", href: httpUrl(process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM) },
  { key: "facebook", label: "Facebook", href: httpUrl(process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK) },
  { key: "x", label: "X", href: httpUrl(process.env.NEXT_PUBLIC_SOCIAL_X) },
  { key: "youtube", label: "YouTube", href: httpUrl(process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE) },
].filter((s): s is { key: string; label: string; href: string } => s.href !== null);

/** `tel:` href from a human-written number. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;
