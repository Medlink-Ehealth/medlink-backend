/* General platform user Accounts management */
import {
	JsonObject,
	Model,
	Router,
	UserAccessTimestamp,
	checkAccount,
	dbQuerier,
	logger,
	notificationLogger,
	requestParser,
	statusCodes,
	throwError,
} from "@medlink/common";

import validator from "validator";
import { Admin, AdminRole, Client, UserSetting } from "../../../../../../models/accounts/index.js";
import { ModelStatic, Sequelize } from "sequelize";
import { AdminStatic } from "../../../../../../models/accounts/Admin.model.js";
import { ClientStatic } from "../../../../../../models/accounts/Client.model.js";
import { AdminUser, ClientUser } from "../../../../../../@types/Models.js";
import { createNewAccount } from "../../../../../../controllers/createNewAccount.controller.js";
import { adminFormValidator } from "../../../../../../validators/adminFormValidator.js";
import { clientFormValidator } from "../../../../../../validators/clientFormValidator.js";

const router = Router();

const userTypesModelMap = {
	admin: "Admin",
	admins: "Admin",
	client: "Client",
	clients: "Client",
};

/*
	 Let's control who and who can have access to the user management endpoints
	 While at least a customer support role can view all platform users, modification of any account and creation of admin accounts is limited to operations and management admin accounts
*/

router.use(
	async (ctx, next) => {
		if (
			(ctx.method.toLowerCase() !== "get" && ctx.state.user.role < 2) ||
			(ctx.method.toLowerCase() === "get" && ctx.state.user.role < 2 && ctx.path.includes("/suspend/"))
		) {
			ctx.status = statusCodes.UNAUTHORIZED;
			ctx.message = "Elevated operations permission is required to create/modify user accounts";
			return;
		} else await next();
	},
	requestParser({ multipart: true }),
);

