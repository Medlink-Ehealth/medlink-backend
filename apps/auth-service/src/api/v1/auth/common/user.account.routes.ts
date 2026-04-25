/* Currently signed in any user account */
import {
	comparePassword,
	exceptionHandler,
	hashPassword,
	mailSender,
	mediaUpload,
	Model,
	otpLinkGenerator,
	otpLinkVerifier,
	otpVerifier,
	requestParser,
	Router,
	statusCodes,
	userAccessTimestampsLog,
	logger,
	UserSecurity,
	JsonObject,
	defaultMailTemplate,
} from "@medlink/common";

import { clientFormValidator } from "../../../../validators/clientFormValidator.js";
import { unlinkSync } from "node:fs";
import path from "node:path";
import validator from "validator";
import { adminFormValidator } from "../../../../validators/adminFormValidator.js";
import config from "../../../../../app.config.js";
import { updateAccount } from "../../../../controllers/account.controller.js";
import { Cache, redis } from "../../../../performance.controller.js";
import Redis from "ioredis";

const router = Router();
const userTypes = {
	client: "Client",
	admin: "Admin",
};

router.use(async (ctx, next) => {
	if (ctx.method.toLowerCase() !== "get" && !ctx.state.user.state) {
		ctx.status = statusCodes.FORBIDDEN;
		return (ctx.body = {
			statusText: "Account is inactive. Please active you account",
		});
	}
	await next();
});

/**
 * Access signed-in user data. This includes the raw scope on the User model
 * @openapi
 * /auth/me:
 *   get:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Fetch signed-in user data
 *     description: "Access signed-in user data. This includes the raw schema with sensitive fields like email and phone number that are not naturally available in user access token"
 *     security:
 *       - Token: []
 *     responses:
 *       200:
 *         description: Returns client/admin user data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 account:
 *                   description: "account data with security settings attached in 'auth_features' key"
 *                   oneOf:
 *                     - type: object
 *                       $ref: "#/components/schemas/Client"
 *                     - type: object
 *                       $ref: "#/components/schemas/Admin"
 *               example:
 *                 status: 200
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   avatar: "/picture.jpg"
 *                   firstName: Emma
 *                   lastName: Emma
 *                   gender: Male
 *                   nationality: Nigeria
 *                   dateOfBirth: 2024-12-05
 *                   phoneNumber: 07012345678
 *                   email: emma-watson@gmail.com
 *                   state: true
 *                   verified: true
 *                   auth_features:
 *                     2fa:
 *                       verified: false
 *                     recovery_emails:
 *                       - verified: true
 *                         email: emma-watson2025@gmail.com
 *                   'type': 'client'
 *                   created: 2024-12-05T19:00:00.151Z
 *                   updated: 2024-12-05T19:00:00.151Z
 *       401:
 *         description: Unauthorised response
 *       5xx:
 *         description: "Oops! A server error occcurred. Media type => text/plain"
 */

router.get("/me", async (ctx) => {
	if (ctx.isAuthenticated()) {
		// lets fetch management scope for user that includes allowable sensitive data
		const user = await ctx
			.sequelizeInstance!.models[userTypes[ctx.state.user.type as "client"]].scope("management")
			.findByPk(ctx.state.user.uuid);
		if (!user) {
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			ctx.message = "Sorry there was an issue retrieving user information";
			return;
		}
		const security = await UserSecurity(ctx.sequelizeInstance!).findByPk(ctx.state.user.uuid);

		if (security instanceof UserSecurity(ctx.sequelizeInstance!)) {
			ctx.state.user["auth_features"] = security.toJSON();
			delete ctx.state.user["auth_features"]["user_uuid"];
		} else ctx.state.user["auth_features"] = null;
		ctx.status = statusCodes.OK;
		return (ctx.body = {
			status: statusCodes.OK,
			account: { ...user.dataValues, auth_features: ctx.state.user["auth_features"] },
		});
	}
	ctx.status = statusCodes.UNAUTHORIZED;
	ctx.message = "Unauthorised!";
	return;
});

/**
 * sign out account
 * @openapi
 * /auth/logout:
 *   get:
 *     tags:
 *       - Current signed-in user self management
 *     description: "While this exist, it practically does nothing on the serverside at the moment. Simply flush/delete access token on the frontend to sign user out. PASETO is used on the server without assertion at the moment, hence backend invalidation isn't implemented, and that would mean tokens are not actively being track in order not to impact performance."
 *     security:
 *       - Token: []
 *     responses:
 *       200:
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *       409:
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
 *                 status: 409
 *                 statusText: Account already Signed Out
 */
