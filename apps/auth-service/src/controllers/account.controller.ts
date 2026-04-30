import { ParameterizedContext, Next, DefaultContext } from "koa";
import Passport from "koa-passport";
import {
	alphaNumericCodeGenerator,
	getOffsetTimestamp,
	mailSender,
	otpLinkGenerator,
	userAccessTimestampsLog,
	authenticateEncryptedToken,
	decryptToken,
	encryptionToken,
	validate2faCode,
	statusCodes,
	logger,
	otpLinkVerifier,
	UserSecurity,
	defaultMailTemplate,
	comparePassword,
	hashPassword,
	UserAccessTimestamp,
	OTP,
} from "@medlink/common";

import fs from "node:fs";
import compose from "koa-compose";
import { Op, Sequelize } from "sequelize";
import config from "../../app.config.js";
import { Cache, redis } from "../performance.controller.js";

const { googleID, googleSECRET, fbID, fbSECRET } = process.env;

type JsonValue = string | number | boolean | null | undefined | JsonObject | JsonArray;
type JsonObject = {
	[key: string]: JsonValue;
};
type JsonArray = Array<JsonValue>;
interface extendedParameterizedContext extends ParameterizedContext {
	request: DefaultContext["request"] & {
		body?: JsonValue;
		files?: [string, File]; // [formidable.Fields<string>, formidable.Files<string>]
		rawBody?: unknown;
	};
	sequelizeInstance?: Sequelize;
}

//useful to structure model names as should be, enforcing capital first letter which is general convention in greybox
// decrecate this
// const capitaliseModel = (model: string) => {
// 	return model.substring(0, 1).toUpperCase() + model.substring(1).toLowerCase();
// };

/** 
  @param {object} [options] // could be set on Request header if using middleware with custom non-core user model.
  @param {string|"core"|boolean} [options.userRole] 
  @param {string} [options.userType] 
  @param {string|number} [options.accessTokenLifetime] 15 minutes '15 m' is used as default
  @param {number} [options.refreshTokenLifetime] unit is in days. Typically 30 days is used as default
  @prop {Object}  ctx.header 
  @property {string} "x-usertype" - could be set on Request header if using middleware with custom non-core user model.
  @property {string} "x-userRole" - could be set on Request header if using middleware with custom non-core user model.
  @description Account local signing in access controller. Header values always supercedes middleware values when each is present.
  Though user role can be imported with middleware argument key "userRole", "x-userrole" can alternatively be defined in request header as well to target a specific role model which will supercede userRole import in middleware. Setting userRole as false disables role checks
 */
