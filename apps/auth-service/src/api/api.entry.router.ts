// routes imports
import config from "../../app.config.js";
import swaggerDocs from "../../app.swagger.js";
import { v1 } from "./v1/index.js";
import appConfig from "../../app.config.js";
import { logger, throwError } from "@medlink/common";
import { Router } from "../../../../common/middlewares/router.js";

// contorl allowed methods
const enforcedMethods = config.methods;
const allowableMethods = (
	enforcedMethods && Array.isArray(enforcedMethods) && enforcedMethods.length ? enforcedMethods : ["get", "post", "patch", "delete"]
).map((method) => method.toLowerCase());

// lets ensure request is from a trusted source
const AppIDsFunc: () => string[] | null = () => {
	// X_REQUEST_REFERRAL is an arrays of strings in env variable
	try {
		const ids = process.env.X_REQUEST_REFERRAL ? JSON.parse(process.env.X_REQUEST_REFERRAL) : undefined;
		return ids && Array.isArray(ids) && ids.length ? ids : null;
	} catch (err) {
		logger.error("Remote App ID checker error for API endpoint!", err);
		return throwError(500, (err as Error) || "Oops! Server error occurred in parsing authorised App IDs");
	}
};
const AppIDs = AppIDsFunc();

// html response template
const htmlPlaceholder = `
            <!DOCTYPE html>
            <html lang="en">
              <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Powered by Greybox.</title>
              </head>
              <body>
                <div>
                 Hey! Let's track back abit... Seems you missed the magic word!!!
                </div>
              </body>
            </html>
        `;

const router = Router();
router.use(async (ctx, next) => {
	// control allowed methods for App
	if (!allowableMethods.includes(ctx.method.toLowerCase())) return ctx.throw(405, "Method not allowed!");

	//console.log("request types", ctx.accepts("json", "text", "html"));
	// Enforce header Content-Type as 'application/json' or 'multipart/form-data'
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
		// verify app requester identity in header or query param
		const appReferral = ctx.get("x-request-referral") || ctx.query["x-request-referral"];

		let identifiedInbound = false; // boolean for checker

		if (appReferral && typeof appReferral === "string" && AppIDs && AppIDs.includes(appReferral)) identifiedInbound = true;
		// the ID referral may alternatively be the header identifier itself
		else if (AppIDs) {
			for (const id of AppIDs) {
				if (ctx.get(id)) {
					identifiedInbound = true;
					break;
				}
			}
		}
		// continue process if App ID is verifiable
		if (identifiedInbound) await next();
		// lets exclude swagger doc link from returning error endpoint placeholder
		else if (AppIDs && AppIDs.length && (ctx.path === "/api/docs" || ctx.path === "/api/docs/spec" || ctx.path === "/api")) {
			const accessID = ctx.query["id"];
			if (accessID && typeof accessID === "string" && AppIDs.includes(accessID)) await next();
			else {
				// Output doc endpoint validation failure
				ctx.status = 202;
				ctx.type = ".html";
				return (ctx.body = htmlPlaceholder);
			}
		} else {
			logger.error("Unrecognisable App! Define App ID in request header to access api endpoints!");
			// Let customise what is returned when ID validation fails
			const apiMode = config.appMode === "apiOnly";
			ctx.status = apiMode ? 202 : 400;
			if (apiMode) ctx.type = ".html";
			return (ctx.body = apiMode ? htmlPlaceholder : "Unrecognisable App! Define App ID in request header to access api endpoints!");
		}
	} else {
		ctx.throw(406, "Unsupported content-type!");
	}
});

const routerAPI = Router({
	prefix: "/api",
});
// routerAPI.use(v1.routes());
/**
 * Swagger docs main endpoint
 */
routerAPI.get("/docs", (ctx, next) => {
	// lets extract key ID
	const accessID = ctx.query["id"];

	return swaggerDocs({
		title: (appConfig.sitename || appConfig.sitenameFull) + " API",
		version: "1.0.0",
		description: `Access key => '''${accessID}''' || API endpoints developed with Greybox`,
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
	})(ctx, next);
});

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
routerAPI.all("/", (ctx) => {
	ctx.status = 200;
	return (ctx.body = {
		status: 200,
		statusText: "This verifies that API endpoints are accessible",
	});
});

router.use(routerAPI.routes());
export default router;

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
