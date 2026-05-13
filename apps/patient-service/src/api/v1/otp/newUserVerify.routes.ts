import { encryptionToken, otpLinkVerifier, Router, statusCodes, userAccessTimestampsLog } from "@medlink/common";

const router = Router("newuser");

/**
 *
 * @openapi
 * /otp/newuser:
 *   get:
 *     tags:
 *       - OTP
 *       - Client Users
 *       - Admin Users
 *     summary: Verify a newly registered platform user account
 *     description: "An OTP code is sent to users after registration. Use code here to verify user account. For Admin accounts, an automated link is also generated and sent via email in the form 'https://<Website address>/verify/newuser?otp=36278&id=< email >' after creating an account. You may introduce a frontend landing page for Admin that intercepts this address and route to this endpoint as a GET request. Provide other needed parameters as expected"
 *     parameters:
 *       - in: query
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The Email of the new account
 *       - in: query
 *         name: otp
 *         schema:
 *           type: string
 *         required: true
 *         description: A valid OTP code
 *       - in: query
 *         name: userType
 *         schema:
 *           type: string
 *           enum: ["Admin", "Client"]
 *         required: true
 *         description: Define the user type. Either 'Admin' or 'Client'. This is used to determine the user model to use for verification
 *     responses:
 *       200:
 *         description: Response object of a user account if verifiable
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 token: string
 *                 account:
 *                   type: object
 *                   description: user data
 *                   oneOf:
 *                     - $ref: "#/components/schemas/Admin"
 *                     - $ref: "#/components/schemas/Client"
 *       400:
 *         description: Verification shold contain as ID as either email or phone number
 *       404:
 *         description: Unable to verify account. Code may have expired and you may need to generate another
 *       503:
 *         description: Currently unable to generate user access token
 *       5xx:
 *         description: Unexpected server error occured
 */

router.get(
	"/",
	async (ctx, next) => {
		const { id, userType } = ctx.query;
		if (!id) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Verification should contain a valid email";
			return;
		} else {
			// User type is available in endpoint as query. Throw error if that is unavailable for any reason
			if (!userType || typeof userType !== "string" || (userType && !["Admin", "Client"].includes(userType))) {
				ctx.status = statusCodes.BAD_REQUEST;
				ctx.message = "Oops! The verification URL query is incorrect.";
				return;
			}
			// lets enforce entity reference using userType
			ctx.query["ref"] = userType;
			await next();
		}
	},
	otpLinkVerifier,
	async (ctx) => {
		// console.log("ctx.query", ctx.query);
		// console.log("ctx.state.otpLinkVerifier", ctx.state.otpLinkVerifier);

		const { userType } = ctx.query;
		// otpLinkVerifier result in state
		if (ctx.state.otpLinkVerifier) {
			// email/phoneNumber is used as ID during creation
			const authUser = await ctx.sequelizeInstance!.models[userType as string].findOne({
				where: { email: ctx.state.otpLinkVerifier },
			});

			// console.log("user: ", authUser);
			if (authUser) {
				// ensure user isn't already verified
				if (authUser.dataValues.verified === true) {
					ctx.status = statusCodes.NOT_MODIFIED;
					ctx.message = "Account is already verified." + (ctx.isUnauthenticated() ? " Try signing in instead." : "");
					return;
				}
				// perform verification update by setting verified to true
				authUser.update({ verified: true, state: true }); // there's no need to await this
				//log signin to user signing-in access stream
				const access = await userAccessTimestampsLog(ctx.sequelizeInstance!, {
					userUUID: authUser.dataValues.uuid,
					signedInTime: true,
				});
				const extraData: { access: object; roleLabel?: string } = {
					access: access,
				};

				let accountData: {
					status: number;
					account: object;
					token?: string;
				} = {
					status: statusCodes.OK,
					account: {
						...authUser.toJSON(),
						...extraData,
					},
				};
				// Since frontend is decoupled by deafult, token value should always be returned

				const token = await encryptionToken(accountData.account);
				if (typeof token === "string") {
					accountData = {
						...accountData,
						token: token,
					};
					//save token in websocket if available
					if (ctx.ioSocket)
						ctx.ioSocket.handshake.auth = ctx.ioSocket.handshake.auth ? { ...ctx.ioSocket.handshake.auth, token: token } : { token: token };
				} else {
					ctx.status = statusCodes.SERVICE_UNAVAILABLE;
					ctx.message = "Currently unable to generate user access token.";
					return;
				}

				ctx.status = statusCodes.OK;
				ctx.body = { ...accountData, status: statusCodes.OK, statusText: "Account successfully verified." }; // account detail is returned here to allow it reserved on the frontend
				return;
			} else {
				// when OTP is valid but wrong userType is provided, NOT FOUND error is naturally thrown. The downside to otpLinkVerifier is that once an OTP is confirmed, the record is automatically deleted. We are returning not found otice here
				ctx.status = statusCodes.NOT_FOUND;
				ctx.message = "Unable to verify account. Code may have expired and you may need to generate another";
				return;
			}
		} else {
			// following response is really not needed as it's handled internally by otpLinkVerifier
			ctx.status = statusCodes.NOT_FOUND;
			ctx.message = "Unable to verify account. Code may have expired and you may need to generate another";
			return;
		}
	},
);

export { router as newUserVerifyRoute };
