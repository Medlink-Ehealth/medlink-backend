import { Router, statusCodes, dbQuerier, logger, Cache } from "@medlink/common";
import { Provider } from "../../models/Provider.model.js";
import Redis from "ioredis";

const router = Router("providers");

/**
 * @openapi
 * /patients/providers:
 *   get:
 *     tags:
 *       - Platform Providers
 *     summary: "Fetch available service providers on platform service"
 *     description: ""
 *     security:
 *       - Token: []
 *     responses:
 *       200:
 *         description: Returns patient user data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 account:
 *                   description: ""
 *                   type: array
 *                   items:
 *                     - $ref: "#/components/schemas/Provider"
 *               example:
 *                 status: 200
 *                 account:
 *                   - uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                     logo: "src/logo.png"
 *                     name: Emma Services
 *                     email: emmaservice@gmail.com
 *                     phoneNumber: 09067676767
 *                     state: true
 *                     'type': 'provider'
 *                     created: 2024-12-05T19:00:00.151Z
 *                     updated: 2024-12-05T19:00:00.151Z
 *       401:
 *         description: Unauthorised response
 *       5xx:
 *         description: "Oops! A server error occcurred. Media type => text/plain"
 */

router.get(
	"/",
	async (ctx, next) => {
		if (ctx.path === ctx.url) {
			ctx.url = ctx.url + "?sort=[created=ASC]&limit=10";
		}
		await next();
	},
	dbQuerier({ ignoreStateFiltration: true, useOlderImplementation: false }),
	async (ctx) => {
		// fetch providers
		try {
			// performance requirement neccessiate to cache providers for up to 5 minutes in redis. So we check there first before querying DB
			const checkCache = await Cache.get("schemas:platformProvders");
			if (checkCache) {
				try {
					const providers = JSON.parse(checkCache);
					// return response once verified as available
					ctx.status = statusCodes.OK;
					ctx.body = {
						status: statusCodes.OK,
						data: providers,
					};
					return;
				} catch (err) {
					logger.error("Error parsing item retrived from cache:", err);
					ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
					ctx.message = "Server error occurred";
					return;
				}
			}
			const providers = await Provider(ctx.sequelizeInstance!).findAll(ctx.state.dbQuerier);
			if (providers && providers[0] instanceof Provider(ctx.sequelizeInstance!)) {
				// save in cache
				if (Cache instanceof Redis) Cache.set("schemas:platformProvders", JSON.stringify(providers), "EX", 5 * 60 * 1000);
				else Cache.set("schemas:platformProvders", JSON.stringify(providers));

				ctx.status = statusCodes.OK;
				ctx.body = {
					status: statusCodes.OK,
					data: providers,
				};
				return;
			} else if (providers && providers.length === 0) {
				ctx.status = statusCodes.NOT_FOUND;
				ctx.message = "No record found";
				return;
			}
			ctx.status = statusCodes.BAD_REQUEST;
			return;
		} catch (err) {
			logger.error("providers retrieval error:", err);

			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = (err as object)["message" as keyof typeof err]
				? (err as object)["message" as keyof typeof err]
				: "Server error occurred";
			return;
		}
	},
);

export { router as patientProviders };
