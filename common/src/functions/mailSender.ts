import nodemailer from "nodemailer";
import process from "node:process";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import sanitizeHtml from "sanitize-html";
import { Readable } from "node:stream";
import { MailOptions } from "nodemailer/lib/sendmail-transport/index.js";
import { config } from "../platform.config.js";
import { logger } from "../utils/logger.js";

//REF: https://mailtrap.io/blog/sending-emails-with-nodemailer
// Env variables
const {
	MAIL_SERVER_SMTP_HOST,
	MAIL_SERVER_SMTP_PORT,
	MAIL_SERVER_SECURE_STATE,
	MAIL_SERVER_AUTH_MAIL,
	MAIL_SERVER_AUTH_PASS,
	MAIL_SERVER_NOREPLY_MAIL,
	MAIL_SERVER_NOREPLY_PASS,
} = process.env;

interface MailInterface {
	log?: boolean; // by default, errors & warnings are logged. Set to true to log all transactions
}
interface MailProps extends MailInterface {
	sender?: string | "auth" | "default" | "noreply"; // 'Daemon <deamon@nodemailer.com>' | 'deamon@nodemailer.com'
	subject: string;
	content: string | { [type: string]: string | CSSStyleSheet | undefined; text: string; html: string; style?: CSSStyleSheet | string }; //import as either plain text|string or object of them
	receiver:
		| string
		| string[]
		| { name: string; email: string }
		//| { name: string; email: string }[]
		| (string | { name: string; email: string })[]
		| {
				to?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
				cc?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
				bcc?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
		  }
		| (
				| string
				| { name: string; email: string }
				| {
						to?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
						cc?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
						bcc?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
				  }
		  )[]; // 'Daemon <deamon@nodemailer.com>'[] | 'deamon@nodemailer.com'[] |  { name: Daemon; email: deamon@nodemailer.com }
	batchSending?: boolean; // set to true to send email in batch mode
	attachments?: Attachments[];
	placeholders?: { [placeholder: string]: string }; //allows to auto replace placeholders inside subject or content message
	log?: boolean; // by default, errors & warnings are logged. Set to true to log all transactions
	testServer?: never;
	siteAddress?: string;
	ignoreDevReceiverRewriteToSender?: boolean; // ignore dev mode rewrite of receiver to sender email address
	headers?: MailOptions["headers"];
	serverConfig?: {
		SMTP_HOST: string;
		SMTP_PORT: string | number;
		AUTH_TYPE?:
			| "LOGIN"
			| "OAuth2"
			| {
					type: "OAuth2";
					clientId: string;
					clientSecret: string;
					user?: string;
					refreshToken?: string;
					accessToken?: string;
					expires?: number;
			  };
		AUTH_USER: string;
		AUTH_PASS: string;
		AUTH_SECURED: boolean;
	};
}
interface TestMailServer extends MailInterface {
	sender?: string;
	subject?: never;
	content?: never;
	receiver?: never;
	batchSending?: boolean; // set to true to send email in batch mode
	attachments?: never;
	placeholders?: never;
	log?: boolean;
	testServer: true;
	siteAddress?: string;
	ignoreDevReceiverRewriteToSender?: boolean;
	headers?: MailOptions["headers"];
	serverConfig?: {
		SMTP_HOST: string;
		SMTP_PORT: string | number;
		AUTH_TYPE?:
			| "LOGIN"
			| "OAuth2"
			| {
					type: "OAuth2";
					clientId: string;
					clientSecret: string;
					user?: string;
					refreshToken?: string;
					accessToken?: string;
					expires?: number;
			  };
		AUTH_USER: string;
		AUTH_PASS: string;
		AUTH_SECURED: boolean;
	};
}
type Attachments = {
	filename: string;
	content?: string | Buffer | Readable | undefined;
	path?: string;
	contentType?: "text/plain";
	encoding?: string;
	raw?: string;
};

