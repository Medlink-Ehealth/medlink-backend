import { Op, Sequelize } from "sequelize";
import { OTP } from "../../models/OTP.model.js"; 
import { logger } from "../../utils/logger.js";
import { Next, ParameterizedContext } from "koa";
import { BAD_REQUEST, INTERNAL_SERVER_ERROR, NOT_FOUND, SERVICE_UNAVAILABLE } from "../../constants/statusCodes.js";
import { throwError } from "../../functions/throwError.js";
import { exceptionHandler } from "../../utils/exceptionHandler.js";

/**
 *
 * @param otp number or string
 * @param id Specific ID we are verifying. Must exist
 * @param ref the schema entity this verifier must align to. This is an optional property
 * @returns id
 */
export const otpVerifier = async (sequelize: Sequelize, otp: number | string, id: string, ref?: string | void): Promise<string | void> => {
	// ensure id and otp is provided
	if (id && otp) {
		// check validity of OTP and a compulsory expiry filteration
		try {
			const whereFilter = {
				code: otp.toString(),
				id: id,
				markForDeletionBy: { [Op.gte]: Date.now() },
			};
			if (ref) whereFilter["ref" as "id"] = ref;

			const getOTP = await OTP(sequelize).findOne({
				where: whereFilter,
			});
			// console.log("otpVerifier | getOTP: ", getOTP);

			if (getOTP && getOTP instanceof OTP(sequelize) && getOTP.dataValues && getOTP.dataValues.id) {
				const thisId = getOTP.dataValues.id;
				// destroy OTP record
				getOTP.destroy();
				// return success with Entity UUID or the specific ID used for generation
				return thisId;
			} else {
				const error = new Error("Invalid code") as unknown as { statusCode: number; status?: number };
				error["statusCode"] = NOT_FOUND;
				//error["status"] = NOT_FOUND;
				throw error;
			}
		} catch (err: unknown) {
			//console.log('err: ',err)
			logger.error("otpVerifier: 'Server caught error finding OTP',", err);

			return throwError(
				(err as object)["statusCode" as keyof typeof err] || SERVICE_UNAVAILABLE,
				(err as object)["message" as keyof typeof err] || "Server currently unable to verify OTP.",
			);
		}
	} else {
		return throwError(INTERNAL_SERVER_ERROR, "OTP and ID provision error");
	}
};

/* 
  Can be used as either middleware or as a function
  Verified ID is exported in states as ctx.state.otpLinkVerifier
*/

/**
 * Auto verify an OTP link with needed variables 'id' & 'otp', Note that variables must be available as URL query strings.
 * @description This middleware is used to verify OTP links. It checks the validity of the OTP and a compulsory expiry filteration. Can be used as either middleware or as a function, and Verified ID is exported in states as ctx.state.otpLinkVerifier when valid.
 * @async
 * @queries {id} [string], otp [string|number],{ref} [string]
 * @param {ParameterizedContext} ctx
 * @param {?Next} [next]
 * @returns {Promise<"verifiedID" | void>}
 * @returns [ctx.state.otpLinkVerifier, available in context]
 */
export const otpLinkVerifier = async (ctx: ParameterizedContext, next?: Next): Promise<string | void> => {
	if (!ctx.sequelizeInstance) {
		logger.error("otpLinkVerifier Error: ", "No active ctx.sequelizeInstance to match request to!");
		ctx.status = SERVICE_UNAVAILABLE;
		ctx.message = "OTP verification currently not available";
		return;
	}
	const { id, otp, ref } = ctx.query;
	// ensure id and otp exist in query parameters
	if (id && otp) {
		// check validity of OTP and a compulsory expiry filteration
		// we are also optionally allowing allows the ref'd entity to be referenced 'ref'
		try {
			const thisId = await otpVerifier(ctx.sequelizeInstance, otp as number | string, id as string, ref as string | undefined | void);
			//console.log("otpLinkVerifier | getOTP: ", thisId);

			ctx.state.otpLinkVerifier = thisId; // save in state for downstream usage
			// return success with Entity UUID or the specific ID used for generation
			if (!next) return thisId;
			else await next();
		} catch (err: unknown) {
			logger.error("otpLinkVerifier: 'Server caught error finding OTP',", err);

			if ((err as object)["statusCode" as keyof typeof err] && (err as object)["message" as keyof typeof err]) {
				ctx.status = (err as object)["statusCode" as keyof typeof err];
				ctx.message = (err as object)["message" as keyof typeof err];
				return;
			} else return exceptionHandler({ ctx, err });
		}
	} else {
		ctx.status = BAD_REQUEST;
		ctx.message = "Unable to extract OTP and ID from URL query. Looks like a badly constructed link";
		return;
	}
};
