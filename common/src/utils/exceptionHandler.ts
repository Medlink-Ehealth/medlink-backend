import { ParameterizedContext } from "koa";
import { logger } from "./logger.js";
import { statusCodes } from "../constants/index.js";

export const exceptionHandler = ({
	err,
	ctx,
	code,
	loggerPreMessage,
	errMessageSuffix,
	disableLogger = false,
}: {
	ctx: ParameterizedContext;
	code?: number;
	err: unknown;
	loggerPreMessage?: string;
	errMessageSuffix?: string;
	disableLogger?: boolean;
}) => {
	if (!disableLogger) logger.error(loggerPreMessage || "Error: ", err);
	//console.log("ex handler", err);
	const errorMessage =
		typeof err === "string"
			? err
			: err
			? (err as object)["parent" as keyof typeof err] && (err as object)["parent" as keyof typeof err]["detail"]
				? (err as object)["parent" as keyof typeof err]["detail"]
				: (err as object)["message" as keyof typeof err] ||
				  ((err as object)["details" as keyof typeof err] &&
						((err as object)["details" as keyof typeof err]["message"] ||
							((err as object)["details" as keyof typeof err][0] && (err as object)["details" as keyof typeof err][0]["message"]))) ||
				  (err as object).toString() ||
				  "An error occurred"
			: "An error occurred";

	const errorCode =
		code ||
		(err as object)["status" as keyof typeof err] ||
		((err as object)["code" as keyof typeof err] &&
			typeof (err as object)["code" as keyof typeof err] === "number" &&
			(err as object)["code" as keyof typeof err]) ||
		((err as object)["statusCode" as keyof typeof err] &&
			typeof (err as object)["statusCode" as keyof typeof err] === "number" &&
			(err as object)["statusCode" as keyof typeof err]) ||
		((errorMessage.includes("notNull Violation") ||
			errorMessage.toLowerCase().includes("invalid") ||
			(err as object).toString().includes("BadRequest") ||
			((err as object)["name" as keyof typeof err] as string)?.includes("Sequelize")) &&
			statusCodes.BAD_REQUEST) ||
		((err as object)["stack" as keyof typeof err] &&
			JSON.stringify((err as object)["stack" as keyof typeof err]).includes("NotAcceptableError:") &&
			statusCodes.NOT_ACCEPTABLE) ||
		statusCodes.INTERNAL_SERVER_ERROR;

	ctx.status = errorCode;
	ctx.message = (errorMessage as string).toString().replace("/[^a-zA-Z0-9 ]/g", "") + (errMessageSuffix ? ". " + errMessageSuffix : "");
	return;
};
