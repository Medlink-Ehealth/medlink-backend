import { hashPassword, logger, sequelizeInstances } from "@medlink/common";
import { Admin } from "../models/accounts/Admin.model.js";

const instances = Object.values(sequelizeInstances);

type adminType = {
	firstName: string;
	lastName: string;
	email: string;
	password: string;
	role: number;
	state: boolean;
	uuid: `${string}-${string}-${string}-${string}-${string}`;
	type: "admin";
};

async function defaultTablesUp() {
	const defaultAdmin = {
		firstName: "Akintunde",
		lastName: "EB",
		email: "ebakintunde@gmail.com",
		password: hashPassword("accounts"),
		role: 4,
		state: true,
	};
	const defaultDev = {
		firstName: "Akintunde",
		lastName: "Akin",
		email: "devakintunde@gmail.com",
		password: hashPassword("accounts"),
		role: 999,
		state: true,
	};

	const doMian = async () => {
		try {
			for (const sequelize of instances) {
				await sequelize.transaction(async (t) => {
					const checkExistingAdminAccounts = await Admin(sequelize).findAll({
						transaction: t,
					});
					if (!checkExistingAdminAccounts || (checkExistingAdminAccounts && checkExistingAdminAccounts.length === 0)) {
						await Admin(sequelize).create(defaultDev as adminType, { transaction: t });
						await Admin(sequelize).create(defaultAdmin as adminType, { transaction: t });
					}
					logger.info("Default Tables UP");
					return true;
				});
			}
			return true;
		} catch (err) {
			logger.error({ on: "Default models", log: err });
			console.log("Error, Default models: ", err);
			//return err;
		}
	};
	const mainTable = await doMian();

	setTimeout(async () => {
		if (mainTable) {
			try {
				for (const sequelize of instances) {
					sequelize.transaction(async (t) => {
						logger.info("Dependent Tables UP");
					});
				}
				return;
			} catch (err) {
				logger.error({ on: "dependent models", log: err });
				return err;
			}
		}
	}, 10000);
}

await defaultTablesUp();
process.exit();