const signAccountInLocal =
	(
		options: {
			userRole?: string | boolean | "core";
			userType?: string;
			signInType?: ((ctx: extendedParameterizedContext) => "email" | "phoneNumber") | "email" | "phoneNumber";
			accessTokenLifetime?: ((ctx: extendedParameterizedContext) => string | number) | string | number;
			refreshTokenLifetime?: ((ctx: extendedParameterizedContext) => number) | number;
		} | void,
	) =>
	async (ctx: extendedParameterizedContext, next: Next) => {
		const localSignInType =
			options && options.signInType ? (typeof options.signInType === "function" ? options.signInType(ctx) : options.signInType) : "email";
		const check2FAroute = ctx.path.includes("/sign-in/2fa") ? true : false;
		// define user type
		if (!ctx.header["x-usertype"])
			ctx.header["x-usertype"] = ctx.headers["x-send-to-admin-route"] ? "Admin" : ctx.state.userType ? ctx.state.userType : undefined;
		// we are prioritsing  options.userType if it exists
		if (options && options.userType) ctx.header["x-usertype"] = options.userType;
		// if still nothing
		if (!ctx.header["x-usertype"]) {
			ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "Unable to determine account model/type";
			return;
		}
		if (!ctx.sequelizeInstance) {
			logger.error("signAccountInLocal Error: ", "No active ctx.sequelizeInstance to match request to!");
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			return;
		}

		//define role if not falsified
		const headerRequestXrole = ctx.header["x-userrole"]
			? (ctx.header["x-userrole"] as string).toLowerCase() === "false"
				? false
				: (ctx.header["x-userrole"] as string)
			: undefined;
		const accountRoleModelType =
			headerRequestXrole === false
				? false
				: headerRequestXrole
					? headerRequestXrole.toLowerCase() === "true"
						? "Role"
						: headerRequestXrole
					: options && options.userRole !== false
						? options.userRole
							? typeof options.userRole === "boolean"
								? "Role"
								: options.userRole
							: "Role"
						: false;

		try {
			if (!check2FAroute) {
				return Passport.authenticate(localSignInType === "phoneNumber" ? "phoneNumber" : "local", async (err, user) => {
					if (err) {
						logger.error("Error:", err);
						ctx.status = statusCodes.SERVICE_UNAVAILABLE;
						ctx.message = "Authentication service is unavailable";
						return;
					}
					// console.log("user in singInLocal: ", user);
					if (!user) {
						ctx.status = statusCodes.NOT_FOUND;
						ctx.message =
							localSignInType === "phoneNumber" ? "Oops! Incorrect phone number or password" : "Oops! Incorrect email or password";
						return;
					} else {
						//check 2fa status of USER
						let twoFAstatus;
						const userSecurity = await UserSecurity(ctx.sequelizeInstance!).scope("raw").findByPk(user.dataValues.uuid);
						if (userSecurity instanceof UserSecurity) {
							const validators2FA = userSecurity.dataValues["security"] && userSecurity.dataValues["security"]["2fa"];
							twoFAstatus = validators2FA && validators2FA["verified"] ? true : false;
						}
						// console.log("userSecurity", userSecurity);
						if (!twoFAstatus) {
							//log signin to user signing-in access stream
							const access = await userAccessTimestampsLog(ctx.sequelizeInstance!, {
								userUUID: user.dataValues.uuid,
								signedInTime: true,
							});
							const extraData: { access: object; roleLabel?: string } = {
								access: access,
							};
							//get corresponding role to ID if required
							if (accountRoleModelType) {
								const role = await ctx.sequelizeInstance!.models[accountRoleModelType === "core" ? "Role" : accountRoleModelType].findByPk(
									user.dataValues.role,
								);
								if (role && role.dataValues && role.dataValues["label"]) extraData["roleLabel"] = role.dataValues["label"];
							}
							//console.log("user: ", user.toJSON());
							let accountData: {
								status: number;
								account: object;
								token?: string;
								refreshToken?: string;
							} = {
								status: statusCodes.OK,
								account: {
									...user.toJSON(),
									...extraData,
								},
							};

							if (ctx.header["x-requesttoken"]) {
								const requestToken = ctx.header["x-requesttoken"];
								if (requestToken === "token") {
									let accessTokenLifetime =
										options && options.accessTokenLifetime
											? typeof options.accessTokenLifetime === "function"
												? options.accessTokenLifetime(ctx)
												: options.accessTokenLifetime
											: undefined; /* ? options.accessTokenLifetime : "15m" */
									const refreshTokenLifetime =
										options && options.refreshTokenLifetime
											? typeof options.refreshTokenLifetime === "function"
												? options.refreshTokenLifetime(ctx)
												: options.refreshTokenLifetime
											: config.refreshTokenLifetime;

									// Using refresh token is auto disabled if access token is greater than 3 hour and refreshTokenLifetime || accesssTokenLifetime is not explicitly set
									let ignoreRefreshToken: true | undefined = undefined;
									if (accessTokenLifetime) {
										let getTokenLifetime: number | undefined =
											typeof accessTokenLifetime === "string"
												? (!isNaN(Number(accessTokenLifetime)) && Number(accessTokenLifetime)) ||
													Number(accessTokenLifetime.substring(0, accessTokenLifetime.length - 1))
												: accessTokenLifetime;

										if (!isNaN(getTokenLifetime)) {
											let getTokenLifetimeUnit: string | number | undefined =
												typeof accessTokenLifetime === "string" ? accessTokenLifetime.split(getTokenLifetime.toString())[1] : undefined;

											if (!getTokenLifetimeUnit) {
												getTokenLifetimeUnit = "d";
												accessTokenLifetime = accessTokenLifetime + getTokenLifetimeUnit;
											}

											getTokenLifetimeUnit =
												getTokenLifetimeUnit === "m" // minute
													? 1000 * 60
													: getTokenLifetimeUnit === "d" // day
														? 1000 * 60 * 60 * 24
														: undefined;
											getTokenLifetime = getTokenLifetimeUnit && getTokenLifetime * Number(getTokenLifetimeUnit);
											// clear accessToken if getTokenLifetime is nullifid

											if (!getTokenLifetime) accessTokenLifetime = undefined;

											// three hour time
											ignoreRefreshToken = getTokenLifetime && getTokenLifetime > 1000 * 60 * 60 * 3 ? true : undefined;
										}
									}

									// where access token isn't expicitly set, we check config
									if (!accessTokenLifetime) {
										accessTokenLifetime =
											config.authTokenLifetime && !isNaN(Number(config.authTokenLifetime)) ? config.authTokenLifetime + "m" : "3d";
										// if (!refreshTokenLifetime) ignoreRefreshToken = true;
									}

									const token = await encryptionToken(accountData.account, {
										expiresIn: typeof accessTokenLifetime === "number" ? accessTokenLifetime + "d" : accessTokenLifetime,
									});

									if (typeof token === "string") {
										accountData = {
											...accountData,
											token: token,
										};

										const checkRefreshEnablement = !ignoreRefreshToken
											? refreshTokenLifetime
												? refreshTokenLifetime
												: config.authTokenLifetime
													? config.authTokenLifetime
													: undefined
											: undefined;
										if (checkRefreshEnablement) {
											const refreshToken = await encryptionToken(
												(await encryptionToken(accountData.account, {
													expiresIn: checkRefreshEnablement + "d",
												})) as string,
												{
													expiresIn: checkRefreshEnablement + "d",
												},
											);
											if (typeof refreshToken === "string") {
												accountData["refreshToken"] = refreshToken;
												// we store refresh in redis for tracking. Cache can alternatively be used if enabled in config
												const tokenStorage = redis ? redis : config.useCacheAsRedisIsNotAvailable ? Cache : null;
												if (tokenStorage)
													tokenStorage.set(`refresh:${accountData.account["uuid" as keyof typeof accountData.account]}`, refreshToken);
											}
										}

										//save token in websocket if available
										if (ctx.ioSocket)
											ctx.ioSocket.auth = ctx.ioSocket.auth
												? { ...ctx.ioSocket.auth, token: token, refreshToken: accountData["refreshToken"] }
												: { token: token, refreshToken: accountData["refreshToken"] };
									} else {
										ctx.status = statusCodes.SERVICE_UNAVAILABLE;
										ctx.message = "Currently unable to generate user access token.";
										return;
									}
								} else if (requestToken === "session") {
									await ctx.login(accountData.account);
								}
							}
							ctx.status = statusCodes.OK;
							return (ctx.body = accountData);
						} else {
							user = user.toJSON();
							//Encode User UUID and send to frontend, expecting encoded UUID and passcode in subsequent request
							const encodedUUID = await encryptionToken(
								{
									uuid: user.uuid,
									type: (options && options.userType) || ctx.state.userType || user.type,
									signInType: ctx.header["x-requesttoken"],
									accessTokenLifetime: options && options.accessTokenLifetime,
								},
								{
									expiresIn: "180s",
								},
							);
							ctx.status = statusCodes.REDIRECTED;
							return (ctx.body = {
								data: { token: encodedUUID },
								status: statusCodes.REDIRECTED,
								statusText:
									"2FA is enabled on account. Get authenticator code and submit to the 2fa endpoint with the attached 'token' in this response. Token valid for 3 minutes",
							});
						}
					}
				})(ctx, next);
			} else {
				const { passcode, token } = ctx.request.body;
				//Let decode the passcode attached from frontend which was earlier sent by the backend
				let decodedUser: { uuid?: string; type?: string; signInType?: string; accessTokenLifetime?: string | number };
				const decryption = await decryptToken(token);
				//console.log("decryption: ", decryption);

				if (decryption && decryption.result) decodedUser = decryption.result;
				else if (!decryption || (decryption && !decryption["result" as keyof typeof decryption])) {
					ctx.status = statusCodes.BAD_REQUEST;
					ctx.message = "Invalid token provided";
					return;
				} else {
					ctx.status = statusCodes.SERVICE_UNAVAILABLE;
					ctx.message = "2FA verification currently unavailable. Please try again later";
					return;
				}
				//console.log("decodedUser", decodedUser);
				const userUUID = decodedUser && decodedUser.uuid;
				const userTYPE = decodedUser && decodedUser.type;
				if (userUUID && userTYPE) {
					// Process user
					const user = await ctx.sequelizeInstance!.transaction(async (t) => {
						const thisUser = await ctx.sequelizeInstance!.models[userTYPE].findOne({ where: { uuid: userUUID }, transaction: t });
						if (thisUser) {
							//GET user security detail
							const userSecurity = await UserSecurity(ctx.sequelizeInstance!).scope("raw").findByPk(userUUID, {
								transaction: t,
							});
							if (userSecurity instanceof UserSecurity === false) {
								ctx.status = statusCodes.SERVER_ERROR;
								ctx.message = "Unable to verify the security feature of this account. Please contact an admin";
								return;
								//throw new Error("Unable to verify the security feature of this account. Please contact an admin");
							}
							const validators2FA = userSecurity.dataValues["security"] && userSecurity.dataValues["security"]["2fa"];
							const twoFAsecret = validators2FA && validators2FA["secret"];

							// confirm 2FA passcode
							const confirm2FA = validate2faCode({
								passcode: passcode,
								userSecret: twoFAsecret,
							});
							if (!confirm2FA) {
								ctx.status = statusCodes.BAD_REQUEST;
								ctx.message = "Incorrect authentication code";
								return;
								//throw new Error("Incorrect authentication code");
							}

							//log signin to user signing-in access stream
							const access = await userAccessTimestampsLog(ctx.sequelizeInstance!, {
								userUUID: userUUID,
								signedInTime: true,
							});
							const extraData: { access: object; roleLabel?: string } = {
								access: access,
							};

							//get corresponding role to ID if required
							if (accountRoleModelType) {
								const role = await ctx.sequelizeInstance!.models[accountRoleModelType === "core" ? "Role" : accountRoleModelType].findByPk(
									thisUser.dataValues.role,
								);
								if (role && role.dataValues && role.dataValues["label"]) extraData["roleLabel"] = role.dataValues["label"];
							}

							//console.log("user: ", user.toJSON());
							let accountData: {
								status: number;
								account: object;
								token?: string;
								refreshToken?: string;
							} = {
								status: statusCodes.OK,
								account: {
									...thisUser.toJSON(),
									...extraData,
								},
							};

							if (decodedUser.signInType) {
								const requestToken = decodedUser.signInType;
								if (requestToken === "token") {
									let accessTokenLifetime =
										options && options.accessTokenLifetime
											? typeof options.accessTokenLifetime === "function"
												? options.accessTokenLifetime(ctx)
												: options.accessTokenLifetime
											: undefined; /* ? options.accessTokenLifetime : "15m" */

									// accessTokenLifetime may alternatively be embedded in 2fa redirect token as available during initial form submission and may be ignored on 2fa validation form
									if (!accessTokenLifetime && decodedUser.accessTokenLifetime) accessTokenLifetime = decodedUser.accessTokenLifetime;

									const refreshTokenLifetime =
										options && options.refreshTokenLifetime
											? typeof options.refreshTokenLifetime === "function"
												? options.refreshTokenLifetime(ctx)
												: options.refreshTokenLifetime
											: config.refreshTokenLifetime;

									// Using refresh token is auto disabled if access token is greater than 3 hour and refreshTokenLifetime || accesssTokenLifetime is not explicitly set
									let ignoreRefreshToken: true | undefined = undefined;
									if (accessTokenLifetime) {
										let getTokenLifetime: number | undefined =
											typeof accessTokenLifetime === "string"
												? (!isNaN(Number(accessTokenLifetime)) && Number(accessTokenLifetime)) ||
													Number(accessTokenLifetime.substring(0, accessTokenLifetime.length - 1))
												: accessTokenLifetime;

										if (!isNaN(getTokenLifetime)) {
											let getTokenLifetimeUnit: string | number | undefined =
												typeof accessTokenLifetime === "string" ? accessTokenLifetime.split(getTokenLifetime.toString())[1] : undefined;

											if (!getTokenLifetimeUnit) {
												getTokenLifetimeUnit = "d";
												accessTokenLifetime = accessTokenLifetime + getTokenLifetimeUnit;
											}

											getTokenLifetimeUnit =
												getTokenLifetimeUnit === "m" // minute
													? 1000 * 60
													: getTokenLifetimeUnit === "d" // day
														? 1000 * 60 * 60 * 24
														: undefined;
											getTokenLifetime = getTokenLifetimeUnit && getTokenLifetime * Number(getTokenLifetimeUnit);
											// clear accessToken if getTokenLifetime is nullifid
											if (!getTokenLifetime) accessTokenLifetime = undefined;
											// 3 hour time
											ignoreRefreshToken = getTokenLifetime && getTokenLifetime > 1000 * 60 * 60 * 3 ? true : undefined;
										}
									}

									// where access token isn't expicitly set, we check config
									if (!accessTokenLifetime) {
										accessTokenLifetime =
											config.authTokenLifetime && !isNaN(Number(config.authTokenLifetime)) ? config.authTokenLifetime + "m" : "3d";
										// if (!refreshTokenLifetime) ignoreRefreshToken = true;
									}

									const token = await encryptionToken(accountData.account, {
										expiresIn: typeof accessTokenLifetime === "number" ? accessTokenLifetime + "d" : accessTokenLifetime,
									});
									if (typeof token === "string") {
										accountData = {
											...accountData,
											token: token,
										};

										const checkRefreshEnablement = !ignoreRefreshToken
											? refreshTokenLifetime
												? refreshTokenLifetime
												: config.authTokenLifetime
													? config.authTokenLifetime
													: undefined
											: undefined;
										if (checkRefreshEnablement) {
											const refreshToken = await encryptionToken(
												(await encryptionToken(accountData.account, {
													expiresIn: checkRefreshEnablement + "d",
												})) as string,
												{
													expiresIn: checkRefreshEnablement + "d",
												},
											);
											if (typeof refreshToken === "string") {
												accountData["refreshToken"] = refreshToken;
												// we store refresh in redis for tracking. Cache can alternatively be used if enabled in config
												const tokenStorage = redis ? redis : config.useCacheAsRedisIsNotAvailable ? Cache : null;
												if (tokenStorage)
													tokenStorage.set(`refresh:${accountData.account["uuid" as keyof typeof accountData.account]}`, refreshToken);
											}
										}

										//save token in websocket if available
										if (ctx.ioSocket)
											ctx.ioSocket.auth = ctx.ioSocket.auth
												? { ...ctx.ioSocket.auth, token: token, refreshToken: accountData["refreshToken"] }
												: { token: token, refreshToken: accountData["refreshToken"] };
									} else {
										ctx.status = statusCodes.SERVICE_UNAVAILABLE;
										ctx.message = "Currently unable to generate user access token.";
										return;
									}
								} else if (requestToken === "session") {
									await ctx.login(accountData.account);
								}
							}
							return accountData;
						} else return;
					});
					if (user) {
						ctx.status = statusCodes.OK;
						return (ctx.body = user);
					} else {
						// ensure to not override an alreadt set status
						if (!ctx.status) {
							ctx.status = statusCodes.NOT_FOUND;
							ctx.message = "Account does not exist";
						}
						return;
					}
				} else {
					ctx.status = statusCodes.NOT_FOUND;
					ctx.message = "Oops. We cannot sign you in currently. Please try sign-in later";
					return;
				}
			}
		} catch (err: unknown) {
			logger.error("signAccountInLocal middleware sign-in Error: ", err);
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			ctx.message = "Oops. Currently unable to sign you in";
			return;
		}
	};

