/**
 * Applies every migration to a throwaway in-memory Postgres (PGlite) and proves the
 * database-level guarantees hold. Needs no external database, so it runs in CI and offline.
 *
 *   npm run db:verify
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'prisma', 'migrations');
const db = new PGlite();

const dirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const d of dirs) {
  await db.exec(readFileSync(join(migrationsDir, d, 'migration.sql'), 'utf8'));
  console.log(`applied  ${d}`);
}

let failures = 0;
const check = (label, passed, detail = '') => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures++;
};
const rejects = async (label, sql) => {
  try {
    await db.exec(sql);
    check(label, false, 'statement was accepted');
  } catch (e) {
    check(label, true, e.message.split('\n')[0].slice(0, 80));
  }
};

const U = '11111111-1111-1111-1111-111111111111';
const C = '22222222-2222-2222-2222-222222222222';
const P = '33333333-3333-3333-3333-333333333333';
const V = '44444444-4444-4444-4444-444444444444';

await db.exec(`insert into "Profile"(id,email,"updatedAt") values ('${U}','a@b.in',now())`);
await db.exec(`insert into "Category"(id,name,slug,"updatedAt") values ('${C}','Sarees','sarees',now())`);
await db.exec(`insert into "Product"(id,"categoryId",name,slug,description,gender,"basePrice","effectivePrice","updatedAt")
               values ('${P}','${C}','Silk','silk','d','WOMEN',500000,500000,now())`);
await db.exec(`insert into "ProductVariant"(id,"productId",sku,"updatedAt") values ('${V}','${P}','SKU-1',now())`);
await db.exec(`insert into "Inventory"("variantId","onHand",reserved,"updatedAt") values ('${V}',5,0,now())`);

const { rows } = await db.query(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
);
check('schema created', rows[0].n >= 30, `${rows[0].n} tables`);

await rejects('cannot reserve more stock than on hand', `update "Inventory" set reserved = 6`);
await rejects('stock cannot go negative', `update "Inventory" set "onHand" = -1`);
await rejects(
  'SKUs are unique case-insensitively',
  `insert into "ProductVariant"(id,"productId",sku,"updatedAt") values (gen_random_uuid(),'${P}','sku-1',now())`,
);
await rejects('sale price cannot exceed MRP', `update "Product" set "salePrice" = 600000, "effectivePrice" = 600000`);
await rejects('effective price cannot drift from sale/base price', `update "Product" set "salePrice" = 400000`);
await db.exec(`update "Product" set "salePrice" = 400000, "effectivePrice" = 400000`);
check('effective price follows sale price when updated together', true);
await db.exec(`update "Product" set "salePrice" = null, "effectivePrice" = 500000`);
await rejects(
  'review rating must be 1–5',
  `insert into "Review"(id,"productId","userId","orderId",rating)
   values (gen_random_uuid(),'${P}','${U}',gen_random_uuid(),9)`,
);
await rejects(
  'emails are unique case-insensitively',
  `insert into "Profile"(id,email,"updatedAt") values (gen_random_uuid(),'A@B.IN',now())`,
);

const addr = `insert into "Address"(id,"userId","fullName",phone,line1,city,state,"postalCode","isDefault","updatedAt")
              values (gen_random_uuid(),'${U}','A','9999999999','l','c','s','411001',true,now())`;
await db.exec(addr);
await rejects('only one default address per user', addr);

// The atomic reservation statement the checkout service will use: 5 on hand.
const reserve = `update "Inventory" set reserved = reserved + 3
                 where "variantId" = '${V}' and "onHand" - reserved >= 3 returning reserved`;
const first = await db.query(reserve);
check('reserving 3 of 5 succeeds', first.rows.length === 1 && first.rows[0].reserved === 3);
const second = await db.query(reserve);
check('reserving 3 more is refused (only 2 left)', second.rows.length === 0);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll database guarantees hold.');
await db.close();
