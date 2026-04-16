/* Admin Accounts management */
import {
	OK,
	CREATED,
	CONFLICT,
	SERVICE_UNAVAILABLE,
	BAD_REQUEST,
	NOT_FOUND,
	NOT_ACCEPTABLE,
	SERVER_ERROR,
	UNAUTHORIZED,
} from "../../../constants/statusCodes.js";
import * as accountController from "../../../controllers/account.controller.js";

import validator from "validator";
import { Model } from "sequelize";
import { Router } from "../../../middlewares/router.js";
import { requestParser } from "../../../middlewares/requestParser.js";

const router = Router({
	prefix: "/admin-accounts",
});
/*
Default Role definations:
    0. Inactive
    1. Active
    2. Editor
    3. Admin
    4. Manager
    999. Dev
*/

router.use(
	async (ctx, next) => {
		if (ctx.method.toLowerCase() !== "get" && ctx.state.user.role < 4) {
			ctx.status = UNAUTHORIZED;
			ctx.message = "Admin user does not have the required permission.";
			return;
		} else await next();
	},
	requestParser({ multipart: true }),
);

//fetch all accounts
router.get(
	"/",
	async (ctx, next) => {
		if (ctx.path === ctx.url) {
			ctx.url = ctx.url + "?sort[created=ASC]&page[limit=10]";
		}
		await next();
	},
	dbQuerier({ ignoreStateFiltration: true }),
	async (ctx, next) => {
		//console.log("ctx.state.dbQuerier", ctx.state.dbQuerier);
		//inject acccount access timestamps model
		ctx.state.data = await ctx.sequelizeInstance!.transaction(async (t) => {
			const users = await modelUserAdmin(ctx.sequelizeInstance!)
				.scope("management")
				.findAll({
					...ctx.state.dbQuerier,
					transaction: t,
				});
			//console.log("users:", users);
			const getTimestampsIDs: string[] = [];
			const getTimestamps: Promise<Model | null>[] = [];
			users.forEach((account) => {
				getTimestampsIDs.push(account.dataValues.uuid);
				getTimestamps.push(
					UserAccessTimestamp(ctx.sequelizeInstance!).findByPk(account.dataValues.uuid, {
						transaction: t,
					}),
				);
			});
			const GetTimestamps = await Promise.all(getTimestamps);
			//convert getTimestampsIDs to object
			const UsersAccessTimestamp: { [uuid: string]: Model } = {};
			GetTimestamps.forEach((userTimestamp, index) => {
				const timestamp = userTimestamp?.toJSON();
				const ID = getTimestampsIDs[index];
				if (timestamp && ID) UsersAccessTimestamp[ID] = timestamp;
			});
			//console.log("UsersAccessTimestamps:", UsersAccessTimestamps);

			// Get defined website roles
			const UserRoles = await Role(ctx.sequelizeInstance!).findAll({
				transaction: t,
			});

			if (users)
				return users.map((account) => {
					const thisAccount = account.toJSON();
					if (UsersAccessTimestamp[thisAccount.uuid]) {
						thisAccount.access = UsersAccessTimestamp[thisAccount.uuid];
					}
					if (UserRoles)
						for (let i = 0; i < UserRoles.length; i++) {
							const role = UserRoles[i];
							if (role.dataValues.level === thisAccount.role) {
								thisAccount["roleLabel"] = role.dataValues.label;
								break;
							}
						}
					return thisAccount;
				});
			else return;
		});
		//console.log("ctx.state.data:", ctx.state.data);
		await next();
	},
	(ctx) => {
		if (ctx.state.data) {
			ctx.status = OK;
			ctx.body = {
				status: OK,
				data: ctx.state.data,
			};
			return;
		}
		ctx.status = BAD_REQUEST;
		return;
	},
);

