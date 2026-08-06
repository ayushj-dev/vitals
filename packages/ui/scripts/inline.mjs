import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Turns the Vite single-file build into the package's dist output.
// Emits both ESM and CommonJS entry points.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, ".vite-out", "index.html"), "utf8");
const dist = join(root, "dist");

mkdirSync(dist, { recursive: true });

const escapedHtml = JSON.stringify(html);

// ESM build
writeFileSync(join(dist, "index.mjs"), `export const dashboardHtml = ${escapedHtml};\n`);

// CommonJS build
writeFileSync(join(dist, "index.cjs"), `exports.dashboardHtml = ${escapedHtml};\n`);

// Type declarations
writeFileSync(
	join(dist, "index.d.mts"),
	"/** Self-contained dashboard document. uPlot, CSS and JS are inlined; it fetches nothing. */\nexport declare const dashboardHtml: string;\n",
);

const raw = Buffer.byteLength(html);

console.log(
	`@vitalsjs/ui: dashboard ${(raw / 1024).toFixed(1)} kB raw, ${(gzipSync(html).length / 1024).toFixed(1)} kB gzip`,
);
