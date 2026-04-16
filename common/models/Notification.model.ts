import { DataTypes, Model, Sequelize } from "sequelize";
import { sequelizeInstances } from "../config/db.config.js";
const instances = Object.values(sequelizeInstances);

// bind model to each api env
instances.map((sequelize) => {
	class notification extends Model {}
	notification.init(
		{
			uuid: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				primaryKey: true,
			},
			image: DataTypes.STRING,
			title: DataTypes.STRING,
			detail: {
				type: DataTypes.TEXT,
				allowNull: false,
			},
			status: {
				type: DataTypes.STRING, // unread | read
				allowNull: false,
				defaultValue: "unread",
			},
			meta: {
				type: DataTypes.JSONB, // Should be used to store authorship data per notification.
				// target: {
				//  type: "User",
				//  uuid: ctx.state.user.uuid,
				// }, 'target' should always be present for filtering
				/* {
          author: {
            uuid: ctx.state.user.uuid,
            role: ctx.state.user.role,
            level: ctx.state.user.level,
            name: ctx.state.user.firstName,
          },
          target: {
            type: "UserGroup",
            level: "admin or above",
            //level: "4+",
            role: "4,5",
            //operator: ">=",
          },
          content: {
            path: ctx.state.entity.alias,
            title: ctx.state.entity.title,
          },
      */
				allowNull: false,
			},
		},
		{
			tableName: "notifications",
			timestamps: true,
			createdAt: "created",
			updatedAt: "updated",
			sequelize, // We need to pass the connection instance
			modelName: "Notification", // We need to choose the model name
		},
	);
});

export const Notification = (db: Sequelize) => db.models["Notification"];
