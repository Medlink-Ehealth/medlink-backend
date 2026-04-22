import { KoaBodyMiddlewareOptions, koaBody } from "koa-body";
import { media } from "../config/koabody.config.js";
import { logger } from "../utils/logger.js";
import { statusCodes } from "../constants/index.js";
import compose from "koa-compose";
import { ParameterizedContext, Next, DefaultState, DefaultContext } from "koa";
import { RouterExtendedDefaultContext } from "./router.js";
/*
	mediaType defines the kind/type of media available in koabody.config.js
	mediaType options: image|video|boolean|undefined
	when mediaType is boolean 'true', media type is taken as image excpet explicitly defined as a media string type
 */
interface Options extends Partial<KoaBodyMiddlewareOptions> {
	processMedia?: "image" | "video" | ("image" | "video")[];
}
type JsonValue = string | number | boolean | null | undefined | JsonObject | JsonArray;
type JsonObject = {
	[key: string]: JsonValue;
};
type JsonArray = Array<JsonValue>;

export const requestParser = (options?: Options) =>
	compose([
		async (ctx: RouterExtendedDefaultContext, next: Next) => {
			if (ctx.method.toLowerCase() === "post" || ctx.method.toLowerCase() === "patch") {
				// lets extract processMedia if present since this is not available on formidable and only custom extends
				const parserOptions = options && { ...options };
				const processMedia = parserOptions && parserOptions.processMedia;
				if (processMedia) delete parserOptions["processMedia"];

				const thisMedia =
					processMedia ||
					// for backward compatibility with earlier implementation
					(ctx.state.mediaType
						? typeof ctx.state.mediaType === "boolean"
							? "image"
							: (ctx.state.mediaType.toLowerCase() as "image" | "video")
						: undefined);

				const koaBodyOptions = parserOptions ? { ...media(thisMedia), ...parserOptions } : media(thisMedia);

				const requestBody = async () => {
					if (koaBodyOptions) return await koaBody(koaBodyOptions)(ctx as any, next);
					else return await koaBody()(ctx as any, next);
				};
				try {
					//catch, halt and process koaBody Error
					await requestBody();
				} catch (err) {
					//log unrecognisable error that may have been returned downstream
					//console.log("hhhh", err);
					if (!ctx.state.error) logger.error("koaBody requestParser middleware Err: ", err);
					//output error to APP
					const caughtCode = (err as object)["status" as keyof typeof err];
					const caughtMessage = (err as object)["body" as keyof typeof err] || (err as object)["message" as keyof typeof err];
					// lets filter out error object that might expose password from the error message if available on object in cases of formatting errors
					ctx.status = ctx.state.error && ctx.state.error.code ? ctx.state.error.code : caughtCode ? caughtCode : statusCodes.SERVER_ERROR;
					ctx.message =
						ctx.state.error && ctx.state.error.message
							? ctx.state.error.message
							: caughtMessage
								? caughtCode === 400
									? "Likely formatting error" +
										(caughtMessage && JSON.stringify(caughtMessage).includes("password")
											? ", perhaps check for extra commas or quotes in the request body"
											: " " + JSON.stringify(caughtMessage))
									: caughtMessage || "An error occurred while processing your request"
								: caughtMessage || "An error occurred while processing your request";
					return;
				}
			} else await next();
		},
		async (ctx: RouterExtendedDefaultContext, next) => {
			// console.log("ctx.request.body parser", ctx.request.body);
			if (ctx.request?.body && Object.keys(ctx.request.body).length) {
				//convert null, integer, true and false strings to typeof each variable. "FormData" imports all values as string
				const processRequestDataTypeof = (data: { [x: string]: string | null | boolean | number | undefined }) => {
					Object.keys(data).forEach((key) => {
						const keyValue = data[key];

						//console.log("keyValue: ", keyValue);
						//if (typeof keyValue === "string") {
						if (keyValue === "") data[key] = "";
						else if ((!keyValue && keyValue !== false && keyValue !== null) || (keyValue && keyValue === "undefined"))
							data[key] = undefined;
						else if (keyValue === "null") data[key] = null;
						else if (keyValue === "false" || keyValue === "true") data[key] = keyValue === "false" ? false : true;
						else if (
							typeof keyValue === "string" &&
							!keyValue.startsWith("0") &&
							// keyValue can be a phone number that should be left as is... we are excluding characters < 6 as in
							keyValue.length < 6 &&
							!keyValue.includes("-") &&
							!keyValue.includes("+") &&
							!keyValue.includes(".") &&
							Number.isFinite((keyValue as unknown as number) * 1)
						) {
							//Do numbers but ignore those with logical expression like +, - or begins with '0'
							data[key] = Number(keyValue);
						} else if (
							typeof keyValue === "string" &&
							// keyValue can be a phone number that should be left as is... we are leaving characters < 6 as in
							keyValue.length >= 6
						) {
							data[key] = keyValue;
						} else {
							if (typeof keyValue === "object") {
								if (keyValue === null) data[key] = null;
								// exclude null value which would have passed through as object
								else
									processRequestDataTypeof(
										data[key] as unknown as {
											[x: string]: string | number | boolean | null;
										},
									);
							} else {
								let newKeyValue = keyValue;
								// try checking if string is a stringified object
								if (typeof keyValue === "string")
									try {
										newKeyValue = JSON.parse(keyValue);
										// eslint-disable-next-line @typescript-eslint/no-unused-vars
									} catch (err) {
										// insist on string if an error is caught
										newKeyValue = keyValue;
									}
								if (typeof newKeyValue !== "object" || newKeyValue === null) data[key] = newKeyValue;
								else {
									//recycling entire process if object, convert the keyValue to object on the 'data' level
									data[key] = newKeyValue;
									processRequestDataTypeof(
										newKeyValue as unknown as {
											[x: string]: string | number | boolean | null;
										},
									);
								}
							}
						}
					});
					return data;
				};
				if (Array.isArray(ctx.request.body))
					ctx.request.body = ctx.request.body.map((bod) =>
						processRequestDataTypeof(bod as { [x: string]: string | number | boolean | null | undefined }),
					) as unknown as undefined;
				else
					ctx.request.body = processRequestDataTypeof(
						ctx.request.body as { [x: string]: string | number | boolean | null | undefined },
					) as unknown as undefined;
			}

			// to prevent validation error where file upload puts key on ctx.request.files without a reference on ctx.request.body, we copy the
			if (ctx.request?.files && Object.keys(ctx.request.files).length)
				for (const file of Object.keys(ctx.request.files)) {
					const files = ctx.request.files;
					const fileContent = files[file as any];
					const fileContents = Array.isArray(fileContent) ? fileContent : [fileContent];
					// file key has the potential to have been at the inner depth of an object. Let's resolve that behaviour here
					const fileKeyDepth = file
						.replace(/\[/g, ".") // replace [ with .
						.replace(/\]/g, ""); // remove ]

					const filePaths: string[] = [];
					for (const content of fileContents) {
						filePaths.push(content.newFilename);
					}
					if (fileKeyDepth.includes(".")) {
						const keyDepthArray = fileKeyDepth.split(".");
						let thisBody = (ctx.request.body || {}) as { [key: string]: unknown };
						keyDepthArray.forEach((depth, index) => {
							const isArrayContainer = !isNaN(Number(depth));
							const key = !isArrayContainer ? depth : Number(depth); // if depth is number, then we are looking at an array

							// console.log("depth", depth);
							// console.log("isArrayContainer", isArrayContainer);
							// console.log("thisBody", thisBody);
							// console.log("index + 1 < keyDepthArray.length", index + 1 < keyDepthArray.length);

							if (index + 1 < keyDepthArray.length) {
								if (!thisBody[key]) thisBody = thisBody[key] = {};
								else thisBody = thisBody[key] as { [key: string]: unknown };
							} else {
								thisBody[key] = filePaths.length <= 1 ? filePaths[0] : filePaths;
							}
						});
					} else {
						(ctx.request.body as { [key: string]: unknown })[fileKeyDepth] = filePaths.length <= 1 ? filePaths[0] : filePaths;
					}
				}
			await next();
		},
	]);
