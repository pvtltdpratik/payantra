/** Lowercase, ASCII, hyphen-separated. Falls back to "item" so a slug is never empty. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'item';
}

/** Appends -2, -3, … until `exists` reports the slug is free. */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  for (let n = 2; await exists(candidate); n++) {
    candidate = `${root}-${n}`;
    if (n > 200) throw new Error(`Could not find a free slug for "${base}"`);
  }
  return candidate;
}
