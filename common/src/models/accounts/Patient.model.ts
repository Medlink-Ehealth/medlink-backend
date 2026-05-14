import { DataTypes, Model, ModelStatic, Sequelize } from "sequelize";
import { UserSetting } from "./UserSetting.model.js";
import { sequelizeInstances } from "@medlink/common";

const instances = Object.values(sequelizeInstances);

/**
 * Auth patient user account
 * @openapi
 * components:
 *   schemas:
 *     Patient:
 *       description: Patient/Customer type of user account
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
 *         picture:
 *           type: string
 *           format: binary
 *         firstName:
 *           type: string
 *           nullable: false
 *         lastName:
 *           type: string
 *         dob:
 *           type: string
 *           readOnly: true
 *           nullable: false
 *         address:
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
 *           value: patient
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
	class patient extends Model {
		toJSON() {
			// hide protected fields
			const attributes = Object.assign({}, this.get());
			for (const a of PROTECTED_ATTRIBUTES) {
				delete attributes[a];
			}
			return attributes;
		}
	}
	patient.init(
		{
			uuid: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				unique: true,
				primaryKey: true,
			},
			picture: DataTypes.STRING,
			firstName: {
				type: DataTypes.STRING,
				allowNull: false,
				field: "first_name",
			},
			lastName: {
				type: DataTypes.STRING,
				field: "last_name",
			},
			dob: {
				type: DataTypes.DATE,
				allowNull: false,
				field: "date_of_birth",
			},
			address: {
				type: DataTypes.STRING,
				// allowNull: false,
			},
			phoneNumber: {
				type: DataTypes.STRING,
				field: "phone_number",
				// unique: true, no longer of benefit since same user can reasonably be registered to multiple businesses that relay solely on our platform
			},
			email: {
				type: DataTypes.STRING,
				//allowNull: false,
				// unique: true, no longer of benefit since same user can reasonably be registered to multiple businesses that relay solely on our platform
			},
			password: {
				type: DataTypes.STRING,
				allowNull: false,
				get() {
					return undefined;
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
					return "patient";
				},
				set() {
					throw new Error("'type' is system managed. Do not set this");
				},
			},
		},
		{
			defaultScope: {
				attributes: {
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
			tableName: "patient_accounts",
			timestamps: true,
			createdAt: "created",
			updatedAt: "updated",
			paranoid: true,
			deletedAt: "deleted",
			sequelize: sequelize,
			modelName: "Patient", // We need to choose the model name
		},
	);

	patient.hasOne(UserSetting(sequelize), {
		as: "Setting",
		scope: { user_type: "patient" },
		onDelete: "CASCADE",
		onUpdate: "CASCADE",
	});
	UserSetting(sequelize).belongsTo(patient, {
		foreignKey: "user_uuid",
		constraints: false,
	});
});

export const Patient = (db: Sequelize) => db.models["Patient"] as ModelStatic<PatientStatic>;
type Attr = {
	uuid: `${string}-${string}-${string}-${string}-${string}`;
	firstName: string;
	lastName?: string;
	picture?: string;
	dob: string;
	address?: string;
	phoneNumber?: string;
	email: string;
	password: string;
	role: number;
	state: boolean;
	secured: boolean;
	verified: boolean;
	type: "patient";
	created?: string;
	updated?: string;
};
export interface PatientStatic extends Model<Attr>, Attr {
	toJSON(): Attr;
}
