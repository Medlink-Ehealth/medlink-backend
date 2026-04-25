import { DataTypes, Model, Sequelize } from "sequelize";
import { sequelizeInstances } from "../config/db.config.js";
const instances = Object.values(sequelizeInstances);

/**
 * User security add-on settings
 * openapi
 * components:
 *   schemas:
 *     UserSecurity:
 *       description: This model is internally attached to Each type of user. There is no direct interaction of Frontend with this model, but available for reference purposes
 *       type: object
 *       properties:
 *         user_uuid:
 *           type: string
 *           format: uuid
 *           description: Specific associated user UUID
 *         '2fa':
 *           type: object
 *           properties:
 *             verified:
 *               type: boolean
 *               description: Indicates if 2FA is enabled or not
 *         'recovery_emails':
 *           type: array
 *           items:
 *             type: object
 *             description: AN array of emails added to user account for recovery eligibility
 *             properties:
 *               email:
 *                 type: string
 *               verified:
 *                 type: string
 */

const PROTECTED_ATTRIBUTES = ["security"];

// bind model to each api env
instances.map((sequelize) => {
	class userSecurity extends Model {
		toJSON() {
			// hide protected fields
			const attributes = Object.assign({}, this.get());
			for (const a of PROTECTED_ATTRIBUTES) {
				delete attributes[a];
			}
			return attributes;
		}
	}
	userSecurity.init(
		{
			user_uuid: {
				//Specific user acccount UUID id
				type: DataTypes.UUID,
				primaryKey: true,
			},
			security: {
				allowNull: true,
				type: DataTypes.JSON, // account security options presented in an object as keys
				/* 
        "2fa": { 
          verified: BOOLEAN,
          secret: "User2FA-master-Secret" 
        }, 
        recovery_emails: {
          email: string, verified: BOOLEAN, otpVerificationCode:string 
        }[]
      */
				/* get() {
				console.log("innnnn!!!!", this.get("scope"));
				const security = this.getDataValue("security");
				const output: { [key: string]: object } = { recovery_emails: security["recovery_emails"] };
				//console.log("security:", security);
				if (security && security["2fa"]) {
					const twoFAinfo = security["2fa"];
					if (this.get("scope") !== "raw") delete twoFAinfo["secret"];
					output["2fa"] = twoFAinfo;
				} else
					output["2fa"] = {
						verified: false,
					};
				console.log("output:", output);
				return output;
			}, */
				/* set(obj: {
				"2fa"?: {
					verified: boolean;
					secret: string;
				};
				recovery_emails?: {
					email: string;
					verified: boolean;
				}[];
			}) {
			}, */
			},
			"2fa": {
				type: DataTypes.VIRTUAL,
				get() {
					const security = this.getDataValue("security");
					//console.log("security:", security);
					if (security && security["2fa"]) {
						delete security["2fa"]["secret"];
						return security["2fa"];
					} else
						return {
							verified: false,
						};
				},
				set() {
					throw new Error("Inappropriate setter");
				},
			},
			recoveryEmails: {
				type: DataTypes.VIRTUAL,
				get() {
					const security = this.getDataValue("security");
					if (security && security["recovery_emails"])
						return (
							security["recovery_emails"] as {
								email: string;
								verified: boolean;
								otpVerificationCode: string;
							}[]
						).map((email) => ({
							email: email.email,
							verified: email.verified,
						}));
					else return null;
				},
				set() {
					throw new Error("Inappropriate setter");
				},
			},
		},
		{
			defaultScope: {
				attributes: {
					exclude: ["security"],
				},
			},
			scopes: {
				raw: {
					attributes: {
						exclude: [],
					},
				},
			},
			tableName: "user_security",
			timestamps: false,
			sequelize, // We need to pass the connection instance
			modelName: "UserSecurity", // We need to choose the model name
		},
	);
});

export const UserSecurity = (db: Sequelize) => db.models["UserSecurity"];
