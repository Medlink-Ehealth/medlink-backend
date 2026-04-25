//import { authenticatedUser } from "./account.routes.js";
import { publicAdminRoutes } from "./publicAdmin.routes.js";
import { requestParser, Router } from "@medlink/common";
import { publicClientUsers } from "./publicClientUsers.routes.js";
import { refreshAccessToken } from "../../../controllers/token.auth.controller.js";
import config from "../../../../app.config.js";

const router = Router();

// Platform uses a combined Client and Delivery Partner user access in endpoints
router.use(publicClientUsers.routes());

// Admin access endpoints
router.use(publicAdminRoutes.routes());

// Token refresher
/**
 * Reset user passowrd
 * @openapi
 * /token/refresh:
 *   post:
 *     tags:
 *       - Client Users
 *       - Admin Users
 *     summary: Refresh an expired access token using the refresh token
 *     description: "Existing refresh token must be provided for a request to be valid. The refresh token can be provided in any of request header using 'x-refreshToken', in request body as 'refreshToken' or url query with value set to 'refreshToken'. Once validated, a new access token and new refresh token would be returned; previous refresh token becomes invalid"
 *     requestBody:
 *       description: Request body can be available as json formated or FormData
 *       required: true
 *       content:
 *         application/json: # Media type
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful notice
 *         content:
 *           application/json: # Media type
 *             schema: # Must-have
 *               type: object
 *               properties:
 *                 status: number
 *                 token:  string
 *                 refreshToken:  string
 *               example:
 *                 status: 200
 *                 token:  "fNxKErCZjqG7kXx_L5arYwG8SbRzMF6RGnXf_yTp-zkmXVo6__4oJKOXZWf62ChEi02u9L6L0BXo1hVLAjj4s79LQwnxUS8zBEHBwhnQFKEcR5LjiRVyrHXy24bM8C6kjuyp0W9SWhqAFOSQnsx2d2xAmGXi_UOHpHF1izBbt2hUKTyWfv_Rrxibw0K-HHQXGF24huwvuRG5IGYTVQRtq4J6vqNjBFR3wTcuAbkPHHILiaYXalBFLJ_TIjWJxZKxFuL7zlgys5IYjlaPXf2Hr9wTk71hbztqv7SlHPRNmDk2La8_C8r4pjFi9I1gE7KnVY5WOueePDw42QSFTcSLa7olvWGNf7Gq0UdChqWUtAG3Vmg5P__IgIMOQFvpXrmO-YFYVhhwifBLFuKNB-C2kFd4YrsvpSS6CH-qG82Qm7ENIFbAy-C18cp6I3gR_8AEpK4d44w_T-72T8dDpp7lkyrX9_BjgBn64ACR37Kl9MwBDkcF0nQseXX1VGhjCLhwbbaJ9J_DwQ2qC7NI_2RQ1yR3JcodZnQ8Sx6PoqR4n-bVhF6oTpXYPGzYzoKT4RLY7m8HYY8eDvAJB8poVpylxvoJU7WV3ucCcMpa5CMA0o8Nd-Vwz1pd6HOFT2iuLW-n1JVZuA0lH0XEmAP36asKGfOnyTf48aTf6VoGjp3R8vtP9dQqjuFuqEyqEdTz1A"
 *                 refreshToken:  "QHJ-yQOV2A-kgsGxrMpFLVkGdLWBxIz-p2pQvSAj3QERyZgy5F-gQMkjq-fQ09kXw8nPuY4GvClrchKJLgEoC91uxtOgWP8NaXKsAdyAnwPxffChfEGHuQ_CZULRlpSCwZGatRFVdXlIfv8x3vLvz5PVDztth9Kmd2eQ6VDGyQOsaC9xKwgapBhNMIvEazG3PJ6cd_iq6quGp8IXgV-fNUOEkhAA669TIGfLj4Nf4SF6RFv4KwpPKQyH7Gh7aYYxhSyIUGXFsS8TFlHJamiDc30DzBv04WsqZLisJ6RlDfXGZGuWBEF6FiK_18o-FZPZKxtwBv-5JW5ANPtgaVOHyuVzNbkqmKHd525osc0n474tOUBj8Ugz-2w-ZE9dyEdnvu_n8sdZIX3gjhWjnmeheaR3Kqgfc4dV0AYWqDiP-zNkEYBSrCx8QwK4rxbqgr3TLEdBltp9tOsVm5w7LjiMfaDDrG6a3fql-ClEwHBcTBPnipeixbb4X-GidBX4uQ3W7meBTln8nqdgVLaQ1k7ZsMowoF2z_4GGEvOxb3lECjMPU8JJw73Ae1HhjaIdB0mthfgNhQB04sRhVHTyngvp5-SKht4_UEJNerVgl0qsCdljtPvk1gnJTTJvsA2em7c5AUPJ-8RruMCj7YWXXZMf05aM1-4PfVh4vRMl0hjPvIPYrsakQlC8Cfz4F1FG0bqiothzW2qfgzZwclq5TksbU72CDKuDg0EGrNJB8CmmYE1WWngPgxdMFoXJ3s_GU9eE5bVnpfdPdA0ihWL9lGd-jHzxOX8FaTrrgEMhYFYeIWdgnNmq6VEBBSqRvi2fI-GdBU8-2GatpZV1OiayMvOmxZQh9zco0TXLGybD1Aq6jvqPXcbKQaGAeL7GXUT3ChXAeJ-sZG4E9ZQqXyqCi8KWEzhq6kkmf-jgsNDy5o4o5UOnxJPeyNc14_XAxmBfFsq2I-yhfEH52j1SOsnGzRU7oyrHyei0OJtoMK57xhBhbPRtbSOqFYgiUn18ePRTkzS2n0ojuOYIgm-Z3hKfhX53rcFShTHVgZ-6eqf0AAnUtt8Zjbw_XnwoeOC6aJWEaDUuPH-qEJxMWxS5CZ3fyRDkEeoTgHglX_Zk10hAeNXGGd6yCBwS9WDyo2uiuYmj0m6S71aBWOTg8rz8Qvj-Q6pMBY3Y9Dr8-janQtc"
 *       400:
 *         description: Bad request
 *       404:
 *         description: Invalid refresh token
 *       503:
 *         description: The service is currently not available
 *       5xx:
 *         description: Unexpected server error occured
 */

router.post(
	"/token/refresh",
	requestParser(),
	refreshAccessToken({
		useCacheIfNoRedis: config.useCacheAsRedisIsNotAvailable,
		accessTokenLifetime: config.authTokenLifetime,
		refreshTokenLifetime: config.refreshTokenLifetime,
	}),
	(ctx) => {
		// refreshAccessToken used as middleware expects to handover to next middleware. We are ending that process here
		ctx.status = 200;
		return (ctx.body = { ...ctx.body, status: 200 });
	},
);

export { router as nonAuthAccountRelatedRoutes };
