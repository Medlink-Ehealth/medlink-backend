import path from "node:path";
import fs, { createWriteStream } from "node:fs";
import process from "node:process";
import sharp from "sharp";
import "dotenv/config";
import formidable from "formidable";
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";
import { PassThrough, Readable } from "node:stream";
import { ParameterizedContext } from "koa";
import VolatileFile from "formidable/VolatileFile";
import { fileTypeFromBuffer } from "file-type";
import { IncomingMessage } from "node:http";
import EventEmitter from "node:events";
import url from "node:url";
import { appInstance } from "../server.js";
import { logger } from "../utils/logger.js";
import config from "../../platform.config.js";
import { throwError } from "./throwError.js";
import { statusCodes } from "../constants/index.js";
import { AppContext } from "../@types/index.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const resolve = (p: string) => path.resolve(__dirname, p);
// const relativeProjectRoot = __dirname.split(projectRoot)[1];

type azureObject = {
	AZURE_TENANT_ID: string;
	AZURE_CLIENT_ID: string;
	AZURE_CLIENT_SECRET: string;
	STORAGE_ACCOUNT_NAME: string;
	CONTAINER_NAME: string;
};
const envs = process.env;
const envMediaStorage = envs["CONVERSATION_MEDIA_STORAGE"] as string;
const envMediaStoragePath = envs["CONVERSATION_MEDIA_STORAGE_PATH"] as string;
const dataPath = envMediaStorage === "azure" ? (JSON.parse(envMediaStoragePath) as azureObject) : envMediaStoragePath;

// const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Common MIME types for proper content-type headers
const imageMimeTypes = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".bmp": "image/bmp",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	// ".ico": "image/x-icon",
};
const mimeTypes = {
	// Text files
	// ".html": "text/html",
	// ".htm": "text/html",
	// ".css": "text/css",
	// ".js": "application/javascript",
	// ".json": "application/json",
	// ".txt": "text/plain",
	// ".xml": "application/xml",
	// ".csv": "text/csv",

	// Images
	...imageMimeTypes,

	// Audio
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".aac": "audio/aac",
	// ".flac": "audio/flac",

	// Video
	".mp4": "video/mp4",
	".webm": "video/webm",
	".avi": "video/x-msvideo",
	".mov": "video/quicktime",
	// ".mkv": "video/x-matroska",
};
// deduce file extension from mimetypes
const reverseMimetypesToExt = (mimetype: string) => {
	return Object.keys(mimeTypes).filter((loop) => mimeTypes[loop as ".jpg"] === mimetype)[0];
};

const formidableFilter =
	(mimetypes: string[] = Object.values(mimeTypes)) =>
	(part: formidable.Part) => {
		// disable file processing when no type is defined
		return part.mimetype ? mimetypes.includes(part.mimetype.toLowerCase()) : false;
	};

class LocalStorageService {
	private rootDir: string;
	private cwd = process.cwd();
	private event;
	constructor(relativeToProjectRootContainer?: string | string[]) {
		this.event = new EventEmitter();
		this.rootDir = path.join(
			this.cwd,
			"site",
			relativeToProjectRootContainer
				? typeof relativeToProjectRootContainer === "string"
					? relativeToProjectRootContainer
					: relativeToProjectRootContainer.join("/")
				: "storage",
			typeof dataPath === "string" ? dataPath : "local",
		); // neccessary for upload destinations. Note that "/site/files/" directory is auto managed internally by greybox. Hence we are enforcing a new holding directory to handle the needed scenario here so Greybox can ignire the files
	}

	async testConnectivity(): Promise<boolean> {
		try {
			if (!fs.existsSync(this.rootDir)) {
				fs.mkdirSync(this.rootDir, { recursive: true });
			}
			return true;
		} catch (err) {
			logger.error("Error initiating connection to Azure: ", err);
			return false;
		}
	}

	on(
		eventName: "error" | "completed" | "pending",
		listener: (data?: { filePath?: string; requestId?: string; etag?: string; status: "pending" | "completed" | "error" }) => void,
	) {
		this.event.on(eventName, listener);
	}

	async uploadMedia({
		disableFileNameRewrite,
		mediaPath,
		files = appInstance?.currentContext?.request.req.files,
		relativeContainer,
	}: {
		disableFileNameRewrite?: boolean;
		mediaPath: "public" | "private";
		files?: ParameterizedContext["request"]["req"]["files"];
		relativeContainer?: string | string[];
	}): Promise<{
		success: boolean;
		files: {
			[file: string]: {
				filePath: string;
				requestId: string;
				etag?: string;
				// status: "pending" | "completed" | "error";
			}[];
		} | null;
		message?: string | null;
	}> {
		if (!files || Object.keys(files).length === 0)
			return {
				success: false,
				files: null,
				message: "No uploadable file found!",
			};

		//mandatorily send files to private DIR if on the autoPrivatePath array
		const autoPrivatePaths = ["account", "auth"];
		//check if relativeContainer contains label string that may require to force as private
		let placeInPublic = mediaPath === "public" ? true : false;
		const likelyForceablyPrivatePath =
			relativeContainer && relativeContainer.length ? (Array.isArray(relativeContainer) ? relativeContainer : [relativeContainer]) : [];

		if (placeInPublic && likelyForceablyPrivatePath.length) {
			for (let i = 0; i < autoPrivatePaths.length; i++) {
				if (likelyForceablyPrivatePath.includes(autoPrivatePaths[i])) {
					placeInPublic = false;
					break;
				}
			}
		}

		const mediaDumpDirFromFormidable: string[] = [];
		const bodyFiles: {
			[file: string]: {
				filePath: string;
				requestId: string;
				etag?: string;
				// status: "pending" | "completed" | "error";
			}[];
		} = {};

		try {
			//construct functions to progress data
			for (const file of Object.keys(files!)) {
				const fileContents = Array.isArray(files![file]) ? files![file] : [files![file]];

				// lets reserve all processed new path here
				const filePaths: {
					filePath: string;
					requestId: string;
					etag?: string;
				}[] = [];
				for (const content of fileContents) {
					let destinationFolder = content.mimetype
						? content.mimetype.includes("image") || content.mimetype.includes("svg")
							? "image"
							: content.mimetype.split("/")[0].toLowerCase()
						: "other";
					if (!destinationFolder.endsWith("s")) destinationFolder = destinationFolder + "s";

					//set media Directory
					const containerDirectry = path.join(
						this.rootDir,
						placeInPublic ? "global" : "auth",
						destinationFolder,
						relativeContainer ? (Array.isArray(relativeContainer) ? path.join(...relativeContainer) : relativeContainer) : "",
					);
					// lets check if dir exist, else create it
					if (!fs.existsSync(containerDirectry)) {
						fs.mkdirSync(containerDirectry, { recursive: true });
					}

					const fileName = (
						disableFileNameRewrite && content.originalFilename
							? content.originalFilename.replace(/[^a-zA-Z0-9.]/g, "-") // Revert renaming that would have been done in requestParser, and we also strip special characters that may exist on original name
							: content.newFilename
					).replace(/\.svg$/, ".png"); // if svg reaches here, lets ensure to track the proper name since sharp would auto-convert this to png

					const newPath = path.join(containerDirectry, fileName);

					const currentPath = content.filepath;
					const moveNonImageFile = () => {
						//console.log("currentPath", currentPath);
						//console.log("newPath", newPath);
						try {
							fs.renameSync(currentPath, newPath);
							filePaths.push({
								filePath: newPath.split(this.cwd)[1],
								requestId: newPath,
								// etag: "",
							});
						} catch (err) {
							// track redondant error on local version
							mediaDumpDirFromFormidable.push(currentPath);
							return err;
						}
					};

					const mediaIsImage = content.mimetype && imageMimeTypes[reverseMimetypesToExt(content.mimetype) as ".jpg"];

					if (!mediaIsImage) await moveNonImageFile();
					else
						await sharp(currentPath)
							.toFile(newPath)
							.then(async () => {
								//insert new path as filepath for server use
								//console.log("file", file);
								filePaths.push({
									filePath: newPath.split(this.cwd)[1],
									requestId: newPath,
									// etag: "",
								});
								// track redundant local version for later deletion
								mediaDumpDirFromFormidable.push(currentPath);
							})
							.catch((err) => {
								// console.error("lets clean original", err);
								try {
									fs.unlink(newPath, () => {});
									fs.unlink(currentPath, () => {});
									return err;
								} catch (err) {
									return err;
								}
							});
				}
				// console.log("file", file);
				// console.log("filePaths", filePaths);

				bodyFiles[file] = filePaths;
			}
			// clear dumps
			if (mediaDumpDirFromFormidable.length > 0) {
				try {
					mediaDumpDirFromFormidable.map((media) => {
						return fs.unlink(media, () => {});
					});
				} catch (err) {
					/* Prevent error from leaking on unlink failure */
					logger.error("Issue removing redundant media files in storageManager function: ", err);
				}
			}

			return {
				success: true,
				files: bodyFiles,
			};
		} catch (error) {
			logger.error("Local File upload processing error:", error);
			return {
				success: false,
				files: null,
				message: "Error occurred",
			};
		}
	}

