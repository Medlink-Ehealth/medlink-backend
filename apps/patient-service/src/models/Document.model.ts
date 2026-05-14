import { Patient, sequelizeInstances } from "@medlink/common";
import { DataTypes, Model, Sequelize } from "sequelize";

const instances = Object.values(sequelizeInstances);
/**
 * User patient documents
 * @openapi
 * components:
 *   schemas:
 *     PatientDocument:
 *       description: References to user/patients medical document as available or previously uploaded by users. This schema is main in use by backend and would rarely be required by the frontend
 *       type: object
 *       properties:
 *         uuid:
 *           type: string
 *           format: uuid
 *           readOnly: true
 *         source:
 *           type: string
 *           description: The direct storage access URL of the document
 *         sourceId:
 *           type: string
 *           description: A unique identifier to access document that be not have permanent URL links. Hence sourceId must always exist
 *         'type':
 *           type: string
 *           value: patient_document
 *           readOnly: true
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
			sourceId: {
				type: DataTypes.STRING,
				// allowNull: false,
			},
			type: {
				type: DataTypes.VIRTUAL,
				get() {
					return "patient_document";
				},
				set() {
					throw new Error("'type' is system managed. Do not set this");
				},
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

	Patient(sequelize).hasMany(patientdocument, {
		onDelete: "CASCADE",
		onUpdate: "CASCADE",
		foreignKey: "uuid",
	});
	patientdocument.belongsTo(Patient(sequelize));
});

export const PatientDocument = (db: Sequelize) => db.models["PatientDocument"];
