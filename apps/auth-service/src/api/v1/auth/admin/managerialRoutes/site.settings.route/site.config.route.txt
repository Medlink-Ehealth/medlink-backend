import { Router, statusCodes, requestParser, logger } from "@medlink/common";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resolve = (p: string) => path.resolve(__dirname, p);

const router = Router("site-config");
const root = process.cwd();

// http://riideon.local/api/v1/auth/admin/management/settings/site-config
router.use(
	//requestParser({ multipart: true }),
	async (ctx, next) => {
		if (ctx.method.toLowerCase() === "post" || ctx.method.toLowerCase() === "patch") {
			const requestBody = () => {
				return requestParser({ multipart: true })(ctx, next);
			};
			await requestBody();
		} else {
			await next();
		}
	},
	async (ctx, next) => {
		const settingsFileRoute = resolve(path.join(root, "site", "settings", "site.config.json"));
		try {
			// get site settings
			const readFile = fs.readFileSync(settingsFileRoute, "utf-8");
			ctx.state.sitesettings = JSON.parse(readFile);
		} catch (err) {
			logger.error("site setting json is yet to exist or poorly formatted, Re-creating....", err);
			// create file if error is thrown, or update content when JSON content is erroreous
			const sitesettings = {
				maintenanceMode: true,
				autoApproveNewOrdersForDelivery: false,
			};
			fs.writeFileSync(settingsFileRoute, JSON.stringify(sitesettings));
			ctx.state.sitesettings = sitesettings;
		}
		await next();
	},
);

/**
 *
 * @openapi
 * /auth/admin/management/settings/site-config:
 *   get:
 *     tags:
 *       - Platform Privileged Management, Executive Admin or higher
 *     summary: "Platform fucntionality can be configured from a central endpoint. Call this endpoint to have a view of the current setup. Note: A managerial level of 3 (Executive) or higher is required"
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *     responses:
 *       200:
 *         description: Returns platform-wide configurations
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   type: object
 *                   description: site Config schema
 *                   $ref: "#/components/schemas/SiteConfig"
 *               example:
 *                 status: 200
 *                 data:
 *                   maintenanceMode: false
 *                   platformFunctionality:
 *                     enableSmsSending: true
 *                   autoApproveNewOrdersForDelivery: false
 *                   scheduledPickupWindow:
 *                     - "12:00PM"
 *                     - "14:00PM"
 *                   scheduledDeliveryWindow:
 *                     - "15:00PM"
 *                     - "18:00PM"
 *                   maxPackageDeliveryPerAgent: 10
 *                   pricing:
 *                     distanceUnit: KM
 *                     weightUnit: KG
 *                     baseFarePerWeightCategory:
 *                       small:
 *                         price: 1500
 *                         weight: "<=2"
 *                       medium:
 *                         price: 2000
 *                         weight: "<=5"
 *                       large:
 *                         price: 2500
 *                         weight: "<=10"
 *                       xLarge:
 *                         price: 3500
 *                         weight: "+10"
 *                         perExtraWeight: 250
 *                     distanceCoverageForBaseFare: 3
 *                     pricePerUnitDistance:
 *                       small: 150
 *                       medium: 170
 *                       large: 185
 *                       xLarge: 200
 *                     categories:
 *                       "_baseFare": xLarge
 *                       "Gadget":
 *                         discount: 0
 *                         "_baseFare": medium
 *                         subcategory:
 *                           "Mobile phones & accessories":
 *                             discount: 1
 *                             "_baseFare": small
 *                           "Laptops & small gadgets":
 *                             discount: 1
 *                             "_baseFare": medium
 *                             subcategory:
 *                               Laptops:
 *                                 discount: 1
 *                                 "_baseFare": medium
 *                       "Perishable":
 *                         discount: 0
 *                         "_baseFare": smail
 *                     scheduledDiscountPercent: 30
 *                     discountBulkQuantityIncrease:
 *                       "+5": 2.5
 *                     failedDeliveryReattemptFee: 0
 *                     surge:
 *                       enabled: true
 *                       applyTo:
 *                         - instant
 *                       timePeriod: "11:00-17:00"
 *                       pricePercentIncrease: 5
 *                       dayOfWeekOrDate:
 *                         - December
 *                         - Monday
 *                         - "tuesday(23:00-23-59)"
 *                         - "2025-05-06"
 *                         - "2025-05-06|2025-05-12"
 *                         - "2025-05-06|2025-05-12(00:00-23:59)"
 *                         - "2025-03-25T22:37:52.184Z|2025-03-25T22:37:52.184Z"
 *                     fragileCautionFeePercent: 10
 *                     taxAdditionPercent: 7.5
 *                   payments:
 *                     vendors:
 *                       paystack:
 *                         enabled: true
 *                         initialize: "https://api.paystack.co/transaction/initialize"
 *                         verification: "https://api.paystack.co/transaction/verify/"
 *                       flutterwave:
 *                         enabled: true
 *                         initialize: ""
 *                         verification: ""
 *
 *       204:
 *         description: "Currently unable to get sitewide settings"
 *       401:
 *         description: Unauthorised to access submited feedbacks/Management privilege is needed. Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */
