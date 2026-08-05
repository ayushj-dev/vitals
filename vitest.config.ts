import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// --expose-gc lets the GC collector tests assert on real collections.
		pool: "forks",
		execArgv: ["--expose-gc"],
	},
});
