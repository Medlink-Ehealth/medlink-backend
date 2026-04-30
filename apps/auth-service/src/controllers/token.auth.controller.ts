/* Middleware to manage auth session */

import { decryptToken, encryptionToken, logger, Next, RouterExtendedDefaultContext, statusCodes } from "@medlink/common";

import config from "../../app.config.js";
import Redis from "ioredis";
import { redis, Cache } from "../performance.controller.js";

/**
 * Process refresh token for access token.
 * A form of storage mechanism must exist, like Redis or internal server used database, to take advantage of refresh token. Where not available, refreshtoken is completely disabled
 * Redis is likely the more preferred option than the internal database which server runs on
 */
const refreshAccessToken =
	(
		options: {
			useCacheIfNoRedis?: boolean;
			accessTokenLifetime?: number;
			refreshTokenLifetime?: number | string;
		} | void,
	) =>
	async (ctx: RouterExtendedDefaultContext, next?: Next) => {
		const storage = redis ? redis : options?.useCacheIfNoRedis ? Cache : null;

		if (!storage) {
			ctx.status = statusCodes.NOT_ACCEPTABLE;
			ctx.message = "Using refresh token is not available on this server becuase no storage is setup to handle this";
			return;
		} else if (!ctx.sequelizeInstance) {
			logger.error("refreshAccessToken Error: ", "No active ctx.sequelizeInstance to match request to!");
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			return;
		}
		// console.log("ctx.request.body:: ", ctx.request.body);

		// refresh token can be in custom request header value "x-refreshToken", in Bearer auth header, request body or as a query string
		const tokenOnHeader = ctx.header["x-refreshToken"];
		let refreshToken = tokenOnHeader || ctx.request?.body["refreshToken"] ? ctx.request.body["refreshToken"] : undefined;

		// check in query
		if (!refreshToken && ctx.query && ctx.query["refreshToken"]) refreshToken = ctx.query["refreshToken"];
		// check if defined on bearer auth header
		if (!refreshToken) refreshToken = ctx.headers.authorization ? ctx.headers.authorization.split(" ")[1] : undefined;

		if (!refreshToken) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Refresh token not presence in the request";
			return;
		}

		try {
			const payload = await decryptToken(refreshToken);
			if (payload && payload.error) {
				//logger.error('Refresh token decryption error', payload.error)
				ctx.status = payload.error["code" as keyof typeof payload.error];
				ctx.message = payload.error["message" as keyof typeof payload.error];
				return;
			} else if (payload && payload["result" as keyof typeof payload]) {
				// refresh token is double encryption
				const accountData = await decryptToken(payload["result" as keyof typeof payload] as string);
				if (accountData && accountData.error) {
					//logger.error('Refresh token decryption error', payload.error)
					ctx.status = statusCodes.SERVICE_UNAVAILABLE;
					ctx.message = "Refreshing token error occurred";
					return;
				}
				if (!accountData || (accountData && !accountData["result" as keyof typeof payload])) {
					ctx.status = statusCodes.BAD_REQUEST;
					ctx.message = "Refresh token is invalid";
					return;
				}
				const data = accountData["result" as keyof typeof payload] as { [key: string]: string };
				const accountUuid = data["uuid"];

				/* Lets check our storage if refresh token exist on retrieved UUID. We ensure all refresh token are receeded with 'refresh:' for easy tracking */
				const tokenExist = await storage.get(`refresh:${accountUuid}`);
				// console.log("tokenExist:: ", tokenExist);

				if (tokenExist !== refreshToken) {
					// let end it here if we cannot track Token
					ctx.status = statusCodes.NOT_FOUND;
					ctx.message = "Refresh token is invalid";
					return;
				}

				const responseBody: { token?: string; refreshToken?: string } = {};

				const accessTokenLifetime = (
					options && options.accessTokenLifetime
						? !isNaN(Number(options.accessTokenLifetime))
							? options.accessTokenLifetime + "m"
							: options.accessTokenLifetime
						: config.authTokenLifetime
							? !isNaN(Number(config.authTokenLifetime))
								? config.authTokenLifetime + "m"
								: config.authTokenLifetime.toString()
							: "15m"
				).toString();

				const accessToken = await encryptionToken(data, {
					expiresIn: accessTokenLifetime,
				});
				if (typeof accessToken === "string") responseBody["token"] = accessToken;

				let refreshValidity = (
					options && options.refreshTokenLifetime
						? options.refreshTokenLifetime
						: config.refreshTokenLifetime
							? config.refreshTokenLifetime
							: ""
				).toString();

				if (refreshValidity) {
					refreshValidity = !isNaN(Number(refreshValidity)) ? refreshValidity + "d" : refreshValidity;
					// refreshToken uses double embedded encoding as available in signAccountInLocal
					const newRefreshToken = await encryptionToken(
						(await encryptionToken(data, {
							expiresIn: refreshValidity,
						})) as string,
						{
							expiresIn: refreshValidity,
						},
					);
					if (typeof newRefreshToken === "string") {
						responseBody["refreshToken"] = newRefreshToken;
						// lets update storage
						await storage.set(`refresh:${accountUuid}`, newRefreshToken);
					}
				}

				if (next) {
					ctx.body = responseBody;
					await next();
				} else {
					ctx.status = 200;
					return (ctx.body = responseBody);
				}
			} else {
				ctx.status = statusCodes.SERVICE_UNAVAILABLE;
				ctx.message = "Unable to refresh token";
				return;
			}
		} catch (err: unknown) {
			logger.error("refreshAccessToken middleware Error: ", err);
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			ctx.message = "Oops. Currently unable to process token refresh service";
			return;
		}
	};

export { refreshAccessToken };
