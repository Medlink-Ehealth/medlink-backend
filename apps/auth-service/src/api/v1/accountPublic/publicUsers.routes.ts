
import validator from "validator";
import { Op } from "sequelize";
import { authenticateEncryptedToken, checkAccount, hashPassword, mailSender, otpLinkGenerator, otpLinkVerifier, requestParser, Router, signAccountInLocal, signAccountInWithThirdParty, signAccountInWithThirdPartyValidateAs, signAccountInWithThirdPartyVerifier, statusCodes } from "../../../_/index.js";
import { userCombosFormValidator } from "../../../validators/userCombosFormValidator.js";
import { NonAdminUsersController } from "../../../controllers/users/NonAdminUsers.addon.userController.js";
import { JsonObject } from "../../../@types/utils.js";
import { Client } from "../../../models/accounts/Client.model.js";
import { logger } from "../../../_/utils/logger.js";
import { messagingSender } from "../../../functions/messagingSender.js";
import { newUserAccountCreationTemplate } from "../../../functions/mailTemplates/newUserAccountCreationTemplate.js";
import { UserSetting } from "../../../models/accounts/UserSetting.model.js";
import { notificationLogger } from "../../../functions/notificationLogger.js";
import { ClientUser } from "../../../@types/Models.js";
import config from "../../../../app.config.js";
import { clientFormValidator } from "../../../validators/clientFormValidator.js";
import { createNewAccount } from "../../../controllers/users/createNewAccount.controller.js";

const router = Router();

/**
 * New client user sign up route. Delievery Partners are not enabled to sign up here. It's exclusive to Client users
 * @openapi
 * /v1/client/sign-up:
 *   post:
 *     tags:
 *       - Client public routes
 *     summary: Client user sign up endpoint.
 *     description: "Endpoint only allows to create a Client new user account. If a client user tries to re-register within a 30 minutes period, a verification code is resent to the user, otherwise user is asked to sign in."
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
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
 *         description: Returns created new client user data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 account:
 *                   description: account data
 *                   type: object
 *                   $ref: "#/components/schemas/Client"
 *               example:
 *                 status: 201
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   avatar: "/picture.jpg"
 *                   firstName: Emma
 *                   lastName: Emma
 *                   phoneNumber: 07012345678
 *                   email: emma-watson@gmail.com
 *                   state: true
 *                   verified: true
 *                   'type': 'client'
 *                   created: 2024-12-05T19:00:00.151Z
 *                   updated: 2024-12-05T19:00:00.151Z
 *       302:
 *         description: Returned data when account is pending verification
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
 *                   description: Necessary data
 *                   type: object
 *                   properties:
 *                     uuid:
 *                       type: string
 *                       format: uuid
 *                     firstName:
 *                       type: string
 *                     verified:
 *                       type: boolean
 *                     'type':
 *                       type: string
 *                     created:
 *                       type: date-time
 *               example:
 *                 status: 302
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   firstName: Emma
 *                   verified: false
 *                   'type': 'client'
 *                   created: 2024-12-05T19:00:00.151Z
 *       400:
 *         description: Either email or phone number must be provided for a user registration
 *       403:
 *         description: Account already registered to a different user type
 *       409:
 *         description: Account already registered. Media type => text/plain
 *       425:
 *         description: Retry is too early.
 *       5xx:
 *         description: "Oops! Apologies we are currently unable to sign you up but we are working on it. Media type => text/plain"
 */

