import { hashPassword, logger, sequelizeInstances, Admin, Patient, PatientStatic } from "@medlink/common";

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
	const patientSample = {
		firstName: "Akin",
		lastName: "EB",
		email: "ebakintunde@icloud.com",
		password: hashPassword("accounts"),
		dob: Date.now(),
		address: "No 2, Orishigun str, Alapere Ketu",
		state: true,
		verified: true,
	};
	const defaultAdmin = {
		firstName: "Akintunde",
		lastName: "EB",
		email: "ebakintunde@gmail.com",
		password: hashPassword("accounts"),
		role: 4,
		state: true,
		verified: true,
	};
	const defaultDev = {
		firstName: "Akintunde",
		lastName: "Akin",
		email: "devakintunde@gmail.com",
		password: hashPassword("accounts"),
		role: 999,
		state: true,
		verified: true,
	};

	const doMian = async () => {
		try {
			for (const sequelize of instances) {
				await sequelize.transaction(async (t) => {
					const checkExistingAdminAccounts = await Admin(sequelize).findAll({
						transaction: t,
					});
					if (!checkExistingAdminAccounts || (checkExistingAdminAccounts && checkExistingAdminAccounts.length === 0)) {
						await Admin(sequelize).create(defaultDev as unknown as adminType, { transaction: t });
						await Admin(sequelize).create(defaultAdmin as unknown as adminType, { transaction: t });
					}

					// process for patient user if no exists yet
					const checkExistingPatientAccounts = await Patient(sequelize).findAll({
						transaction: t,
					});
					if (!checkExistingPatientAccounts || (checkExistingPatientAccounts && checkExistingPatientAccounts.length === 0)) {
						await Patient(sequelize).create(patientSample as unknown as PatientStatic["dataValues"], { transaction: t });
					}

					logger.info("Default Tables for AUTH SERVICE Populated");
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
						logger.info("Dependent Tables for AUTH SERVICE Populated");
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
