# Security and Permissions

Implemented. Source of truth: `packages/contracts/src/permissions.ts`.
**69 permissions, 15 roles.**

---

## 1. Authentication

Two routes in, for two genuinely different situations.

### Staff — email and password

- Argon-class hashing via bcrypt, cost 12
- Access token: JWT, **15 minutes**
- Refresh token: 30 days
- Timing-safe failure: a non-existent email is compared against a dummy hash, so
  response time does not reveal which addresses are registered
- Failed attempts are audited with a reason (`BAD_PASSWORD`, `INACTIVE`)

### Shop floor — employee code and PIN

An operator at a cutting table wearing gloves cannot type a passphrase. So a
shared terminal signs in with an employee code and a 4–8 digit PIN.

That is a weaker credential, and it is made safe by **authorisation, not
authentication**: a `BARCODE_OPERATOR` holds four permissions — scan, record
stage quantities, read manufacturing orders, read products. No adjustments, no
approvals, no pushes, no costing.

The terminal is the least physically secure device in the building, so it holds
the least authority. Hardening the credential instead would mean operators
sharing a written-down password, which is worse.

### Why the access token is short

Roles and permissions are carried **in** the access token, so a permission check
needs no database read — important when a dozen terminals are scanning
continuously.

The cost is staleness: a permission revoked in the admin screen keeps working
until the token expires. Fifteen minutes is the chosen bound on that window.

## 2. Authorisation

### Fail closed

`JwtAuthGuard` and `PermissionsGuard` are registered **globally** in
`app.module.ts`. An endpoint is protected unless it explicitly opts out with
`@Public()`. Forgetting a guard cannot leave an endpoint open, because there is
nothing to forget.

### Declared next to the handler

```ts
@Post('adjust')
@RequirePermissions('inventory.adjust')
adjust(@OrgId() orgId: string, @CurrentUser() user: AuthenticatedUser, …) { … }
```

The requirement lives on the method it protects, rather than in a separate table
that can drift out of step with the routes.

ALL listed permissions must be held. A refusal names what is missing:

```json
{
  "statusCode": 403,
  "code": "INSUFFICIENT_PERMISSIONS",
  "message": "This action requires: inventory.adjust",
  "details": { "required": ["inventory.adjust"], "missing": ["inventory.adjust"] }
}
```

### The UI is not a control

`useAuth().can()` hides what a user cannot do. That is a **usability** measure.
The server checks every request independently, so a hidden button is not a
protected button — and the end-to-end suite proves it by signing in as a
`BARCODE_OPERATOR` and confirming a direct `POST /inventory/adjust` is refused
with the missing permission named.

## 3. Tenant isolation

Every business table carries `organizationId`. Every query is scoped by it. Every
unique constraint includes it.

The scope comes from the **verified JWT**, never from a request parameter:

```ts
export const OrgId = createParamDecorator((_data, ctx): string => {
  const user = ctx.switchToHttp().getRequest().user;
  if (!user?.organizationId) throw new InternalServerErrorException(…);
  return user.organizationId;
});
```

There is no URL to edit and no body field to tamper with. Cross-organisation
access is unreachable rather than merely checked.

## 4. The permission catalogue

69 permissions as `module.action`. 22 are marked **elevated** — they create or
destroy value, and are additionally audited and, where configured, routed through
the approval matrix.

| Module | Permissions | Elevated |
|---|---|---|
| `admin` | 8 | 5 |
| `products` | 4 | 0 |
| `materials` | 3 | 1 |
| `inventory` | 8 | 2 |
| `purchasing` | 9 | 3 |
| `bom` | 3 | 1 |
| `mrp` | 2 | 0 |
| `demand` | 3 | 1 |
| `manufacturing` | 6 | 3 |
| `production` | 5 | 1 |
| `quality` | 4 | 1 |
| `finished_goods` | 3 | 1 |
| `sync` | 5 | 3 |
| `job_workers` | 3 | 0 |
| `reports` | 3 | 0 |

### The elevated set

