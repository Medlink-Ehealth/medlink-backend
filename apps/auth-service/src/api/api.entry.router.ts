// routes imports
import config from "../../app.config.js";
import swaggerDocs from "../../app.swagger.js";
// import { v1 } from "./v1/index.js";
import appConfig from "../../app.config.js";
import { Router } from "@medlink/common";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// get all api versions in directory
const apiVs = readdirSync(__dirname, { withFileTypes: true })
	// filter to directory
	.filter((dir) => dir.isDirectory())
	.map((dir) => dir.name);

// const resolve = (p: string) => path.resolve(__dirname, p);
// const projectRoot = process.cwd();
// console.log("apiVs", apiVs);

// control allowed methods
const enforcedMethods = config.methods;
const allowableMethods = (
	enforcedMethods && Array.isArray(enforcedMethods) && enforcedMethods.length ? enforcedMethods : ["get", "post", "patch", "delete"]
).map((method) => method.toLowerCase());

const router = Router();
router.use(async (ctx, next) => {
	// control allowed methods for App
	if (!allowableMethods.includes(ctx.method.toLowerCase())) return ctx.throw(405, "Method not allowed!");

	if (
		ctx.method.toLowerCase() === "get" ||
		ctx.accepts("json", "text", "html") ||
		(ctx.method.toLowerCase() !== "get" &&
			(ctx.is("application/json") ||
				ctx.is("application/vnd.api+json") ||
				ctx.header["content-type"] === "application/json" ||
				ctx.header["content-type"] === "application/vnd.api+json" ||
				(ctx.header["content-type"] && ctx.header["content-type"].includes("multipart/form-data"))))
	) {
		await next();
	} else {
		return ctx.throw(406, "Unsupported content-type!");
	}
});

/* We are creating a dynamic router version here such that all available version is auto load if or when available */
for (const versionDir of apiVs) {
	const dir = path.resolve(path.join(__dirname, versionDir, "index.js"));
	const vIndex = await import(dir);
	const version = vIndex && (Object.values(vIndex)[0] as typeof Router);

	if (!version) continue;

	const routerAPI = Router();
	routerAPI.use(version.routes()); // import v1 routes - and extendable to future versioning

	/**
	 * Swagger docs main endpoint
	 */
	routerAPI.get("/:version/docs", async (ctx, next) => {
		// lets extract key ID
		const apiVersion = ctx.params["version"];
		// check if version is valid
		if (!apiVersion || !apiVs.includes(apiVersion)) {
			return (ctx.body = {
				status: 404,
				statusText: `This API service seems to be working but this api version or endpoint isn't`,
			});
		}

		const versionExtract = apiVersion.substring(apiVersion.length - 1, apiVersion.length);

		return await swaggerDocs(
			{
				title: (appConfig.serviceName || appConfig.projectName) + " API",
				version: "1.0.0",
				description: `API Version => '''${versionExtract}'''`,
				/* "termsOfService": "http://example.com/terms/",
					"contact": {
						"name": "API Support",
						"url": "http://www.example.com/support",
						"email": "support@example.com"
					},
					"license": {
						"name": "Apache 2.0",
						"url": "https://www.apache.org/licenses/LICENSE-2.0.html"
					},, */
			},
			{
				routePrefix: `/${apiVersion}/docs`, // route where the view is returned
				specPrefix: `/${apiVersion}/docs/spec`, // route where the spec is returned
			},
		)(ctx, next);
	});
	router.use(routerAPI.routes());
}

/**
 * Use to return the '/' api endpoint of the outputs in the middleware above
 * @openapi
 * /:
 *   get:
 *     tags:
 *       - Test
 *     description: Welcome to the main API entry!
 *     responses:
 *       200:
 *         description: Test if API endpoints can be successfully connected to
 *       202:
 *         description: Returns HTML output when there is a validation error
 *       405:
 *         description: Returns a prompt when connection is initiated with an unacceptable method.
 *       406:
 *         description: Server is strcit on accpetable Content-Type header properties
 *       500:
 *         description: This let's you know if a server error occured
 */
router.all("/:version", (ctx) => {
	const versionDefination = ctx.params["version"];

	const checkVersion =
		versionDefination && apiVs.includes(versionDefination)
			? "'Version: " + versionDefination.substring(versionDefination.length - 1, versionDefination.length) + "'"
			: "Unknown Version";

	ctx.status = 200;
	return (ctx.body = {
		status: 200,
		statusText: `Awesome! This verifies that API ${checkVersion === "Unknown Version" ? `server is accessible. Request should however be built such that the API version is defined; such as: ${ctx.host}/${apiVs[0]}` : checkVersion + " is accessible and working!"}`,
	});
});

export { router };

/**
 *  Global props
 *  @openapi
 *  components:
 *    securitySchemes:
 *      Token:
 *        type: http
 *        scheme: bearer
 *        bearerFormat: JWT
 *    parameters:
 *      appID:
 *        in: header
 *        name: x-request-referral
 *        description: Generally required header prop for endpoint connections
 *        schema:
 *          type: string
 *        required: true
 *      requestToken:
 *        in: header
 *        name: x-requesttoken
 *        description: token | session. define a sign-in method. Token would enable to return a tokenised user data when set
 *        schema:
 *          type: string
 *    responses:
 *      UnauthorizedError:
 *        description: Access token is missing or invalid
 */

/**
 *  Global tags
 *  openapi
 *  tags:
 *    - name: User
 *      description: Specific user related endpoints
 *    - name: Page
 *      description: Publicly accessible pages
 *    - name: Core Basics
 *      description: Core app utility endpoints that might come useful
 */

/**
 *  securitySchemes extra options
 *  openapi
 *  components:
 *    securitySchemes:
 *      BasicAuth:
 *        type: http
 *        scheme: basic
 *      Token:
 *        type: http
 *        scheme: bearer
 *        bearerFormat: JWT
 *      ApiKeyAuth:
 *        type: apiKey
 *        in: header
 *        name: X-API-Key
 *      OAuth2:
 *        type: oauth2
 *        flows:
 *          authorizationCode:
 *            authorizationUrl: https://example.com/oauth/authorize
 *            tokenUrl: https://example.com/oauth/token
 *            scopes:
 *              read: Grants read access
 *              write: Grants write access
 *              admin: Grants access to admin operations
 */
