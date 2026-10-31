import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, '../src/db/migrations');
const distDir = path.resolve(__dirname, '../dist/db/migrations');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(distDir, { recursive: true });
  fs.cpSync(srcDir, distDir, { recursive: true });
} else {
  console.error(`[ERROR] Source migrations directory not found: ${srcDir}`);
  process.exit(1);
}