// Create a client new account => User sign up
router.post(
	"/client/sign-up",
	requestParser({ multipart: true }),
	async (ctx, next) => {
		// export userType which is needed in both checkAccount && createNewAccount middleware
		ctx.state.userType = "Client";
		await next();
	},
	clientFormValidator.createAccount,
	checkAccount(false),
	async (ctx, next) => {
		//console.log("ctx.state.error", ctx.state.error);
		if (ctx.state.error) {
			/* When account already exist but unverified, auto resend a verification link to user email and/or phone number.
			It only makes sense to do this within a limited time, hence 30 minutes period is used here. */
			if (ctx.state.error.code === statusCodes.CONFLICT) {
				const bothEmailNnumber = ctx.request.body.email && ctx.request.body.phoneNumber;
				const whereFilter = bothEmailNnumber
					? { [Op.or]: [{ email: ctx.request.body.email.toLowerCase() }, { phoneNumber: ctx.request.body.phoneNumber }] }
					: ctx.request.body.email
						? { email: ctx.request.body.email }
						: { phoneNumber: ctx.request.body.phoneNumber };
				const checkVerified = await Client(ctx.sequelizeInstance!)
					.scope("management")
					.findOne({
						where: {
							...whereFilter,
							verified: false,
							created: { [Op.gte]: Date.now() - 1000 * 60 * 30 }, //creation within last 30mins
						},
					});

				if (checkVerified) {
					// lets be sure no bad combination of email and phone number not owned by user. Hence using model info rather than request info in "identifier"
					const identifier =
						checkVerified.dataValues.email && checkVerified.dataValues.phoneNumber ? 2 : checkVerified.dataValues.email ? 1 : 3; // 1: email, 2: both, 3: phoneNumber

					const OTPvalue = (await otpLinkGenerator({
						sequelize: ctx.sequelizeInstance!,
						entityReference: "Client",
						typeOfOTPChar: "numbers",
						numberOfOTPChar: 4,
						queryIdentifier:
							identifier === 2
								? [checkVerified.dataValues.email, checkVerified.dataValues.phoneNumber]
								: identifier === 1
									? checkVerified.dataValues.email
									: checkVerified.dataValues.phoneNumber,
						log: `Client: Unverified new account`,
						expiry: "15m",
						//route: "/verify/newuser", //available at dir system/otp/newUserVerify.routes
						returnOTP: true,
					})) as string;

					//console.log('OTPvalue',OTPvalue)
					if (OTPvalue) {
						if (Array.isArray(OTPvalue) && OTPvalue[0] === "pendingOtp") {
							ctx.status = statusCodes.TOO_EARLY;
							return (ctx.body = {
								status: statusCodes.TOO_EARLY,
								statusText: "Retry is too early",
							});
						}
						// check for email of phone number to send OTP, at least one must exist
						if (checkVerified.dataValues.email)
							mailSender({
								sender: "noreply",
								receiver: checkVerified.dataValues.email,
								subject: `New account creation for ${checkVerified.dataValues.firstName}`,
								content: {
									text: `Hello ${checkVerified.dataValues.firstName}`,
									html: newUserAccountCreationTemplate({
										//verificationLink: verificationLink + `&userType=Client`, //insert user account type as query to verification link
										otp: OTPvalue,
										greetings: "Welcome to the family",
										name: checkVerified.dataValues.firstName,
										body: `${config.sitename} is this easy! Welcome on board.
										<br> Complete the sign up process providing the code to the App. Code is only valid for 15 minutes only`,
										footer: "Once again, welcome!",
									}),
								},
							});
						if (checkVerified.dataValues.phoneNumber)
							try {
								messagingSender({
									message: `Here is the code ${OTPvalue} to complete your sign up on ${config.sitename}.`,
									receiver: checkVerified.dataValues.phoneNumber,
								});
							} catch (err) {
								ctx.status = (err as object)["code" as keyof typeof err];
								ctx.message = (err as object)["message" as keyof typeof err];
								return;
							}
					}

					ctx.status = statusCodes.FOUND;
					ctx.body = {
						account: {
							uuid: checkVerified.dataValues["uuid"],
							firstName: checkVerified.dataValues["firstName"],
							verified: checkVerified.dataValues["verified"],
							type: checkVerified.dataValues["type"],
							created: checkVerified.dataValues["created"],
						},
						status: statusCodes.FOUND,
						statusText: `Account is pending verification. An OTP code has been sent to your ${
							identifier === 2 ? "email and phone" : identifier === 1 ? "email" : "phone"
						}`,
					};
					return;
				} else {
					ctx.status = statusCodes.CONFLICT;
					ctx.message = "Account already registered. Please sign in instead";
					return;
				}
			} else {
				ctx.status = ctx.state.error.code;
				ctx.message = ctx.state.error.message;
				return;
			}
		} else {
			await next();
		}
	},
	createNewAccount(),
	async (ctx) => {
		if (ctx.state.newUser) {
			// create an associated user settings
			await UserSetting(ctx.sequelizeInstance!).create({ user_uuid: ctx.state.newUser.dataValues.uuid, user_type: "client" });
			const profileData = {
				status: statusCodes.CREATED,
				account: ctx.state.newUser.toJSON(),
				statusText: "Account created.",
			};
			notificationLogger({
				ctx,
				detail: `New client user account signed up: ${profileData.account.firstName} (${profileData.account.email})`,
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
			ctx.message = "Oops! Apologies we are currently unable to sign you up but we are working on it.";
			return;
		}
	},
);

/**
 * Direct Sign in process without 2FA option
 * @openapi
 * /v1/user/sign-in:
 *   post:
 *     tags:
 *       - Unified Non-admin Access
 *     summary: Sign in a client/delivery partner user account
 *     description: Make a post request with the user credential to server to sign in
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
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
 *               rememberMe:
 *                 type: number
 *                 description: Optional Length of time to keep user access active. Provide a number as days
 *             example:
 *                 email: user@gmail.com
 *                 password: 64nc576t7r98ct7n6578wn90cmu8r99id97ty7nc7w09
 *                 rememberMe: 30
 *     responses:
 *       200:
 *         description: Returns a user profile detail
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 token: string
 *                 account:
 *                   type: object
 *                   description: User data
 *                   anyOf:
 *                     - $ref: "#/components/schemas/Client"
 *                     - $ref: "#/components/schemas/DeliveryPartner"
 *               example:
 *                 status: 200
 *                 token: 64nc576t7r98ct7n6578wn90cmu8r99id97ty7nc7w09
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   created: 2024-11-05T14:00:00.151Z
 *                   updated: 2024-11-05T14:00:00.151Z
 *                   avatar: 'site/images/john.png'
 *                   firstName: Emma
 *                   lastName: Watson
 *                   address: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   state: true
 *                   secured: false
 *                   verified: true
 *                   type: 'client'
 *       301:
 *         description: "Requesting authenticator code with the attached 'token'. Valid for 15 minutes"
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 statusText: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     token: string
 *               example:
 *                 status: 301
 *                 statusText: string
 *                 data:
 *                   token: 64nc576t7r98ct7n6578wn90cmu8r99id97ty7nc7w09
 *       403:
 *         description: Your account is unverified. Kindly verify account with the code sent to your email
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 statusText: string
 *                 account:
 *                   type: object
 *                   properties:
 *                     uuid: string
 *                     firstName: string
 *                     verified: string
 *                     'type': string
 *               example:
 *                 status: 403
 *                 statusText: Your account is unverified. Kindly verify account with the code sent to your email
 *                 account:
 *                     uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                     firstName: Adelaolu
 *                     verified: false
 *                     'type': client
 *       404:
 *         description: Oops! Incorrect email or password
 *       503:
 *         description: Authentication service is unavailable/Currently unable to generate user access token, or sign user in
 *       5xx:
 *         description: Unexpected server error occured
 */

/**
 * 2FA specific sign-in
 * @openapi
 * /v1/user/sign-in/2fa:
 *   post:
 *     tags:
 *       - Unified Non-admin Access
 *     summary: "Account that has 'secured' enabled will require 2FA"
 *     description: An account can optionally opt to enable 2FA. When this is the case, the '/sign-in' endpoint would instead return a token with a redirect status. Send the token as payload with the 2FA code from authenticator to this endpoint to process sign-in for 2fa enabled account
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *     requestBody:
 *       description: Request body can be available as json formated or FormData
 *       required: true
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               passcode:
 *                 type: string
 *               token:
 *                 type: string
 *             example:
 *                 passcode: 7B71D2BE1B
 *                 token: 64nc576t7r98ct7n6578wn90cmu8r99id97ty7nc7w09
 *     responses:
 *       200:
 *         description: Returns a user profile detail
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 token: string
 *                 account:
 *                   type: object
 *                   description: User data
 *                   anyOf:
 *                     - $ref: "#/components/schemas/Client"
 *                     - $ref: "#/components/schemas/DeliveryPartner"
 *               example:
 *                 status: 200
 *                 token: 64nc576t7r98ct7n6578wn90cmu8r99id97ty7nc7w09
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   created: 2024-11-05T14:00:00.151Z
 *                   updated: 2024-11-05T14:00:00.151Z
 *                   avatar: 'site/images/john.png'
 *                   firstName: Emma
 *                   lastName: Watson
 *                   address: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   state: true
 *                   secured: false
 *                   verified: true
 *                   type: 'client'
 *       403:
 *         description: Returned data when account is pending verification
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
 *                   description: Necessary data
 *                   type: object
 *                   properties:
 *                     uuid:
 *                       type: string
 *                       format: uuid
 *                     firstName:
 *                       type: string
 *                     verified:
 *                       type: boolean
 *                     'type':
 *                       type: string
 *                     created:
 *                       type: date-time
 *               example:
 *                 status: 403
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   firstName: Emma
 *                   verified: false
 *                   'type': 'client'
 *                   created: 2024-12-05T19:00:00.151Z
 *       404:
 *         description: Please provide the code from your authenticator app to continue
 *       425:
 *         description: Retry is too early.
 *       503:
 *         description: Authentication service is unavailable/Currently unable to generate user access token, or sign user in
 *       5xx:
 *         description: Unexpected server error occured
 */

router.post(
	["/user/sign-in", "/user/sign-in/2fa"],
	requestParser({ multipart: true }),
	async (ctx, next) => {
		//console.log('ctx.path', ctx.path)
		if (!ctx.request.body) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = ctx.path.includes("/sign-in/2fa")
				? "Please provide the code from your authenticator app to continue"
				: "Oops! No login detail provided.";
			return;
		} else if (!ctx.request.body.email && !ctx.request.body.phoneNumber) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Either a user email or phone number must be provided to sign in";
			return;
		}
		await next();
	},
	userCombosFormValidator.signin,
	async (ctx, next) => {
		// process sign in, & since token is always needed for riideon model, let ensure signAccountInLocal always returns it without needing to explicitly set it in Request header
		ctx.header["x-requesttoken"] = "token";
		await next();

		//console.log("ctx.body", ctx.body);
		//console.log('ctx.ioSocket', ctx.ioSocket)
		//lets ensure data is available
		type body = { account: ClientUser; status: 200 };
		if (!ctx.body || (ctx.body && (ctx.body as body).status !== 200)) return;

		const user = (ctx.body as body)["account"];

		// let's overwrite account data if user is unverified
		if (user && user.verified) {
			/* Process notifications */
			UserSetting(ctx.sequelizeInstance!)
				.findByPk(user.uuid)
				.then((settings) => {
					if (settings && settings.dataValues.notificationsToReceive.includes("signingIn"))
						notificationLogger({
							ctx,
							detail: `You signed into your account`,
							meta: {
								target: ctx.state.userType,
								uuid: "self", //user.uuid,
							},
							sendMail: settings.dataValues.sendNotificationsBy.includes("email"),
						});
				});
			// end
			return;
		} else {
			// if unverified, lets send verification link to ID used to sign in. Email and phoneNumber are filtered out by default on user models
			const signinId: string = ctx.request.body.email || ctx.request.body.phoneNumber;

			const OTPvalueOrUrl = (await otpLinkGenerator({
				sequelize: ctx.sequelizeInstance!,
				entityReference: ctx.state.userType,
				numberOfOTPChar: ctx.state.userType === "DeliveryPartner" ? 6 : 4,
				typeOfOTPChar: ctx.state.userType === "DeliveryPartner" ? "alphanumeric" : "numbers",
				queryIdentifier: signinId,
				log: ctx.state.userType + ": Verification code sent for an unverified user",
				expiry: "15m",
				route: ctx.state.userType === "DeliveryPartner" ? "/api/v1/s/otp/newuser" : undefined, //available at dir system/otp/newUserVerify.routes
				returnOTP: ctx.state.userType === "DeliveryPartner" ? false : true,
			})) as string;
			//console.log("OTPvalueOrUrl", OTPvalueOrUrl);
			if (OTPvalueOrUrl) {
				if (Array.isArray(OTPvalueOrUrl) && OTPvalueOrUrl[0] === "pendingOtp") {
					ctx.status = statusCodes.TOO_EARLY;
					return (ctx.body = {
						status: statusCodes.TOO_EARLY,
						statusText: "Retry is too early",
					});
				}
				if (validator.isEmail(signinId))
					mailSender({
						ignoreDevReceiverRewriteToSender: true,
						sender: "noreply",
						receiver: signinId,
						subject: `New verification code generated for ${user.firstName}`,
						content: {
							text: `Hello ${user.firstName}. We need you to verify your account. ${
								ctx.state.userType === "DeliveryPartner"
									? "Click the verification link: " + OTPvalueOrUrl
									: "Enter the code: " + OTPvalueOrUrl
							} to complete the process.`,
							html: newUserAccountCreationTemplate({
								verificationLink: ctx.state.userType === "DeliveryPartner" ? OTPvalueOrUrl + `&userType=DeliveryPartner` : undefined, //insert user account type as query to verification link
								otp: ctx.state.userType !== "DeliveryPartner" ? OTPvalueOrUrl : undefined,
								greetings: `Howdy!`,
								name: user.firstName,
								body: `A new verification ${
									ctx.state.userType === "DeliveryPartner" ? "link" : "code"
								} has been generated for you and only valid for 15 minutes`,
								footer: "Once again, welcome!",
							}),
						},
					});
				else
					try {
						messagingSender({
							message: `Here is the ${
								ctx.state.userType === "DeliveryPartner" ? "link" : "code"
							} ${OTPvalueOrUrl} to verify your account on ${config.sitename}.`,
							receiver: signinId,
						});
					} catch (err) {
						ctx.status = (err as object)["code" as keyof typeof err];
						ctx.message = (err as object)["message" as keyof typeof err];
						return;
					}
			}
			//ctx.body = undefined; //remove data
			ctx.body = {
				account: {
					//uuid: user.uuid,
					verified: user.verified,
					type: user.type,
					created: user.created,
					email: ctx.request.body.email,
					phoneNumber: ctx.request.body.phoneNumber,
				},
				statusText: "Your account is unverified. Kindly verify account with the code sent to your email/phone number.",
			};
			ctx.status = statusCodes.FORBIDDEN;
			ctx.message = "Your account is unverified. Kindly verify account with the code sent to your email/phone number.";
			return;
		}
	},
	async (ctx, next) => {
		/* Perform Client authentication first */
		await next();
		/*
		 if CLient authentication fails with 404, continue and check if Delivery Partner authentication because a combined endpoint is used for both.
		 
		 Once both are done. Process is returned to await in the upstream
		*/
		if (ctx.status === 404) {
			ctx.state.userType = "DeliveryPartner"; // set for later use

			await signAccountInLocal({
				userRole: false,
				userType: "DeliveryPartner",
				signInType: (ctx) => ctx.request.body.email || ctx.request.body.phoneNumber,
				accessTokenLifetime: (ctx) => ctx.request.body.rememberMe,
			})(ctx, next);
		} else {
			ctx.state.userType = "Client";
			return;
		}
	},
	signAccountInLocal({
		userRole: false,
		userType: "Client",
		signInType: (ctx) => ctx.request.body.email || ctx.request.body.phoneNumber,
		accessTokenLifetime: (ctx) => ctx.request.body.rememberMe,
	}),
);

