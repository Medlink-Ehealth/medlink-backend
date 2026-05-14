import { sequelizeInstances } from "@medlink/common";
import { DataTypes, Model, Sequelize } from "sequelize";

const instances = Object.values(sequelizeInstances);
/**
 * User patient documents
 * @openapi
 * components:
 *   schemas:
 *     PatientDocument:
 *       description: References to user/patients medical document as available or previously uploaded by users
 *       type: object
 *       properties:
 *         uuid:
 *           type: string
 *           format: uuid
 *           readOnly: true
 *         source:
 *           type: string
 *           description: The direct storage access URL of the document
 */

// bind model to each api env
instances.map((sequelize) => {
	class patientdocument extends Model {}
	patientdocument.init(
		{
			uuid: {
				type: DataTypes.UUID,
				primaryKey: true,
			},
			source: {
				type: DataTypes.STRING,
				allowNull: false,
			},
		},
		{
			tableName: "patient_documents",
			timestamps: true,
			createdAt: "created",
			updatedAt: "updated",
			sequelize: sequelize,
			modelName: "PatientDocument",
		},
	);
});

export const PatientDocument = (db: Sequelize) => db.models["PatientDocument"];
