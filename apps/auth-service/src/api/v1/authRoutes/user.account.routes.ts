/* Currently signed in user account */
import { OK, UNAUTHORIZED, CONFLICT, REDIRECTED } from "../../../constants/statusCodes.js";
import * as accountController from "../../../controllers/account.controller.js";
import { avatarUpload } from "../../../middlewares/operations/mediaUpload.js";
import { requestParser } from "../../../middlewares/requestParser.js";
import { UserSecurity } from "../../../../../../common/models/UserSecurity.model.js";
import { statusCodes } from "../../../constants/index.js";
import { generate2faSecret, validate2faCode } from "../../../utils/authorization/twoFa.js";
import { logger } from "../../../utils/logger.js";
import { userAccessTimestampsLog } from "../../../functions/userAccessTimestampsLog.js";
import { ParameterizedContext } from "koa";
import { Notification } from "../../../../../../common/models/Notification.model.js";
import { Router } from "../../../middlewares/router.js";

const router = Router({
	prefix: "/user",
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

router.use(async (ctx, next) => {
	if (ctx.method.toLowerCase() !== "get" && ctx.state.user.role < 1) {
		ctx.status = UNAUTHORIZED;
		return (ctx.body = {
			message: "Account is inactive. You will need an active/activated account to do this.",
		});
	}
	await next();
});
// Convert generic user type to a model which will often have fist letter capitalized
const modeliseUserType = (userType: string) => {
	return userType ? userType.substring(0, 1).toUpperCase() + userType.substring(1).toLowerCase() : null;
};

// Notification Function
const createNotification = async (ctx: ParameterizedContext, notice: { detail: string; title?: string }) => {
	await Notification(ctx.sequelizeInstance).create({
		title: notice.title ? notice.title : `New user notification`,
		detail: notice.detail,
		status: "unread",
		meta: {
			target: {
				type: "User",
				uuid: ctx.state.user.uuid,
			},
		},
	});
	//if websocket available
	if (ctx.ioSocket) {
		ctx.ioSocket.emit("notification", "info", notice.title ? notice.title : `New user notification`);
		ctx.ioSocket.emit("notification", "refresh");
	}
	return;
};

router.get("/", async (ctx) => {
	if (ctx.isAuthenticated()) {
		const security = await UserSecurity(ctx.sequelizeInstance!).findByPk(ctx.state.user.uuid);
		if (security instanceof UserSecurity) {
			ctx.state.user["auth_features"] = security.toJSON();
			delete ctx.state.user["auth_features"]["user_uuid"];
		} else ctx.state.user["auth_features"] = null;
		ctx.status = OK;
		return (ctx.body = { status: OK, account: ctx.state.user });
	}
	ctx.status = REDIRECTED;
	//return ctx.redirect("/account");
	ctx.status = UNAUTHORIZED;
	return;
});

// sign out account
router.get("/sign-out", (ctx) => {
	if (ctx.isAuthenticated()) {
		//log signout of user to access stream
		userAccessTimestampsLog(ctx.sequelizeInstance!, {
			userUUID: ctx.state.user.uuid,
			currentTime: false,
			signedOutTime: true,
		});
		//create a way to check if access method is by token and destroy the current access token to sign account out
		ctx.logOut();
		ctx.status = OK;
		ctx.body = { status: 200 };
		return;
	} else {
		ctx.status = CONFLICT;
		ctx.message = "User already Signed Out";
		return;
	}
});

// account update
router.patch(
	"/update",
	requestParser({ multipart: true }),
	formValidator.updateAccount,
	avatarUpload,
	accountController.updateAccount(),
	(ctx) => {
		if (ctx.state.updatedUser) {
			const thisUser = { ...ctx.state.user, ...ctx.state.updatedUser };
			ctx.logIn(thisUser);
			ctx.status = OK;
			return (ctx.body = {
				status: OK,
				statusText: "Successful",
				account: thisUser,
			});
		}
	},
);

//remove account avatar
/* router.delete("/delete-avatar", accountController.deleteAvatar, (ctx) => {
  if (ctx.state.error) {
    ctx.status = NOT_MODIFIED;
    ctx.message = "Unable to remove avatar";
    return;
  }
  let thisUser = { ...ctx.state.user, ...ctx.state.updatedUser };
  ctx.logIn(thisUser);
  ctx.status = OK;
  return (ctx.body = {
    status: OK,
    statusText: "Avatar removed",
    account: ctx.state.user,
  });
}); */

// Enable/Disable 2FA on account
router.post("/2fa/:action", requestParser(), async (ctx) => {
	const twoFAaction = ctx.params.action ? ctx.params.action.toLowerCase() : undefined; // enable|disable
	if (twoFAaction && !["enable", "disable"].includes(twoFAaction)) {
		ctx.status = statusCodes.NOT_ACCEPTABLE;
		ctx.message = "Unrecognisable 2FA action. Please define the ACTION you intend to take: either 'enable' or 'disable'";
		return;
	}
	const passcode = ctx.request.body && (ctx.request.body as JsonObject).passcode; //required if ACTION is 'disable'
	const user = ctx.state.user;
	let security: {
		"2fa"?: { verified: boolean; secret: string };
		[x: string]: undefined | { verified: boolean; [secret: string]: string | boolean };
	} = {};
	let twoFAstatus: { verified: boolean; secret: string } = {
		verified: false,
		secret: "",
	};
	//Get Security validator options
	let userSecurityOptions = await UserSecurity(ctx.sequelizeInstance!).scope("auth").findByPk(user.uuid);
	if (userSecurityOptions instanceof UserSecurity(ctx.sequelizeInstance!)) {
		security = userSecurityOptions.dataValues.security;
	}
	if (security && security["2fa"]) twoFAstatus = security["2fa"];

	if (twoFAaction === "enable" && twoFAstatus && twoFAstatus["verified"] && twoFAstatus["secret"]) {
		ctx.status = statusCodes.NOT_MODIFIED;
		ctx.message = "2FA is already enabled on this account";
		return;
	} else if (twoFAaction === "disable" && (!twoFAstatus || (twoFAstatus && !twoFAstatus["verified"]))) {
		//Clear 2FA if it exists on an unverified UserSecurity info
		if (security["2fa"]) {
			delete security["2fa"];
			userSecurityOptions?.update({ security: security }); //no need to await this
		}
		ctx.status = statusCodes.NOT_MODIFIED;
		ctx.message = "2FA is not enabled on this account";
		return;
	}

	if (twoFAaction === "disable") {
		if (!passcode) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Define a passcode from an authenticator APP to disable 2FA on this account";
			return;
		}
		const validate = validate2faCode({
			passcode: passcode as string,
			userSecret: twoFAstatus["secret"], // It's a good idea to verify for twoFAstatus['secret'] before this step.
		});
		if (validate === true) {
			security = { ...security, ["2fa"]: undefined };
			//console.log("security", security);
			await userSecurityOptions?.update({
				security: security,
			});
			//Falsify 'secured' key on USER if no security remain on Security options Model
			if (user["secured"] && Object.keys(security).length === 0) {
				const Model = modeliseUserType(user.type) === "Admin" ? "Admin" : null;
				if (Model) {
					Admin(ctx.sequelizeInstance!).update({ secured: false }, { where: { uuid: user.uuid } });
				}
				//update user logged-in user data
				user["auth_features"] = userSecurityOptions?.toJSON();
				user["secured"] = false;
				ctx.login(user);
			}
			//Create notification
			await createNotification(ctx, {
				title: "2FA disabled",
				detail:
					"Two Factor Authentication (2FA) has been removed on your account. This makes your account less secured from outside hack. You should consider turning it back on",
			});

			ctx.status = OK;
			return (ctx.body = {
				status: OK,
				statusText: "Successful",
				acccount: user,
			});
		} else {
			logger.error("2FA validation error: ", validate);
			ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "An error occurred while validating passcode code. Please try again later";
			return;
		}
	} else {
		const checkPreviousSecretTimeout =
			userSecurityOptions instanceof UserSecurity &&
			userSecurityOptions.dataValues.security &&
			userSecurityOptions.dataValues.security["2fa"] &&
			userSecurityOptions.dataValues.security["2fa"]["secretExpiry"];

		//Send a direct request to frontend with the secret for activation, checking if an exiting secret is within validity period of 15mins. If valid, forward exiting code to frontend. Else generate new secret
		const userSecret =
			checkPreviousSecretTimeout &&
			typeof checkPreviousSecretTimeout === "number" &&
			checkPreviousSecretTimeout > Date.now() - 1000 * 60 * 15
				? userSecurityOptions?.dataValues.security["2fa"]["secret"]
				: generate2faSecret({
						user: user.uuid,
					});

		if (typeof userSecret === "string") {
			//conditionally update/create userSecurityOptions
			if (userSecurityOptions instanceof UserSecurity(ctx.sequelizeInstance!)) {
				if (
					(checkPreviousSecretTimeout && userSecurityOptions?.dataValues.security["2fa"]["secret"] !== userSecret) ||
					!checkPreviousSecretTimeout
				) {
					userSecurityOptions = await userSecurityOptions?.update({
						security: {
							...security,
							"2fa": {
								verified: false,
								secret: userSecret,
								secretExpiry: Date.now(), //allows to set a timeout to SECRET if it was not confirmed.
							},
						},
					});
				}
			} else {
				userSecurityOptions = await UserSecurity(ctx.sequelizeInstance!).create({
					user_uuid: user.uuid,
					security: {
						"2fa": {
							verified: false,
							secret: userSecret,
							secretExpiry: Date.now(), //allows to set a timeout to SECRET if it was not confirmed.
						},
					},
				});
			}

			ctx.status = OK;
			return (ctx.body = {
				status: statusCodes.REDIRECTED,
				statusText: "Scan/paste code in an authenticator App to continue",
				data: { secret: userSecret },
			});
		} else {
			logger.error("2FA secret generation error: ", userSecret);
			ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "An error occurred while activating 2FA. Please try again later";
			return;
		}
	}
});

// Enable 2FA on account confirmation
router.post("/2fa/enable/confirm", requestParser(), async (ctx) => {
	const { passcode } = ctx.request.body as JsonObject;
	//console.log("passcode: ", passcode);
	if (!passcode) {
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message = "Define a passcode from an authenticator APP to confirm 2FA on this account";
		return;
	}
	const user = ctx.state.user;
	let security: {
		"2fa"?: { verified: boolean; secret: string; secretExpiry?: number };
		[x: string]: undefined | { verified: boolean; [secret: string]: string | boolean | number };
	} = {};

	const userSecurityOptions = await UserSecurity(ctx.sequelizeInstance!).scope("auth").findByPk(user.uuid);
	if (userSecurityOptions instanceof UserSecurity(ctx.sequelizeInstance!)) {
		security = userSecurityOptions.dataValues.security;
	}
	if (security && security["2fa"]) {
		if (!security["2fa"]["secret"]) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message =
				"There was an error and we could not verify you have enabled 2FA on your account. Please try enabling 2FA all over again";
			return;
		} else {
			//validate passcode to enable 2FA
			const validate = validate2faCode({
				passcode: passcode as string,
				userSecret: security["2fa"]["secret"],
			});
			if (validate === true) {
				// Ignore 'secretExpiry' created during activation which is merely used as security expiry feature
				security = {
					...security,
					"2fa": { verified: true, secret: security["2fa"]["secret"] },
				};
				await userSecurityOptions?.update({ security: security });
				//Set TRUE for 'secured' key on USER
				if (!user["secured"]) {
					const Model = modeliseUserType(user.type) === "Admin" ? "Admin" : null;
					if (Model) {
						//update user state
						Admin(ctx.sequelizeInstance!).update({ secured: true }, { where: { uuid: user.uuid } });
					}
				}
				//Create notification
				await createNotification(ctx, {
					title: "2FA enabled",
					detail: "Two Factor Authentication (2FA) is now enabled on your account, and makes access to your account more secured.",
				});
				//update user logged-in user data
				user["auth_features"] = userSecurityOptions?.toJSON();
				user["secured"] = true;
				ctx.login(user);

				ctx.status = OK;
				return (ctx.body = {
					status: OK,
					statusText: "Two factor authentication activated on your account",
					acccount: user,
				});
			} else {
				logger.error("2FA validation error during 2FA enabling confirmation: ", validate);
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "Oops! We are unable to verify your code. You may need to restart the authentication process to resolve this.";
				return;
			}
		}
	}
	// where security["2fa"] does not exist
	ctx.status = statusCodes.NOT_ACCEPTABLE;
	ctx.message =
		"There was an error and we could not verify you have tried to initiate enabling 2FA on your account. Please try enabling 2FA all over again if you intend to";
	return;
});

//account update password only
router.patch(
	"/update-password",
	requestParser({ multipart: true }),
	formValidator.changePassword,
	accountController.updateAccountPassword(),
	(ctx) => {
		if (ctx.state.error) {
			ctx.status = ctx.state.error.code;
			ctx.message = ctx.state.error.message;
			return;
		}
		ctx.status = OK;
		return (ctx.body = {
			status: OK,
			statusText: "Password changed.",
		});
	},
);

export default router;
