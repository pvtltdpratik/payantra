# Delivery partners

How a parcel gets from the shop to the customer, who may do what, and what protects the hand-over.

## Becoming a partner

1. **Anyone signed in can apply** at `/delivery/apply` (name, mobile, city, vehicle, an ID *type* and a *reference* such as "last 4 digits"). The form never asks for a full ID number.
   Which fields are required is an admin setting (*Settings → Delivery partners*).
2. Applying changes nothing about the applicant's access: they stay a `CUSTOMER`.
3. An **admin approves** the application (`/admin/delivery-partners`). Approval is the *only* thing that grants the `DELIVERY_PARTNER` role, and every decision is written to the audit log.
   An admin who sets the role directly on the Users screen is also approving: the partner record is created already approved.
4. The partner goes **online** to be offered work. Suspending a partner sets them offline and blocks the partner API at once (not while they hold parcels in transit).

## One order, one delivery

```
 admin: Packed ──assign──► ASSIGNED ──accept──► ACCEPTED ──picked up──► PICKED_UP ──start──► OUT_FOR_DELIVERY ──code──► DELIVERED
                              │ reject                                                          │ cannot deliver
                              ▼                                                                 ▼
                          REJECTED (admin reassigns)                          FAILED ──try again──► OUT_FOR_DELIVERY
                                                                                     └─return──► RETURNED_TO_ORIGIN
```

The assignment and the **order** move together, through the same shared rules an admin's buttons use, so the two can never disagree:

| Partner action | Order becomes |
|---|---|
| Pick up | `SHIPPED` |
| Start delivery | `OUT_FOR_DELIVERY` (a fresh delivery code is issued) |
| Deliver (with the code) | `DELIVERED`; a Cash-on-Delivery order is marked **paid** at this moment |
| Cannot deliver | back to `SHIPPED`, the reason recorded, admins notified |
| Return to origin | `CANCELLED`: stock back on the shelf, coupon use returned, an online payment refunded automatically |

- Only a **packed** order can be assigned, and only to an **approved, online** partner. An admin can reassign before pickup or after a failed attempt, and unassign before pickup.
- While a partner is on the job an admin **cannot hand-set** shipped / out for delivery / delivered (the buttons are hidden and the API answers `409`). To take over, unassign first.
- Cancelling an order that is packed and assigned (customer or admin) releases the partner from the job.
- Rejecting, failing and returning all **require a reason**, kept on the record.

## The delivery code

A customer reads a six-digit code to the partner at the door; the partner types it to complete the delivery. That proves the parcel reached the right hands.

- The code is **derived, not stored**: `HMAC-SHA256(DELIVERY_OTP_SECRET, assignmentId + ":" + counter)` reduced to six digits. The customer's order page recomputes it for the owner; nothing is written to the database or to notifications, so a leaked backup reveals nothing usable.
- It is shown **only** to the order's owner, **only** while out for delivery. Admins never see it (they can *reissue* one). Partners never see it.
- Each attempt gets a fresh code (the counter increments), so a code from a failed attempt is dead.
- **5 wrong guesses lock it** (`423`); a wrong guess is recorded even though the request fails. An admin reissues: new code, new attempts.
- A code is valid for **12 hours** from "out for delivery", then must be reissued.
- Comparison is constant-time. `DELIVERY_OTP_SECRET` is **required in production** (32+ random characters, identical on every API instance). Changing it invalidates codes currently out for delivery (they can be reissued).

## Who can see what

| | Customer | Partner | Admin |
|---|---|---|---|
| Partner's name | first name | – | full |
| Partner's phone | only while out for delivery | – | yes |
| Customer's address & phone | own order | **only while working the job** (accepted → out for delivery → failed); the city/PIN before accepting and after finishing | yes |
| Customer's e-mail | – | **never** | yes |
| Item prices | yes | **never** (only the cash to collect, for COD) | yes |
| Delivery code | yes (owner) | no (they are told it at the door) | no |

Every partner query is scoped to the partner's own assignments; someone else's is `404`, indistinguishable from a missing one.

## Earnings

Each partner has a per-delivery rate (default from settings, adjustable per partner). When a delivery completes, the rate **at that moment is copied onto the assignment**, so a later rate change never rewrites history.
The partner dashboard shows earnings for today, the last 30 days and all time. **Payouts themselves are not processed by Payantra** — the shop settles with partners outside the system.

## Limits worth knowing

- Assignment is manual (an admin chooses); there is no automatic dispatch or live location tracking. The partner opens the address in their maps app via a link.
- Delivery instructions are the address's *landmark*; there is no separate free-text instruction field yet.
- One assignment exists per order: reassigning reuses it (the history keeps every step).