router.get("/", async (ctx) => {
	const settings = ctx.state.sitesettings;
	if (settings) {
		ctx.status = statusCodes.OK;
		ctx.body = {
			status: statusCodes.OK,
			data: settings,
		};
		return;
	}
	ctx.status = statusCodes.NO_CONTENT;
	ctx.message = "Currently unable to get sitewide settings";
	return;
});

/**
 *
 * @openapi
 * /auth/admin/management/settings/site-config:
 *   patch:
 *     tags:
 *       - Platform Privileged Management, Executive Admin or higher
 *     summary: "Platform fucntionality can be configured from this central endpoint. This can potentially reconfigure the entire funcionality of the platform. Note: A managerial level of 3 (Executive) or higher is required"
 *     security:
 *       - Token: []
 *     parameters:
 *       - $ref: '#/components/parameters/appID'
 *     requestBody:
 *       description: Update config, and Request body can be available as json formated or FormData
 *       required: true
 *       content:
 *         application/json: # Media type
 *           schema:
 *             $ref: "#/components/schemas/SiteConfig"
 *     responses:
 *       200:
 *         description: Returns platform-wide configurations after update
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                 data:
 *                   type: object
 *                   description: site Config schema
 *                   $ref: "#/components/schemas/SiteConfig"
 *               example:
 *                 status: 200
 *                 data:
 *                   maintenanceMode: false
 *                   platformFunctionality:
 *                     enableSmsSending: true
 *                   autoApproveNewOrdersForDelivery: false
 *                   scheduledPickupWindow:
 *                     - "12:00PM"
 *                     - "14:00PM"
 *                   scheduledDeliveryWindow:
 *                     - "15:00PM"
 *                     - "18:00PM"
 *                   maxPackageDeliveryPerAgent: 10
 *                   pricing:
 *                     distanceUnit: KM
 *                     weightUnit: KG
 *                     baseFarePerWeightCategory:
 *                       small:
 *                         price: 1500
 *                         weight: "<=2"
 *                       medium:
 *                         price: 2000
 *                         weight: "<=5"
 *                       large:
 *                         price: 2500
 *                         weight: "<=10"
 *                       xLarge:
 *                         price: 3500
 *                         weight: "+10"
 *                         perExtraWeight: 250
 *                     distanceCoverageForBaseFare: 3
 *                     pricePerUnitDistance:
 *                       small: 150
 *                       medium: 170
 *                       large: 185
 *                       xLarge: 200
 *                     categories:
 *                       "_baseFare": xLarge
 *                       "Gadget":
 *                         discount: 0
 *                         "_baseFare": medium
 *                         subcategory:
 *                           "Mobile phones & accessories":
 *                             discount: 1
 *                             "_baseFare": small
 *                           "Laptops & small gadgets":
 *                             discount: 1
 *                             "_baseFare": medium
 *                             subcategory:
 *                               Laptops:
 *                                 discount: 1
 *                                 "_baseFare": medium
 *                       "Perishable":
 *                         discount: 0
 *                         "_baseFare": smail
 *                     scheduledDiscountPercent: 30
 *                     discountBulkQuantityIncrease:
 *                       "+5": 2.5
 *                     failedDeliveryReattemptFee: 0
 *                     surge:
 *                       enabled: true
 *                       applyTo:
 *                         - instant
 *                       timePeriod: "11:00-17:00"
 *                       pricePercentIncrease: 5
 *                       dayOfWeekOrDate:
 *                         - December
 *                         - Monday
 *                         - "tuesday(23:00-23-59)"
 *                         - "2025-05-06"
 *                         - "2025-05-06|2025-05-12"
 *                         - "2025-05-06|2025-05-12(00:00-23:59)"
 *                         - "2025-03-25T22:37:52.184Z|2025-03-25T22:37:52.184Z"
 *                     fragileCautionFeePercent: 10
 *                     taxAdditionPercent: 7.5
 *                   payments:
 *                     vendors:
 *                       paystack:
 *                         enabled: true
 *                         initialize: "https://api.paystack.co/transaction/initialize"
 *                         verification: "https://api.paystack.co/transaction/verify/"
 *                       flutterwave:
 *                         enabled: true
 *                         initialize: ""
 *                         verification: ""
 *
 *       304:
 *         description: Currently unable to update sitewide settings
 *       401:
 *         description: Unauthorised to access submited feedbacks/Management privilege is needed. Media type => text/plain
 *       5xx:
 *         description: Unexpected server error occured. Media type => text/plain
 */
