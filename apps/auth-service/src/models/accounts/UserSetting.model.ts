import { sequelizeInstances } from "@medlink/common";
import { DataTypes, Model, Sequelize } from "sequelize";

const instances = Object.values(sequelizeInstances);
/**
 * User setting
 * @openapi
 * components:
 *   schemas:
 *     UserSetting:
 *       description: Model that defines additional settings options that can be associated with a user account
 *       type: object
 *       properties:
 *         user_uuid:
 *           type: string
 *           format: uuid
 *           readOnly: true
 *         sendNotificationsBy:
 *           type: array
 *           description: notification options may include depending on implementations => email | sms | whatsapp. Only 'email' is available at the moment
 *           uniqueItems: true
 *           items:
 *             type: string
 *             enum: ["email"]
 *         notificationsToReceive:
 *           type: array
 *           description: When to recieve notifications
 *           uniqueItems: true
 *           items:
 *             type: string
 *             enum: [ "signingIn", "passwordChange", "newOrderComplete", "paymentConfirmation"]
 */
export const userSettingPlatformProps = {
	sendNotificationsBy: { email: "Email" },
	notificationsToReceive: {
		signingIn: "Account Sign Ins",
		passwordChange: "Password changes",
		newOrderCompletion: "New order completions",
		paymentConfirmation: "Payment confirmations",
		// orderShipmentUpdates: "Order shipments and updates",
		// ticketUpdates: "Support ticket updates",
	},
};

const PROTECTED_ATTRIBUTES = ["user_type"];

// bind model to each api env
instances.map((sequelize) => {
	class userSetting extends Model {
		toJSON() {
			// hide protected fields
			const attributes = Object.assign({}, this.get());
			for (const a of PROTECTED_ATTRIBUTES) {
				delete attributes[a];
			}
			return attributes;
		}
	}
	userSetting.init(
		{
			user_uuid: {
				//Specific user acccount UUID id
				type: DataTypes.UUID,
				primaryKey: true,
				// references: {
				//  // model: Client,
				//   key: 'uuid',
				// },
			},
			user_type: {
				//Specific user acccount type
				type: DataTypes.ENUM("client", "admin"),
				allowNull: false,
			},
			sendNotificationsBy: {
				/* 
				Only postgres supports DataTypes.ARRAY, so we are conditionally checking for postgres, otherwise we use DataTypes.JSON for data type here */
				type: sequelize.getDialect()?.toLowerCase() === "postgres" ? DataTypes.ARRAY(DataTypes.STRING) : DataTypes.JSON,
				defaultValue: ["email"],
				values: ["email"],
				field: "send_notifications_by",
				/* 
				notification options may include depending on implementations 
						=> email | sms | whatsapp
					Only 'email' is available at the moment
					
			-- Push real time notification is available by default but not configured presently until if a need arises to
			*/
				get() {
					const notifications: string[] = this.getDataValue("sendNotificationsBy");
					return notifications.map((key) => ({ [key]: userSettingPlatformProps["sendNotificationsBy"][key as "email"] }));
				},
				set(inValues) {
					const possibleValues = Object.keys(userSettingPlatformProps["sendNotificationsBy"]);

					if (!Array.isArray(inValues)) throw new Error("notificationsToReceive values should be serializable as array");
					else {
						const savableValues: string[] = [];
						inValues.forEach((value) => {
							if (possibleValues.includes(value)) savableValues.push(value);
						});
						this.setDataValue("sendNotificationsBy", savableValues);
					}
				},
			},
			notificationsToReceive: {
				type: sequelize.getDialect()?.toLowerCase() === "postgres" ? DataTypes.ARRAY(DataTypes.STRING) : DataTypes.JSON, // same as sendNotificationsBy above
				defaultValue: ["signingIn", "passwordChange", "paymentConfirmation"],
				//values: ["signingIn", "passwordChange", "newOrderComplete", "paymentConfirmation", "orderShipmentUpdates"],
				field: "notifications_to_receive",
				set(inValues) {
					const possibleValues = Object.keys(userSettingPlatformProps["notificationsToReceive"]);

					if (!Array.isArray(inValues)) throw new Error("notificationsToReceive values should be serializable as array");
					else {
						const savableValues: string[] = [];
						inValues.forEach((value) => {
							if (possibleValues.includes(value)) savableValues.push(value);
						});
						this.setDataValue("notificationsToReceive", savableValues);
					}
				},
				get() {
					const notifications: string[] = this.getDataValue("notificationsToReceive");
					return notifications.map((key) => ({ [key]: userSettingPlatformProps["notificationsToReceive"][key as "signingIn"] }));
				},
			},
		},
		{
			defaultScope: {
				attributes: {
					exclude: ["user_type"],
				},
			},
			scopes: {
				raw: {
					attributes: {
						exclude: [],
					},
				},
			},
			tableName: "user_settings",
			timestamps: false,
			sequelize: sequelize, // We need to pass the connection instance
			modelName: "UserSetting", // We need to choose the model name
		},
	);
});

export const UserSetting = (db: Sequelize) => db.models["UserSetting"];
/*
SELECT conname, confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE conrelid = 'user_settings'::regclass AND contype = 'f';
*/
