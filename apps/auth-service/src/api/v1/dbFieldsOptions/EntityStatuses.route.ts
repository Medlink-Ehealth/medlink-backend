import { OK, SERVER_ERROR } from "../../../constants/statusCodes.js";
import { Router } from "../../../middlewares/router.js";
import { Status } from "../../../models/fields/EntityStatus.model.js";

const router = Router({
	prefix: "/statuses",
});

/**
 * Let's list all available article status where in use, requiring authenticated access
 * openapi
 * /v3/field/auth/statuses:
 *   get:
 *     summary: List of content status options
 *     description: Get all available types of articles status options
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *     responses:
 *       200:
 *         description: Returns an array of statuses
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         description: Server error occured
 */
router.get("/", async (ctx) => {
	try {
		const statuses = await Status(ctx.sequelizeInstance!).findAll();
		if (statuses) {
			ctx.status = OK;
			ctx.body = {
				status: OK,
				options: statuses,
			};
			return;
		}
		ctx.status = OK;
		ctx.body = {
			status: OK,
			options: {},
		};
		return;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
	} catch (err) {
		ctx.status = SERVER_ERROR;
		ctx.message = "Server error";
		return;
	}
});

export default router;