/**
 * Fetch all registered user accounts
 * @openapi
 * /auth/admin/accounts/{userType}:
 *   get:
 *     tags:
 *       - Platform users & accounts management (Admin)
 *     summary: Fetch one or all existing registered user accounts.
 *     description: "Fetch one or all registered accounts whether Clients, Delivery Partners or Admin accounts. Filter through filters using URL queries. Worthy note: it's not possible to query by roleLabel (does not exist on the user Model) for admin users because this is handled internally to interpret a role number; hence query by the Role Number instead if needed."
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *       - in: path
 *         name: userType
 *         schema:
 *           type: string
 *         description: "Set optional {userType} value"
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           default: 'admin'
 *         description: "user account type {userType} can optionally be defined in query, and ignored on the path alias. Only one of 'type' or 'userType' needs to be used"
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *         allowReserved: true
 *         description: "filter accounts to some/any random properties. EG: [firstName[START_WITH]=Emma]"
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *         allowReserved: true
 *         description: "sort by ascending/descending. EG: [created=ASC]"
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of accounts to skip before collecting results
 *       - in: query
 *         name: limit
 *         schema:
 *           type: string
 *           pattern: "^(\\d+|[aA][lL][lL])$"
 *         description: "Number of accounts to return. Insert 'all' to return all records"
 *     responses:
 *       200:
 *         description: "Returns one or multiple accounts dependent on the filter queries. Where limit is set and no specific type of account defined, the limit would be applied to each account type and all returned. Use '?limit=all' as query to return all user accounts that exists, though not advisable where likely thousands/millions of data exists."
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   type: array
 *                   description: Contains an arrray of accounts
 *                   items:
 *                     anyOf:
 *                       - $ref: "#/components/schemas/Admin"
 *                       - $ref: "#/components/schemas/Client"
 *                       - $ref: "#/components/schemas/DeliveryPartner"
 *               example:
 *                 status: 200
 *                 data:
 *                   - uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                     avatar: "/picture.jpg"
 *                     firstName: Emma
 *                     lastName: Emma
 *                     phoneNumber: 07012345678
 *                     email: emma-watson@gmail.com
 *                     role: 2
 *                     roleLabel: "Operations Staff"
 *                     state: true
 *                     verified: true
 *                     'type': 'admin'
 *                     created: 2024-12-05T19:00:00.151Z
 *                     updated: 2024-12-05T19:00:00.151Z
 *                   - uuid: "ef0921a1-261a-40ba-915c-8465d258892d"
 *                     avatar: "/picture.jpg"
 *                     firstName: Stella
 *                     lastName: Kudi
 *                     phoneNumber: 07012345678
 *                     email: stella-kudi@riideon.com
 *                     state: true
 *                     verified: true
 *                     'type': 'client'
 *                     created: 2024-12-05T15:00:00.151Z
 *                     updated: 2024-12-05T17:00:00.151Z
 *       400:
 *         description: Inproper request related errors. Media type => text/plain
 *       401:
 *         description: Unauthorised to access user management-related operations. Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

//
router.get(
	["/", "/:usersType"],
	async (ctx, next) => {
		if (ctx.path === ctx.url) {
			ctx.url = ctx.url + "?sort=[created=ASC]&limit=10";
		}
		await next();
	},
	dbQuerier({ ignoreStateFiltration: true, useOlderImplementation: false }),
	async (ctx, next) => {
		// when params '{userType}' is absent, the API server tends to stil send the placeholder. We are ignoring it here
		if (ctx.params["usersType"] === "{userType}") delete ctx.params["usersType"];

		//console.log("ctx.state.dbQuerier", ctx.state.dbQuerier);
		let importedUserType = ctx.params["usersType"] || ctx.query["type"];
		// ites possible for usersType of list multiple with commas
		if (typeof importedUserType === "string" && importedUserType.includes(",")) importedUserType = importedUserType.split(",");

		const usersType = importedUserType
			? typeof importedUserType === "string" && userTypesModelMap[importedUserType as "admin"]
				? [importedUserType]
				: Array.isArray(importedUserType) && userTypesModelMap[importedUserType[0] as "admin"] // only checking that 1st item in query array exists in prefined types mapper
					? importedUserType
					: undefined
			: ["admin", "client", "delivery_partner"];

		// console.log("importedUserType", importedUserType);
		// console.log("usersType", usersType);
		if (!usersType) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Invalid account type(s) provided";
			return;
		}

		try {
			//inject acccount access timestamps model
			ctx.state.data = await ctx.sequelizeInstance!.transaction(async (t) => {
				const users = await Promise.all(
					usersType.map(async (type) => {
						if (type) {
							type = type.trim().toLowerCase();
							if (!userTypesModelMap[type as "admin"]) return [];
							const typeModel = (type === "admin" || type === "admins" ? Admin : Client) as (
								db: Sequelize,
							) => ModelStatic<AdminStatic | ClientStatic>;
							return await typeModel(ctx.sequelizeInstance!)
								.scope("management")
								.findAll({
									...ctx.state.dbQuerier,
									transaction: t,
								});
						}
						return [];
					}),
				);

				// console.log("users:", users);
				const getTimestampsIDs: (string | null)[] = [];
				const getTimestamps: (Promise<Model | null> | null)[] = [];
				users.forEach((userGroup) => {
					if (userGroup && userGroup.length)
						userGroup.forEach(async (account) => {
							if (!account) {
								getTimestampsIDs.push(null);
								getTimestamps.push(null);
							}
							getTimestampsIDs.push(account.dataValues.uuid);
							getTimestamps.push(
								UserAccessTimestamp(ctx.sequelizeInstance!).findByPk(account.dataValues.uuid, {
									transaction: t,
								}),
							);
						});
				});

				const GetTimestamps = await Promise.all(getTimestamps);

				//convert getTimestampsIDs to object
				const UsersAccessTimestamps: { [uuid: string]: Model } = {};
				GetTimestamps.forEach((userTimestamp, index) => {
					const timestamp = userTimestamp?.toJSON();
					const ID = getTimestampsIDs[index];
					if (timestamp && ID) UsersAccessTimestamps[ID] = timestamp;
				});
				//console.log("UsersAccessTimestamps:", UsersAccessTimestamps);

				// Get defined admin roles if present in user types group
				const UserRoles =
					usersType.includes("Admin") &&
					(await AdminRole(ctx.sequelizeInstance!).findAll({
						transaction: t,
					}));

				if (users) {
					const groupUsersByType: {
						admins?: AdminUser[] | [];
						clients?: ClientUser[] | [];
					} = {};

					users.map((usersGroup, index) => {
						const key = (usersType[index].endsWith("s") ? usersType[index] : usersType[index] + "s") as "admins";
						// ignore unknown type
						if (!userTypesModelMap[usersType[index] as "admin"]) return;
						else
							groupUsersByType[key] = usersGroup.map((account) => {
								const thisAccount = account.toJSON() as AdminUser;
								if (UsersAccessTimestamps[thisAccount.uuid]) {
									thisAccount['access' as 'firstName'] = UsersAccessTimestamps[thisAccount.uuid] as any;
								}
								if (UserRoles && UserRoles.length)
									for (let i = 0; i < UserRoles.length; i++) {
										const role = UserRoles[i];
										if (role.dataValues.level === thisAccount.role) {
											thisAccount["roleLabel"] = role.dataValues.label;
											break;
										}
									}
								return thisAccount;
							});
					});
					return groupUsersByType;
				} else return;
			});
		} catch (err) {
			logger.error("account query error ", err);
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = (err as object)["message" as keyof typeof err] ? (err as object)["message" as keyof typeof err] : "Bad request";
			return;
		}
		//console.log("ctx.state.data:", ctx.state.data);
		await next();
	},
	(ctx) => {
		if (ctx.state.data) {
			ctx.status = statusCodes.OK;
			ctx.body = {
				status: statusCodes.OK,
				data: ctx.state.data,
			};
			return;
		}
		ctx.status = statusCodes.BAD_REQUEST;
		return;
	},
);

/**
 * Fetch a single registered user account
 * @openapi
 * /auth/admin/accounts/{userType}/{email}:
 *   get:
 *     tags:
 *       - Platform users & accounts management (Admin)
 *     summary: Drill into a single user profile.
 *     description: "Fetch a single user account profile."
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *       - in: path
 *         name: userType
 *         required: true
 *         schema:
 *           type: string
 *           default: admin
 *           enum: ['user', 'admin', 'client', 'delivery_partner']
 *         description: "userType is required here. Where query 'type' is preferred for declaring user account type, simply use 'user' as placeholder here"
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: A specific valid email address is required
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: "user account type 'userType' can optionally be defined in query. When this is the case, parameter {userType} should be simply used as 'user' or the parameter would be prioritised"
 *     responses:
 *       200:
 *         description: Return a user profile data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   description: User account data object
 *                   oneOf:
 *                     - $ref: "#/components/schemas/Admin"
 *                     - $ref: "#/components/schemas/Client"
 *                     - $ref: "#/components/schemas/DeliveryPartner"
 *               example:
 *                 status: 200
 *                 data:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   avatar: "/picture.jpg"
 *                   firstName: Emma
 *                   lastName: Emma
 *                   phoneNumber: 07012345678
 *                   email: emma-watson@gmail.com
 *                   role: 2
 *                   roleLabel: "Operations Staff"
 *                   state: true
 *                   verified: true
 *                   'type': 'admin'
 *                   created: 2024-12-05T19:00:00.151Z
 *                   updated: 2024-12-05T19:00:00.151Z
 *       400:
 *         description: Inproper request related errors. Media type => text/plain
 *       401:
 *         description: Unauthorised to access user management-related operations. Media type => text/plain
 *       404:
 *         description: User account not found. Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

//view per user account
router.get(
	["/user/:email", "/:usersType/:email"],
	async (ctx, next) => {
		const usersType = ctx.params["usersType"] || ctx.query["type"];
		const email = ctx.params["email"];

		if (
			!usersType ||
			(usersType && typeof usersType !== "string") ||
			(usersType && typeof usersType === "string" && !userTypesModelMap[usersType as "admin"])
		) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message =
				"Account type missing. Define as either 'admin', 'client' or 'delivery_partner' either in the endpoint or as a URL query like type=admin";
			return;
		}
		if (!validator.isEmail(email)) {
			throwError(statusCodes.BAD_REQUEST, "Unable to resolve a valid account email.");
		}
		const thisAccount = await ctx.sequelizeInstance!.transaction(async (t) => {
			const thisAccountProfile = await ctx.sequelizeInstance!.models[userTypesModelMap[usersType as "admin"]].scope("management").findOne({
				where: { email: email },
				transaction: t,
			});

			if (thisAccountProfile) {
				const accessTimestamps = await UserAccessTimestamp(ctx.sequelizeInstance!).findByPk(thisAccountProfile.dataValues.uuid, {
					transaction: t,
				});
				if (thisAccountProfile instanceof Admin(ctx.sequelizeInstance!)) {
					let roleLabel;
					await AdminRole(ctx.sequelizeInstance!)
						.findByPk(thisAccountProfile.dataValues.role, {
							transaction: t,
						})
						.then((res) => {
							roleLabel = res && res.dataValues.label;
						});
					return {
						...thisAccountProfile.toJSON(),
						access: accessTimestamps ? accessTimestamps.toJSON() : null,
						roleLabel: roleLabel,
					};
				} else
					return {
						...(thisAccountProfile as Model).toJSON(),
						access: accessTimestamps ? accessTimestamps.toJSON() : null,
					};
			}
			return;
		});
		if (thisAccount) {
			ctx.state.data = { data: thisAccount };
		} else {
			ctx.state.error = { message: "User account not found." };
		}
		await next();
	},
	(ctx) => {
		if (ctx.state.error) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = ctx.state.error.message;
			return;
		}
		if (!ctx.state.data) {
			ctx.status = statusCodes.NOT_FOUND;
			return (ctx.body = {});
		}
		ctx.status = statusCodes.OK;
		ctx.body = {
			status: statusCodes.OK,
			...ctx.state.data,
		};
		return;
	},
);

/**
 * Create a new user account from the admin dashboard. Only a "Admin (Top-Level Management)" (level:3) user would be abel to do this
 * @openapi
 * /auth/admin/accounts/{userType}/create:
 *   post:
 *     tags:
 *       - Platform users & accounts management (Admin)
 *     summary: Create a new user account.
 *     description: "Create a new user (client, admin, Delivery partner) account. Only a 'Admin (Top-Level Management)' (level:3) user would be able to do this"
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *       - in: path
 *         name: userType
 *         required: true
 *         schema:
 *           type: string
 *           default: admin
 *           enum: ['user', 'admin', 'client', 'delivery_partner']
 *         description: "userType is required here. Where query 'type' is preferred for declaring user account type, simply use 'user' as placeholder here"
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           default: 'type=admin'
 *         allowReserved: true
 *         description: "user account type 'userType' can optionally be defined in query. When this is the case, parameter {userType} should be simply used as 'user' or the parameter would be prioritised"
 *     requestBody:
 *       description: Request body can be available as json formated or FormData
 *       required: true
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *               repeatedPassword:
 *                 type: string
 *                 format: password
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phoneNumber:
 *                 oneOf:
 *                   - type: string
 *                   - type: number
 *     responses:
 *       201:
 *         description: Returns created new user data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   description: Contains an arrray of accounts
 *                   Oneof:
 *                     - $ref: "#/components/schemas/Admin"
 *                     - $ref: "#/components/schemas/Client"
 *                     - $ref: "#/components/schemas/DeliveryPartner"
 *               example:
 *                 status: 201
 *                 data:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   avatar: "/picture.jpg"
 *                   firstName: Emma
 *                   lastName: Emma
 *                   phoneNumber: 07012345678
 *                   email: emma-watson@gmail.com
 *                   role: 2
 *                   roleLabel: "Operations Staff"
 *                   state: true
 *                   verified: true
 *                   'type': 'admin'
 *                   created: 2024-12-05T19:00:00.151Z
 *                   updated: 2024-12-05T19:00:00.151Z
 *       400:
 *         description: Inproper request related errors. Media type => text/plain
 *       401:
 *         description: Unauthorised to access user management-related operations. Media type => text/plain
 *       409:
 *         description: Account already registered. Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

//create new admin account
router.post(
	["/user/create", "/:usersType/create"],
	async (ctx, next) => {
		const usersType = ctx.params["usersType"] || ctx.query["type"];

		if (ctx.state.user.role < 3) {
			ctx.status = statusCodes.UNAUTHORIZED;
			ctx.message = `Only a "Admin (Top-Level Management)" (level:3) account or higher can create a user using the Admin interface`;
			return;
		}

		if (
			!usersType ||
			(usersType && typeof usersType !== "string") ||
			(usersType && typeof usersType === "string" && !userTypesModelMap[usersType as "admin"])
		) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message =
				"Account type missing. Define as either 'admin', 'client' or 'delivery_partner' either in the endpoint or as a URL query like type=admin";
			return;
		} else {
			const type = userTypesModelMap[usersType as "admin"];
			ctx.state.userType = type;
			if (type === "Admin") {
				await adminFormValidator.createAccount(ctx, next);
			} else if (type === "Client") {
				await clientFormValidator.createAccount(ctx, next);
			}  else {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message =
					"Account type missing. Define as either 'admin', 'client' or 'delivery_partner' either in the endpoint or as a URL query like type=admin";
				return;
			}
		}
	},
	checkAccount(false),
	async (ctx, next) => {
		if (ctx.state.error) {
			if (ctx.state.error.code === statusCodes.CONFLICT) {
				ctx.status = statusCodes.CONFLICT;
				ctx.message = "Account already registered";
				return;
			} else {
				ctx.status = ctx.state.error.code;
				ctx.message = ctx.state.error.message;
				return;
			}
		}
		await next();
	},
	createNewAccount(),
	async (ctx) => {
		if (ctx.state.newUser) {
			// create an associated user settings
			await UserSetting(ctx.sequelizeInstance!).create({ user_uuid: ctx.state.newUser.dataValues.uuid, user_type: "admin" });
			const profileData = {
				status: statusCodes.CREATED,
				account: ctx.state.newUser.toJSON(),
				statusText: "Account created.",
			};
			notificationLogger({
				ctx,
				detail: `${ctx.state.user.firstName} created a new ${ctx.state.userType} user account: ${profileData.account.firstName} (${profileData.account.email})`,
				meta: {
					target: "Admin",
					uuid: "xxx-xxxx-xxxxx-xxxxxx",
					filter: {
						role: 2,
						operator: ">",
					},
				},
			});
			ctx.status = statusCodes.CREATED;
			return (ctx.body = profileData);
		} else {
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			ctx.message = "Account creation failed.";
			return;
		}
	},
);

/**
 * Perform a suspend of re-activation on an existing user account
 * @openapi
 * /auth/admin/accounts/{userType}/{email}/action/{action}:
 *   get:
 *     tags:
 *       - Platform users & accounts management (Admin)
 *     summary: Perform a suspend of re-activation on an existing user account.
 *     description: A user account can suspended or reactived if/when needed"
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *       - in: path
 *         name: userType
 *         required: true
 *         schema:
 *           type: string
 *           default: admin
 *           enum: ['user', 'admin', 'client', 'delivery_partner']
 *         description: "userType is required here. Where query 'type' is preferred for declaring user account type, simply use 'user' as placeholder here"
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: A specific valid email address is required
 *       - in: path
 *         name: action
 *         required: true
 *         schema:
 *           type: string
 *           default: activate
 *           enum: ['activate', 'suspend']
 *         description: Type of action to perform on account
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           default: 'type=admin'
 *         description: "user account type 'userType' can optionally be defined in query. When this is the case, parameter {userType} should be simply used as 'user' or the parameter would be prioritised"
 *     responses:
 *       200:
 *         description: COnfirmation status of action
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *                   description: Action status feedback
 *               example:
 *                 status: 200
 *                 statusText: "Account activated | Account suspended"
 *       400:
 *         description: Unable to resolve a valid account email. Media type => text/plain
 *       401:
 *         description: "Only a 'Admin (Top-Level Management)' (level:3) account can suspend or otherwise a user using the Admin interface. Media type => text/plain"
 *       404:
 *         description: Not found. Media type => text/plain
 *       406:
 *         description: Unacceptable action(s). Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

//suspend or activate/reactivate or suspend an admin account
router.get(["/user/:email/action/:action", "/:usersType/:email/action/:action"], async (ctx) => {
	const usersType = ctx.params["usersType"] || ctx.query["type"];
	const email = ctx.params["email"];

	if (ctx.state.user.role < 3) {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = `Only a "Admin (Top-Level Management)" (level:3) account can suspend or otherwise a user using the Admin interface`;
		return;
	}

	if (
		!usersType ||
		(usersType && typeof usersType !== "string") ||
		(usersType && typeof usersType === "string" && !userTypesModelMap[usersType as "admin"])
	) {
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message =
			"Account type missing. Define as either 'admin', 'client' or 'delivery_partner' either in the endpoint or as a URL query like type=admin";
		return;
	}

	try {
		if (validator.isEmail(email)) {
			const thisAccount = await ctx.sequelizeInstance!.models[userTypesModelMap[usersType as "admin"]].findOne({
				where: { email: email },
			});
			if (thisAccount) {
				if (thisAccount instanceof Admin(ctx.sequelizeInstance!) && thisAccount.dataValues.role === 999) {
					ctx.status = statusCodes.NOT_ACCEPTABLE;
					ctx.message = "Dev accounts are not allowed to be suspended";
					return;
				}
				//protect managerial accounts that is only superceded by DEV from suspension. Write a custom route if the functionality(to suspend managerial account) is otherwise needed.
				if (thisAccount instanceof Admin(ctx.sequelizeInstance!)) {
					const roles = await AdminRole(ctx.sequelizeInstance!).findAll();
					if (roles) {
						const appRoles = roles.sort((a, b) => b.dataValues.level - a.dataValues.level);
						let managerialRole;
						if (appRoles[0].dataValues.level === 999) managerialRole = appRoles[1].dataValues;
						//a double check
						else if (appRoles[appRoles.length - 1].dataValues.level === 999) managerialRole = appRoles[appRoles.length - 2].dataValues;

						if (managerialRole && thisAccount.dataValues.role === managerialRole.level && ctx.params.action !== "activate") {
							ctx.status = statusCodes.NOT_ACCEPTABLE;
							ctx.message =
								"Managerial roles are protected from suspension. If required, please first downgrade the account role to a lower role to enable suspension of the account to happen.";
							return;
						}
					}
				}
				// perform action if execution gets here!
				let statusOk = false;
				if (ctx.params.action === "activate") {
					let updates: { state: boolean; role?: number } = {
						state: true,
					};
					if (thisAccount instanceof Admin(ctx.sequelizeInstance!) && thisAccount.dataValues.role === 0) updates = { ...updates, role: 1 };
					await thisAccount.update(updates);
					statusOk = true;
					ctx.status = statusCodes.OK;
					ctx.body = { status: statusCodes.OK, statusText: "Account activated" };
					//return;
				} else {
					await thisAccount.update({ state: false });
					statusOk = true;
					ctx.status = statusCodes.OK;
					ctx.body = { status: statusCodes.OK, statusText: "Account suspended" };
					//return;
				}
				if (statusOk)
					notificationLogger({
						ctx,
						detail: `${ctx.state.user.firstName} updated ${ctx.state.userType} user account status: ${thisAccount.dataValues.firstName} (${thisAccount.dataValues.email})`,
						meta: {
							target: "Admin",
							uuid: "xxx-xxxx-xxxxx-xxxxxx",
							filter: {
								role: 2,
								operator: ">",
							},
						},
					});
				return;
			} else {
				ctx.status = statusCodes.NOT_FOUND;
				ctx.message = "Requested account not found";
				return;
			}
			/* ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "Unable to identify account role hierarchy. Please reachout to the App Developer";
			return; */
		} else {
			throwError(statusCodes.BAD_REQUEST, "Unable to resolve a valid account email.");
		}
	} catch (err) {
		logger.error("Account suspension error: ", err);
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		ctx.message = "Unable to resolve account.";
		return;
	}
});

