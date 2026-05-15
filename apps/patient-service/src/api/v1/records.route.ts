import { Includeable } from "sequelize";
import { dbQuerier, Patient, Router, statusCodes, UUID4Validator } from "@medlink/common";
import { Visit } from "../../models/Visit.model.js";
import { PatientDocument } from "../../models/Document.model.js";

const router = Router();

/**
 * Get a patient record accross multiple schema types like profile, document, and history - but restricted to admin users only
 * @openapi
 * /patients/{patientId}:
 *   get:
 *     tags:
 *       - Admin Access
 *     summary: "Fetch patient profile with records which would include assciated visits and documents"
 *     description: ""
 *     parameters:
 *       - in: path
 *         name: patientId
 *         schema:
 *           type: string
 *         required: true
 *         description: Must provide the patient identifier to retrieve information
 *     security:
 *       - Token: []
 *     responses:
 *       200:
 *         description: Returns patient data
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   type: object
 *                   $ref: "#/components/schemas/Patient"
 *               example:
 *                 status: 200
 *                 data:
 *                   uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                   picture: "/picture.jpg"
 *                   firstName: Emma
 *                   lastName: Emma
 *                   gender: Male
 *                   dob: 2024-12-05
 *                   phoneNumber: 07012345678
 *                   email: emma-watson@gmail.com
 *                   state: true
 *                   verified: true
 *                   'type': 'patient'
 *                   created: 2024-12-05T19:00:00.151Z
 *                   updated: 2024-12-05T19:00:00.151Z
 *                   Visits:
 *                     - uuid: "mm0921a1-261a-40ba-915c-8465d258892d"
 *                       comment: 'jsjnknsnklkk'
 *                       commentBy: "akin"
 *                       type: visit
 *                   PatientDocuments:
 *                     - uuid: "mm0921a1-261a-40ba-915c-8465d258892d"
 *                       source: "https://dkdmd.com/sksjciidcidc"
 *                       sourceId: 'jncjncjdcdlkcmdkcckmkcmd'
 *                       type: patient_document
 *       401:
 *         description: Unauthorised response
 *       5xx:
 *         description: "Oops! A server error occcurred. Media type => text/plain"
 */

router.get(
	"/:patientUuid",
	async (ctx, next) => {
		// this is a catch-all route and should be set as least priority
		const pathIsUuid = ctx.params["patientUuid"];
		if (!UUID4Validator(pathIsUuid)) {
			ctx.status = statusCodes.NOT_FOUND;
			ctx.message = "Endpoint not found";
			return;
		}
		//Ensure only a priviledged active admin user is able to do this
		if (!ctx.state.user || ctx.state.user.type !== "admin" || ctx.state.user.role! > 0) {
			ctx.status = statusCodes.UNAUTHORIZED;
			ctx.message = "Unauthorised. You do not have access to these informations";
			return;
		} else await next();
	},
	async (ctx, next) => {
		if (ctx.path === ctx.url) {
			ctx.url = ctx.url + "?sort=[created=ASC]&limit=10";
		}
		await next();
	},
	dbQuerier({ ignoreStateFiltration: true, useOlderImplementation: false }),
	async (ctx) => {
		// managed include props
		const targetedUser: Includeable = {
			model: Patient(ctx.sequelizeInstance!),
			required: true,
			where: { uuid: ctx.params["patientUuid"] },
			include: [Visit(ctx.sequelizeInstance!), PatientDocument(ctx.sequelizeInstance!)],
		};

		if (ctx.state.dbQuerier["include"]) {
			if (Array.isArray(ctx.state.dbQuerier["include"])) ctx.state.dbQuerier["include"].concat([targetedUser]);
			else if (typeof ctx.state.dbQuerier["include"] === "object")
				ctx.state.dbQuerier["include"] = [ctx.state.dbQuerier["include"], targetedUser];
		} else
			ctx.state.dbQuerier = {
				...ctx.state.dbQuerier,
				include: [targetedUser],
			};

		const profile = await Patient(ctx.sequelizeInstance!).findOne(ctx.state.dbQuerier);

		if (profile) {
			ctx.status = statusCodes.OK;
			ctx.body = {
				status: statusCodes.OK,
				data: profile.toJSON(),
			};
		} else {
			ctx.status = statusCodes.NOT_FOUND;
			ctx.message = "Oops. No patient record found";
			return;
		}
	},
);

export { router as patientRecords };
