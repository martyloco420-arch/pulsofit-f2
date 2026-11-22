# PulsoFit Firestore Security Specification

## 1. Data Invariants
- Every document under `/userBackups/{userId}` belongs strictly to the authenticated and email-verified user whose `request.auth.uid == userId` and `data.ownerId == request.auth.uid`.
- No user can `list` the `userBackups` collection (`allow list: if false`).
- `createdAt` and `ownerId` are immutable once created (`incoming().createdAt == existing().createdAt`, `incoming().ownerId == existing().ownerId`).
- Server timestamps (`request.time`) are enforced on both `create` (`createdAt`, `updatedAt`) and `update` (`updatedAt`).
- Unrecognized "shadow" fields are blocked via `hasOnly(...)` on both document creation and `affectedKeys().hasOnly(...)` on updates.
- Document path IDs and string metadata have explicit regex and `.size()` bounds.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated `get` / `create` on `/userBackups/userA` (`request.auth == null`).
2. Authenticated `get` on `/userBackups/userB` as `userA` (cross-user PII/data access).
3. Authenticated `list` query on `/userBackups` (`allow list: if false`).
4. Unverified email user (`email_verified: false`) attempting `create` or `update`.
5. Identity spoofing on `create`: `/userBackups/userA` with `ownerId: "userB"`.
6. Ghost/shadow field injection on `create`: adding `isAdmin: true` or `plan: "vip"`.
7. Ghost/shadow field injection on `update`: modifying `ownerId` or adding `extraField`.
8. Oversized / invalid `userId` path parameter (e.g. >128 chars or spaces/slashes).
9. Timestamp tampering on `create`: client-supplied past timestamp (`createdAt != request.time`).
10. Timestamp tampering on `update`: modifying `createdAt` or omitting server `updatedAt == request.time`.
11. Wrong `appName` or invalid `schemaVersion` type (`schemaVersion: "1"`).
12. `payload` missing required `profile` / `schemaVersion` / `updatedAt` keys or exceeding type bounds.