/* Allow to sign a user in with OTP code for one time session access */
const signAccountInOTP =
	(options: { userRole?: string | boolean | "core"; userType?: string } | void) =>
	async (ctx: extendedParameterizedContext, next: Next) => {
		// define user type
		const userType = ctx.header["x-usertype"]
			? (ctx.header["x-usertype"] as string)
			: options && options.userType
				? options.userType
				: ctx.state.userType
					? ctx.state.userType
					: undefined;
		if (!userType) {
			ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "Unable to determine account model/type";
			return;
		} else if (!ctx.sequelizeInstance) {
			logger.error("signAccountInOTP Error: ", "No active ctx.sequelizeInstance to match request to!");
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			return;
		}
		//define role if not falsified
		const headerRequestXrole = ctx.header["x-userrole"]
			? (ctx.header["x-userrole"] as string).toLowerCase() === "false"
				? false
				: (ctx.header["x-userrole"] as string)
			: undefined;
		const accountRoleModelType =
			headerRequestXrole === false
				? false
				: headerRequestXrole
					? headerRequestXrole.toLowerCase() === "true"
						? "Role"
						: headerRequestXrole
					: options && options.userRole !== false
						? options.userRole
							? typeof options.userRole === "boolean"
								? "Role"
								: options.userRole
							: "Role"
						: false;
		const emailorPhoneNumber = await otpLinkVerifier(ctx);
		try {
			const user = await ctx.sequelizeInstance!.models[userType].scope("raw").findOne({
				where: {
					[Op.or]: [
						{
							email: { [Op.eq]: emailorPhoneNumber, [Op.not]: null },
						},
						{
							phoneNumber: { [Op.eq]: emailorPhoneNumber, [Op.not]: null },
						},
					],
				},
			});
			if (user && user instanceof ctx.sequelizeInstance!.models[userType]) {
				//log signin to user signing-in access stream
				const access = await userAccessTimestampsLog(ctx.sequelizeInstance!, {
					userUUID: user.dataValues.uuid,
					signedInTime: true,
				});
				const extraData: { access: object; roleLabel?: string } = {
					access: access,
				};
				//get corresponding role to ID if required
				if (accountRoleModelType) {
					const role = await ctx.sequelizeInstance!.models[accountRoleModelType === "core" ? "Role" : accountRoleModelType].findByPk(
						user.dataValues.role,
					);
					if (role && role.dataValues && role.dataValues["label"]) extraData["roleLabel"] = role.dataValues["label"];
				}
				//console.log("user: ", user.toJSON());
				let accountData: {
					status: number;
					account: object;
					token?: string;
				} = {
					status: statusCodes.OK,
					account: {
						...user.toJSON(),
						...extraData,
					},
				};
				if (ctx.header["x-requesttoken"]) {
					const requestToken = ctx.header["x-requesttoken"];
					if (requestToken === "token") {
						const token = await encryptionToken(accountData.account);
						if (typeof token === "string") {
							accountData = {
								...accountData,
								token: token,
							};
							//save token in websocket if available
							if (ctx.ioSocket) ctx.ioSocket.auth = ctx.ioSocket.auth ? { ...ctx.ioSocket.auth, token: token } : { token: token };
						} else {
							ctx.status = statusCodes.SERVICE_UNAVAILABLE;
							ctx.message = "Currently unable to generate user access token.";
							return;
						}
					} else if (requestToken === "session") {
						await ctx.login(accountData.account);
					}
				}
				if (!next) {
					ctx.status = statusCodes.OK;
					return (ctx.body = accountData);
				} else {
					ctx.state.user = accountData;
					await next();
				}
			} else {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "Currenty unable to identify account to sign in";
				return;
			}
		} catch (err: unknown) {
			logger.error("signAccountInOTP middleware sign-in Error: ", err);
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			ctx.message = "Oops. Currently unable to sign you in";
			return;
		}
	};

