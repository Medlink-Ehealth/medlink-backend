import { Sequelize } from "sequelize";
import { BAD_REQUEST, NOT_ACCEPTABLE, SERVER_ERROR } from "../../constants/statusCodes.js";
import { throwError } from "../../functions/throwError.js";
import { logger } from "../../utils/logger.js";
import { ParameterizedContext, Next, DefaultContext } from "koa";

type JsonValue = JsonObject;
type JsonObject = {
	[key: string]: JsonValue;
};
interface extendedParameterizedContext extends ParameterizedContext {
	request: DefaultContext["request"] & {
		body?: JsonValue;
		files?: [string, File]; // [formidable.Fields<string>, formidable.Files<string>]
		rawBody?: unknown;
	};
	sequelizeInstance: Sequelize;
}

//Handles 'title', 'name' and 'label' use cases.
//Otherwise set ctx.state.aliasInjector in preceeding middlewares.
//Note: ctx.state.aliasInjector is prioritised when available!
const aliasInjector = async (ctx: extendedParameterizedContext, next?: Next) => {
	//console.log("ctx.request.body", ctx.request.body);
	//only process alias when necessary
	if (
		ctx.request.body &&
		(ctx.state.aliasInjector ||
			!ctx.request.body.alias ||
			!ctx.request.body.currentAlias ||
			ctx.request.body.alias !== ctx.request.body.currentAlias ||
			ctx.request.body.autoAlias === "true" || //<.v4 legacy support
			ctx.request.body.autoAlias === "t" || //<.v4 legacy support
			ctx.request.body.autoAlias === true)
	)
		try {
			if (Object.keys(ctx.request.body).length) {
				let entityModel = undefined;
				const entityType = ctx.state.entityType ? ctx.state.entityType : ctx.state.nodeType ? ctx.state.nodeType : null;
				if (entityType && ctx.sequelizeInstance.models[entityType]) entityModel = ctx.sequelizeInstance.models[entityType];

				if (!entityModel && (ctx.method.toLowerCase() === "post" || ctx.method.toLowerCase() === "patch")) {
					const fromPath = ctx.path.split("/");
					let modelExtractFromPath = fromPath[fromPath.length - 1];
					if (!modelExtractFromPath.trim())
						// ensure it's not empty string
						modelExtractFromPath = fromPath[fromPath.length - 2];

					if (!entityModel) {
						//Check Model directly
						//Capitalise it the model way
						modelExtractFromPath = modelExtractFromPath.substring(0, 1).toUpperCase() + modelExtractFromPath.substring(1).toLowerCase();
						if (ctx.sequelizeInstance.models[modelExtractFromPath]) entityModel = ctx.sequelizeInstance.models[modelExtractFromPath];
					}
				}

				if (entityModel) {
					//Optionally set alias ID identifier for when ctx.request.body.title may not be available in request body
					//import alias ID here
					const aliasID = ctx.state.aliasInjector;
					let thisAlias =
						aliasID ||
						(ctx.request.body.autoAlias &&
							(ctx.request.body.autoAlias === "true" || //<.v4 legacy support
								ctx.request.body.autoAlias === "t" || //<.v4 legacy support
								ctx.request.body.autoAlias === true))
							? aliasID
								? aliasID
								: ctx.request.body.title
									? ctx.request.body.title
									: ctx.request.body.name
										? ctx.request.body.name
										: ctx.request.body.label
											? ctx.request.body.label
											: Math.random().toString(36).substring(5)
							: ctx.request.body.alias
								? ctx.request.body.alias
								: Math.random().toString(36).substring(5);
					// where a full URL address may have been used, strip to the last URL 'part'
					//console.log("thisAlias: ", thisAlias);
					if (thisAlias.includes("/")) {
						const splittedAlias = thisAlias.split("/");
						thisAlias = splittedAlias[splittedAlias.length - 1];
						if (!thisAlias.trim())
							//were last value may be empty string
							thisAlias = splittedAlias[splittedAlias.length - 2];
					}
					//strip special characters if new alias entry, leaving spaces to be replace by '-'
					thisAlias = thisAlias.replace(/[^a-z0-9 -]/gi, "");
					//remove conjunction words && multiple '-'
					if (thisAlias.includes(" and ")) thisAlias = thisAlias.split(" and ").join("-");
					if (thisAlias.includes(" of ")) thisAlias = thisAlias.split(" of ").join("-");
					if (thisAlias.includes(" or ")) thisAlias = thisAlias.split(" or ").join("-");
					if (thisAlias.includes(" on ")) thisAlias = thisAlias.split(" on ").join("-");
					//strip spaces from alias
					if (thisAlias.includes(" ")) thisAlias = thisAlias.split(" ").join("-");
					if (thisAlias.includes("---")) thisAlias = thisAlias.split("---").join("-");
					if (thisAlias.includes("--")) thisAlias = thisAlias.split("--").join("-");
					if (thisAlias.includes("--")) thisAlias = thisAlias.split("--").join("-"); //a repeated '--' allows to strip new entry which may have resulted from previous operations. Effect new approach to solving this in v3
					//convert to lower case
					thisAlias = thisAlias.toLowerCase();
					//Trim to max length of 80 characters
					if (thisAlias.length > 80) thisAlias = thisAlias.substring(0, 80);

					let thisEntityUuid;
					if (ctx.state.entity && ctx.state.entity.dataValues.uuid) {
						thisEntityUuid = ctx.state.entity.dataValues.uuid;
					} else if (ctx.request.body.uuid) {
						thisEntityUuid = ctx.request.body.uuid;
					} else if (ctx.request.body.currentAlias) {
						try {
							await entityModel
								.findOne({
									where: {
										alias: ctx.request.body.currentAlias,
									},
									paranoid: false,
								})
								.then((res) => {
									//console.log("checking entity uuid", res);
									if (res && res.toJSON().uuid) thisEntityUuid = res.toJSON().uuid;
								});
						} catch (err) {
							logger.error("alias injector error: ", err);
							throwError(BAD_REQUEST, "Entity type not identifiable");
						}
					}

					try {
						const checkIfAnotherExistingEntity = await entityModel.findOne({
							where: { alias: thisAlias },
							paranoid: false,
						});

						//console.log("checkIfAnotherExistingEntity", checkIfAnotherExistingEntity);
						if (
							(checkIfAnotherExistingEntity &&
								thisEntityUuid &&
								checkIfAnotherExistingEntity.dataValues.uuid &&
								checkIfAnotherExistingEntity.dataValues.uuid !== thisEntityUuid) ||
							(!thisEntityUuid && checkIfAnotherExistingEntity)
						) {
							thisAlias = thisAlias + Math.random().toString(36).substring(5);
						}
					} catch (err) {
						logger.error("alias injector error: ", err);
						throwError(BAD_REQUEST, "Entity type not identifiable");
					}

					if (
						(ctx.state.entityUpdate || (ctx.path && (ctx.path.includes("/update/") || ctx.path.endsWith("/update")))) &&
						!ctx.request.body.currentAlias &&
						ctx.request.body.alias
					) {
						ctx.request.body.currentAlias = ctx.request.body.alias;
					} else if (
						!ctx.state.entityUpdate &&
						(!ctx.path || (ctx.path && !ctx.path.includes("/update/") && !ctx.path.endsWith("/update"))) &&
						ctx.request.body.currentAlias
					) {
						delete ctx.request.body.currentAlias;
					}
					ctx.request.body = {
						...ctx.request.body,
						alias: thisAlias,
						autoAlias:
							typeof ctx.request.body.autoAlias === "string" &&
							(ctx.request.body.autoAlias === "true" || ctx.request.body.autoAlias === "t") // allows to check for unprocessed request.body where all data are stringified from FormData; which is the earlier approach in versions prior to v.4
								? true
								: typeof ctx.request.body.autoAlias === "boolean"
									? ctx.request.body.autoAlias
									: false,
					};
				} else {
					throwError(NOT_ACCEPTABLE, "Entity type not defined");
				}
			}
		} catch (err) {
			logger.error("alias injector error: ", err);
			ctx.status = SERVER_ERROR;
			ctx.message = "An App error occurred; and currently unable to fix it.";
			return;
		}
	//return when not used as middleware
	if (!next) return ctx.request.body;
	await next();
};
export { aliasInjector };
