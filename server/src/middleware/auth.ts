import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { AppError } from '../lib/errors.js';

export type Role = 'CUSTOMER' | 'DELIVERY_PARTNER' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const issuer = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const legacySecret = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : null;

/** Verify a Supabase access token. Asymmetric keys via JWKS first; HS256 secret for legacy projects. */
export async function verifySupabaseToken(token: string): Promise<JWTPayload> {
  const options = { issuer, audience: 'authenticated' } as const;
  try {
    return (await jwtVerify(token, jwks, options)).payload;
  } catch (err) {
    if (!legacySecret) throw err;
    return (await jwtVerify(token, legacySecret, { ...options, algorithms: ['HS256'] })).payload;
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Authenticates the request and attaches `req.user`.
 *
 * Identity comes from the verified token; the ROLE comes from our own database.
 * Nothing in the token's user/app metadata or the request body can grant a role.
 */
export const requireAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = bearerToken(req);
    if (!token) throw AppError.unauthorized();

    let payload: JWTPayload;
    try {
      payload = await verifySupabaseToken(token);
    } catch {
      throw AppError.unauthorized('Invalid or expired session');
    }

    const id = payload.sub;
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    if (!id || !email) throw AppError.unauthorized('Token is missing identity claims');

    // First sight of a Supabase user creates a CUSTOMER profile. Existing rows keep their role.
    // Display details from the identity provider (e.g. Google) seed the profile once; after that
    // the user owns them via PATCH /users/me.
    const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    const avatar = text(meta.avatar_url ?? meta.picture, 500);

    let profile;
    try {
      profile = await prisma.profile.upsert({
        where: { id },
        create: {
          id,
          email,
          fullName: text(meta.full_name ?? meta.name, 100),
          avatarUrl: avatar?.startsWith('https://') ? avatar : undefined,
        },
        update: {},
        select: { id: true, email: true, role: true, status: true },
      });
    } catch (err) {
      // Same email already belongs to a different Supabase identity.
      if ((err as { code?: string }).code === 'P2002') {
        throw AppError.conflict('An account with this email already exists. Sign in with your original method.');
      }
      throw err;
    }

    if (profile.status !== 'ACTIVE') throw AppError.forbidden('This account is suspended');

    req.user = { id: profile.id, email: profile.email, role: profile.role };
    next();
  } catch (err) {
    next(err);
  }
};

/** Must run after `requireAuth`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    next();
  };
}

export const requireAdmin = [requireAuth, requireRole('ADMIN')] as const;
export const requireCustomer = [requireAuth, requireRole('CUSTOMER', 'ADMIN')] as const;
export const requireDeliveryPartner = [requireAuth, requireRole('DELIVERY_PARTNER')] as const;
