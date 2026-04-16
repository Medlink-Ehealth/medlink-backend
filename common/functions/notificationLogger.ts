import { ParameterizedContext } from "koa";
import validator from "validator";
import { notificationTemplate } from "./mailTemplates/notificationTemplate.js";
import { Sequelize } from "sequelize";
import { appInstance } from "../server.js";
import { statusCodes } from "../constants/index.js";
import { logger } from "../utils/logger.js";
import { UUID4Validator } from "./UUID4Validator.js";
import { throwError } from "./throwError.js";
import { Server, Socket } from "socket.io";
import { Notification } from "../models/Notification.model.js";
import config from "../../platform.config.js";
import { mailSender } from "./mailSender.js";

const notificationLogger = async ({
	detail,
	meta,
	ctx,
	sendMail,
}: {
	detail: string;
	meta: {
		target: "Client" | "Admin" | "DeliveryPartner"; //string;
		uuid: `${string}-${string}-${string}-${string}-${string}` | "xxx-xxxx-xxxxx-xxxxxx" | "self";
		filter?: { [filterLabel: string]: string | boolean | number | string[] | number[] };
	};
	ctx?: ParameterizedContext;
	sendMail?: boolean;
}) => {
	// for Instance objectification to work, DB instance must exist
	const sequelize = (ctx?.sequelizeInstance || appInstance.currentContext?.sequelizeInstance) as Sequelize;
	if (!sequelize) {
		logger.error("No useable sequilize instance in notificationLogger");
		new Error(statusCodes.INTERNAL_SERVER_ERROR + `Sorry we are currently unable to process notifications`);
		return;
	}

	// lets control meta object values if it escapes Model set controller by chance (similar implemented directly on Notification Model setter)
	if ("target" in meta === false || "uuid" in meta === false) {
		if (ctx) throwError(statusCodes.SERVER_ERROR, "Both the target model and unique UUID to assign notification to has to be defined");
		else new Error(statusCodes.SERVER_ERROR + ": Both the target model and unique UUID to assign notification to has to be defined");
	} else if (!UUID4Validator(meta["uuid"]) && meta["uuid"] !== "xxx-xxxx-xxxxx-xxxxxx" && meta["uuid"].toLowerCase() !== "self") {
		if (ctx)
			throwError(
				statusCodes.SERVER_ERROR,
				"Unique UUID defined is invalid, you may optionally provide 'xxx-xxxx-xxxxx-xxxxxx' if you intend the 'uuid' to be ignored",
			);
		else
			new Error(
				statusCodes.SERVER_ERROR +
					": Unique UUID defined is invalid, you may optionally provide 'xxx-xxxx-xxxxx-xxxxxx' if you intend the 'uuid' to be ignored",
			);
	} else if (!sequelize.models[meta["target"]]) {
		if (ctx) throwError(statusCodes.SERVER_ERROR, "Ensure 'target' is a valid model");
		else new Error(statusCodes.SERVER_ERROR + ": Ensure 'target' is a valid model");
	} else if (meta["filter"] && (typeof meta["filter"] !== "object" || (meta["filter"] && !Object.keys(meta["filter"]).length))) {
		if (ctx) throwError(statusCodes.SERVER_ERROR, "Ensure filter is a valid meta object");
		else new Error(statusCodes.SERVER_ERROR + ": Ensure filter is a valid meta object");
	}

	try {
		const notificationObj = await Notification(sequelize).create({ detail: detail, meta: meta, status: "unread" });
		//console.log("notificationObj", notificationObj);
		if (notificationObj instanceof Notification(sequelize)) {
			const notification = notificationObj.toJSON();
			// meta is present in initial creation of notification model. Lets remove it in object
			delete notification["meta"];
			// initiate socket events
			/* 
				Notifications possible actions
						new => to send a new notification to client
						read => update state of notification to read

						target: "Admin",
						uuid: "xxx-xxxx-xxxxx-xxxxxx",
						filter: {
							roleLabel: "Operations Staff",
							role: 2 | [2, 3],
							//operator: ">=", optional props when role exists

							location: "Lagos"| ["Lagos", "Abuja"]
						}, 
			*/
			// Generalised notification by system events, dependent on context
			if (ctx) {
				if (meta.uuid === "xxx-xxxx-xxxxx-xxxxxx") {
					// when no specific filter exists, send to all target connect clients
					if (!meta.filter) {
						if (ctx.ioSocket) (ctx.ioSocket as Socket).to(meta.target).emit("notification", notification);
					} else {
						const sockets = await (ctx.io as Server).fetchSockets();
						sockets.forEach((socket) => {
							let passSocket = true; // true means to broadcast to socket

							const user = socket.data.user;
							Object(meta.filter).keys.forEach((filterProp: string) => {
								if (typeof meta.filter![filterProp] === "string" && user[filterProp as "type"] === meta.filter![filterProp]) return;
								else if (
									Array.isArray(typeof meta.filter![filterProp]) &&
									(meta.filter![filterProp] as string[]).includes(user[filterProp as "type"])
								)
									return;
								else if (user[filterProp as "type"] === meta.filter![filterProp]) return;
								else if (meta.target.toLowerCase() === "admin") {
									if (user.role && filterProp === "operator" && meta.filter!["role"] && typeof meta.filter!["role"] === "number") {
										if (meta.filter![filterProp] === "=" && meta.filter!["role"] === user.role) return;
										else if (meta.filter![filterProp] === "<" && meta.filter!["role"] < user.role) return;
										else if (meta.filter![filterProp] === ">" && meta.filter!["role"] > user.role) return;
										else if (meta.filter![filterProp] === ">=" && meta.filter!["role"] >= user.role) return;
										else if (meta.filter![filterProp] === "<=" && meta.filter!["role"] <= user.role) return;
										else passSocket = false;
									} else passSocket = false;
								} else passSocket = false;
							});
							if (passSocket) socket.emit("notification", notification);
						});
					}
				} else if (UUID4Validator(meta["uuid"]) || meta.uuid === "self") {
					//console.log("meta.uuid", meta.uuid);
					// target a specific user
					if ((ctx.state.user && ctx.state.user.uuid && ctx.state.user.uuid === meta.uuid) || meta.uuid === "self") {
						if (ctx.ioSocket) (ctx.ioSocket as Socket).emit("notification", notification);
					} else if (meta.uuid) {
						if (ctx.ioSocket) (ctx.ioSocket as Socket).to(meta.uuid).emit("notification", notification);
					}
				}
			}

			// Send email notice if set, but ensuring this is done when mail server is configure which is often the case config.ignoreMailServer is false
			if (ctx && sendMail && !config.ignoreMailServer) {
				if (!UUID4Validator(meta["uuid"]))
					logger.warn(
						"sending large amount of output emails is not yet implement, hence where a valid uuid is not provided email sending is ignored",
						statusCodes.SERVICE_UNAVAILABLE,
					);
				else {
					if (sequelize.models[meta.target]) {
						const getUserEmail = await sequelize.models[meta.target].findByPk(meta.uuid);
						if (getUserEmail instanceof sequelize.models[meta.target]) {
							const email = getUserEmail.dataValues["email"];
							if (email && validator.isEmail(email))
								mailSender({
									receiver: email,
									subject: "You have a new notification",
									content: notificationTemplate({
										header: ctx.state.user && ctx.state.user.firstName ? `Hello ${ctx.state.user.firstName},` : "Hello,",
										body: detail,
									}),
								});
							else logger.error("Unable to confirm a valid email address to send email notification. Email ignored");
						} else logger.error("No model data returned. Email ignored");
					} else logger.error("Target model could not be confirmed as valid");
				}
			}
			return;
		} else logger.info("There was an issue confirming the creation of notification log!");
	} catch (err) {
		logger.error("Error generating notification to an action", err);
		return;
	}
};

export { notificationLogger };
