import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.integration.test.ts"],
		setupFiles: ["src/test/integration-setup.ts"],
		fileParallelism: false,
		testTimeout: 30000,
	},
	resolve: {
		alias: {
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
});
