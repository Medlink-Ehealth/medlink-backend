import path from "node:path";
import process from "node:process";
import fs from "node:fs";
import { NOT_ACCEPTABLE } from "../constants/statusCodes.js";
import { KoaBodyMiddlewareOptions } from "koa-body";
import { config } from "../platform.config.js";

//type defines the kind/type of media
//type options: image/video
const media = (type?: "image" | "video" | ("image" | "video")[]): Partial<KoaBodyMiddlewareOptions> => {
	const mediaType = type ? (typeof type === "string" ? [type.toLowerCase()] : type.map((ty) => ty.toLowerCase())) : undefined;
	const imageMaxFileSize =
		config && config.files && config.files.maxImageUploadSize && typeof config.files.maxImageUploadSize === "number"
			? config.files.maxImageUploadSize
			: 3 * 1024 * 1024; //3mb
	const videoMaxFileSize =
		config && config.files && config.files.maxVideoUploadSize && typeof config.files.maxVideoUploadSize === "number"
			? config.files.maxVideoUploadSize
			: 30 * 1024 * 1024; //30mb

	// media temp upload directory
	let tempFolder = process.env.tempFolder;
	if (!tempFolder) tempFolder = path.join(process.cwd(), "site", "files", "temp");
	else tempFolder = path.join(process.cwd(), tempFolder);
	// create dir if it doesn't exist
	if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

	return {
		//multipart: true,
		formidable: {
			maxFileSize: mediaType?.includes("video") ? videoMaxFileSize : imageMaxFileSize,
			filter: (part) => {
				//console.log("part", part);
				return !mediaType // disable file processing when no type is defined
					? false
					: part.mimetype
						? part.mimetype.toLowerCase().includes("image/jpg") ||
							part.mimetype.toLowerCase().includes("image/jpeg") ||
							part.mimetype.toLowerCase().includes("image/png") ||
							part.mimetype.toLowerCase().includes("image/webp") ||
							part.mimetype.toLowerCase().includes("audio/wav") ||
							part.mimetype.toLowerCase().includes("audio/ogg") ||
							part.mimetype.toLowerCase().includes("audio/mpeg") ||
							//video types outside mp4 & webm not supported
							part.mimetype.toLowerCase().includes("video/mp4") ||
							part.mimetype.toLowerCase().includes("video/webm")
							? true
							: false
						: false;
			},
			uploadDir: tempFolder, //relative to App root
			keepExtensions: true,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			filename: (name: string, ext: string, form: any) => {
				//console.log("form", form);
				// lets extract ext where it does not exist from mimetype, keeping in mind that this might sometimes list multiple. We simple pick the first
				if (!ext && form["mimetype"]) {
					const mimeType = form["mimetype"].includes(",") ? form["mimetype"].split(",")[0] : form["mimetype"];
					ext = "." + (mimeType.includes("/") ? mimeType.split("/")[1] : mimeType);
				}
				return (
					(config.serverAddress ? config.serverAddress.split(" ").join("") : "media") +
					"-" +
					form.name.replace(/[^a-zA-Z0-9 ]/g, "-") +
					"-" +
					Date.now().toString() +
					ext
				);
			},
		},
		onError: (err, ctx) => {
			//formidable Error: image more than required size, CODE = 1009
			if ((err as unknown as { code: number }).code === 1009) {
				ctx.state.error = {
					code: NOT_ACCEPTABLE,
					message: `${mediaType?.includes("video") ? "Video" : "Image"} exceeds maximum allowed size of ${
						mediaType?.includes("video") ? Math.floor(videoMaxFileSize / 1000000) : Math.floor(imageMaxFileSize / 1000000)
					}mb`,
				};
			}
			return ctx.throw(err as object);
		},
	};
};
export { media };
