import * as esbuild from "esbuild";

const service = process.argv[2]; // e.g., "auth-service"

if (!service) {
	console.error("Please provide a service name (e.g., node build.mjs auth-service)");
	process.exit(1);
}

await esbuild
	.build({
		// Point to the entry file inside your app folder
		entryPoints: [`apps/${service}/index.ts`],
		bundle: true,
		minify: false,
		sourcemap: true,
		platform: "node",
		target: "node20",
		format: "esm",
		// Output a single file in that app's dist folder
		outfile: `apps/${service}/dist/index.js`,
		// List external packages that shouldn't be bundled (optional)
		// external: ['pg-native'],
	})
	.catch(() => process.exit(1));

console.log(`Successfully bundled ${service}!`);
