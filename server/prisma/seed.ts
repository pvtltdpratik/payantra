/**
 * Development seed data. Keep this separate from production data.
 *
 *   npm run seed
 *
 * Idempotent: existing categories/products (matched by slug) are left untouched.
 * Refuses to run when NODE_ENV=production unless SEED_ALLOW_PRODUCTION=yes.
 */
import { prisma } from '../src/config/prisma.js';
import { slugify } from '../src/lib/slug.js';

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'yes') {
  console.error('Refusing to seed demo data while NODE_ENV=production.');
  process.exit(1);
}

// Deterministic randomness so every developer gets the same catalogue.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261016);
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

const COLOURS: Record<string, string> = {
  Maroon: '5c1a2b', Emerald: '1f5c4a', Indigo: '2b3a67', Mustard: 'c79a2b', Rose: 'c26b7a',
  Teal: '1f6f78', Ivory: 'efe3cc', Saffron: 'd9772b', Peach: 'e8a98c', Navy: '1c2541',
  Olive: '6b6b2f', Wine: '4a1230', Gold: 'c8a45d', Charcoal: '3a3a3a', Black: '1d1d1d', Tan: 'a8794a',
};

const img = (colour: string, label: string, v: number) =>
  `/placeholder/${COLOURS[colour] ?? '5c1a2b'}?label=${encodeURIComponent(label)}&v=${v}`;

// ── Taxonomy ──────────────────────────────────────────────────────────────
type Cat = { name: string; gender: 'WOMEN' | 'MEN' | 'UNISEX'; children?: string[] };
const CATEGORIES: Cat[] = [
  { name: 'Sarees', gender: 'WOMEN', children: ['Silk Sarees', 'Cotton Sarees', 'Georgette & Chiffon Sarees', 'Linen Sarees', 'Designer Sarees'] },
  { name: 'Kurtis', gender: 'WOMEN' },
  { name: 'Kurta Sets', gender: 'WOMEN' },
  { name: 'Salwar Suits', gender: 'WOMEN' },
  { name: 'Lehengas', gender: 'WOMEN' },
  { name: 'Dupattas & Shawls', gender: 'WOMEN' },
  { name: 'Indo-Western', gender: 'WOMEN' },
  { name: 'Jewellery', gender: 'WOMEN' },
  { name: 'Bags & Accessories', gender: 'WOMEN' },
  { name: "Men's Kurtas", gender: 'MEN' },
  { name: 'Nehru Jackets', gender: 'MEN' },
  { name: 'Sherwanis', gender: 'MEN' },
  { name: "Men's Indo-Western", gender: 'MEN' },
  { name: "Men's Accessories", gender: 'MEN' },
];

const COLLECTIONS = [
  { name: 'Wedding Edit', seasonal: false, description: 'Heirloom weaves and statement pieces for the big day.' },
  { name: 'Festive Wear', seasonal: true, description: 'Celebrate Diwali, Navratri and Eid in colour.' },
  { name: 'Office Wear', seasonal: false, description: 'Polished ethnic wear for the working week.' },
  { name: 'Casual Wear', seasonal: false, description: 'Easy, breathable everyday silhouettes.' },
  { name: 'Gifting', seasonal: false, description: 'Thoughtful pieces they will treasure.' },
];

// ── Products ──────────────────────────────────────────────────────────────
const SIZES_APPAREL = ['S', 'M', 'L', 'XL', 'XXL'];
const FREE = ['Free Size'];

interface P {
  name: string;
  cat: string; // category name
  gender: 'WOMEN' | 'MEN' | 'UNISEX';
  fabric: string;
  price: number; // rupees
  sale?: number;
  colours: string[];
  sizes: string[];
  occasion: string;
  collections: string[];
  featured?: boolean;
  isNew?: boolean;
  blurb: string;
}

