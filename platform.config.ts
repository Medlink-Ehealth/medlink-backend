import { KoaSwaggerUiOptions } from "koa2-swagger-ui";

export const config: ConfigDefination = {
	apiMultiTenancyMode: false,
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
	authTokenValidity: 3, // days
	allowSocialAccountSignin: ["google"], //["google", "facebook"],
	sitenameFull: "Med Link PoC",
	sitename: "MedLink",
	siteAddress: process.env.NODE_ENV !== "production" ? "http://medlink.test" : "https://medlink-app.azurewebsites.net",
	serverAddress: process.env.NODE_ENV !== "production" ? "http://medlink.test" : "https://medlink-app.azurewebsites.net",

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
};

export default config;

export type ConfigDefination = {
	methods?: ("GET" | "PATCH" | "POST" | "DELETE")[]; //allows to define/limit allowed request methods
	//site media
	files?: {
		filesUploadRolePermission: number;
		maxImageUploadSize: number;
		maxVideoUploadSize: number;
		maxOtherFilesUploadSize: number;
		dynamicallyServeFilesInDirectory?: string | string[] | string[][];
	};
	debug?: boolean;
	ignoreMailServer?: boolean; // force non-checking of mail server setup
	appMode?: "apiOnly" | "serverless" | "fullstack";
	apiMultiTenancyMode: boolean | string | string[];

	// caching configuration
	cache?: {
		max: number;
		maxSize: number;
		maxEntrySize: number;
		sizeCalculation: (value: string, key: string) => number;
		ttl: number;
		updateAgeOnGet: boolean;
	};

	// customise swager UI
	swaggerSetup?: Partial<KoaSwaggerUiOptions>;

	//site server detail
	apiEndpoint?: string;
	authEndpoint?: string; // string | {[domain: *|string]: string} | false
	authTokenValidity?: number; // days
	setApiHostToBrowserOrigin?: boolean;
	xRequestReferral?: string; //Remember to list allowable IDs on X_REQUEST_REFERRAL in .env

	allowSocialAccountSignin?: ("google" | "facebook")[];
	sitenameFull?: string;
	sitename?: string;
	siteThumbnail?: string;
	siteAddress?: string;
	serverAddress?: string;
};