const updateAccount = (options?: { userType?: string }) => async (ctx: extendedParameterizedContext, next: Next) => {
	const userType =
		options && options.userType
			? options.userType
			: ctx.header["x-usertype"]
				? ctx.header["x-usertype"]
				: ctx.state.user.type
					? ctx.state.user.type
					: undefined;
	if (!userType) {
		ctx.status = statusCodes.SERVER_ERROR;
		ctx.message = "Unable to determine account model/type";
		return;
	} else if (!ctx.sequelizeInstance) {
		logger.error("updateAccount Error: ", "No active ctx.sequelizeInstance to match request to!");
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		return;
	}
	try {
		const user = await ctx.sequelizeInstance!.models[userType].findByPk(ctx.state.user.uuid);
		if (user) {
			//remove former avatar from server if avatar keys exists
			let errorRemovingFormerAvatar = false;
			if (user.dataValues.avatar && ctx.request.body.avatar) {
				fs.unlink(process.cwd() + user.dataValues.avatar, (err: unknown) => {
					if (err) errorRemovingFormerAvatar = true;
				});
			}
			// Clean up image if new upload unsuccessful
			if (errorRemovingFormerAvatar) {
				delete ctx.request.body.avatar;
				fs.unlinkSync(process.cwd() + ctx.request.body.avatar);
			}
			const updatedUser = await user.update(ctx.request.body);
			ctx.state.updatedUser = updatedUser.toJSON();
		} else {
			ctx.status = statusCodes.NOT_MODIFIED;
			ctx.message = "Unable to update account";
			return;
		}
	} catch (err) {
		logger.error("Account update error:", err);
		ctx.status = statusCodes.SERVER_ERROR;
		ctx.message = "Unable to update account";
		return;
	}
	await next();
};

