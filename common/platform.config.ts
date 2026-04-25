import type { PlatformConfig } from "./@types/platform.config.js";

const config: PlatformConfig = {
	apiMultiTenancyMode: false,
	authTokenLifetime: 15, // in minutes
	refreshTokenLifetime: "3", // 3 days
	methods: ["GET", "PATCH", "POST", "DELETE"], //allows to define/limit allowed request methods
	//site media file controller
	files: {
		filesUploadRolePermission: 1,
		maxImageUploadSize: 10 * 1024 * 1024, //10mb
		maxVideoUploadSize: 100 * 1024 * 1024, //100mb
		maxOtherFilesUploadSize: 2 * 1024 * 1024, //2mb
		dynamicallyServeFilesInDirectory: [], // string | string[] | string[][];
	},
	//server config
	debug: false,
	ignoreMailServer: true, // force non-checking of mail server setup
	allowSocialAccountSignin: ["google"], //["google", "facebook"],
	projectName: "MedLink",
	// serverAddress: process.env.NODE_ENV !== "production" ? "http://medlink.test" : "https://medlink-app.azurewebsites.net",

	// caching configuration
	cache: {
		max: 5000,
		maxSize: 20000,
		maxEntrySize: 2000,
		sizeCalculation: (value: string, key: string) => {
			return value && value.length ? value.length + key.length : 1;
		},
		ttl: 1000 * 60 * 60 * 3,
		updateAgeOnGet: true,
	},

	// this should be set on app config
	serverAddress: "",
	apiVersion: "",
};

// export default config
export { config };
export { config as PlatformConfig };
