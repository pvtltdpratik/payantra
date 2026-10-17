import { prisma, type Prisma } from '../../config/prisma.js';
import { AppError } from '../../lib/errors.js';
import { pageMeta, toSkipTake } from '../../lib/pagination.js';

const select = { id: true, email: true, fullName: true, phone: true, status: true, createdAt: true } as const;

interface Q {
  page: number;
  pageSize: number;
  q?: string;
  status?: 'ACTIVE' | 'SUSPENDED';
}

/** Customers only (delivery partners and admins have their own screens), with what they have spent. */
export async function listCustomers(q: Q) {
  const search = q.q?.trim();
  const where: Prisma.ProfileWhereInput = {
    role: 'CUSTOMER',
    ...(q.status ? { status: q.status } : {}),
    ...(search ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, { fullName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.profile.count({ where }),
    prisma.profile.findMany({ where, select, orderBy: { createdAt: 'desc' }, ...toSkipTake(q) }),
  ]);

  const ids = rows.map((r) => r.id);
  const [orders, spent] = ids.length
    ? await Promise.all([
        prisma.order.groupBy({ by: ['userId'], where: { userId: { in: ids }, fulfilmentStatus: { not: 'CANCELLED' } }, _count: { _all: true }, _max: { createdAt: true } }),
        prisma.order.groupBy({ by: ['userId'], where: { userId: { in: ids }, paidAt: { not: null } }, _sum: { grandTotal: true } }),
      ])
    : [[], []];

  return {
    items: rows.map((r) => ({
      ...r,
      orders: orders.find((o) => o.userId === r.id)?._count._all ?? 0,
      lastOrderAt: orders.find((o) => o.userId === r.id)?._max.createdAt ?? null,
      totalSpent: spent.find((s) => s.userId === r.id)?._sum.grandTotal ?? 0,
    })),
    meta: pageMeta(q, total),
  };
}

export async function getCustomer(id: string) {
  const profile = await prisma.profile.findFirst({ where: { id, role: 'CUSTOMER' }, select });
  if (!profile) throw AppError.notFound('Customer not found');

  const [orders, paid, refunded, recent, addresses, support, wishlist, reviews] = await Promise.all([
    prisma.order.aggregate({ where: { userId: id, fulfilmentStatus: { not: 'CANCELLED' } }, _count: { _all: true }, _min: { createdAt: true }, _max: { createdAt: true } }),
    prisma.order.aggregate({ where: { userId: id, paidAt: { not: null } }, _count: { _all: true }, _sum: { grandTotal: true } }),
    prisma.refund.aggregate({ where: { status: 'PROCESSED', payment: { order: { userId: id } } }, _sum: { amount: true } }),
    prisma.order.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, orderNumber: true, createdAt: true, grandTotal: true, paymentMethod: true, paymentStatus: true, fulfilmentStatus: true },
    }),
    prisma.address.findMany({ where: { userId: id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }], select: { id: true, label: true, fullName: true, line1: true, city: true, state: true, postalCode: true, isDefault: true } }),
    prisma.supportRequest.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, subject: true, status: true, createdAt: true } }),
    prisma.wishlistItem.count({ where: { wishlist: { userId: id } } }),
    prisma.review.count({ where: { userId: id } }),
  ]);

  const gross = paid._sum.grandTotal ?? 0;
  const back = refunded._sum.amount ?? 0;
  return {
    ...profile,
    stats: {
      orders: orders._count._all,
      paidOrders: paid._count._all,
      totalSpent: gross,
      refunded: back,
      netSpent: gross - back,
      averageOrder: paid._count._all ? Math.round(gross / paid._count._all) : 0,
      firstOrderAt: orders._min.createdAt,
      lastOrderAt: orders._max.createdAt,
      wishlistItems: wishlist,
      reviews,
    },
    recentOrders: recent,
    addresses,
    supportRequests: support,
  };
}