const PRODUCTS: P[] = [
  { name: 'Banarasi Silk Saree with Zari Border', cat: 'Silk Sarees', gender: 'WOMEN', fabric: 'Banarasi Silk', price: 18999, sale: 15999, colours: ['Maroon', 'Emerald'], sizes: FREE, occasion: 'Wedding', collections: ['Wedding Edit', 'Festive Wear'], featured: true, blurb: 'Handwoven on a traditional loom with a rich zari border and pallu.' },
  { name: 'Kanjivaram Silk Saree in Temple Border', cat: 'Silk Sarees', gender: 'WOMEN', fabric: 'Kanjivaram Silk', price: 28999, colours: ['Wine', 'Gold', 'Teal'], sizes: FREE, occasion: 'Wedding', collections: ['Wedding Edit'], featured: true, blurb: 'Pure mulberry silk with contrast temple border from the looms of Kanchipuram.' },
  { name: 'Mysore Silk Saree', cat: 'Silk Sarees', gender: 'WOMEN', fabric: 'Mysore Silk', price: 12499, colours: ['Rose', 'Navy'], sizes: FREE, occasion: 'Festive', collections: ['Festive Wear'], blurb: 'Feather-light crepe silk with a soft, lustrous drape.' },
  { name: 'Handloom Cotton Saree', cat: 'Cotton Sarees', gender: 'WOMEN', fabric: 'Cotton', price: 3499, colours: ['Indigo', 'Mustard', 'Rose'], sizes: FREE, occasion: 'Casual', collections: ['Casual Wear', 'Office Wear'], blurb: 'Breathable handloom cotton with a subtle woven border for everyday wear.' },
  { name: 'Chanderi Cotton Silk Saree', cat: 'Cotton Sarees', gender: 'WOMEN', fabric: 'Chanderi', price: 4999, sale: 4299, colours: ['Peach', 'Ivory'], sizes: FREE, occasion: 'Office', collections: ['Office Wear', 'Gifting'], blurb: 'Sheer Chanderi texture with delicate buttis and a glossy finish.' },
  { name: 'Floral Printed Georgette Saree', cat: 'Georgette & Chiffon Sarees', gender: 'WOMEN', fabric: 'Georgette', price: 2999, colours: ['Teal', 'Saffron', 'Rose'], sizes: FREE, occasion: 'Casual', collections: ['Casual Wear'], blurb: 'Fluid georgette with a bold floral print and satin border.' },
  { name: 'Ombre Chiffon Saree', cat: 'Georgette & Chiffon Sarees', gender: 'WOMEN', fabric: 'Chiffon', price: 3499, colours: ['Rose', 'Teal'], sizes: FREE, occasion: 'Party', collections: ['Festive Wear'], isNew: true, blurb: 'A graceful ombre that shifts tone from pallu to pleats.' },
  { name: 'Pure Linen Saree with Tassels', cat: 'Linen Sarees', gender: 'WOMEN', fabric: 'Linen', price: 3999, colours: ['Olive', 'Ivory', 'Charcoal'], sizes: FREE, occasion: 'Office', collections: ['Office Wear', 'Casual Wear'], blurb: 'Crisp, breathable linen with a tasselled pallu — effortless in summer.' },
  { name: 'Sequin Embellished Designer Saree', cat: 'Designer Sarees', gender: 'WOMEN', fabric: 'Net', price: 8999, sale: 7499, colours: ['Black', 'Wine'], sizes: FREE, occasion: 'Party', collections: ['Festive Wear', 'Wedding Edit'], featured: true, isNew: true, blurb: 'All-over sequin work on net, paired with a velvet blouse piece.' },
  { name: 'Cotton Anarkali Kurti', cat: 'Kurtis', gender: 'WOMEN', fabric: 'Cotton', price: 1499, colours: ['Indigo', 'Mustard'], sizes: SIZES_APPAREL, occasion: 'Casual', collections: ['Casual Wear'], blurb: 'Flared anarkali cut in soft cotton with block-print details.' },
  { name: 'Chikankari Straight Kurti', cat: 'Kurtis', gender: 'WOMEN', fabric: 'Georgette', price: 2299, colours: ['Ivory', 'Peach', 'Teal'], sizes: SIZES_APPAREL, occasion: 'Festive', collections: ['Festive Wear', 'Gifting'], featured: true, blurb: 'Hand-embroidered Lucknowi chikankari on a flowing straight cut.' },
  { name: 'Office Wear Straight Kurti', cat: 'Kurtis', gender: 'WOMEN', fabric: 'Cotton Blend', price: 1299, colours: ['Navy', 'Charcoal'], sizes: SIZES_APPAREL, occasion: 'Office', collections: ['Office Wear'], blurb: 'A clean, tailored kurti that moves from desk to dinner.' },
  { name: 'Festive Embroidered Kurti', cat: 'Kurtis', gender: 'WOMEN', fabric: 'Silk Blend', price: 2799, colours: ['Maroon', 'Emerald'], sizes: SIZES_APPAREL, occasion: 'Festive', collections: ['Festive Wear'], isNew: true, blurb: 'Zari-thread embroidery on the yoke and sleeves.' },
  { name: 'Cotton Kurta Set with Dupatta', cat: 'Kurta Sets', gender: 'WOMEN', fabric: 'Cotton', price: 3299, colours: ['Mustard', 'Rose'], sizes: SIZES_APPAREL, occasion: 'Casual', collections: ['Casual Wear', 'Office Wear'], blurb: 'Three-piece set: kurta, pants and a mulmul dupatta.' },
  { name: 'Silk Blend Kurta Set', cat: 'Kurta Sets', gender: 'WOMEN', fabric: 'Silk Blend', price: 5499, sale: 4799, colours: ['Wine', 'Teal'], sizes: SIZES_APPAREL, occasion: 'Festive', collections: ['Festive Wear', 'Gifting'], blurb: 'Rich silk-blend kurta set with a contrast gota-patti dupatta.' },
  { name: 'Embroidered Salwar Suit Set', cat: 'Salwar Suits', gender: 'WOMEN', fabric: 'Cotton Silk', price: 3999, colours: ['Peach', 'Emerald', 'Navy'], sizes: SIZES_APPAREL, occasion: 'Festive', collections: ['Festive Wear'], blurb: 'Classic salwar suit with thread embroidery and a chiffon dupatta.' },
  { name: 'Palazzo Suit Set', cat: 'Salwar Suits', gender: 'WOMEN', fabric: 'Rayon', price: 3199, colours: ['Olive', 'Rose'], sizes: SIZES_APPAREL, occasion: 'Casual', collections: ['Casual Wear'], blurb: 'Comfortable palazzo set with a printed kurta and sheer dupatta.' },
  { name: 'Bridal Lehenga with Heavy Embroidery', cat: 'Lehengas', gender: 'WOMEN', fabric: 'Velvet', price: 45999, sale: 39999, colours: ['Maroon', 'Wine'], sizes: ['S', 'M', 'L'], occasion: 'Wedding', collections: ['Wedding Edit'], featured: true, blurb: 'Hand-embroidered zardozi and dabka on rich velvet, with a net dupatta.' },
  { name: 'Festive Lehenga Choli', cat: 'Lehengas', gender: 'WOMEN', fabric: 'Georgette', price: 18999, colours: ['Teal', 'Saffron', 'Rose'], sizes: ['S', 'M', 'L', 'XL'], occasion: 'Festive', collections: ['Festive Wear', 'Wedding Edit'], isNew: true, blurb: 'Flared lehenga with mirror-work choli and a scalloped dupatta.' },
  { name: 'Phulkari Embroidered Dupatta', cat: 'Dupattas & Shawls', gender: 'WOMEN', fabric: 'Cotton', price: 1999, colours: ['Rose', 'Mustard', 'Teal'], sizes: FREE, occasion: 'Festive', collections: ['Gifting', 'Festive Wear'], blurb: 'Vibrant Punjabi phulkari embroidery, stitched by hand.' },
  { name: 'Pure Pashmina Shawl', cat: 'Dupattas & Shawls', gender: 'UNISEX', fabric: 'Pashmina', price: 6999, colours: ['Ivory', 'Charcoal', 'Maroon'], sizes: FREE, occasion: 'Gifting', collections: ['Gifting'], blurb: 'Ultra-soft Kashmiri pashmina with a hand-finished fringe.' },
  { name: 'Indo-Western Jacket Dress', cat: 'Indo-Western', gender: 'WOMEN', fabric: 'Crepe', price: 4599, colours: ['Navy', 'Wine'], sizes: SIZES_APPAREL, occasion: 'Party', collections: ['Festive Wear'], isNew: true, blurb: 'A structured jacket-style dress with ethnic cuff embroidery.' },
  { name: 'Kundan Necklace Set', cat: 'Jewellery', gender: 'WOMEN', fabric: 'Alloy', price: 2499, colours: ['Gold'], sizes: ['One Size'], occasion: 'Wedding', collections: ['Wedding Edit', 'Gifting'], featured: true, blurb: 'Kundan-studded choker with matching earrings and maang tikka.' },
  { name: 'Oxidised Silver Jhumkas', cat: 'Jewellery', gender: 'WOMEN', fabric: 'Oxidised Silver', price: 899, colours: ['Charcoal', 'Gold'], sizes: ['One Size'], occasion: 'Casual', collections: ['Gifting', 'Casual Wear'], blurb: 'Lightweight jhumkas with intricate temple detailing.' },
  { name: 'Embroidered Potli Clutch', cat: 'Bags & Accessories', gender: 'WOMEN', fabric: 'Silk', price: 1599, colours: ['Maroon', 'Gold', 'Emerald'], sizes: ['One Size'], occasion: 'Party', collections: ['Gifting', 'Festive Wear'], blurb: 'Hand-beaded potli with a drawstring closure and wrist loop.' },
  { name: 'Cotton Kurta Pyjama Set', cat: "Men's Kurtas", gender: 'MEN', fabric: 'Cotton', price: 2499, colours: ['Ivory', 'Indigo', 'Olive'], sizes: SIZES_APPAREL, occasion: 'Casual', collections: ['Casual Wear'], blurb: 'Soft cotton kurta with matching pyjama — made for long festive days.' },
  { name: 'Silk Blend Festive Kurta', cat: "Men's Kurtas", gender: 'MEN', fabric: 'Silk Blend', price: 3999, sale: 3499, colours: ['Maroon', 'Navy', 'Emerald'], sizes: SIZES_APPAREL, occasion: 'Festive', collections: ['Festive Wear', 'Gifting'], featured: true, blurb: 'A refined sheen with subtle self-weave and mandarin collar.' },
  { name: 'Classic Nehru Jacket', cat: 'Nehru Jackets', gender: 'MEN', fabric: 'Cotton Blend', price: 3299, colours: ['Navy', 'Charcoal', 'Ivory'], sizes: SIZES_APPAREL, occasion: 'Festive', collections: ['Festive Wear', 'Office Wear'], blurb: 'The staple layer: tailored fit, mandarin collar, button front.' },
  { name: 'Printed Nehru Jacket', cat: 'Nehru Jackets', gender: 'MEN', fabric: 'Cotton Silk', price: 3799, colours: ['Wine', 'Teal'], sizes: SIZES_APPAREL, occasion: 'Festive', collections: ['Festive Wear'], isNew: true, blurb: 'A jacquard-print Nehru jacket that lifts a plain kurta.' },
  { name: 'Embroidered Wedding Sherwani', cat: 'Sherwanis', gender: 'MEN', fabric: 'Art Silk', price: 21999, colours: ['Ivory', 'Maroon'], sizes: ['M', 'L', 'XL', 'XXL'], occasion: 'Wedding', collections: ['Wedding Edit'], featured: true, blurb: 'Intricate thread-work sherwani with churidar and stole.' },
  { name: 'Bandhgala Indo-Western Suit', cat: "Men's Indo-Western", gender: 'MEN', fabric: 'Terry Rayon', price: 8999, colours: ['Black', 'Navy'], sizes: ['S', 'M', 'L', 'XL'], occasion: 'Party', collections: ['Wedding Edit', 'Festive Wear'], isNew: true, blurb: 'A sharply cut bandhgala jacket with matching trousers.' },
  { name: 'Handcrafted Leather Wallet', cat: "Men's Accessories", gender: 'UNISEX', fabric: 'Leather', price: 1299, colours: ['Tan', 'Black'], sizes: ['One Size'], occasion: 'Gifting', collections: ['Gifting'], blurb: 'Full-grain leather bifold with six card slots.' },
  { name: 'Kolhapuri Leather Chappals', cat: "Men's Accessories", gender: 'MEN', fabric: 'Leather', price: 1899, colours: ['Tan', 'Black'], sizes: ['7', '8', '9', '10', '11'], occasion: 'Casual', collections: ['Casual Wear', 'Gifting'], blurb: 'Traditional handcrafted Kolhapuri chappals with a cushioned insole.' },
];

