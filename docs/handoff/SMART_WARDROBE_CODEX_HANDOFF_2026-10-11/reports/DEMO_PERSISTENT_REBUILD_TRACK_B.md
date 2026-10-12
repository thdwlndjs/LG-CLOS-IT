# Persistent demo rebuild — Track B checkpoint

Status: IMPLEMENTED STATIC CONFIGURATION; RUNTIME BLOCKED pending independent Engine.

## Delivered

- `infra/compose.demo-recovery.yaml`: isolated project `wardrobe-recovery-demo`, PostgreSQL 16.8, existing verified/non-root legacy MinIO packaging, Redis AOF. All three data directories use project-scoped persistent named volumes. No external volumes, old container names, tmpfs, init job, migration, seed, API, or worker. Storage bootstrap alone cannot enqueue jobs or use a paid provider.
- `infra/demo-recovery.env.example`: distinct loopback ports 57433/19100/19101/16479 and database `wardrobe_demo_recovered`; eventual API configuration explicitly disables paid FitRoom and uses MOCK. Populated copy must be an ignored `.env*` file with limited OS access. Copy profile/device IDs and existing credentials only from verified recovered data, never invent grants/history.
- `scripts/recovery_compose_plan.py`: prints but never executes an argv command. Explicit SSH target plus independence attestation required; default/named-pipe/local/known Desktop routes rejected. Operator must verify SSH target is a different host or fully independent VM: URL checks alone cannot prove isolation. Host-published loopback ports belong to the remote host; future local access needs separately approved SSH tunnels or co-located API.
- `backend/tests/contract/test_demo_recovery_storage.py`: 8 PASS. Initial run hit pre-existing pytest temp/cache access restrictions; retry using a fresh workspace basetemp and cache disabled passed. No service requests or Docker calls.

## Recovery-first sequence and approved-seed boundary

1. Verify preservation hashes, make a distinct working copy, determine recovered PG major version and MinIO layout.
2. Recover/query working copy on independent infrastructure. Preserve IDs, ownership, actual history, grants, audit data; export logical dump and accessible S3 objects there.
3. Use fresh target volumes. PostgreSQL image creates a base cluster only if empty; never mount original preservation copy. Restore recovered logical data under explicit restore approval. Obtain compatible ownership/version before any physical working-copy mount.
4. Compare actual recovered revision with code head `0006_fitroom_budget`. Preview required migrations before approval/execution. Never blindly downgrade or rerun all seeds.
5. Compute missing-data manifest: original 76 IDs + new 28; left 21, right 66; two profiles' 54 synthetic wear records and 3 LIKED each; image references and Context. Reuse approved deterministic IDs and distinguish synthetic data from genuine history.
6. Existing `stage_b_seed.py` hardcodes old `remediation_local.engine()` and accepts only revisions 0004/0005. It is NOT safe to execute against the new environment as-is, and cannot restore original 76 on its own. Existing `handoff_local.prepare()` provisions tmpfs and MUST NOT be reused. Implement an explicit-target additive seed runner only after gap/revision evidence is available. No seed executed or migration modified now.
7. Explicit connection-switch approval before API/frontend changes; API needs two recovered profile IDs, station ID, recovered JWT/consent semantics, correct storage read URL origin and Redis configuration. No worker/beat before pending jobs are reviewed.

## Backup and persistence policy

- Before seed/migration: logical `pg_dump -Fc`, roles export if required, S3 object inventory/download outside Engine storage; record revision, UTC time, file/object sizes and SHA256. Preserve raw candidates separately from runtime backups.
- Quiesce demo mutations for coordinated DB/S3 backup; no automatic service shutdown. A live DB dump is consistent within DB, not atomic across S3. Record this limit and validate every referenced object. Keep private bucket and prohibit public anonymous policies.
- Redis: AOF everysec protects new demo persistence (up to approximately one second under normal failure); restoring old Redis requires job/grant/session analysis. Never assume a fresh Redis preserves revocations.
- Retain seven daily verified backups plus a pre-change baseline, host/independent backup location with user-only access. Never put keys in commands, reports, archives without restricted access, or Git. Backup scheduling remains manual until independent runtime verified.
- Real restore drill: new disposable project/volumes on independent Engine, restore logical DB + S3 backups, compare IDs/counts/FKs/checksums/revision; do not claim success from file hashes only.
- Recreation drill: record DB IDs/counts/object hashes, recreate only NEW environment service containers WITHOUT deleting volumes (destructive operation requires approval), then query/read again. No `down -v`, prune, old Engine calls, or automatic cleanup.