/* export const deleteAvatar = async (ctx:extendedParameterizedContext, next:Next) => {
	try {
	  const user = await sequelize.models[capitaliseModel(ctx.state.user.type)].findOne({
		where: { email: ctx.state.user.email },
	  });
  
	  if (user && user.avatar) {
		fs.unlinkSync(process.cwd() +user.avatar, (err) => {
		  if (err) {
			ctx.state.error = err;
			logger.error("User settings avatar deleted error: ", err);
		  }
		});
	  }
	  if (!ctx.state.error) {
		await user.update({ avatar: null });
		ctx.state.updatedUser = user.toJSON();
	  }
	} catch (err) {
	  ctx.state.error = err;
	}
	await next();
  }; */

const updateAccountPassword = (options?: { userType?: string }) => async (ctx: extendedParameterizedContext, next: Next) => {
	if (!ctx.sequelizeInstance) {
		logger.error("updateAccountPassword Error: ", "No active ctx.sequelizeInstance to match request to!");
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		return;
	}
	const { currentPassword, newPassword, repeatedNewPassword } = ctx.request.body;
	try {
		if (newPassword !== repeatedNewPassword) {
			ctx.status = statusCodes.CONFLICT;
			ctx.message = "Repeated new password is not the same";
			return;
		} else {
			const userType =
				options && options.userType
					? options.userType
					: ctx.header["x-usertype"]
						? ctx.header["x-usertype"]
						: ctx.state.user.type
							? ctx.state.user.type
							: undefined;
			if (!userType) {
				ctx.status = statusCodes.SERVER_ERROR;
				ctx.message = "Unable to determine account model/type";
				return;
			}

			const user = await ctx.sequelizeInstance!.models[userType].scope("raw").findByPk(ctx.state.user.uuid);
			if (user) {
				if (comparePassword(currentPassword, user.dataValues.password)) {
					const hashedPassword = hashPassword(newPassword.trim());
					await user.update({ password: hashedPassword });
					await next();
				} else {
					ctx.status = statusCodes.CONFLICT;
					ctx.message = "Incorrect current password";
					return;
				}
			} else {
				ctx.status = statusCodes.NOT_MODIFIED;
				ctx.message = "Unable to update account password";
				return;
			}
		}
	} catch (err) {
		logger.error("Password update error:", err);
		ctx.status = statusCodes.SERVER_ERROR;
		ctx.message = "Unable to update password";
		return;
	}
};

