import { DataTypes, Model, ModelStatic, Sequelize } from "sequelize";
import { sequelizeInstances } from "@medlink/common";

const instances = Object.values(sequelizeInstances);

/**
 * Patient service providers
 * @openapi
 * components:
 *   schemas:
 *     Provider:
 *       description: Service Providers for patient. May alternatively to be associated to a specific user types for scenario where a single user is able to manage multiple providers but would require that specific implementation which is not cartered for at this time.
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
 *         logo:
 *           type: string
 *           format: binary
 *         name:
 *           type: string
 *           nullable: false
 *           description: The service provider name
 *         phoneNumber:
 *           oneOf:
 *             - type: string
 *             - type: number
 *         email:
 *           type: string
 *           nullable: true
 *         state:
 *           type: boolean
 *           readOnly: true
 *           description: Indicated where a service provider is active or suspended
 *         'type':
 *           type: string
 *           value: provider
 *           readOnly: true
 *
 *       required:
 *         - name
 */
const PROTECTED_ATTRIBUTES = ["password", "email", "phoneNumber", "wallet" /* "secured" */];

// bind model to each api env
instances.map((sequelize) => {
	class provider extends Model {
		toJSON() {
			// hide protected fields
			const attributes = Object.assign({}, this.get());
			for (const a of PROTECTED_ATTRIBUTES) {
				delete attributes[a];
			}
			return attributes;
		}
	}
	provider.init(
		{
			uuid: {
				type: DataTypes.UUID,
				defaultValue: DataTypes.UUIDV4,
				unique: true,
				primaryKey: true,
			},
			logo: {
				type: DataTypes.STRING,
			},
			name: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			email: {
				type: DataTypes.STRING,
			},
			phoneNumber: {
				type: DataTypes.STRING,
				field: "phone_number",
			},
			state: {
				type: DataTypes.BOOLEAN, //active provider should be set to true
				defaultValue: false, //blocked by default.
			},
			type: {
				type: DataTypes.VIRTUAL,
				get() {
					return "provider";
				},
				set() {
					throw new Error("'type' is system managed. Do not set this");
				},
			},
		},
		{
			tableName: "providers",
			timestamps: true,
			createdAt: "created",
			updatedAt: "updated",
			paranoid: true,
			deletedAt: "deleted",
			sequelize: sequelize,
			modelName: "Provider",
		},
	);
});

export const Provider = (db: Sequelize) => db.models["Provider"] as ModelStatic<ProviderStatic>;
type Attr = {
	uuid: `${string}-${string}-${string}-${string}-${string}`;
	logo?: string;
	name: string;
	phoneNumber?: string;
	email?: string;
	state: boolean;
	type: "provider";
	created?: string;
	updated?: string;
};
export interface ProviderStatic extends Model<Attr>, Attr {
	toJSON(): Attr;
}