## Completion gates

| Gate | State |
|---|---|
| Static persistence and isolation tests | PASS — 8 |
| Compose CLI semantic/render validation | NOT RUN — existing Engine forbidden; Docker not called |
| Independent infrastructure available | BLOCKED — root's environment track |
| Recovered DB and object compatibility | NOT RUN |
| Gap-only seed | NOT RUN; cannot safely choose gaps yet |
| Two-profile Scene/image/API E2E | NOT RUN |
| New-container recreation persistence | NOT RUN; approval required |
| Backup creation and real restore drill | NOT RUN |

No edits to original Scene/assets/geometry/DB or preserved recovery candidate. No existing Docker/WSL commands, service startup, paid call, push, or commit by this worker. Runtime security risk remains: pinned legacy MinIO is local-development-only, not an assertion of production safety. Use isolated loopback access and plan security-supported replacement/version validation separately.

## Native MinIO validation tool investigation

Official GitHub release API returned 48 assets for `RELEASE.2025-04-22T22-12-26Z`, including `minio.windows-amd64.RELEASE.2025-04-22T22-12-26Z.exe`, its `.sha256sum`, `.minisig`, and `.asc`. Therefore the old archive endpoint returning 410 does not imply the Windows binary is unavailable. Prefer the signed official Windows EXE over a local compilation:

`https://github.com/minio/minio/releases/download/RELEASE.2025-04-22T22-12-26Z/minio.windows-amd64.RELEASE.2025-04-22T22-12-26Z.exe`

Official source at pinned commit `0d7408fc9969caf07de6a8c3a84f9fbb10a6739e` declares Go 1.24.0 / toolchain 1.24.2. No installed Go was found. Host available memory measured 204 MiB; the delegated 512 MiB download/compile gate was not met. No SDK download/installation/build or executable startup occurred in this investigation. Root may use the direct binary path subject to host resource controls, published SHA256 comparison, and signature verification; record provenance without claiming runtime success.

Root clarified the resource gate applies to compilation/service startup, permitting a 1 MiB-chunk streaming download. `scripts/recovery_minio_tool.py` downloaded official GitHub EXE and signature/hash files within the 180-second overall budget, without starting a process from the binary. Acquired EXE: 121,008,640 bytes; SHA256 `2ceb3b3d68bdf1c4def9702cb02c5c8adb235197d1c8f2eaad24136833ab9a57`, matching the official published hash. Minisign verification PASS: Ed25519 of Blake2b-64 prehash plus global trusted-comment signature, matching key ID and public key from pinned official `Dockerfile.release`. PGP `.asc` retained but not verified. Provenance and result: `test-results/recovery-tools/minio-win-v1/verification.json`. No global installation, Go SDK, service startup, or candidate data change.

## Backup / restore drill execution runbook (not executed)

