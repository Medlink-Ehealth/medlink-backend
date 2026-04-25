import {
	JsonObject,
	Router,
	authenticateEncryptedToken,
	hashPassword,
	logger,
	mailSender,
	newUserAccountCreationTemplate,
	notificationLogger,
	otpLinkGenerator,
	otpLinkVerifier,
	requestParser,
	statusCodes,
} from "@medlink/common";
import { adminFormValidator } from "../../../validators/adminFormValidator.js";
import { AdminUser } from "../../../@types/index.js";
import { UserSetting } from "../../../models/accounts/UserSetting.model.js";
import { adminController } from "../../../controllers/admin.addon.userController.js";
import { Admin } from "../../../models/accounts/Admin.model.js";
import validator from "validator";
import {
	signAccountInLocal,
	signAccountInWithThirdParty,
	signAccountInWithThirdPartyValidateAs,
	signAccountInWithThirdPartyVerifier,
} from "../../../controllers/account.controller.js";

const router = Router("admin");

/**
 * Direct Sign in process without 2FA option
 * @openapi
 * /admin/login:
 *   post:
 *     tags:
 *       - Admin Users
 *     summary: Sign in an admin account
 *     description: Make a post request with the admin credential to server to sign in
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
 *                 email: staff@gmail.com
 *                 password: 64nc576t7r98ct7n6578wn90cmu8r99id97ty7nc7w09
 *                 rememberMe: 30
 *     responses:
 *       200:
 *         description: Returns an admin user profile detail
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 token: string
 *                 account:
 *                   type: object
 *                   description: admin user data
 *                   $ref: "#/components/schemas/Admin"
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
 *                   phoneNumber: 07023344334
 *                   email: emma-watson@gmail.com
 *                   role: 2
 *                   roleLabel: Manager
 *                   address: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   state: true
 *                   secured: false
 *                   verified: true
 *                   type: 'admin'
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
 *                     'type': admin
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
 * /admin/login/2fa:
 *   post:
 *     tags:
 *       - Admin Users
 *     summary: "Account that has 'secured' enabled will require 2FA"
 *     description: An account can optionally opt to enable 2FA. When this is the case, the '/sign-in' endpoint would instead return a token with a redirect status. Send the token as payload with the 2FA code from authenticator to this endpoint to process sign-in for 2fa enabled account
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
 *         description: Returns an Admin user profile detail
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 token: string
 *                 account:
 *                   type: object
 *                   description: admin user data
 *                   $ref: "#/components/schemas/Admin"
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
 *                   phoneNumber: 07023344334
 *                   email: emma-watson@gmail.com
 *                   role: 2
 *                   roleLabel: Manager
 *                   address: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   state: true
 *                   secured: false
 *                   verified: true
 *                   type: 'admin'
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
 *                   'type': 'admin'
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
	["/login", "/login/2fa"],
	requestParser({ multipart: true }),
	async (ctx, next) => {
		//console.log('ctx.path', ctx.path)
		if (!ctx.request.body) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = ctx.path.includes("/sign-in/2fa")
				? "Please provide the code from your authenticator app to continue"
				: "Oops! No login detail provided.";
			return;
		}
		await next();
	},
	adminFormValidator.signin,
	async (ctx, next) => {
		// process sign in, & since token is always needed for riidein model, let ensure signAccountInLocal always returns it without needing to explicitly set it in Request header
		ctx.header["x-requesttoken"] = "token";
		await next();

		//console.log('ctx.ioSocket', ctx.ioSocket)
		//lets ensure data is available
		type body = { account: AdminUser; status: 200 };
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
								target: "Admin",
								uuid: "self", //user.uuid,
							},
							sendMail: settings.dataValues.sendNotificationsBy.includes("email"),
						});
				});
			// end
			return;
		} else {
			const OTPvalue = (await otpLinkGenerator({
				sequelize: ctx.sequelizeInstance!,
				entityReference: "Admin",
				numberOfOTPChar: 4,
				typeOfOTPChar: "numbers",
				queryIdentifier:
					user.email && user.phoneNumber ? [user.email, user.phoneNumber] : user.email ? user.email : (user.phoneNumber as string),
				log: "Admin: Verification code sent for an unverified user",
				expiry: "15m",
				//route: "/verify/newuser", //available at dir system/otp/newUserVerify.routes
				returnOTP: true,
			})) as string;

			if (OTPvalue) {
				if (Array.isArray(OTPvalue) && OTPvalue[0] === "pendingOtp") {
					ctx.status = statusCodes.TOO_EARLY;
					return (ctx.body = {
						status: statusCodes.TOO_EARLY,
						statusText: "Retry is too early",
					});
				}
				if (user.email)
					mailSender({
						ignoreDevReceiverRewriteToSender: true,
						sender: "noreply",
						receiver: user.email,
						subject: `New verification code generated for ${user.firstName}`,
						content: {
							text: `Hello ${user.firstName}`,
							html: newUserAccountCreationTemplate({
								otp: OTPvalue,
								greetings: `Hello ${user.firstName}`,
								name: user.firstName,
								body: `A new verification code has been generated for you and only valid for 15 minutes`,
								footer: "Once again, welcome!",
							}),
						},
					});
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
	signAccountInLocal({ userRole: "AdminRole", userType: "Admin", accessTokenLifetime: (ctx) => ctx.request.body.rememberMe }),
);

/**
 * Reset Admin passowrd
 * @openapi
 * /admin/reset-password:
 *   post:
 *     tags:
 *       - Admin Users
 *     summary: Reset an admin user password
 *     description: Make a post request with the admin email to server to invoke reset
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
 *                 statusText: Password reset successful. Kindly check your email to complete reset
 *       304:
 *         description: Admin already Signed In
 *       404:
 *         description: Oops! The email looks incorrect. Please verify the email and try again.
 *       503:
 *         description: The service is currently not available
 *       5xx:
 *         description: Unexpected server error occured
 */

