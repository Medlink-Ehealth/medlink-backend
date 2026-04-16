import { Op } from "sequelize";
import { Notification } from "../../../../../../common/models/Notification.model.js";
import { AdminRole } from "../../../models/accounts/AdminRole.model.js";
import { dbQuerier, Router, statusCodes } from "@medlink/common";

const router = Router({
	prefix: "/notifications",
});

/* 
    A basic Notification model will look similar to:
    await modelNotification.create({
        detail: "Review the attached article for publication",
        status: "unread",
        meta: {
          author: {
            uuid: ctx.state.user.uuid,
            role: ctx.state.user.role,
            level: ctx.state.user.level,
            name: ctx.state.user.firstName,
          },
          target: { type: "UserGroup", level: "admin or above", role: "4+" } | 
          target: { type: "User", 
                    uuid: ctx.state.user.uuid,
                    //type: "UserGroup",
                    level: "admin or above",
                    role: '4,5' | 4 //single role or list of roles
                    //operator: ">=", //Consider if an Operator approach can be used for list of roles. Currently not in use
                },
          content: {
            path: article.alias,
            title: article.title,
          },
        },
      });
 */
//view all notification by props
router.get(
	"/",
	async (ctx, next) => {
		//console.log("ctx.url:", ctx.url);
		//console.log("ctx.path:", ctx.path);
		//When no filter exists
		if (ctx.path === ctx.url) {
			ctx.url = ctx.url + "?sort[created=DESC]&page[limit=10]";
		}
		await next();
	},
	dbQuerier({ ignoreStateFiltration: true }),
	async (ctx) => {
		//console.log("ctx.state.dbQuerier:", ctx.state.dbQuerier);
		if (ctx.state.dbQuerier) {
			const queryFilter = () => {
				//reserve existing meta if it exists
				let reservedMeta;
				if (!ctx.state.dbQuerier.where) ctx.state.dbQuerier.where = { meta: {} };
				else if (!ctx.state.dbQuerier.where.meta) ctx.state.dbQuerier.where["meta"] = {};
				else reservedMeta = ctx.state.dbQuerier.where.meta;

				//general user-specific notifications
				ctx.state.dbQuerier.where.meta = {
					[Op.and]: [{ [Op.contains]: { target: { type: "User" } } }, { [Op.contains]: { target: { uuid: ctx.state.user.uuid } } }],
				};
				//Admin/roles-specific notifications
				if (ctx.state.user.role)
					ctx.state.dbQuerier.where.meta = {
						[Op.or]: [
							ctx.state.dbQuerier.where.meta,
							{
								[Op.and]: [
									{ [Op.contains]: { target: { type: "UserGroup" } } },
									{
										[Op.or]: [
											{
												target: {
													role: {
														[Op.iLike]: "%" + ctx.state.user.role.toString(),
													},
												},
											}, //Contains role in a list of roles
											{
												[Op.contains]: {
													target: { role: ctx.state.user.role },
												},
											}, //Current roles only
										],
									},
								],
							},
						],
					};
				if (reservedMeta)
					ctx.state.dbQuerier.where.meta = {
						...ctx.state.dbQuerier.where.meta,
						...reservedMeta,
					};
				return;
			};

			//When no model target exists, filter to currently logged user
			if (!ctx.state.dbQuerier.where || (ctx.state.dbQuerier.where && !ctx.state.dbQuerier.where.meta)) {
				queryFilter();
			}
			//Only fetch notification if at least a Target FILTER exists
			if (ctx.state.dbQuerier.where.meta && typeof ctx.state.dbQuerier.where.meta === "object") {
				if (!ctx.state.dbQuerier.limit)
					//control the query limit if none is defined
					ctx.state.dbQuerier.limit = 20;

				//console.log("ctx.state.dbQuerier @@:", ctx.state.dbQuerier);
				const notifications = await Notification(ctx.sequelizeInstance!).findAll(ctx.state.dbQuerier);
				//console.log("notifications:", notifications);
				if (!notifications) {
					ctx.status = statusCodes.NOT_FOUND;
					return (ctx.body = null);
				}
				ctx.status = statusCodes.OK;
				ctx.body = {
					status: statusCodes.OK,
					data: notifications,
				};
			} else {
				ctx.status = statusCodes.FORBIDDEN;
				ctx.message = "Define at least a META filter to fetch notifications. Or leave out META filter to filter to server default";
			}
		}
	},
);

//get single notification
router.get("/:uuid", async (ctx) => {
	//Only the highest user role besides the DEV role should be able to see a notification
	const notification = await ctx.sequelizeInstance!.transaction(async (t) => {
		const highestRole = await AdminRole(ctx.sequelizeInstance!).findOne({
			order: [["level", "DESC"]],
			offset: 1,
			transaction: t,
		});
		//console.log("highestRole", highestRole);
		if (highestRole && ctx.state.user.role >= highestRole.dataValues.level) {
			return await Notification(ctx.sequelizeInstance!).findByPk(ctx.params.uuid, { transaction: t });
		} else return false;
	});
	if (notification) {
		ctx.status = statusCodes.OK;
		ctx.body = {
			status: statusCodes.OK,
			data: notification.toJSON(),
		};
	} else {
		ctx.status = statusCodes.NOT_FOUND;
		ctx.message = "Oops. We are unsure you have the permission to view the notification you are looking for!";
		return;
	}
});

//update single notification status
router.get("/:uuid/read", async (ctx) => {
	//Only the highest user role besides the DEV role should be able to see a notification
	const notification = await Notification(ctx.sequelizeInstance!).update({ status: "read" }, { where: { uuid: ctx.params.uuid } });

	if (notification) {
		ctx.status = statusCodes.OK;
		ctx.body = {
			status: statusCodes.OK,
		};
	} else {
		ctx.status = statusCodes.NOT_FOUND;
		ctx.message = "Oops. We are unsure you have the permission to view the notification you are looking for!";
		return;
	}
});

export default router;