	async uploadFileFromRequestStream({
		reqOrStream = appInstance?.currentContext as unknown as ParameterizedContext,
		disableFileNameRewrite,
		mediaPath,
		mimetypes,
		relativeContainer,
	}: {
		disableFileNameRewrite?: boolean;
		reqOrStream?:
			| { stream: ReadableStream<Uint8Array<ArrayBufferLike>> | Readable; mimetype: string }
			| ParameterizedContext
			| IncomingMessage;
		mediaPath: "public" | "private";
		mimetypes?: string[];
		relativeContainer?: string | string[];
	}): Promise<{
		success: boolean;
		files: {
			[file: string]: {
				filePath: string;
				requestId: string;
				etag?: string;
				status: "pending" | "completed" | "error";
			}[];
		} | null;
		message?: string | null;
	}> {
		if (!reqOrStream)
			return {
				success: false,
				files: null,
				message: "No App context or incoming request defined",
			};

		// defined the request type
		const requestType = (reqOrStream as ParameterizedContext).req
			? "koa"
			: (reqOrStream as { stream: ReadableStream<Uint8Array<ArrayBufferLike>>; mimetype: string })?.stream
				? "stream"
				: "node";

		console.log("requestType: ", requestType);

		if (requestType !== "stream" && !(reqOrStream as IncomingMessage).method)
			return {
				success: false,
				files: null,
				message: "Invalid request body defined",
			};

		try {
			//mandatorily send files to private DIR if on the autoPrivatePath array
			const autoPrivatePaths = ["account", "auth"];
			//check if relativeContainer contains label string that may require to force as private
			let placeInPublic = mediaPath === "public" ? true : false;
			const likelyForceablyPrivatePath =
				relativeContainer && relativeContainer.length ? (Array.isArray(relativeContainer) ? relativeContainer : [relativeContainer]) : [];

			if (placeInPublic && likelyForceablyPrivatePath.length) {
				for (let i = 0; i < autoPrivatePaths.length; i++) {
					if (likelyForceablyPrivatePath.includes(autoPrivatePaths[i])) {
						placeInPublic = false;
						break;
					}
				}
			}

			const method: "stream" | "post" | "patch" | undefined =
				requestType === "stream" ? "stream" : ((reqOrStream as IncomingMessage)?.method?.toLowerCase() as "post" | "patch");
			if (method === "post" || method === "patch" || method === "stream") {
				// output data holder
				const fileData: {
					[file: string]: {
						filePath: string;
						requestId: string;
						etag?: string;
						status: "pending" | "completed" | "error";
					}[];
				} = {};

				// when direct stream is available
				if (method === "stream") {
					reqOrStream = reqOrStream as { stream: ReadableStream<Uint8Array<ArrayBufferLike>>; mimetype: string };

					const nodeStream =
						reqOrStream.stream instanceof Readable
							? reqOrStream.stream
							: reqOrStream.stream instanceof ReadableStream
								? Readable.fromWeb(reqOrStream.stream as unknown as import("stream/web").ReadableStream)
								: null;
					if (!nodeStream)
						return {
							success: false,
							files: null,
							message: "Invalid file stream",
						};

					const mimetype = reqOrStream.mimetype;
					// ensure only compatible mime type
					if (!(mimetypes || Object.values(mimeTypes)).includes(mimetype.toLowerCase()))
						return {
							success: false,
							files: null,
							message: "Unsupported mimetype",
						};

					const ext = reqOrStream.mimetype.includes(",")
						? reverseMimetypesToExt(reqOrStream.mimetype.split(",")[0])
						: reverseMimetypesToExt(reqOrStream.mimetype);
					const fileName = (config.sitename ? config.sitename.split(" ").join("") + "-" : "") + "-" + Date.now().toString() + ext;

					// let put toget the destination dir
					let destinationFolder = reqOrStream.mimetype
						? reqOrStream.mimetype.includes("image") || reqOrStream.mimetype.includes("svg")
							? "images"
							: reqOrStream.mimetype.split("/")[0].toLowerCase()
						: "others";

					if (!destinationFolder.endsWith("s")) destinationFolder = destinationFolder + "s";

					const fullDestinationFolder = path.join(
						this.rootDir,
						placeInPublic ? "global" : "auth",
						destinationFolder,
						relativeContainer ? (Array.isArray(relativeContainer) ? path.join(...relativeContainer) : relativeContainer) : "",
					);
					// lets check if dir exist, else create it
					if (!fs.existsSync(fullDestinationFolder)) {
						fs.mkdirSync(fullDestinationFolder, { recursive: true });
					}
					// form the full path
					const filePath = path.join(fullDestinationFolder, fileName);

					const stream: {
						filePath: string;
						requestId: string;
						etag?: string;
						status: "pending" | "completed" | "error";
					}[] = await new Promise((resolve) => {
						const fileStream = createWriteStream(filePath);
						// pipe stream
						nodeStream.pipe(fileStream);
						const object = {
							filePath: filePath.split(this.cwd)[1], // relative to the storageManager storage locatio in env
							requestId: filePath,
							status: "pending",
						};
						fileStream.on("open", () => {
							this.event.emit("pending", object);
						});
						fileStream.on("finish", () => {
							// emit custom event
							this.event.emit("completed", {
								...object,
								status: "completed",
							});

							resolve([
								{
									...object,
									status: "completed",
								},
							]);
						});
						fileStream.on("error", () => {
							this.event.emit("error", {
								status: "error",
							});
							fileStream.close();
							resolve([
								{
									...object,
									status: "error",
								},
							]);
						});
					});
					fileData[mimetype] = stream;
				} else {
					//set media temp Directory
					const containerTempDirectry = path.join(
						this.rootDir,
						"temp",
						relativeContainer ? (Array.isArray(relativeContainer) ? path.join(...relativeContainer) : relativeContainer) : "",
					);
					// lets check if dir exist, else create it
					if (!fs.existsSync(containerTempDirectry)) {
						fs.mkdirSync(containerTempDirectry, { recursive: true });
					}

					// build formidable
					const form = formidable({
						uploadDir: containerTempDirectry, //relative to App root
						// keepExtensions: true,
						multiples: true,
						filter: formidableFilter(mimetypes),
						filename: (name, ext, part) => {
							// lets extract ext where it does not exist from mimetype, keeping in mind that this might sometimes list multiple. We simple pick the first
							if (!ext && part.mimetype) {
								ext = part.mimetype.includes(",")
									? reverseMimetypesToExt(part.mimetype.split(",")[0])
									: reverseMimetypesToExt(part.mimetype);
							}
							return (
								(disableFileNameRewrite
									? name.replace(/[^a-zA-Z0-9 ]/g, "-") // lets strip special characters that may exist
									: (config.sitename ? config.sitename.split(" ").join("") + "-" : "") + part.name + "-" + Date.now().toString()) + ext
							);
						},
					});

					// not very elegant, but that's for now if you don't want to use `koa-better-body`
					// or other middlewares.
					const parsedFile = await form.parse(
						requestType === "koa" ? (reqOrStream as ParameterizedContext).req : (reqOrStream as IncomingMessage),
					);

					console.log("parsedFile: ", parsedFile);

					if (Object.keys(parsedFile[1]).length)
						for (const fileKey of Object.keys(parsedFile[1])) {
							const file = parsedFile[1][fileKey];
							if (file)
								for (const content of file) {
									// console.log("content - file", content);
									let destinationFolder = content.mimetype
										? content.mimetype.includes("image") || content.mimetype.includes("svg")
											? "images"
											: content.mimetype.split("/")[0].toLowerCase()
										: "others";
									if (!destinationFolder.endsWith("s")) destinationFolder = destinationFolder + "s";
									const fullDestinationFolder = path.join(
										this.rootDir,
										placeInPublic ? "global" : "auth",
										destinationFolder,
										relativeContainer ? (Array.isArray(relativeContainer) ? path.join(...relativeContainer) : relativeContainer) : "",
									);
									// lets check if dir exist, else create it
									if (!fs.existsSync(fullDestinationFolder)) {
										fs.mkdirSync(fullDestinationFolder, { recursive: true });
									}
									// set data and move the file to new file dir
									const filePath = path.join(fullDestinationFolder, content.newFilename);
									if (fileData[fileKey])
										fileData[fileKey].push({
											filePath: filePath.split(this.cwd)[1], // relative to the storageManager storage locatio in env
											requestId: filePath,
											status: "completed",
										});
									else
										fileData[fileKey] = [
											{
												filePath: filePath.split(this.cwd)[1], // relative to the storageManager storage locatio in env
												requestId: filePath,
												status: "completed",
											},
										];
									fs.renameSync(path.join(containerTempDirectry, content.newFilename), filePath);
								}
						}
				}
				const uploadableFileExists = Object.keys(fileData).length;

				return {
					success: uploadableFileExists ? true : false,
					files: uploadableFileExists ? fileData : null,
					message: !uploadableFileExists ? "No supported file found" : null,
				};
			}

			return {
				success: false,
				files: null,
				message: "No acceptable method defined",
			};
		} catch (error) {
			logger.error("Stream file upload error:", error);
			return {
				success: false,
				files: null,
				message: "Errorred occurred",
			};
		}
	}

