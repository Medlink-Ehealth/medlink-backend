import { Op } from "sequelize";
import {
	encryptionToken,
	exceptionHandler,
	generate2faSecret,
	mailSender,
	otpLinkGenerator,
	requestParser,
	Router,
	statusCodes,
	validate2faCode,
	logger,
	notificationLogger,
	UserSecurity,
	OTP,
	JsonObject,
	defaultMailTemplate,
} from "@medlink/common";
import validator from "validator";
import { UserSetting } from "../../../../models/accounts/UserSetting.model.js";
import config from "../../../../../app.config.js";

const router = Router("setting");
const userTypes = {
	client: "Client",
	admin: "Admin",
};

/**
 *
 * @openapi
 * /auth/setting:
 *   get:
 *     tags:
 *       - Current signed-in user self management
 *     summary: View current signed-in user setting
 *     security:
 *       - Token: []
 *     responses:
 *       200:
 *         description: Returns the specific content fetched
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   type: object
 *                   properties:
 *                     user_uuid:
 *                       type: string
 *                     sendNotificationsBy:
 *                       type: array
 *                       items:
 *                         type: string
 *                     notificationsToReceive:
 *                       type: array
 *                       items:
 *                         type: string
 *                     security:
 *                       type: object
 *                       properties:
 *                         2fa:
 *                           type: object
 *                           properties:
 *                             verified:
 *                               type: boolean
 *                         recoveryEmails:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               email:
 *                                 type: string
 *               example:
 *                 status: 200
 *                 data:
 *                   user_uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   sendNotificationsBy:
 *                     - email: Email
 *                   notificationsToReceive:
 *                     - signingIn: Account Sign Ins
 *                     - passwordChange: Password changes
 *                   security:
 *                     2fa:
 *                       verified: true
 *                     recoveryEmails:
 *                       - email: "mail@riideon.com"
 *                         verified: true
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

router.get("/", async (ctx) => {
	try {
		const output = await ctx.sequelizeInstance!.transaction(async (t) => {
			// user security eligibility
			const [userSecurity] = await UserSecurity(ctx.sequelizeInstance!)
				.scope("raw")
				.findOrCreate({
					where: { user_uuid: ctx.state.user.uuid },
					transaction: t,
				});
			// user accounts settings
			const [settings] = await UserSetting(ctx.sequelizeInstance!)
				.scope("raw")
				.findOrCreate({
					where: { user_uuid: ctx.state.user.uuid },
					defaults: {
						user_type: userTypes[ctx.state.user.type as "admin"],
					},
					transaction: t,
				});

			return { ...settings.toJSON(), security: (userSecurity && userSecurity) || {} };
		});

		ctx.status = statusCodes.OK;
		return (ctx.body = {
			status: statusCodes.OK,
			data: output,
		});
	} catch (err) {
		return exceptionHandler({ err, ctx });
	}
});

/**
 *
 * @openapi
 * /auth/setting/notifications:
 *   post:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Update current signed-in user notifications setting
 *     description: ""
 *     security:
 *       - Token: []
 *     requestBody:
 *       description: "Update user notifications setting. Kindly refer to the '/v1/s/config/user-setting' under the 'Platform Misc' to review the expected updated properties. Where an invalid label is provided, it would be ignored."
 *       required: true
 *       content:
 *         application/json: # Media type
 *           schema:
 *             $ref: "#/components/schemas/UserSetting"
 *             example:
 *               sendNotificationsBy:
 *                 - email
 *               notificationsToReceive:
 *                 - signingIn
 *                 - passwordChange
 *                 - newOrderCompletion
 *     responses:
 *       200:
 *         description: Returns a confirmation data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   type: object
 *                   properties:
 *                     user_uuid:
 *                       type: string
 *                     sendNotificationsBy:
 *                       type: array
 *                       items:
 *                         type: string
 *                     notificationsToReceive:
 *                       type: array
 *                       items:
 *                         type: string
 *               example:
 *                 status: 200
 *                 data:
 *                   user_uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   sendNotificationsBy:
 *                     - email: Email
 *                   notificationsToReceive:
 *                     - signingIn: Account Sign Ins
 *                     - passwordChange: Password changes
 *                     - newOrderCompletion: New order completions
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

router.post("/notifications", requestParser({ multipart: true }), async (ctx) => {
	try {
		// user accounts settings
		const settings = await UserSetting(ctx.sequelizeInstance!)
			.scope("raw")
			.findOrCreate({
				where: { user_uuid: ctx.state.user.uuid },
				defaults: {
					user_type: userTypes[ctx.state.user.type as "admin"],
				},
			});
		settings[0].update(ctx.request.body as JsonObject);
		return (ctx.body = {
			status: statusCodes.OK,
			data: settings[0].toJSON(),
		});
	} catch (err) {
		return exceptionHandler({ err, ctx });
	}
});

/**
 * Enable/Disable 2FA on account
 * @openapi
 * /auth/setting/2fa/{action}:
 *   post:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Acticate or Deactivate 2FA on current signed-in user account
 *     description: "Set action to either enable or disable 2FA on the account. If disabling, kindly provide a valid passcode from an authenticator app to confirm the action. When enabling, a secret will be generated and returned to the frontend for activation; then call the /confirm endpoint to complete the process."
 *     security:
 *       - Token: []
 *     parameters:
 *       - in: path
 *         name: action
 *         required: true
 *         schema:
 *           type: string
 *           enum: ["enable", "disable"]
 *         description: A valid UUID.
 *     requestBody:
 *       description: "Passcode is required if action is 'disable'. Otherwise, it is not required."
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               passcode:
 *                 type: string
 *                 description: "Required if action is 'disable'. Passcode from an authenticator app to disable 2FA on the account"
 *             example:
 *               passcode: "123456"
 *     responses:
 *       200:
 *         description: Returns a confirmation data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *                 token:
 *                   type: string
 *               example:
 *                 status: 200
 *                 statusText: "Successful. Replace access token with new one attached"
 *                 token: "jhcyugti783oye8hee89h8dh38mdj----"
 *       202:
 *         description: Returns secret info to enable 2FA
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     secret:
 *                       type: string
 *               example:
 *                 status: 301
 *                 statusText: "Scan/paste code in an authenticator App to continue"
 *                 data:
 *                   secret: "hbrnyi8h3uhnunu9huy4849h89hj0"
 *       304:
 *         description: "2FA is not enabled on this account"
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

// Enable/Disable 2FA on account
router.post("/2fa/:action", requestParser(), async (ctx) => {
	try {
		const twoFAaction = ctx.params.action ? ctx.params.action.toLowerCase() : undefined; // enable|disable
		if (!twoFAaction || (twoFAaction && !["enable", "disable"].includes(twoFAaction))) {
			ctx.status = statusCodes.NOT_ACCEPTABLE;
			ctx.message = "Unrecognisable 2FA action. Please define the ACTION you intend to take: either 'enable' or 'disable'";
			return;
		}
		const passcode = ctx.request.body && (ctx.request.body as JsonObject).passcode; //required if ACTION is 'disable'
		const user = ctx.state.user;
		let security: {
			"2fa"?: { verified: boolean; secret: string };
			//[x: string]: undefined | { verified: boolean; [secret: string]: string | boolean };
		} = {};
		let twoFAstatus: { verified: boolean; secret: string } = {
			verified: false,
			secret: "",
		};
		//Get Security validator options
		let [userSecurityOptions] = await UserSecurity(ctx.sequelizeInstance!)
			.scope("raw")
			.findOrCreate({
				where: { user_uuid: ctx.state.user.uuid },
			});
		if (userSecurityOptions instanceof UserSecurity(ctx.sequelizeInstance!)) {
			security = userSecurityOptions.dataValues.security;
		}
		if (security && security["2fa"]) twoFAstatus = security["2fa"];

		if (twoFAaction === "enable" && twoFAstatus["verified"] && twoFAstatus["secret"]) {
			ctx.status = statusCodes.NOT_MODIFIED;
			ctx.message = "2FA is already enabled on this account";
			return;
		} else if (twoFAaction === "disable" && (!twoFAstatus || (twoFAstatus && !twoFAstatus["verified"]))) {
			//Clear 2FA if it exists on an unverified modelUserSecurity info
			if (security && security["2fa"]) {
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
				//Falsify 'secured' key on USER if no security remain on Security options Model
				if (user["secured"] && Object.keys(security).length === 0) {
					//update logged-in user secured status
					user["secured"] = false;
				}

				// lets update and forward new user state data to frontend
				const accesssTokenLifetime =
					config.authTokenLifetime && !isNaN(Number(config.authTokenLifetime)) ? config.authTokenLifetime + "m" : "3d";
				const token = await encryptionToken(user, {
					expiresIn: accesssTokenLifetime,
				});
				if (typeof token === "string") {
					//save token in websocket if available
					if (ctx.ioSocket)
						ctx.ioSocket.handshake.auth = ctx.ioSocket.handshake.auth ? { ...ctx.ioSocket.handshake.auth, token: token } : { token: token };
				} else {
					ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
					ctx.message = "Currently unable to regenerate user access token.";
					return;
				}
				//console.log("security", security);
				// save updates if process reaches here after token generation
				await userSecurityOptions?.update({
					security: security,
				});
				// update user schema to false if unsecured
				if (!user["secured"])
					ctx.sequelizeInstance!.models[userTypes[ctx.state.user.type as "client"]].update(
						{ secure: false },
						{ where: { uuid: user.uuid } },
					);

				//Create notification
				notificationLogger({
					detail:
						"Two Factor Authentication (2FA) has been removed on your account. This makes your account less secured and you should consider turning it back on",
					meta: { target: userTypes[ctx.state.user.type as "client"] as "Admin", uuid: "self" },
				});

				ctx.status = statusCodes.OK;
				return (ctx.body = {
					status: statusCodes.OK,
					statusText: "2FA disable successfully. Replace existing access token with new one attached",
					//acccount: user,
					token: token,
				});
			} else {
				logger.error("2FA validation error: ", validate);
				ctx.status = statusCodes.SERVICE_UNAVAILABLE;
				ctx.message = "An error occurred while validating passcode code. Please try again later";
				return;
			}
		} else {
			const checkPreviousSecretTimeout =
				userSecurityOptions instanceof UserSecurity(ctx.sequelizeInstance!) &&
				userSecurityOptions.dataValues.security &&
				userSecurityOptions.dataValues.security["2fa"] &&
				userSecurityOptions.dataValues.security["2fa"]["secretExpiry"];

			//Send a direct request to frontend with the secret for activation, checking if an exiting secret is within validity period of 30 seconds. If valid for at least 15 seconds more, forward exiting code to frontend. Else generate new secret
			const userSecret =
				checkPreviousSecretTimeout && typeof checkPreviousSecretTimeout === "number" && checkPreviousSecretTimeout > Date.now() - 1000 * 15
					? userSecurityOptions?.dataValues.security["2fa"]["secret"]
					: generate2faSecret({
							user: user.uuid,
							//size: 25,
							periodInSecond: 60,
						});

			if (typeof userSecret === "string") {
				//conditionally update userSecurityOptions
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

				//ctx.redirect(`/v1/auth/setting/2fa/enable/confirm`);
				ctx.status = statusCodes.ACCEPTED;
				return (ctx.body = {
					status: statusCodes.ACCEPTED,
					statusText: "Scan/paste code in an authenticator App to continue. Valid for 30 seconds",
					data: { secret: userSecret },
				});
			} else {
				logger.error("2FA secret generation error: ", userSecret);
				ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
				ctx.message = "An error occurred while activating 2FA. Please try again later";
				return;
			}
		}
	} catch (err) {
		return exceptionHandler({ err, ctx });
	}
});

/**
 * Enable 2FA on account confirmation
 * @openapi
 * /auth/setting/2fa/enable/confirm:
 *   post:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Complete 2FA activation on user account
 *     description: "Complete the 2FA activation process by providing a valid passcode from an authenticator app."
 *     security:
 *       - Token: []
 *     requestBody:
 *       description: "Confirm enabling 2FA on the account by providing a valid passcode from an authenticator app. This is required to complete the activation process."
 *       required: true
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               passcode:
 *                 type: string
 *             example:
 *               passcode: "123456"
 *     responses:
 *       200:
 *         description: Returns a confirmation data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *                 token:
 *                   type: string
 *               example:
 *                 status: 200
 *                 statusText: "Two factor authentication activated on your account. Replace replace access token with new one attached"
 *                 token: "jhcyugti783oye8hee89h8dh38mdj----"
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

// Enable 2FA on account confirmation
router.post("/2fa/enable/confirm", requestParser(), async (ctx) => {
	try {
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

		const [userSecurityOptions] = await UserSecurity(ctx.sequelizeInstance!)
			.scope("raw")
			.findOrCreate({
				where: { user_uuid: user.uuid },
			});
		if (userSecurityOptions instanceof UserSecurity(ctx.sequelizeInstance!)) {
			security = userSecurityOptions.dataValues.security;
		}
		if (security && security["2fa"]) {
			if (!security["2fa"]["secret"]) {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "You do not seem to have 2FA enabled on your account. Please try enabling 2FA";
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
					//reflect secured in logged-in user data
					user["secured"] = true;
					// lets generate, update and forward new user state data to frontend in new token
					const accesssTokenLifetime =
						config.authTokenLifetime && !isNaN(Number(config.authTokenLifetime)) ? config.authTokenLifetime + "m" : "3d";
					const token = await encryptionToken(user, {
						expiresIn: accesssTokenLifetime,
					});
					if (typeof token === "string") {
						//save token in websocket if available
						if (ctx.ioSocket)
							ctx.ioSocket.handshake.auth = ctx.ioSocket.handshake.auth
								? { ...ctx.ioSocket.handshake.auth, token: token }
								: { token: token };
					} else {
						ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
						ctx.message = "Currently unable to regenerate user access token.";
						return;
					}
					// save updates if process reaches here after token generation
					await userSecurityOptions?.update({ security: security });
					//Set TRUE for 'secured' key on USER
					if (!ctx.state.user["secured"] || user["secured"]) {
						//update user state
						ctx.sequelizeInstance!.models[userTypes[ctx.state.user.type as "client"]].update(
							{ secured: true },
							{ where: { uuid: user.uuid } },
						);
					}
					//Create notification
					notificationLogger({
						detail: "Two Factor Authentication (2FA) is now enabled on your account, and makes access to your account more secured.",
						meta: { target: userTypes[ctx.state.user.type as "client"] as "Admin", uuid: "self" },
					});

					ctx.status = statusCodes.OK;
					return (ctx.body = {
						status: statusCodes.OK,
						statusText: "Two factor authentication activated on your account. Replace access token with new one attached",
						//acccount: user,
						token: token,
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
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message = "You do not seem to have 2FA enabled on your account. Please try enabling 2FA";
		return;
	} catch (err) {
		return exceptionHandler({ err, ctx });
	}
});

/**
 * add or remove recovery email(s) on signed-in user account
 * @openapi
 * /auth/setting/recovery-email/{action}:
 *   post:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Add or removal an email from current signed-in user account
 *     description: "This enables an alternative means to recover account in case of loss of access to the primary email or registered phone number. This would need to be called twice, the first call requires only the email in request which would generate an OTP code that would be sent to the email address. Once OTP is received, send another request with both email and OTP code and that would complete the process. Similar process is required when removing a previously added email from the user account."
 *     security:
 *       - Token: []
 *     parameters:
 *       - in: path
 *         name: action
 *         required: true
 *         schema:
 *           type: string
 *           enum: ["add", "remove"]
 *         description: A valid UUID.
 *     requestBody:
 *       description: "OTP code is required to complete the process."
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *             example:
 *               email: hello@riideon.com
 *               otp: "123456"
 *     responses:
 *       200:
 *         description: Returns a confirmation data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *               example:
 *                 status: 200
 *                 statusText: Email hello@riideon.com is now added as a recovery email on your account.
 *       304:
 *         description: "This email is already added as a recovery email on this account"
 *       400:
 *         description: No valid email provided to add or remove from recovery emails | Unable to validate OTP. Try generating new OTP code
 *       406:
 *         description: "Unrecognisable recovery email action. Please define the ACTION you intend to take: either 'add' or 'remove'"
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

// start the addition or removal of a recovery email on signed-in user account
router.post("/recovery-email/:action", requestParser(), async (ctx) => {
	try {
		const emailAction = ctx.params.action ? ctx.params.action.toLowerCase() : undefined; // enable|disable
		if (!emailAction || (emailAction && !["add", "remove"].includes(emailAction))) {
			ctx.status = statusCodes.NOT_ACCEPTABLE;
			ctx.message = "Unrecognisable recovery email action. Please define the ACTION you intend to take: either 'add' or 'remove'";
			return;
		}
		const email = ctx.request.body && ((ctx.request.body as JsonObject).email as string);
		if (!email || (email && !validator.isEmail(email))) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "No valid email provided to add or remove from recovery emails";
			return;
		}
		const user = ctx.state.user;
		const otpPresent: string | undefined = (ctx.request.body as JsonObject).otp as string;
		let security: {
			recovery_emails?: { verified: boolean; email: string }[];
		} = {};

		//Get Security validator options
		const [userSecurityOptions] = await UserSecurity(ctx.sequelizeInstance!)
			.scope("raw")
			.findOrCreate({
				where: { user_uuid: ctx.state.user.uuid },
			});
		if (userSecurityOptions instanceof UserSecurity(ctx.sequelizeInstance!)) {
			security = userSecurityOptions.dataValues.security;
		}

		const existingEmails: { verified: boolean; email: string }[] =
			security && security["recovery_emails"] ? security["recovery_emails"] : [];
		// lets filter for verified existing emails
		const existingVerifiedEmails = existingEmails.length
			? existingEmails.filter((email) => email.verified).map((email) => email.email)
			: [];

		// lets filter/check if request emails exists in existing emails
		//const existingEmailList = existingEmails.filter((email) => sanitizedEmails.includes(email.email) && email.verified);

		if (emailAction === "add" && existingVerifiedEmails.includes(email)) {
			ctx.status = statusCodes.NOT_MODIFIED;
			ctx.message = "This email is already added as a recovery email on this account";
			return;
		} else if (emailAction === "remove" && !existingVerifiedEmails.includes(email)) {
			ctx.status = statusCodes.NOT_MODIFIED;
			ctx.message = "This email is not added as a recovery email on this account";
			return;
		}
		// if no OTP, generate new and send to email
		if (!otpPresent) {
			const OTPvalue = (await otpLinkGenerator({
				sequelize: ctx.sequelizeInstance!,
				entityReference: "Custom - Email Recovery",
				numberOfOTPChar: 4,
				typeOfOTPChar: "numbers",
				queryIdentifier: email,
				log: "Verification code generated for a recovery email",
				expiry: "15m",
				//route: "/verify/newuser", //available at dir system/otp/newUserVerify.routes
				returnOTP: true,
			})) as string;

			if (OTPvalue)
				mailSender({
					ignoreDevReceiverRewriteToSender: true,
					sender: "noreply",
					receiver: email,
					subject: `Verification code for recovery email`,
					content: {
						text: `Hello ${user.firstName}`,
						html: defaultMailTemplate({
							//otp: OTPvalue,
							header: `Hello ${user.firstName}`,
							body: `
					<p>${OTPvalue}</p>
					<br/>Here is a verification code to confirm the addition of this email address '${email}' as a recovery email for your account. And only valid for 15 minutes`,
							footer: "The Security Team!",
						}),
					},
				});
			else {
				ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
				ctx.message = "An error occurred while sending verification code to your email. Please try again later";
				return;
			}

			ctx.status = statusCodes.OK;
			return (ctx.body = {
				status: statusCodes.OK,
				statusText: `A verification code has been sent to ${email} to confirm the ${
					emailAction === "add" ? "addition" : "removal"
				} of this email as a recovery email on your account. Kindly check your inbox and follow the instructions`,
			});
		} else {
			// verify OTP
			// check validity of OTP and a compulsory expiry filteration
			try {
				const otpValidity = await OTP(ctx.sequelizeInstance!).findOne({
					where: {
						code: otpPresent.toString(),
						ref: "Custom - Email Recovery",
						id: email,
						markForDeletionBy: { [Op.gte]: Date.now() },
					},
				});
				//console.log("otpLinkVerifier | getOTP: ", otpValidity);
				if (otpValidity) {
					// destroy OTP record
					otpValidity.destroy();
					// complete email addition/removal
					const newRecoveryEmails: { verified: boolean; email: string }[] = [];
					if (emailAction === "add") {
						let emailAdded = false;
						existingEmails.forEach((mailProp) => {
							if (mailProp.email === email) {
								emailAdded = true;
								newRecoveryEmails.push({ ...mailProp, verified: true }); // mark as verified
							} else newRecoveryEmails.push(mailProp);
						});
						if (!emailAdded) {
							newRecoveryEmails.push({ email: email, verified: true }); // add new email
						}
					} else {
						existingEmails.forEach((mailProp) => {
							if (mailProp.email !== email) newRecoveryEmails.push(mailProp);
						});
					}
					// update recovery emails on user security settings
					userSecurityOptions.update({
						security: { ...security, recovery_emails: newRecoveryEmails },
					});
					ctx.status = statusCodes.OK;
					return (ctx.body = {
						status: statusCodes.OK,
						statusText: `Email '${email}' is now ${emailAction === "add" ? "added" : "removed"} as a recovery email on your account.`,
					});
				} else {
					ctx.status = statusCodes.BAD_REQUEST;
					ctx.message = "Unable to validate OTP. Try generating new OTP code.";
					return;
				}
			} catch (err: unknown) {
				logger.error("Error occurred while validating OTP", err);
				ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
				ctx.message = "Server currently unable to verify OTP. Please try again.";
				return;
			}
		}
	} catch (err) {
		return exceptionHandler({ err, ctx });
	}
});

export { router as userSetting };
