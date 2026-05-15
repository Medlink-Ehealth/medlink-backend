import { Patient, sequelizeInstances } from "@medlink/common";
import { DataTypes, Model, Sequelize } from "sequelize";

const instances = Object.values(sequelizeInstances);
/**
 * User patient visits
 * @openapi
 * components:
 *   schemas:
 *     Visit:
 *       description: Used to keep logs of patient visits, activities and practical history
 *       type: object
 *       properties:
 *         uuid:
 *           type: stringx
 *           format: uuid
 *           readOnly: true
 *         comment:
 *           type: string
 *           description: A logged report for recording per patient visit
 *         commentBy:
 *           type: string
 *           description: A record of the person who provided the visit comment
 */

// bind model to each api env
instances.map((sequelize) => {
	class visit extends Model {}
	visit.init(
		{
			uuid: {
				type: DataTypes.UUID,
				primaryKey: true,
				defaultValue: DataTypes.UUIDV4,
				unique: true,
			},
			comment: {
				type: DataTypes.TEXT,
				allowNull: false,
			},
			commentBy: {
				type: DataTypes.STRING,
				allowNull: false,
				field: "comment_by", // use to keep record of the doctor/personnel of person that entered this record
			},
			type: {
				type: DataTypes.VIRTUAL,
				get() {
					return "visit";
				},
				set() {
					throw new Error("'type' is system managed. Do not set this");
				},
			},
		},
		{
			tableName: "visits",
			timestamps: true,
			createdAt: "created",
			updatedAt: "updated",
			sequelize: sequelize,
			modelName: "Visit",
		},
	);

	Patient(sequelize).hasMany(visit, {
		onDelete: "CASCADE",
		onUpdate: "CASCADE",
		foreignKey: {
			name: "patient",
			allowNull: false,
		},
	});
	visit.belongsTo(Patient(sequelize), {
		targetKey: "uuid",
		foreignKey: {
			name: "patient",
			allowNull: false,
		},
	});
});

export const Visit = (db: Sequelize) => db.models["Visit"];