```
admin.manage_users              admin.manage_roles
admin.manage_settings           admin.manage_integrations
admin.manage_approvals          materials.manage_uom
inventory.adjust                inventory.count
purchasing.approve_requisition  purchasing.approve_po
purchasing.close_po             bom.approve
demand.approve                  manufacturing.release
manufacturing.release_with_shortage
manufacturing.cancel            production.override_stage
quality.approve_final           finished_goods.adjust
sync.push                       sync.change_facility
sync.reconcile
```

Three of these deserve note:

- **`manufacturing.release_with_shortage`** is separate from
  `manufacturing.release`. Starting production knowing material is short is a
  different decision from starting production normally, and the person allowed to
  make it may not be the same person.
- **`production.override_stage`** lets quantity advance without a valid scan.
  Needed when a scanner fails mid-shift; dangerous because it bypasses the
  evidence chain. Separate and audited.
- **`sync.change_facility`** is separate from `sync.push`. Pushing to the agreed
  facility and redirecting a push elsewhere are different acts, and the
  specification is explicit that inventory must never be silently pushed to the
  wrong facility.

## 5. The role matrix

| Role | Permissions | Shape |
|---|---|---|
| Super Admin | 69 | Everything |
| Production Head | 32 | Release, approve exceptions, final QC, costing |
| Production Planner | 21 | Plan, run MRP, reserve, assign |
| Purchase Manager | 14 | Raise, approve and close POs; suppliers; costing |
| Raw Material Manager | 19 | Receive, inspect, issue, adjust, count, rolls |
| Warehouse Executive | 13 | Receive, issue, transfer, FG inward |
| Cutting Supervisor | 14 | Stage work + fabric issue, return, consume, rolls |
| Stitching Supervisor | 12 | Stage work + job work |
| Embroidery Supervisor | 12 | Stage work + job work |
| Finishing Supervisor | 11 | Stage work + FG read |
| QC Executive | 12 | Inspect, rework, final approval, incoming inspection |
| **Barcode Operator** | **4** | **Scan, record stage, read MO, read product** |
| Job Worker Coordinator | 10 | Job work issue and receipt |
| Finance Viewer | 12 | Read-only + costing |
| Management Viewer | 14 | Read-only across modules |

### Reading the matrix

**Barcode Operator holds four permissions.** That is the shape of the whole
design: the credential is weak, so the authority is minimal.

**Cutting Supervisor can consume material; the other stage supervisors cannot.**
Cutting is where fabric is actually destroyed into panels. Stitching consumes
thread, which is handled by its own route-step configuration rather than by
giving every supervisor the ability to retire stock.

**Purchase Manager cannot adjust stock.** Buying and correcting are different
jobs, and combining them in one role is how a short delivery quietly becomes an
inventory adjustment instead of a supplier conversation.

**Raw Material Manager can adjust stock but cannot approve a purchase order.**
The same separation from the other side.

**Nobody except Super Admin holds `sync.push`, `sync.change_facility` and
`sync.reconcile` together.** Production Head has preview and read; the push
itself is deliberately narrow.

### Editing roles

`PUT /admin/roles/:id/permissions` replaces a role's grant. Elevated permissions
are visually distinct in the UI, so whoever edits a role can see at a glance that
they are about to let a stitching supervisor adjust stock.

`SUPER_ADMIN` cannot be narrowed — it always holds every permission, so there is
always a way back from a mis-edit.

## 6. Approval matrix

`ApprovalRule` and `ApprovalRequest` support configurable approvals. Seeded rules:

| Code | Subject | Approvers |
|---|---|---|
| `PO_APPROVAL` | Purchase order | Purchase Manager, Production Head |
| `STOCK_ADJUSTMENT` | Stock adjustment | Raw Material Manager, Production Head |
| `BOM_RELEASE` | BOM version release | Production Head |
| `SHORTAGE_RELEASE` | Release despite a shortage | Production Head |
| `SHADE_MIX` | Mixing fabric shades in one batch | Production Head |
| `FACILITY_CHANGE` | Changing a push destination | Production Head |