	async uploadFileFromBuffer({
		buffer,
		fileName,
		mediaPath,
		mimetype,
		relativeContainer,
	}: {
		buffer: Buffer;
		fileName?: string;
		mediaPath: "public" | "private";
		mimetype: string | string[];
		relativeContainer?: string | string[];
	}): Promise<{
		success: boolean;
		filePath: string | null;
		mimetype: string | null;
		message?: string | null;
		requestId?: string;
		etag?: string;
	}> {
		if (!buffer)
			return {
				success: false,
				message: "No bufferred file defined",
				mimetype: null,
				filePath: null,
			};

		try {
			//mandatorily send files to private DIR if on the autoPrivatePath array
			const autoPrivatePaths = ["account", "auth"];
			//check if relativeContainer contains label string that may require to force as private
			let placeInPublic = mediaPath === "public" ? true : false;
			const likelyForceablyPrivatePath =
				relativeContainer && relativeContainer.length ? (Array.isArray(relativeContainer) ? relativeContainer : [relativeContainer]) : [];

			if (placeInPublic && likelyForceablyPrivatePath.length) {
				for (let i = 0; i < autoPrivatePaths.length; i++) {
					if (likelyForceablyPrivatePath.includes(autoPrivatePaths[i])) {
						placeInPublic = false;
						break;
					}
				}
			}
			// detect if its valid file type
			const fileMeta = await fileTypeFromBuffer(buffer);
			if (fileMeta && formidableFilter(mimetype ? (Array.isArray(mimetype) ? mimetype : [mimetype]) : undefined)) {
				// console.log("content - file", content);
				let destinationFolder = fileMeta.mime
					? fileMeta.mime.includes("image") || fileMeta.mime.includes("svg")
						? "images"
						: fileMeta.mime.split("/")[0].toLowerCase()
					: "others";
				if (!destinationFolder.endsWith("s")) destinationFolder = destinationFolder + "s";

				const fullDestinationFolder = path.join(
					this.rootDir,
					placeInPublic ? "global" : "auth",
					destinationFolder,
					relativeContainer ? (Array.isArray(relativeContainer) ? path.join(...relativeContainer) : relativeContainer) : "",
				);
				// lets check if dir exist, else create it
				if (!fs.existsSync(fullDestinationFolder)) {
					fs.mkdirSync(fullDestinationFolder, { recursive: true });
				}

				if (!fileName)
					fileName = (config.sitename ? config.sitename.split(" ").join("") + "-" : "") + Date.now().toString() + "." + fileMeta.ext;
				else if (!fileName.includes(".")) fileName = fileName + "." + fileMeta.ext;

				const isSvg = fileMeta.mime === "image/svg+xml" || fileName.toLowerCase().endsWith(".svg");
				// converts svg to png
				if (isSvg) fileName = fileName.replace(/\.svg$/, ".png");

				// move the file to file dir
				const filePath = path.join(fullDestinationFolder, fileName);
				fs.writeFileSync(filePath, buffer);

				return {
					filePath: filePath.split(this.cwd)[1], // relative to the storageManager storage locatio in env
					success: true,
					mimetype: Array.isArray(mimetype) ? mimetype[0] : mimetype,
				};
			}

			return {
				success: false,
				message: "No support file buffer found",
				mimetype: null,
				filePath: null,
			};
		} catch (error) {
			logger.error("Buffered file upload error:", error);
			return {
				success: false,
				message: "Errorred occurred",
				mimetype: null,
				filePath: null,
			};
		}
	}

	async deleteFile(filePath: string): Promise<{ success: boolean; message?: string }> {
		try {
			fs.unlink(path.join(this.rootDir, filePath), () => {});
			return { success: true };
		} catch (error) {
			logger.error("Error deleting file in LocalStorageService: ", error);
			return { success: false, message: "Error deleting file" };
		}
	}

	async listFiles({
		prefix,
		suffix,
		contains,
		filterToExt,
		excludeExt,
		relativeContainer,
		sortBy,
		sortOrder,
		recursive,
	}: {
		prefix?: string;
		suffix?: string;
		contains?: string;
		filterToExt?: string[];
		excludeExt?: string[];
		relativeContainer?: string;
		sortBy?: "name" | "size" | "modified" | "created";
		sortOrder?: "asc" | "desc";
		recursive?: boolean;
	}) {
		const dir = path.join(this.rootDir, relativeContainer ? relativeContainer : "");
		if (!fs.existsSync(dir)) return [];

		return await this.readDirectory(dir, {
			nameContains: contains,
			recursive: recursive,
			includeExtensions: filterToExt,
			excludeExtensions: excludeExt,
			namePrefix: prefix,
			nameSuffix: suffix,
			minSize: 0,
			maxSize: Infinity,
			sortBy: sortBy,
			sortOrder: sortOrder,
		});
	}