/**
 * Reset user passowrd
 * @openapi
 * /v1/user/reset-password:
 *   post:
 *     tags:
 *       - Unified Non-admin Access
 *     summary: Reset a user password
 *     description: "Make a post request with the user email/phone number to server to start the password reset process. This send an OTP code to the user email/phone number. The code should then be used on 'api/v1/user/set-new-password' endpoint to complete the process. Resubmit to initiate OTP resend; but keep in mind that a 60 seconds retry policy is put in place to avoid abuse!"
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
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
 *             example:
 *                 email: staff@gmail.com
 *     responses:
 *       200:
 *         description: Successful notice
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 statusText:  string
 *               example:
 *                 status: 200
 *                 statusText: Password reset initiated and reset code sent to user email and/or phone number.
 *       304:
 *         description: user already Signed In
 *       404:
 *         description: Oops! The email looks incorrect. Please verify the email and try again.
 *       425:
 *         description: Retry is too early.
 *       503:
 *         description: The service is currently not available
 *       5xx:
 *         description: Unexpected server error occured
 */

router.post(
	"/user/reset-password",
	authenticateEncryptedToken,
	requestParser(),
	async (ctx, next) => {
		//console.log("logg here: ", ctx.request.body);
		if (ctx.isAuthenticated()) {
			ctx.status = statusCodes.NOT_MODIFIED;
			ctx.message = "User already Signed In";
			return;
		} else {
			await next();
		}
	},
	userCombosFormValidator.resetPassword,
	// call custom middleware rather than core version
	NonAdminUsersController.resetPassword,
);

