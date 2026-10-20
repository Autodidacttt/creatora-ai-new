// Loads .env.local (then .env) for CLI scripts. Values are never printed.
import { config } from "dotenv";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
config({ path: path.join(root, ".env.local"), quiet: true });
config({ path: path.join(root, ".env"), quiet: true });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}. Add it to .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}
