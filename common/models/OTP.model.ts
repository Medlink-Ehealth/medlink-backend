import { DataTypes, Model, Sequelize } from "sequelize";
import { sequelizeInstances } from "../config/db.config.js";
const instances = Object.values(sequelizeInstances);

// Structure
// GET: /verify?filter[id=akin@thin.city|UUID]&filter[code=gjU866bi35h]

// One Time Password model for code genaration
// bind model to each api env
instances.map((sequelize) => {
	class oTP extends Model {}
	oTP.init(
		{
			uuid: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				primaryKey: true,
			},
			code: {
				type: DataTypes.STRING,
				//primaryKey: true,
			},
			ref: {
				//referenced entity type this OTP is for
				type: DataTypes.STRING,
				allowNull: false,
				field: "ref_entity",
			},
			id: {
				//referenced primaryKey/ID of content entity this OTP is for
				type: DataTypes.STRING,
				allowNull: false,
				field: "ref_id",
			},
			log: {
				//add a comment/log to the model
				type: DataTypes.TEXT,
			},
			markForDeletionBy: {
				type: DataTypes.DATE,
				field: "mark_for_deletion_by",
				allowNull: false,
			},
			type: {
				type: DataTypes.VIRTUAL,
				get() {
					return "otp";
				},
				set() {
					throw new Error("'type' is system managed. Do not set this");
				},
			},
		},
		{
			tableName: "otp_reservation",
			timestamps: true,
			createdAt: "created",
			updatedAt: "updated",
			sequelize, // We need to pass the connection instance
			modelName: "OTP", // We need to choose the model name
		},
	);
});

export const OTP = (db: Sequelize) => db.models["OTP"];
