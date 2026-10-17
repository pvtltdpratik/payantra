import { beforeEach, describe, expect, it, vi } from 'vitest';

const IDS_BY_TOKEN: Record<string, string> = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  alice: '00000000-0000-4000-8000-0000000000c1',
  bob: '00000000-0000-4000-8000-0000000000c2',
  carol: '00000000-0000-4000-8000-0000000000c3',
  rider1: '00000000-0000-4000-8000-0000000000d1',
  rider2: '00000000-0000-4000-8000-0000000000d2',
};
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    const ids: Record<string, string> = {
      admin: '00000000-0000-4000-8000-0000000000a1',
      alice: '00000000-0000-4000-8000-0000000000c1',
      bob: '00000000-0000-4000-8000-0000000000c2',
      carol: '00000000-0000-4000-8000-0000000000c3',
      rider1: '00000000-0000-4000-8000-0000000000d1',
      rider2: '00000000-0000-4000-8000-0000000000d2',
    };
    if (!ids[token]) throw new Error('invalid token');
    return { payload: { sub: ids[token], email: `${token}@example.test` } };
  },
}));

const { createApp } = await import('../app.js');
const { prisma } = await import('../config/prisma.js');
const { makeCategory, makeProduct, resetDb } = await import('./helpers.js');
const { sim, simState } = await import('./commerce-helpers.js');
const { makeWorld } = await import('./commerce-world.js');

const app = createApp();
const w = makeWorld(app, prisma, { makeCategory, makeProduct });
const { admin } = w;
const alice = w.as('alice');
const bob = w.as('bob');
const rider1 = w.as('rider1');
const rider2 = w.as('rider2');

const APPLICATION = {
  fullName: 'Ravi Kumar',
  phone: '9811122233',
  vehicleType: 'Motorcycle',
  vehicleNumber: 'MH12AB1234',
  serviceCity: 'Pune',
  idDocumentType: 'Driving licence',
  idDocumentRef: 'DL-…4321',
};

beforeEach(async () => {
  await resetDb();
  await sim('reset');
  await w.reset();
  await prisma.profile.createMany({
    data: [
      { id: IDS_BY_TOKEN.rider1, email: 'rider1@example.test' },
      { id: IDS_BY_TOKEN.rider2, email: 'rider2@example.test' },
    ],
  });
});

