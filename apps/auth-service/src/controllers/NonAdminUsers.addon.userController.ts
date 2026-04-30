import { AppContext, defaultMailTemplate, logger, mailSender, otpLinkGenerator, statusCodes } from "@medlink/common";
import { Client, ClientStatic } from "../models/accounts/Client.model.js";

const resetPassword = async (ctx: AppContext) => {
	const { email } = ctx.request.body;
	const whereFilter = email ? { email: email } : null;

	if (!whereFilter) {
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message = "Email must be provided for password reset";
		return;
	} else if (!ctx.sequelizeInstance) {
		logger.error("resetPassword Error: ", "No active ctx.sequelizeInstance to match request to!");
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		return;
	}
	try {
		const user: ClientStatic | null = await Client(ctx.sequelizeInstance).scope("management").findOne({
			where: whereFilter,
		});

		if (user instanceof Client(ctx.sequelizeInstance)) {
			const OTPvalue = await otpLinkGenerator({
				sequelize: ctx.sequelizeInstance,
				expiry: "15m",
				numberOfOTPChar: 4,
				typeOfOTPChar: "numbers",
				entityReference: "Client",
				queryIdentifier: email,
				log: `Client user account password reset`,
				//route: validationUrl ? validationUrl : ctx.path, // optional use current ctx route as dummy path
				//siteAddress: siteAddress,
				returnOTP: true,
			});

			//send a reset email. User type is insert as query
			if (OTPvalue) {
				if (Array.isArray(OTPvalue) && OTPvalue[0] === "pendingOtp") {
					ctx.status = statusCodes.TOO_EARLY;
					return (ctx.body = {
						status: statusCodes.TOO_EARLY,
						statusText: "Retry is too early",
					});
				}
				if (user.dataValues.email)
					mailSender({
						sender: "noreply",
						receiver: user.dataValues.email,
						subject: `A password reset initiated`,
						content: {
							text: `Hello, ${user.dataValues.firstName}. Your password reset request was successful. Enter the code: ${OTPvalue} to complete the process.`,
							html: defaultMailTemplate({
								header: `Hello, ${user.dataValues.firstName ? user.dataValues.firstName : email}! `,
								body: `Here is the code to complete your password reset: ${OTPvalue}. It only for valid 15 minutes. 

              <br> Kindly ignore this email if you did not request a password reset`,
								footer: "Thank you!",
							}),
						},
					});

				// if (user.dataValues.phoneNumber)
				// 	try {
				// 		messagingSender({
				// 			message: `Here is the code ${OTPvalue} to reset your password.`,
				// 			receiver: user.dataValues.phoneNumber,
				// 		});
				// 	} catch (err) {
				// 		ctx.status = (err as object)["code" as keyof typeof err];
				// 		ctx.message = (err as object)["message" as keyof typeof err];
				// 		return;
				// 	}
			}
			ctx.status = statusCodes.OK;
			return (ctx.body = {
				status: statusCodes.OK,
				statusText: "Password reset initiated and reset code sent to user email.",
			});
		}
		ctx.status = statusCodes.NOT_FOUND;
		ctx.message = `Oops! The email looks incorrect. Please verify the email and try again.`;
		return;
	} catch (err) {
		logger.error("Password reset error:", err);
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		ctx.message = "Unable to initiate password reset. Kindly contact site administrator";
		return;
	}
};

export const NonAdminUsersController = { resetPassword };
