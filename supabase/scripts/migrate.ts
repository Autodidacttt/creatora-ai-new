// Applies supabase/migrations/*.sql in order, once each, inside a transaction per file.
// Usage: npm run db:migrate [-- --to <file.sql>] [-- --dry-run]
//   --to       stop after this migration (staged rollouts: expand → deploy → contract)
//   --dry-run  run the pending migrations, then roll each back (nothing is kept)
// Each file waits at most 5s for table locks, so a busy table makes it fail fast instead of blocking traffic.
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { requireEnv } from "./env";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const to = arg("--to");
  const client = new Client({
    connectionString: requireEnv("SUPABASE_DB_URL"),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`
    create schema if not exists private;
    create table if not exists private.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const dir = path.resolve(__dirname, "..", "migrations");
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (to && !all.includes(to)) throw new Error(`--to: no migration named ${to}`);
  const files = to ? all.filter((f) => f <= to) : all;
  const { rows } = await client.query<{ name: string }>("select name from private.schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  let count = 0;
  // A dry run is one transaction (later files build on earlier ones), rolled back at the end
  if (dryRun) await client.query("begin");
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    process.stdout.write(`→ ${file} ... `);
    try {
      if (!dryRun) await client.query("begin");
      await client.query("set local lock_timeout = '5s'");
      await client.query(sql);
      await client.query("insert into private.schema_migrations (name) values ($1)", [file]);
      if (!dryRun) await client.query("commit");
      console.log("ok");
      count++;
    } catch (err) {
      await client.query("rollback");
      console.log("FAILED");
      console.error(err instanceof Error ? err.message : err);
      await client.end();
      process.exit(1);
    }
  }
  if (dryRun) {
    await client.query("rollback");
    console.log(count ? `Dry run: ${count} migration(s) applied cleanly, then rolled back.` : "Database is up to date.");
    await client.end();
    return;
  }
  // Ask PostgREST to pick up schema changes
  await client.query("notify pgrst, 'reload schema'");
  console.log(count ? `Applied ${count} migration(s).` : "Database is up to date.");
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
