import cron from "node-cron";
import { emptyTempFolder } from "./jobs/emptyTempFolder.js";
import { logger } from "@medlink/common";

const jobScheduler = async () => {
	//every minute cron
	cron.schedule("* * * * *", () => {
		try {
		} catch (err) {
			logger.error("Every minute cron error: ", err);
		}
	});
	//every 5mins cron
	cron.schedule("*/5 * * * *", () => {
		try {
		} catch (err) {
			logger.error("Every 5mins cron error: ", err);
		}
	});
	//every 30mins cron
	cron.schedule("*/30 * * * *", () => {
		try {
		} catch (err) {
			logger.error("Every 30mins cron error: ", err);
		}
	});
	//hourly cron
	cron.schedule("0 * * * *", () => {
		try {
			//emptyPageBin();
		} catch (err) {
			logger.error("Hourly cron error: ", err);
		}
	});
	//every 2hrs
	cron.schedule("0 */2 * * *", () => {
		try {
		} catch (err) {
			logger.error("every 2hrs cron error: ", err);
		}
	});
	//every 3hrs
	cron.schedule("0 */3 * * *", () => {
		try {
		} catch (err) {
			logger.error("every 3hrs cron error: ", err);
		}
	});
	//every 6hrs
	cron.schedule("0 */6 * * *", () => {
		try {
		} catch (err) {
			logger.error("every 6hrs cron error: ", err);
		}
	});
	//every 12hrs
	cron.schedule("0 */12 * * *", () => {
		try {
		} catch (err) {
			logger.error("every 12hrs cron error: ", err);
		}
	});
	//daily (24hrs) cron at 1am
	cron.schedule("0 1 * * *", () => {
		try {
			emptyTempFolder();
			logger.info("Daily cron initiated.");
		} catch (err) {
			logger.error("Daily cron error: ", err);
		}
	});
	//Weekly (7days) cron at 00:00 0n sundays
	cron.schedule("0 0 * * 0", () => {
		try {
			logger.info("weekly cron initiated.");
		} catch (err) {
			logger.error("weekly cron error: ", err);
		}
	});
	//Monthly cron at day 1 of every month
	cron.schedule("0 0 1 * *", () => {
		try {
			logger.info("Monthly cron initiated.");
		} catch (err) {
			logger.error("Monthly cron error: ", err);
		}
	});
	//Monthly (mid-month) cron at day 15 (mid) of every month
	cron.schedule("0 0 15 * *", () => {
		try {
			logger.info("Monthly (mid-month) cron initiated.");
		} catch (err) {
			logger.error("Monthly (mid-month) cron error: ", err);
		}
	});

	console.log("cronJobs...... loaded!");
};

export { jobScheduler };
