import { sequelizeInstances } from "@medlink/common";
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
});

export const Visit = (db: Sequelize) => db.models["Visit"];
