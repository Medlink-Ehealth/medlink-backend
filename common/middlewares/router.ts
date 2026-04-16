import router from "@koa/router";
import { DefaultContext, DefaultState } from "koa";
import { Sequelize } from "sequelize";
import config from "../../platform.config.js";

type JsonValue = string | number | boolean | null | undefined | JsonObject | JsonArray;
type JsonObject = {
	[key: string]: JsonValue;
};
type JsonArray = Array<JsonValue>;

export interface RouterExtendedDefaultContext extends DefaultContext {
	request?: {
		body?: JsonValue;
		files?: [string, File]; // [formidable.Fields<string>, formidable.Files<string>]
		rawBody?: unknown;
	};
	sequelizeInstance?: Sequelize;
}
type routerProps = { prefix?: string; host?: string; subdomain?: string };

/* You either use host or subdomain. Where this is the case, subdomain and domain is merged.
   Set subdomain to "-any-" to match any subdomain on a server.

   Host and subdomain doesn't work except when declared at the app root and not inside a route ancessor that has already been called.
*/
const Router = (opts?: string | routerProps, host?: string, subdomain?: string) => {
	let koaRouterPrefix;
	let koaRouterHost;
	let koaRouterSubdomain;

	//allow unintentional cases where route and host may be import as objects
	if (typeof opts === "object") {
		if (typeof opts.prefix === "string") koaRouterPrefix = opts.prefix;
		if (typeof opts.host === "string") koaRouterHost = opts.host;
		if (typeof opts.subdomain === "string") koaRouterSubdomain = opts.subdomain;
	}

	let routerProps:
		| {
				[prefixOrHost: string]: string | RegExp;
		  }
		| undefined;

	if (koaRouterPrefix)
		routerProps = {
			prefix: !koaRouterPrefix.startsWith("/") ? `/${koaRouterPrefix}` : koaRouterPrefix,
		};
	else if (typeof opts === "string")
		routerProps = {
			prefix: !opts.startsWith("/") ? `/${opts}` : opts,
		};

	if (koaRouterHost)
		routerProps = routerProps
			? { ...routerProps, host: koaRouterHost }
			: {
					host: koaRouterHost,
				};
	else if (typeof host === "string")
		routerProps = routerProps
			? { ...routerProps, host: host }
			: {
					host: host,
				};

	if ((subdomain && typeof subdomain === "string") || koaRouterSubdomain) {
		const thisSubdomain = subdomain || koaRouterSubdomain;
		if (routerProps && routerProps.host) {
			if ((routerProps.host as string).startsWith("www")) routerProps.host = (routerProps.host as string).split("www").join(thisSubdomain);
			else
				routerProps.host = (routerProps.host as string).includes("://")
					? (routerProps.host as string).split("://").join("://" + thisSubdomain + ".")
					: thisSubdomain + "." + routerProps.host;
		} else {
			let serverHost =
				config.serverAddress && config.serverAddress.includes("://") ? config.serverAddress.split("://")[1] : config.serverAddress;

			//console.log("thisSubdomain", thisSubdomain);
			let subdomainWithHost: string | RegExp;
			if (thisSubdomain === "-any-") {
				// match any subdoamin of a host
				// /^(.*\.)?hostb\.com$/;
				serverHost = serverHost && serverHost.split(".").join("\\.");
				subdomainWithHost = new RegExp("^(.*\\.)?" + serverHost + "$");
			} else subdomainWithHost = new RegExp("^" + thisSubdomain + "\\." + serverHost + "$"); //thisSubdomain + "." + serverHost;

			//console.log("subdomainWithHost", subdomainWithHost);
			routerProps = routerProps
				? { ...routerProps, host: subdomainWithHost }
				: {
						host: subdomainWithHost,
					};
		}
	}
	//console.log(routerProps);
	return new router<DefaultState, RouterExtendedDefaultContext>(routerProps);
};

export { Router };
