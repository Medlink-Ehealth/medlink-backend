import { Op, Sequelize } from "sequelize";
import { alphaNumericCodeGenerator } from "./alphaNumericCodeGenerator.js";
import { getOffsetTimestamp } from "./getOffsetTimestamp.js";
import config from "../../platform.config.js";
import { OTP } from "../models/OTP.model.js";
import { logger } from "../utils/logger.js";

// structure: SITE_ADDRESS/verifierRoutes/verifierSubLevelRoute/?otp=CODE&userDefineQueryEmail=info@site.com
export const otpLinkGenerator = async ({
	sequelize,
	expiry,
	entityReference, // exported to OTP model
	numberOfOTPChar,
	route,
	queryIdentifier, // exported to OTP model
	log, // exported to OTP model
	siteAddress, // allows custom site to be insert & ignore sitewide address setting
	typeOfOTPChar,
	retryRestrict = 60, // use to adjust the retry timespan in-between OTP requests. Default to 60 seconds
	returnOTP, // returns the OTP value rather than an OTP link
}: {
	sequelize: Sequelize;
	expiry?: string | number;
	entityReference: string;
	numberOfOTPChar?: number;
	typeOfOTPChar?: "alphanumeric" | "numbers" | "alphabets";
	route?: string;
	queryIdentifier: string | string[]; // can allow multiple identifiers to be passed in as array
	log: string;
	siteAddress?: string;
	retryRestrict?: number;
	returnOTP?: boolean;
}): Promise<string | string[] | ["pendingOtp", string] | null> => {
	try {
		let verificationSiteAddress = !returnOTP ? (siteAddress ? siteAddress : config.siteAddress) : undefined;
		if (verificationSiteAddress && verificationSiteAddress.endsWith("/"))
			verificationSiteAddress = verificationSiteAddress.substring(0, verificationSiteAddress.length - 1);

		const code = alphaNumericCodeGenerator({ length: numberOfOTPChar ? numberOfOTPChar : 10, type: typeOfOTPChar }); // generate OTP code
		const otpDeletionDate = getOffsetTimestamp(expiry ? expiry : 1);
		// generate OTP lifespan tracker in model, but we also want to protect against abuse with retryRestrict
		retryRestrict = typeof retryRestrict === "number" ? (retryRestrict >= 30 ? retryRestrict : 60) : 60; // ensure nothing less then 30 seconds, otherwise default to 60 seconds

		if (typeof queryIdentifier === "string") {
			const [otpInstance, isNew] = await OTP(sequelize).findOrCreate({
				where: {
					ref: entityReference,
					id: queryIdentifier,
					created: { [Op.gte]: Date.now() - 1000 * retryRestrict }, //creation within last 60 seconds or custom time
				},
				defaults: {
					code: code,
					ref: entityReference,
					id: queryIdentifier,
					markForDeletionBy: otpDeletionDate,
					log: log,
					created: Date.now(), // becuase we set this in where, we need to override else that same past time would be imported here
				},
			});
			if (!isNew) return ["pendingOtp", otpInstance.getDataValue("code")]; // return active OTP
		} else if (Array.isArray(queryIdentifier)) {
			// Control retries - check for last iteration if within active time and the rest can be safely ignored
			const lastIteration = queryIdentifier.pop();
			const [otpInstance, isNew] = await OTP(sequelize).findOrCreate({
				where: {
					ref: entityReference,
					id: lastIteration,
					created: { [Op.gte]: Date.now() - 1000 * retryRestrict }, //creation within last 60 seconds or custom time
				},
				defaults: {
					code: code,
					ref: entityReference,
					id: lastIteration,
					markForDeletionBy: otpDeletionDate,
					log: log,
					created: Date.now(), // becuase we set this in where, we need to override else that same past time would be imported here
				},
			});
			if (!isNew) return ["pendingOtp", otpInstance.getDataValue("code")]; // return active OTP

			// process the remaining if we get here
			await Promise.all(
				queryIdentifier.map((identifier) =>
					OTP(sequelize).create({
						code: code,
						ref: entityReference,
						id: identifier,
						markForDeletionBy: otpDeletionDate,
						log: log,
					}),
				),
			);
		}
		// ensure proper construct for route
		if (!returnOTP && route) {
			if (!route.startsWith("/")) route = "/" + route;
			if (route.endsWith("/")) route = route.substring(0, route.length - 1);
		}
		return returnOTP
			? code
			: verificationSiteAddress
				? Array.isArray(queryIdentifier)
					? queryIdentifier.map((identifier) => verificationSiteAddress + (route ? route : "") + "?otp=" + code + "&id=" + identifier)
					: verificationSiteAddress + (route ? route : "") + "?otp=" + code + "&id=" + queryIdentifier
				: null;
	} catch (err: unknown) {
		logger.error("otpLinkGenerator: 'Server currently unable to generate a trackable otp code',", err);
		new Error("Server currently unable to generate a trackable otp");
		return null;
	}
};
