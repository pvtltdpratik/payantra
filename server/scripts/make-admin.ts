/**
 * Promote an existing user to ADMIN from the command line.
 *
 *   npm run make-admin -- you@example.com
 *
 * The user must have signed in at least once (that is what creates their Profile row).
 * This is the bootstrap path for the very first admin; after that, admins manage roles
 * through PATCH /api/v1/admin/users/:id, which writes an audit-log entry.
 */
import { prisma } from '../src/config/prisma.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: npm run make-admin -- <email>');
  process.exit(1);
}

try {
  const user = await prisma.profile.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (!user) {
    console.error(`No user with email ${email}. Sign in to the storefront once first, then re-run.`);
    process.exit(1);
  }
  if (user.role === 'ADMIN') {
    console.log(`${email} is already an ADMIN.`);
  } else {
    await prisma.$transaction([
      prisma.profile.update({ where: { id: user.id }, data: { role: 'ADMIN', status: 'ACTIVE' } }),
      prisma.auditLog.create({
        data: {
          action: 'user.promote_cli',
          entityType: 'Profile',
          entityId: user.id,
          metadata: { email, from: user.role, to: 'ADMIN' },
        },
      }),
    ]);
    console.log(`${email} is now an ADMIN (was ${user.role}).`);
  }
} finally {
  await prisma.$disconnect();
}