/** An active, online partner: applied through the API and approved by an admin, exactly as in production. */
async function partner(c: ReturnType<typeof w.as>, body: Partial<typeof APPLICATION> = {}, online = true) {
  const applied = await c.post('/delivery/apply', { ...APPLICATION, ...body });
  expect(applied.status, JSON.stringify(applied.body)).toBe(201);
  const id = applied.body.data.id as string;
  const approved = await admin.patch(`/admin/delivery-partners/${id}`, { action: 'approve' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  if (online) expect((await c.put('/delivery/availability', { isOnline: true })).status).toBe(200);
  return id;
}

/** A paid online order moved by the admin to PACKED, ready for pickup. */
async function packedOrder(opts: { cod?: boolean; customer?: ReturnType<typeof w.as>; price?: number } = {}) {
  const customer = opts.customer ?? alice;
  const a = await w.sellable({ price: opts.price ?? 100_000, onHand: 10 });
  let orderId: string;
  if (opts.cod) {
    await admin.put('/admin/settings/payments', { codEnabled: true, codMaxOrder: 5_000_000, reservationMinutes: 15 });
    const res = await w.checkout(customer, [{ variantId: a.variantId }], { method: 'COD' });
    expect(res.status).toBe(201);
    orderId = res.body.data.order.id;
    expect((await admin.patch(`/admin/orders/${orderId}/status`, { status: 'PAYMENT_CONFIRMED' })).status).toBe(200);
  } else {
    const placed = await w.placeOnline(customer, [{ variantId: a.variantId }]);
    await w.payAndVerify(customer, placed);
    orderId = placed.order.id;
  }
  for (const status of ['PROCESSING', 'PACKED']) expect((await admin.patch(`/admin/orders/${orderId}/status`, { status })).status).toBe(200);
  return { orderId, a };
}

const assignTo = (orderId: string, partnerId: string) => admin.post(`/admin/orders/${orderId}/assignment`, { partnerId });
const setStatus = (c: ReturnType<typeof w.as>, assignmentId: string, body: object) => c.post(`/delivery/assignments/${assignmentId}/status`, body);
const myJobs = async (c: ReturnType<typeof w.as>, view: 'active' | 'history' = 'active') => (await c.get(`/delivery/assignments?view=${view}`)).body.data as any[];
const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).fulfilmentStatus;

/** Assign → accept → pick up → out for delivery; returns the assignment id. */
async function outForDelivery(c: ReturnType<typeof w.as>, orderId: string, partnerId: string) {
  expect((await assignTo(orderId, partnerId)).status).toBe(201);
  const id = (await myJobs(c))[0].id as string;
  for (const status of ['ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY']) {
    const r = await setStatus(c, id, { status });
    expect(r.status, `${status}: ${JSON.stringify(r.body)}`).toBe(200);
  }
  return id;
}

const customerCode = async (customer: ReturnType<typeof w.as>, orderId: string) => (await customer.get(`/orders/${orderId}`)).body.data.delivery.code as string | null;

describe('partner onboarding', () => {
  it('lets a customer apply, and applying changes nothing about their access', async () => {
    const res = await rider1.post('/delivery/apply', APPLICATION);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', isOnline: false });

    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: IDS_BY_TOKEN.rider1 } });
    expect(profile.role).toBe('CUSTOMER'); // a role is only ever granted by an admin
    expect(profile.phone).toBe('9811122233');
    expect((await rider1.get('/delivery/stats')).status).toBe(403);
    expect((await rider1.get('/delivery/assignments')).status).toBe(403);

    const me = await rider1.get('/delivery/me');
    expect(me.body.data.partner.status).toBe('PENDING');
    // The admin is told, and can see the ID reference that a partner's own view never repeats.
    expect((await prisma.notification.findMany({ where: { userId: IDS_BY_TOKEN.admin } })).map((n) => n.title)).toContain('New delivery partner application');
    expect(me.body.data.partner).not.toHaveProperty('idDocumentRef');
  });

  it('enforces the configured onboarding requirements, and honours relaxing them', async () => {
    expect((await rider1.post('/delivery/apply', { ...APPLICATION, vehicleType: undefined })).status).toBe(422);
    expect((await rider1.post('/delivery/apply', { ...APPLICATION, idDocumentRef: undefined })).status).toBe(422);
    expect((await rider1.post('/delivery/apply', { ...APPLICATION, phone: '12345' })).status).toBe(400);
    expect((await rider1.post('/delivery/apply', { ...APPLICATION, role: 'ADMIN' })).status).toBe(400); // strict body

    await admin.put('/admin/settings/delivery', { defaultPayout: 4000, requireVehicle: false, requireIdDocument: false });
    const res = await rider1.post('/delivery/apply', { fullName: 'Ravi Kumar', phone: '9811122233', serviceCity: 'Pune' });
    expect(res.status).toBe(201);
  });

  it('only an admin can approve, and approval grants the role and the default payout', async () => {
    const applied = await rider1.post('/delivery/apply', APPLICATION);
    const id = applied.body.data.id;

    expect((await alice.patch(`/admin/delivery-partners/${id}`, { action: 'approve' })).status).toBe(403);
    expect((await rider1.patch(`/admin/delivery-partners/${id}`, { action: 'approve' })).status).toBe(403); // not even for themselves

    const res = await admin.patch(`/admin/delivery-partners/${id}`, { action: 'approve', perDeliveryPayout: 5500 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'APPROVED', perDeliveryPayout: 5500 });
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: IDS_BY_TOKEN.rider1 } })).role).toBe('DELIVERY_PARTNER');
    expect((await rider1.get('/delivery/stats')).status).toBe(200);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'partner.approve' } });
    expect(audit?.actorId).toBe(IDS_BY_TOKEN.admin);
  });

  it('requires a reason to reject or suspend, and a rejected applicant can apply again', async () => {
    const id = (await rider1.post('/delivery/apply', APPLICATION)).body.data.id;
    expect((await admin.patch(`/admin/delivery-partners/${id}`, { action: 'reject' })).status).toBe(400);
    expect((await admin.patch(`/admin/delivery-partners/${id}`, { action: 'reject', reason: 'Documents unclear' })).status).toBe(200);

    const me = await rider1.get('/delivery/me');
    expect(me.body.data.partner).toMatchObject({ status: 'REJECTED', rejectionReason: 'Documents unclear' });
    expect((await rider1.get('/delivery/stats')).status).toBe(403);

    const again = await rider1.post('/delivery/apply', APPLICATION);
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({ status: 'PENDING', rejectionReason: null });
  });

  it('refuses a second application from an approved partner and from an admin', async () => {
    await partner(rider1);
    expect((await rider1.post('/delivery/apply', APPLICATION)).status).toBe(409);
    expect((await admin.post('/delivery/apply', APPLICATION)).status).toBe(403);
  });

  it('lets an admin grant the role from the users screen, which creates an active partner record', async () => {
    const res = await admin.patch(`/admin/users/${IDS_BY_TOKEN.rider1}`, { role: 'DELIVERY_PARTNER' });
    expect(res.status).toBe(200);
    const p = await prisma.deliveryPartner.findUniqueOrThrow({ where: { userId: IDS_BY_TOKEN.rider1 } });
    expect(p).toMatchObject({ status: 'APPROVED', approvedById: IDS_BY_TOKEN.admin });
    expect((await rider1.get('/delivery/stats')).status).toBe(200);

    await rider1.put('/delivery/availability', { isOnline: true });
    await admin.patch(`/admin/users/${IDS_BY_TOKEN.rider1}`, { role: 'CUSTOMER' });
    expect((await prisma.deliveryPartner.findUniqueOrThrow({ where: { userId: IDS_BY_TOKEN.rider1 } })).isOnline).toBe(false);
    expect((await rider1.get('/delivery/stats')).status).toBe(403);
  });

  it('suspends a partner (blocking the API) but not while they hold parcels in transit', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    await outForDelivery(rider1, orderId, id);

    const blocked = await admin.patch(`/admin/delivery-partners/${id}`, { action: 'suspend', reason: 'Complaints' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/in transit/);

    await prisma.deliveryAssignment.updateMany({ where: { orderId }, data: { status: 'DELIVERED' } });
    expect((await admin.patch(`/admin/delivery-partners/${id}`, { action: 'suspend', reason: 'Complaints' })).status).toBe(200);
    expect((await rider1.get('/delivery/assignments')).status).toBe(403);
    expect((await rider1.put('/delivery/availability', { isOnline: true })).status).toBe(403);

    expect((await admin.patch(`/admin/delivery-partners/${id}`, { action: 'reactivate' })).status).toBe(200);
    expect((await rider1.get('/delivery/assignments')).status).toBe(200);
  });
});