1. On the approved independent target only, record database name, household UUID, revision and target host identity. Record service health and available disk/memory. Require `VTON_PROVIDER=MOCK`, `FITROOM_LIVE_ENABLED=false`, `FITROOM_STATUS_READ_UNBILLED_VERIFIED=false`; no worker/beat until pending jobs have been audited. Archive copies of `fitroom_request` and `fitroom_audit`; no grant generation.
2. Use private `PGPASSFILE` (owner-only access), never include passwords in argv/output. Run PG16 `pg_dump -h <independent-host> -p <port> -U <user> -d wardrobe_demo_recovered -Fc -f <private-host-backup>/wardrobe.dump`; use `pg_dumpall --globals-only` if existing roles are required and authorized. Native-tool subprocess limits must account for actual dataset size, capture failure and no automatic retries.
3. Run `pg_restore --list` on the completed archive, record SHA256 and schema revision. This is archive readability, NOT a real restore test. Keep SQL output containing roles/private data access-restricted.
4. Use existing Python boto3 with verified target endpoint and server-private credentials to enumerate S3 keys via pagination and download to an access-restricted host directory. Do not use raw MinIO `xl.meta` as an S3 image. No `put`, `delete`, bucket policy change or source overwrite. Record key/bytes/SHA256; ETag alone is not proof of content checksum. Compare asset storage keys with downloaded object inventory.
5. After distinct-environment approval, initialize a brand-new test DB and separate object volume, restore `pg_restore --exit-on-error --single-transaction` into the NEW DB. Do not use `--clean` or source database. Recreate storage namespace only in the test target and upload backup objects there. Original backup/preservation hashes remain unchanged.
6. Independently query restored IDs and counts, all FK relationships, profile/device access, available image objects, job snapshots and grants. Compare restored image bytes with backup SHA256. A successful restore process alone is insufficient.
7. Run two-profile browser verification on a separate API runtime: 104 garments total, Scene right66/left21, images+geometry match, each synthetic wear54 / LIKED3, error handling, mock VTON snapshot regression. Scene B-02 remains DEFERRED; do not "fix" external-location mapping while restoring approved geometry.

Read-only DB baseline transaction on the independent recovered copy:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT current_database();
SELECT version_num FROM wardrobe.alembic_version;
SELECT household_id, count(*) FROM wardrobe.garment GROUP BY household_id;
SELECT member_id, count(*) FROM wardrobe.wear_event GROUP BY member_id;
SELECT member_id, count(*) FROM wardrobe.liked_item GROUP BY member_id;
SELECT count(*) FROM wardrobe.scene_placement;
SELECT count(*) FROM wardrobe.fitroom_request;
SELECT count(*) FROM wardrobe.fitroom_audit;
SELECT count(*) FROM wardrobe.garment g LEFT JOIN wardrobe.asset a
  ON a.id=g.image_asset_id WHERE g.image_asset_id IS NOT NULL AND a.id IS NULL;
SELECT count(*) FROM wardrobe.scene_placement p
  LEFT JOIN wardrobe.garment g ON g.id=p.garment_id
  LEFT JOIN wardrobe.storage_location s ON s.id=p.compartment_id
  WHERE g.id IS NULL OR s.id IS NULL;
