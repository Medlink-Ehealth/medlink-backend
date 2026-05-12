import fs, { PathLike } from "node:fs";
import process from "node:process";
import sharp from "sharp";
import { imageSizes } from "../../config/imageSizes.config.js";
import { logger } from "../../utils/logger.js";
import { ParameterizedContext, Next, DefaultContext } from "koa";
import { INTERNAL_SERVER_ERROR, NOT_ACCEPTABLE } from "../../constants/statusCodes.js";
import path from "node:path";

type JsonValue = JsonObject;
type JsonObject = {
	[key: string]: JsonValue;
};
interface extendedParameterizedContext extends ParameterizedContext {
	request: DefaultContext["request"] & {
		body?: JsonValue;
		files?: [string, File]; // [formidable.Fields<string>, formidable.Files<string>]
		rawBody?: unknown;
	};
	// sequelizeInstance: Sequelize;
}

//const __dirname = path.dirname("./");
//Note: Due to the limitations of WebAssembly, ffmpeg.wasm cannot handle input files over 2GB in size of video files.

/** @deprecated */
export const MediaUiUpload = async (ctx: extendedParameterizedContext, next: Next) => {
	try {
		const promises: Promise<unknown>[] = [];
		let imageStyles = {};
		//let mediaDumpDirFromFormidable = [];

		if (ctx.request.files && Object.keys(ctx.request.files).length > 0) {
			//mandatorily send files to private DIR if on the autoPrivatePath array
			//useful for account avatar/pictures
			const autoPrivatePaths = ["account" /*  "admin", "auth" */];
			//check if 'media as public' declaration exists in ctx.state
			let placeInPublic: boolean;
			if (ctx.state.mediaPath === "public") {
				placeInPublic = true;
				for (let i = 0; i < autoPrivatePaths.length; i++) {
					if (ctx.path.includes("/" + autoPrivatePaths[i] + "/")) {
						placeInPublic = false;
						break;
					}
				}
			}

			//construct functions to process data
			Object.keys(ctx.request.files).forEach((file) => {
				const files = ctx.request.files;
				const mediaType = files[file].mimetype.includes("image") ? "image" : files[file].mimetype.includes("video") ? "video" : null;
				const destinationFolder = mediaType === "image" ? "images" : mediaType === "video" ? "videos" : null;

				//set media Directory
				if (destinationFolder) {
					const folderPermission = !placeInPublic ? "privatePath" : "globalPath";
					const newPath = path.join(
						process.env[folderPermission]!,
						destinationFolder,
						mediaType === "video" ? files[file].newFilename : files[file].newFilename.split(".")[0] + ".webp",
					); //convert all images to webp format

					const promiseCall = () =>
						new Promise(function (resolve) {
							const currentPath = files[file].filepath;
							const moveVideoFile = () => {
								//console.log("currentPath", currentPath);
								//console.log("newPath", newPath);
								try {
									fs.renameSync(currentPath, newPath);
									files[file].filepath = newPath;
								} catch (err) {
									try {
										fs.unlinkSync(currentPath);
										return err;
									} catch (err) {
										return err;
									}
								}
							};
							resolve(
								mediaType === "video"
									? moveVideoFile()
									: sharp(currentPath)
											.toFile(newPath)
											.then(async () => {
												//console.log("done original!", res);
												//flush original file
												//fs.unlinkSync(currentPath);
												//insert new path as filepath for server use
												files[file].filepath = newPath;
												//console.log("get file name:", file);
											})
											.catch((err) => {
												//console.error("lets clean original", err);
												try {
													fs.unlinkSync(newPath);
													fs.unlinkSync(currentPath);
													return err;
												} catch (err) {
													return err;
												}
											}),
							);
						});
					promises.push(promiseCall());

					//addOn styles per image
					if (mediaType === "image")
						imageSizes.forEach((style) => {
							const thisPath = newPath.split(".webp")[0] + style.pathSuffix;
							const promiseCall = () =>
								new Promise(function (resolve) {
									resolve(
										sharp(files[file].filepath)
											.resize(style.size)
											.toFile(thisPath)
											.then(() => {
												//console.log("done addOn! " + thisPath, res);
												imageStyles = {
													...imageStyles,
													[style.name]: thisPath,
												};
											})
											.catch(() => {
												//console.error("lets clean this up", err);
												try {
													fs.unlinkSync(thisPath);
													return null;
												} catch (err) {
													logger.error("mediaImageUpload middleware error: ", err);
													return null;
												}
											}),
									);
								});
							promises.push(promiseCall());
						});
				}
			});

			if (promises.length > 0) {
				await Promise.all(promises).then(() => {
					return;
					//Images are now initially uploaded to temp directory which should be cleared on cron run. Hence unlinking original file is now unnecessary in V.2 implementation.
					//Note: one good reason for ignoring unlinking of original file is because SHarp library fails (bug) to unlock webp files after using on windows server. This throws continuous error for fs.unlinkSync(media)
					/* mediaDumpDirFromFormidable.map((media) => {
            return fs.unlinkSync(media);
          }); */
				});
				//console.log("imageStyles", imageStyles);
				if (Object.keys(imageStyles).length)
					//export imageStyles to REQUEST body if it exists
					ctx.request.body = { ...ctx.request.body, styles: imageStyles };
			}
		}
	} catch (err) {
		logger.error("mediaUiUpload middleware error: ", err);
	}
	await next();
};

