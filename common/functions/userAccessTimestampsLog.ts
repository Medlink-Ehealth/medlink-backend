import { Sequelize } from "sequelize";
import { UserAccessTimestamp } from "../models/UserAccessTimestamp.model.js";

//log/update signed-in user access to website
export const userAccessTimestampsLog = async (
	sequelize: Sequelize,
	attributes?: {
		signedInTime?: boolean;
		signedOutTime?: boolean;
		currentTime?: boolean;
		saveLogDetail?: boolean | string;
		userUUID: string;
	},
) => {
	// currentTime is TRUE by default. This should be set as FALSE if not required.
	const user = attributes?.userUUID;
	if (!user) {
		throw new Error("User UUID must be defined to update Timestamp data");
	}
	const bodyAttributes: { [time: string]: number | string } = {};
	if (attributes?.currentTime !== false) bodyAttributes["current"] = Date.now();

	if (attributes?.signedInTime) bodyAttributes["signIn"] = Date.now();
	if (attributes?.signedOutTime) bodyAttributes["signOut"] = Date.now();
	if (attributes?.saveLogDetail) {
		if (typeof attributes.saveLogDetail === "string") bodyAttributes["log"] = attributes.saveLogDetail + " <br/>";
		else bodyAttributes["log"] = "Access timestamp was updated <br/>";
	}

	return await sequelize.transaction(async (t) => {
		let access = {};
		let userAccessTimestamp = await UserAccessTimestamp(sequelize).findByPk(user, {
			transaction: t,
		});
		if (userAccessTimestamp instanceof UserAccessTimestamp) {
			if (bodyAttributes["log"]) bodyAttributes["log"] = userAccessTimestamp.dataValues.log + bodyAttributes["log"];
			await userAccessTimestamp.update(bodyAttributes, { transaction: t });
			access = userAccessTimestamp.toJSON();
		} else {
			userAccessTimestamp = await UserAccessTimestamp(sequelize).create(
				{
					...bodyAttributes,
					account_id: user,
				},
				{ transaction: t },
			);
			access = userAccessTimestamp.toJSON();
		}
		return access;
	});
};
