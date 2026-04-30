import { DataTypes, Model, ModelStatic, Sequelize } from "sequelize";
import { AdminRole } from "./AdminRole.model.js";
import { UserSetting } from "./UserSetting.model.js";
import { sequelizeInstances } from "@medlink/common";

const instances = Object.values(sequelizeInstances);
/*
  Admin ranks are defined by roles in interger values. 
  -2 being the least and rank increases upward.
  Default Role definations:
    -2. Blocked
    -1. Unverified
    0. Inactive
    1. "Customer Support"
		2. "Operations Staff"
		3. "Admin (Top-Level Management)"
		999. "Site Administrator"
*/

/**
 * Auth admin user account
 * @openapi
 * components:
 *   schemas:
 *     Admin:
 *       description: Admin type of user account
 *       type: object
 *       properties:
 *         uuid:
 *           type: string
 *           readOnly: true
 *           format: uuid
 *         created:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *         updated:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *         avatar:
 *           type: string
 *           format: binary
 *         firstName:
 *           type: string
 *           nullable: false
 *         lastName:
 *           type: string
 *         phoneNumber:
 *           oneOf:
 *             - type: string
 *             - type: number
 *         email:
 *           type: string
 *           nullable: false
 *         password:
 *           type: string
 *           format: password
 *           writeOnly: true
 *         role:
 *           type: integer
 *           minimum: -2
 *           maximum: 3
 *           default: -1
 *           nullable: false
 *           readOnly: true
 *         roleLabel:
 *           type: string
 *           readOnly: true
 *         state:
 *           type: boolean
 *           readOnly: true
 *         secured:
 *           type: boolean
 *           readOnly: true
 *         verified:
 *           type: boolean
 *           readOnly: true
 *         'type':
 *           type: string
 *           value: admin
 *           readOnly: true
 *
 *       required:
 *         - firstName
 *         - email
 *         - password
 */
const PROTECTED_ATTRIBUTES = ["password", "email", "phoneNumber", "wallet" /* "secured" */];

// bind model to each api env
instances.map((sequelize) => {
	class admin extends Model {
		toJSON() {
			// hide protected fields
			const attributes = Object.assign({}, this.get());
			for (const a of PROTECTED_ATTRIBUTES) {
				delete attributes[a];
			}
			return attributes;
		}
	}
	admin.init(
		{
			uuid: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				unique: true,
				primaryKey: true,
			},
			avatar: DataTypes.STRING,
			firstName: {
				type: DataTypes.STRING,
				allowNull: false,
				field: "first_name",
			},
			lastName: {
				type: DataTypes.STRING,
				field: "last_name",
			},
			phoneNumber: {
				type: DataTypes.STRING,
				field: "phone_number",
			},
			email: {
				type: DataTypes.STRING,
				allowNull: false,
				unique: true,
			},
			password: {
				type: DataTypes.STRING,
				allowNull: false,
				get() {
					return undefined;
				},
			},
			role: {
				type: DataTypes.INTEGER,
				allowNull: false,
				references: {
					model: AdminRole(sequelize),
					key: "level",
				},
			},
			state: {
				type: DataTypes.BOOLEAN, //active account should be set to true
				defaultValue: false, //blocked by default. Users with force status are cleared/delete. Never deliberately set a user as force except if deliberately deletion is desired.
			},
			secured: {
				type: DataTypes.BOOLEAN, //Checks if user has extra security features enabled.
				defaultValue: false,
			},
			verified: {
				type: DataTypes.BOOLEAN, //an alternative verified indicator & also allows to clear unverified users instead of using state
				defaultValue: false,
			},
			type: {
				type: DataTypes.VIRTUAL,
				get() {
					return "admin";
				},
				set() {
					throw new Error("'type' is system managed. Do not set this");
				},
			},
		},
		{
			defaultScope: {
				attributes: {
					/* where: {
          role: 4,
        }, */
					exclude: ["password", "deleted", "created", "updated", "secured", "email", "phoneNumber", "wallet"],
				},
			},
			scopes: {
				management: {
					attributes: {
						exclude: ["password", "deleted", "secured"],
					},
				},
				middleware: {
					// deprecate
					attributes: {
						exclude: [],
					},
				},
				raw: {
					attributes: {
						exclude: [],
					},
				},
				bin: {
					attributes: undefined,
				},
			},
			tableName: "admin_accounts",
			timestamps: true,
			createdAt: "created",
			updatedAt: "updated",
			paranoid: true,
			deletedAt: "deleted",
			sequelize: sequelize,
			modelName: "Admin", // We need to choose the model name
		},
	);

	admin.hasOne(UserSetting(sequelize), {
		as: "Setting",
		scope: { user_type: "admin" },
		onDelete: "CASCADE",
		onUpdate: "CASCADE",
	});
	UserSetting(sequelize).belongsTo(admin, {
		foreignKey: "user_uuid",
		constraints: false,
	});
});

export const Admin = (db: Sequelize) => db.models["Admin"] as ModelStatic<AdminStatic>;

type Attr = {
	uuid: `${string}-${string}-${string}-${string}-${string}`;
	avatar?: string;
	firstName: string;
	lastName?: string;
	phoneNumber?: string;
	email: string;
	password: string;
	role: number;
	state?: boolean;
	secured?: boolean;
	verified?: boolean;
	type: "admin";
	created?: string;
	updated?: string;
};
export interface AdminStatic extends Model<Attr>, Attr {
	toJSON(): Attr;
}