//To be implemented: option to drop previous avatar before updating.
export const avatarUpload = async (ctx: extendedParameterizedContext, next: Next) => {
	//console.log("file", ctx.request.files);
	if (ctx.request.files && ctx.request.files["avatar"]) {
		const avatar = ctx.request.files["avatar"];
		//have option to drop file in public folder. Default to private folder
		const destinationDir = ctx.state.mediaPath && ctx.state.mediaPath === "public" ? true : false;
		//set media Directory
		const newPath =
			process.env[destinationDir ? "globalPath" : "privatePath"] + "/images/avatars/" + avatar.newFilename.split(".")[0] + ".webp";

		//console.log("file", newPath);
		try {
			await sharp(avatar.filepath)
				.resize(240, 240)
				.toFile(newPath)
				.then(() => {
					//console.log("done here!", res);
					//insert new filepath for server use
					ctx.request.body = {
						...ctx.request.body,
						avatar: newPath,
					};
				})
				.catch((err) => {
					logger.error("avatarUpload middleware(sharp library) image converter error: ", err);
					//console.error("lets clean this up", err);
					try {
						fs.unlinkSync(newPath);
						fs.unlinkSync(avatar.filepath);
						return null;
					} catch (err) {
						logger.error("avatarUpload Error cleaning up - middleware error: ", err);
						return err;
					}
				});
			/*  NOTE: Original file by default uploaded to OS TEMP directory. If managed with requestParser with ctx.state.mediaType enabled, original file will be uploaded to APP TEMP dir and auto flushed by cron */
		} catch (err: unknown) {
			logger.error("avatarUpload middleware error: ", err);
		}
		await next();
	} else {
		await next();
	}
};