// reset account password
const resetAccountPassword =
	(
		options: {
			validationUrl: string;
			userType?: string;
			signInType?: ((ctx: extendedParameterizedContext) => "email" | "phoneNumber") | "email" | "phoneNumber";
			otpExpiry?: string | number; //"60m",
			numberOfOTPChar?: number;
			sendOTPcode?: boolean;
			siteAddress?: string;
		} | void,
	) =>
	async (ctx: extendedParameterizedContext) => {
		if (!ctx.sequelizeInstance) {
			logger.error("resetAccountPassword Error: ", "No active ctx.sequelizeInstance to match request to!");
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			return;
		}

		const localSignInType =
			options && options.signInType ? (typeof options.signInType === "function" ? options.signInType(ctx) : options.signInType) : "email";

		const { email, phoneNumber } = ctx.request.body;
		// priorising options.userType
		const userType =
			options && options.userType
				? options.userType
				: ctx.header["x-usertype"]
					? ctx.header["x-usertype"]
					: ctx.state.userType
						? ctx.state.userType
						: undefined;
		if (!userType) {
			ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "Unable to determine account model/type";
			return;
		}

		if ((!email && !phoneNumber) || (localSignInType === "email" && !email) || (localSignInType === "phoneNumber" && !phoneNumber)) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = `${localSignInType} needs to be provided in order toreset account password`;
			return;
		}

		try {
			const whereFilter = localSignInType === "email" ? { email: email } : { phoneNumber: phoneNumber };
			const user = await ctx.sequelizeInstance!.models[userType].findOne({
				where: whereFilter,
			});
			if (user && user.dataValues[localSignInType]) {
				const linkOrCode = await otpLinkGenerator({
					sequelize: ctx.sequelizeInstance!,
					expiry: options && options.otpExpiry ? options.otpExpiry : "30m",
					numberOfOTPChar: options && options.numberOfOTPChar ? options.numberOfOTPChar : 20,
					entityReference: userType,
					queryIdentifier: localSignInType === "email" ? email : phoneNumber,
					route: options && options.validationUrl ? options.validationUrl : ctx.path, // optional use current ctx route as dummy path
					log: `<${userType}>: User account password reset`,
					returnOTP: options && options.sendOTPcode ? true : false,
				});

				//send a reset email
				if (linkOrCode && localSignInType === "email") {
					mailSender({
						sender: "noreply",
						receiver: email,
						subject: `A password reset initiated`,
						content: {
							text: `Hello,`,
							html: defaultMailTemplate({
								header: `Hello, ${user.dataValues.firstName ? user.dataValues.firstName : user.dataValues.email}! `,
								body: `Click <a href="${linkOrCode}" target="_blank" style="color: #ffffff; text-decoration: none; font-weight: bold;">reset link</a> to complete reset of password, only for valid 30 minutes. 

              <br> Kindly ignore this email if you did not request for password reset`,

								footer: "Thank you!",
							}),
						},
					});
				}
				ctx.status = statusCodes.OK;
				return (ctx.body = {
					status: statusCodes.OK,
					statusText:
						localSignInType === "email"
							? "Password reset successful. Kindly check your email to complete reset"
							: "Password reset successful. Kindly check your phone for code to complete reset",
				});
			}
			ctx.status = statusCodes.NOT_FOUND;
			ctx.message =
				localSignInType === "email"
					? "Oops! The email looks incorrect. Please verify the email and try again."
					: "Oops! The phone number looks incorrect. Please verify the phone number and try again.";
			return;
		} catch (err) {
			logger.error("Password reset error:", err);
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			return;
		}
	};

/* 
  sign in with google and facebook authentication
  3rd party redirects back to site after verification on their end.
  Redirect point (verification) is usually current route where signInWithThirdParty is called + '/verify'
  while finally sign-in validation happens at '/sign-in-as' route
*/
const signAccountInWithThirdParty =
	(
		options: {
			app?: "facebook" | "google" | undefined;
			verificationUrl?: string | undefined;
			userRole?: string | boolean | "core";
			userType?: string;
		} | void,
	) =>
	async (ctx: extendedParameterizedContext, next: Next) => {
		if (!ctx.header["x-usertype"])
			ctx.header["x-usertype"] = ctx.headers["x-send-to-admin-route"]
				? "Admin"
				: options && options.userType
					? options.userType
					: ctx.state.userType
						? ctx.state.userType
						: undefined;
		if (!ctx.header["x-usertype"]) {
			ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "Unable to determine account model/type";
			return;
		} else if (!ctx.sequelizeInstance) {
			logger.error("signAccountInWithThirdParty Error: ", "No active ctx.sequelizeInstance to match request to!");
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			return;
		}

		let appName = (options && options.app) || ctx.params.app || ctx.params.appName || ctx.params.thirdParty; // params to be defined in a variety of ways
		appName = appName && appName.toLowerCase();
		//console.log("appName", appName);
		if (!["google", "facebook"].includes(appName)) {
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			ctx.body = {
				status: statusCodes.SERVICE_UNAVAILABLE,
				statusText: appName
					? "Sign-in with " + appName.toUpperCase() + " is currently not supported"
					: "Currently unable to determine how you are signing in",
			};
			return;
		}
		// check if user already signed in
		if (ctx.isUnauthenticated()) await authenticateEncryptedToken(ctx);
		if (ctx.isAuthenticated()) {
			ctx.status = statusCodes.OK;
			return (ctx.body = {
				status: statusCodes.OK,
				account: ctx.state.user,
				statusText: "You are already signed In.",
			});
		} else {
			//"x-requesttoken" needs to be available if token is needed or ctx.state.user needs to be available beyond login.
			// session is only useful if session is available/created in browser which wouldn't be the case in decoupled FE
			const query = ctx.query;
			const requestToken =
				query["requesttoken"] && (query["requesttoken"] === "session" || query["requesttoken"] === "token")
					? query["requesttoken"]
					: undefined;
			const callbackUrl =
				options && options.verificationUrl ? options.verificationUrl : ctx.path + `/verify${requestToken ? "?access=" + requestToken : ""}`; // destination following 3rd party verification for signAccountInWithThirdPartyVerifier to process

			//console.log("callbackUrl::", callbackUrl);
			if (appName === "google") {
				if (googleID && googleSECRET) {
					/* Passport.use(
							"google",
							new GoogleStrategy.Strategy(
								{
									clientID: googleID,
									clientSecret: googleSECRET,
									callbackURL: callbackUrl,
									passReqToCallback: true,
									//scope: ["profile"],
									//state: true,
								},
								async (
									req: any,
									accessToken: string,
									refreshToken: string,
									profile: object,
									cb: (response: string | Error | null | undefined, token?: string, localAppSignInType?: string, profile?: object) => void
								) => {
									await signInWithThirdPartyProcessor({
										app: "google",
										accessToken: accessToken,
										refreshToken: refreshToken,
										profile: profile,
										localAppSignInType: requestToken,
										cb: cb,
									});
								}
							)
						); */
					return Passport.authenticate("google", {
						scope: ["profile", "email"],
						callbackURL: callbackUrl,
					})(ctx, next);
				} else {
					logger.info(
						"3rd PArty APP Sign In Error: Sign-in with google is enabled while both googleID && googleSECRET are not provided in environment variable. This will throw a Service Unavailable (503) Error.",
					);
					ctx.status = statusCodes.SERVICE_UNAVAILABLE;
					ctx.body = {
						status: statusCodes.SERVICE_UNAVAILABLE,
						statusText: "Sign-in with " + appName.toUpperCase() + " is currently not available",
					};
					return;
				}
			} else if (appName === "facebook") {
				if (fbID && fbSECRET) {
					/* Passport.use(
							"facebook",
							new FacebookStrategy.Strategy(
								{
									clientID: fbID,
									clientSecret: fbSECRET,
									callbackURL: callbackUrl,
									enableProof: true,
									profileFields: ["id", "name", "email", "picture"],
								},
								async (
									token: string,
									tokenSecret: string,
									profile: object,
									cb: (response: string | Error | null | undefined, token?: string, localAppSignInType?: string, profile?: object) => void
								) => {
									await signInWithThirdPartyProcessor({
										app: "facebook",
										accessToken: token,
										refreshToken: tokenSecret,
										profile: profile,
										localAppSignInType: requestToken,
										cb: cb,
									});
								}
							)
						); */
					return Passport.authenticate("facebook", {
						authType: "reauthenticate",
						callbackURL: callbackUrl,
						//scope: ["public_profile", "email"],
					})(ctx, next);
				} else {
					logger.info(
						"3rd PArty APP Sign In Error: Sign-in with facebook is enabled while both fbID && fbSECRET are not provided in environment variable. This will throw a Service Unavailable (503) Error.",
					);
					ctx.status = statusCodes.SERVICE_UNAVAILABLE;
					ctx.body = {
						status: statusCodes.SERVICE_UNAVAILABLE,
						statusText: "Sign-in with " + appName.toUpperCase() + " is currently not available",
					};
					return;
				}
			}
		}
	};
