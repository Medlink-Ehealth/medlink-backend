import { sequelizeInstances, logger } from "@medlink/common";
import { Sequelize } from "sequelize";
import { Provider } from "../models/Provider.model.js";
import { Visit } from "../models/Visit.model.js";
import { PatientDocument } from "../models/Document.model.js";

const instances = Object.values(sequelizeInstances);

const modelsSync = async (sequelize: Sequelize) => {
	// if dev mode.
	try {
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