describe('assigning deliveries', () => {
  it('assigns only packed orders to active, online partners', async () => {
    const id = await partner(rider1);
    const a = await w.sellable({ onHand: 5 });
    const placed = await w.placeOnline(alice, [{ variantId: a.variantId }]);
    await w.payAndVerify(alice, placed);
    // PAYMENT_CONFIRMED is not packed yet.
    expect((await assignTo(placed.order.id, id)).status).toBe(409);

    const { orderId } = await packedOrder();
    expect((await assignTo(orderId, id)).status).toBe(201);
    expect((await assignTo(orderId, id)).status).toBe(409); // already theirs

    const pending = (await rider2.post('/delivery/apply', { ...APPLICATION, fullName: 'Pending Person' })).body.data.id;
    const { orderId: o2 } = await packedOrder();
    expect((await assignTo(o2, pending)).status).toBe(409); // not approved
    const offline = await partner(rider2, {}, false);
    const refused = await assignTo(o2, offline);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/offline/);
  });

  it('only an admin can assign, unassign or reissue codes', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    for (const c of [alice, rider1]) {
      expect((await c.post(`/admin/orders/${orderId}/assignment`, { partnerId: id })).status).toBe(403);
      expect((await c.delete(`/admin/orders/${orderId}/assignment`)).status).toBe(403);
      expect((await c.post(`/admin/orders/${orderId}/assignment/reissue-code`)).status).toBe(403);
      expect((await c.get('/admin/delivery-partners')).status).toBe(403);
    }
  });

  it('shows each partner only their own jobs, and treats someone else’s as missing', async () => {
    const p1 = await partner(rider1);
    await partner(rider2, { fullName: 'Second Rider' });
    const { orderId } = await packedOrder();
    await assignTo(orderId, p1);

    const mine = await myJobs(rider1);
    expect(mine).toHaveLength(1);
    expect(await myJobs(rider2)).toHaveLength(0);

    expect((await rider1.get(`/delivery/assignments/${mine[0].id}`)).status).toBe(200);
    expect((await rider2.get(`/delivery/assignments/${mine[0].id}`)).status).toBe(404);
    expect((await setStatus(rider2, mine[0].id, { status: 'ACCEPTED' })).status).toBe(404);
    expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: mine[0].id } })).status).toBe('ASSIGNED');
  });

  it('reveals customer details in stages and never leaks email or prices', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    await assignTo(orderId, id);
    const [job] = await myJobs(rider1);

    // Before accepting: the area only.
    expect(job.address).toMatchObject({ city: 'Pune', postalCode: '411001', fullName: null, line1: null });
    expect(job.customerPhone).toBeNull();
    expect(job.order.items).toEqual([]);

    await setStatus(rider1, job.id, { status: 'ACCEPTED' });
    const working = (await rider1.get(`/delivery/assignments/${job.id}`)).body.data;
    expect(working.address).toMatchObject({ fullName: 'Asha Rao', line1: '12 MG Road' });
    expect(working.customerPhone).toBe('9876543210');
    expect(working.order.items).toHaveLength(1);

    const raw = JSON.stringify(working);
    expect(raw).not.toMatch(/example\.test/); // no email, anywhere
    expect(raw).not.toMatch(/unitPrice|lineTotal|grandTotal|subtotal/);

    // After the hand-over: the area only again.
    for (const status of ['PICKED_UP', 'OUT_FOR_DELIVERY']) await setStatus(rider1, job.id, { status });
    const code = (await customerCode(alice, orderId))!;
    await setStatus(rider1, job.id, { status: 'DELIVERED', code });
    const done = (await rider1.get(`/delivery/assignments/${job.id}`)).body.data;
    expect(done.customerPhone).toBeNull();
    expect(done.address.line1).toBeNull();
    expect(done.address.city).toBe('Pune');
  });

  it('lets an admin reassign before pickup, tells both partners, and records the history', async () => {
    const p1 = await partner(rider1);
    const p2 = await partner(rider2, { fullName: 'Second Rider' });
    const { orderId } = await packedOrder();
    await assignTo(orderId, p1);
    const [job] = await myJobs(rider1);
    await setStatus(rider1, job.id, { status: 'ACCEPTED' });

    expect((await assignTo(orderId, p2)).status).toBe(201);
    expect(await myJobs(rider1)).toHaveLength(0);
    const moved = await myJobs(rider2);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ id: job.id, status: 'ASSIGNED' }); // one assignment per order, restarted
    expect((await prisma.notification.findMany({ where: { userId: IDS_BY_TOKEN.rider1 } })).map((n) => n.title).join()).toMatch(/reassigned/i);
    expect((await prisma.deliveryStatusHistory.count({ where: { assignmentId: job.id } }))).toBeGreaterThanOrEqual(2);
  });

  it('unassigning frees the order for hand handling again', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    await assignTo(orderId, id);
    expect((await admin.patch(`/admin/orders/${orderId}/status`, { status: 'SHIPPED' })).status).toBe(409);

    expect((await admin.delete(`/admin/orders/${orderId}/assignment`)).status).toBe(200);
    expect(await myJobs(rider1)).toHaveLength(0);
    expect((await admin.patch(`/admin/orders/${orderId}/status`, { status: 'SHIPPED' })).status).toBe(200);
    expect((await admin.delete(`/admin/orders/${orderId}/assignment`)).status).toBe(404);
  });

  it('stops an admin hand-shipping or delivering an order a partner is carrying', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    const job = await outForDelivery(rider1, orderId, id);
    for (const status of ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      const r = await admin.patch(`/admin/orders/${orderId}/status`, { status });
      expect(r.status).toBe(409);
    }
    const r = await admin.patch(`/admin/orders/${orderId}/status`, { status: 'DELIVERED' });
    expect(r.body.error.message).toMatch(/delivery partner/);
    // …and cannot be unassigned mid-delivery either.
    expect((await admin.delete(`/admin/orders/${orderId}/assignment`)).status).toBe(409);
    expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: job } })).status).toBe('OUT_FOR_DELIVERY');
  });

  it('releases an unstarted job when the customer cancels the order', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    await assignTo(orderId, id);
    expect((await alice.post(`/orders/${orderId}/cancel`, { reason: 'Changed my mind' })).status).toBe(200);

    const job = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { orderId } });
    expect(job).toMatchObject({ status: 'REJECTED', failureReason: 'Order cancelled' });
    expect((await prisma.notification.findMany({ where: { userId: IDS_BY_TOKEN.rider1 } })).map((n) => n.title).join()).toMatch(/cancelled/i);
    expect(await myJobs(rider1)).toHaveLength(0);
  });
});

