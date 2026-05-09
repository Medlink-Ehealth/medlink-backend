import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
    testTimeout: 10000, // Sets timeout to 10 seconds
  },
});
