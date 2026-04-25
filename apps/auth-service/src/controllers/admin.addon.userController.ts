import { AppContext, defaultMailTemplate, logger, mailSender, otpLinkGenerator, statusCodes } from "@medlink/common";
import { Admin } from "../models/accounts/Admin.model.js";

// reset account password custom-handled for email customisation purposes
const resetPassword =
	({ validationUrl, siteAddress }: { validationUrl: string; siteAddress?: string }) =>
	async (ctx: AppContext) => {
		const { email } = ctx.request.body;
		if (!ctx.sequelizeInstance) {
			logger.error("resetPassword Error: ", "No active ctx.sequelizeInstance to match request to!");
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			return;
		}
		const whereFilter = email ? { email: email } : null;

		if (!whereFilter) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Email must be provided for password reset";
			return;
		}
		try {
			const user = await Admin(ctx.sequelizeInstance).findOne({
				where: whereFilter,
			});
			if (user instanceof Admin) {
				const verificationLink = await otpLinkGenerator({
					sequelize: ctx.sequelizeInstance,
					expiry: "15m",
					numberOfOTPChar: 10,
					entityReference: "Admin",
					queryIdentifier: email,
					//typeOfOTPChar: "numbers",
					route: validationUrl ? validationUrl : ctx.path, // optional use current ctx route as dummy path
					log: `Admin user account password reset`,
					siteAddress: siteAddress,
				});

				//send a reset email
				if (verificationLink) {
					if (Array.isArray(verificationLink) && verificationLink[0] === "pendingOtp") {
						ctx.status = statusCodes.TOO_EARLY;
						return (ctx.body = {
							status: statusCodes.TOO_EARLY,
							statusText: "Retry is too early",
						});
					}
					const extractedCode = (verificationLink as string).split("?otp=")[1].split("&id=")[0];
					mailSender({
						sender: "noreply",
						receiver: email,
						subject: `A password reset initiated`,
						content: {
							text: `Hello, ${user.dataValues.firstName}`,
							html: defaultMailTemplate({
								header: `Hello, ${user.dataValues.firstName ? user.dataValues.firstName : email}! `,
								body: `Click <a href="${verificationLink}" target="_blank" style="color: #ffffff; text-decoration: none; font-weight: bold;">reset link</a>, or provide code: ${extractedCode} to complete reset of password, only for valid 15 minutes. 

              <br> Kindly ignore this email if you did not request a password reset`,
								footer: "Thank you!",
							}),
						},
					});
				}

				ctx.status = statusCodes.OK;
				return (ctx.body = {
					status: statusCodes.OK,
					statusText: "Password reset successful",
				});
			}
			ctx.status = statusCodes.NOT_FOUND;
			ctx.message = "Oops! The email looks incorrect. Please verify the email and try again.";
			return;
		} catch (err) {
			logger.error("Password reset error:", err);
			ctx.status = statusCodes.SERVER_ERROR;
			return;
		}
	};

export const adminController = { resetPassword };