describe('the delivery lifecycle', () => {
  it('takes an online order from packed to delivered, in lock-step with the order status', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    expect((await assignTo(orderId, id)).status).toBe(201);
    const [job] = await myJobs(rider1);
    expect(job.nextStatuses).toEqual(['ACCEPTED', 'REJECTED']);

    await setStatus(rider1, job.id, { status: 'ACCEPTED' });
    expect(await orderStatus(orderId)).toBe('PACKED');
    await setStatus(rider1, job.id, { status: 'PICKED_UP' });
    expect(await orderStatus(orderId)).toBe('SHIPPED');
    await setStatus(rider1, job.id, { status: 'OUT_FOR_DELIVERY' });
    expect(await orderStatus(orderId)).toBe('OUT_FOR_DELIVERY');

    const code = (await customerCode(alice, orderId))!;
    expect(code).toMatch(/^\d{6}$/);
    const done = await setStatus(rider1, job.id, { status: 'DELIVERED', code, notes: 'Left with the guard' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'DELIVERED', notes: 'Left with the guard' });
    expect(await orderStatus(orderId)).toBe('DELIVERED');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { history: true } });
    expect(order.history.map((h) => h.status)).toEqual(['PLACED', 'PAYMENT_CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    const delivered = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId, status: 'DELIVERED' } });
    expect(delivered.actorId).toBe(IDS_BY_TOKEN.rider1); // who did it is on the record
    const row = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.deliveredAt).not.toBeNull();
    expect(row.otpExpiresAt).toBeNull();

    // The customer was told at each step, and the return window now counts from delivery.
    const titles = (await prisma.notification.findMany({ where: { userId: IDS_BY_TOKEN.alice } })).map((n) => n.title).join('|');
    expect(titles).toMatch(/shipped/);
    expect(titles).toMatch(/out for delivery/);
    expect(titles).toMatch(/delivered/);
    expect((await alice.get(`/orders/${orderId}`)).body.data.actions.canReturn).toBe(true);
  });

  it('refuses a step that skips the sequence', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    await assignTo(orderId, id);
    const [job] = await myJobs(rider1);
    for (const status of ['PICKED_UP', 'OUT_FOR_DELIVERY']) {
      const r = await setStatus(rider1, job.id, { status });
      expect(r.status).toBe(409);
      expect(r.body.error.details.allowed).toEqual(['ACCEPTED', 'REJECTED']);
    }
    expect((await setStatus(rider1, job.id, { status: 'DELIVERED', code: '123456' })).status).toBe(409);
    expect(await orderStatus(orderId)).toBe('PACKED');
  });

  it('will not deliver without the right code, counts wrong guesses, and locks after five', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    const job = await outForDelivery(rider1, orderId, id);
    const code = (await customerCode(alice, orderId))!;
    const wrong = code === '000000' ? '111111' : '000000';

    expect((await setStatus(rider1, job, { status: 'DELIVERED' })).status).toBe(400); // no code at all
    expect((await setStatus(rider1, job, { status: 'DELIVERED', code: '12ab' })).status).toBe(400);

    const first = await setStatus(rider1, job, { status: 'DELIVERED', code: wrong });
    expect(first.status).toBe(422);
    expect(first.body.error.details).toEqual({ attemptsLeft: 4 });
    expect(await orderStatus(orderId)).toBe('OUT_FOR_DELIVERY');
    // The failed guess was recorded even though the request failed.
    expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: job } })).otpAttempts).toBe(1);

    for (let i = 0; i < 4; i++) await setStatus(rider1, job, { status: 'DELIVERED', code: wrong });
    // Locked: even the CORRECT code is now refused.
    const locked = await setStatus(rider1, job, { status: 'DELIVERED', code });
    expect(locked.status).toBe(423);
    expect(await orderStatus(orderId)).toBe('OUT_FOR_DELIVERY');
    expect((await alice.get(`/orders/${orderId}`)).body.data.delivery).toMatchObject({ code: null, codeLocked: true });

    // An admin reissues: a NEW code, a fresh set of attempts, and the old code is dead.
    expect((await admin.post(`/admin/orders/${orderId}/assignment/reissue-code`)).status).toBe(200);
    const fresh = (await customerCode(alice, orderId))!;
    expect(fresh).not.toBe(code);
    expect((await setStatus(rider1, job, { status: 'DELIVERED', code })).status).toBe(422);
    expect((await setStatus(rider1, job, { status: 'DELIVERED', code: fresh })).status).toBe(200);
    expect(await orderStatus(orderId)).toBe('DELIVERED');
  });

  it('rejects an expired code until it is reissued', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    const job = await outForDelivery(rider1, orderId, id);
    const code = (await customerCode(alice, orderId))!;
    await prisma.deliveryAssignment.update({ where: { id: job }, data: { otpExpiresAt: new Date(Date.now() - 1000) } });

    const r = await setStatus(rider1, job, { status: 'DELIVERED', code });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('OTP_EXPIRED');
    expect((await alice.get(`/orders/${orderId}`)).body.data.delivery).toMatchObject({ code: null, codeExpired: true });

    await admin.post(`/admin/orders/${orderId}/assignment/reissue-code`);
    expect((await setStatus(rider1, job, { status: 'DELIVERED', code: (await customerCode(alice, orderId))! })).status).toBe(200);
  });

  it('shows the code and the partner’s number only to the order’s owner, and only while out for delivery', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    await assignTo(orderId, id);
    const [job] = await myJobs(rider1);

    let view = (await alice.get(`/orders/${orderId}`)).body.data.delivery;
    expect(view).toMatchObject({ status: 'ASSIGNED', partnerName: null, partnerPhone: null, code: null });
    for (const status of ['ACCEPTED', 'PICKED_UP']) await setStatus(rider1, job.id, { status });
    view = (await alice.get(`/orders/${orderId}`)).body.data.delivery;
    expect(view).toMatchObject({ status: 'PICKED_UP', partnerName: 'Ravi', partnerPhone: null, code: null }); // first name only

    await setStatus(rider1, job.id, { status: 'OUT_FOR_DELIVERY' });
    view = (await alice.get(`/orders/${orderId}`)).body.data.delivery;
    expect(view.partnerPhone).toBe('9811122233');
    expect(view.code).toMatch(/^\d{6}$/);

    expect((await bob.get(`/orders/${orderId}`)).status).toBe(404); // another customer cannot see the code
    const adminView = (await admin.get(`/admin/orders/${orderId}`)).body.data;
    expect(JSON.stringify(adminView)).not.toContain(view.code); // admins operate the delivery but never see the code
    expect(adminView.delivery).toBeUndefined();
    expect(adminView.assignment).toMatchObject({ status: 'OUT_FOR_DELIVERY', canReissueCode: true, otp: { attemptsLeft: 5, locked: false } });
    expect(adminView.assignment.partner).toMatchObject({ name: 'Ravi Kumar', phone: '9811122233' });

    // Nothing is stored: the database holds no code.
    const row = JSON.stringify(await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: job.id } }));
    expect(row).not.toContain(view.code);
    expect(JSON.stringify(await prisma.notification.findMany())).not.toContain(view.code);
  });

  it('collects cash on delivery: the order becomes paid at the door, and only then', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder({ cod: true, price: 250_000 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe('PENDING');

    const job = await outForDelivery(rider1, orderId, id);
    const view = (await rider1.get(`/delivery/assignments/${job}`)).body.data;
    // The cash to collect is everything the customer owes: the items AND the delivery charge.
    const owed = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).grandTotal;
    expect(owed).toBe(250_000 + 9_900);
    expect(view.order).toMatchObject({ paymentMethod: 'COD', collectCash: owed });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe('PENDING');

    expect((await setStatus(rider1, job, { status: 'DELIVERED', code: (await customerCode(alice, orderId))! })).status).toBe(200);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ fulfilmentStatus: 'DELIVERED', paymentStatus: 'CAPTURED' });
    expect(order.paidAt).not.toBeNull();
    // Prepaid orders have nothing to collect.
    const prepaid = await packedOrder();
    await assignTo(prepaid.orderId, id);
    expect((await myJobs(rider1))[0].order.collectCash).toBe(0);
  });

  it('snapshots the payout at delivery, so a later rate change leaves history alone', async () => {
    const id = await partner(rider1);
    await admin.patch(`/admin/delivery-partners/${id}`, { action: 'update', perDeliveryPayout: 6000 });
    const first = await packedOrder();
    const j1 = await outForDelivery(rider1, first.orderId, id);
    await setStatus(rider1, j1, { status: 'DELIVERED', code: (await customerCode(alice, first.orderId))! });

    await admin.patch(`/admin/delivery-partners/${id}`, { action: 'update', perDeliveryPayout: 9000 });
    const second = await packedOrder();
    const j2 = await outForDelivery(rider1, second.orderId, id);
    await setStatus(rider1, j2, { status: 'DELIVERED', code: (await customerCode(alice, second.orderId))! });

    expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: j1 } })).payoutAmount).toBe(6000);
    expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: j2 } })).payoutAmount).toBe(9000);

    const stats = (await rider1.get('/delivery/stats')).body.data;
    expect(stats.earnings).toMatchObject({ ratePerDelivery: 9000, today: 15000, allTime: 15000 });
    expect(stats.deliveredAllTime).toBe(2);
    expect(stats.today).toMatchObject({ assigned: 2, delivered: 2, failed: 0 });
    expect(stats.pending).toBe(0);
    expect(stats.performance).toHaveLength(14);
    expect(stats.performance.at(-1)).toMatchObject({ delivered: 2 });
    expect(await myJobs(rider1)).toHaveLength(0);
    const history = await myJobs(rider1, 'history');
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.payoutAmount).sort()).toEqual([6000, 9000]);
  });

  it('requires a reason for a failed attempt, returns the order to shipped, and allows another try with a new code', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    const job = await outForDelivery(rider1, orderId, id);
    const code1 = (await customerCode(alice, orderId))!;

    expect((await setStatus(rider1, job, { status: 'FAILED' })).status).toBe(400);
    expect((await setStatus(rider1, job, { status: 'FAILED', reason: 'Other' })).status).toBe(400); // "Other" needs notes
    const failed = await setStatus(rider1, job, { status: 'FAILED', reason: 'Customer not available', notes: 'Phone switched off' });
    expect(failed.status, JSON.stringify(failed.body)).toBe(200);
    expect(failed.body.data).toMatchObject({ status: 'FAILED', failureReason: 'Customer not available', nextStatuses: ['OUT_FOR_DELIVERY', 'RETURNED_TO_ORIGIN'] });
    expect(await orderStatus(orderId)).toBe('SHIPPED');
    expect((await alice.get(`/orders/${orderId}`)).body.data.delivery).toMatchObject({ status: 'FAILED', failureReason: 'Customer not available', code: null });
    expect((await prisma.notification.findMany({ where: { userId: IDS_BY_TOKEN.admin } })).map((n) => n.title)).toContain('Failed delivery');
    expect((await rider1.get('/delivery/stats')).body.data).toMatchObject({ failedAwaitingAction: 1, today: { failed: 1 } });

    // Try again: out for delivery issues a NEW code; the old one cannot deliver.
    expect((await setStatus(rider1, job, { status: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    expect(await orderStatus(orderId)).toBe('OUT_FOR_DELIVERY');
    const code2 = (await customerCode(alice, orderId))!;
    expect(code2).not.toBe(code1);
    expect((await setStatus(rider1, job, { status: 'DELIVERED', code: code1 })).status).toBe(422);
    expect((await setStatus(rider1, job, { status: 'DELIVERED', code: code2 })).status).toBe(200);
  });

  it('lets an admin hand a failed delivery to another partner, who completes it', async () => {
    const p1 = await partner(rider1);
    const p2 = await partner(rider2, { fullName: 'Second Rider' });
    const { orderId } = await packedOrder();
    const job = await outForDelivery(rider1, orderId, p1);
    await setStatus(rider1, job, { status: 'FAILED', reason: 'Address not found' });

    expect((await assignTo(orderId, p2)).status).toBe(201);
    expect(await myJobs(rider1)).toHaveLength(0);
    const [mine] = await myJobs(rider2);
    for (const status of ['ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY']) {
      const r = await setStatus(rider2, mine.id, { status });
      expect(r.status, `${status}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    expect(await orderStatus(orderId)).toBe('OUT_FOR_DELIVERY');
    expect((await setStatus(rider2, mine.id, { status: 'DELIVERED', code: (await customerCode(alice, orderId))! })).status).toBe(200);
    expect((await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: mine.id } })).partnerId).toBe(p2);
    // The first partner has no claim on the delivery any more.
    expect((await rider1.get(`/delivery/assignments/${mine.id}`)).status).toBe(404);
  });

  it('cancels, restocks and refunds an online order whose parcel returns to origin', async () => {
    const id = await partner(rider1);
    const { orderId, a } = await packedOrder({ price: 150_000 });
    const before = await w.inventoryOf(a.variantId);
    const job = await outForDelivery(rider1, orderId, id);
    await setStatus(rider1, job, { status: 'FAILED', reason: 'Customer refused the order' });

    expect((await setStatus(rider1, job, { status: 'RETURNED_TO_ORIGIN' })).status).toBe(400); // reason required
    const rto = await setStatus(rider1, job, { status: 'RETURNED_TO_ORIGIN', reason: 'Customer refused twice' });
    expect(rto.status, JSON.stringify(rto.body)).toBe(200);
    expect(rto.body.data.status).toBe('RETURNED_TO_ORIGIN');

    const order = await w.orderOf(orderId);
    expect(order).toMatchObject({ fulfilmentStatus: 'CANCELLED' });
    expect(order.cancelReason).toMatch(/Returned to origin: Customer refused twice/);
    const after = await w.inventoryOf(a.variantId);
    expect(after.onHand).toBe(before.onHand + 1); // the parcel is back on the shelf
    expect(order.payments[0].refunds).toHaveLength(1);
    expect(order.payments[0].refunds[0]).toMatchObject({ amount: order.grandTotal, source: 'CANCELLATION' });
    expect((await simState()).refunds).toHaveLength(1);
    // The customer is told, and the partner's history shows the outcome.
    expect((await prisma.notification.findMany({ where: { userId: IDS_BY_TOKEN.alice } })).map((n) => n.title).join()).toMatch(/cancelled/);
    expect((await myJobs(rider1, 'history'))[0].status).toBe('RETURNED_TO_ORIGIN');
    // A finished delivery cannot be reopened.
    expect((await setStatus(rider1, job, { status: 'OUT_FOR_DELIVERY' })).status).toBe(409);
  });

  it('voids a Cash on Delivery order on return to origin, with nothing to refund', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder({ cod: true });
    const job = await outForDelivery(rider1, orderId, id);
    await setStatus(rider1, job, { status: 'FAILED', reason: 'Payment (cash) not available' });
    expect((await setStatus(rider1, job, { status: 'RETURNED_TO_ORIGIN', reason: 'No cash at the door' })).status).toBe(200);
    const order = await w.orderOf(orderId);
    expect(order).toMatchObject({ fulfilmentStatus: 'CANCELLED', paymentStatus: 'FAILED' });
    expect((await simState()).refunds).toHaveLength(0);
  });

  it('requires a reason to reject a job, tells the admins, and leaves the order packed for reassignment', async () => {
    const p1 = await partner(rider1);
    const p2 = await partner(rider2, { fullName: 'Second Rider' });
    const { orderId } = await packedOrder();
    await assignTo(orderId, p1);
    const [job] = await myJobs(rider1);

    expect((await setStatus(rider1, job.id, { status: 'REJECTED' })).status).toBe(400);
    expect((await setStatus(rider1, job.id, { status: 'REJECTED', reason: 'Too far' })).status).toBe(200);
    expect(await orderStatus(orderId)).toBe('PACKED');
    expect((await prisma.notification.findMany({ where: { userId: IDS_BY_TOKEN.admin } })).map((n) => n.title)).toContain('Delivery assignment rejected');
    expect(await myJobs(rider1)).toHaveLength(0);
    expect((await myJobs(rider1, 'history'))[0]).toMatchObject({ status: 'REJECTED', failureReason: 'Too far' });
    // The customer is not told about an internal rejection.
    expect((await alice.get(`/orders/${orderId}`)).body.data.delivery).toBeNull();

    expect((await assignTo(orderId, p2)).status).toBe(201);
    expect(await myJobs(rider2)).toHaveLength(1);
  });

  // This needs two genuinely concurrent database sessions, which the single-session PGlite cannot provide:
  // it runs under `npm run test:pg` (a private real PostgreSQL) and is skipped otherwise.
  it.skipIf(process.env.TEST_DB !== 'postgres')('refuses a partner whose job was reassigned while their request waited for the order lock', async () => {
    const p1 = await partner(rider1);
    const p2 = await partner(rider2, { fullName: 'Second Rider' });
    const { orderId } = await packedOrder();
    await assignTo(orderId, p1);
    const [job] = await myJobs(rider1);

    let pending!: ReturnType<typeof setStatus>;
    await prisma.$transaction(async (tx) => {
      // An admin is in the middle of reassigning: they hold the order lock…
      await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      // …when the first partner's "accept" arrives and queues behind it.
      pending = setStatus(rider1, job.id, { status: 'ACCEPTED' });
      void pending.then(() => undefined);
      await new Promise((r) => setTimeout(r, 400));
      await tx.deliveryAssignment.update({ where: { id: job.id }, data: { partnerId: p2, status: 'ASSIGNED', acceptedAt: null } });
    });

    // The waiting request must now see that the job is no longer theirs — not apply their accept to someone else's job.
    expect((await pending).status).toBe(404);
    const row = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ partnerId: p2, status: 'ASSIGNED', acceptedAt: null });
  });

  it('applies a double-submitted "delivered" only once', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    const job = await outForDelivery(rider1, orderId, id);
    const code = (await customerCode(alice, orderId))!;
    const results = await Promise.all([setStatus(rider1, job, { status: 'DELIVERED', code }), setStatus(rider1, job, { status: 'DELIVERED', code })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const delivered = await prisma.orderStatusHistory.count({ where: { orderId, status: 'DELIVERED' } });
    expect(delivered).toBe(1);
  });

  it('keeps admins informed in the order screen: assignment, partner and full history', async () => {
    const id = await partner(rider1);
    const { orderId } = await packedOrder();
    const job = await outForDelivery(rider1, orderId, id);
    await setStatus(rider1, job, { status: 'FAILED', reason: 'Address not found' });
    const view = (await admin.get(`/admin/orders/${orderId}`)).body.data.assignment;
    expect(view).toMatchObject({ status: 'FAILED', failureReason: 'Address not found', canReassign: true, canReissueCode: false });
    expect(view.history.map((h: { status: string }) => h.status)).toEqual(['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'FAILED']);
  });
});

describe('admin partner management', () => {
  it('lists applications first, filters, searches, and summarises each partner’s record', async () => {
    const p1 = await partner(rider1);
    await rider2.post('/delivery/apply', { ...APPLICATION, fullName: 'Waiting Person', serviceCity: 'Mumbai' });
    const { orderId } = await packedOrder();
    const job = await outForDelivery(rider1, orderId, p1);
    await setStatus(rider1, job, { status: 'DELIVERED', code: (await customerCode(alice, orderId))! });

    const all = (await admin.get('/admin/delivery-partners')).body.data as any[];
    expect(all.map((p) => p.status)).toEqual(['PENDING', 'APPROVED']); // waiting applications first
    const pending = (await admin.get('/admin/delivery-partners?status=PENDING')).body.data as any[];
    expect(pending).toHaveLength(1);
    expect((await admin.get('/admin/delivery-partners?q=mumbai')).body.data).toHaveLength(1);
    expect((await admin.get('/admin/delivery-partners?q=nobody-by-this-name')).body.data).toHaveLength(0);

    const row = all.find((p) => p.id === p1);
    expect(row).toMatchObject({ delivered: 1, active: 0, failed: 0 });
    const detail = (await admin.get(`/admin/delivery-partners/${p1}`)).body.data;
    expect(detail.stats).toMatchObject({ delivered: 1, earningsAllTime: 4000, inProgress: 0 });
    expect(detail.idDocumentRef).toBe('DL-…4321');
    expect(detail.recent[0]).toMatchObject({ status: 'DELIVERED', orderId });
  });

  it('offers only active partners for assignment, online first, with their current load', async () => {
    const p1 = await partner(rider1, {}, false);
    const p2 = await partner(rider2, { fullName: 'Second Rider' });
    await rider2.post('/delivery/apply', APPLICATION); // approved already → 409, ignored
    const { orderId } = await packedOrder();
    await assignTo(orderId, p2);

    const options = (await admin.get('/admin/delivery-partners/assignable')).body.data as any[];
    expect(options.map((o) => o.id)).toEqual([p2, p1]);
    expect(options[0]).toMatchObject({ isOnline: true, activeJobs: 1 });
    expect(options[1]).toMatchObject({ isOnline: false, activeJobs: 0 });
  });

  it('exposes the delivery onboarding settings to admins only, and validates them strictly', async () => {
    expect((await admin.get('/admin/settings')).body.data.delivery).toEqual({ defaultPayout: 4000, requireVehicle: true, requireIdDocument: true });
    expect((await admin.put('/admin/settings/delivery', { defaultPayout: 5000, requireVehicle: true, requireIdDocument: false })).status).toBe(200);
    expect((await admin.put('/admin/settings/delivery', { defaultPayout: -1, requireVehicle: true, requireIdDocument: true })).status).toBe(400);
    expect((await admin.put('/admin/settings/delivery', { defaultPayout: 5000, requireVehicle: true, requireIdDocument: true, extra: 1 })).status).toBe(400);
    expect((await alice.put('/admin/settings/delivery', { defaultPayout: 1, requireVehicle: true, requireIdDocument: true })).status).toBe(403);
    // A newly approved partner starts on the configured default rate.
    await admin.put('/admin/settings/delivery', { defaultPayout: 5000, requireVehicle: true, requireIdDocument: true });
    const id = (await rider1.post('/delivery/apply', APPLICATION)).body.data.id;
    expect((await admin.patch(`/admin/delivery-partners/${id}`, { action: 'approve' })).body.data.perDeliveryPayout).toBe(5000);
  });
});
