import { KoaSwaggerUiOptions } from "koa2-swagger-ui";

export type PlatformConfig = {
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
	apiMultiTenancyMode: boolean | string | string[];
	useCacheAsRedisIsNotAvailable?: boolean; // if/when redis is not instantiated, we can temporarily use Cache  as a Redis replacement if enabled. Otherwise, all redis functionaliry is turned off

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

	authTokenLifetime?: number; // in minutes
	refreshTokenLifetime?: number | string; // in days

	allowSocialAccountSignin?: ("google" | "facebook")[];
	serviceName?: string;
	projectName?: string;
	serverAddress: string;
	apiVersion: string;
};
