import koa, { Next } from "koa";
import jwt from "jsonwebtoken";
import paseto from "paseto";
import process from "node:process";
const { JWT_SECRET_KEY, APP_PASETO_KEY } = process.env;
import { logger } from "../logger.js";
import { BAD_REQUEST, SERVER_ERROR } from "../../constants/statusCodes.js";
import passport from "koa-passport";
import { statusCodes } from "../../constants/index.js";
import config from "../../../platform.config.js";
//console.log(require('crypto').randomBytes(64).toString('hex'));

const generateJwtToken = (data: string | object, options?: object) => {
	// an optional "options" allows to add extra JWT configuartions
	if (!JWT_SECRET_KEY) new Error("No Secret JWT Key provided for APP");
	else
		return jwt.sign(
			{
				result: data,
			},
			JWT_SECRET_KEY,
			{ expiresIn: "7d", issuer: config.siteAddress, ...options },
		);
	//else return null;
};

const verifyJwtToken = (token: string, options?: object) => {
	// an optional "options" allows to add extra JWT configuartions
	if (!JWT_SECRET_KEY) new Error("No Secret JWT Key provided for APP");
	else
		return jwt.verify(token, JWT_SECRET_KEY, options, (err, decoded) => {
			if (err || !decoded) {
				//console.log("err: ", err);
				const errMsg = {
					name: err && err.name && err.name,
				};
				if (err && err.message) errMsg["message" as keyof typeof errMsg] = err.message;
				//logger.error("JWT Token verification error:", err);
				return { error: errMsg };
			}
			//console.log(decoded.email);
			return decoded;
		});
};

//authenticate a token. Import Context 'ctx' for passport usage
/* const authenticateToken = (ctx) => { //deprecated
  return passport.authenticate("jwt", { session: false }, (err, user, info) => {
    console.log("info: ", info);
    console.log("user: ", user);
    if (info !== undefined) {
      ctx.status = BAD_REQUEST;
      ctx.message = info.message
        ? info.message.toLowerCase().includes("no auth token")
          ? "No valid authorization token provided."
          : info.message
        : "Unresolved request.";
      return;
    }
    if (err) {
      logger.error("Error:", err);
      ctx.status = SERVER_ERROR;
    }
    ctx.state.user = user;
    return;
  })(ctx);
}; */

const { V3 } = paseto;

const encryptionToken = async (data: string | object, options?: paseto.ProduceOptions, key = APP_PASETO_KEY) => {
	//console.log('options:', options)
	if (!key) new Error("No Secret Key provided for APP");
	// an optional "options" allows to add extra paseto configuration options
	else
		try {
			const encryption = await V3.encrypt(
				{
					result: data,
				},
				key,
				{
					expiresIn: "7d", // 24 hours | 20 m | 60s
					issuer: config.siteAddress,
					audience: config.sitename + ":APP",
					...options,
				},
			);
			if (encryption)
				//strip 'v3.local. to prevent exposing the version id of paseto
				return encryption.split("v3.local.")[1];
			else new Error("Unable to generate encrypted data");
		} catch (err) {
			const errMsg = {
				code: statusCodes.NOT_ACCEPTABLE,
				message: (err as object)["name" as keyof typeof err] && (err as object)["name" as keyof typeof err],
			};
			//logger.error("JWT Token verification error:", err);
			return { error: errMsg };
		}
};

const decryptToken = async (token: string, options?: paseto.ProduceOptions, key = APP_PASETO_KEY) => {
	if (!key) new Error("No Secret Key provided for APP");
	else {
		try {
			// an optional "options" allows to add extra PASETO configuration options
			//re-add 'v3.local. to key from paseto
			const decoded = await V3.decrypt("v3.local." + token, key, {
				audience: config.sitename + ":APP",
				issuer: config.siteAddress,
				clockTolerance: "1 min",
				...options,
			});
			//console.log("decoded:> ", decoded);
			return decoded;
		} catch (err) {
			const errMsg = {
				code: statusCodes.NOT_ACCEPTABLE,
				message: ((err as object)["name" as keyof typeof err] && (err as object)["name" as keyof typeof err]) as string,
			};
			if ((err as object)["expiredAt" as keyof typeof err])
				errMsg["message"] = errMsg["message"] + ": " + (err as object)["expiredAt" as keyof typeof err];
			//logger.error("JWT Token verification error:", err);
			return { error: errMsg };
		}
	}
};

/**
 * authenticate a token. Can be used as middleware and function with ctx as single argument
 *
 * @async
 * @param {koa.ParameterizedContext} ctx
 * @param {?Next} [next]
 * @returns {void | Next}
 */
const authenticateEncryptedToken = async (ctx: koa.ParameterizedContext, next?: Next): Promise<void | koa.Next> => {
	//const next = undefined as unknown as koa.Next;
	return await passport.authenticate("paseto", { session: false }, async (err, user, info) => {
		if (info !== undefined) {
			ctx.status = BAD_REQUEST;
			ctx.message = info.message
				? info.message.toLowerCase().includes("no auth token")
					? "No valid authorization token provided."
					: info.message
				: "Unresolved request.";
			return;
		}
		// console.log("err", err);
		// console.log("user", user);
		// console.log("info", info);
		if (err) {
			logger.error("Error:", err);
			ctx.status = err && err["code"] ? err["code"] : BAD_REQUEST;
			ctx.message =
				err && err["message"]
					? err["code"] === 406
						? "Invalid authorisation token"
						: err["message"]
					: "There was a problem signing you in";
			return;
		}
		ctx.state.user = user;
		// enable isAuthenticated
		if (user) ctx.isAuthenticated = () => true;
		if (!next) return;
		else await next();
	})(ctx, next!); /* next is problematic because its unused in current version on passport as
     p.then(cont => {
      // cont equals `false` when `res.redirect` or `res.end` got called
      // in this case, call next to continue through Koa's middleware stack
      if (cont !== false) {
        return next()
      }
    })
    always returns false
  */
};

/*
  useful for authenticating micro-service external apps, or third party apps against greybox server
  Still work in progress 
*/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const authenticateClientSecret = async (ctx: koa.ParameterizedContext) => {
	try {
		//switch to public key and private key combo
		const Authorization = ctx.get("authorization");
		const SecretAsJwt = Authorization.split(" ")[1];
		const decoded = await decryptToken(SecretAsJwt);
		const result = decoded ? decoded["result" as keyof typeof decoded] : undefined;

		console.log("Authorization", Authorization);
		console.log("SecretAsJwt", SecretAsJwt);
		console.log("result", result);

		/* console.log("Credential 1", await Credential.findAll());
    console.log(
      "Credential 2",
      await Credential.findAll().then((res) =>
        res.map((re) => {
          return re.toJSON();
        })
      )
    ); */

		if (!result) new Error("Invalid key");
		else {
			// const credential = await sequelize.models["Credential"].findOne({
			// 	where: { secret: result },
			// });
			// ctx.state.client = credential;
			return;
		}
	} catch (err) {
		logger.error("Error:", err);
		ctx.status = SERVER_ERROR;
	}
};

export { generateJwtToken, verifyJwtToken, encryptionToken, decryptToken, authenticateEncryptedToken, authenticateClientSecret };
