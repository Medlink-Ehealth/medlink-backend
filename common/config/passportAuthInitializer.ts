import LocalStrategy from "passport-local";
import passportCustom from "passport-custom";
import { decryptToken, encryptionToken } from "../utils/authorization/token.js";
import bcrypt from "bcryptjs";
import passportLib from "koa-passport";
import GoogleStrategy from "passport-google-oauth20";
import FacebookStrategy from "passport-facebook";
import { UNAUTHORIZED } from "../constants/statusCodes.js";
import { appInstance } from "../server.js";
const { googleID, googleSECRET, fbID, fbSECRET } = process.env;

const signInWithThirdPartyProcessor = async ({
	app,
	accessToken,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	refreshToken, // to be implemented if ever needed
	profile,
	cb,
}: {
	app: string;
	accessToken: string;
	refreshToken: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	profile: any;
	cb: (response: string | Error | null | undefined, token?: string, profile?: object) => void;
}) => {
	//console.log("accessToken:: ", accessToken);
	//console.log("refreshToken:: ", refreshToken);
	//console.log("profile:: ", profile);
	if (accessToken && profile) {
		try {
			let email;
			if (app === "google") {
				// Halt the probing of the database if the imported google profile is unverified.
				if (!profile.emails[0].verified) return cb(new Error("Please sign in using a verifed google account!"));
				email = profile.emails[0].value;
			} else if (app === "facebook") {
				// Halt the probing of the database if the imported facebook has no attached email address
				if (!profile.email)
					return cb(new Error("Sorry, we currently cannot sign you in with facebook. Please try other available signing in option."));
				email = profile.email;
			}
			if (email) {
				const token = await encryptionToken(email, {
					expiresIn: (3 * 60).toString() + "m", //expires after 3 minutes
				});
				return cb(null, token as unknown as string, profile);
			} else return cb(new Error("Oops! There was an error getting your profile information. Please try again later"));
		} catch (err) {
			//logger.error(err);
			return cb(err as Error);
		}
	}
	return cb({
		status: UNAUTHORIZED,
		statusText: "Authorisation denied from your social media account.",
	} as unknown as Error);
};

