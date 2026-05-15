import { hashPassword, logger, sequelizeInstances } from "@medlink/common";
import { Provider, ProviderStatic } from "../models/Provider.model.js";
import { Visit } from "../models/Visit.model.js";

const instances = Object.values(sequelizeInstances);

async function defaultTablesUp() {
	const doMain = async () => {
		try {
			for (const sequelize of instances) {
				await sequelize.transaction(async (t) => {
					// call auth-service defaults to check if sample data exists. This file has been copied to this smae dir as this file: defaultTablesOn-Auth-Service.ts

					try {
						await import("./defaultTablesOn-Auth-Service.js"); // iniitaite
						logger.info("Auth service initiated");
					} catch (err) {}

					// do patient service specific if needed
					//providers sample
					const checkExistingProviders = await Provider(sequelize).findAll({
						transaction: t,
					});
					if (!checkExistingProviders || (checkExistingProviders && checkExistingProviders.length === 0)) {
						await Provider(sequelize).create(
							{
								name: "Mellywood",
								email: "hello@mellywood.com",
							} as unknown as ProviderStatic,
							{ transaction: t },
						);
					}

					// visit sample
					const checkExistingVisitData = await Visit(sequelize).findAll({
						transaction: t,
					});
					if (!checkExistingVisitData || (checkExistingVisitData && checkExistingVisitData.length === 0)) {
						await Visit(sequelize).create(
							{
								comment: "Here we gp fopr this visitation. This is a dummy comment to show that visit data can be retrieved.",
								commentBy: "Akin",
							},
							{ transaction: t },
						);
					}

					logger.info("Default Tables for PATIENT SERVICE Populated");
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
	const mainTable = await doMain();

	setTimeout(async () => {
		if (mainTable) {
			try {
				for (const sequelize of instances) {
					sequelize.transaction(async (t) => {
						logger.info("Dependent Tables for PATIENT SERVICE Populated");
					});
				}
				return;
			} catch (err) {
				logger.error({ on: "dependent models for PATIENT SERVICE", log: err });
				return err;
			}
		}
	}, 10000);
}

await defaultTablesUp();
process.exit();
