import { sequelizeInstances, getOffsetTimestamp, logger, Notification, UserAccessTimestamp, UserSecurity, OTP } from "@medlink/common";

import { Admin } from "../models/accounts/Admin.model.js";
import { Sequelize } from "sequelize";
import { AdminRole } from "../models/accounts/AdminRole.model.js";
import { UserSetting } from "../models/accounts/UserSetting.model.js";
import { Client } from "../models/accounts/Client.model.js";

const instances = Object.values(sequelizeInstances);

//user roles/privileges
const roles = [
	{ level: 0, label: "Inactive" },
	{ level: 1, label: "Active" },
	{ level: 2, label: "Support" },
	{ level: 3, label: "Admin" },
	{ level: 4, label: "Manager" },
	{ level: 999, label: "Dev" },
];
//OTP test data
const dummyOTP = {
	code: "codeVerifier",
	ref: "Account",
	id: "06c198a4-4428-4ac6-bbee-d7621fd16d33",
	markForDeletionBy: getOffsetTimestamp("-24"),
	log: "Account verification",
};

const modelsSync = async (sequelize: Sequelize) => {
	// if dev mode.
	try {
		await UserSetting(sequelize).sync({ alter: true });
		await UserAccessTimestamp(sequelize).sync({ alter: true });
		await UserSecurity(sequelize).sync({ alter: true });

		await Admin(sequelize).sync({ alter: true });
		await Client(sequelize).sync({ alter: true });

		await AdminRole(sequelize).sync({ force: true });
		await OTP(sequelize).sync({ alter: true });
		await Notification(sequelize).sync({ force: true });

		await sequelize.transaction(async (t) => {
			await AdminRole(sequelize).bulkCreate(roles, { transaction: t });
		});

		logger.info("All tables synced as needed!");
	} catch (err) {
		logger.error(err);
		//logger.error(JSON.stringify(err, null, 2));
	}
	// if production mode
	// rather than delete and recreate table, update it to fit updated models.
	// await Admin.sync({ alter: true });
};

for (const sequelize of instances) {
	await modelsSync(sequelize);
}
process.exit();


/* 
{
  "email": "akin@mellywood.com",
  "password": "Accounts2@",
  "repeatedPassword": "Accounts2@",
  "firstName": "Akin",
  "lastName": "Akin",
  "phoneNumber": "07086333388"
}

*/