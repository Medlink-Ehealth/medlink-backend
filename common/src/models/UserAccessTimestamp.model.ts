import { DataTypes, Model, Sequelize } from "sequelize";
import { sequelizeInstances } from "../config/db.config.js";
const instances = Object.values(sequelizeInstances);

// bind model to each api env
instances.map((sequelize) => {
	class userAccessTimestamp extends Model {
		toJSON() {
			// remove account_id since it's already on profile as uuid
			const attributes = Object.assign({}, this.get());
			delete attributes["account_id"];
			return attributes;
		}
	}
	userAccessTimestamp.init(
		{
			account_id: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				unique: true,
				primaryKey: true,
			},
			signedIn: {
				type: DataTypes.DATE,
				field: "last_signed_in",
			},
			signedOut: {
				type: DataTypes.DATE,
				field: "last_signed_out",
			},
			current: {
				type: DataTypes.DATE,
				field: "current_user_logged_access",
			},
			log: {
				//add a comment/log to the model
				type: DataTypes.TEXT,
			},
		},
		{
			tableName: "user_access_timestamps",
			timestamps: false,
			sequelize, // We need to pass the connection instance
			modelName: "UserAccessTimestamp", // We need to choose the model name
		},
	);
});

export const UserAccessTimestamp = (db: Sequelize) => db.models["UserAccessTimestamp"];
