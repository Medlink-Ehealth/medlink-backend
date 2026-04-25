import "dotenv/config";
import { server, storageConnector } from "@medlink/common";
import { router } from "./src/api/api.entry.router.js";
import { jobScheduler } from "./src/cron/jobScheduler.js";
import { redis } from "./src/performance.controller.js";

//Define App server config
export default (async () => {
	// we may need to check redis and affirm disconnection

	// lets ensure storage connectivity is good, especially when remote storage is in play
	(async () => {
		const storage = new storageConnector();
		const status = await storage.testConnectivity();
		console.log("Conversation storage connected: ", status);
		// lets ensure our storage account is setup before allowing server to start
		if (!status) throw new Error("Storage connectivity is unsuccessful and App is unable to start up");
	})();

	return await server({
		redis: redis || undefined,
		cronJobs: jobScheduler,
		appRoutes: router,
		cors: {
			origin: [
				"http://localhost",
				"http://localhost:80",
				"http://localhost:3000",
				{
					host: "http://localhost",
					csp: "'unsafe-inline' data: cdnjs.cloudflare.com fonts.googleapis.com",
				},
			],
			//allowedMethods: '',
			//exposeHeaders: '',
			//allowHeaaders: ''
		},
		sessionConfig: {
			key: process.env.COOKIE_IDENTIFIER as string,
			maxAge: 3 * 24 * 60 * 60 * 1000, // 3days
			autoCommit: true,
			overwrite: true,
			httpOnly: true,
			signed: true,
			rolling: false,
			renew: false,
			secure: process.env.NODE_ENV === "production" ? true : false, //change to true in production
			sameSite: "strict", //process.env.NODE_ENV === "production" ? "Strict" : null,
		},
	});
})();
