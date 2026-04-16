//import process from "node:process";

const config = {
	methods: ["GET", "PATCH", "POST", "DELETE"], //allows to define/limit allowed request methods
	//site media
	media: {
		mediaUploadRolePermission: 1,
		maxImageUploadSize: 10 * 1024 * 1024, //10mb
		maxVideoUploadSize: 100 * 1024 * 1024, //100mb
	},
	debug: false,
	ignoreMailServer: true, // force non-checking of mail server setup
	appMode: "fullstack", //"apiOnly" | "serverless" | "fullstack",

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

	//site server detail
	apiEndpoint: "/api/v3",
	authEndpoint: "admin/auth", // string | {[domain: *|string]: string} | false
	authTokenValidity: 3, // days
	setApiHostToBrowserOrigin: true,
	xRequestReferral: "greybox", //Remember to list allowable IDs on X_REQUEST_REFERRAL in .env

	allowSocialAccountSignin: ["google"], //["google", "facebook"],
	sitenameFull: "Greybox Library",
	sitename: "Greybox",
	siteThumbnail: "thumbnail.png", // in public folder
	siteAddress: process.env.NODE_ENV !== "production" ? "http://localhost" : "https://website.com",
	serverAddress: process.env.NODE_ENV !== "production" ? "http://localhost" : "https://website.com",

	//3rd party IDs | Client
	adsenseId: process.env.NODE_ENV !== "development" ? "" : "",
	measurementId: process.env.NODE_ENV !== "development" ? "" : "",
	facebookAppId: process.env.NODE_ENV !== "development" ? "" : "",

	//social media links
	brandEmail: "devakintunde@gmail.com",
	brandPhoneNo: 2348055163046,
	brandWhatsapp: 2348055163046,
	brandYoutube: "https://www.youtube.com/@greybox",
	brandFacebook: "greybox",
	brandInstagram: "greybox",
	brandTwitter: "greybox",
	brandTiktok: "greybox",
};

export default config;
