import { Includeable, Model } from "sequelize";
import * as operator from "../constants/urlQueryOperatorsOrmTranslator.js";
import { ParameterizedContext, Next } from "koa";
import { statusCodes } from "../constants/index.js";
import { logger } from "../utils/logger.js";
import { BAD_REQUEST } from "../constants/statusCodes.js";
import { throwError } from "../functions/throwError.js";

const operatorSymbol: { [key: string]: symbol } = operator;

type QUERY = {
	useOlderImplementation?: boolean; // deprecate option in greybox >= v1.5
	ignoreStateFiltration?: boolean; //queries are forced to filter 'where' with "state = true", to protect unpublished entities. Explicit set this to false if not needed or if state field does not exist on db table being fetched/filtered
	limit?: number | false;
	//offset,
	sort?: "DESC" | "ASC" | true;
	//group,
	//available for backward compatibility with early implementation in v.4. Remove in v.6 upwards
	setDefaultSort?: boolean; // set to FALSE to disable default sorting by "updated": ["updated", "DESC"]
};

/**
 * @description Converts url queries into Database (sequelize) compatible properties. NOte: set "useOlderImplementation" to false in queryAddOn in greybox version < 1.5.0 else older version is prioritised.
 * {
 * 	 paranoid => true | paranoid => false
 * 	 model => User | models => User,Admin
 *   limit => 25 | delibrately ignoring arrays
 *   offset => 25 | delibrately ignoring arrays
 *   sort => created | sort => [created=ASC] |  order => created | order => [created=ASC]
 *   include => Admin |include => Admin,Order | include => Admin[Author]
 *   filter => [firstName=akin] | filter => [firstName[START_WITH]=akin,"tunde"] | filter => [$Admin.created[BETWEEN]='2025-01-01','2025-03-01']
 *
 * }
 * @param {?QUERY} [queryAddOn]
 * @exports object [ctx.state.dbQuerier = {
 *  include = Admin | Admin[Author] | {model: Admin} | {model: Admin, as: Author} | [{model: Admin, as: Author}]
 * }
 * @argument include = Admin | Admin[Author]
 * @argument limit = number
 * @argument offset = number
 * @returns {((ctx: ParameterizedContext, next: Next) => any)}
 */
