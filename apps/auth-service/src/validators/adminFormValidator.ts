import Joi, { ObjectSchema } from "joi";
import { joiPasswordExtendCore } from "joi-password";
import { Next } from "koa";
import { AppContext } from "../@types/utils.js";
import { validatorHandler, phoneNumberValidator, throwError } from "@medlink/common";

const joiPassword = Joi.extend(joiPasswordExtendCore);

const createAccount = async (ctx: AppContext, next: Next) => {
	// validate phone number if it exists in the request body
	if (ctx.request.body.phoneNumber) await phoneNumberValidator(ctx);

	const schema = Joi.object().keys({
		role: Joi.number().required(),
		firstName: Joi.string().trim().min(3).max(50).required(),
		lastName: Joi.any().allow(null, Joi.string().trim().allow("").max(50)),
		email: Joi.string().trim().email().required(),
		/* password: Joi.string()
      .trim()
      .pattern(new RegExp("^[a-zA-Z0-9]{6,30}$"))
      .required(), */
		password: joiPassword
			.string()
			.minOfSpecialCharacters(1)
			.minOfLowercase(1)
			.minOfUppercase(1)
			.minOfNumeric(1)
			.noWhiteSpaces()
			.required()
			.messages({
				"password.minOfUppercase": "Password should contain at least 1 uppercase character",
				"password.minOfSpecialCharacters": "Password should contain at least 1 special character",
				"password.minOfLowercase": "Password should contain at least 1 lowercase character",
				"password.minOfNumeric": "Password should contain at least 1 numeric character",
				"password.noWhiteSpaces": "Password should not contain spaces",
			}),
		repeatedPassword: joiPassword.string().required(),
		phoneNumber: Joi.any().allow(null, Joi.string().trim().allow(""), Joi.number()), // placeholder
	});
	await validatorHandler(ctx, next, schema);
};

const signin = async (ctx: AppContext, next: Next) => {
	const check2FAroute = ctx.path.includes("/sign-in/2fa") ? true : false;
	if (!check2FAroute && !ctx.request.body.email && !ctx.request.body.phoneNumber)
		throwError(406, "Either email or phone number must be provided to sign in");

	// validate phone number if it exists in the request body
	if (ctx.request.body.phoneNumber) await phoneNumberValidator(ctx);

	let schema: ObjectSchema<unknown>;
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

const updateAccount = async (ctx: AppContext, next: Next) => {
	// validate phone number if it exists in the request body
	if (ctx.request.body.phoneNumber) await phoneNumberValidator(ctx);

	const schema = Joi.object().keys({
		firstName: Joi.string().trim().min(3).max(50).required(),
		lastName: Joi.any().allow(null, Joi.string().trim().allow("").max(50)),
		phoneNumber: Joi.any().allow(null, Joi.string().trim().allow(""), Joi.number()), // placeholder
	});
	await validatorHandler(ctx, next, schema);
};

const changePassword = async (ctx: AppContext, next: Next) => {
	const schema = Joi.object().keys({
		currentPassword: Joi.string().trim().required(),
		newPassword: joiPassword
			.string()
			.minOfSpecialCharacters(1)
			.minOfLowercase(1)
			.minOfUppercase(1)
			.minOfNumeric(1)
			.noWhiteSpaces()
			.required()
			.messages({
				"password.minOfUppercase": "New Password should contain at least 1 uppercase character",
				"password.minOfSpecialCharacters": "New Password should contain at least 1 special character",
				"password.minOfLowercase": "New Password should contain at least 1 lowercase character",
				"password.minOfNumeric": "New Password should contain at least 1 numeric character",
				"password.noWhiteSpaces": "Password should not contain spaces",
			}),
		repeatedNewPassword: Joi.string().required(),
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

export const adminFormValidator = { createAccount, signin, updateAccount, changePassword, resetPassword };
