import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the dashboard into one self-contained HTML file with uPlot, the CSS and the JS all
// inlined. scripts/inline.mjs then turns that file into the package's dist output.
export default defineConfig({
	plugins: [tailwindcss(), viteSingleFile()],
	build: {
		outDir: ".vite-out",
		emptyOutDir: true,
		cssCodeSplit: false,
		assetsInlineLimit: Number.MAX_SAFE_INTEGER,
		reportCompressedSize: false,
		target: "es2022",
	},
});