const root = process.cwd();
//Image/picture/video UPLOAD allows to return the upload destination route in ctx.request.body without any extra processes. This is exported rather than the core mediaUpload for Frontend applications
export const mediaUpload =
	(options?: {
		mediaPath?: "public" | "private" | "remote";
		remoteStorage?: (file: extendedParameterizedContext["request"]["files"]) => Promise<string[]>; // when mediaPath is remote, a remote storage service controller must be provided
		mediaExtention?: string;
		relativeContainer?: string;
	}) =>
	async (ctx: extendedParameterizedContext, next: Next) => {
		const mediaPath = (options && options.mediaPath) || ctx.state.mediaPath;
		const remoteStorage: ((file: extendedParameterizedContext["request"]["files"]) => Promise<string[]>) | undefined =
			options?.remoteStorage;

		// Let's ensure mediaPath is always set for uploads
		if (!mediaPath) {
			ctx.status = NOT_ACCEPTABLE;
			ctx.message = "Server Error: Ensure to define mediaPath as 'public'|'private' on mediaUpload middleware.";
			return;
		} else if (mediaPath === "remote" && !remoteStorage) {
			logger.error("No remote service controller setup to manage media uploads. remoteStorage must be provided in mediaUpload middleware");
			ctx.status = INTERNAL_SERVER_ERROR;
			ctx.message = "Issue uploading media files to remote service";
			return;
		}

		try {
			// temp files uploaded to local server dir needs tobe dumped/cleared whether or not the upload final destination was treated as successful
			const mediaDumpDirFromFormidable: PathLike[] = [];

			//console.log("mediaUpload files", ctx.request.files);
			if (ctx.request.files && Object.keys(ctx.request.files).length > 0) {
				// process remote storage here
				if (remoteStorage) {
					const filePaths = await remoteStorage(ctx.request.files);
					for (const file of Object.keys(ctx.request.files)) {
						const files = ctx.request.files;
						const fileContents = Array.isArray(files[file]) ? files[file] : [files[file]];
						// file key has the potential to have been at the inner depth of an object. Let's resolve that behaviour here
						const fileKeyDepth = file
							.replace(/\[/g, ".") // replace [ with .
							.replace(/\]/g, ""); // remove ]

						/* 
						lets insert the file key with possile depth in the request body
						- Also when ctx.state.entity is available, we may want to delete previous data
					*/
						let entityInState = ctx.state.entity && ctx.state.entity.dataValues;
						if (fileKeyDepth.includes(".")) {
							const keyDepthArray = fileKeyDepth.split(".");
							let thisBody = ctx.request.body;
							keyDepthArray.forEach((depth, index) => {
								if (index + 1 < keyDepthArray.length) {
									thisBody = thisBody[depth] = {};
									if (entityInState && typeof entityInState === "object") entityInState = entityInState[depth];
								} else {
									thisBody[depth] = filePaths.length <= 1 ? filePaths[0] : filePaths;
									if (entityInState && typeof entityInState === "object") entityInState = entityInState[depth];
								}
							});
						} else {
							ctx.request.body[fileKeyDepth] = filePaths.length <= 1 ? filePaths[0] : filePaths;
							if (entityInState) entityInState = entityInState[fileKeyDepth];
						}
						for (const content of fileContents) {
							mediaDumpDirFromFormidable.push(content.filepath);
						}
					}
				}
				// otherwise, lets do local storage management
				else {
					//mandatorily send files to private DIR if on the autoPrivatePath array
					const autoPrivatePaths = ["account" /*  "admin", "auth" */];
					//check if 'media as public' declaration exists in ctx.state
					let placeInPublic = mediaPath === "public" ? true : false;
					if (placeInPublic) {
						for (let i = 0; i < autoPrivatePaths.length; i++) {
							if (ctx.path.includes("/" + autoPrivatePaths[i] + "/")) {
								placeInPublic = false;
								break;
							}
						}
					}

					//construct functions to progress data
					for (const file of Object.keys(ctx.request.files)) {
						const files = ctx.request.files;
						const fileContents = Array.isArray(files[file]) ? files[file] : [files[file]];

						// file key has the potential to have been at the inner depth of an object. Let's resolve that behaviour here
						const fileKeyDepth = file
							.replace(/\[/g, ".") // replace [ with .
							.replace(/\]/g, ""); // remove ]

						// lets reserve all processed new path here
						const filePaths: string[] = [];
						for (const content of fileContents) {
							const mediaType = content.mimetype
								? content.mimetype.includes("image")
									? "image"
									: content.mimetype.includes("video")
										? "video"
										: null
								: null;
							const destinationFolder = mediaType === "image" ? "images" : mediaType === "video" ? "videos" : null;
							// console.log("mediaType", mediaType);
							// console.log("destinationFolder", destinationFolder);

							// set extension
							let mediaExtention = options && options.mediaExtention;

							if (mediaExtention === "default" && mediaType === "image")
								mediaExtention = ".webp"; // using webp as default image type
							else if (mediaExtention && !mediaExtention.startsWith(".")) mediaExtention = "." + mediaExtention;
							// console.log("mediaExtention", mediaExtention);

							//set media Directory
							if (destinationFolder) {
								const folderPermission = !placeInPublic ? "privatePath" : "globalPath";

								const containerDirectry = path.join(
									root,
									process.env[folderPermission]!,
									destinationFolder,
									options && options.relativeContainer ? options.relativeContainer : "",
								);

								// console.log("containerDirectry", containerDirectry);
								// console.log("fs.existsSync(containerDirectry)", fs.existsSync(containerDirectry));

								// lets check if dir exist, else create it when on local storage
								if (!fs.existsSync(containerDirectry)) {
									fs.mkdirSync(containerDirectry, { recursive: true });
								}

								const newPath = path.join(
									containerDirectry,
									!mediaExtention ? content.newFilename : content.newFilename.split(".")[0] + mediaExtention,
								);
								// console.log("content.newFilename", content.newFilename);
								// console.log("newPath", newPath);
								// console.log("content.filepath", content.filepath);

								const currentPath = content.filepath;
								const moveVideoFile = () => {
									//console.log("currentPath", currentPath);
									//console.log("newPath", newPath);
									try {
										fs.renameSync(currentPath, newPath);
										filePaths.push(newPath.split(root)[1]);
									} catch (err) {
										try {
											//record this formidable dump file for later deletion
											mediaDumpDirFromFormidable.push(content.filepath);
											fs.unlinkSync(currentPath);
											return err;
										} catch (err) {
											return err;
										}
									}
								};
								if (mediaType === "video") await moveVideoFile();
								else
									await sharp(currentPath)
										.toFile(newPath)
										.then(async () => {
											//insert new path as filepath for server use
											//console.log("file", file);
											filePaths.push(newPath.split(root)[1]);
											//record this formidable dump file for later deletion
											mediaDumpDirFromFormidable.push(content.filepath);
										})
										.catch((err) => {
											//console.error("lets clean original", err);
											try {
												fs.unlinkSync(newPath);
												fs.unlinkSync(currentPath);
												return err;
											} catch (err) {
												return err;
											}
										});
							}
						}
						// console.log("fileKeyDepth", fileKeyDepth);
						// console.log("filePaths", filePaths);
						// console.log("ctx.request.body pre-media=>:", ctx.request.body);

						/* 
						lets insert the file key with possile depth in the request body
						- Also when ctx.state.entity is available, we may want to delete previous data
					*/
						let entityInState = ctx.state.entity && ctx.state.entity.dataValues;
						if (fileKeyDepth.includes(".")) {
							const keyDepthArray = fileKeyDepth.split(".");
							let thisBody = ctx.request.body;
							keyDepthArray.forEach((depth, index) => {
								const isArrayContainer = !isNaN(Number(depth));
								const key = !isArrayContainer ? depth : Number(depth); // if depth is number, then we are looking at an array

								if (index + 1 < keyDepthArray.length) {
									if (!thisBody[key]) thisBody = thisBody[key] = {};
									else thisBody = thisBody[key];

									if (entityInState && typeof entityInState === "object") entityInState = entityInState[key];
								} else {
									thisBody[key] = filePaths.length <= 1 ? filePaths[0] : filePaths;
									if (entityInState && typeof entityInState === "object") entityInState = entityInState[key];
								}
							});
						} else {
							ctx.request.body[fileKeyDepth] = filePaths.length <= 1 ? filePaths[0] : filePaths;
							if (entityInState) entityInState = entityInState[fileKeyDepth];
						}

						if (entityInState && typeof entityInState === "string")
							//delete file on existing entity if exists
							try {
								fs.unlinkSync(entityInState);
							} catch (err) {
								/* Prevent error from leaking to the frontend from unlink failure */
								logger.error("Issue removing previous ref file in mediaUpload", err);
							}
					}
				}
				// clear dumps
				if (mediaDumpDirFromFormidable.length > 0) {
					try {
						mediaDumpDirFromFormidable.map((media) => {
							return fs.unlinkSync(media);
						});
					} catch (err) {
						/* Prevent error from leaking to the frontend from unlink failure */
						logger.error("Issue removing previous ref file in mediaUpload", err);
					}
				}
			}
		} catch (err) {
			logger.error("MediaUpload middleware error: ", err);
		}
		await next();
	};