export const passportAuthInitializer = async (passport: typeof passportLib) => {
	//if (config.appMode === "serverless") return;
	/**
	 * Serialize user
	 *
	 * @param object        user account info
	 */
	passport.serializeUser((user, done: (arg0: null, arg1: Express.User) => void) => {
		//console.log("user 1111: ", user);
		done(null, user);
	});

	/**
	 * Deserialize user from session
	 *
	 * @param string uuid as id   User account unique identifier
	 * @returns
	 */
	passport.deserializeUser(async (user, done: (arg0: null, arg1: Express.User) => void) => {
		//console.log("user 2222: ", user);
		if (user) {
			done(null, user);
		}
	});

	/**
	 * Localstrategy of Passport.js
	 *
	 * @param string        email
	 * @param string        password
	 * @returns
	 */
	// user accounts.
	// defaults to general accounts but when admin specific accounts is imported,
	// specify by passing 'Admin' or any other specific account model type in the passport.userType attribute.
	passport.use(
		new LocalStrategy.Strategy(
			{
				passReqToCallback: true,
				usernameField: "email",
				//session: false
				//passwordField: 'password',
				/* session:
          passport.requestToken && passport.requestToken === "session"
            ? true
            : false, 
        Conditional session don't work because session key is loaded at APP start-up. If needed, conditional have to be defined outside of APP context as now implemented in request.header as key "x-usertype"
        */
			},
			async (req, email, password, done) => {
				//console.log("req", req);
				const accountType = req.header["x-usertype" as keyof typeof req.header]
					? req.header["x-usertype" as keyof typeof req.header]
					: "Admin";
				try {
					const sequelize = appInstance.currentContext?.sequelizeInstance;
					if (!sequelize) return done(null, false);

					const user = await sequelize.models[accountType].scope("raw").findOne({
						where: {
							email: email,
						},
					});
					if (user) {
						if (bcrypt.compareSync(password, user.dataValues.password)) {
							done(null, user);
						} else {
							done(null, false);
						}
					} else {
						done(null, false);
					}
				} catch (err) {
					done(err);
				}
			},
		),
	);

	/**
	 * Adapting Localstrategy for  phone number Passport.js sign-in
	 *
	 * @param string        phoneNumber
	 * @param string        password
	 * @returns
	 */
	// specify by passing 'Admin' or any other specific account model type in the passport.userType attribute.
	passport.use(
		"phoneNumber",
		new LocalStrategy.Strategy(
			{
				passReqToCallback: true,
				usernameField: "phoneNumber",
			},
			async (req, phoneNumber, password, done) => {
				//console.log("req", req);
				const accountType = req.header["x-usertype" as keyof typeof req.header]
					? req.header["x-usertype" as keyof typeof req.header]
					: "Admin";
				try {
					const sequelize = appInstance.currentContext?.sequelizeInstance;
					if (!sequelize) return done(null, false);

					const user = await sequelize.models[accountType].scope("raw").findOne({
						where: {
							phoneNumber: phoneNumber,
						},
					});
					if (user) {
						if (bcrypt.compareSync(password, user.dataValues.password)) {
							done(null, user);
						} else {
							done(null, false);
						}
					} else {
						done(null, false);
					}
				} catch (err) {
					done(err);
				}
			},
		),
	);

	/**
	 * Custom strategy of Passport.js to be used with PASETO
	 *
	 * @param object        opt
	 * @param function      callback
	 * @returns
	 */
	const CustomStrategy = passportCustom.Strategy;
	passport.use(
		"paseto",
		new CustomStrategy(async function (req, done) {
			// may optionally be checked in request body if not available in heaader
			let authorization = req.headers.authorization?.split(" ")[1]; // may also contain tenantMode prefix introduced in greybox v2.0
			// check for the tenantMode set
			const tenantMode = appInstance.currentContext?.tenantMode;
			if (tenantMode && authorization && authorization.startsWith(tenantMode + "_")) authorization = authorization.substring(tenantMode.length + 1); // strip the db prefix

			const token = authorization || req.body ? req.body["token"] : undefined;
			if (!token) {
				//new Error("Bad token in request");
				return done(null, false);
			} else {
				const payload = await decryptToken(token);
				return done(payload && payload.error ? payload.error : null, payload ? payload["result" as keyof typeof payload] : false);
			}
		}),
	);

	if (googleID && googleSECRET) {
		passport.use(
			"google",
			new GoogleStrategy.Strategy(
				{
					clientID: googleID,
					clientSecret: googleSECRET,
					//callbackURL: '/api/v3/admin/sign-in-with/google/verify?access=session', //dummy data as callback is set in authenticate function
					passReqToCallback: true,
					//scope: ["profile"],
					//state: true,
				},
				async (
					req: unknown,
					accessToken: string,
					refreshToken: string,
					profile: object,
					cb: (response: string | Error | null | undefined, token?: string, profile?: object) => void,
				) => {
					await signInWithThirdPartyProcessor({
						app: "google",
						accessToken: accessToken,
						refreshToken: refreshToken,
						profile: profile,
						cb: cb,
					});
				},
			),
		);
	}
	if (fbID && fbSECRET) {
		passport.use(
			"facebook",
			new FacebookStrategy.Strategy(
				{
					clientID: fbID,
					clientSecret: fbSECRET,
					callbackURL: "callbackUrl", //dummy data as callback is set in authenticate function
					enableProof: true,
					profileFields: ["id", "name", "email", "picture"],
				},
				async (
					token: string,
					tokenSecret: string,
					profile: object,
					cb: (response: string | Error | null | undefined, token?: string, profile?: object) => void,
				) => {
					await signInWithThirdPartyProcessor({
						app: "facebook",
						accessToken: token,
						refreshToken: tokenSecret,
						profile: profile,
						cb: cb,
					});
				},
			),
		);
	}
};
