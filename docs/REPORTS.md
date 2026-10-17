# Dashboards and reports

Every number on the admin overview and in the reports is computed from the database when the page is requested. Nothing is cached, seeded or hard-coded.

## Definitions

| Term | Meaning |
|---|---|
| **Paid order** | An order with a payment date (`paidAt`): an online payment was captured, or a Cash-on-Delivery order was **delivered**. A COD order is not revenue until the cash is collected. |
| **Gross sales** | Σ `grandTotal` of orders **paid** in the period: what customers paid, GST and delivery charges included. An order cancelled after payment still counts here… |
| **Refunds** | Σ of refunds **processed** in the period (money actually returned, whenever the order was placed). …and its refund is subtracted here. |
| **Net revenue** | Gross sales − refunds. |
| **Average order** | Gross sales ÷ paid orders. |
| **GST included** | Σ `taxTotal`. Prices already include GST, so this is the tax contained in sales, not an addition. |
| **Orders placed** | Orders *created* in the period, in any status (the status breakdown is of these). |
| **Low stock** | Active variants of active products whose **available** units (on hand − reserved) are at or below the variant's alert level. |
| **Change vs previous** | The same figure for the immediately preceding period of equal length. |

Money is stored and transported as integer **paise**; the screens format rupees.

## Time zone

A "day" is an **India calendar day** (IST, UTC+05:30, no daylight saving). Ranges are `from`/`to` as `YYYY-MM-DD`, **inclusive of both days**; the default is the last 30 days including today, and at most 366 days are allowed.
A rupee lands on the day it was *paid* (or *refunded*), not the day the order was placed. The chart is zero-filled so quiet days still appear, and its totals always equal the headline numbers.

## Reports (`/admin/analytics`)

| Report | Rows | Notes |
|---|---|---|
| **Sales** | one per day, week (starting Monday) or month | paid orders, gross, discounts, delivery charges, GST, refunds, net, average order |
| **Products** | one per product, by revenue | orders, units sold, units returned, revenue at **item prices** (before order-level discounts and delivery). Cancelled orders are excluded |
| **Inventory** | one per active variant, most urgent first | on hand, reserved, available, alert level, status, stock value at **selling price** (no cost data is held) |
| **Payments & refunds** | every capture and processed refund, newest first | refunds are negative; the totals row is the net |
| **Delivery** | one per approved or suspended partner | assigned, delivered, failed attempts, returned to origin, declined, delivered ÷ attempts, average minutes pickup → door, earnings |

## CSV export

The **Download CSV** button (or `?format=csv` on the API, with the admin's token) exports the *same table as the screen*, including the totals row.

- UTF-8 with a byte-order mark (so Excel reads names and ₹ correctly), CRLF line endings, `Cache-Control: no-store`.
- Money is in **rupees** with a "(INR)" header; times are India time ("2026-10-17 14:05").
- **Spreadsheet formulas are neutralised**: a text cell beginning with `=`, `+`, `-`, `@` (or a tab/carriage return) is prefixed with an apostrophe, because customer-supplied text (names, addresses) would otherwise run as a formula when opened. Real numbers are untouched.
- The screen shows up to 1,000 rows (it says when it is cut short); a CSV holds up to 50,000.

## Other admin screens

- **Customers** — customers only, with orders, spend, last order; detail shows net of refunds, addresses and support history. Read-only: suspending an account happens under *Users & roles* (audited).
- **Support** — the inbox; a reply notifies the customer and shows on their *Help & support* page. A customer may have at most five open requests.
- **Reviews** — moderation. Hiding a review removes it from the product page and recomputes the rating; the author still sees it, marked hidden.
- **Banners / Newsletter** — homepage banners (live ones only are served to shoppers, in the order set) and the subscriber list with CSV export.
- **Audit log** — who changed what and when, filterable by what changed. Entries are append-only.
