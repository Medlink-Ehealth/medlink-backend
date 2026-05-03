# IMPORTANT POINTERS
  - All endpoint is preceeded by the specific api version for easy functional migration across api versions in the future: "/<API version>/*"
  - Swagger doc is available for all servers at "/<API version>/docs"
  - There is a base config file called 'platform.config' that controls all services. This config file is however imported to each service as app.config. Therefore any customisation can be done here to override configurations per service
  - Each service is setup to use SQLite as a lightweight database, and forgoing the need for service hosted DB like postgres. However any database can easily be configured for each service my defining this preference in env settings. See the "How To" section for more on this.

# APIs Doc
  - Available at: <server address>/<api version>/docs
    - Example: http://localhost:3001/v1/docs

# How TO
  - To run: pnpm run dev.
    - This starts all services, and note pnpm install must have been initiated.
  - To target a service: pnpm run <service name>
  - When a new server is setup, and particularly when a new database is connected, its important to initiatize and sync the database so expected DB schema can be populated using Model schema definations. 
    - To do this, run: pnpm run <service>:db:sync. EG: pnpm run auth:db:sync
    - If you need data populated to database to work with, run: pnpm run <service>:db:tup. Some data has been inputted for this purpose. Where in doubt, please check the specific service directory in src/database/defaultTablesUp

# Project Structure
  - PNPM Workspace is used, there pnpm will have to be used as the project package manager
  - /common directory contains exclusively logic that are reusable by all services as a shared library. This may be improved or strip down over time as need arises
  - Services exist in the /apps directory. Management commands reference have been outlined in in Project Help section
  - Since each service is dependent on /common shared library, build command naturally also build the /common
  - Each service can be customised further using app.config.ts in the service directory. Whether or not this is reconfigured, a project based config is available in /common where default are defined.
  - To spin up a new service, auth-service can always be duplicated as the start-off point

# ENV Essentials
  - Each service must have a dedicated defined env file. Hence, create a .env file in each service directory and define the expected key values. See env.copy in service directory for reference.
  - To allow testign even in a production environment, it is always required to set a value for NODE_ENV, as either "production" or "development"
  - Each service should be configured to run on a unique PORT. Port can be set with PORT. When absent, a default may be used that can clash if exist ports on server.
  - Each service is able to plug to 3rd email services for communication. The mechanism/transport configuration is done in env. Below are references for each setting
    - MAIL_SERVER_SECURE_STATE: boolean value to determine if ssl enforcement is required by the emil service. This would often be true.
    - MAIL_SERVER_AUTH_MAIL: USe this to set the defaut email of the service or project
    - MAIL_SERVER_AUTH_PASS: the corresponding password to MAIL_SERVER_AUTH_MAIL provide by the email service
    - MAIL_SERVER_NOREPLY_MAIL: An alterntive non-monitored email for communication. If non exist, MAIL_SERVER_AUTH_MAIL may be used instead
    - MAIL_SERVER_NOREPLY_PASS: Corresponding password for MAIL_SERVER_NOREPLY_MAIL

    - MAIL_SERVER_SMTP_HOST: Email transport would often be SMTP. Set the email server here.
    - MAIL_SERVER_SMTP_PORT: This be deault be often be "465" if MAIL_SERVER_SECURE_STATE is true. Otherwise would be "587"

  - Media files is being managed using a function class "storageManager". Thugh using local file storage by default, this function can easily be configured to use Azure Blob storage by setting the following:
    - CONVERSATION_MEDIA_STORAGE = "azure"
    - CONVERSATION_MEDIA_STORAGE_PATH = `{
#       "AZURE_TENANT_ID": "<>",
# 			"AZURE_CLIENT_ID": "<>",
# 			"AZURE_CLIENT_SECRET": "<>",
# 			"STORAGE_ACCOUNT_NAME": "<storage resource name>",
# 			"CONTAINER_NAME": "<name of blob container>"
# 		}`
   storageManager was a new introducion and may still need perfomance testing.

  - For tokens, JWT is use by default but PASETO prioritized which has improved security over JWT for user authentications in that it cannot be as easily decoded as JWT. JWT is use in most other scenerio where user account authentication is a concern. Both JWT and PASETO keys must be configured using JWT_SECRET_KEY and APP_PASETO_KEY.
    - Note: Paseto v3 is currently in use internally for decoding. Hence v3 key should be generated for compartibility. Update to v4 May later be considered.
    - Generate a valid Paseto key: paseto.v3.generateKey('local', {format: "paserk"})
    - See for more: https://github.com/panva/paseto/blob/main/docs/README.md#v3generatekeypurpose-options

  - For local files management, the follwoign can be used to group uploaded files
    - tempFolder: Set a directory for temp files that is automatically cleaned up by cron process
    - globalPath: Where publicly access files goes to.
    - privatePath: files that required authorised access
    - tempPrivateFolder: Temp files will still be auto deleted but required authorised access for access while available

  - Each service can be configured with a settings file that can be potentially update directly from the UI for privileged users without required a redeployment. When such need arises, use "settings" key in env to set the directory containing such configuration files.

  - Database options
    - DIALECT: Sequelize is used internally as ORM and any Dialect supported by Sequelize can be used here. During development sqlite is used for simplicity
    - DB_STORAGE: Needed when sqlite is used to specify the db location on server
    - DB_HOST: DB host address
    - DB_PORT: DB listening port
    - DB_USER: DB credential
    - DB_PASS: DB crdential password
    - DB_NAME: The DB name on DB service/server
    - DB_SCHEMA: When using DB like Postgres, you may have configured a dedicated schema on database for a particular service. Schema allows to use a single db for all service while dedicating schemas within same db to each service. When not set, 'public' is often used by default

  - If required, cookie identifiers and keys can be set using the below
    - COOKIE_IDENTIFIER: A unique string value
    - COOKIE_KEYS: Use an array of strings values for improved complexity

# Project Help - DEV
You should preferably stay in the root directory and use the --filter flag. You almost never need to cd into the subfolders.
 - To add a package to a specific service:
    - pnpm add koa --filter auth-service

 - To add same package to all services:
    - pnpm add koa --filter "./apps/**"

  - To add a shared/common internal library to a service:
    - pnpm add @medlink/common --filter auth-service --workspace

  - To install everything in the whole repo:
    - pnpm install

Only use the root package.json for:
  - Dev-wide tools: Things that apply to the whole repo, like prettier, eslint, or typescript.
  - Global scripts: Shortcuts like "build:all": "pnpm -r run build".





