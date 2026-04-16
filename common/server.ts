import fs from "node:fs";
import nodePath from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import nodeUrl from "node:url";
import "dotenv/config";

import Koa, { DefaultState } from "koa";
import http from "http";
import https from "https";
import { Server, Socket } from "socket.io";

import { server as serveFiles } from "koa-files"; // etag module is installed manually becuase it's required by koa-files & Azure throws error without etag
import session from "koa-session";
import koaCash from "koa-cash";
import { LRUCache } from "lru-cache";
import koaCors, { Options } from "@koa/cors";
import passport from "koa-passport";
//import bot from "isbot";
import helmet from "helmet";
import compress from "koa-compress";
import Redis from "ioredis";

import { BAD_REQUEST, NOT_FOUND, OK, SERVICE_UNAVAILABLE, UNAUTHORIZED } from "./constants/statusCodes.js";
import { Sequelize } from "sequelize";
import appConfig from "../apps/auth-service/app.config.js";
import { redisConfig } from "../apps/auth-service/redis.config.js";
import { mailSender } from "./functions/mailSender.js";
import { passportAuthInitializer } from "./config/passportAuthInitializer.js";
import { logger } from "./utils/logger.js";
import { sequelizeInstances } from "./config/db.config.js";
import { expressMiddleware } from "./middlewares/index.js";
import { authenticateEncryptedToken } from "./utils/index.js";
import Router from "@koa/router";
import { RouterExtendedDefaultContext } from "./middlewares/router.js";

const envs = process.env;
const projectRoot = process.cwd();
const dynamicallyServeFilesInDirectory = appConfig?.files?.["dynamicallyServeFilesInDirectory"] as string | string[] | string[][];
const filesDirectory =
	dynamicallyServeFilesInDirectory && dynamicallyServeFilesInDirectory.length
		? Array.isArray(dynamicallyServeFilesInDirectory)
			? // if array in array
				Array.isArray(dynamicallyServeFilesInDirectory[0])
				? (dynamicallyServeFilesInDirectory as string[][]).map((arr) =>
						nodePath.join(...(["/", "\\"].includes(arr[0]) ? arr : ["/", ...arr])),
					)
				: nodePath.join(
						...(["/", "\\"].includes((dynamicallyServeFilesInDirectory as string[])[0])
							? (dynamicallyServeFilesInDirectory as string[])
							: ["/", ...(dynamicallyServeFilesInDirectory as string[])]),
					)
			: typeof dynamicallyServeFilesInDirectory === "string"
				? dynamicallyServeFilesInDirectory.startsWith("/") || dynamicallyServeFilesInDirectory.startsWith("\\")
					? dynamicallyServeFilesInDirectory
					: nodePath.join("/", dynamicallyServeFilesInDirectory)
				: dynamicallyServeFilesInDirectory
		: nodePath.join("/site/files/");

// app auth init
(async () => await passportAuthInitializer(passport))();

/* Redis logic for initialization */
const redisConnect = redisConfig();
const isRedis = async (): Promise<Redis | null> =>
	await new Promise((resolve, reject) => {
		logger.info("Redis server info: " + JSON.stringify(redisConnect));
		if (redisConnect) {
			if (typeof redisConnect === "string") return reject(new Error(redisConnect));
			let two000Count = 0; // retry tracker - shut down redis if this persistently fails to connect at start up
			const redis = new Redis({
				...redisConnect,
				retryStrategy(times) {
					const delay = Math.min(times * 50, 2000);
					logger.info("Redis retry delay: " + delay);
					if (delay === 2000) two000Count++;
					// return two000Count > 3 || envs.NODE_ENV !== "production" ? null : delay;
					return delay;
				},
				// lazyConnect: true,
			})
				.on("error", (err) => {
					logger.error("Redis client init Error: ", err);
					const quitCheck = two000Count > 3 || envs.NODE_ENV !== "production";
					if (quitCheck) {
						logger.warn("Unable to initiate a successful connect to a redis server and has been halted!");
						// send admin email for follow-up
						mailSender({
							ignoreDevReceiverRewriteToSender: true,
							// serverConfig: serverConfig,
							receiver: [envs.MAIL_SERVER_SUPPORT_AUTH_MAIL || "", envs.MAIL_SERVER_AUTH_MAIL || "", "akin@mellywood.com"],
							// sender: defaultSupportEmail,
							subject: "Redis server issues",
							content: `Unable to connect Redis server and ${appConfig.sitename} might be having production issues at the moment!!`,
							log: true,
						});
						redis.quit();
						resolve(null);
					} else logger.info("Attempting redis re-connection...");
					//console.log("err['code']", err["code"], "= ECONNREFUSED");
				})
				.on("reconnecting", () => {
					logger.info("Redis client reconnecting...");
				})
				.on("ready", () => {
					logger.info("Redis client connected... 😊");
					console.log("Redis client connected... 😊");
					two000Count = 0; // reset retry tracker
					resolve(redis);
				});
			return redis;
		}
		logger.warn(
			"No Redis server configured! Starting up platform without any optimised caching system, and simply using in-memory caching",
		);
		resolve(null);
	});