	/**
	 * Read all files in a directory with advanced filtering options
	 * @param {string} directoryPath - Path to the directory
	 * @param {Object} options - Filtering options
	 * @returns {Promise<Array>} Array of file objects
	 */
	private async readDirectory(
		directoryPath: string,
		options: {
			includeExtensions?: string[];
			excludeExtensions?: string[];
			namePrefix?: string; // filter by filename prefix
			nameSuffix?: string; // filter by filename suffix
			nameContains?: string; // filter by filename containing string
			minSize?: number; // minimum file size in bytes
			maxSize?: typeof Infinity | number; // maximum file size in bytes
			recursive?: boolean; // enable recursive search
			sortBy?: "name" | "size" | "modified" | "created";
			sortOrder?: "asc" | "desc";
		} = {},
	) {
		const {
			includeExtensions = null,
			excludeExtensions = null,
			namePrefix = null,
			nameSuffix = null,
			nameContains = null,
			minSize = 0,
			maxSize = Infinity,
			sortBy = "name",
			sortOrder = "asc",
			recursive,
		} = options;

		try {
			let files: {
				name: string;
				path: string;
				extension: string;
				size: number;
				modified: Date;
				created: Date;
			}[] = [];

			async function readDirectoryRecursive(
				directoryPath: string,
				fileList: {
					name: string;
					path: string;
					extension: string;
					size: number;
					modified: Date;
					created: Date;
				}[] = [],
			) {
				/* 
				const directory = path.join(__dirname, storage);
				if (!fs.existsSync(directory)) {
					fs.mkdirSync(directory, { recursive: true });
				}
		 */
				fs.readdir(directoryPath, { withFileTypes: true }, async (err, items) => {
					for (const item of items) {
						const fullPath = path.join(item.parentPath, item.name);
						const stat = fs.statSync(fullPath);

						if (stat.isDirectory()) {
							if (recursive) await readDirectoryRecursive(fullPath, fileList);
						} else {
							fileList.push({
								name: item.name,
								path: fullPath,
								extension: path.extname(item.name).toLowerCase(),
								size: stat.size,
								modified: stat.mtime,
								created: stat.birthtime,
							});
						}
					}
				});
				return fileList;
			}
			files = (await readDirectoryRecursive(directoryPath))!;
			// console.log("files", files);

			// Apply filters
			const filteredFiles = files.filter((file) => {
				// Filter by prefix
				if (namePrefix && !file.name.toLowerCase().startsWith(namePrefix.toLowerCase())) {
					return false;
				}

				// Filter by suffix
				if (nameSuffix && !file.name.toLowerCase().endsWith(nameSuffix.toLowerCase())) {
					return false;
				}

				// Filter by containing string
				if (nameContains && !file.name.toLowerCase().includes(nameContains.toLowerCase())) {
					return false;
				}

				// Filter by extensions
				if (includeExtensions && !includeExtensions.includes(file.extension)) {
					return false;
				}
				if (excludeExtensions && excludeExtensions.includes(file.extension)) {
					return false;
				}

				// Filter by size
				if (file.size < minSize || file.size > maxSize) {
					return false;
				}

				return true;
			});

			// Sort files
			filteredFiles.sort((a, b) => {
				let aValue, bValue;

				switch (sortBy) {
					case "size":
						aValue = a.size;
						bValue = b.size;
						break;
					case "modified":
						aValue = a.modified.getTime();
						bValue = b.modified.getTime();
						break;
					case "created":
						aValue = a.created.getTime();
						bValue = b.created.getTime();
						break;
					case "name":
					default:
						aValue = a.name.toLowerCase();
						bValue = b.name.toLowerCase();
				}

				if (sortOrder === "desc") {
					return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
				} else {
					return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
				}
			});

			return filteredFiles;
		} catch (error) {
			logger.error("Error in listing files in LocalStorageService: ", error);
			return [];
		}
	}

	readFileSync(filePath: string) {
		return fs.readFileSync(resolve(filePath));
	}
	async serveFile(
		filePath: string,
		options?: {
			returnAs?: "absolutePath" | "buffer";
			customHeaders?: Headers & object;
			chunkSize?: number; // 64KB default chunk size
			enableRangeRequests?: boolean;
			cacheControl?: string; // 1 hour cache
			largeFileThreshold?: boolean | number; // number is in KByte
		},
	): Promise<
		| fs.ReadStream
		| Buffer
		| string
		| { header: Headers; stream: fs.ReadStream }
		| {
				success: false;
				message?: string;
		  }
	> {
		const {
			returnAs,
			customHeaders = {},
			chunkSize = 64 * 1024, // 64KB default chunk size
			enableRangeRequests = true,
			cacheControl = "public, max-age=3600", // 1 hour cache,
			largeFileThreshold,
		} = options ? options : {};

		// console.log("filePath: ", filePath);
		// console.log("this.cwd: ", this.cwd);
		// console.log("this.rootDir: ", this.rootDir);
		if (!filePath.includes(this.rootDir)) // where file may not already be relative to storage root
		{
			// check if already relative to project root
			const projectRoot = this.rootDir.split(this.cwd);
			filePath = path.join(filePath.includes(projectRoot[1]) ? this.cwd : this.rootDir, filePath); // set the file full path
		}

		// console.log("filePath final: ", filePath);
		// when full path is simply just required
		if (returnAs === "absolutePath") return filePath;

		// Check if file exists
		if (!fs.existsSync(filePath)) {
			//return throwError(statusCodes.NOT_FOUND, "File not found");
			return { success: false, message: "File not found" };
		}
		// if exclusively required as buffer
		if (returnAs === "buffer") return this.readFileSync(filePath);

		const ext = path.extname(filePath).toLowerCase() as ".jpeg";
		const contentType = mimeTypes[ext] || "application/octet-stream";

		// Get file stats
		const stats = fs.statSync(filePath);

		const fileSize = stats.size;
		const isLargeFile =
			fileSize > (largeFileThreshold ? (typeof largeFileThreshold === "boolean" ? 1024 * 1024 : largeFileThreshold) : 1024 * 1024); // When threshold is unset, files > 1MB considered as large

		// Handle range requests for large files (enables seeking in videos/audio)
		if (enableRangeRequests && isLargeFile) {
			const headerRes = new Headers();
			// Set content headers
			headerRes.set("Content-Type", contentType);
			headerRes.set("Content-Length", stats.size.toString());
			headerRes.set("Cache-Control", cacheControl);
			// Set custom headers
			Object.entries(customHeaders).forEach(([key, value]) => {
				headerRes.set(key, value as string);
			});
			// set range bytes
			headerRes.set("Accept-Ranges", "bytes");

			const range = headerRes.get("range");
			if (range) {
				const parts = range.replace(/bytes=/, "").split("-");
				const start = parseInt(parts[0], 10);
				const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
				const chunksize = end - start + 1;

				// Set HTTP response headers
				headerRes.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
				headerRes.set("Accept-Ranges", "bytes");
				headerRes.set("Content-Length", chunksize.toString());

				return { header: headerRes, stream: fs.createReadStream(filePath, { start, end }) };
			}
		}

		// For small files, read directly
		if (!isLargeFile) {
			return this.readFileSync(filePath);
		} else {
			// For large files, use streaming with optimized chunk size
			const optimizedChunkSize = Math.min(chunkSize, fileSize);
			return fs.createReadStream(filePath, {
				highWaterMark: optimizedChunkSize,
			});
		}
	}

