// Applies supabase/migrations/*.sql in order, once each, inside a transaction per file.
// Usage: npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { requireEnv } from "./env";

async function main() {
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
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await client.query<{ name: string }>("select name from private.schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    process.stdout.write(`→ ${file} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into private.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
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
  // Ask PostgREST to pick up schema changes
  await client.query("notify pgrst, 'reload schema'");
  console.log(count ? `Applied ${count} migration(s).` : "Database is up to date.");
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