`requestPayload` snapshots what is being approved, so an approver sees the exact
state they are agreeing to rather than whatever it has become since.

Purchase order and requisition approvals are implemented in phase 1. The generic
engine is scheduled for phase 6.

## 7. Audit

`AuditLog` is append-only and written **inside the same transaction** as the
action it describes. An audit log that can disagree with the data it records is
worse than none, so they commit or roll back together.

Recorded: actor, action, entity type and id, a field-level diff, context
(including an `elevated` flag), IP address, user agent, timestamp.

### Secrets never enter the log

`AuditService.diffOf()` filters any field matching
`/password|passwordhash|pinhash|secret|token|credential|accesskey/i`. Creating a
user audits the email and the roles granted, never the credential.

Decimals and dates are serialised as readable strings, so a diff is legible years
later without a Prisma runtime to interpret it.

## 8. Secret handling

| Secret | Where it lives |
|---|---|
| JWT signing keys | Environment; validated at boot for length and non-placeholder value |
| Database credentials | Environment / `DATABASE_URL` |
| Shopify access token | Secret store; `IntegrationConnection.credentialRef` holds only a pointer |
| Unicommerce credentials | Secret store; same |
| Object storage keys | Environment |

**Credentials are never stored in the application database.** The Settings screen
can therefore show integration configuration — shop domain, API version, health,
last sync — without showing anything sensitive.

Production boot refuses to start if `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET`
still holds its `change-me…` placeholder. A deployment that forgot to set them
fails loudly rather than running on a known key.

The seed generates a **random** admin password and prints it once, rather than
using a known default that survives into production because nobody changed it.

## 9. Transport and request hardening

- `helmet` security headers
- CORS restricted to configured origins
- Rate limiting: 300 requests per minute per client (`@nestjs/throttler`)
- `x-request-id` on every request, echoed in every error body — so a storekeeper
  can quote one number when something goes wrong on the floor
- Zod validation on every request body and query, with all field errors returned
  at once (a goods receipt has dozens of line fields; one error per round trip is
  how data entry gets abandoned for a paper notebook)

## 10. External write safety

Three independent gates, covered in
[unicommerce-integration.md](unicommerce-integration.md) §2:

1. `INTEGRATION_ALLOW_EXTERNAL_WRITES` — environment, **off by default
   everywhere**
2. `IntegrationConnection.allowExternalWrites` — per connection
3. An approved `InventoryPushJob` — per transaction

Plus `ExternalFacility.isPushEnabled` per destination.

Off by default in every environment is deliberate: a developer running this
locally against production credentials should not be one typo away from crediting
real sellable inventory.

## 11. Idempotency as a safety property

Not only a correctness concern. Without it, a retried mutation is an
*unauthorised* second effect — the user authorised one issue of fabric, not two.

Every mutation touching stock or production quantity requires a client-supplied
`idempotencyKey`. A replayed key with the **same** payload returns the stored
result. A replayed key with a **different** payload is a 409, because the client
has reused a key for a different operation and silently accepting either answer
would be wrong.

## 12. What is not implemented

Honestly stated:

- **No MFA.** Should be added for Super Admin and Production Head before
  external exposure.
- **No password policy beyond length.** No complexity rules, no rotation, no
  breach-list check.
- **No session revocation list.** A stolen access token is valid for its
  remaining lifetime (≤15 min). Refresh tokens are not individually revocable.
- **No field-level encryption at rest.** Relies on database-level encryption.
- **No department or location restriction enforcement.** The specification asks
  for it; the schema supports it (`MaterialLocation`, `ProductionStage`
  assignments) but no guard reads it yet, so a cutting supervisor can currently
  see every department's work.
- **No rate limiting per user**, only per client.
- **Audit log is not tamper-evident.** Append-only by convention and by the
  absence of update paths, not by a hash chain.

The department-restriction gap is the most significant for day-to-day use and
should be closed in phase 3, when stage screens arrive and the restriction
actually has something to restrict.