	/**
	 * Intelligently serve any file with optimized streaming for large files
	 * @param {string} filePath - Path to the file
	 * @param {http.ServerResponse} res - HTTP response object
	 * @param {Object} options - Streaming options
	 * @returns {Promise<void>}
	 */
	async ctxServeFile({
		ctx,
		filePath,
		options = {},
		largeFileThreshold,
	}: {
		ctx: ParameterizedContext;
		options?: {
			chunkSize?: number; // 64KB default chunk size
			enableRangeRequests?: boolean;
			cacheControl?: string; // 1 hour cache
			customHeaders?: object;
		};
		filePath: string;
		largeFileThreshold?: boolean | number; // number is in KByte
	}): Promise<fs.ReadStream | Buffer | { header: Headers; stream: fs.ReadStream } | Error | void> {
		filePath = path.join(this.cwd, filePath); // set the relative root

		const {
			chunkSize = 64 * 1024, // 64KB default chunk size
			enableRangeRequests = true,
			cacheControl = "public, max-age=3600", // 1 hour cache
			customHeaders = {},
		} = options;

		return new Promise((resolve, reject) => {
			// Check if file exists
			if (!fs.existsSync(filePath)) {
				return reject(throwError(statusCodes.NOT_FOUND, "File not found"));
			}

			const ext = path.extname(filePath).toLowerCase() as ".jpeg";
			const contentType = mimeTypes[ext] || "application/octet-stream";

			// Get file stats
			const stats = fs.statSync(filePath);

			// Set content headers
			ctx.header["Content-Type"] = contentType;
			ctx.header["Content-Length"] = stats.size.toString();
			ctx.header["Cache-Control"] = cacheControl;

			// Set custom headers
			Object.entries(customHeaders).forEach(([key, value]) => {
				ctx.header[key] = value;
			});

			const fileSize = stats.size;
			const isLargeFile =
				fileSize > (largeFileThreshold ? (typeof largeFileThreshold === "boolean" ? 1024 * 1024 : largeFileThreshold) : 1024 * 1024); // When threshold is unset, files > 1MB considered as large

			// Handle range requests for large files (enables seeking in videos/audio)
			if (enableRangeRequests && isLargeFile) {
				ctx.header["Accept-Ranges"] = "bytes";

				const { range } = ctx.headers;
				if (range) {
					const parts = range.replace(/bytes=/, "").split("-");
					const start = parseInt(parts[0], 10);
					const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
					const chunksize = end - start + 1;

					// Set HTTP response headers
					ctx.response.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
					ctx.response.set("Accept-Ranges", "bytes");
					ctx.response.set("Content-Length", chunksize.toString());

					const fileStream = fs.createReadStream(filePath, { start, end });

					ctx.response.status = 206;
					ctx.response.type = ext;
					ctx.response.body = fileStream;

					fileStream.on("end", resolve);
					fileStream.on("error", reject);
					return;
				}
			}

			// For small files, read directly
			if (!isLargeFile) {
				return fs.readFileSync(filePath);
			} else {
				// For large files, use streaming with optimized chunk size
				const optimizedChunkSize = Math.min(chunkSize, fileSize);
				return fs.createReadStream(filePath, {
					highWaterMark: optimizedChunkSize,
				});
			}
		});
	}
}

class AzureStorageService {
	private storageAccountName: string;
	private containerName: string;
	private credential: ClientSecretCredential | DefaultAzureCredential;
	private blobServiceClient: BlobServiceClient;
	private cwd = process.cwd();
	private rootDir: string;
	private event;

	constructor(relativeToProjectRootContainer?: string | string[]) {
		this.event = new EventEmitter();
		this.storageAccountName = (dataPath as azureObject).STORAGE_ACCOUNT_NAME;
		this.containerName = (dataPath as azureObject).CONTAINER_NAME;
		this.credential = this.getCredential();
		this.blobServiceClient = this.createBlobServiceClient();

		this.rootDir = this.virtualDirectory(
			"site",
			relativeToProjectRootContainer
				? typeof relativeToProjectRootContainer === "string"
					? relativeToProjectRootContainer
					: relativeToProjectRootContainer.join("/")
				: "storage",
		); // neccessary for upload destinations. Note that "/site/files/" directory is auto managed internally by greybox. Hence we are enforcing a new holding directory to handle the needed scenario here so Greybox can ignire the files
	}

	private getCredential() {
		// Method 1: Using Client Secret (for service principals)
		if ((dataPath as azureObject).AZURE_CLIENT_SECRET) {
			return new ClientSecretCredential(
				(dataPath as azureObject).AZURE_TENANT_ID,
				(dataPath as azureObject).AZURE_CLIENT_ID,
				(dataPath as azureObject).AZURE_CLIENT_SECRET,
			);
		}

		// Method 2: Alternative using DefaultAzureCredential (for managed identities/local development)
		return new DefaultAzureCredential();
	}

	private createBlobServiceClient() {
		const blobServiceUrl = `https://${this.storageAccountName}.blob.core.windows.net`;
		return new BlobServiceClient(blobServiceUrl, this.credential);
	}

	private virtualDirectory(...arg: string[]) {
		let indexIncluded = false;
		return arg
			.map((str) => {
				const output = str ? (!indexIncluded ? str : "/" + str) : "";
				if (str && !indexIncluded) indexIncluded = true;
				return output;
			})
			.join("");
	}

	async testConnectivity(): Promise<boolean> {
		try {
			const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
			if (containerClient instanceof ContainerClient) return true;
			else return false;
		} catch (err) {
			logger.error("Error initiating connection to Azure: ", err);
			return false;
		}
	}

	on(
		eventName: "error" | "completed" | "pending",
		listener: (data?: { filePath?: string; requestId?: string; etag?: string; status: "pending" | "completed" | "error" }) => void,
	) {
		this.event.on(eventName, listener);
	}

	async uploadMedia({
		disableFileNameRewrite,
		mediaPath,
		files = appInstance?.currentContext?.request.files,
		relativeContainer,
	}: {
		mediaPath: "public" | "private";
		// convertTo?: keyof typeof imageMimeTypes;
		disableFileNameRewrite?: boolean;
		files?: AppContext["request"]["files"];
		relativeContainer?: string | string[];
	}): Promise<{
		success: boolean;
		files: {
			[file: string]: {
				filePath: string;
				requestId: string;
				etag?: string;
				status: "pending" | "completed" | "error";
			}[];
		} | null;
		message?: string | null;
	}> {
		if (!files || Object.keys(files).length === 0)
			return {
				success: false,
				files: null,
				message: "No uploadable file found!",
			};

		//mandatorily send files to private DIR if on the autoPrivatePath array
		const autoPrivatePaths = ["account", "auth"];
		//check if relativeContainer contains label string that may require to force as private
		let placeInPublic = mediaPath === "public" ? true : false;
		const likelyForceablyPrivatePath =
			relativeContainer && relativeContainer.length ? (Array.isArray(relativeContainer) ? relativeContainer : [relativeContainer]) : [];

		if (placeInPublic && likelyForceablyPrivatePath.length) {
			for (let i = 0; i < autoPrivatePaths.length; i++) {
				if (likelyForceablyPrivatePath.includes(autoPrivatePaths[i])) {
					placeInPublic = false;
					break;
				}
			}
		}

		const mediaDumpDirFromFormidable: string[] = [];
		const bodyFiles: {
			[file: string]: {
				filePath: string;
				requestId: string;
				etag?: string;
				status: "pending" | "completed" | "error";
			}[];
		} = {};

		try {
			const containerClient = this.blobServiceClient.getContainerClient(this.containerName);

			// Create container if it doesn't exist
			await containerClient.createIfNotExists();

			for (const file of Object.keys(files!)) {
				const fileContents = Array.isArray(files![file]) ? files![file] : [files![file]];
				// lets reserve all processed new path here
				const filePaths: {
					filePath: string;
					requestId: string;
					etag?: string;
					status: "pending" | "completed" | "error";
				}[] = [];

				for (const content of fileContents) {
					let destinationFolder = content.mimetype
						? content.mimetype.includes("image") || content.mimetype.includes("svg")
							? "image"
							: content.mimetype.split("/")[0].toLowerCase()
						: "other";
					if (!destinationFolder.endsWith("s")) destinationFolder = destinationFolder + "s";

					//set media Directory
					const containerDirectry = this.virtualDirectory(
						this.rootDir,
						placeInPublic ? "global" : "auth",
						destinationFolder,
						relativeContainer ? (Array.isArray(relativeContainer) ? relativeContainer.join("/") : relativeContainer) : "",
					);
					// console.log("containerDirectry", containerDirectry);

					let fileName =
						disableFileNameRewrite && content.originalFilename
							? content.originalFilename.replace(/[^a-zA-Z0-9.]/g, "-") // Revert renaming that would have been done in requestParser, and we also strip special characters that may exist on original name
							: content.newFilename;

					const isSvg = content.mimetype === "image/svg+xml" || fileName.endsWith(".svg");
					if (isSvg) fileName = fileName.replace(/\.svg$/, ".png"); // if svg reaches here, lets ensure to track the proper name since sharp would auto-convert this to png

					const newPath = this.virtualDirectory(containerDirectry, fileName);

					// set azure directory + file name
					const blockBlobClient = containerClient.getBlockBlobClient(newPath);

					const currentPath = content.filepath;
					const moveNonImageFile = async () => {
						//console.log("currentPath", currentPath);
						//console.log("newPath", newPath);
						try {
							const buffer = fs.readFileSync(currentPath);
							const uploadResponse = await blockBlobClient.uploadData(buffer, {
								blobHTTPHeaders: { blobContentType: !isSvg ? content.mimetype || "application/octet-stream" : imageMimeTypes[".png"] },
							});

							filePaths.push({
								filePath: newPath,
								requestId: uploadResponse.requestId || content.originalFilename!,
								etag: uploadResponse.etag,
								status: uploadResponse.errorCode ? "error" : "completed",
							});
							// track redundant local version
							mediaDumpDirFromFormidable.push(currentPath);
						} catch (err) {
							// track redundant error on local version
							mediaDumpDirFromFormidable.push(currentPath);
							return err;
						}
					};

					const mediaIsImage = content.mimetype && imageMimeTypes[reverseMimetypesToExt(content.mimetype) as ".jpg"];

					if (!mediaIsImage) await moveNonImageFile();
					else {
						const buffer = await sharp(currentPath)
							// .toFormat("png")
							.toBuffer(); // svg is auto-converted to png internally by sharp
						const uploadResponse = await blockBlobClient.uploadData(buffer, {
							blobHTTPHeaders: { blobContentType: content.mimetype || "application/octet-stream" },
						});

						filePaths.push({
							filePath: newPath,
							requestId: uploadResponse.requestId || content.originalFilename!,
							etag: uploadResponse.etag,
							status: uploadResponse.errorCode ? "error" : "completed",
						});
						// track redundant local version for later deletion
						mediaDumpDirFromFormidable.push(currentPath);
					}
				}
				// console.log("filePaths", filePaths);

				bodyFiles[file] = filePaths;
			}
			// clear local dumps
			if (mediaDumpDirFromFormidable.length > 0) {
				try {
					mediaDumpDirFromFormidable.map((media) => {
						return fs.unlink(media, () => {});
					});
				} catch (err) {
					/* Prevent error from leaking on unlink failure */
					logger.error("Issue removing redundant media files in storageManager function: ", err);
				}
			}

			return {
				success: true,
				files: bodyFiles,
			};
		} catch (error) {
			logger.error("Azure File upload processing error:", error);
			return {
				success: false,
				files: null,
				message: "Error occurred",
			};
		}
	}

