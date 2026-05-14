import { mediaUpload, requestParser, Router, statusCodes, UserSecurity, Patient } from "@medlink/common";
import { patientProfileUpdate } from "../../validators/patientProfileUpdate.js";
import { updatePatientProfile } from "../../controllers/PatientProfile.controller.js";

const router = Router("profile");

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
 * /patients/profile:
 *   get:
 *     tags:
 *       - Current signed-in patient user self management
 *     summary: "Fetch signed-in user data. This is practically the same as '/auth/me' endpoint available on the auth-service"
 *     description: "Access signed-in patient user data. This includes the raw schema with sensitive fields like email and phone number that are not naturally available in user access token. Access restricted to the owning user"
 *     security:
 *       - Token: []
 *     responses:
 *       200:
 *         description: Returns patient user data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 account:
 *                   description: "account data with security settings attached in 'auth_features' key"
 *                   type: object 
 *                   $ref: "#/components/schemas/Patient"
 *               example:
 *                 status: 200
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   picture: "/picture.jpg"
 *                   firstName: Emma
 *                   lastName: Emma
 *                   gender: Male
 *                   nationality: Nigeria
 *                   dob: 2024-12-05
 *                   address: No 2, Egbeda, Lagos
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
 *                   'type': 'patient'
 *                   created: 2024-12-05T19:00:00.151Z
 *                   updated: 2024-12-05T19:00:00.151Z
 *       401:
 *         description: Unauthorised response
 *       5xx:
 *         description: "Oops! A server error occcurred. Media type => text/plain"
 */

router.get("/", async (ctx) => {
	if (ctx.isAuthenticated()) {
		// lets fetch management scope for user that includes allowable sensitive data
		const user = await Patient(ctx.sequelizeInstance!).scope("management").findByPk(ctx.state.user.uuid);
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
 * Update a user account
 * @openapi
 * /patients/profile:
 *   patch:
 *     tags:
 *       - Current signed-in patient user self management
 *     summary: Update signed-in patient user account information
 *     description: "Note that this only allows for basic user data and picture update. Modification to sensitive user information like Email and Phone Number has a dedicated endpoint on the auth-service. Also, like on auth-service it's impossible to update user UUID, and the rest here are simply replica of '/auth/update'"
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
 *               dob:
 *                 type: string
 *                 format: date
 *               address:
 *                 type: string
 *               gender:
 *                 type: string
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
 *                   type: object
 *                   $ref: "#/components/schemas/Patient"
 *               example:
 *                 status: 200
 *                 account:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   avatar: "/picture.jpg"
 *                   firstName: Emma
 *                   lastName: Emma
 *                   gender: Male
 *                   dob: 2024-12-05
 *                   phoneNumber: 07012345678
 *                   email: emma-watson@gmail.com
 *                   state: true
 *                   verified: true
 *                   'type': 'patient'
 *                   created: 2024-12-05T19:00:00.151Z
 *                   updated: 2024-12-05T19:00:00.151Z
 *       304:
 *         description: Unable to update account data
 *       406:
 *         description: Validate not acceptable error. Media type => text/plain
 *       5xx:
 *         description: "Oops! Server error. Media type => text/plain"
 */
router.patch(
	"/",
	requestParser({ multipart: true }),
	patientProfileUpdate,
	mediaUpload({ mediaPath: "private" }),
	async (ctx, next) => {
		// user email and phone should require special endpoints that ensures users verify such update. This should already throw validation error in validator middleware but leaving this here just in case
		if (ctx.request.body.email) delete ctx.request.body.email;
		if (ctx.request.body.phoneNumber) delete ctx.request.body.phoneNumber;
		//call next
		await updatePatientProfile({ userType: "Patient" })(ctx, next);
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

export { router as CurrentUserSignedInPatientProfile };
