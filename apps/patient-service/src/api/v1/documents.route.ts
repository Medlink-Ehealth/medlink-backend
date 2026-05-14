import { Router, statusCodes, UserSecurity, Patient, dbQuerier, logger, requestParser, storageConnector } from "@medlink/common";
import { PatientDocument } from "../../models/Document.model.js";

const router = Router("documents");

/**
 * Upload a patient document
 * @openapi
 * /patients/documents:
 *   post:
 *     tags:
 *       - Current signed-in patient documents
 *     summary: Add or upload a document by the signed-in patient user
 *     description: ""
 *     security:
 *       - Token: []
 *     requestBody:
 *       description: Request body can be available as json formated or FormData
 *       required: true
 *       content:
 *         multipart/form-data: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               source:
 *                 type: string
 *                 format: file
 *     responses:
 *       200:
 *         description: Returns upload data URL. Data would be returns as array if multiple file upload exists in a single request
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 statusText:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     source:
 *                       type: string
 *                     sourceId:
 *                       type: string
 *                     etag:
 *                       type: string
 *               example:
 *                 status: 200
 *                 statusText: "Upload Successful"
 *                 data:
 *                   source: "https://dkdmd.com/sksjciidcidc"
 *                   sourceId: 'jncjncjdcdlkcmdkcckmkcmd'
 *                   etag: ''
 *       304:
 *         description: Unable to upload
 *       406:
 *         description: Validate not acceptable error. Media type => text/plain
 *       5xx:
 *         description: "Oops! Server error. Media type => text/plain"
 */
router.post("/", requestParser({ multipart: true }), async (ctx) => {
	// import storage manager to handle uploads to remote
	const storage = new storageConnector(); // azure storage credential is set in env but can be overridden here by adding a second parameter

	const upload = await storage.uploadMedia({ files: ctx.request.files, relativeContainer: "temp", mediaPath: "private" });

	console.log("upload::", JSON.stringify(upload, null, 2));

	if (upload.success && upload.files) {
		const fileProps = Object.values(upload.files)[0].map((file) => ({
			sourceId: file.requestId,
			source: file.filePath,
			etag: file.etag,
		}));
		ctx.status = statusCodes.OK;
		return (ctx.body = {
			status: statusCodes.OK,
			statusText: "Upload Successful",
			data: fileProps.length === 1 ? fileProps[0] : fileProps,
		});
	}
	ctx.status = statusCodes.NOT_ACCEPTABLE;
	ctx.message = (!upload.success && upload.message) || statusCodes.NOT_ACCEPTABLE.toString();
	return;
});

/**
 * @openapi
 * /patients/documents:
 *   get:
 *     tags:
 *       - Current signed-in patient documents
 *     summary: "Fetch the document history of current signed-in patient user"
 *     description: ""
 *     security:
 *       - Token: []
 *     responses:
 *       200:
 *         description: Returns patient documents
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
 *                     - $ref: "#/components/schemas/PatientDocument"
 *               example:
 *                 status: 200
 *                 data:
 *                   - uuid: "df0921a1-261a-40ba-915c-8465d258892d"
 *                     source: "https://dkdmd.com/sksjciidcidc"
 *                     sourceId: 'jncjncjdcdlkcmdkcckmkcmd'
 *                     etag: ''
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
		const signedUser = {
			model: Patient,
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

		// fetch document history
		try {
			const documents = await PatientDocument(ctx.sequelizeInstance!).findAll(ctx.state.dbQuerier);
			if (documents && documents[0] instanceof Patient(ctx.sequelizeInstance!)) {
				ctx.status = statusCodes.OK;
				ctx.body = {
					status: statusCodes.OK,
					data: documents,
				};
				return;
			} else if (documents && documents.length === 0) {
				ctx.status = statusCodes.NOT_FOUND;
				ctx.message = "No record found";
				return;
			}
			ctx.status = statusCodes.BAD_REQUEST;
			return;
		} catch (err) {
			logger.error("Document retrival error:", err);

			ctx.status = statusCodes.BAD_REQUEST;
			ctx.message = (err as object)["message" as keyof typeof err]
				? (err as object)["message" as keyof typeof err]
				: "Server error occurred";
			return;
		}
	},
);

export { router as patientDocument };