COMMIT;
```

Check actual version-table schema before running this SQL (migration/runtime may configure another schema); absence is a compatibility defect to report, never a reason to migrate blindly. Service read-only queries and actual backup operations require their own preflight/gate.

## Gap planner implementation checkpoint

`scripts/recovery_gap_plan.py` accepts an offline independent-target audit only, enforcing exact new DB `wardrobe_demo_recovered`, deterministic household UUID, seed namespace `poc-stage-b-v1`, revision `0006_fitroom_budget`, complete reference audit and paid-provider disabled. Approved synthetic UUID lists and recovered UUID lists must be explicit and duplicate-free. It returns set differences only for approved Stage-B garments/synthetic wear/LIKED/future Context; no DB connection, seed execution, actual-history/job/grant/audit regeneration, or write action. Caller must derive approved lists from existing deterministic contracts, not invent an inventory. Real audit is not available yet; no runtime gap manifest generated.

Final static suite now **9 PASS**, Ruff PASS. The fixture proves recovered records are excluded from missing items and wrong target/unaudited/paid-enabled/old-revision input is rejected. Service backup, real restore, independent persistence recreation and E2E gates remain NOT RUN.

## Recovery result integration checkpoint

Root's independent native working-copy measurement recovered revision0004: garments9, members2, assets7, wear0, card1, outfits16, audit119. Nine MinIO objects read and seven READY asset checksums matched. Native backup/restore drill passed, and a new working DB upgraded to0006 preserving41 existing table contents. These are recovery results from Track A; they do not establish a rebuilt104 service or container recreation PASS.

Approved104 vs recovered9 garment ID intersection is zero. Preserve recovered9 and actual owner/history/job/card/audit/grant data globally; add approved demo104 under its separate deterministic household. Expected global garments113, expected approved demo household104. Existing recovered household/personas must not be overwritten or silently reassigned.

`scripts/recovery_approved_inventory.py` generated ignored `test-results/reconstruction-plans/approved104-v1.json`: 52 products with deterministic prior IDs +24 exact approved mappings +28 Stage-B exact IDs. It validates76 IDs against original baseline,66 right placements against104, and Stage28 owner against source K mappings. It includes approved image files/checksums, original/derivative IDs, locations and geometry when the manifests contain them, records source file SHA256, and performs no DB/API calls or original manifest changes.

Reconstruction dependencies, in order:

1. Create only missing approved household, owner profiles (including source garments' dad/daughter IDs), device/member/station relationships, preserving recovered users and genuine consent/access records. Do not infer real-person consent from a synthetic seed.
2. Restore missing storage locations/LED-zone references from approved location IDs, group compartments rather than image coordinates; retain B-02 approved deferred discrepancy.
3. Register approved original photos separately from wardrobe derivatives using explicit-target upload contracts. Preserve prior original/derivative IDs if they are referenced by snapshot/manifests; stock API registration may generate random asset/garment IDs, so cannot be invoked blindly. Exact-ID additive internal registration requires a guarded target-only runner with hash/ownership/state metadata validation and idempotency; reusing old scripts is forbidden.
4. Insert missing base52 then approved24 then Stage28 garment records with approved IDs and owners, then states and66 Scene records. No update/delete of recovered9 or unrelated locations/assets.
5. Add only approved deterministic synthetic54 wear/member,3 LIKED/member, future Context2/member after matching outfit/Context/image reference inventories. Current gap tool protects Stage-B subsets; base76 inventory now complements it but is not an executable seed.
6. Review pending jobs/grants/audit histories, disable live provider, compare all referenced S3 keys, then independently test idempotency and113 global/104 demo household counts. Profile wiring and actual app connection switch remain approval gates.

Open execution gates: independent service-capable Engine/host; enough memory for native tools; explicit API/image registration target and credentials; authorized synthetic-demo consent treatment; approval for container recreation and app connection switch. Native PG on57444 and MinIO19110 are temporary Track-A validators, not the configured future persistent services. No rebuilt-service claim until Redis/limiter and two-profile actual browser E2E pass.

## User-authorized restored Desktop route (supersedes independent-only launch)

The latest user authorized restarting existing Desktop and abandoned the independent Engine requirement. This worker did not restart or call Docker. `recovery_compose_plan.py` now additionally accepts the exact Windows named-pipe Engine ONLY with `--restored-desktop-approved`; it still prints argv and never executes. Original-source PG/MinIO volumes are not mounted. New PG16 uses actual `/var/lib/postgresql/data`, MinIO `/data`, both persistent project volumes. No PG17/18 directory convention is substituted.

Redis retains the existing handoff anonymous persistent volume `bf37edf0792e66b808e31f7c38640463b189b66717c2925f92ff01ff822db506` via an explicit external-volume reference. This is different from the older global Compose `smart-wardrobe_redis-data`; never substitute one silently. Do not start this Redis if the original handoff Redis is writing the same volume. Starting Redis with AOF may create/modify files in the reused volume and is incompatible with an absolute "original Redis volume unchanged" condition: obtain that specific exception or mount a separately approved working copy instead. Backup the RDB and retain originals before any new writer.

Legacy `handoff_local.prepare()` and `prepare_test_services()` now fail before Docker or object-store calls; their obsolete tmpfs provisioning/start/initialization blocks were removed. `remediation_local.py prepare` invokes that guard before its DB creation, so accidental legacy preparation cannot recreate containers or initialize data. Seed functions/IDs unchanged, but they remain disabled from use as recovery entry points. Explicit new-target seed requires approved inventory and root's target-aware path.

Storage tests11 PASS including local-route explicit approval and the no-subprocess legacy-startup guard; unapproved named-pipe target still rejected. Ruff PASS. No runtime mount/Redis writer/recreation verification claimed.
