import { Model, Op } from "sequelize";
import { JsonObject, requestParser, Router, statusCodes } from "@medlink/common";

const router = Router("search");

// parse request body and check attributes against user roles where necessary
router.use(requestParser({ multipart: true }), async (ctx, next) => {
	const search = (ctx.request.body && (ctx.request.body as JsonObject).search) || ctx.query["search"];
	if (!search || (search as string).length < 3) {
		ctx.status = statusCodes.BAD_REQUEST;
		ctx.message = !search ? "No search keyword in request body/query." : "Search keyword must be at least 3 characters.";
		return;
	}
	let searchableModels: { [Model: string]: string[] }[] = [
		{ Client: ["firstName", "lastName", "phoneNumber", "email"] },
		{ Admin: ["firstName", "lastName", "phoneNumber", "email"] },
		{ DeliveryPartner: ["firstName", "lastName", "phoneNumber", "email"] },
		{ Collection: ["orderPickupType", "status"] },
		{ DeliveryPartnerInventory: ["label"] },
		{ PackageShipment: ["trackingId"] },
		{ Payment: ["transactionId"] },
	];
	if (ctx.state.user.role > 1)
		searchableModels = searchableModels.concat([{ Ticket: ["title", "trackingId", "detail"] }, { Page: ["title", "body"] }]);

	ctx.state.searchableModels = searchableModels;
	ctx.state.searchKeyword = search;
	await next();
});

/**
 * @openapi
 * /auth/admin/search:
 *   post:
 *     tags:
 *       - Platform search, logs & reports (Admin)
 *     summary: Run search across platorm data
 *     description: "Provide a search phrase to search across multiple data types. Note: Some detail might be filtered out of a result depending on the privilege of the signed-in user. Ensure to sync model types here with '/v1/s/config/search-properties/'"
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword can be provided either in Query or request body
 *     requestBody:
 *       description: Request body can be available as json formated or FormData
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               search:
 *                 type: string
 *                 description: Search keyword can be provided either in Query or request body
 *     responses:
 *       200:
 *         description: Returns search results
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *               example:
 *                 status: 200
 *                 data:
 *                   - client: Model Object
 *       400:
 *         description: Inproper request related errors. Media type => text/plain
 *       401:
 *         description: Unauthorised to access user management-related operations. Media type => text/plain
 *       409:
 *         description: Account already registered. Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */

router.post("/", async (ctx) => {
	const searchableModels: { [Model: string]: string[] }[] = ctx.state.searchableModels;

	const searchOutput = await ctx.sequelizeInstance!.transaction(async (t) => {
		const output: { [key: string]: Model[] } = {};
		for (const searchModel of searchableModels) {
			const model = Object.keys(searchModel)[0];

			const whereFilter: { [key: string]: { [key: symbol]: string } } = {};
			searchModel[model].forEach((filter) => {
				whereFilter[filter] = { [Op.iLike]: `%${ctx.state.searchKeyword}%` };
			});
			const thisModelResult = await ctx.sequelizeInstance!.models[model].findAll({
				where:
					Object.keys(whereFilter).length > 1
						? { [Op.or]: Object.keys(whereFilter).map((filter) => ({ [filter]: whereFilter[filter] })) }
						: whereFilter,
				transaction: t,
			});
			// if result exists, retrieve model defined type as the output key lable
			//console.log("thisModelResult", thisModelResult);
			if (thisModelResult.length) output[thisModelResult[0].toJSON()["type"]] = thisModelResult;
		}
		return output;
	});

	ctx.status = statusCodes.OK;
	return (ctx.body = { status: statusCodes.OK, data: searchOutput });
});

export { router as platformWideSearchRoutes };