/* 
	- Note that this only clears the refresh token and makes it impossible to renew access token. However access token will still be valid until its own expiry. May optionally want to introduce a medium that keeps track of access token as well.
*/
router.get("/logout", async (ctx) => {
	if (ctx.isAuthenticated()) {
		//log signout of user to access stream
		userAccessTimestampsLog(ctx.sequelizeInstance!, {
			userUUID: ctx.state.user.uuid,
			currentTime: false,
			signedOutTime: true,
		});
		// flush refresh token record
		const storage = redis ? redis : config.useCacheAsRedisIsNotAvailable ? Cache : null;
		if (storage) {
			const accountUuid = ctx.state.user["uuid"];
			// lets update storage, deleting previous record
			if (storage instanceof Redis) await storage.del(`refresh:${accountUuid}`);
			else storage.delete(`refresh:${accountUuid}`);
		}
		ctx.status = statusCodes.OK;
		ctx.body = { status: 200 };
		return;
	} else {
		ctx.status = statusCodes.CONFLICT;
		ctx.message = "Account already Signed Out";
		return;
	}
});

/**
 * Update a user account
 * @openapi
 * /auth/update:
 *   patch:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Update signed-in user account information
 *     description: "Note that this only allows for basic user data and avatar update. Modification to sensitive user information like Email and Phone Number has a dedicated endpoint. Also, it's impossible to update user UUID"
 *     security:
 *       - Token: []
 *     requestBody:
 *       description: Request body can be available as json formated or FormData
 *       required: true
 *       content:
 *         multipart/form-data: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: file
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               gender:
 *                 type: string
 *               nationality:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Returns updated user data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *                 account:
 *                   description: account data
 *                   oneOf:
 *                     - type: object
 *                       $ref: "#/components/schemas/Client"
 *                     - type: object
 *                       $ref: "#/components/schemas/Admin"
 *               example:
 *                 status: 200
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   avatar: "/picture.jpg"
 *                   firstName: Emma
 *                   lastName: Emma
 *                   gender: Male
 *                   nationality: Nigeria
 *                   dateOfBirth: 2024-12-05
 *                   phoneNumber: 07012345678
 *                   email: emma-watson@gmail.com
 *                   state: true
 *                   verified: true
 *                   'type': 'client'
 *                   created: 2024-12-05T19:00:00.151Z
 *                   updated: 2024-12-05T19:00:00.151Z
 *       304:
 *         description: Unable to update account data
 *       406:
 *         description: Validate not acceptable error. Media type => text/plain
 *       5xx:
 *         description: "Oops! Apologies we are currently unable to sign you up but we are working on it. Media type => text/plain"
 */
router.patch(
	"/me/update",
	requestParser({ multipart: true }),
	async (ctx, next) => {
		if (ctx.state.user.type === "client") await clientFormValidator.updateAccount(ctx, next);
		else if (ctx.state.user.type === "admin") await adminFormValidator.updateAccount(ctx, next);
		else {
			ctx.status = statusCodes.UNAUTHORIZED;
			ctx.message = "Seems user is unauthorised";
			return;
		}
	},
	mediaUpload({ mediaPath: "private" }),
	async (ctx, next) => {
		// user email and phone should require special endpoints that ensures users verify such update. This should already throw validation error in validator middleware but leaving this here just in case
		if (ctx.request.body.email) delete ctx.request.body.email;
		if (ctx.request.body.phoneNumber) delete ctx.request.body.phoneNumber;
		//call next
		await updateAccount({ userType: userTypes[ctx.state.user.type as "client"] })(ctx, next);
	},
	(ctx) => {
		if (ctx.state.updatedUser) {
			const thisUser = { ...ctx.state.user, ...ctx.state.updatedUser };
			//ctx.logIn(thisUser);
			ctx.status = statusCodes.OK;
			return (ctx.body = {
				status: statusCodes.OK,
				statusText: "Successful",
				account: thisUser,
			});
		}
	},
);

/**
 * Use this to update or delete/remove a user avatar
 * @openapi
 * /auth/avatar:
 *   patch:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Change or delete user avatar image
 *     description: "set request avatar value as 'null' to delete the avatar image already existing on a user profile. Otherwise an update would be done"
 *     security:
 *       - Token: []
 *     requestBody:
 *       description: Request body should be availabe as FormData when uploading a image
 *       required: true
 *       content:
 *         multipart/form-data: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: base64
 *           encoding: # The same level as schema
 *             avatar:
 *               contentType: image/png, image/jpeg
 *     responses:
 *       200:
 *         description: Returns updated user avatar
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
 *                     avatar:
 *                       type: ["string", "null"]
 *               example:
 *                 status: 200
 *                 statusText: Avatar updated
 *                 data:
 *                   avatar: "site/picture.jpg"
 *       304:
 *         description: No avatar iamge exists on this account
 *       5xx:
 *         description: "Oops! Server error occurred. Media type => text/plain"
 */