/* Verification controller 
  should normally follow or go hand-in-hand with "signInWithThirdParty", and available at route "/verify" to "signInWithThirdParty" route, for signAccountInWithThirdPartyValidateAs to process afterwards
*/
const signAccountInWithThirdPartyVerifier = (
	options: {
		app?: "facebook" | "google" | undefined;
		verificationUrl?: string | undefined; // must be same as that on signAccountInWithThirdParty
		validationUrl?: string | undefined;
		userRole?: string | boolean | "core";
		userType?: string;
	} | void,
) =>
	compose([
		async (ctx: extendedParameterizedContext, next: Next) => {
			if (!ctx.header["x-usertype"])
				ctx.header["x-usertype"] = ctx.headers["x-send-to-admin-route"]
					? "Admin"
					: options && options.userType
						? options.userType
						: ctx.state.userType
							? ctx.state.userType
							: undefined;
			if (!ctx.header["x-usertype"]) {
				ctx.status = statusCodes.SERVER_ERROR;
				ctx.message = "Unable to determine account model/type";
				return;
			} else if (!ctx.sequelizeInstance) {
				logger.error("signAccountInWithThirdPartyVerifier Error: ", "No active ctx.sequelizeInstance to match request to!");
				ctx.status = statusCodes.SERVICE_UNAVAILABLE;
				return;
			}
			await next();
			//displays a json body content if signing-in is unsuccessful, else REDIRECT as below for signAccountInWithThirdPartyValidateAs
			if (ctx.state.redirectQuery) {
				ctx.status = statusCodes.REDIRECTED;
				ctx.redirect((options && options.validationUrl ? options.validationUrl : "/sign-in-as?") + ctx.state.redirectQuery);
			}
			return;
		},
		async (ctx: extendedParameterizedContext, next: Next) => {
			let appName = (options && options.app) || ctx.params.app || ctx.params.appName || ctx.params.thirdParty; // params to be defined in a variety of ways
			appName = appName && appName.toLowerCase();

			const localAppSignInType = ctx.query["access"];

			const callbackUrl =
				options && options.verificationUrl
					? options.verificationUrl
					: ctx.path + `${localAppSignInType ? "?access=" + localAppSignInType : ""}`;

			const authOptions: { [key: string]: string | string[] } = {
				callbackURL: callbackUrl,
			};
			const authScope = appName === "google" ? ["profile", "email"] : appName === "facebook" ? ["user_friends", "manage_pages"] : undefined;
			if (authScope) authOptions["scope"] = authScope;

			return await Passport.authenticate(
				appName,
				authOptions,
				async (
					err,
					userTokenisedEmail,
					//profile //raw profile from social media account is available if ever needed
				) => {
					if (err) {
						ctx.status = statusCodes.SERVER_ERROR;
						//Note: RETURNed ctx.body is directly printed to browser
						return (ctx.body = err.message
							? err.message
							: "Error signing in using your social account. Please try again later; or use a different social media account/platform");
					}
					if (!userTokenisedEmail) {
						ctx.status = statusCodes.NOT_FOUND;
						//Note: RETURNed ctx.body is directly printed to browser
						return (ctx.body = "Unable to signin using your social account.");
					} else {
						// user (email) is imported as token encoded.
						ctx.state.redirectQuery = "user=" + userTokenisedEmail + (localAppSignInType ? "&" + localAppSignInType + "=true" : "");
					}
				},
			)(ctx, next);
		},
	]);

