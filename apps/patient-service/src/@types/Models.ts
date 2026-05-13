export interface AdminUser {
	uuid: string;
	avatar?: string;
	firstName: string;
	lastName?: string;
	phoneNumber?: string;
	email: string;
	role?: number;
	roleLabel?: string;
	state?: boolean;
	verified?: boolean;
	type: "admin";
	created?: string;
	updated?: string;
}

export interface ClientUser {
	uuid: string;
	avatar?: string;
	firstName: string;
	lastName?: string;
	phoneNumber?: string;
	email: string;
	state?: boolean;
	verified?: boolean;
	type: "client";
	created?: string;
	updated?: string;
}

export interface Image {
	uuid: string;
	title: string;
	alias: string;
	autoAlias: boolean;
	path: string;
	styles: { [shape: string]: string };
	state: boolean;
	meta?: object;
	type: "image";
	uploaded: Date;
	updated: Date;
	deleted?: Date;
}

export interface Video {
	uuid: string;
	title: string;
	alias: string;
	autoAlias: boolean;
	path: string;
	thumbnail?: string;
	source: string;
	state: boolean;
	meta?: object;
	type: "video";
	uploaded: Date;
	updated: Date;
	deleted?: Date;
}