router.patch(
	"/me/avatar",
	requestParser({ multipart: true, processMedia: "image" }),
	mediaUpload({ mediaPath: "private", relativeContainer: "avatar" }),
	async (ctx) => {
		try {
			if (ctx.request.body["avatar"] || ctx.request.body["avatar"] === null) {
				const user = await ctx.sequelizeInstance!.models[userTypes[ctx.state.user.type as "client"]].findByPk(ctx.state.user.uuid);
				if (user) {
					if (user.getDataValue("avatar"))
						try {
							unlinkSync(path.join(process.cwd(), user.getDataValue("avatar")));
						} catch (err) {
							/* Prevent error from leaking to the frontend due to unlink failure */
							logger.error(`${userTypes[ctx.state.user.type as "client"]} Avatar unlinking error`, err);
						}
					// When aiming to remove avatar but it does not even exist
					else if (ctx.request.body["avatar"] === null) {
						ctx.status = statusCodes.NOT_MODIFIED;
						ctx.message = "No avatar iamge exists on this account";
						return;
					}
					if (ctx.request.body["avatar"] === null) await user.update({ avatar: null });
					else await user.update({ avatar: ctx.request.body["avatar"] });

					//const thisUser = { ...ctx.state.user, ...user.toJSON() };
					//ctx.logIn(thisUser); // save in state though unneeded
					ctx.status = statusCodes.OK;
					return (ctx.body = {
						status: statusCodes.OK,
						statusText: ctx.request.body["avatar"] === null ? "Avatar removed" : "Avatar updated",
						data: { avatar: ctx.request.body["avatar"] },
					});
				}
				ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
				ctx.message = "Unable to retrieve the user data";
				return;
			}
			ctx.status = statusCodes.NOT_MODIFIED;
			ctx.message = "No avatar data provided";
			return;
		} catch (err) {
			return exceptionHandler({ ctx, err });
		}
	},
);

/**
 * update user password
 * @openapi
 * /auth/password:
 *   patch:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Change signed-in user password
 *     description: "Use endpoint to initiate password changes. Depending on the security feature enabled by the user, on whether using 2FA or not, OTP code may be required. If 2FA is not enabled, direct password update works without requiring an OTP code. If however 2FA is enabled, the first submission of the password change would generate an OTP that is sent to both user email and phone number (depending on which is available on profile), please resubmit the same form with the OTP included to complete process."
 *     requestBody:
 *       description: Request body can be available as json formated or FormData
 *       required: true
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *               repeatedNewPassword:
 *                 type: string
 *                 format: password
 *               otp:
 *                 type: number
 *                 description: "4 digit numbers. Submit form without OTP code to first generate a valid OTP sent to user. Afterwards, resend same data with OTP to complete process. To initiate a 'OTP resending', simple re-submit form without OTP key|value"
 *             example:
 *                 currentPassword: 64nc576t7r98ct7n6578wn90cmu8r99i
 *                 newPassword: 64nc576t7r98ct7n6578wn90cmu8r99i
 *                 repeatedNewPassword: 64nc576t7r98ct7n6578wn90cmu8r99i
 *                 otp: 2678
 *     responses:
 *       200:
 *         description: Successful notice
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
 *                 statusText: Password updated
 *       202:
 *         description: OTP code generation notice
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
 *                 status: 202
 *                 statusText: OTP code sent
 *       400:
 *         description: Invalid request
 *       406:
 *         description: Unable acceptable request
 *       409:
 *         description: Password conflict
 *       5xx:
 *         description: Unexpected server error occured
 *
 *
 * # update user email address
 * @openapi
 * /auth/email:
 *   patch:
 *     tags:
 *       - Current signed-in user self management
 *     summary: Change signed-in user access email
 *     description: "Use endpoint to initiate email changes. User password is always required to perform this. OTP is also always required and would be sent to the new email for verification. Please submit form without OTP to allow server to send OTP request to the new email; once done - resubmit the same form with the OTP included to complete process."
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
 *               otp:
 *                 type: number
 *                 description: "4 digit numbers. Submit form without OTP code to first generate a valid OTP sent to user. Afterwards, resend same data with OTP to complete process. To initiate a 'OTP resending', simple re-submit form without OTP key|value"
 *             example:
 *                 email: "hello@world.com"
 *                 password: 64nc576t7r98ct7n6578wn90cmu8r99i
 *                 otp: 2678
 *     responses:
 *       200:
 *         description: Successful notice
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
 *                 statusText: Email address updated
 *       202:
 *         description: OTP code generation notice
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
 *                 status: 202
 *                 statusText: OTP code sent
 *       400:
 *         description: Invalid request
 *       406:
 *         description: Unable to acceptable request
 *       409:
 *         description: Conflict occurred
 *       5xx:
 *         description: Unexpected server error occured
 *
 */

