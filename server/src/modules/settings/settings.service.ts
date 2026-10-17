import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../config/logger.js';

const paise = z.number().int().min(0).max(100_000_000);

/** Validation for each settings group. `.strict()` so a typo is an error, not a silently ignored key. */
export const settingsSchemas = {
  shipping: z.object({ flatRate: paise, freeThreshold: paise }).strict(),
  payments: z
    .object({
      codEnabled: z.boolean(),
      codMaxOrder: paise,
      /** How long stock stays reserved while a customer completes an online payment. */
      reservationMinutes: z.number().int().min(5).max(120),
    })
    .strict(),
  returns: z
    .object({
      returnWindowDays: z.number().int().min(0).max(90),
      replacementEnabled: z.boolean(),
    })
    .strict(),
} as const;

export type SettingKey = keyof typeof settingsSchemas;
export const SETTING_KEYS = Object.keys(settingsSchemas) as SettingKey[];

export interface AppSettings {
  shipping: z.infer<typeof settingsSchemas.shipping>;
  payments: z.infer<typeof settingsSchemas.payments>;
  returns: z.infer<typeof settingsSchemas.returns>;
}

export const SETTING_DEFAULTS: AppSettings = {
  shipping: { flatRate: 9_900, freeThreshold: 299_900 }, // ₹99 under ₹2,999
  payments: { codEnabled: false, codMaxOrder: 500_000, reservationMinutes: 15 }, // COD off until an admin enables it
  returns: { returnWindowDays: 7, replacementEnabled: true },
};

type Db = Pick<typeof prisma, 'appSetting'>;

/** Stored values layered over defaults; a corrupt row falls back to defaults instead of breaking checkout. */
export async function getSettings(db: Db = prisma): Promise<AppSettings> {
  const rows = await db.appSetting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const merged: AppSettings = structuredClone(SETTING_DEFAULTS);
  for (const row of rows) {
    const key = row.key as SettingKey;
    const parsed = settingsSchemas[key].safeParse({ ...SETTING_DEFAULTS[key], ...(row.value as object) });
    if (parsed.success) (merged[key] as unknown) = parsed.data;
    else logger.error({ key, issues: parsed.error.issues }, 'Ignoring invalid stored setting; using defaults');
  }
  return merged;
}

export async function updateSetting(req: Request, key: SettingKey, value: unknown) {
  const parsed = settingsSchemas[key].parse(value);
  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    await tx.appSetting.upsert({
      where: { key },
      create: { key, value: parsed },
      update: { value: parsed },
    });
    await audit(tx, req, {
      action: 'settings.update',
      entityType: 'AppSetting',
      entityId: key,
      metadata: { from: before[key], to: parsed },
    });
    return parsed;
  });
}
