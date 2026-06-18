import { hashPassword, logger, Patient, sequelizeInstances } from "@medlink/common";
import { Provider, ProviderStatic } from "../models/Provider.model.js";
import { Visit } from "../models/Visit.model.js";

const instances = Object.values(sequelizeInstances);

async function defaultTablesUp() {
	const doMain = async () => {
		try {
			for (const sequelize of instances) {
				await sequelize.transaction(async (t) => {
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
						// get a patient uuid
						const patient = await Patient(sequelize).findOne({ transaction: t });
						if (patient)
							await Visit(sequelize).create(
								{
									patient: patient.dataValues.uuid,
									comment: "Here we go for this visitation. This is a dummy comment to show that visit data can be retrieved.",
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
			logger.error("Error, Default models: ", err);
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
