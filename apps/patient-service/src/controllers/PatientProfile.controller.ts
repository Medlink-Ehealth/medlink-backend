import { ParameterizedContext, Next, DefaultContext } from "koa";
import { statusCodes, logger, Patient } from "@medlink/common";
import fs from "node:fs";
import { Sequelize } from "sequelize";

type JsonValue = string | number | boolean | null | undefined | JsonObject | JsonArray;
type JsonObject = {
	[key: string]: JsonValue;
};
type JsonArray = Array<JsonValue>;
interface extendedParameterizedContext extends ParameterizedContext {
	request: DefaultContext["request"] & {
		body?: JsonValue;
		files?: [string, File]; // [formidable.Fields<string>, formidable.Files<string>]
		rawBody?: unknown;
	};
	sequelizeInstance?: Sequelize;
}

export const updatePatientProfile = (options?: { userType?: string }) => async (ctx: extendedParameterizedContext, next: Next) => {
	const userType =
		options && options.userType
			? options.userType
			: ctx.header["x-usertype"]
				? ctx.header["x-usertype"]
				: ctx.state.user.type
					? ctx.state.user.type
					: undefined;
	if (!userType) {
		ctx.status = statusCodes.SERVER_ERROR;
		ctx.message = "Unable to determine account model/type";
		return;
	} else if (!ctx.sequelizeInstance) {
		logger.error("updateAccount Error: ", "No active ctx.sequelizeInstance to match request to!");
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		return;
	}
	try {
		const user = await Patient(ctx.sequelizeInstance).findByPk(ctx.state.user.uuid);
		if (user) {
			//remove former avatar from server if avatar keys exists
			let errorRemovingFormerAvatar = false;
			if (user.dataValues.picture && ctx.request.body.avatar) {
				fs.unlink(process.cwd() + user.dataValues.picture, (err: unknown) => {
					if (err) errorRemovingFormerAvatar = true;
				});
			}
			// Clean up image if new upload unsuccessful
			if (errorRemovingFormerAvatar) {
				delete ctx.request.body.avatar;
				fs.unlinkSync(process.cwd() + ctx.request.body.avatar);
			}
			const updatedUser = await user.update(ctx.request.body);
			ctx.state.updatedUser = updatedUser.toJSON();
		} else {
			ctx.status = statusCodes.NOT_MODIFIED;
			ctx.message = "Unable to update account";
			return;
		}
	} catch (err) {
		logger.error("Account update error:", err);
		ctx.status = statusCodes.SERVER_ERROR;
		ctx.message = "Unable to update account";
		return;
	}
	await next();
};
