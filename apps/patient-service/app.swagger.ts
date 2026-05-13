import swaggerJsdoc from "swagger-jsdoc";
import { koaSwagger, KoaSwaggerUiOptions } from "koa2-swagger-ui";
import config from "./app.config.js";

// access servers
const appServers: {
	url: string;
	description: string;
}[] = [];

// production multi-tenancy integrations
const apiModes = config.apiMultiTenancyMode;
const dbENV = !apiModes
	? ["live"]
	: typeof apiModes === "string"
		? [apiModes]
		: typeof apiModes === "boolean"
			? ["live", "test"]
			: apiModes;

const serverAddress = config.serverAddress || "http://localhost";

if (process.env.NODE_ENV !== "development") {
	if (dbENV.length === 1) {
		appServers.push({
			url: serverAddress + "/" + config.apiVersion,
			description: "Live server",
		});
	} else {
		const mainServerTldCount = serverAddress.split(".");
		const tldPrefix = mainServerTldCount.shift();
		for (const env of dbENV) {
			appServers.push({
				url:
					(tldPrefix && mainServerTldCount.length > 1
						? (tldPrefix.includes("://") ? tldPrefix.split("://")[0] + `://${env}.` : `${env}.`) + mainServerTldCount.join(".")
						: serverAddress.includes("://")
							? serverAddress.split("://").join(`://${env}.`)
							: `${env}.` + serverAddress) +
					("/" + config.apiVersion),
				description: `${env.toUpperCase().substring(0, 1)}${env.toLowerCase().substring(1)} server`,
			});
		}
	}
}

const swaggerConfigSetup = config.swaggerSetup;
const swaggerUIoptions: Partial<KoaSwaggerUiOptions> = {
	title: "API doc", // page title
	oauthOptions: {}, // passed to initOAuth
	swaggerOptions: {
		url: "http://petstore.swagger.io/v2/swagger.json", // link to swagger.json
		supportedSubmitMethods: ["get", "post", "delete", "patch"],
		docExpansion: "none",
		jsonEditor: false,
		defaultModelRendering: "schema",
		showRequestHeaders: false,
		swaggerVersion: "x.x.x", // read from package.json,
		validatorUrl: null, // disable swagger-ui validator
	},
	routePrefix: "/docs", // route where the view is returned
	specPrefix: "/docs/spec", // route where the spec is returned
	exposeSpec: false, // expose spec file
	hideTopbar: false,
	//favicon: "/favicon.png", // default favicon
	//customCSS: `h1 { color: red }`, // Add Custom CSS on the html
	//swaggerVersion: "",
};

if (process.env.NODE_ENV !== "production")
	appServers.unshift({
		url:
			(process.env.localUrl ? process.env.localUrl : "http://localhost") +
			":" +
			(process.env.PORT || process.env.port) +
			"/" +
			config.apiVersion,
		description: "Local Dev Server",
	});

const options = {
	definition: {
		openapi: "3.1.1",
		info: {
			title: config.serviceName || config.projectName + " API",
			version: "1.1.0", // consider import/syncing version with greybox core version
			description: "API endpoints developed with Greybox",
			/* contact: {
				name: "Akin",
				email: "devakintunde@gmail.com",
				url: "https://github.com/DevAkintunde",
			}, */
		},
		servers: appServers,
	},
	// looks for configuration in specified directories
	apis: [
		`src/api/${config.apiVersion}/**/*.routes.ts`,
		`src/api/${config.apiVersion}/**/*.route.ts`,
		"src/**/*.entry.ts",
		`src/api/${config.apiVersion}/**/*.router.ts`,
		`src/api/api.entry.router.ts`,
		"src/**/*.model.ts",
		"src/**/*.doc.ts",
	], // files containing annotations as above - keep in mind versioning
};

const swaggerSpec = (jsDocInfo?: (typeof options)["definition"]["info"]) => {
	const importedSpec = swaggerConfigSetup?.swaggerOptions?.spec;
	return swaggerJsdoc(
		importedSpec ? importedSpec : !jsDocInfo ? options : { ...options, definition: { ...options.definition, info: jsDocInfo } },
	);
};
//console.log("swaggerSpec", swaggerSpec);

const swaggerDocs = (jsDocInfo: (typeof options)["definition"]["info"], swaggerSetup?: Partial<KoaSwaggerUiOptions>) =>
	koaSwagger({
		...swaggerUIoptions,
		...(swaggerSetup ? swaggerSetup : {}),
		...(swaggerConfigSetup ? swaggerConfigSetup : {}),
		swaggerOptions: {
			...swaggerUIoptions.swaggerOptions,
			...(swaggerConfigSetup?.swaggerOptions || {}),
			// eslint-disable-next-line @typescript-eslint/no-empty-object-type
			spec: swaggerSpec(jsDocInfo) as {}, // allow to update info values in swaggerJsdoc
		},
	});
export default swaggerDocs;
