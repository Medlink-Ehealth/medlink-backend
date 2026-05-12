import { AppContext } from "../../@types/utils.js";
import { NOT_FOUND, CONFLICT, BAD_REQUEST, SERVER_ERROR } from "../../constants/statusCodes.js";
import { logger } from "../../utils/logger.js";
import { Next } from "koa";

type JsonValue = JsonObject;
type JsonObject = {
	[key: string]: JsonValue;
};

//Use this to check the status/existence of an account on the server.

// the 'exist' argument is a boolean that should be specified when called as either true or false
// currentUser is passed to the header and can be used in any next middleware function.
const checkAccount = (existStatus: boolean) => async (ctx: AppContext, next: Next) => {
	const { email, uuid } = ctx.request.body;
	if (!ctx.sequelizeInstance) {
		logger.error("checkAccount cannot be called on an unactive sequelizeInstance");
		ctx.state.error = {
			code: SERVER_ERROR,
			message: "Oops! Internal server error",
		};
	} else if (email || uuid) {
		try {
			let thisUser;
			if (ctx.state.userType) {
				thisUser = uuid
					? await ctx.sequelizeInstance.models[ctx.state.userType].findByPk(uuid)
					: await ctx.sequelizeInstance.models[ctx.state.userType].findOne({
							where: { email: email.toLowerCase() },
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
