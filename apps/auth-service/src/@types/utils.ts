import { DefaultContext, ParameterizedContext } from "koa";
import { Next as koaNext } from "koa";
import { Sequelize } from "sequelize";
import { Server, Socket } from "socket.io";

type JsonValue = string | number | boolean | null | undefined | JsonObject | JsonArray;
export type JsonObject = {
	[key: string]: JsonValue;
};
export type JsonArray = Array<JsonValue>;

export interface AppContext extends ParameterizedContext {
	request: DefaultContext["request"] & {
		body?: JsonValue;
		files?: [string, File]; // [formidable.Fields<string>, formidable.Files<string>]
		rawBody?: unknown;
	};
	sequelizeInstance?: Sequelize;
	tenantMode?: string;
	ioSocket?: Socket & {
		handshake: Socket["handshake"] & {
			auth: Socket["handshake"]["auth"] & { sequelizeInstance?: Sequelize; tenantMode?: string };
		};
	};

	io?: Server;
}
export type AppSocket = Socket & {
	handshake: Socket["handshake"] & {
		auth: Socket["handshake"]["auth"] & { sequelizeInstance?: Sequelize; tenantMode?: string };
	};
};
export type Next = koaNext;