//view per admin user
router.get(
	"/:email",
	async (ctx, next) => {
		const thisAccount = await ctx.sequelizeInstance!.transaction(async (t) => {
			const thisAccountProfile = await Admin(ctx.sequelizeInstance!)
				.scope("management")
				.findOne({
					where: { email: ctx.params.email },
					transaction: t,
				});
			let accessTimestamps;
			let roleLabel;
			if (thisAccountProfile instanceof Admin) {
				accessTimestamps = await UserAccessTimestamp(ctx.sequelizeInstance!).findByPk(thisAccountProfile.dataValues.uuid, {
					transaction: t,
				});
				await Role(ctx.sequelizeInstance!)
					.findByPk(thisAccountProfile.dataValues.role, {
						transaction: t,
					})
					.then((res) => {
						roleLabel = res?.dataValues.label;
					});
				return {
					...thisAccountProfile.toJSON(),
					access: accessTimestamps ? accessTimestamps.toJSON() : null,
					roleLabel: roleLabel,
				};
			}
			return;
		});
		if (thisAccount) {
			ctx.state.data = { data: thisAccount };
		} else {
			ctx.state.error = { message: "User not found." };
		}
		await next();
	},
	(ctx) => {
		if (ctx.state.error) {
			ctx.status = BAD_REQUEST;
			ctx.message = ctx.state.error.message;
			return;
		}
		if (!ctx.state.data) {
			ctx.status = NOT_FOUND;
			return (ctx.body = {});
		}
		ctx.status = OK;
		ctx.body = {
			status: OK,
			...ctx.state.data,
		};
		return;
	},
);

