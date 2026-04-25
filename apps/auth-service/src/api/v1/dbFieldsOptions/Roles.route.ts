import { Router, statusCodes } from "@medlink/common";
import { AdminRole } from "../../../models/accounts/index.js";

const router = Router({
	prefix: "/roles",
});

/**
 * Let's list all available user roles, requiring authenticated access
 * openapi
 * /field/auth/roles:
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
			const roles = await AdminRole(ctx.sequelizeInstance!).findAll();
			if (roles) {
				ctx.status = statusCodes.OK;
				ctx.body = {
					status: statusCodes.OK,
					options: roles,
				};
				return;
			}
			ctx.status = statusCodes.OK;
			ctx.body = {
				status: statusCodes.OK,
				options: {},
			};
			return;
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (err) {
			ctx.status = statusCodes.SERVER_ERROR;
			ctx.message = "Server error";
			return;
		}
	} else {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "Oops! Unauthorised access";
	}
});

export default router;