/**
 * validate user passowrd reset
 * @openapi
 * /v1/user/set-new-password:
 *   post:
 *     tags:
 *       - Unified Non-admin Access
 *     summary: Confirm user password reset
 *     description: Call endpoint to complete password reset process by providing new password
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *       - in: query
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID here is the user's valid email or phone number
 *       - in: query
 *         name: otp
 *         schema:
 *           type: string
 *         required: true
 *         description: "A valid OTP code. Get code from: 'api/v1/user/reset-password' endpoint"
 *       - in: query
 *         name: userType
 *         schema:
 *           type: string
 *           enum: ["Admin", "Client", "DeliveryPartner"]
 *         required: true
 *         description: Define the user type. Either 'Admin', 'Client' or 'DeliveryPartner'. This is used to determine the user model to use for OTP verification
 *     requestBody:
 *       description: Request body can be available as json formated or FormData
 *       required: true
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               newPassword:
 *                 type: string
 *                 format: password
 *               repeatedNewPassword:
 *                 type: string
 *                 format: password
 *             example:
 *                 newPassword: 64nc576t7r98ct7n6578wn90cmu8r99i
 *                 repeatedNewPassword: 64nc576t7r98ct7n6578wn90cmu8r99i
 *     responses:
 *       200:
 *         description: Successful notice
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 statusText:  string
 *               example:
 *                 status: 200
 *                 statusText: Password updated
 *       400:
 *         description: Password must be present in request
 *       404:
 *         description: Unable to verify using link. Link may have expired and you may need to generate another link
 *       409:
 *         description: Repeated new password is not the same
 *       5xx:
 *         description: Unexpected server error occured
 */
