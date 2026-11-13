# CRM Phase 4: Customer Screens (list, profile, segments, export, deletion)

**Spec:** `docs/superpowers/specs/2026-11-12-instore-crm-analytics-design.md` §3 (access: customer list
is HQ/merchant-admin only, never branch staff; every export audited; deletion removes profile and
photos, keeps anonymised events), §7.2 (Customers metrics), §8 phase 4.

## Decisions

| # | Decision | Why |
|---|---|---|
| K1 | **Merchant admin only** for every customer route (`requireMerchantAdmin`); staff get 403 | Spec §3: never branch staff. Merchant roles are admin/staff today, so "a separate permission" is admin-only until finer merchant roles exist |
| K2 | **Phones are masked in lists** (`+91 98•••••210`); the full number appears on a profile view and in exports, and both are audited | The list is browsed often; the full number only where someone deliberately asks |
| K3 | **Segments are saved filters** (`merchant_customer_segments.filters` jsonb, validated by the same Zod schema as the list query) | One filter language for list, segment and export; no second query engine |
| K4 | **Export is CSV, marketing-consent column included, every row the filter matches**; audited with the filter and row count | The merchant owns the data; the audit row is the accountability |
| K5 | **Deletion on request reuses the retention wipe for one shopper**, plus that shopper's identified sessions' photos | Same code path as retention, so "deleted" means the same thing everywhere |

## Tasks
- [x] Migration 0268: `merchant_customer_segments` (merchant, name, filters, created_by).
- [x] `CustomerQuery` (q on name, branch, marketing consent, last-visit range, min visits) → list with visits, try-ons, purchases, branches, current consents; cursor paging.
- [x] Profile: decrypted phone, visits (date, branch, tried, sold), consent history; audited `customer.view`.
- [x] Export CSV; audited `customer.export`. Segments CRUD.
- [x] `DELETE /v1/merchant/customers/:id`: wipe + photos; audited.
- [x] Merchant Web `/customers` (admin): filters, table, profile panel, export, save segment, delete.
- [x] Tests: staff 403 everywhere; masking; cross-merchant isolation; export audit; deletion.