// This endpoint is multiple purpose for password, email, and phonenumber changes; but document differently for easier doc ref.
router.patch(
	"/me/:passwordOrEmail",
	requestParser({ multipart: true }),
	async (ctx, next) => {
		// lets check te specific param endpoint
		const endpoint = ctx.params["passwordOrEmail"];
		if (!endpoint || !["password", "email"].includes(endpoint.toLowerCase())) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Oops. Looks like an invalid endpoint";
			return;
		}
		await next();
	},
	async (ctx, next) => {
		if (ctx.params["passwordOrEmail"].toLowerCase() !== "password") await next();
		// process password changes
		else {
			// lets fetch the current, then compare the new and repeated password
			const { currentPassword, newPassword, repeatedNewPassword, otp } = ctx.request.body as JsonObject;
			let user: Model | null;

			if (newPassword !== repeatedNewPassword) {
				ctx.status = statusCodes.CONFLICT;
				ctx.message = "Both password fields are not the same";
				return;
			} else if (!newPassword || !repeatedNewPassword) {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "Ensure both password fields are correctly entered";
				return;
			} else if (!currentPassword) {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "Kindly provide current password for validation";
				return;
			} else if (currentPassword === newPassword) {
				ctx.status = statusCodes.CONFLICT;
				ctx.message = "New passowrd cannot be the same with previous password";
				return;
			} else {
				user = await ctx.sequelizeInstance!.models[userTypes[ctx.state.user.type as "client"]].scope("raw").findByPk(ctx.state.user.uuid);

				if (!user || !comparePassword(currentPassword as string, user.getDataValue("password"))) {
					ctx.status = statusCodes.BAD_REQUEST;
					ctx.message = "Incorrect password";
					return;
				}
			}
			try {
				// lets check user security feature, if 2fa is enabled, require OTP for password changes
				const security = await UserSecurity(ctx.sequelizeInstance!).findByPk(ctx.state.user.uuid);
				//console.log("security", security);
				if (security instanceof UserSecurity(ctx.sequelizeInstance!)) {
					const authFeature = security.toJSON();
					// if 2fa exist, check if OTP is present in request body
					if (authFeature["2fa"] && authFeature["2fa"]["verified"]) {
						const identifiers: string | string[] =
							user.getDataValue("email") && user.getDataValue("phoneNumber")
								? [user.getDataValue("email"), user.getDataValue("phoneNumber")]
								: user.getDataValue("email")
									? user.getDataValue("email")
									: user.getDataValue("phoneNumber");

						if (otp) {
							const verifiedID = await otpLinkVerifier(ctx);
							if (!verifiedID || (typeof identifiers === "string" && identifiers !== verifiedID) || !identifiers.includes(verifiedID)) {
								ctx.status = statusCodes.NOT_ACCEPTABLE;
								ctx.message = "The OTP code provided seems expired. Kindly request another";
								return;
							}
							// if all is good, effect password changes
							await user.update({ password: hashPassword(newPassword as string) });
							ctx.status = statusCodes.OK;
							ctx.message = `Password updated. Sign in next time with new password`;
							return;
						} else {
							const OTPvalue = (await otpLinkGenerator({
								sequelize: ctx.sequelizeInstance!,
								entityReference: userTypes[ctx.state.user.type as "client"],
								numberOfOTPChar: 4,
								typeOfOTPChar: "numbers",
								queryIdentifier: identifiers,
								log: `${userTypes[ctx.state.user.type as "client"]}: password change by user`,
								expiry: "3m",
								returnOTP: true,
							})) as string;
							if (OTPvalue) {
								const userIDs = Array.isArray(identifiers) ? identifiers : [identifiers];
								for (const id of userIDs) {
									if (validator.isEmail(id))
										mailSender({
											ignoreDevReceiverRewriteToSender: true,
											sender: "noreply",
											receiver: id,
											subject: `OTP Code to complete password changes`,
											content: {
												text: `Hello ${user.getDataValue(
													"firstName",
												)}. An account password change has been requested, use the code: ${OTPvalue} to complete the process.`,
												html: defaultMailTemplate({
													header: `Hello ${user.getDataValue("firstName")}`,
													body: `An account password change has been requested, use the code: ${OTPvalue} to complete the process.`,
													footer: `${config.projectName} Team`,
												}),
											},
										});
								}
								ctx.status = statusCodes.ACCEPTED;
								ctx.message = `OTP code sent`;
								return;
							}
							ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
							ctx.message = `An error occurred`;
							return;
						}
					}
					// if 2fa not enable on user profile, allow easy effecting og changes
					await user.update({ password: hashPassword(newPassword as string) });
					ctx.status = statusCodes.OK;
					ctx.message = `Password updated. Sign in next time with new password`;
					return;
				}
				// if no extra security enabled
				await user.update({ password: hashPassword(newPassword as string) });
				ctx.status = statusCodes.OK;
				ctx.message = `Password updated. Sign in next time with new password`;
				return;
			} catch (err) {
				exceptionHandler({ err, ctx });
			}
		}
	},
	async (ctx) => {
		// process email and phonenumber changes
		const { email, otp, password } = ctx.request.body as JsonObject;
		let user: Model | null;

		const updateType = ctx.params["passwordOrEmail"];
		const updatedItem = updateType === "email" ? (validator.isEmail(email as string) ? email : undefined) : undefined;

		if (!updatedItem || typeof updatedItem !== "string") {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = `Kindly provide a valid ${"email address"}`;
			return;
		}

		if (!email) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Kindly provide data for update";
			return;
		} else if (!password) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Your password is required to effect any change";
			return;
		} else {
			user = await ctx.sequelizeInstance!.models[userTypes[ctx.state.user.type as "client"]].scope("raw").findByPk(ctx.state.user.uuid);

			if (!user || !comparePassword(password as string, user.getDataValue("password"))) {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "Incorrect password";
				return;
			}
			if (updateType === "email" && user.getDataValue("email") === updatedItem) {
				ctx.status = statusCodes.CONFLICT;
				ctx.message = "You are using the same existing email. Provide a different email to change email address.";
				return;
			}
		}

		try {
			// OTP is sent to the receiving email or phone number to verify. Hence we are also checking if OTP exists in request, otherwise, send one
			if (otp) {
				try {
					const verifiedID = await otpVerifier(ctx.sequelizeInstance!, otp as string, updatedItem);
					if (!verifiedID || verifiedID !== updatedItem) {
						ctx.status = statusCodes.NOT_ACCEPTABLE;
						ctx.message = "The OTP code provided seems expired. Kindly request another";
						return;
					}
				} catch (err) {
					if ((err as object)["statusCode" as keyof typeof err] === 404) {
						ctx.status = statusCodes.NOT_ACCEPTABLE;
						ctx.message = "The OTP code provided seems expired. Kindly request another";
						return;
					} else throw err;
				}
				// if all is good, effect changes
				await user.update({ [updateType]: updatedItem });
				ctx.status = statusCodes.OK;
				ctx.message = `${updateType === "email" ? "Email address" : "Phone number"} updated.`;
				return;
			} else {
				// generate OTP with required ID
				const OTPvalue = (await otpLinkGenerator({
					sequelize: ctx.sequelizeInstance!,
					entityReference: userTypes[ctx.state.user.type as "client"],
					numberOfOTPChar: 4,
					typeOfOTPChar: "numbers",
					queryIdentifier: updatedItem,
					log: `${userTypes[ctx.state.user.type as "client"]}: ${updateType} change by user`,
					expiry: "3m",
					returnOTP: true,
				})) as string;
				if (OTPvalue) {
					if (updateType === "email")
						mailSender({
							ignoreDevReceiverRewriteToSender: true,
							sender: "noreply",
							receiver: updatedItem,
							subject: `OTP Code to complete email update`,
							content: {
								text: `Hello ${user.getDataValue(
									"firstName",
								)}. An account email change has been requested, use the code: ${OTPvalue} to complete the process.`,
								html: defaultMailTemplate({
									header: `Hello ${user.getDataValue("firstName")}`,
									body: `An account email change has been requested, use the code: ${OTPvalue} to complete the process.`,
									footer: `${config.projectName} Team`,
								}),
							},
						});

					ctx.status = statusCodes.ACCEPTED;
					ctx.message = `OTP code sent`;
					return;
				}
				ctx.status = statusCodes.INTERNAL_SERVER_ERROR;
				ctx.message = `An error occurred`;
				return;
			}
		} catch (err) {
			exceptionHandler({ err, ctx });
		}
	},
);

export { router as CurrentUserSignedInAccount };