const __dirname = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
const resolve = (p: string) => nodePath.resolve(__dirname, p);

// Cache
const cacheConfig = {
	max: 3000,
	maxSize: 10000,
	maxEntrySize: 1000,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	sizeCalculation: (value: string, key: string) => {
		return value && value.length ? value.length : 1;
	},
	ttl: 1000 * 60 * 60 * 3,
	updateAgeOnGet: false,
};
const InMemoryCache = new LRUCache(appConfig.cache ? { ...cacheConfig, ...appConfig.cache } : cacheConfig);
export { InMemoryCache };
export const redis = await isRedis();

// The App
interface extendedKoaDefaultContext extends Koa.DefaultContext {
	sequelizeInstance: Sequelize;
}
const app: Koa<Koa.DefaultState, extendedKoaDefaultContext> = new Koa({ asyncLocalStorage: true });
/* 
	Let handle db tenancy.
	-- Single instance mod is automatically set at app startup and do not need in-flight setting.
	-- Where multi-tenancy is enabled/required, we for match request to appropriate db by checking for either bearer token prefix of tenant with underscore or subdomain specific if such exists.
 */
app.context.sequelizeInstances = sequelizeInstances; // inject all DB instances here
// where a single db exist, set it here as well
if (sequelizeInstances && Object.keys(sequelizeInstances).length === 1) {
	// this efectively rules out the need to check for tenancy as false or as a single dbMod
	const dbKey = Object.keys(sequelizeInstances)[0];
	app.context.sequelizeInstance = sequelizeInstances[dbKey];
	app.context.tenantMode = dbKey;
}
export const appInstance = app; // the current context of the app, which is used to access the app's context in other modules

