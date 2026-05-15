import { Router, statusCodes, Patient, dbQuerier, logger } from "@medlink/common";
import { Visit } from "../../models/Visit.model.js";
import { Includeable } from "sequelize";

const router = Router("history");

/**
 * @openapi
 * /patients/history:
 *   get:
 *     tags:
 *       - Current signed-in patient history
 *     summary: "Fetch the visit history of current signed-in patient user"
 *     description: ""
 *     security:
 *       - Token: []
 *     responses:
 *       200:
 *         description: Returns patient user data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 account:
 *                   description: ""
 *                   type: array
 *                   items:
 *                     - $ref: "#/components/schemas/Visit"
 *               example:
 *                 status: 200
 *                 account:
 *                   - uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                     comment: "Patient visit with sore throat complaint, having been attended to the previous week for same complaint"
 *                     commentBy: Emma Thomas
 *                     'type': 'visit'
 *                     created: 2024-12-05T19:00:00.151Z
 *                     updated: 2024-12-05T19:00:00.151Z
 *       401:
 *         description: Unauthorised response
 *       5xx:
 *         description: "Oops! A server error occcurred. Media type => text/plain"
 */

router.get(
	"/",
	async (ctx, next) => {
		if (ctx.path === ctx.url) {
			ctx.url = ctx.url + "?sort=[created=ASC]&limit=10";
		}
		await next();
	},
	dbQuerier({ ignoreStateFiltration: true, useOlderImplementation: false }),
	async (ctx) => {
		// managed include props
		const signedUser:Includeable = {
			model: Patient(ctx.sequelizeInstance!),
			required: true,
			where: { uuid: ctx.state.user.uuid },
		};
		if (ctx.state.dbQuerier["include"]) {
			if (Array.isArray(ctx.state.dbQuerier["include"])) ctx.state.dbQuerier["include"].concat([signedUser]);
			else if (typeof ctx.state.dbQuerier["include"] === "object")
				ctx.state.dbQuerier["include"] = [ctx.state.dbQuerier["include"], signedUser];
		} else
			ctx.state.dbQuerier = {
				...ctx.state.dbQuerier,
				include: [signedUser],
			};

		// fetch visit history
		try {
			const visits = await Visit(ctx.sequelizeInstance!).findAll(ctx.state.dbQuerier);
			if (visits && visits[0] instanceof Patient(ctx.sequelizeInstance!)) {
				ctx.status = statusCodes.OK;
				ctx.body = {
					status: statusCodes.OK,
					data: visits,
				};
				return;
			} else if (visits && visits.length === 0) {
				ctx.status = statusCodes.NOT_FOUND;
				ctx.message = "No record found";
				return;
			}
			ctx.status = statusCodes.BAD_REQUEST;
			return;
		} catch (err) {
			logger.error("History retrieval error:", err);

			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = (err as object)["message" as keyof typeof err]
				? (err as object)["message" as keyof typeof err]
				: "Server error occurred";
			return;
		}
	},
);

export { router as patientHistory };