router.patch(
	"/",
	/* siteConfigValidator */ async (ctx) => {
		const settings = ctx.state.sitesettings;
		const patchObject = ctx.request.body;

		if (settings && patchObject) {
			const updates = { ...settings, ...(patchObject as object) };
			try {
				const settingsFileRoute = resolve(path.join(root, "site", "settings", "site.config.json"));

				const stringifiedSettings = JSON.stringify(updates);
				// overwrite config file
				fs.writeFileSync(settingsFileRoute, stringifiedSettings);

				// overwrite current cached version
				// Cache.set("platformConfigCached", stringifiedSettings);

				// return updated response
				ctx.status = statusCodes.OK;
				ctx.body = {
					status: statusCodes.OK,
					data: updates,
				};
				return;
			} catch (err) {
				logger.error("Site wide settings update error:", err);
				ctx.status = statusCodes.NOT_MODIFIED;
				ctx.message = "Currently unable to update sitewide settings";
				return;
			}
		}
		ctx.status = statusCodes.NOT_MODIFIED;
		ctx.message = "Currently unable to update sitewide settings";
		return;
	},
);
export { router as siteConfig };

/**
 * The basic site.config schema defination. Types is also defined in the "@types" directory
 * @openapi
 * components:
 *   schemas:
 *     SiteConfig:
 *       type: object
 *       properties:
 *         maintenanceMode:
 *           type: boolean
 *         platformFunctionality:
 *           type: object
 *           properties:
 *             enableSmsSending:
 *               type: boolean
 *         autoApproveNewOrdersForDelivery:
 *           type: boolean
 *         scheduledPickupWindow:
 *           type: array
 *           items:
 *             type: string
 *         scheduledDeliveryWindow:
 *           type: array
 *           items:
 *             type: string
 *         maxPackageDeliveryPerAgent:
 *           type: number
 *         pricing:
 *           type: object
 *           properties:
 *             distanceUnit:
 *               type: string
 *             weightUnit:
 *               type: string
 *             baseFarePerWeightCategory:
 *               type: object
 *               properties:
 *                 small:
 *                   type: object
 *                   properties:
 *                     price:
 *                       type: number
 *                     weight:
 *                       type: string
 *                 medium:
 *                   type: object
 *                   properties:
 *                     price:
 *                       type: number
 *                     weight:
 *                       type: string
 *                 large:
 *                   type: object
 *                   properties:
 *                     price:
 *                       type: number
 *                     weight:
 *                       type: string
 *                 xLarge:
 *                   type: object
 *                   properties:
 *                     price:
 *                       type: number
 *                     weight:
 *                       type: string
 *             distanceCoverageForBaseFare:
 *               type: number
 *             pricePerUnitDistance:
 *               type: object
 *               properties:
 *                 small:
 *                   type: string
 *                 medium:
 *                   type: string
 *                 large:
 *                   type: string
 *                 xLarge:
 *                   type: string
 *             categories:
 *               type: object
 *               properties:
 *                 "_baseFare":
 *                   type: string
 *                 categoryName:
 *                   type: object
 *                   properties:
 *                     discount:
 *                       type: number
 *                     "_baseFare":
 *                       type: string
 *                     subcategory:
 *                       type: object
 *
 *             scheduledDiscountPercent:
 *               type: number
 *             discountBulkQuantityIncrease:
 *               type: object
 *               properties:
 *                 benchMarkInString:
 *                   type: number
 *             failedDeliveryReattemptFee:
 *               type: number
 *             surge:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 applyTo:
 *                   type: array
 *                   items:
 *                     type: string
 *                 timePeriod:
 *                   type: string
 *                 pricePercentIncrease:
 *                   type: number
 *                 dayOfWeekOrDate:
 *                   type: array
 *                   items:
 *                     type: string
 *             fragileCautionFeePercent:
 *               type: number
 *             taxAdditionPercent:
 *               type: number
 *         payments:
 *           type: object
 *           properties:
 *             vendors:
 *               type: object
 *               properties:
 *                 paystack:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     initialize:
 *                       type: string
 *                     verification:
 *                       type: string
 *                 flutterwave:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     initialize:
 *                       type: string
 *                     verification:
 *                       type: string
 *
 */