// Signing-in validation after a 3rd party social media account as authenticated an account
const signAccountInWithThirdPartyValidateAs =
	(options: { userRole?: string | boolean | "core"; userType?: string } | void) =>
	async (ctx: extendedParameterizedContext, next: Next) => {
		/*
  the email value is in encoded token from '/verify' below as 'user' query.
	ctx.state.redirectQuery = "user=" + userTokenisedEmail + (localAppSignInType ? "&" + localAppSignInType + "=true" : "");
  */
		if (ctx.query.user) {
			const decoded = await decryptToken(ctx.query.user as string);
			const email = decoded ? decoded["result" as keyof typeof decoded] : undefined;
			//console.log("email result decoded:", email);
			// define user type
			const userModelType = ctx.header["x-usertype"]
				? (ctx.header["x-usertype"] as string)
				: options && options.userType
					? options.userType
					: ctx.state.userType
						? ctx.state.userType
						: undefined;
			if (!userModelType) {
				ctx.status = statusCodes.SERVER_ERROR;
				ctx.message = "Unable to determine account model/type";
				return;
			} else if (!ctx.sequelizeInstance) {
				logger.error("signAccountInWithThirdPartyValidateAs Error: ", "No active ctx.sequelizeInstance to match request to!");
				ctx.status = statusCodes.SERVICE_UNAVAILABLE;
				return;
			}
			//define role if not falsified
			const headerRequestXrole = ctx.header["x-userrole"]
				? (ctx.header["x-userrole"] as string).toLowerCase() === "false"
					? false
					: (ctx.header["x-userrole"] as string)
				: undefined;
			const accountRoleModelType =
				headerRequestXrole === false
					? false
					: headerRequestXrole
						? headerRequestXrole.toLowerCase() === "true"
							? "Role"
							: headerRequestXrole
						: options && options.userRole !== false
							? options.userRole
								? typeof options.userRole === "boolean"
									? "Role"
									: options.userRole
								: "Role"
							: false;

			let accountData;
			if (decoded && email) {
				accountData = await ctx.sequelizeInstance!.transaction(async (t) => {
					const user = await ctx.sequelizeInstance!.models[userModelType].findOne({
						where: { email: email },
						transaction: t,
					});

					if (user && user.dataValues.uuid) {
						const account = user.toJSON();
						//Add a signed-in timestamp for user account
						let userAccessTimestamp = await UserAccessTimestamp(ctx.sequelizeInstance!).findByPk(account.uuid, { transaction: t });
						if (userAccessTimestamp instanceof UserAccessTimestamp(ctx.sequelizeInstance!))
							await userAccessTimestamp.update({ signedIn: Date.now() }, { transaction: t });
						//for first time sign-in
						else
							userAccessTimestamp = await UserAccessTimestamp(ctx.sequelizeInstance!).create(
								{
									account_id: account.uuid,
									signedIn: Date.now(),
									current: Date.now(),
								},
								{ transaction: t },
							);

						if (userAccessTimestamp) account["access"] = userAccessTimestamp.toJSON();

						//get corresponding role to ID if required
						if (accountRoleModelType) {
							const role = await ctx.sequelizeInstance!.models[accountRoleModelType === "core" ? "Role" : accountRoleModelType].findByPk(
								user.dataValues.role,
								{
									transaction: t,
								},
							);
							if (role && role.dataValues && role.dataValues["label"]) account["roleLabel"] = role.dataValues["label"];
						}

						if (ctx.query.token) {
							const token = await encryptionToken(account);
							account["token"] = token;
							//save token in websocket if available
							if (ctx.ioSocket) ctx.ioSocket.auth = ctx.ioSocket.auth ? { ...ctx.ioSocket.auth, token: token } : { token: token };
						} else if (ctx.query.session) {
							await ctx.login(account);
						}
						return account;
					} else {
						return "Oops! You do not seem to have an existing account.";
					}
				});
			} else if (decoded && decoded["error" as keyof typeof decoded]) {
				const errorMessage = decoded["error" as keyof typeof decoded];
				ctx.status = statusCodes.UNAUTHORIZED;
				ctx.message =
					errorMessage && errorMessage["message" as keyof typeof errorMessage] === "TokenExpiredError"
						? "Session expired. Please try signing in again"
						: "Unable to verify the status of your account.";
				return;
			}
			if (accountData && typeof accountData !== "string") {
				if (!next) {
					ctx.status = statusCodes.OK;
					return (ctx.body = { status: statusCodes.OK, account: accountData });
				} else {
					if (!ctx.state.user) ctx.state.user = accountData;
					await next();
				}
			} else {
				ctx.status = statusCodes.UNAUTHORIZED;
				ctx.message = accountData ? accountData : "Oops! Currently unable to resolve your account detail.";
				return;
			}
		} else {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Unable to verify the status of your account.";
			return;
		}
	};

/*
  create new admin account. This is not exported for non-core app, hence do not manually import it outside core usage
*/
const createAdminAccount = async (ctx: extendedParameterizedContext, next: Next) => {
	if (!ctx.sequelizeInstance) {
		logger.error("createAdminccount Error: ", "No active ctx.sequelizeInstance to match request to!");
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		return;
	}

	const { password } = ctx.request.body;
	const hashedPassword = hashPassword(password.trim());
	// set account for deletion if unverified after 1 days (24hrs).
	const setForUnverfiedDeletion = getOffsetTimestamp(1);
	try {
		const newUser = await ctx.sequelizeInstance!.models[ctx.state.userType].create({
			...ctx.request.body,
			password: hashedPassword,
			markForDeletionBy: setForUnverfiedDeletion,
		});
		// check if user exists in the database now!
		//console.log(newUser instanceof Account); // true
		//console.log("newUser: ", newUser.toJSON());
		if (newUser && newUser.dataValues.email) {
			const code = alphaNumericCodeGenerator({ length: 10 });
			const otpDeletionDate = getOffsetTimestamp(1);
			const thisOtp = await OTP(ctx.sequelizeInstance!).create({
				code: code,
				ref: ctx.state.userType,
				id: newUser.dataValues.email,
				markForDeletionBy: otpDeletionDate,
				log: `New ${ctx.state.userType} account creation`,
			});
			if (thisOtp instanceof OTP) {
				//console.log("thisOtp: ", thisOtp.toJSON());
				// implement Email sending feature here!!
			}
			ctx.state.newUser = newUser;
		} else {
			logger.info("Account controller: Could not verify the creation of new account as true");
			ctx.state.error = {
				code: statusCodes.SERVER_ERROR,
				message: "Unable to verify new account",
			};
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (err: any) {
		logger.error({
			"Server error": "while trying to create new account with sequelize",
			err: err,
		});
		ctx.state.error = {
			code: statusCodes.SERVER_ERROR,
			message: err.parent ? err.parent.detail : err.message ? err.message : "Unable to create account",
		};
	}
	await next();
};

export {
	signAccountInLocal,
	signAccountInOTP,
	updateAccount,
	updateAccountPassword,
	resetAccountPassword,
	signAccountInWithThirdParty,
	signAccountInWithThirdPartyVerifier,
	signAccountInWithThirdPartyValidateAs,
	createAdminAccount,
};