//create new admin account
router.post(
	"/create",
	async (ctx, next) => {
		if (ctx.request.body && ctx.request.body.role) ctx.request.body.role = Number(ctx.request.body.role);
		await next();
	},
	formValidator.createAccount,
	async (ctx, next) => {
		ctx.state.userType = "Admin";
		await next();
	},
	checkAccount(false),
	async (ctx, next) => {
		if (ctx.state.error) {
			if (ctx.state.error.code === CONFLICT) {
				ctx.status = CONFLICT;
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
	accountController.createAdminAccount,
	(ctx) => {
		if (ctx.state.newUser) {
			const profileData = {
				status: CREATED,
				account: ctx.state.newUser.toJSON(),
				message: "Account created.",
			};
			ctx.status = OK;
			return (ctx.body = profileData);
		} else {
			ctx.status = SERVICE_UNAVAILABLE;
			ctx.message = "Account creation failed.";
			return;
		}
	},
);

//suspend or activate/reactivate an admin account
router.get("/:email/suspend/:action", async (ctx) => {
	try {
		if (validator.isEmail(ctx.params.email)) {
			const thisAccount = await Admin(ctx.sequelizeInstance!).findOne({
				where: { email: ctx.params.email },
			});
			if (thisAccount) {
				if (thisAccount.dataValues.role === 999) {
					ctx.status = NOT_ACCEPTABLE;
					ctx.message = "Dev accounts are not allowed to be suspended";
					return;
				}
				//protect managerial accounts that is only superceded by DEV from suspension. Write a custom route if the functionality(to suspend managerial account) is otherwise needed.
				const roles = await Role(ctx.sequelizeInstance!).findAll();
				if (roles) {
					const appRoles = roles.sort((a, b) => b.dataValues.level - a.dataValues.level);
					let managerialRole;
					if (appRoles[0].dataValues.level === 999) managerialRole = appRoles[1].dataValues;
					//a double check
					else if (appRoles[appRoles.length - 1].dataValues.level === 999) managerialRole = appRoles[appRoles.length - 2].dataValues;

					if (managerialRole) {
						if (thisAccount.dataValues.role === managerialRole.level && ctx.params.action !== "activate") {
							ctx.status = NOT_ACCEPTABLE;
							ctx.message = "Managerial roles are preserved from suspension. Downgrade this account role to allow suspension.";
							return;
						} else {
							if (ctx.params.action === "activate") {
								let updates: { state: boolean; role?: number } = {
									state: true,
								};
								if (thisAccount.dataValues.role === 0) updates = { ...updates, role: 1 };
								await thisAccount.update(updates);
								ctx.status = OK;
								ctx.body = { status: OK, statusText: "Account activated" };
								return;
							} else {
								await thisAccount.update({ state: false });
								ctx.status = OK;
								ctx.body = { status: OK, statusText: "Account suspended" };
								return;
							}
						}
					}
				}
			} else {
				ctx.status = NOT_FOUND;
				ctx.message = "Requested account not found";
				return;
			}
			ctx.status = SERVER_ERROR;
			ctx.message = "Unable to identify account role hierarchy. Please reachout to the App Developer";
			return;
		} else {
			ctx.throw(BAD_REQUEST, "Unable to resolve a valid account email.");
		}
	} catch (err) {
		logger.error("Account suspension error: ", err);
		ctx.status = SERVICE_UNAVAILABLE;
		ctx.message = "Unable to resolve account.";
		return;
	}
});

// update admin account role
router.patch("/:email/role", async (ctx) => {
	try {
		if (validator.isEmail(ctx.params.email)) {
			const thisAccount = await Admin(ctx.sequelizeInstance!).findOne({
				where: { email: ctx.params.email },
			});
			if (thisAccount) {
				if (thisAccount.dataValues.role === 999) {
					ctx.status = NOT_ACCEPTABLE;
					ctx.message = "Dev accounts are not allowed to be modified";
					return;
				}

				const { role } = ctx.request.body as JsonObject;
				if (role) {
					const checkRoleExists = await Role(ctx.sequelizeInstance!).findOne({
						where: { level: role },
					});
					if (checkRoleExists) {
						const update: { state?: boolean; role: number } = { role: role as number };
						if (role === 0) update["state"] = false;
						await thisAccount.update(update);
					} else {
						ctx.status = SERVER_ERROR;
						ctx.message = "The role defined does not exist. Please try a different role.";
						return;
					}
					ctx.status = OK;
					ctx.message = "Role updated";
					return;
				} else {
					ctx.status = BAD_REQUEST;
					ctx.message = "Provide a role data in Request";
					return;
				}
			} else {
				ctx.status = NOT_FOUND;
				ctx.message = "Requested account not found";
				return;
			}
		} else {
			ctx.throw(BAD_REQUEST, "Unable to resolve a valid account email.");
		}
	} catch (err) {
		logger.error("Account role update error: ", err);
		ctx.status = SERVICE_UNAVAILABLE;
		ctx.message = "Unable to resolve account.";
		return;
	}
});

//delete an admin account, exclude dev 999 role!
router.delete(["/:email", "/:email/delete"], async (ctx) => {
	try {
		if (validator.isEmail(ctx.params.email)) {
			const thisAccount = await Admin(ctx.sequelizeInstance!).findOne({
				where: { email: ctx.params.email },
			});
			if (thisAccount) {
				if (thisAccount.dataValues.role === 999) {
					ctx.status = NOT_ACCEPTABLE;
					ctx.message = "Dev accounts are not allowed to be deleted";
					return;
				}
				//protect managerial accounts that is only superceded by DEV from deletion. Write a custom route if the functionality(to delete managerial account) is otherwise needed.
				const roles = await Role(ctx.sequelizeInstance!).findAll();
				if (roles) {
					const appRoles = roles.sort((a, b) => b.dataValues.level - a.dataValues.level);
					let managerialRole;
					if (appRoles[0].dataValues.level === 999) managerialRole = appRoles[1].dataValues;
					//a double check
					else if (appRoles[appRoles.length - 1].dataValues.level === 999) managerialRole = appRoles[appRoles.length - 2].dataValues;
					if (managerialRole) {
						if (thisAccount.dataValues.role === managerialRole.level) {
							ctx.status = NOT_ACCEPTABLE;
							ctx.message = "Managerial roles are preserved from deletion. Downgrade this account role to allow deletion.";
							return;
						} else {
							await thisAccount.update({ role: 0 });
							await thisAccount.destroy();
							ctx.status = OK;
							ctx.body = { status: OK, statusText: "Account deleted" };
							return;
						}
					}
				}
			} else {
				ctx.status = NOT_FOUND;
				ctx.message = "Requested account not found";
				return;
			}
			ctx.status = SERVER_ERROR;
			ctx.message = "Unable to identify account role hierarchy. Please reachout to the App Developer";
			return;
		} else {
			ctx.throw(BAD_REQUEST, "Unable to resolve a valid account email.");
		}
	} catch (err) {
		logger.error("Account delete error: ", err);
		ctx.status = SERVICE_UNAVAILABLE;
		ctx.message = "Unable to resolve account.";
		return;
	}
});

export default router;