	async uploadFileFromRequestStream({
		ctx = appInstance?.currentContext,
		disableFileNameRewrite,
		mediaPath,
		mimetypes,
		relativeContainer,
	}: {
		disableFileNameRewrite?: boolean;
		ctx?: typeof appInstance.currentContext;
		mediaPath: "public" | "private";
		mimetypes?: string[];
		relativeContainer?: string | string[];
	}): Promise<{
		success: boolean;
		files: {
			[file: string]: {
				filePath: string;
				requestId: string;
				etag?: string;
				status: "pending" | "completed" | "error";
			}[];
		} | null;
		message?: string | null;
	}> {
		if (!ctx)
			return {
				success: false,
				files: null,
				message: "No App context defined",
			};

		try {
			//mandatorily send files to private DIR if on the autoPrivatePath array
			const autoPrivatePaths = ["account", "auth"];
			//check if relativeContainer contains label string that may require to force as private
			let placeInPublic = mediaPath === "public" ? true : false;
			const likelyForceablyPrivatePath =
				relativeContainer && relativeContainer.length ? (Array.isArray(relativeContainer) ? relativeContainer : [relativeContainer]) : [];

			if (placeInPublic && likelyForceablyPrivatePath.length) {
				for (let i = 0; i < autoPrivatePaths.length; i++) {
					if (likelyForceablyPrivatePath.includes(autoPrivatePaths[i])) {
						placeInPublic = false;
						break;
					}
				}
			}

			const method = ctx.method.toLowerCase();
			if (method === "post" || method === "patch") {
				const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
				// Create container if it doesn't exist
				await containerClient.createIfNotExists();

				// set "this" values needed in formidable
				const virtualDirectory = this.virtualDirectory;
				const rootDir = this.rootDir;
				let newPath: string;
				// output
				const bodyFiles: {
					[file: string]: {
						filePath: string;
						requestId: string;
						etag?: string;
						status: "pending" | "completed" | "error";
					}[];
				} = {};

				const fileToFieldMap = new Map(); // Custom map to keep track of which file belongs to which field
				const uploadPromises: Promise<void>[] = []; // we want to track progress when its fully resolved

				// build formidable
				const form = formidable({
					multiples: true,
					filter: formidableFilter(mimetypes),
					// keepExtensions: true,
					filename: (name, ext, part) => {
						// lets extract ext where it does not exist from mimetype, keeping in mind that this might sometimes list multiple. We simple pick the first
						if (!ext && part.mimetype) {
							ext = part.mimetype.includes(",") ? reverseMimetypesToExt(part.mimetype.split(",")[0]) : reverseMimetypesToExt(part.mimetype);
						}
						return (
							(disableFileNameRewrite
								? name.replace(/[^a-zA-Z0-9 ]/g, "-") // lets strip special characters that may exist
								: (config.sitename ? config.sitename.split(" ").join("") + "-" : "") + part.name + "-" + Date.now().toString()) + ext
						);
					},
					fileWriteStreamHandler(file?: VolatileFile | undefined) {
						if (!file) throw new Error("No file stream found");
						// file name should now be value set in formidable
						let fileName = file["newFilename" as keyof typeof file]?.toString() as string;
						const isSvg =
							(file["mimetype" as keyof typeof file] as unknown as string) === "image/svg+xml" ||
							(file["originalFilename" as keyof typeof file] as unknown as string)?.toLowerCase().endsWith(".svg");
						// converts svg to png
						if (isSvg) fileName = fileName.replace(/\.svg$/, ".png");

						// lets set directory structures
						let destinationFolder = file["mimetype" as keyof typeof file]
							? (file["mimetype" as keyof typeof file] as unknown as string).includes("image") || isSvg
								? "images"
								: (file["mimetype" as keyof typeof file] as unknown as string).split("/")[0].toLowerCase()
							: "others";

						if (!destinationFolder.endsWith("s")) destinationFolder = destinationFolder + "s";
						//set media Directory
						const containerDirectry = virtualDirectory(
							rootDir,
							placeInPublic ? "global" : "auth",
							destinationFolder,
							relativeContainer ? (Array.isArray(relativeContainer) ? relativeContainer.join("/") : relativeContainer) : "",
						);

						newPath = virtualDirectory(containerDirectry, fileName);
						// set azure directory + file name
						const blockBlobClient = containerClient.getBlockBlobClient(newPath);

						// create writable stream
						const passThrough = new PassThrough();

						// Pipe stream to Azure storage
						const uploadResponse = blockBlobClient
							.uploadStream(passThrough, undefined, undefined, {
								blobHTTPHeaders: {
									blobContentType: isSvg
										? "image/png"
										: (file["mimetype" as keyof typeof file] as unknown as string) || "application/octet-stream",
								},
							})
							.then((res) => {
								// Find the field name using the map
								const fieldName = fileToFieldMap.get(file) || "unknown";

								if (!bodyFiles[fieldName])
									bodyFiles[fieldName] = [
										{
											filePath: newPath!,
											requestId: res.requestId!,
											etag: res.etag!,
											status: res.errorCode ? "error" : "completed",
										},
									];
								else
									bodyFiles[fieldName].push({
										filePath: newPath!,
										requestId: res.requestId!,
										etag: res.etag!,
										status: res.errorCode ? "error" : "completed",
									});
							})
							.catch((err) => {
								// console.error(`❌ Azure upload error for ${fileName}:`, err);
								// Optionally emit error to Formidable
								form.emit("data", err);
							});
						uploadPromises.push(uploadResponse); // 📌 Track the upload

						// If it's SVG, convert using sharp
						if (isSvg) {
							const svgToPng = sharp().png();
							svgToPng.pipe(passThrough); // Pipe converted PNG to Azure
							return svgToPng; // This becomes the write stream for Formidable
						}
						// For non-SVG files, pipe directly to Azure
						return passThrough;
					},
				});

				try {
					form.onPart = function (part) {
						// let formidable handle only file parts
						if (part.originalFilename || part.mimetype) form._handlePart(part);
					};
					form.on("fileBegin", (formName, file) => {
						// set the file name
						fileToFieldMap.set(file, formName);
					});

					// upload handled by Stream and file metadata  here ignored
					await form.parse(ctx.req);
					// lets ensure blob is fully resolved so we can get response data for streamProps
					await Promise.all(uploadPromises);

					// console.log("bodyFiles", bodyFiles);
					const uploadableFileExists = Object.keys(bodyFiles).length;
					return {
						success: uploadableFileExists ? true : false,
						files: uploadableFileExists ? bodyFiles : null,
						message: !uploadableFileExists ? "No supported file found" : null,
					};
				} catch (err: unknown) {
					logger.error("Stream piping to azure error: ", err);
					return {
						success: false,
						files: null,
						message: "Errorred occurred",
					};
				}
			}

			return {
				success: false,
				files: null,
				message: "No acceptable method defined",
			};
		} catch (error) {
			logger.error("Stream file upload error:", error);
			return {
				success: false,
				files: null,
				message: "Errorred occurred",
			};
		}
	}

