import { logger } from "../utils/logger.js";
import { NOT_ACCEPTABLE, OK } from "../constants/statusCodes.js";
import { Model, ModelStatic, Sequelize } from "sequelize";

const dbCaller = async ({
	sequelize,
	model,
	querier,
	include,
	where,
	limit,
	offset,
	order,
	group,
	paranoid,
	force,
	scope,
}: {
	sequelize: Sequelize;
	model: any;
	querier?: string;
	include: any;
	where: any;
	limit?: number;
	offset?: number;
	order: any;
	group: any;
	paranoid?: boolean;
	force?: boolean;
	scope?: string;
}) => {
	if (model) {
		try {
			const data = await sequelize.transaction(async (t) => {
				const caller = querier ? querier : "findAll";
				const query: { [props: string]: any } = {
					paranoid: typeof paranoid === "boolean" && paranoid === false ? false : true,
				};
				if (where) query.where = where;
				if (include) query.include = include;
				if (limit) query.limit = limit;
				if (offset) query.offset = offset;
				if (order) query.order = order;
				if (group) query.group = group;
				if (force && typeof paranoid === "boolean") query.force = true;

				const allTransactions: any[] = [];
				const transactionIds: string[] = [];
				function processCaller(thisModel: ModelStatic<Model<any, any>> | string) {
					//Check if model is import string entityType or a model instanceOf
					let sequelizer = (thisModel === "string" ? sequelize.models[thisModel] : thisModel) as ModelStatic<Model<any, any>>;
					if (scope) sequelizer = sequelizer.scope(scope);
					if (thisModel === "string") transactionIds.push(thisModel.toLowerCase());
					else {
						const modelFromInstance = thisModel.toString().split(" ")[1];
						transactionIds.push(modelFromInstance.toLowerCase());
					}
					// querier === "findAll" //completed
					if (caller === "findAll") {
						const thisMainTransactionCall = sequelizer.findAll({
							...query,
							transaction: t,
						});

						allTransactions.push(thisMainTransactionCall);
					} else if (caller === "findOne") {
						allTransactions.push(
							sequelizer.findOne({
								...query,
								transaction: t,
							}),
						);
					} else if (caller === "restore") {
						allTransactions.push(
							sequelizer.restore({
								...query,
								transaction: t,
							}),
						);
					} else if (caller === "destroy") {
						allTransactions.push(
							sequelizer.destroy({
								...query,
								transaction: t,
							}),
						);
					} else {
						allTransactions.push(
							sequelizer.findByPk(query.where, {
								transaction: t,
							}),
						);
					}
				}
				//console.log("transactions:", t);
				// check if model is a group of Array.
				if (Array.isArray(model)) {
					model.forEach((thisModel) => {
						processCaller(thisModel);
					});
				} else {
					processCaller(model);
				}

				return await Promise.all(allTransactions).then((returnedData) => {
					const outputData: { [key: string]: any } = {};
					for (let i = 0; i < returnedData.length; i++) {
						outputData[transactionIds[i]] = returnedData[i];
					}
					return outputData;
				});
			});
			return { data: data, status: OK };
		} catch (err) {
			logger.error("dbCaller function: ", err);
			return {
				status: NOT_ACCEPTABLE,
				statusText: "Unable to process input data",
			};
		}
	} else {
		return { status: NOT_ACCEPTABLE, statusText: "Model not defined" };
	}
};
export { dbCaller };
