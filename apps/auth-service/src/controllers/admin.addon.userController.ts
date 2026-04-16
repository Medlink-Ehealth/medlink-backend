import { AppContext } from "../../../../common/@types/utils.js";
import { statusCodes } from "../../../../common/constants/index.js";
import { Admin } from "../models/accounts/Admin.model.js";
import { otpLinkGenerator } from "../../../../common/functions/otpLinkGenerator.js";
import { mailSender } from "../../../../common/functions/mailSender.js";
import { defaultMailTemplate } from "../../../../common/functions/mailTemplates/defaultMailTemplate.js";
import { logger } from "../../../../common/utils/logger.js";

// reset account password custom-handled for email customisation purposes
const resetPassword =
	({ validationUrl, siteAddress }: { validationUrl: string; siteAddress?: string }) =>
	async (ctx: AppContext) => {
		const { email, phoneNumber } = ctx.request.body;
		// let protect against bad combination owned by different users
		if (email && phoneNumber) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Only one of email or phone number is required for password reset";
			return;
		} else if (!ctx.sequelizeInstance) {
			logger.error("resetPassword Error: ", "No active ctx.sequelizeInstance to match request to!");
			ctx.status = statusCodes.SERVICE_UNAVAILABLE;
			return;
		}
		const whereFilter = email ? { email: email } : phoneNumber ? { phoneNumber: phoneNumber } : null;

		if (!whereFilter) {
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = "Either email or phone number must be provided for password reset";
			return;
		}
		try {
			const user = await Admin(ctx.sequelizeInstance).findOne({
				where: whereFilter,
			});
			if (user instanceof Admin) {
				const identifier = email && phoneNumber ? 2 : email ? 1 : 3; // 1: email, 2: both, 3: phoneNumber
				const verificationLink = await otpLinkGenerator({
					sequelize: ctx.sequelizeInstance,
					expiry: "15m",
					numberOfOTPChar: 10,
					entityReference: "Admin",
					queryIdentifier: identifier === 2 ? [email, phoneNumber] : identifier === 1 ? email : phoneNumber,
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
					const extractedCode =
						identifier === 2
							? verificationLink[0].split("?otp=")[1].split("&id=")[0]
							: (verificationLink as string).split("?otp=")[1].split("&id=")[0];
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
