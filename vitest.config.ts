import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		passWithNoTests: true,
		testTimeout: 10000,
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			thresholds: {
				lines: 70,
				functions: 70,
				branches: 70,
				statements: 70,
			},
		},
	},
});