// process reciever complicated details/structure
const extractReceivers = (
	receiver:
		| string
		| { name: string; email: string }
		| {
				to?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
				cc?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
				bcc?: string | string[] | { name: string; email: string } | { name: string; email: string }[];
		  },
) => {
	if (typeof receiver === "string") return { to: receiver };
	else if (typeof receiver === "object") {
		if (receiver["name" as keyof typeof receiver]) {
			return { to: `${receiver["name" as keyof typeof receiver]} <${receiver["email" as keyof typeof receiver]}>` };
		} else if (receiver["to" as keyof typeof receiver]) {
			return {
				to:
					typeof receiver["to" as keyof typeof receiver] === "string"
						? receiver["to" as keyof typeof receiver]
						: Array.isArray(receiver["to" as keyof typeof receiver])
							? (receiver["to" as keyof typeof receiver] as string[] | { name: string; email: string }[])
									.map((rec) => (typeof rec === "string" ? rec : `${rec.name} <${rec.email}>`))
									.join(", ")
							: `${receiver["to" as keyof typeof receiver]["name"]} <${receiver["to" as keyof typeof receiver]["email"]}>`,
				cc: receiver["cc" as keyof typeof receiver]
					? typeof receiver["cc" as keyof typeof receiver] === "string"
						? receiver["cc" as keyof typeof receiver]
						: Array.isArray(receiver["cc" as keyof typeof receiver])
							? (receiver["cc" as keyof typeof receiver] as string[] | { name: string; email: string }[])
									.map((rec) => (typeof rec === "string" ? rec : `${rec.name} <${rec.email}>`))
									.join(", ")
							: `${receiver["cc" as keyof typeof receiver]["name"]} <${receiver["cc" as keyof typeof receiver]["email"]}>`
					: undefined,
				bcc: receiver["bcc" as keyof typeof receiver]
					? typeof receiver["bcc" as keyof typeof receiver] === "string"
						? receiver["bcc" as keyof typeof receiver]
						: Array.isArray(receiver["bcc" as keyof typeof receiver])
							? (receiver["bcc" as keyof typeof receiver] as string[] | { name: string; email: string }[])
									.map((rec) => (typeof rec === "string" ? rec : `${rec.name} <${rec.email}>`))
									.join(", ")
							: `${receiver["bcc" as keyof typeof receiver]["name"]} <${receiver["bcc" as keyof typeof receiver]["email"]}>`
					: undefined,
			};
		}
	}
	return { to: undefined };
};

/**
 * Sned outgoing email
 *
 * @param {(MailProps | TestMailServer)} obj Props
 * @param {string} obj.sender
 * @param {string} [obj.subject=`Mail from ${config.SITENAME}`]
 * @param {(string | { [type: string]: any; text: string; html: string; style?: any; })} obj.content (string | {text: string; html: string; style?: string | CSSStyleSheet; })
 * @param {(string | {})} obj.receiver
 * @param {{}} obj.attachments
 * @param {{ [placeholder: string]: string; }} obj.placeholders
 * @param {boolean} obj.log
 * @param {true} obj.testServer
 * @param {string} obj.siteAddress
 * @param {?boolean} [doLog]
 * @param {boolean} obj.ignoreDevReceiverRewriteToSender
 * @returns {*}
 */
