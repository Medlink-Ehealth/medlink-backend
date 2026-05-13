import { logger } from "@medlink/common";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const directory = process.env.tempFolder ? path.join("./" + process.env.tempFolder) : null;
export const emptyTempFolder = async () => {
	try {
		if (directory)
			fs.readdir(directory, (err, files) => {
				const offsetDate = Date.now() + 1000 * 60 * 60 * 24 * 3; // 3days ago
				if (err) logger.error("Cron temp folder deletion error: ", err);
				if (files && files.length)
					for (const file of files) {
						const filePath = path.join(directory, file);
						const fileStats = fs.lstatSync(filePath);
						//console.log("fileStats:", fileStats);
						//console.log("filePath:", filePath);

						//console.log("fileStats.mtimeMs:", fileStats.mtimeMs);
						//console.log("offsetDate:", offsetDate);
						//console.log("fileStats.isFile():", fileStats.isFile());

						if (fileStats.mtimeMs > offsetDate && fileStats.isFile())
							fs.unlink(filePath, (err) => {
								if (err) logger.error("Cron temp folder deletion error: ", err);
							});
					}
			});
		return;
	} catch (err) {
		logger.error("Cron temp folder deletion error: ", err);
		return;
	}
};