export const dbQuerier =
	(queryAddOn?: QUERY): ((ctx: ParameterizedContext, next: Next) => unknown) =>
	async (ctx: ParameterizedContext, next: Next) => {
		/* 
			dbQuerier is now implemented to use ctx.query destructuring out of the box
			- Additionally, ctx.sequelizeInstance is a strict requirement for dbQuerier to be useful
		*/
		if (!ctx.sequelizeInstance) {
			logger.error("dbQuerier function halted because ctx.sequelizeInstance is undefined!");
			return throwError(503, "Server error due to undefined db reference");
		}
		ctx.state.dbQuerier = {};
		//  define pagination
		let paginationLimit: number | undefined = queryAddOn
			? queryAddOn.limit
				? queryAddOn.limit
				: queryAddOn.limit !== false && queryAddOn.limit !== 0
					? 10
					: 0
			: 10;
		//set a default when not available in query.
		let paginationOffset;
		const sortingOrder: (string | string[] /* | Fn[] */)[] = [];
		let includedModels: Model | { model: Model; as?: string } | { model: Model; as?: string }[];
		let whereFilter: {
			[key: string | symbol]: string | object | symbol | boolean;
		} = {};

		// console.log("isQuery", isQuery);
		// console.log("ctx.querystring", ctx.querystring);
		// console.log("ctx.querystring decode", decodeURIComponent(ctx.querystring));
		// console.log("ctx.query", ctx.query);
		// check to decode ctx.url if it turns out encoded
		//ctx.url = decodeURI(ctx.url);
		try {
			// using ctx.query default destructuring
			const queries = ctx.query;

			if ("paranoid" in queries && ctx.isAuthenticated()) {
				// paranoid => true | paranoid => false
				//inject paranoid property but ensure its only available for authenticated users to control security
				const paranoid = queries["paranoid"];
				if (paranoid === "true" || paranoid === "false") ctx.state.dbQuerier["paranoid"] = paranoid === "true" ? true : false;
			}
			if ("model" in queries || "models" in queries) {
				// model => User | models => User,Admin
				/* 
					models can optionally be included in query
					Can be as a single model or array of models separated with comma
				*/
				const modelsContainer: string[] = [];
				const processModels = (models: string | string[] | undefined) => {
					if (typeof models === "string") {
						if (!models.includes(",")) {
							if (!modelsContainer.includes(models)) modelsContainer.push(models);
						} else
							models.split(",").forEach((model) => {
								if (!modelsContainer.includes(model)) modelsContainer.push(model);
							});
					} else if (models) {
						models.forEach((model) => {
							if (typeof model === "string") {
								if (!model.includes(",")) {
									if (!modelsContainer.includes(model)) modelsContainer.push(model);
								} else
									model.split(",").forEach((mod) => {
										if (!modelsContainer.includes(mod)) modelsContainer.push(mod);
									});
							}
						});
					}
				};

				if ("model" in queries) {
					processModels(queries["model"]);
				}
				if ("models" in queries) {
					processModels(queries["models"]);
				}
				if (modelsContainer.length) ctx.state.dbQuerier["models"] = modelsContainer;
			}
			if ("limit" in queries) {
				// limit => 25 | delibrately ignoring arrays
				const limit =
					typeof queries["limit"] === "string" && queries["limit"].toLowerCase() === "all"
						? "all"
						: !Array.isArray(queries["limit"])
							? Number(queries["limit"])
							: Number(queries["limit"][0]);
				if (typeof limit === "number") paginationLimit = limit;
				// turn off paginationLimit when 'all' is set acquire all records
				else if (limit === "all") paginationLimit = undefined;
			}
			if ("offset" in queries) {
				// offset => 25 | delibrately ignoring arrays
				const offset = !Array.isArray(queries["offset"]) ? Number(queries["offset"]) : Number(queries["offset"][0]);
				if (typeof offset === "number") paginationOffset = offset;
			}
			// sorts can be provided as sort or order in new implementation
			if ("sort" in queries || "order" in queries) {
				// sort => created | sort => [created=ASC] |  order => created | order => [created=ASC]
				const sortts = queries["sort"] || queries["order"];
				const sortIsArray = Array.isArray(sortts) ? true : false;

				const breakUpStructure = (props: string) => {
					let sortSuffix: boolean | string = props.includes("=") ? true : false;
					let sortID: string = sortSuffix ? props.split("=")[0] : props;
					if (sortSuffix) {
						sortID = sortID.split("[")[1];
						sortSuffix = props.split("=")[1].split("]")[0];
					}

					if (sortSuffix && (sortSuffix as string).toUpperCase() === "RANDOM")
						//ignore sortID when sortSuffix is RANDOM
						sortingOrder.push([ctx.sequelizeInstance.random() as unknown as string]);
					else {
						const sortProps = []; // to ingest into sortingOrder as array of itself
						if (sortID) sortProps.push(sortID);
						if (sortSuffix) sortProps.push((sortSuffix as string).toUpperCase());
						sortingOrder.push(sortProps); // push to main order collection
					}
				};
				if (!sortIsArray) breakUpStructure(sortts as string);
				else
					(sortts as string[]).forEach((query) => {
						breakUpStructure(query);
					});
			}
			/* process includes' and optionally import models that may have been processd earlier if they exists 
				ctx.state.dbQuerier["models"] is exported as string[]
				*/
			if ("include" in queries || ctx.state.dbQuerier["models"]) {
				// include => Admin |include => Admin,Order | include => Admin[Author] | include => Admin[=Author] | include => Admin.Security | include => Admin.Security[Settings] | include => Admin.Security[=Settings] | include => Admin[Support].Security[Settings] | include => Admin[Support].Security[Settings]
				/* 
							New introduction as boxModelMapper is now deprecated in usage
							** Allow association keywords to exists as Admin[Author] when a model is associated with another multiple times 
							Like for instance: User can be associated with Mail multiple times as Sender & Reciever.
							Use of model auto-capitalisation is also now deprecated for consistence reasons, models and/or associated keyword is left as is and should compulsorily be capitalised in request if needed
				*/
				let thisInclude = "include" in queries ? queries["include"] : [];
				if (ctx.state.dbQuerier["models"]) {
					thisInclude = thisInclude
						? Array.isArray(thisInclude)
							? thisInclude.concat(ctx.state.dbQuerier["models"])
							: [...ctx.state.dbQuerier["models"], thisInclude]
						: undefined;
					// trash 'models' key which is really not valid on sequelize
					delete ctx.state.dbQuerier["models"];
				}

				if (thisInclude) {
					const processInclude = (include: string) => {
						let reserveInclude = include;
						let nestedKeyword = "";
						let childAssociations: string[] | undefined = undefined;

						// lets check if child associations
						if (reserveInclude.includes(".")) {
							const spreadInclude = reserveInclude.split(".");
							reserveInclude = spreadInclude[0];
							// remove the index value
							spreadInclude.shift();
							childAssociations = spreadInclude;
						}

						if (reserveInclude.includes("[")) {
							const splitInclude = reserveInclude.split("[");
							reserveInclude = splitInclude[0];
							nestedKeyword = splitInclude[1].split("]")[0];
							// include can be => Admin[=Author]
							if (nestedKeyword.includes("=")) nestedKeyword = nestedKeyword.split("=")[1];
						}
						//console.log("ctx.sequelizeInstance.models", ctx.sequelizeInstance.models);
						// lets convert modelstring to model Class Sequelize constructor
						const thisModel = ctx.sequelizeInstance.models[reserveInclude] ? ctx.sequelizeInstance.models[reserveInclude] : reserveInclude;

						// include can have nested child into greater depth internally. We handle that here after initial thisModel must have been defined
						const childProcessor = (
							children: string[],
							thisModelObject:
								| Model
								| {
										model: Model;
										as?: string;
										include?: Includeable;
								  },
						) => {
							children.forEach((child, index) => {
								let nestedChildKeyword = "";
								if (child.includes("[")) {
									const splitChild = child.split("[");
									child = splitChild[0];
									nestedChildKeyword = splitChild[1].split("]")[0];
									// child include can also be => Admin[=Author]
									if (nestedChildKeyword.includes("=")) nestedChildKeyword = nestedChildKeyword.split("=")[1];
								}

								// lets convert child modelstring to model Class equivalent
								const thisChildModel = ctx.sequelizeInstance.models[child] ? ctx.sequelizeInstance.models[child] : child;

								// console.log("typeof thisModelObject", typeof thisModelObject, child, "|", thisModelObject);
								// console.log("index", index);

								// if Model class of type function
								if (typeof thisModelObject === "function" || typeof thisModelObject === "string")
									thisModelObject = {
										model: thisModelObject,
										include: (nestedChildKeyword
											? { model: thisChildModel, as: nestedChildKeyword }
											: { model: thisChildModel }) as Includeable,
									};
								else if (typeof thisModelObject === "object") {
									let depthIteration: {
										model: Model;
										as?: string;
										include?: Includeable;
									} = thisModelObject as {
										model: Model;
										as?: string;
										include?: Includeable;
									};
									// drill object to innermost include to define depth if 'include' key already exists
									for (let j = 0; j < index; j++) {
										depthIteration = depthIteration["include"] as unknown as {
											model: Model;
											as?: string;
											include?: Includeable;
										};
									}
									(
										depthIteration as {
											model: Model;
											as?: string;
											include?: Includeable;
										}
									)["include"] = (
										nestedChildKeyword ? { model: thisChildModel, as: nestedChildKeyword } : { model: thisChildModel }
									) as Includeable;
								}
							});
							return thisModelObject;
						};

						//console.log("childAssociations", childAssociations);
						// process export
						if (thisModel) {
							if (!includedModels) {
								const thisModelObject = !nestedKeyword
									? (thisModel as unknown as Model) // save directly as Class
									: ({ model: thisModel, as: nestedKeyword } as unknown as { model: Model; as?: string });

								//console.log("thisModelObject 11", thisModelObject);
								if (childAssociations && childAssociations.length) {
									includedModels = childProcessor(childAssociations, thisModelObject);
								} else includedModels = thisModelObject;

								//console.log("includedModels 22", includedModels);
							} else {
								let thisModelObject: { model: Model; as?: string } = {
									model: thisModel as unknown as Model,
								};
								if (nestedKeyword) thisModelObject["as"] = nestedKeyword;
								// call child iteration if present
								if (childAssociations && childAssociations.length) {
									thisModelObject = childProcessor(childAssociations, thisModelObject) as { model: Model; as?: string };
								}
								// Export fnial processed Model Object

								// if Model class of type function
								if (typeof includedModels === "function" || typeof includedModels === "string")
									includedModels = [{ model: includedModels }, thisModelObject];
								else if (Array.isArray(includedModels)) includedModels.push(thisModelObject);
								// Array.isArray preceeds object since array would be treats as objects too
								else if (typeof includedModels === "object")
									includedModels = [includedModels as unknown as { model: Model; as?: string }, thisModelObject];
							}
						}
					};
					// Allow to carter for multiple included in a single include query
					const allIncluded =
						typeof thisInclude === "string" ? (thisInclude.includes(",") ? thisInclude.split(",") : [thisInclude]) : thisInclude;

					allIncluded.forEach((include) => {
						const verifiedInclude = include.trim(); // ignore empty spaces which may arise by mistake
						if (verifiedInclude) {
							// let's still ensure each include isn't comma separated
							if (verifiedInclude.includes(",")) verifiedInclude.split(",").forEach((inInclude) => processInclude(inInclude.trim()));
							else processInclude(verifiedInclude);
						}
					});
				}
			}
			if ("filter" in queries) {
				// filter => firstName | filter => [firstName=akin] | filter => [firstName[START_WITH]=akin,"tunde"] | filter => [$Admin.created[BETWEEN]='2025-01-01','2025-03-01']
				const filterQuery = queries["filter"];
				//console.log("filterQuery", filterQuery);
				if (filterQuery) {
					// Allow to carter for multiple included in a single include query
					const filters = typeof filterQuery === "string" ? [filterQuery] : filterQuery;

					// import each filter here for processing
					const processFilter = (filter: string) => {
						//console.log("filter", filter);
						const filterSplit = filter.split("=");
						let filterCondition = "EQUAL_TO";
						const filterHolderArray = filterSplit[0].includes("[") ? filterSplit[0].split("[") : filterSplit[0];
						const filterTarget = Array.isArray(filterHolderArray) ? filterHolderArray[1] : filterHolderArray;
						if (Array.isArray(filterHolderArray) && filterHolderArray[2]) {
							filterCondition = filterHolderArray[2].split("]")[0].toUpperCase();
						}
						const filterValue = filterSplit[1] && filterSplit[1].includes("]") ? filterSplit[1].split("]")[0] : undefined;

						// Translate Target, Condition, and Value to ORM equivalent.

						// convert values to array to allow iteration, but check for escaped ',' when deliberate.
						const excludeEscapedComma = filterValue && filterValue.includes("\\,") ? filterValue.split("\\,").join("-----") : filterValue;
						const currentFilterValue = excludeEscapedComma && excludeEscapedComma.split(",");
						let arrayFilterValues: (string | number | boolean | null | undefined)[] | undefined = undefined;
						if (currentFilterValue)
							currentFilterValue.forEach((thisValue) => {
								/* let stripValue: string | boolean | null | undefined = thisValue
						.replace(/["']/g, "")
						.trim(); // strip ", ' & spaces */
								let stripValue: string | boolean | null | undefined = thisValue.trim(); // strip spaces & let " and ' remain to define when a value should stay as string
								//restore escaped ','
								if (stripValue.includes("-----")) stripValue = stripValue.split("-----").join(",");
								//convert reserved verbs to their non-string equivalent
								if (stripValue === "true") stripValue = true;
								else if (stripValue === "null") stripValue = null;
								else if (stripValue === "undefined") stripValue = undefined;

								if (stripValue !== true && stripValue !== null && stripValue !== undefined && !isNaN(stripValue as unknown as number)) {
									//convert stringified number to integer
									if (arrayFilterValues)
										(arrayFilterValues as (string | number | boolean | null | undefined)[]).push((stripValue as unknown as number) * 1);
									else arrayFilterValues = [(stripValue as unknown as number) * 1];
								} else {
									if (typeof stripValue === "string") stripValue = stripValue.replace(/["']/g, ""); // strip " and ' if such still exist while leaving value as string
									if (arrayFilterValues) (arrayFilterValues as (string | number | boolean | null | undefined)[]).push(stripValue);
									else arrayFilterValues = [stripValue];
								}
							});
						// when currentFilterValue is undefined, convert filterCondition to not equal to since no value would be present and filter is equated to not undefined
						else filterCondition = "NOT_EQUAL_TO";

						const thisFilterValue: (string | number | boolean | null | undefined)[] | undefined = arrayFilterValues;

						// isFilterOr checks if ',' is used inbetween values when not used to declare range.
						let isFilterOr = false;
						// conditionalOr checks if '!' is used before an operator, used to force filter as a 'conditional or' operator.
						let operatorOr = false;
						if (filterCondition.substring(0, 1) === "!") {
							filterCondition = filterCondition.substring(1);
							operatorOr = true;
						}

						//searching via filters is often required to be case insensitive.
						//insert the filterVAlue in % allows this use case with CONTAIN & NOT_CONTAIN
						const shouldBeCaseInsensitive = (filter: string, value: string | number | boolean | null | undefined) => {
							// console.log("filter", filter);
							// console.log("value", value);
							if (["CONTAIN", "NOT_CONTAIN", "CONTAINS", "NOT_CONTAINS"].includes(filter)) {
								return `%${value}%`;
							} else if (value && Array.isArray(value)) {
								return (value as unknown as string[]).map((v) =>
									new Date(v) instanceof Date
										? new Date(v)
										: //ctx.sequelizeInstance.fn("DATE", v)
											v,
								);
							}
							return value;
						};
						if (!["BETWEEN", "NOT_BETWEEN", "IN", "NOT_IN", "ANY", "OR"].includes(filterCondition)) {
							isFilterOr = true;
						}

						// FILTER depth iterator
						const filterDepthBuild = (filterTarget: string, innerDepthValue: unknown) => {
							//define up to 6 depths
							const depthArray = filterTarget.split(".");
							let depth = {
								[depthArray[0]]: { [depthArray[1]]: innerDepthValue },
							};
							if (depthArray.length === 3)
								depth = {
									[depthArray[0]]: {
										[depthArray[1]]: { [depthArray[2]]: innerDepthValue },
									},
								};
							else if (depthArray.length === 4)
								depth = {
									[depthArray[0]]: {
										[depthArray[1]]: {
											[depthArray[2]]: { [depthArray[3]]: innerDepthValue },
										},
									},
								};
							else if (depthArray.length === 5)
								depth = {
									[depthArray[0]]: {
										[depthArray[1]]: {
											[depthArray[2]]: {
												[depthArray[3]]: { [depthArray[4]]: innerDepthValue },
											},
										},
									},
								};
							else if (depthArray.length === 6)
								depth = {
									[depthArray[0]]: {
										[depthArray[1]]: {
											[depthArray[2]]: {
												[depthArray[3]]: {
													[depthArray[4]]: {
														[depthArray[5]]: innerDepthValue,
													},
												},
											},
										},
									},
								};
							return depth;
						};

						// filter-iterator check for depth or not
						const filterIterator = ({
							ignoreFilterTarget,
							value,
						}: {
							ignoreFilterTarget?: boolean;
							value: (string | number | boolean | null | undefined) | (string | number | boolean | null | undefined)[];
						}) => {
							if (
								!filterTarget.includes(".") ||
								/* lets also carter for when filterTarget embeds a model name usually with $ prefix=> $<modelName>.<target field>
									EG: $User.created$
								*/
								(filterTarget.includes(".") && filterTarget.startsWith("$"))
							) {
								const symbolOp = operatorSymbol[filterCondition];
								if (!symbolOp) ctx.throw(BAD_REQUEST, new Error("Invalid filter operator in query"));

								if (!ignoreFilterTarget) {
									return {
										[filterTarget.startsWith("$") && !filterTarget.endsWith("$") ? filterTarget + "$" : filterTarget]: {
											[symbolOp]: shouldBeCaseInsensitive(filterCondition, value as string | number | boolean | null | undefined),
										},
									};
								} else {
									return {
										[symbolOp]: shouldBeCaseInsensitive(filterCondition, value as string | number | boolean | null | undefined),
									};
								}
							} else {
								const symbolOp = operatorSymbol[filterCondition];
								if (!symbolOp) ctx.throw(BAD_REQUEST, new Error("Invalid filter operator in query"));

								if (!ignoreFilterTarget) {
									return filterDepthBuild(filterTarget, {
										[symbolOp]: shouldBeCaseInsensitive(filterCondition, value as string | number | boolean | null | undefined),
									});
								} else {
									return filterDepthBuild(filterTarget, {
										[symbolOp]: shouldBeCaseInsensitive(filterCondition, value as string | number | boolean | null | undefined),
									});
								}
							}
						};

						if ((isFilterOr && thisFilterValue && (thisFilterValue as string[]).length > 1) || operatorOr) {
							const key = operatorSymbol["OR"];
							const checkKey = whereFilter[key] as object[];
							// Split values in they are 'OR' arrays. Else import values is range.
							if (isFilterOr && thisFilterValue) {
								(thisFilterValue as string[]).forEach((thisValue) => {
									if (checkKey) {
										checkKey.push(
											filterIterator({
												value: thisValue,
											}),
										);
									} else {
										whereFilter = {
											...whereFilter,
											[key]: [
												filterIterator({
													value: thisValue,
												}),
											],
										};
									}
								});
							} else {
								if (checkKey) {
									checkKey.push(
										filterIterator({
											value: thisFilterValue,
										}),
									);
								} else {
									whereFilter = {
										...whereFilter,
										[key]: [
											filterIterator({
												value: thisFilterValue,
											}),
										],
									};
								}
							}
						} else {
							let checkKey = whereFilter[filterTarget];
							if (filterTarget.includes(".") && typeof whereFilter === "object") {
								const splitFIlterTarget = filterTarget.split(".");
								for (let index = 0; index < splitFIlterTarget.length; index++) {
									if (index === 0) {
										checkKey = whereFilter[splitFIlterTarget[index] as keyof typeof whereFilter];
									} else if (typeof checkKey === "object") {
										checkKey = checkKey[splitFIlterTarget[index] as keyof typeof checkKey];
									} else break;
								}
							}
							if (checkKey) {
								const updatedKey = {
									...(whereFilter[!filterTarget.includes(".") ? filterTarget : filterTarget.split(".")[0]] as object),
									...filterIterator({
										ignoreFilterTarget: true,
										value: !thisFilterValue ? null : isFilterOr ? thisFilterValue[0] : thisFilterValue,
									}),
								};
								whereFilter = {
									...whereFilter,
									[!filterTarget.includes(".") ? filterTarget : filterTarget.split(".")[0]]: updatedKey,
								};
							} else {
								whereFilter = {
									...whereFilter,
									...filterIterator({
										value: !thisFilterValue ? null : isFilterOr ? thisFilterValue[0] : thisFilterValue,
									}),
								};
							}
						}
					};

					filters.forEach((filter) => processFilter(filter));
				}
			}
		} catch (err) {
			logger.error("dbQuerier error ", err);
			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = (err as object)["message" as keyof typeof err]
				? (err as object)["message" as keyof typeof err]
				: "routing query error occurred";
			return;
		}
		//Allows to insert a default sorting order when it likely not to exist on query
		//can be optionally disabled by setting "setDefaultSort" to FALSE
		if (queryAddOn && (queryAddOn.setDefaultSort || queryAddOn.sort === true)) sortingOrder.push(["updated", "DESC"]);

		if (paginationLimit) ctx.state.dbQuerier["limit"] = paginationLimit;
		if (paginationOffset) ctx.state.dbQuerier["offset"] = paginationOffset;
		if (sortingOrder.length) ctx.state.dbQuerier["order"] = sortingOrder;
		if (includedModels!) ctx.state.dbQuerier["include"] = includedModels;

		//Enforce state filter if not explicitly set in ctx.url or ignoreStateFiltration
		if ((!queryAddOn || (queryAddOn && !queryAddOn.ignoreStateFiltration)) && "state" in whereFilter !== true) whereFilter["state"] = true;
		if (Object.keys(whereFilter).length) ctx.state.dbQuerier["where"] = whereFilter;

		await next();
	};
