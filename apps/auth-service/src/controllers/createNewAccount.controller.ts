import { Next } from "koa";
import { AppContext } from "../../../../common/@types/utils.js";
import { statusCodes } from "../../../../common/constants/index.js";
import { otpLinkGenerator } from "../../../../common/functions/otpLinkGenerator.js";
import { mailSender } from "../../../../common/functions/mailSender.js";
import { logger } from "../../../../common/utils/logger.js";
import { hashPassword } from "../../../../common/utils/index.js";
import { getOffsetTimestamp } from "../../../../common/functions/getOffsetTimestamp.js";
import { newUserAccountCreationTemplate } from "../../../../common/functions/mailTemplates/newUserAccountCreationTemplate.js";
import { Client } from "../models/accounts/Client.model.js";
import { Op } from "sequelize";
import config from "../../../../platform.config.js";

/**
 *  @description Middleware to create a user for platform, sending mail with verification link. Making this dynamic enough to be usable across any user account type
 *  @params Request body must exist, containing necessary info for account creation
 *  @returns {Admin|Client}
 */
export const createNewAccount = (options?: { verificationExpiry: string | number }) => async (ctx: AppContext, next: Next) => {
	if (!ctx.state.userType) {
		logger.error("User creation error: ", "User type needs to be defined in context state: ctx.state.userType");
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message = "Account creation failed as user type undefined in server process.";
		return;
	} else if (!ctx.sequelizeInstance) {
		logger.error("createNewAccount Error: ", "No active ctx.sequelizeInstance to match request to!");
		ctx.status = statusCodes.SERVICE_UNAVAILABLE;
		return;
	}
	const { password, repeatedPassword } = ctx.request.body;
	// ensure repeated password is same
	if (password !== repeatedPassword) {
		ctx.state.error = {
			code: statusCodes.NOT_ACCEPTABLE,
			message: "Repeated passwords must be the same.",
		};
		return await next();
	}
	try {
		// As a caution because of how the platform app works, by letting both CLient and Delivery Partners users to login on the same endpoint. An existing account in one cannot also exist in the other.
		if (ctx.state.userType === "Client" || ctx.state.userType === "DeliveryPartner") {
			const whereFilter =
				ctx.request.body.email && ctx.request.body.phoneNumber
					? {
							[Op.or]: [{ email: ctx.request.body.email }, { phoneNumber: ctx.request.body.phoneNumber }],
						}
					: ctx.request.body.email
						? { email: ctx.request.body.email }
						: ctx.request.body.phoneNumber
							? { phoneNumber: ctx.request.body.phoneNumber }
							: null;
			if (!whereFilter) {
				ctx.state.error = {
					code: statusCodes.BAD_REQUEST,
					message: "Either email or phone number must be provided for registration",
				};
				return await next();
			}

			const checkIfInClient = await Client(ctx.sequelizeInstance).findOne({ where: whereFilter });
			if (checkIfInClient) {
				ctx.state.error = {
					code: statusCodes.FORBIDDEN,
					message:
						"Sorry, currently unable to create this account. This email is currently registered as a Client User account on the platform",
				};
				return await next();
			}
		}
		const hashedPassword = hashPassword(password.trim());
		// set account for deletion if unverified after 30 days
		const setForUnverfiedDeletion = getOffsetTimestamp(30);

		const newUser = await ctx.sequelizeInstance.models[ctx.state.userType].create({
			...ctx.request.body,
			password: hashedPassword,
			markForDeletionBy: setForUnverfiedDeletion,
		});

		if (newUser && newUser.dataValues.uuid) {
			const OTPvalueOrUrl = await otpLinkGenerator({
				sequelize: ctx.sequelizeInstance,
				entityReference: ctx.state.userType,
				numberOfOTPChar: ctx.state.userType === "DeliveryPartner" ? 6 : 4,
				typeOfOTPChar: ctx.state.userType === "DeliveryPartner" ? "alphanumeric" : "numbers",
				queryIdentifier:
					newUser.dataValues.email && newUser.dataValues.phoneNumber
						? [newUser.dataValues.email, newUser.dataValues.phoneNumber]
						: newUser.dataValues.email
							? newUser.dataValues.email
							: newUser.dataValues.phoneNumber,
				log: `${ctx.state.userType}: New account creation`,
				expiry: options && options.verificationExpiry ? options.verificationExpiry : "15m",
				route: ctx.state.userType === "DeliveryPartner" ? "/api/v1/s/otp/newuser" : undefined, //available at dir system/otp/newUserVerify.routes
				returnOTP: ctx.state.userType === "DeliveryPartner" ? false : true,
			});

			if (OTPvalueOrUrl) {
				if (Array.isArray(OTPvalueOrUrl) && OTPvalueOrUrl[0] === "pendingOtp") {
					ctx.status = statusCodes.TOO_EARLY;
					return (ctx.body = {
						status: statusCodes.TOO_EARLY,
						statusText: "Retry is too early",
					});
				}
				if (newUser.dataValues.email)
					mailSender({
						ignoreDevReceiverRewriteToSender: true,
						sender: "noreply",
						receiver: newUser.dataValues.email,
						subject: `New account creation for ${newUser.dataValues.firstName}`,
						content: {
							text: `Hello ${newUser.dataValues.firstName}. Your registration was successful. ${
								ctx.state.userType === "DeliveryPartner"
									? "Click the verification link: " +
										(Array.isArray(OTPvalueOrUrl) ? OTPvalueOrUrl[0] : OTPvalueOrUrl) +
										"&userType=DeliveryPartner"
									: "Enter the code: " + (Array.isArray(OTPvalueOrUrl) ? OTPvalueOrUrl[0] : OTPvalueOrUrl)
							} to complete the process.`,
							html: newUserAccountCreationTemplate({
								verificationLink:
									ctx.state.userType === "DeliveryPartner"
										? (Array.isArray(OTPvalueOrUrl) ? OTPvalueOrUrl[0] : OTPvalueOrUrl) + `&userType=DeliveryPartner`
										: undefined, //insert user account type as query to verification link
								otp:
									ctx.state.userType !== "DeliveryPartner" ? (Array.isArray(OTPvalueOrUrl) ? OTPvalueOrUrl[0] : OTPvalueOrUrl) : undefined,
								greetings: "Welcome to the family",
								name: newUser.dataValues.firstName,
								body: `${config.sitename} is this easy! Welcome on board.
								<br> Complete the sign up process providing the code to the App. Code is only valid for 15 minutes only`,
								footer: "Once again, welcome!",
							}),
						},
					});
			}
			ctx.state.newUser = newUser;
		} else {
			logger.info("Account controller: Could not verify the creation of new account as true");
			ctx.state.error = {
				code: statusCodes.SERVICE_UNAVAILABLE,
				message: "Unable to verify new account",
			};
		}

		await next();
	} catch (err) {
		logger.error("Server error while trying to create new account with sequelize", err);
		ctx.state.error = {
			code: statusCodes.SERVER_ERROR,
			message: (err as object)["parent" as keyof typeof err]
				? (err as object)["parent" as keyof typeof err]["detail" as keyof typeof err]
				: (err as object)["message" as keyof typeof err]
					? (err as object)["message" as keyof typeof err]
					: "Unable to create account",
		};
	}
};
