import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Turns the Vite single-file build into the package's dist output. The package exports one
// string constant, so emitting it directly is simpler than running a second bundler over it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, ".vite-out", "index.html"), "utf8");
const dist = join(root, "dist");

mkdirSync(dist, { recursive: true });

writeFileSync(join(dist, "index.mjs"), `export const dashboardHtml = ${JSON.stringify(html)};\n`);

writeFileSync(
	join(dist, "index.d.mts"),
	"/** Self-contained dashboard document. uPlot, CSS and JS are inlined; it fetches nothing. */\nexport declare const dashboardHtml: string;\n",
);

const raw = Buffer.byteLength(html);
console.log(
	`@vitalsjs/ui: dashboard ${(raw / 1024).toFixed(1)} kB raw, ${(gzipSync(html).length / 1024).toFixed(1)} kB gzip`,
);