	async uploadFileFromBuffer({
		buffer,
		fileName,
		mediaPath,
		mimetypes,
		relativeContainer,
	}: {
		buffer: Buffer;
		fileName?: string;
		mediaPath: "public" | "private";
		mimetypes?: string[];
		relativeContainer?: string | string[];
	}): Promise<{
		success: boolean;
		filePath?: string | null;
		message?: string | null;
		requestId?: string;
		etag?: string;
	}> {
		if (!buffer)
			return {
				success: false,
				message: "No bufferred file defined",
			};

		try {
			//mandatorily send files to private DIR if on the autoPrivatePath array
			const autoPrivatePaths = ["account", "auth"];
			//check if relativeContainer contains label string that may require to force as private
			let placeInPublic = mediaPath === "public" ? true : false;
			const likelyForceablyPrivatePath =
				relativeContainer && relativeContainer.length ? (Array.isArray(relativeContainer) ? relativeContainer : [relativeContainer]) : [];

			if (placeInPublic && likelyForceablyPrivatePath.length) {
				for (let i = 0; i < autoPrivatePaths.length; i++) {
					if (likelyForceablyPrivatePath.includes(autoPrivatePaths[i])) {
						placeInPublic = false;
						break;
					}
				}
			}

			// detect if its valid file type
			const fileMeta = await fileTypeFromBuffer(buffer);
			if (fileMeta && formidableFilter(mimetypes)) {
				const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
				// Create container if it doesn't exist
				await containerClient.createIfNotExists();

				// lets set directory structures
				let destinationFolder = fileMeta.mime
					? fileMeta.mime.includes("image") || fileMeta.mime.includes("svg")
						? "images"
						: fileMeta.mime.split("/")[0].toLowerCase()
					: "others";
				if (!destinationFolder.endsWith("s")) destinationFolder = destinationFolder + "s";

				//set media Directory
				const containerDirectry = this.virtualDirectory(
					this.rootDir,
					placeInPublic ? "global" : "auth",
					destinationFolder,
					relativeContainer ? (Array.isArray(relativeContainer) ? relativeContainer.join("/") : relativeContainer) : "",
				);

				if (!fileName)
					fileName = (config.sitename ? config.sitename.split(" ").join("") + "-" : "") + Date.now().toString() + "." + fileMeta.ext;
				else if (!fileName.includes(".")) fileName = fileName + "." + fileMeta.ext;

				const isSvg = fileMeta.mime === "image/svg+xml" || fileName.toLowerCase().endsWith(".svg");
				// converts svg to png
				if (isSvg) fileName = fileName.replace(/\.svg$/, ".png");

				const filePath = this.virtualDirectory(containerDirectry, fileName);
				// set azure directory + file name
				const blockBlobClient = containerClient.getBlockBlobClient(filePath);

				if (isSvg) buffer = await sharp(buffer).toBuffer(); // svg is auto-converted to png internally by sharp
				const uploadResponse = await blockBlobClient.uploadData(buffer, {
					blobHTTPHeaders: { blobContentType: !isSvg ? fileMeta.mime || "application/octet-stream" : imageMimeTypes[".png"] },
				});

				return {
					filePath: filePath,
					requestId: uploadResponse.requestId,
					etag: uploadResponse.etag,
					success: true,
				};
			}

			return {
				success: false,
				message: "No support file buffer found",
			};
		} catch (error) {
			logger.error("Buffered file upload error:", error);
			return {
				success: false,
				message: "Errorred occurred",
			};
		}
	}

	async deleteFile(filePath: string): Promise<{ success: boolean; message?: string }> {
		try {
			const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
			const blockBlobClient = containerClient.getBlockBlobClient(filePath);

			await blockBlobClient.delete();
			return { success: true };
		} catch (error) {
			logger.error("Error deleting file in AzureStorageService: ", error);
			return { success: false, message: "Error deleting file" };
		}
	}

	async listFiles({
		prefix,
		suffix,
		contains,
		filterToExt,
		excludeExt,
		relativeContainer,
		sortBy,
		sortOrder,
		recursive,
	}: {
		prefix?: string;
		suffix?: string;
		contains?: string;
		filterToExt?: string[];
		excludeExt?: string[];
		relativeContainer?: string;
		sortBy?: "name" | "size" | "modified" | "created";
		sortOrder?: "asc" | "desc";
		recursive?: boolean;
	}) {
		const dir = path.join(this.rootDir, relativeContainer ? relativeContainer : "");
		if (!fs.existsSync(dir)) return [];

		return await this.readDirectory(dir, {
			nameContains: contains,
			recursive: recursive,
			includeExtensions: filterToExt,
			excludeExtensions: excludeExt,
			namePrefix: prefix,
			nameSuffix: suffix,
			minSize: 0,
			maxSize: Infinity,
			sortBy: sortBy,
			sortOrder: sortOrder,
		});
	}

