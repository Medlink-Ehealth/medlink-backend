import Joi, { ObjectSchema } from "joi";
import { Next } from "koa";
import { validatorHandler, phoneNumberValidator, throwError, AppContext } from "@medlink/common";

const signin = async (ctx: AppContext, next: Next) => {
	if (!ctx.request.body.email && !ctx.request.body.phoneNumber) throwError(406, "Either email or phone number must be provided to sign in");

	// validate phone number if it exists in the request body
	if (ctx.request.body.phoneNumber) await phoneNumberValidator(ctx);

	let schema: ObjectSchema<unknown>;
	const check2FAroute = ctx.path.includes("/sign-in/2fa") ? true : false;
	if (check2FAroute)
		schema = Joi.object().keys({
			passcode: Joi.string().trim().required(),
			token: Joi.string().trim().required(),
			rememberMe: Joi.any().allow(null, Joi.string().trim().allow(""), Joi.number()), // accesstoken lifetime
		});
	else
		schema = Joi.object().keys({
			email: Joi.string().trim().email(),
			phoneNumber: Joi.any().allow(null, Joi.string().trim().allow(""), Joi.number()), // placeholder
			password: Joi.string().trim().required(),
			rememberMe: Joi.any().allow(null, Joi.string().trim().allow(""), Joi.number()), // accesstoken lifetime
		});
	await validatorHandler(ctx, next, schema);
};

// reset forgotten password
const resetPassword = async (ctx: AppContext, next: Next) => {
	if (!ctx.request.body.email && !ctx.request.body.phoneNumber)
		throwError(406, "Either email or phone number must be provided to reset password");

	// validate phone number if it exists in the request body
	if (ctx.request.body.phoneNumber) await phoneNumberValidator(ctx);

	const schema = Joi.object().keys({
		email: Joi.string().trim().email(),
		phoneNumber: Joi.any().allow(null, Joi.string().trim().allow(""), Joi.number()), // placeholder
	});
	await validatorHandler(ctx, next, schema);
};

export const userCombosFormValidator = { signin, resetPassword };
