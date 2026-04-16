import { NOT_FOUND, CONFLICT, BAD_REQUEST, SERVER_ERROR } from "../../constants/statusCodes.js";
import { logger } from "../../utils/logger.js";
import { ParameterizedContext, Next, DefaultContext } from "koa";
import { Op, Sequelize } from "sequelize";

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
	sequelizeInstance: Sequelize;
}

//Use this to check the status/existence of an account on the server.

// the 'exist' argument is a boolean that should be specified when called as either true or false
// currentUser is passed to the header and can be used in any next middleware function.
const checkAccount = (existStatus: boolean) => async (ctx: extendedParameterizedContext, next: Next) => {
	const { email, uuid, phoneNumber } = ctx.request.body;
	if (email || uuid || phoneNumber) {
		try {
			let thisUser;
			if (ctx.state.userType) {
				thisUser = uuid
					? await ctx.sequelizeInstance.models[ctx.state.userType].findByPk(uuid)
					: email && phoneNumber
						? await ctx.sequelizeInstance.models[ctx.state.userType].findOne({
								where: { [Op.or]: [{ email: email.toLowerCase() }, { phoneNumber: phoneNumber }] },
							})
						: email
							? await ctx.sequelizeInstance.models[ctx.state.userType].findOne({
									where: { email: email.toLowerCase() },
								})
							: await ctx.sequelizeInstance.models[ctx.state.userType].findOne({
									where: { phoneNumber: phoneNumber },
								});
			} else {
				ctx.status = BAD_REQUEST;
				ctx.message = "userType absent. Define userType in state. This is likely a server error than anything else";
				return;
			}
			if (existStatus && !thisUser) {
				ctx.state.error = {
					code: NOT_FOUND,
					message: "Oops! User account not found",
				};
			} else if (!existStatus && thisUser) {
				ctx.state.error = {
					code: CONFLICT,
					message: "Oops! User account already exist",
				};
			} /* else if (existStatus && thisUser && thisUser.email) {
        ctx.state.currentUser = thisUser;
      } */
			await next();
		} catch (err) {
			logger.error("Account checking error: ", err);
			ctx.status = SERVER_ERROR;
			ctx.message = "Oops! Server error";
			return;
		}
	} else {
		ctx.status = BAD_REQUEST;
		ctx.message = uuid ? "Provide a valid user UUID" : email ? "Provide a valid user email address" : "Provide a valid phone number";
		return;
	}
};

export default checkAccount;
