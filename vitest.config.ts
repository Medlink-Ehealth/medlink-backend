import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	// plugins: [tsconfigPaths()],
	test: {
		testTimeout: 10000, // Sets timeout to 10 seconds
	},
});
