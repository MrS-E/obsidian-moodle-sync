import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: "**/*.spec.ts",
	timeout: 120_000,
	outputDir: "../../test-results/e2e",
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure"
	}
});