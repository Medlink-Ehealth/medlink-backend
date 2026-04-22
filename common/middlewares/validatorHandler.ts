import sanitizeHtml from "sanitize-html";
import { NOT_ACCEPTABLE } from "../constants/statusCodes.js";
import { DefaultContext, Next, ParameterizedContext } from "koa";
import Joi from "joi";
import JoiPhoneNumberExtend from "joi-phone-number";
import { logger } from "../utils/logger.js";
import { throwError } from "../functions/throwError.js";

type JsonValue = JsonObject;
type JsonObject = {
	[key: string]: JsonValue;
};
interface extendedParameterizedContext extends ParameterizedContext {
	request: DefaultContext["request"] & {
		body?: JsonValue;
		files?: [string, File]; // [formidable.Fields<string>, formidable.Files<string>]
		rawBody?: unknown;
	};
	// sequelizeInstance: Sequelize;
}

const joiPhoneNumber = Joi.extend(JoiPhoneNumberExtend);

/* 
	JoiPhoneNumberExtend library does not seem to play well with schema.validate, hence performING separate validation for phone Number
	
	Also externalized phone number validator for reusability
 */
export const phoneNumberValidator = async (
	ctx: extendedParameterizedContext,
	next?: Next | { phoneNumber?: string; defaultCountry?: string; format?: "international" | "e164" | "national" | "RFC3966" },
	options?: { phoneNumber?: string; defaultCountry?: string; format?: "international" | "e164" | "national" | "RFC3966" }
) => {
	// since next can exist or not, we need to check if it is a function or an object
	if (typeof next !== "function") {
		options = next;
		next = undefined;
	}
	if (ctx.request.body?.phoneNumber || options?.phoneNumber) {
		const { value, error } = joiPhoneNumber
			.string()
			.phoneNumber(
				options
					? { defaultCountry: options.defaultCountry || "NG", format: options.format || "e164" }
					: { defaultCountry: "NG", format: "e164" }
			)
			.validate((ctx.request.body?.phoneNumber && ctx.request.body?.phoneNumber.toString()) || options?.phoneNumber);
		//console.log('error', error)
		if (error) {
			throwError(
				NOT_ACCEPTABLE,
				error.details[0].message.includes("string") ? "Phone number should be provided as string" : error.details[0].message
			);
		} else {
			if (ctx.request.body?.phoneNumber) {
				ctx.request.body.phoneNumber = value;
				if (next) await (next as Next)();
				else return ctx.request.body.phoneNumber;
			} else if (options?.phoneNumber) {
				if (next) {
					options.phoneNumber = value;
					await (next as Next)();
				} else return value;
			} else return value;
		}
	} else {
		if (next) await (next as Next)();
		else return ctx.request.body?.phoneNumber || options?.phoneNumber;
	}
};

//sanitizeHtmlOptions is extra sanitizing options properties available in sanitize-html
const validatorHandler = async (
	ctx: extendedParameterizedContext,
	next: Next,
	schema: Joi.ObjectSchema<unknown>,
	sanitizeHtmlOptions?: { [key: string]: string }
) => {
	try {
		const { error } = schema.validate(ctx.request.body, {
			errors: { label: "key" },
		});

		if (error) {
			ctx.status = NOT_ACCEPTABLE;
			ctx.message = error.details[0].message.replace("/[^a-zA-Z0-9 ]/g", "");
			return;
		} else {
			Object.keys(ctx.request.body).forEach((key) => {
				if (typeof ctx.request.body[key] !== "boolean" && typeof ctx.request.body[key] !== "object")
					ctx.request.body = {
						...ctx.request.body,
						[key]: sanitizeHtml(ctx.request.body[key], sanitizeHtmlOptions ? sanitizeHtmlOptions : undefined),
					};
				else if (typeof ctx.request.body[key] === "object") {
					const stringifiedRequestBodyObjectValue = sanitizeHtml(
						JSON.stringify(ctx.request.body[key]),
						sanitizeHtmlOptions ? sanitizeHtmlOptions : undefined
					);
					ctx.request.body = {
						...ctx.request.body,
						[key]: JSON.parse(stringifiedRequestBodyObjectValue),
					};
				}
			});
			if (next) return next();
			//Where next() is absent, return TRUE for successfull error-free validation
			else return true;
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (error: any) {
		logger.error("Validator error: ", error);
		// ctx.status = error.code ? error.code : NOT_ACCEPTABLE;
		// ctx.message = error.message+'. Request body is likely missing or if available, not being parsed correctly';
		return;
	}
};

export default validatorHandler;