// init
const init = async ({
	cronJobs,
	appRoutes,
	cors,
	sessionConfig,
	env = process.env.NODE_ENV,
}: {
	cronJobs?: () => Promise<void>;
	appRoutes: Router<DefaultState, RouterExtendedDefaultContext>;
	cors?: { origin: (string | { host: string; csp: string })[]; allowedMethods?: string; exposeHeaders?: string; allowHeaaders?: "" };
	sessionConfig?: {
		key: string;
		maxAge: number;
		autoCommit: boolean;
		overwrite: boolean;
		httpOnly: boolean;
		signed: boolean;
		rolling: boolean;
		renew: boolean;
		secure: boolean; //change to true in production
		sameSite: boolean | "strict" | "lax" | "none" | undefined;
		domain?: string;
	};
	env?: string;
}) => {
	// cron job scheduler
	if (cronJobs) cronJobs();

	// imported env variables
	const PORT = process.env.PORT;
	const localUrl = env === "development" ? (process.env.localUrl ? process.env.localUrl : "http://localhost") : undefined;

	// cors Options
	const appCors: Options = { origin: undefined };
	let corProps: {
		origin:
			| string
			| (
					| string
					| {
							host: string;
							csp: string;
					  }
			  )[];
		allowedMethods?: string;
		exposeHeaders?: string;
		allowHeaaders?: "";
	} = { origin: [] };
	if (cors) corProps = cors;
	const corsWhiteListedOrigin:
		| string
		| (
				| string
				| {
						host: string;
						csp: string;
				  }
		  )[]
		| undefined = corProps && corProps.origin && corProps.origin.length ? corProps.origin : undefined;

	let corOrigins: (
		| string
		| {
				host: string;
				csp: string;
		  }
	)[] = [];
	if (!corsWhiteListedOrigin && env === "development") {
		corOrigins = [`${localUrl}:${PORT}`];
	} else if (corsWhiteListedOrigin) {
		if (typeof corsWhiteListedOrigin === "string") {
			corOrigins = env === "development" ? [corsWhiteListedOrigin, `${localUrl}:${PORT}`] : [corsWhiteListedOrigin];
		} else {
			corOrigins = corsWhiteListedOrigin;
			if (env === "development") {
				corOrigins.push(`${localUrl}:${PORT}`);
			}
		}
	}
	// lets set the origin function in cors
	if (corOrigins.length) {
		appCors.origin = (ctx: Koa.ParameterizedContext) => {
			// Cors origin is allowed to be imported as either a string or an objects with a host and CSP directive. When as object, the origin is set on host.
			const stringifyPossibleObjectOrigin: string[] = [];
			corOrigins.forEach((origin: string | { host: string }) => {
				if (typeof origin === "string") stringifyPossibleObjectOrigin.push(origin);
				else if (typeof origin === "object" && origin.host) stringifyPossibleObjectOrigin.push(origin.host);
			});
			// where ctx.get("origin") is undefined as would be on request made from self hosted frontend, set origin to site address
			const requestOrigin = ctx.get("origin") ? ctx.get("origin") : appConfig.sitename;
			if (requestOrigin && stringifyPossibleObjectOrigin.indexOf(requestOrigin) !== -1) {
				return requestOrigin;
			}
			return undefined as unknown as string;
		};
		appCors.keepHeadersOnError = true;
	} else throw new Error("Configure the server cors to start up");

	// Quickly run & test an email server setup test if ignoreMailServer' is not set on config
	if (!appConfig.ignoreMailServer) {
		let sitename = appConfig.sitename;
		// sanitize website address
		if (sitename) {
			sitename = sitename.includes("//") ? sitename.split("//")[1] : sitename;
			sitename = sitename.includes("www") ? sitename.split("www.")[1] : sitename;
			await mailSender({
				testServer: true,
				sender: process.env.MAIL_SERVER_AUTH_MAIL
					? process.env.MAIL_SERVER_AUTH_MAIL.includes("@")
						? process.env.MAIL_SERVER_AUTH_MAIL.split("@")[0] + "@" + sitename
						: process.env.MAIL_SERVER_AUTH_MAIL + "@" + sitename
					: undefined,
			});
		}
	}

	// session
	app.keys = process.env.COOKIE_KEYS ? JSON.parse(process.env.COOKIE_KEYS) : null;
	let appSessionConfig = {
		key: process.env.COOKIE_IDENTIFIER,
		maxAge: 7 * 24 * 60 * 60 * 1000, // 3days
		autoCommit: true,
		overwrite: true,
		httpOnly: true,
		signed: true,
		rolling: false,
		renew: false,
		secure: false, //change to true in production
		sameSite: "strict" as const,
	};
	if (sessionConfig) {
		// strip undefined values to ensure no unintentional overwrite
		Object.keys(sessionConfig).forEach((key) => {
			if (sessionConfig[key as keyof typeof sessionConfig] === undefined) delete sessionConfig[key as keyof typeof sessionConfig];
		});
		appSessionConfig = { ...appSessionConfig, ...sessionConfig } as typeof appSessionConfig;
	}
	// ensure site address exist in cookie
	if (!appSessionConfig["domain" as keyof typeof appSessionConfig] && appConfig.sitename)
		appSessionConfig["domain" as "key"] = appConfig.sitename.includes("://") ? appConfig.sitename.split("://")[1] : appConfig.sitename;
	//console.log('appSessionConfig ', appSessionConfig)

	// Create and refresh nonce for external scripts
	// Request from FE @ '/nonce'
	app.use(async (ctx, next) => {
		if (ctx.cookies) {
			ctx.state.nonce = ctx.cookies.get("--nonce--");
			if (ctx.state.nonce) {
				ctx.cookies.set("--nonce--", null, {
					signed: true,
					expires: new Date(),
					sameSite: "strict",
				});
			} else {
				if (!ctx.state.nonce) {
					const loadedScriptsNonce = crypto.randomBytes(16).toString("base64");
					ctx.cookies.set("--nonce--", loadedScriptsNonce, {
						signed: true,
						sameSite: "strict",
					});
					ctx.state.nonce = loadedScriptsNonce;
				}
			}
			if (ctx.path === "/nonce") {
				ctx.status = OK;
				ctx.message = "Successfull";
				return;
			}
			// nonce output
			const nonce = ctx.state.nonce ? `'nonce-${ctx.state.nonce}'` : undefined;

			// Set res.locals for use in helmet, with care not overwrite any pre-existing data
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			//@ts-ignore
			ctx.res.locals = {
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				//@ts-ignore
				...ctx.res.locals,
				nonce: nonce,
				csp: undefined,
				//host: ctx.get("origin"),
			};
			// check if CSP on helmet has been explicitly turned off, to all 3rd party script.
			// Internally, using 'unsafe-inline' rather than completely turning off CSP.
			if (corOrigins.length)
				corOrigins.forEach((origin: string | { csp: string | boolean; host: string }) => {
					if (typeof origin === "object") {
						if (
							(origin.csp || typeof origin.csp === "boolean") &&
							origin.host &&
							origin.host.length &&
							(ctx.get("origin") === origin.host ||
								// where ctx.get("origin") might be empty on request made directly from the server
								(!ctx.get("origin") && appConfig.sitename === origin.host))
						)
							if (origin.csp !== true) {
								// Ignore if CSP is true and use default App CSP settings
								// Else stringify boolean for comparision usage later.
								const csp = typeof origin.csp === "boolean" ? "false" : origin.csp;

								let output = csp && csp !== "false" ? csp : "'self'";
								//only insert nonce if we are not explicit about "unsafe-inline" in cors excluded scripts
								if (nonce) {
									if (!output.includes("unsafe-inline")) output = `${nonce} ${output}`;
									else if (!output) output = nonce;
								}
								// ensure  "'self'" is available
								if (!output.includes("'self'")) output = `'self' ${output}`;
								// eslint-disable-next-line @typescript-eslint/ban-ts-comment
								//@ts-ignore
								ctx.res.locals.csp = output;
							} else {
								let output = "'self'";
								if (nonce) {
									if (!output.includes("unsafe-inline")) output = `${nonce} ${output}`;
									else if (!output) output = nonce;
								}
								// eslint-disable-next-line @typescript-eslint/ban-ts-comment
								//@ts-ignore
								ctx.res.locals.csp = output;
							}
					} else if (
						typeof origin === "string" &&
						origin.length &&
						(ctx.get("origin") === (origin as string) ||
							// where ctx.get("origin") might be empty on request made directly from frontend hosted on server itself
							(!ctx.get("origin") && appConfig.sitename === origin))
					) {
						let output = "'self'";
						if (nonce) output = `${nonce} ${output}`;
						// eslint-disable-next-line @typescript-eslint/ban-ts-comment
						//@ts-ignore
						ctx.res.locals.csp = output;
					}
				});
		}
		// console.log("appConfig.sitename", appConfig.sitename);
		// console.log("ctx.get('origin')", ctx.get("origin"));
		// console.log("ctx.res.locals", ctx.res.locals);

		await next();
	});

	if (env !== "development") {
		if (env === "production") app.proxy = true;
		// Helmet security implementations
		app.use(
			expressMiddleware(
				helmet({
					contentSecurityPolicy: {
						//useDefaults: false,
						directives: {
							scriptSrc: [
								//"'self'",
								//"'unsafe-inline'",
								(req, res) => {
									// eslint-disable-next-line @typescript-eslint/ban-ts-comment
									//@ts-ignore
									return res.locals.csp ? res.locals.csp : "'self'";
								},
							],
							styleSrc: [
								(req, res) => {
									// eslint-disable-next-line @typescript-eslint/ban-ts-comment
									//@ts-ignore
									return res.locals.csp ? res.locals.csp : "'self'";
								},
							],
							defaultSrc: [
								(req, res) => {
									// eslint-disable-next-line @typescript-eslint/ban-ts-comment
									//@ts-ignore
									return res.locals.csp ? res.locals.csp : "'self'";
								},
							],
							//connectSrc: ["'self'", (req, res) => "ws://" + req.headers.host],
							objectSrc: "'self'",
							imgSrc: ["'self'", "https: data:", "https: blob:"],
							upgradeInsecureRequests: env === "production" ? [] : null,
						},
					},
					hsts: env === "production" ? true : false,
					originAgentCluster: false,
					crossOriginOpenerPolicy: env === "production" ? { policy: "same-origin-allow-popups" } : false,
					crossOriginEmbedderPolicy: false,
					crossOriginResourcePolicy: { policy: "cross-origin" },
				}),
			),
		);
	}

	app
		.use(koaCors(appCors))
		.use(
			//caching mechanism
			koaCash({
				compression: true,
				get: async (key) => {
					return redis ? await redis.get(key) : InMemoryCache.get(key);
				},
				set: async (key, value) => {
					redis ? await redis.set(key, value as string, "EX", appSessionConfig.maxAge) : InMemoryCache.set(key, value as string);
				},
			}),
		)
		.use(session(appSessionConfig, app))
		.use(async (ctx, next) => {
			// inject appropriate DB for request, taking cue from the subdomain as app is designed against subdomains. When none exist, test is assumed if present
			if (!ctx.tenantMode && ctx.sequelizeInstances) {
				// tenantMode can be set in either authorization API prefix or a subdomain in inbound requests
				if (appConfig.apiMultiTenancyMode === true || (appConfig.apiMultiTenancyMode as string[])) {
					// true will default to values: live && test
					const authorization = ctx.get("authorization")?.split(" ")[1];
					const authorizationPrefix = authorization?.includes("_") && authorization.split("_")[0];
					ctx.tenantMode =
						(authorizationPrefix && ctx.sequelizeInstances[authorizationPrefix] && authorizationPrefix) ||
						(ctx.subdomains?.length && ctx.sequelizeInstances[ctx.subdomains[0]] && ctx.subdomains[0]);
					if (ctx.tenantMode) ctx.sequelizeInstance = ctx.sequelizeInstances[ctx.tenantMode];
					else if (ctx.sequelizeInstances["test"]) {
						ctx.tenantMode = "test";
						ctx.sequelizeInstance = ctx.sequelizeInstances["test"];
					} else ctx.tenantMode = undefined;
				}
			}
			// console.log("check for active dbs:: ", ctx.sequelizeInstances);
			await next();
		})
		.use(passport.initialize())
		.use(passport.session())
		.use(async (ctx, next) => {
			// process authentication where session isn't available
			if (appConfig.appMode !== "serverless" && ctx.isUnauthenticated()) await authenticateEncryptedToken(ctx);

			await next();
		})
		.use(async (ctx, next) => {
			try {
				// enforce authorization check for auth-based files if exists in file path
				if (
					((ctx.path.toLowerCase().includes("site/") && ctx.path.toLowerCase().includes("/auth/")) ||
						ctx.path.toLowerCase().includes("files/auth")) &&
					ctx.isUnauthenticated()
				) {
					ctx.status = UNAUTHORIZED;
					return (ctx.body = {
						status: UNAUTHORIZED,
						statusText: "Unauthorised access",
					});
				}
				//await next();
			} catch (err: unknown) {
				logger.error("App base logger: ", err);
				ctx.status =
					((err && err["statusCode" as keyof typeof err]) as number) || ((err && err["status" as keyof typeof err]) as number) || 500;

				if (err && err["expose" as keyof typeof err] && err["message" as keyof typeof err]) {
					ctx.message = err["message" as keyof typeof err];
					return;
				} else if (ctx.state.error) {
					ctx.status = ctx.state.error.code;
					ctx.message = ctx.state.error.message;
					return;
				}
				return (ctx.body = {
					status: ctx.status,
					statusText: err && err["statusText" as keyof typeof err] ? err["statusText" as keyof typeof err] : undefined,
				});
			}
			await next();
		})
		.use(
			//Response compression
			compress({
				filter(content_type) {
					return /text/i.test(content_type);
				},
				threshold: 2048,
				gzip: {
					flush: (await import("zlib")).constants.Z_SYNC_FLUSH,
				},
				deflate: {
					flush: (await import("zlib")).constants.Z_SYNC_FLUSH,
				},
				br: false, // disable brotli
			}),
		);

	//import KOA session into SOCKET.IO if available
	app.use(async (ctx, next) => {
		//console.log('GREYBOX -=> ctx.ioSocket', ctx.ioSocket)
		if (ctx.ioSocket && ctx.session) ctx.ioSocket.session = ctx.session;
		await next();
	});

	app.use(async (ctx, next) => {
		console.log("app path: ", ctx.path);
		//console.log("ctx.url", ctx.url);
		await next();
	});

	// lets handle miscellaneous here that tends to occur in dev mode
	if (env === "development") {
		app.use(async (ctx, next) => {
			// devTools from reactJS calls '/installHook.js.map' or similar files which produces unnecessary logs in develop. let end that call here
			if (ctx.url.includes(".js.map") || ctx.url === "/index.css") return;
			await next();
		});
	}
	/* -- Router step 1 --
    Router here handles direct API
    endpoints with a valid header "x-request-referral" which is usually sent in ClientServerHandler or ServerHandler and verifiable as owned by server.
    Else routerEntry.routes() will not validates
    and allows the Request to continue downwards.
  */
	app.use(appRoutes.routes());

	app.use(async (ctx, next) => {
		// console.log("path", ctx.path);
		// console.log("filesDirectory", filesDirectory);
		// process files serving
		const serveFile =
			(typeof filesDirectory === "string" && ctx.path.startsWith(filesDirectory)) ||
			(Array.isArray(filesDirectory) && filesDirectory.filter((file) => ctx.path.startsWith(file)).length ? true : false);

		if (serveFile) {
			// Note 'auth'-based path would have been checked for authurization earlier on line 562
			if (!ctx.path.includes("/videos/")) {
				//serveFiles(resolve("../../site/files"));
				await serveFiles(resolve(nodePath.join(process.cwd())))(ctx, next);
			} else {
				//console.log("range", ctx.headers.range);
				const { range } = ctx.headers;
				if (!range) {
					logger.info("Unable to play video media file because range was not provided. Media is: ", ctx.path);
					ctx.throw(BAD_REQUEST, "Unable to play a video media file");
				}
				// Check video file
				const videoPath = resolve(nodePath.join(process.cwd(), ctx.path));
				//check file existence
				try {
					fs.accessSync(videoPath);
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
				} catch (err: unknown) {
					logger.info(ctx.path + " video file not found");
					ctx.throw(NOT_FOUND, "Media file not found");
				}

				// Calculate start Content-Range
				const parts = range && range.replace("bytes=", "").split("-");
				const rangeStart = parts && parts[0] && parts[0].trim();
				const start = rangeStart ? Number.parseInt(rangeStart, 10) : 0;

				// Calculate video size and chunk size
				const videoStat = fs.statSync(videoPath);
				const videoSize = videoStat.size;
				const chunkSize = 10 ** 6; // 1mb

				// Calculate end Content-Range
				//
				// Safari/iOS first sends a request with bytes=0-1 range HTTP header
				// probably to find out if the server supports byte ranges
				//
				const rangeEnd = parts && parts[1] && parts[1].trim();
				const __rangeEnd = rangeEnd ? Number.parseInt(rangeEnd, 10) : undefined;
				const end = __rangeEnd === 1 ? __rangeEnd : Math.min(start + chunkSize, videoSize) - 1; // We remove
				// 1 byte because start and end start from 0
				const contentLength = end - start + 1; // We add 1 byte because start and end start from 0

				// Set HTTP response headers
				ctx.response.set("Content-Range", `bytes ${start}-${end}/${videoSize}`);
				ctx.response.set("Accept-Ranges", "bytes");
				ctx.response.set("Content-Length", contentLength.toString());

				// Send video file stream from start to end
				const stream = fs.createReadStream(videoPath, { start, end });
				stream.on("error", (err) => {
					logger.error("Video streaming err: ", err);
					ctx.status = SERVICE_UNAVAILABLE;
					ctx.body = "Currently unable to play video";
					return;
				});

				ctx.response.status = 206;
				ctx.response.type = nodePath.extname(ctx.url);
				ctx.response.body = stream;
				return;
			}
		} else await next();
	});

	// if we get here, end it all
	app.use(async (ctx) => {
		ctx.status = 202;
		ctx.type = ".html";
		// end request
		return (ctx.body =
			appConfig.appMode !== "apiOnly"
				? "Endpoint is not found"
				: `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <title>Powered by Greybox.</title>
            </head>
            <body>
              <div>
              Hey! Don't be lost. Check the endpoint or [Method] and try again!!!
              </div>
            </body>
          </html>
      `);
	});

	app.on("error", (err, ctx) => {
		if (
			!ctx.path.includes("/videos/") ||
			(ctx.path.includes("/videos/") && !["ECONNRESET", "ECANCELED", "ECONNABORTED"].includes(err.code))
			//allows to ignore video streaming error on server side when browser closes connection
		) {
			logger.error("APP onError: ", err);
		}

		if (err && err.expose && err.message) {
			ctx.status = (err && err.statusCode) || (err && err.status) || 500;
			ctx.message = err.message;
			return;
		} else if (ctx.state.error) {
			ctx.status = ctx.state.error.code;
			ctx.message = ctx.state.error.message;
			return;
		}
		return;
	});

	//import websocket status setting
	function WebSocket() {
		const envSetting = process.env.SOCKET_IO || process.env.SOCKET || process.env.WEBSOCKET;
		const caseInsensitive = envSetting && envSetting.toLowerCase();
		if (caseInsensitive)
			try {
				const parsedSocketSetting = JSON.parse(caseInsensitive);
				if (Array.isArray(parsedSocketSetting)) return parsedSocketSetting;
				else return null;
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
			} catch (e) {
				if (caseInsensitive === "http" || caseInsensitive === "https") return caseInsensitive;
				else return null;
			}
		return null;
	}
	const webSocket = WebSocket();

	if (PORT) {
		//app.listen(!isNaN(Number(PORT)) ? PORT : 5173);
		const server1 = http.createServer(app.callback());
		//turn on websocket if its enable in process env variable on ordinary HTTP
		let socketStart: boolean;
		if (webSocket && webSocket.includes("http")) {
			const io = new Server(server1, {
				cors: {
					origin: corOrigins.length
						? corOrigins.map((origin) => (typeof origin === "object" ? origin.host : origin))
						: [appConfig.sitename || ""],
					// credentials: true,
					methods: appConfig.methods?.map((meth) => meth.toUpperCase()),
					// allowedHeaders: ["Content-Type", "Authorization"],
					// exposedHeaders: ["Content-Range", "X-Content-Range"],
					// maxAge: 1000 * 60 * 60 * 24,
					// preflightContinue: true,
					optionsSuccessStatus: 200,
				},
			});
			//expose socket.io to ctx process
			app.context.io = io;
			io.on("connection", (socket: Socket) => {
				// console.log("socket.handshake: ", socket.handshake);
				if (appConfig.appMode !== "serverless") {
					if (app.context.tenantMode) {
						socket.handshake.auth["sequelizeInstance"] = app.context.sequelizeInstance;
						socket.handshake.auth["tenantMode"] = app.context.tenantMode;
					} else if (app.context.sequelizeInstances) {
						// tenantMode can be set in either authorization API prefix or a subdomain in inbound requests
						if (appConfig.apiMultiTenancyMode === true || (appConfig.apiMultiTenancyMode as string[])) {
							// true will default to values: live && test
							const authorization = socket.handshake.auth.token || socket.handshake.auth.authorization;
							const authorizationPrefix = authorization?.includes("_") && authorization.split("_")[0];

							socket.handshake.auth["tenantMode"] =
								authorizationPrefix && app.context.sequelizeInstances[authorizationPrefix] && authorizationPrefix;
							// where tenant extraction is not possible on authorization prefix, try the url subdomain
							if (!socket.handshake.auth["tenantMode"]) {
								const url = socket.handshake.headers["host"];
								if (url && url.includes(".")) {
									const domainArraySplit = (url.includes("://") ? url.split("://")[0] : url).split(".");
									const subdomains = domainArraySplit.filter(
										(str, i) => i + 1 !== domainArraySplit.length && 1 !== domainArraySplit.length - 1,
									);
									socket.handshake.auth["tenantMode"] = subdomains.length && app.context.sequelizeInstances[subdomains[0]] && subdomains[0];
								}
							}
							if (socket.handshake.auth["tenantMode"])
								socket.handshake.auth["sequelizeInstance"] = app.context.sequelizeInstances[socket.handshake.auth["tenantMode"]];
							else if (app.context.sequelizeInstances["test"]) {
								socket.handshake.auth["tenantMode"] = "test";
								socket.handshake.auth["sequelizeInstance"] = app.context.sequelizeInstances["test"];
							} else socket.handshake.auth["tenantMode"] = undefined;
						}
					}
				}
				app.context.ioSocket = socket;
			});

			// console.log('socketEvents', socketEvents)
			// console.log('ioEvents', ioEvents)
			socketStart = true;
		}
		const thisServerPort = !isNaN(Number(PORT)) ? PORT : 5173;
		server1.listen(thisServerPort, () => {
			console.info(env?.toUpperCase() + " server environment!!");
			console.info(
				"Server started on: " +
					thisServerPort +
					(Object.keys(sequelizeInstances).length > 1
						? `, in multiple tenancy mode on ${Object.keys(sequelizeInstances)
								.map((env, i) => env + (i + 1 < Object.keys(sequelizeInstances).length ? ", " : ""))
								.join()}`
						: Object.keys(sequelizeInstances).length
							? " as single tenancy LIVE mode"
							: " without API tenancy") +
					" | " +
					new Date(Date.now()),
			);
			if (socketStart) console.log("Websocket started with Server");
		});
	}

	//INIT SSL SERVER
	if (process.env.SSL_ENABLE && process.env.SSL_ENABLE.toLowerCase() === "true") {
		const key = process.env.SSL_KEY;
		const cert = process.env.SSL_CERTIFICATE;

		const sslConfig = {
			key: key ? fs.readFileSync(key, "utf8").toString() : "",
			cert: cert ? fs.readFileSync(cert, "utf8").toString() : "",
		};
		if (sslConfig.key && sslConfig.cert) {
			const server2 = https.createServer(sslConfig, app.callback());
			//turn on websocket if its enable in process env variable on SSL
			let socketStart: boolean;
			if (webSocket && webSocket.includes("https")) {
				const io = new Server(server2, {
					cors: {
						origin: corOrigins.length
							? corOrigins.map((origin) => (typeof origin === "object" ? origin.host : origin))
							: [appConfig.sitename || ""],
						// credentials: true,
						methods: appConfig.methods?.map((meth) => meth.toUpperCase()),
						optionsSuccessStatus: 200,
					},
				});
				//expose socket.io to ctx process
				app.context.io = io;
				io.on("connection", (socket: Socket) => {
					if (appConfig.appMode !== "serverless") {
						if (app.context.tenantMode) {
							socket.handshake.auth["sequelizeInstance"] = app.context.sequelizeInstance;
							socket.handshake.auth["tenantMode"] = app.context.tenantMode;
						} else if (app.context.sequelizeInstances) {
							// tenantMode can be set in either authorization API prefix or a subdomain in inbound requests
							if (appConfig.apiMultiTenancyMode === true || (appConfig.apiMultiTenancyMode as string[])) {
								// true will default to values: live && test
								const authorization = socket.handshake.auth.token || socket.handshake.auth.authorization;
								const authorizationPrefix = authorization?.includes("_") && authorization.split("_")[0];

								socket.handshake.auth["tenantMode"] =
									authorizationPrefix && app.context.sequelizeInstances[authorizationPrefix] && authorizationPrefix;
								// where tenant extraction is not possible on authorization prefix, try the url subdomain
								if (!socket.handshake.auth["tenantMode"]) {
									const url = socket.handshake.headers["host"];
									if (url && url.includes(".")) {
										const domainArraySplit = (url.includes("://") ? url.split("://")[0] : url).split(".");
										const subdomains = domainArraySplit.filter(
											(str, i) => i + 1 !== domainArraySplit.length && 1 !== domainArraySplit.length - 1,
										);
										socket.handshake.auth["tenantMode"] =
											subdomains.length && app.context.sequelizeInstances[subdomains[0]] && subdomains[0];
									}
								}
								if (socket.handshake.auth["tenantMode"])
									socket.handshake.auth["sequelizeInstance"] = app.context.sequelizeInstances[socket.handshake.auth["tenantMode"]];
								else if (app.context.sequelizeInstances["test"]) {
									socket.handshake.auth["tenantMode"] = "test";
									socket.handshake.auth["sequelizeInstance"] = app.context.sequelizeInstances["test"];
								} else socket.handshake.auth["tenantMode"] = undefined;
							}
						}
					}
					app.context.ioSocket = socket;
				});
				socketStart = true;
			}
			const thisServerPort = !isNaN(Number(process.env.SSL_PORT)) ? process.env.SSL_PORT : 5174;
			server2.listen(thisServerPort, () => {
				console.info("Server (SSL) started on: " + thisServerPort + " | " + new Date(Date.now()));
				if (socketStart) console.log("Websocket started with Server (SSL)");
			});
		}
	}
};
export { init };