/**
 * Update an admin user role
 * @openapi
 * /auth/admin/accounts/{userType}/{email}/role:
 *   patch:
 *     tags:
 *       - Platform users & accounts management (Admin)
 *     summary: Update an admin user role.
 *     description: "Update an admin user account role. This is only available for the Admin user account type"
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *       - in: path
 *         name: userType
 *         required: true
 *         schema:
 *           type: string
 *           default: admin
 *           enum: ['user', 'admin']
 *         description: "userType is required here. Where query 'type' is preferred for declaring user account type, simply use 'user' as placeholder here"
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: A specific valid email address is required
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           default: 'type=admin'
 *         description: "user account type 'userType' can optionally be defined in query. When this is the case, parameter {userType} should be simply used as 'user' or the parameter would be prioritised"
 *     responses:
 *       200:
 *         description: Confirmation status of action
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *                   description: Action status feedback
 *               example:
 *                 status: 200
 *                 statusText: Role updated
 *       400:
 *         description: Bad request. Media type => text/plain
 *       401:
 *         description: "Only a 'Admin (Top-Level Management)' (level:3) account can update a user role access using the Admin interface. Media type => text/plain"
 *       404:
 *         description: Not found. Media type => text/plain
 *       406:
 *         description: Unacceptable action(s). Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

//update admin account role. NOt available for other user account types
router.patch(["/user/:email/role", "/:usersType/:email/role"], async (ctx) => {
	const usersType = ctx.params["usersType"] || ctx.query["type"];
	const email = ctx.params["email"];

	if (ctx.state.user.role < 3) {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = `Only a "Admin (Top-Level Management)" (level:3) account can update a user role access using the Admin interface`;
		return;
	}
	if (
		!usersType ||
		(usersType && typeof usersType !== "string") ||
		(usersType && typeof usersType === "string" && !userTypesModelMap[usersType as "admin"]) ||
		(usersType &&
			typeof usersType === "string" &&
			userTypesModelMap[usersType as "admin"] &&
			userTypesModelMap[usersType as "admin"] !== "Admin")
	) {
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message =
			"Account type missing. Note: only 'admin' account type has role feature currently, which can be either in the endpoint or as a URL query as type=admin";
		return;
	}

	try {
		if (validator.isEmail(email)) {
			const thisAccount = await Admin(ctx.sequelizeInstance!).findOne({
				where: { email: email },
			});
			if (thisAccount) {
				if (thisAccount.dataValues.role === 999) {
					ctx.status = statusCodes.NOT_ACCEPTABLE;
					ctx.message = "Dev accounts are not allowed to be modified";
					return;
				}

				const { role } = ctx.request.body as JsonObject;
				if (role) {
					const checkRoleExists = await AdminRole(ctx.sequelizeInstance!).findOne({
						where: { level: role },
					});
					if (checkRoleExists) {
						const update: { state?: boolean; role: number } = { role: role as number };
						if (role === 0) update["state"] = false;
						await thisAccount.update(update);
					} else {
						ctx.status = statusCodes.NOT_ACCEPTABLE;
						ctx.message = "The role defined does not exist. Please try a different role.";
						return;
					}

					notificationLogger({
						ctx,
						detail: `${ctx.state.user.firstName} updated ${ctx.state.userType} user account role: ${thisAccount.dataValues.firstName} (${thisAccount.dataValues.email})`,
						meta: {
							target: "Admin",
							uuid: "xxx-xxxx-xxxxx-xxxxxx",
							filter: {
								role: 2,
								operator: ">",
							},
						},
					});
					ctx.status = statusCodes.OK;
					ctx.body = { status: statusCodes.OK, statusText: "Role updated" };
					return;
				} else {
					ctx.status = statusCodes.BAD_REQUEST;
					ctx.message = "Provide a role data in Request";
					return;
				}
			} else {
				ctx.status = statusCodes.NOT_FOUND;
				ctx.message = "Requested account not found";
				return;
			}
		} else {
			throwError(statusCodes.BAD_REQUEST, "Unable to resolve a valid account email.");
		}
	} catch (err) {
		logger.error("Account role update error: ", err);
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		ctx.message = "Unable to resolve account.";
		return;
	}
});

/**
 * Delete a user account
 * @openapi
 * /auth/admin/accounts/{userType}/{email}:
 *   delete:
 *     tags:
 *       - Platform users & accounts management (Admin)
 *     summary: Delete a user account
 *     description: "Delete a user account. All account types are supported"
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *       - in: path
 *         name: userType
 *         required: true
 *         schema:
 *           type: string
 *           default: admin
 *           enum: ['user', 'admin', 'client', 'delivery_partner']
 *         description: "userType is required here. Where query 'type' is preferred for declaring user account type, simply use 'user' as placeholder here"
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: A specific valid email address is required
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           default: 'type=admin'
 *         description: "user account type 'userType' can optionally be defined in query. When this is the case, parameter {userType} should be simply used as 'user' or the parameter would be prioritised"
 *     responses:
 *       200:
 *         description: Confirmation status of action
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *                   description: Action status feedback
 *               example:
 *                 status: 200
 *                 statusText: Account deleted
 *       400:
 *         description: Bad request. Media type => text/plain
 *       401:
 *         description: "Only a 'Admin (Top-Level Management)' (level:3) account can update a user role access using the Admin interface. Media type => text/plain"
 *       404:
 *         description: Not found. Media type => text/plain
 *       406:
 *         description: Unacceptable action(s). Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

//delete an admin account, exclude dev 999 role!
router.delete(["/user/:email", "/user/:email/delete", "/:usersType/:email", "/:usersType/:email/delete"], async (ctx) => {
	const usersType = ctx.params["usersType"] || ctx.query["type"];
	const email = ctx.params["email"];

	if (ctx.state.user.role < 3) {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = `Only a "Admin (Top-Level Management)" (level:3) account can delete a user using the Admin interface`;
		return;
	}

	if (
		!usersType ||
		(usersType && typeof usersType !== "string") ||
		(usersType && typeof usersType === "string" && !userTypesModelMap[usersType as "admin"])
	) {
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message =
			"Account type missing. Define as either 'admin', 'client' or 'delivery_partner' either in the endpoint or as a URL query like type=admin";
		return;
	}

	try {
		if (validator.isEmail(email)) {
			const thisAccount = await Admin(ctx.sequelizeInstance!).findOne({
				where: { email: email },
			});
			if (thisAccount) {
				if (thisAccount.dataValues.role === 999) {
					ctx.status = statusCodes.NOT_ACCEPTABLE;
					ctx.message = "Dev accounts are not allowed to be deleted";
					return;
				}
				//protect managerial accounts that is only superceded by DEV from deletion. Write a custom route if the functionality(to delete managerial account) is otherwise needed.
				if (thisAccount instanceof Admin(ctx.sequelizeInstance!)) {
					const roles = await AdminRole(ctx.sequelizeInstance!).findAll();
					if (roles) {
						const appRoles = roles.sort((a, b) => b.dataValues.level - a.dataValues.level);
						let managerialRole;
						if (appRoles[0].dataValues.level === 999) managerialRole = appRoles[1].dataValues;
						//a double check
						else if (appRoles[appRoles.length - 1].dataValues.level === 999) managerialRole = appRoles[appRoles.length - 2].dataValues;
						if (managerialRole && thisAccount.dataValues.role === managerialRole.level) {
							ctx.status = statusCodes.NOT_ACCEPTABLE;
							ctx.message = "Managerial roles are preserved from deletion. Downgrade this account role to allow deletion.";
							return;
						}
					}
				}
				// perform action if execution gets here! All account has paranoid mode enabled by default
				await thisAccount.update({ role: 0 });
				await thisAccount.destroy();

				notificationLogger({
					ctx,
					detail: `${ctx.state.user.firstName} deleted existing ${ctx.state.userType} user account: ${thisAccount.dataValues.firstName} (${thisAccount.dataValues.email})`,
					meta: {
						target: "Admin",
						uuid: "xxx-xxxx-xxxxx-xxxxxx",
						filter: {
							role: 2,
							operator: ">",
						},
					},
				});
				ctx.status = statusCodes.OK;
				ctx.body = { status: statusCodes.OK, statusText: "Account deleted" };
				return;
			} else {
				ctx.status = statusCodes.NOT_FOUND;
				ctx.message = "Requested account not found";
				return;
			}
			/* ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "Unable to identify account role hierarchy. Please reachout to the App Developer";
			return; */
		} else {
			throwError(statusCodes.BAD_REQUEST, "Unable to resolve a valid account email.");
		}
	} catch (err) {
		logger.error("Account delete error: ", err);
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		ctx.message = "Unable to resolve account.";
		return;
	}
});

export { router as allPlatformUserAccounts };
