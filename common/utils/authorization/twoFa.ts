import { Totp, generateConfig, Hotp, generateSecret, generateBackupCodes } from "time2fa";
import { logger } from "../logger.js";
import { config } from "../../platform.config.js";

/* 
    Implementation, time2fa library, of One-Time Password (OTP) authentication using HMAC-based One-Time Password (HOTP) and Time-based One-Time Password (TOTP) algorithms.
 */

//Generate Secret for "TOTP" | "HOTP"
const generate2faSecret = ({
	type,
	user,
	size,
	periodInSecond,
}: {
	type?: "TOTP" | "HOTP";
	user: string;
	size?: number;
	periodInSecond?: number;
}) => {
	if (!user && (!type || type === "TOTP")) {
		logger.error(
			"Define the USER 'detail(name, email, or ID)' to generate a TOTP Secret for a user. This is ignored (Not needed) for HOTP Secret.",
		);
		return new Error("Unable to generate a unique Secret. Please try again later");
	}

	let secret;
	if (type && type === "HOTP") secret = generateSecret(size);
	else {
		const key = Totp.generateKey(
			{
				issuer: config.serverAddress || "Greybox",
				user: user,
			},
			{ secretSize: size, period: periodInSecond || 30 },
		);
		secret = key["secret"];
	}

	if (secret) return secret;
	else return null;
};
// TOTP GenerateKey {
//   issuer: 'N0C',
//   user: 'johndoe@n0c.com',
//   config: { algo: 'sha1', digits: 6, period: 30, secretSize: 10 },
//   secret: 'ABCDEFGHIJKLMN12',
//   url: 'otpauth://totp/N0C:johndoe%40n0c.com?issuer=N0C&period=30&secret=ABCDEFGHIJKLMN12'
// }

//Validate Passcode
const validate2faCode = ({ type, passcode, userSecret }: { type?: "TOTP" | "HOTP"; passcode: string | number; userSecret: string }) => {
	if (!userSecret) return new Error("userSecret is needed to process Validation.");

	let status;
	if (type === "HOTP") {
		status = Hotp.validate({
			passcode: passcode.toString(),
			secret: userSecret,
			counter: 1, //Custom counter value
		});
	} else
		status = Totp.validate({
			passcode: passcode.toString(),
			secret: userSecret,
			drift: 3, //Time tolerance
		});
	return status; // true || false
};

// Generate passcodes
const generate2faCode = ({ type, userSecret }: { type?: "TOTP" | "HOTP"; userSecret: string }) => {
	if (!userSecret) return new Error("userSecret is needed to process generate code(s).");

	const config = generateConfig();
	let code; //TOTP generates array of codes while HOTP a single code

	if (type !== "HOTP") {
		code = Totp.generatePasscodes({ secret: userSecret }, config);
	} else {
		code = Hotp.generatePasscode({ secret: userSecret, counter: 1 }, config);
	}
	return code;
};

// Generate passcodes
const generate2faBackupCodes = () => generateBackupCodes();

export { generate2faSecret, validate2faCode, generate2faCode, generate2faBackupCodes };
