import { DataTypes, Model, Sequelize } from "sequelize";
import { sequelizeInstances } from "../../config/db.config.js";
const instances = Object.values(sequelizeInstances);

/*
	AdminRole definations:
			-2. Blocked
			-1. Unverified
			0. Inactive
			1. "Customer Support"
    	2. "Operations Staff"
			3. "Admin (Top-Level Management)"
			999. "Site Administrator"
*/
/* Default
const roles = [
  { level: -2, label: "Blocked" }, // users delibrately blocked
  { level: -1, label: "Unverified" }, // unverified user
  { level: 0, label: "Inactive" }, // dormant user
  { level: 1, label: "Customer Support" }, // Average regular staff account user
	{ level: 2, label: "Operations Staff" }, // A senior management user
	{ level: 3, label: "Admin (Top-Level Management)" }, // Most senior Admin user
  { level: 999, label: "Site Administrator" }, // Website maintenance
]; */

// bind model to each api env
instances.map((sequelize) => {
	class adminRole extends Model {}
	adminRole.init(
		{
			level: {
				type: DataTypes.INTEGER,
				primaryKey: true,
			},
			label: {
				type: DataTypes.STRING,
			},
		},
		{
			tableName: "admin_roles",
			timestamps: false,
			sequelize,
			modelName: "AdminRole", // We need to choose the model name
		},
	);
});

export const AdminRole = (db: Sequelize) => db.models["AdminRole"];