// ── Run ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('Seeding catalogue…');

  const catIds = new Map<string, string>();
  let order = 0;
  for (const c of CATEGORIES) {
    const slug = slugify(c.name);
    const parent = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name: c.name, slug, gender: c.gender, sortOrder: order++, imageUrl: img('Maroon', c.name, 1) },
    });
    catIds.set(c.name, parent.id);
    for (const child of c.children ?? []) {
      const childSlug = slugify(child);
      const row = await prisma.category.upsert({
        where: { slug: childSlug },
        update: {},
        create: { name: child, slug: childSlug, gender: c.gender, parentId: parent.id, sortOrder: order++ },
      });
      catIds.set(child, row.id);
    }
  }

  const colIds = new Map<string, string>();
  for (const [i, c] of COLLECTIONS.entries()) {
    const slug = slugify(c.name);
    const row = await prisma.collection.upsert({
      where: { slug },
      update: {},
      create: { name: c.name, slug, description: c.description, isSeasonal: c.seasonal, sortOrder: i },
    });
    colIds.set(c.name, row.id);
  }

  let created = 0;
  let skipped = 0;
  let n = 0;
  for (const p of PRODUCTS) {
    n++;
    const slug = slugify(p.name);
    if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) {
      skipped++;
      continue;
    }
    const categoryId = catIds.get(p.cat);
    if (!categoryId) throw new Error(`Unknown category in seed data: ${p.cat}`);

    const base = p.price * 100;
    const sale = p.sale ? p.sale * 100 : null;
    const code = slugify(p.cat).slice(0, 3).toUpperCase();

    const variants = p.colours.flatMap((colour) =>
      p.sizes.map((size) => {
        // A deliberate spread: some sold out, some low, most healthy.
        const roll = rand();
        const stock = roll < 0.1 ? 0 : roll < 0.25 ? randInt(1, 4) : randInt(6, 30);
        return {
          sku: `PYN-${code}-${String(n).padStart(2, '0')}-${colour.slice(0, 3).toUpperCase()}-${size.replace(/\s+/g, '').toUpperCase()}`,
          size,
          colour,
          fabric: p.fabric,
          stock,
        };
      }),
    );

    const product = await prisma.product.create({
      data: {
        name: p.name,
        slug,
        description: `${p.blurb} Crafted in ${p.fabric.toLowerCase()}, this piece is made for ${p.occasion.toLowerCase()} occasions and finished with care by skilled artisans.`,
        careNotes: p.fabric.toLowerCase().includes('silk') ? 'Dry clean only. Store folded in muslin.' : 'Gentle hand wash in cold water. Dry in shade.',
        categoryId,
        gender: p.gender,
        fabric: p.fabric,
        occasion: p.occasion,
        basePrice: base,
        salePrice: sale,
        effectivePrice: sale ?? base,
        taxRatePercent: base >= 100_000 ? 12 : 5,
        status: 'ACTIVE',
        isFeatured: !!p.featured,
        isNewArrival: !!p.isNew,
        ratingAverage: (3.6 + rand() * 1.3).toFixed(2),
        ratingCount: randInt(3, 120),
        soldCount: randInt(0, 400),
        collections: { connect: p.collections.map((c) => ({ id: colIds.get(c)! })) },
        images: {
          create: [
            { url: img(p.colours[0], p.name, 1), alt: `${p.name} in ${p.colours[0]}`, sortOrder: 0, isPrimary: true },
            { url: img(p.colours[1] ?? p.colours[0], p.name, 2), alt: `${p.name} detail`, sortOrder: 1 },
            { url: img(p.colours[0], p.name, 3), alt: `${p.name} drape`, sortOrder: 2 },
          ],
        },
        variants: {
          create: variants.map((v) => ({
            sku: v.sku,
            size: v.size,
            colour: v.colour,
            fabric: v.fabric,
            inventory: { create: { onHand: v.stock, lowStockThreshold: 5 } },
          })),
        },
      },
      select: { variants: { select: { id: true, sku: true } } },
    });

    const received = product.variants
      .map((v) => ({ variantId: v.id, quantity: variants.find((x) => x.sku === v.sku)!.stock }))
      .filter((m) => m.quantity > 0);
    if (received.length) {
      await prisma.stockMovement.createMany({
        data: received.map((m) => ({ ...m, type: 'RECEIVED' as const, note: 'Seed stock' })),
      });
    }
    created++;
  }

  const totals = await Promise.all([prisma.category.count(), prisma.product.count(), prisma.productVariant.count()]);
  console.log(`Created ${created} products (${skipped} already existed).`);
  console.log(`Database now holds ${totals[0]} categories, ${totals[1]} products, ${totals[2]} variants.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