	private async readDirectory(
		directoryPath: string,
		options: {
			includeExtensions?: string[];
			excludeExtensions?: string[];
			namePrefix?: string; // filter by filename prefix
			nameSuffix?: string; // filter by filename suffix
			nameContains?: string; // filter by filename containing string
			minSize?: number; // minimum file size in bytes
			maxSize?: typeof Infinity | number; // maximum file size in bytes
			recursive?: boolean; // enable recursive search
			sortBy?: "name" | "size" | "modified" | "created";
			sortOrder?: "asc" | "desc";
		} = {},
	) {
		const {
			includeExtensions = undefined,
			excludeExtensions = undefined,
			namePrefix = undefined,
			nameSuffix = undefined,
			nameContains = undefined,
			minSize = 0,
			maxSize = Infinity,
			sortBy = "name",
			sortOrder = "asc",
			// recursive,
		} = options;

		try {
			const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
			const blobs: {
				name: string;
				path: string;
				extension: string;
				size: number;
				modified: Date;
				created: Date;
			}[] = [];

			for await (const blob of containerClient.listBlobsFlat({ prefix: namePrefix })) {
				console.log("Blob RES::: ", blob);
				blobs.push({
					name: blob.name,
					path: `${containerClient.url}/${blob.name}`,
					extension: blob.properties.contentType!,
					size: Number(blob.metadata!["size"]),
					modified: blob.properties.lastModified,
					created: blob.properties.createdOn!,
				});
			}

			// Apply filters
			const filteredFiles = blobs.filter((file) => {
				// Filter by prefix
				if (namePrefix && !file.name.toLowerCase().startsWith(namePrefix.toLowerCase())) {
					return false;
				}

				// Filter by suffix
				if (nameSuffix && !file.name.toLowerCase().endsWith(nameSuffix.toLowerCase())) {
					return false;
				}

				// Filter by containing string
				if (nameContains && !file.name.toLowerCase().includes(nameContains.toLowerCase())) {
					return false;
				}

				// Filter by extensions
				if (includeExtensions && !includeExtensions.includes(file.extension)) {
					return false;
				}
				if (excludeExtensions && excludeExtensions.includes(file.extension)) {
					return false;
				}

				// Filter by size
				if (file.size && (file.size < minSize || file.size > maxSize)) {
					return false;
				}

				return true;
			});

			// Sort files
			filteredFiles.sort((a, b) => {
				let aValue: number | string, bValue: number | string;

				switch (sortBy) {
					case "size":
						aValue = a.size;
						bValue = b.size;
						break;
					case "modified":
						aValue = a.modified.getTime();
						bValue = b.modified.getTime();
						break;
					case "created":
						aValue = a.created.getTime();
						bValue = b.created.getTime();
						break;
					case "name":
					default:
						aValue = a.name.toLowerCase();
						bValue = b.name.toLowerCase();
				}

				// if (aValue && bValue) {
				if (sortOrder === "desc") {
					return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
				} else {
					return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
				}
				// }
			});

			return filteredFiles;
		} catch (error) {
			logger.error("Error in listing files in AzureStorageService: ", error);
			return [];
		}
	}

	async serveFile(
		filePath: string,
		options?: {
			customHeaders?: Headers & object;
			chunkSize?: number; // 64KB default chunk size
			enableRangeRequests?: boolean;
			cacheControl?: string; // 1 hour cache
			largeFileThreshold?: boolean | number; // number is in KByte
		},
	): Promise<
		| fs.ReadStream
		| Buffer
		| { header: Headers; stream: fs.ReadStream }
		| {
				success: false;
				message?: string;
		  }
	> {
		// retrieve container
		const containerClient = this.blobServiceClient.getContainerClient(this.containerName);

		for await (const blob of containerClient.listBlobsFlat()) {
			console.log("Blob RES::: ", blob);

			const blobClient = containerClient.getBlockBlobClient(blob.name);
			console.log("blobClient RES::: ", blobClient);
		}

		const {
			customHeaders = {},
			chunkSize = 64 * 1024, // 64KB default chunk size
			enableRangeRequests = true,
			cacheControl = "public, max-age=3600", // 1 hour cache,
			largeFileThreshold,
		} = options ? options : {};

		const ext = path.extname(filePath).toLowerCase() as ".jpeg";
		const contentType = mimeTypes[ext] || "application/octet-stream";

		// Get file stats
		const stats = fs.statSync(filePath);

		const fileSize = stats.size;
		const isLargeFile =
			fileSize > (largeFileThreshold ? (typeof largeFileThreshold === "boolean" ? 1024 * 1024 : largeFileThreshold) : 1024 * 1024); // When threshold is unset, files > 1MB considered as large

		// Handle range requests for large files (enables seeking in videos/audio)
		if (enableRangeRequests && isLargeFile) {
			const headerRes = new Headers();
			// Set content headers
			headerRes.set("Content-Type", contentType);
			headerRes.set("Content-Length", stats.size.toString());
			headerRes.set("Cache-Control", cacheControl);
			// Set custom headers
			Object.entries(customHeaders).forEach(([key, value]) => {
				headerRes.set(key, value as string);
			});
			// set range bytes
			headerRes.set("Accept-Ranges", "bytes");

			const range = headerRes.get("range");
			if (range) {
				const parts = range.replace(/bytes=/, "").split("-");
				const start = parseInt(parts[0], 10);
				const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
				const chunksize = end - start + 1;

				// Set HTTP response headers
				headerRes.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
				headerRes.set("Accept-Ranges", "bytes");
				headerRes.set("Content-Length", chunksize.toString());

				return { header: headerRes, stream: fs.createReadStream(filePath, { start, end }) };
			}
		}

		// For small files, read directly
		if (!isLargeFile) {
			return fs.readFileSync(filePath);
		} else {
			// For large files, use streaming with optimized chunk size
			const optimizedChunkSize = Math.min(chunkSize, fileSize);
			return fs.createReadStream(filePath, {
				highWaterMark: optimizedChunkSize,
			});
		}
	}

	/**
	 * Intelligently serve any file with optimized streaming for large files
	 * @param {string} filePath - Path to the file
	 * @param {http.ServerResponse} res - HTTP response object
	 * @param {Object} options - Streaming options
	 * @returns {Promise<void>}
	 */
	async ctxServeFile({
		ctx,
		filePath,
		options = {},
		largeFileThreshold,
	}: {
		ctx: ParameterizedContext;
		options?: {
			chunkSize?: number; // 64KB default chunk size
			enableRangeRequests?: boolean;
			cacheControl?: string; // 1 hour cache
			customHeaders?: object;
		};
		filePath: string;
		largeFileThreshold?: boolean | number; // number is in KByte
	}): Promise<fs.ReadStream | Buffer | { header: Headers; stream: fs.ReadStream } | Error | void> {
		filePath = path.join(this.cwd, filePath); // set the relative root

		const {
			chunkSize = 64 * 1024, // 64KB default chunk size
			enableRangeRequests = true,
			cacheControl = "public, max-age=3600", // 1 hour cache
			customHeaders = {},
		} = options;

		return new Promise((resolve, reject) => {
			// Check if file exists
			if (!fs.existsSync(filePath)) {
				return reject(throwError(statusCodes.NOT_FOUND, "File not found"));
			}

			const ext = path.extname(filePath).toLowerCase() as ".jpeg";
			const contentType = mimeTypes[ext] || "application/octet-stream";

			// Get file stats
			const stats = fs.statSync(filePath);

			// Set content headers
			ctx.header["Content-Type"] = contentType;
			ctx.header["Content-Length"] = stats.size.toString();
			ctx.header["Cache-Control"] = cacheControl;

			// Set custom headers
			Object.entries(customHeaders).forEach(([key, value]) => {
				ctx.header[key] = value;
			});

			const fileSize = stats.size;
			const isLargeFile =
				fileSize > (largeFileThreshold ? (typeof largeFileThreshold === "boolean" ? 1024 * 1024 : largeFileThreshold) : 1024 * 1024); // When threshold is unset, files > 1MB considered as large

			// Handle range requests for large files (enables seeking in videos/audio)
			if (enableRangeRequests && isLargeFile) {
				ctx.header["Accept-Ranges"] = "bytes";

				const { range } = ctx.headers;
				if (range) {
					const parts = range.replace(/bytes=/, "").split("-");
					const start = parseInt(parts[0], 10);
					const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
					const chunksize = end - start + 1;

					// Set HTTP response headers
					ctx.response.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
					ctx.response.set("Accept-Ranges", "bytes");
					ctx.response.set("Content-Length", chunksize.toString());

					const fileStream = fs.createReadStream(filePath, { start, end });

					ctx.response.status = 206;
					ctx.response.type = ext;
					ctx.response.body = fileStream;

					fileStream.on("end", resolve);
					fileStream.on("error", reject);
					return;
				}
			}

			// For small files, read directly
			if (!isLargeFile) {
				return fs.readFileSync(filePath);
			} else {
				// For large files, use streaming with optimized chunk size
				const optimizedChunkSize = Math.min(chunkSize, fileSize);
				return fs.createReadStream(filePath, {
					highWaterMark: optimizedChunkSize,
				});
			}
		});
	}
}

export const storageConnector = envMediaStorage === "azure" ? AzureStorageService : LocalStorageService;
