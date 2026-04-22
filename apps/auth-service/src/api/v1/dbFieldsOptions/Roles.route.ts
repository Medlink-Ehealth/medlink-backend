import { OK, SERVER_ERROR, UNAUTHORIZED } from "../../../constants/statusCodes.js";
import { Router } from "../../../middlewares/router.js";
import { Role } from "../../../models/fields/UserRole.model.js";

const router = Router({
	prefix: "/roles",
});

/**
 * Let's list all available user roles, requiring authenticated access
 * openapi
 * /v3/field/auth/roles:
 *   get:
 *     tags:
 *       - Core Basics
 *     summary: Returns a list of user roles
 *     description: Get all available types of user roles
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *     responses:
 *       200:
 *         description: Returns an array of user roles properties
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   level:
 *                     type: integer
 *                   label:
 *                     type: string
 *               example: [{level: 0, label: Inactive},{level: 3, label: Admin}]
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       5xx:
 *         description: Unexpected server error occured
 */
router.get("/", async (ctx) => {
	if (ctx.state.user.role && Number(ctx.state.user.role) > 3) {
		try {
			const roles = await Role(ctx.sequelizeInstance!).findAll();
			if (roles) {
				ctx.status = OK;
				ctx.body = {
					status: OK,
					options: roles,
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
	} else {
		ctx.status = UNAUTHORIZED;
		ctx.message = "Oops! Unauthorised access";
	}
});

export default router;
