/**
 * Restore the official CPIC database dump into Supabase as a pinned, isolated
 * `cpic` schema — the version-locked reference copy of the whole ruleset.
 *
 * This is NOT the runtime path. `cpic-ingest.ts` + `cpic-build.ts` still produce
 * the deterministic engine catalog (lib/cpic/catalog.json) that the evaluation
 * loop consumes; the model never queries this schema. What the Supabase copy
 * buys you: SQL over the full CPIC dataset (allele functions/frequencies, every
 * pair, guideline prose) for build-time exploration and expanding scope beyond
 * the actionable set — from a source pinned to a specific CPIC release, not the
 * live API.
 *
 * The dump (CC0) already `CREATE SCHEMA cpic` and scopes every table/view/fn to
 * it, so it never touches `public` (the app schema). We drop+recreate `cpic` in
 * a single transaction, so a failed load rolls back and leaves the DB untouched.
 *
 * Requires `psql` (the dump uses COPY blocks the JS driver can't stream):
 *   brew install libpq && brew link --force libpq   # provides psql on macOS
 *
 * Run:
 *   bun scripts/load-cpic-supabase.ts \
 *     --dump="/Volumes/Extreme Pro/basepair/cpic/cpic_db_dump-v1.59.1.sql.gz"
 *
 * Flags / env:
 *   --dump=<path>   dump .sql.gz  (or CPIC_DUMP env; defaults to the SSD path)
 *   --psql=<path>   psql binary   (or PSQL_BIN env; else resolved from PATH)
 *   --no-drop       append into an existing cpic schema instead of recreating
 * Connection: DATABASE_URL_SESSION (session-mode pooler, 5432) is required for
 * this DDL-heavy transactional load; falls back to DATABASE_URL.
 */
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { PassThrough } from "node:stream";
import postgres from "postgres";

const DEFAULT_DUMP =
  "/Volumes/Extreme Pro/basepair/cpic/cpic_db_dump-v1.59.1.sql.gz";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const has = (name: string) => process.argv.includes(`--${name}`);

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

const dump = flag("dump") ?? process.env.CPIC_DUMP ?? DEFAULT_DUMP;
const drop = !has("no-drop");

// Session-mode pooler for transactional DDL (see drizzle.config.ts note).
const rawUrl = process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL;
if (!rawUrl) fail("Set DATABASE_URL_SESSION (or DATABASE_URL) in .env.local.");
if (!process.env.DATABASE_URL_SESSION) {
  console.warn(
    "⚠ DATABASE_URL_SESSION not set; using DATABASE_URL. If that is the " +
      "transaction pooler (6543), the single-transaction restore may fail — " +
      "prefer the session pooler (5432).",
  );
}
// Supabase requires TLS; psql needs it stated explicitly.
const url = /[?&]sslmode=/.test(rawUrl!)
  ? rawUrl!
  : `${rawUrl}${rawUrl!.includes("?") ? "&" : "?"}sslmode=require`;

if (!existsSync(dump)) {
  fail(
    `Dump not found: ${dump}\n  Pass --dump=<path> or set CPIC_DUMP. The raw ` +
      `dumps live on the SSD (see docs/DATA_SOURCES.md → Local raw archive).`,
  );
}

// psql is the correct tool for restoring pg_dump output (native COPY support).
const psqlBin = flag("psql") ?? process.env.PSQL_BIN ?? "psql";
const probe = spawnSync(psqlBin, ["--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  fail(
    `psql not found (tried "${psqlBin}"). Install it, then re-run:\n` +
      `  brew install libpq && brew link --force libpq\n` +
      `Or point at an existing binary with --psql=/full/path/to/psql.`,
  );
}

console.log(`CPIC restore → Supabase 'cpic' schema`);
console.log(`  dump: ${dump}`);
console.log(`  psql: ${probe.stdout.trim()}`);
console.log(`  mode: ${drop ? "drop + recreate" : "append (--no-drop)"}\n`);

await restore();
await verify();

async function restore(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // --single-transaction: the whole restore (incl. the DROP) is atomic, so a
    // failure rolls back and never leaves a half-loaded schema.
    const psql = spawn(
      psqlBin,
      ["--single-transaction", "-v", "ON_ERROR_STOP=1", "-f", "-", url],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    psql.on("error", reject);
    psql.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`psql exited with code ${code}`)),
    );

    // Prepend the DROP, then stream the gunzipped dump into the same stdin.
    const pipe = new PassThrough();
    if (drop) pipe.write("DROP SCHEMA IF EXISTS cpic CASCADE;\n");
    createReadStream(dump)
      .pipe(createGunzip())
      .on("error", reject)
      .pipe(pipe); // ends `pipe` (and thus psql stdin) when the dump ends
    pipe.pipe(psql.stdin);
  }).catch((err: Error) => fail(`Restore failed: ${err.message}`));
  console.log("\n✓ restore committed\n");
}

async function verify(): Promise<void> {
  const sql = postgres(url, { prepare: false });
  try {
    const rows: [string, string][] = [];
    for (const t of [
      "gene",
      "drug",
      "pair",
      "recommendation",
      "allele_frequency",
    ]) {
      const [{ count }] = await sql.unsafe<{ count: string }[]>(
        `select count(*)::text as count from cpic.${t}`,
      );
      rows.push([t, count]);
    }
    console.log("Row counts:");
    for (const [t, c] of rows) console.log(`  cpic.${t.padEnd(18)} ${c}`);

    // Sanity: the canonical demo pair must be present and actionable.
    const demo = await sql.unsafe<{ genesymbol: string; name: string }[]>(
      `select p.genesymbol, d.name
         from cpic.pair p join cpic.drug d on d.drugid = p.drugid
        where p.genesymbol = 'CYP2C19'
          and d.name ilike 'clopidogrel'
          and p.usedforrecommendation
          and not p.removed
        limit 1`,
    );
    console.log(
      demo.length
        ? `\n✓ demo pair present: ${demo[0].genesymbol} / ${demo[0].name}`
        : "\n⚠ demo pair CYP2C19/clopidogrel not found — check the dump version",
    );
    const [{ count: actionable }] = await sql.unsafe<{ count: string }[]>(
      `select count(*)::text as count from cpic.pair
        where usedforrecommendation and not removed`,
    );
    console.log(`✓ ${actionable} actionable gene-drug pairs available\n`);
  } finally {
    await sql.end();
  }
}