router.post(
	"/admin/reset-password",
	authenticateEncryptedToken,
	requestParser(),
	async (ctx, next) => {
		//console.log("logg here: ", ctx.request.body);
		if (ctx.isAuthenticated()) {
			ctx.status = statusCodes.NOT_MODIFIED;
			ctx.message = "Admin already Signed In";
			return;
		}
		ctx.state.userType = "Admin";
		await next();
	},
	adminFormValidator.resetPassword,
	// call custom middleware rathern tan core version
	adminController.resetPassword({
		validationUrl: "/set-new-password", //siteAddress: ''
	}),
);

/**
 * validate Admin passowrd reset
 * @openapi
 * /admin/set-new-password:
 *   post:
 *     tags:
 *       - Admin Users
 *     summary: Confirm admin user password reset
 *     description: Call endpoint to complete password reset process by providing new password
 *     parameters:
 *       - in: query
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID here is the user's valid email
 *       - in: query
 *         name: otp
 *         schema:
 *           type: string
 *         required: true
 *         description: A valid OTP code
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
 *         description: Currenty unable to identify account to sign in/Currenty unable to identify account to sign in
 *       404:
 *         description: Unable to verify using link. Link may have expired and you may need to generate another link
 *       409:
 *         description: Repeated new password is not the same
 *       5xx:
 *         description: Unexpected server error occured
 */
router.post("/set-new-password", requestParser({ multipart: true }), otpLinkVerifier, async (ctx) => {
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
	const email = ctx.state.otpLinkVerifier;
	if (!email || !validator.isEmail(email)) {
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message = "Verification link is invalid because one or more query value is missing/invalid";
		return;
	}
	// update admin password in database
	try {
		const hashedPassword = hashPassword((newPassword as string).trim());
		const admin = await Admin(ctx.sequelizeInstance!).update({ password: hashedPassword }, { where: { email: email } });

		if (admin) {
			ctx.status = statusCodes.OK;
			ctx.message = `Password updated`;
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
});

// Third parties signing-in start-up link
router.get("/sign-in-with/:appName", signAccountInWithThirdParty({ userRole: "AdminRole", userType: "Admin" }));

// third party re-directs here after confirmation
router.get("/sign-in-with/:appName/verify", signAccountInWithThirdPartyVerifier({ userRole: "AdminRole", userType: "Admin" }));

// Signing-in after a 3rd party social media account has authenticated an account
router.get("/sign-in-as", signAccountInWithThirdPartyValidateAs({ userRole: "AdminRole", userType: "Admin" }));

export { router as publicAdminRoutes };
