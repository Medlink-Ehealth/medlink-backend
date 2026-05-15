import Joi from "joi";
import { joiPasswordExtendCore } from "joi-password";
import { Next } from "koa";
import { validatorHandler, phoneNumberValidator, throwError, AppContext } from "@medlink/common";

const joiPassword = Joi.extend(joiPasswordExtendCore);

const createAccount = async (ctx: AppContext, next: Next) => {
	if (!ctx.request.body.email && !ctx.request.body.phoneNumber)
		throwError(406, "Either email or phone number must be provided for registration");

	// validate phone number if it exists in the request body
	if (ctx.request.body.phoneNumber) await phoneNumberValidator(ctx);

	const schema = Joi.object().keys({
		firstName: Joi.string().trim().min(3).max(50).required(),
		lastName: Joi.any().allow(null, Joi.string().trim().allow("").max(50)),
		email: Joi.string().trim().email(),
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

export const clientFormValidator = { createAccount, updateAccount, changePassword };