const mailSender = async (
	{
		sender, //'Daemon <deamon@nodemailer.com>'
		subject = `Mail from ${config.projectName}`,
		content,
		receiver,
		batchSending = false, // set to true to send email in batch mode
		attachments,
		placeholders,
		log,
		testServer,
		siteAddress,
		ignoreDevReceiverRewriteToSender,
		headers,
		serverConfig = {
			SMTP_HOST: MAIL_SERVER_SMTP_HOST!,
			SMTP_PORT: MAIL_SERVER_SMTP_PORT!,
			AUTH_TYPE: "LOGIN",
			AUTH_USER: MAIL_SERVER_AUTH_MAIL!,
			AUTH_PASS: MAIL_SERVER_AUTH_PASS!,
			AUTH_SECURED: MAIL_SERVER_SECURE_STATE ? (MAIL_SERVER_SECURE_STATE.toLowerCase() === "true" ? true : false) : true,
		},
	}: MailProps | TestMailServer,
	doLog?: boolean, // log can alternatively be set as 2nd argument.
) => {
	// allow custom import of site address rather than use sitewide settings
	let SITE_ADDRESS = siteAddress ? siteAddress : config.serverAddress;
	// sanitize website address
	SITE_ADDRESS = SITE_ADDRESS?.includes("//") ? SITE_ADDRESS.split("//")[1] : SITE_ADDRESS;
	SITE_ADDRESS = SITE_ADDRESS?.includes("www.") ? SITE_ADDRESS.split("www.")[1] : SITE_ADDRESS;
	//SITE_ADDRESS = SITE_ADDRESS.includes(":") ? SITE_ADDRESS.split(":")[0] : SITE_ADDRESS;

	// set default values
	const defaultSiteEmail = serverConfig.AUTH_USER
		? serverConfig.AUTH_USER.includes("@")
			? serverConfig.AUTH_USER
			: serverConfig.AUTH_USER + "@" + SITE_ADDRESS
		: undefined;
	const defaultSiteNoreply = MAIL_SERVER_NOREPLY_MAIL
		? MAIL_SERVER_NOREPLY_MAIL.includes("@")
			? MAIL_SERVER_NOREPLY_MAIL
			: MAIL_SERVER_NOREPLY_MAIL + "@" + SITE_ADDRESS
		: undefined;

	const senderEmailPlaceholder = defaultSiteNoreply ? `${config.projectName} <${defaultSiteNoreply}>` : undefined; //'Daemon <deamon@nodemailer.com>'
	// set a default sender when omitted in props
	if (!sender && senderEmailPlaceholder) sender = senderEmailPlaceholder;

	const logAll = log ? log : doLog ? doLog : false;

	// Let's ensure server address is setup
	if (!serverConfig.SMTP_HOST || !serverConfig.SMTP_PORT) {
		logger.error(
			"Email server non-functional and email sending would not be processed as server is undefined." +
				(process.env.NODE_ENV !== "production" ? " DevMode content: " + JSON.stringify(content, null, 2) : ""),
		);
		new Error("Email sending is non-functional because server not defined.");
		return;
	}

	try {
		// let's define mail sender
		const fromSender =
			sender === "default" || sender === "auth"
				? defaultSiteEmail
					? defaultSiteEmail
					: senderEmailPlaceholder
				: sender === "noreply"
					? defaultSiteNoreply
						? defaultSiteNoreply
						: senderEmailPlaceholder
					: sender;
		if (!fromSender) {
			logger.error("An email 'from' sender is required to send email");
			new Error("An email 'from' sender is required to send email");
			return;
		}

		if (process.env.NODE_ENV !== "production" && !testServer) {
			//output mail content to log in DEV while ignoring this in testing server starter
			logger.info("Email content available in dev mode");
			logger.info(JSON.stringify({ sender: fromSender, receiver: receiver, subject: subject, content: content }, null, 2));
		}

		// Lets define auth mechanism
		let authMechanism = {
			type: serverConfig.AUTH_TYPE ? serverConfig.AUTH_TYPE : "LOGIN", //default to 'LOGIN', LOGIN | OAuth2
			user: serverConfig.AUTH_USER,
			//pass: serverConfig.AUTH_PASS as string,
		};
		if (defaultSiteNoreply && fromSender.includes(defaultSiteNoreply)) {
			authMechanism["user"] = defaultSiteNoreply;
			authMechanism["pass" as "user"] = MAIL_SERVER_NOREPLY_PASS as string;
		} else if (authMechanism.type === "LOGIN") {
			authMechanism["pass" as "user"] = serverConfig.AUTH_PASS as string;
		} else if (authMechanism.type === "OAuth2") {
			authMechanism["accessToken" as "user"] = serverConfig.AUTH_PASS as string;
		} else if (typeof authMechanism.type === "object" && authMechanism.type["type"] === "OAuth2")
			authMechanism = { ...authMechanism, ...authMechanism.type };
		else {
			logger.error("Authentication mechanism needs to be defined as either 'LOGIN' or 'OAuth2'");
			new Error("Authentication mechanism needs to be defined as either 'LOGIN' or 'OAuth2'");
			return;
		}

		// Create a transporter object
		const transporter = nodemailer.createTransport(
			batchSending && Array.isArray(receiver)
				? ({
						pool: true, // create pools when reciever is multiple/array
						maxMessages: Infinity, // Allow an unlimited number of messages per connection
						maxConnections: 5, // Limit the number of simultaneous connections
						host: serverConfig.SMTP_HOST,
						port: serverConfig.SMTP_PORT ? Number(serverConfig.SMTP_PORT) : 587,
						//TLS options
						tls: {
							servername: serverConfig.SMTP_HOST, // "mail." + SITE_ADDRESS,
							rejectUnauthorized: false, // do not fail on invalid certs
						},
						secure: serverConfig.AUTH_SECURED, // use SSL
						authMethod: "PLAIN",
						auth: authMechanism,
					} as SMTPTransport.Options)
				: ({
						host: serverConfig.SMTP_HOST,
						port: serverConfig.SMTP_PORT ? Number(serverConfig.SMTP_PORT) : 587,
						//TLS options
						tls: {
							servername: serverConfig.SMTP_HOST, // "mail." + SITE_ADDRESS,
							rejectUnauthorized: false, // do not fail on invalid certs
						},
						secure: serverConfig.AUTH_SECURED, // use SSL
						authMethod: "PLAIN",
						auth: authMechanism,
					} as SMTPTransport.Options),
		);

		// verify SMTP connection
		if (testServer) {
			transporter.verify(function (error, success) {
				if (error) {
					logger.error("Mailing functionality error:", error);
				} else {
					logger.info("Mailing functionality working?..: " + success);
				}
			});

			const mailOptions = {
				from: defaultSiteNoreply ? defaultSiteNoreply : fromSender,
				to: fromSender,
				subject: "Test: server setup is functional",
				text: "If you are seeing this message, then mail server is working as expected!",
				html: "<h1>Welcome</h1><p>If you are seeing this message, then mail server is working as expected!</p>",
			};

			logger.info("Email Detail: " + JSON.stringify(mailOptions, null, 2));
			// Send the email
			return await transporter.sendMail(mailOptions);
		}

		// Let's check that some extra neccessary content props exist
		if (!content || (typeof content === "object" && !(content as { text: string }).text) || !receiver) {
			logger.warn(`Email can't be sent without defining both content and receiver`);
			return;
		}

		// Configure the mailoptions object
		const mailOptions: MailOptions =
			//{ from: string; subject: string; text?: string; html?: string; attachments?: Attachments[] }
			{
				from: fromSender,
				//to: "mail@email.com", define later as receiver
				subject: sanitizeHtml(subject, {
					allowedTags: [],
					allowedAttributes: {},
				}),
				text:
					typeof content === "string"
						? sanitizeHtml(content, {
								allowedTags: [],
								allowedAttributes: {},
							})
						: typeof content === "object"
							? (content as { text: string }).text
								? content["text"]
								: (content as { html: string }).html
									? sanitizeHtml((content as { html: string }).html, {
											allowedTags: [],
											allowedAttributes: {},
										})
									: undefined
							: undefined,
				html:
					typeof content === "string"
						? content
						: typeof content === "object"
							? (content as { html: string }).html
								? content["html"]
								: (content as { text: string }).text
							: undefined,
			};
		if (attachments && attachments.length) mailOptions["attachments"] = attachments;
		// inject html DOCtype in email as container
		if (mailOptions.html)
			mailOptions.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${
					content && typeof content === "object" && (content as { style: string | CSSStyleSheet }).style
						? typeof (content as { style: string }).style === "string"
							? `<style>${(content as { style: string }).style}</style>`
							: (content as { style: CSSStyleSheet }).style
						: "<style></style>"
				}
        <title>${mailOptions.subject}</title>
    </head>
    <body>
        ${mailOptions.html}
    </body>
    </html>
    `;

		if (batchSending && Array.isArray(receiver)) {
			const arrayInfo: SMTPTransport.SentMessageInfo[] = [];
			for (const receiverDetail of receiver) {
				const mailOptionsAddon = {
					...mailOptions,
					...extractReceivers(process.env.NODE_ENV !== "production" && !ignoreDevReceiverRewriteToSender ? fromSender : receiverDetail),
				};
				if (placeholders && Object.keys(placeholders).length) {
					// replace in html, text, subject
					Object.keys(placeholders).forEach((holderKey) => {
						if (mailOptionsAddon.subject && mailOptionsAddon.subject.includes(holderKey))
							mailOptionsAddon.subject = mailOptionsAddon.subject.split(holderKey).join(placeholders[holderKey]);
						if (typeof mailOptionsAddon.text === "string" && mailOptionsAddon.text.includes(holderKey))
							mailOptionsAddon.text = mailOptionsAddon.text.split(holderKey).join(placeholders[holderKey]);
						if (typeof mailOptionsAddon.html === "string" && mailOptionsAddon.html.includes(holderKey))
							mailOptionsAddon.html = mailOptionsAddon.html.split(holderKey).join(placeholders[holderKey]);
					});
				}
				// inject headers if defined
				if (headers) mailOptionsAddon["headers"] = headers;
				// Send the email
				const thisInfo = await transporter.sendMail(mailOptionsAddon);
				if (logAll) logger.info("Email sent: " + thisInfo.response);
				arrayInfo.push(thisInfo);
			}
			return arrayInfo;
			// transporter.close();
		} else {
			// process destination extractions
			let receiverCombo: { to: string | undefined } | undefined =
				process.env.NODE_ENV !== "production" && !ignoreDevReceiverRewriteToSender ? { to: fromSender } : undefined;

			if (process.env.NODE_ENV === "production" || ignoreDevReceiverRewriteToSender) {
				if (!Array.isArray(receiver)) receiverCombo = extractReceivers(receiver);
				else {
					const arrayedCombo = receiver.map((rec) => extractReceivers(rec));

					for (const rec of arrayedCombo) {
						if (rec) {
							if (!receiverCombo) receiverCombo = { to: undefined };
							if (rec.to) {
								receiverCombo.to = receiverCombo.to ? receiverCombo.to + ", " + rec.to : rec.to;
							}
							if (rec.cc) {
								receiverCombo["cc" as "to"] = receiverCombo["cc" as "to"] ? receiverCombo["cc" as "to"] + ", " + rec.cc : rec.cc;
							}
							if (rec.bcc) {
								receiverCombo["bcc" as "to"] = receiverCombo["bcc" as "to"] ? receiverCombo["bcc" as "to"] + ", " + rec.bcc : rec.bcc;
							}
						}
					}
				}
			}
			const mailOptionsAddon = {
				...mailOptions,
				...receiverCombo,
			};
			if (placeholders && Object.keys(placeholders).length) {
				// replace in html, text, subject
				Object.keys(placeholders).forEach((holderKey) => {
					if (mailOptionsAddon.subject && mailOptionsAddon.subject.includes(holderKey))
						mailOptionsAddon.subject = mailOptionsAddon.subject.split(holderKey).join(placeholders[holderKey]);
					if (typeof mailOptionsAddon.text === "string" && mailOptionsAddon.text.includes(holderKey))
						mailOptionsAddon.text = mailOptionsAddon.text.split(holderKey).join(placeholders[holderKey]);
					if (typeof mailOptionsAddon.html === "string" && mailOptionsAddon.html.includes(holderKey))
						mailOptionsAddon.html = mailOptionsAddon.html.split(holderKey).join(placeholders[holderKey]);
				});
			}
			// inject headers if defined
			if (headers) mailOptionsAddon["headers"] = headers;

			// Send the email
			const mailInfo = await transporter.sendMail(mailOptionsAddon);
			if (logAll) logger.info("Email sent: " + mailInfo.response);

			return mailInfo;
		}
	} catch (err) {
		// lets log when email sending failed, but without leaking into runtime to halt app process
		logger.error("Error sending email: ", err);
		return;
	}
};

export { mailSender };

/* 
Defining attachments
attachments: [
      {
        // utf-8 string as an attachment
        filename: "text1.txt",
        content: "hello world!",
      },
      {
        // binary buffer as an attachment
        filename: "text2.txt",
        content: Buffer.from("hello world!", "utf-8"),
      },
      {
        // file on disk as an attachment
        filename: "text3.txt",
        path: "/path/to/file.txt", // stream this file
      },
      {
        // filename and content type is derived from path
        path: "/path/to/file.txt",
      },
      {
        // stream as an attachment
        filename: "text4.txt",
        content: fs.createReadStream("file.txt"),
      },
      {
        // define custom content type for the attachment
        filename: "text.bin",
        content: "hello world!",
        contentType: "text/plain",
      },
      {
        // use URL as an attachment
        filename: "license.txt",
        path: "https://raw.github.com/nodemailer/nodemailer/master/LICENSE",
      },
      {
        // encoded string as an attachment
        filename: "text1.txt",
        content: "aGVsbG8gd29ybGQh",
        encoding: "base64",
      },
      {
        // data uri as an attachment
        path: "data:text/plain;base64,aGVsbG8gd29ybGQ=",
      },
      {
        // use pregenerated MIME node
        raw: "Content-Type: text/plain\r\n" + "Content-Disposition: attachment;\r\n" + "\r\n" + "Hello world!",
      },
    ],
   */
