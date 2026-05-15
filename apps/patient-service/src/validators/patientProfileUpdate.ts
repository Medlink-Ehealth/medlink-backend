import Joi from "joi";
import { Next } from "koa";
import { validatorHandler, phoneNumberValidator, AppContext } from "@medlink/common";

export const patientProfileUpdate = async (ctx: AppContext, next: Next) => {
	// validate phone number if it exists in the request body
	if (ctx.request.body.phoneNumber) await phoneNumberValidator(ctx);

	const schema = Joi.object().keys({
		firstName: Joi.string().trim().min(3).max(50).required(),
		lastName: Joi.any().allow(null, Joi.string().trim().allow("").max(50)),
		phoneNumber: Joi.any().allow(null, Joi.string().trim().allow(""), Joi.number()), // placeholder
		dob: Joi.date(),
		address: Joi.string(),
	});
	await validatorHandler(ctx, next, schema);
};