router.post(
	"/user/set-new-password",
	requestParser({ multipart: true }),
	async (ctx, next) => {
		// lets compare the new password and repeated password
		const { newPassword, repeatedNewPassword } = ctx.request.body as JsonObject;
		if (newPassword !== repeatedNewPassword) {
			ctx.status = statusCodes.CONFLICT;
			ctx.message = "Repeated new password is not the same";
			return;
		} else if (!newPassword || !repeatedNewPassword) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Password must be present in request";
			return;
		}
		// check user type
		const userType = ctx.query["userType"];
		if (userType && typeof userType === "string" && ["Client", "DeliveryPartner"].includes(userType)) {
			ctx.state.userType = userType;
			await next();
		} else {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "The user type is needed to be defined as a query parameter, as Client or DeliveryPartner";
			return;
		}
	},
	otpLinkVerifier,
	async (ctx) => {
		if (ctx.state.error) {
			ctx.status = ctx.state.error.code;
			ctx.message = ctx.state.error.message;
			return;
		}
		//console.log("ctx.state.otpLinkVerifier", ctx.state.otpLinkVerifier);
		try {
			const emailOrPhone = ctx.state.otpLinkVerifier;
			if (!emailOrPhone || (emailOrPhone && !validator.isEmail(emailOrPhone) && !validator.isMobilePhone(emailOrPhone))) {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "Password reset OTP is invalid or expired. Kindly generate a new code";
				return;
			}
			// update user password in database
			const { newPassword } = ctx.request.body as JsonObject;
			const hashedPassword = hashPassword((newPassword as string).trim());

			const whereFilter = { [emailOrPhone.includes("@") ? "email" : "phoneNumber"]: emailOrPhone };

			const user = await Client(ctx.sequelizeInstance!).update({ password: hashedPassword }, { where: whereFilter });

			if (user) {
				ctx.status = statusCodes.OK;
				ctx.message = `Password updated. Please sign in to continue`;
				return;
			} else {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "Currenty unable to identify a valid account";
				return;
			}
		} catch (err) {
			logger.error("Password reset error:", err);
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			ctx.message = (err as object)["message" as keyof typeof err]
				? (err as object)["message" as keyof typeof err]
				: "Unable to reset password";
			return;
		}
	},
);

// Third parties signing-in start-up link
router.get(
	"/user/sign-in-with/:appName",
	signAccountInWithThirdParty({
		userRole: false,
		userType: "dummy", // deprecate this in core. It's added here to avoid server error
	}),
);

// third party re-directs here after confirmation
router.get(
	"/user/sign-in-with/:appName/verify",
	signAccountInWithThirdPartyVerifier({
		userRole: false,
		userType: "dummy", // deprecate this in core. It's added here to avoid server error
	}),
);

// Signing-in after a 3rd party social media account has authenticated an account
router.get(
	"/user/sign-in-as",
	signAccountInWithThirdPartyValidateAs({
		userRole: false,
		userType: "dummy", // deprecate this in core. It's added here to avoid server error
	}),
);

export { router as publicUsers };
