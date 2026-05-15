import {
	sequelizeInstances,
	logger,
	Notification,
	UserAccessTimestamp,
	UserSecurity,
	OTP,
	Admin,
	AdminRole,
	UserSetting,
	Patient,
} from "@medlink/common";
import { Sequelize } from "sequelize";
import { Provider } from "../models/Provider.model.js";
import { Visit } from "../models/Visit.model.js";
import { PatientDocument } from "../models/Document.model.js";

const instances = Object.values(sequelizeInstances);

const modelsSync = async (sequelize: Sequelize) => {
	// if dev mode.
	try {
		// instantiate auth-service (in @common share lib) schemas to ensure Patient service access in dev mode using sqlite
		await UserSetting(sequelize).sync({ alter: true });
		await UserAccessTimestamp(sequelize).sync({ alter: true });
		await UserSecurity(sequelize).sync({ alter: true });

		await Admin(sequelize).sync({ alter: true });
		await AdminRole(sequelize).sync({ alter: true });
		await Patient(sequelize).sync({ alter: true });

		await OTP(sequelize).sync({ alter: true });
		await Notification(sequelize).sync({ force: true });

		await sequelize.transaction(async (t) => {
			const roles = await AdminRole(sequelize).findAll({ transaction: t });
			if (!roles.length) {
				const rolesDef = [
					{ level: 0, label: "Inactive" },
					{ level: 1, label: "Active" },
					{ level: 2, label: "Support" },
					{ level: 3, label: "Admin" },
					{ level: 4, label: "Manager" },
					{ level: 999, label: "Dev" },
				];
				await AdminRole(sequelize).bulkCreate(rolesDef, { transaction: t });
			}
		});

		// do patient-service schemas
		await Provider(sequelize).sync({ alter: true });
		await Visit(sequelize).sync({ alter: true });
		await PatientDocument(sequelize).sync({ alter: true });

		logger.info("All tables synced as needed!");
	} catch (err) {
		logger.error(err);
	}
};

for (const sequelize of instances) {
	await modelsSync(sequelize);
}
process.exit();
