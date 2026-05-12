# Project Documentation

## 📌 Important Pointers
- **Versioning:** All endpoints are preceded by the specific API version for easy functional migration across future api versions in: `/<API version>/*`

- **Swagger Docs:** Available for all servers at `/<API version>/docs`

- **Configuration:** A base config file called `platform.config` controls all services. This is imported to each service as `app.config`, allowing for per-service overrides.

- **Database:** Each service is set up to use **SQLite** as aa lightweight database, and forgoing the need for service hosted DB like postgres. However any database can easily be configured for each service my defining this preference in env settings. See the "How To" section for more on this.

---

## 📖 APIs Documentation
Access the Swagger documentation at: `<server address>/<api version>/docs`
- **Example:** [http://localhost:3001/v1/docs](http://localhost:3001/v1/docs)

---

## 🛠 How To
- **Run Development Environment:** 
  ```bash
  pnpm run dev
  ```
  This starts all services, and note: ```pnpm install``` must have been initiated.

- **Target a Specific Service:** 
  ```bash
  pnpm run <service name>
  ```
- **Initialize & Sync Database:** 
  Run this when setting up a new server or connecting a new database, so expected DB schema can be populated using Model schema definations:
  ```bash
  pnpm run <service>:db:sync
  # Example: pnpm run auth:db:sync
  ```
- **Seed Data:** 
  To populate the DB with test data:
  ```bash
  pnpm run <service>:db:tup
  ```
  *Seed files are located in `src/database/defaultTablesUp`.*

- **Development or Feature integration:** 
  You should preferably stay in the **root directory** and use the --filter flag. You almost never need to cd into the service directories to run commands.

  | Task | Command |
  | :--- | :--- |
  | **Add package to specific service** | `pnpm add <pkg> --filter <service-name>` |
  | **Add package to all services** | `pnpm add <pkg> --filter "./apps/**"` |
  | **Link internal shared library to a service** | `pnpm add @medlink/common --filter <service> --workspace` |
  | **Install all dependencies** | `pnpm install` |

  > [!TIP]
   > - Use the **root `package.json`** only for repo-wide tools (Prettier, ESLint, TypeScript)
   > - Or for Global scripts like: `"build:all": "pnpm -r run build"`

- **Production deployment:** 
  Building will transpile to /dist directory in both `/<service name>-service`, and `/common` directories. So the deployment process would need to ensure that both a specific service and common are deployed.
  - ⁠Ensure theses directories are included in a`/<service name>-service`: `dist`, `site` and `package.json` (if you intend to do remote build step during the deployment), otherwise also include `node_modules`
  - Similarly for common, you will need `dist` and `package.json`.
  - ⁠For any future service integrated, we need just the service directories like we have for `auth-service`, and `common`. Hence, we will not be deploying the entire repo workspace, just what is needed per service.

---

## 📁 Project Structure
- **Package Manager:** [PNPM Workspaces is used](https://pnpm.io), therefore pnpm will have to be used as the project package manager.
- **`/common`:** Shared logic/libraries used by all services. This may be improved or strip down over time as need arises. Building a service automatically builds this library.

- **`/apps`:** Contains all individual microservices. Management commands reference has been outlined in Project Help section.

- **Customization:** Each service settings can be customized using `app.config.ts` within its directory. The default/base project config is available in `/common` and should only need to be update for platform-wide customization 

- **Scaffolding:** To create a new service, use `auth-service` as a template.

---

## 🔐 ENV Essentials
Create a `.env` file in each service directory (see `env.copy` for reference).

### Core Settings
- `NODE_ENV`: Set to `production` or `development`.
- `PORT`: Each service must have a unique port.

### Mail Configuration
- Each service is able to plug to 3rd email services for communication. The mechanism/transport configuration is done in env. Below are references for each setting

| Key | Description |
| :--- | :--- |
| `MAIL_SERVER_SECURE_STATE` | Boolean (true for SSL) to define if ssl enforcement is required by the email service. This would often be true for most services|
| `MAIL_SERVER_AUTH_MAIL` | Default service email address. |
| `MAIL_SERVER_AUTH_PASS` | Password for the auth email. |
| `MAIL_SERVER_NOREPLY_MAIL` | An alterntive non-monitored email for communication. If non exist, `MAIL_SERVER_AUTH_MAIL` may be used instead. |
| `MAIL_SERVER_NOREPLY_PASS` | Password for the noreply email. |
| `MAIL_SERVER_SMTP_HOST` | SMTP server address. |
| `MAIL_SERVER_SMTP_PORT` | Usually `465` (secure when `MAIL_SERVER_SECURE_STATE` is true), otherwise `587`. |

### Storage Management
Media files is being managed using a function class `storageManager` to define storage medium/destination. Local file storage is used by default, however this function can easily be configured to use Azure Blob storage by setting the following:
- `MEDIA_STORAGE`: `local` or `azure`. Set to `"azure"` to move away from local project storage. local is used when unset.
- `MEDIA_STORAGE_PATH`: This is the media container or directory setup in `site` inside the project root. Or a JSON string containing Azure credentials as below when using `azure` as media storage:
```
      {
        "AZURE_TENANT_ID": "<>",
        "AZURE_CLIENT_ID": "<>",
        "AZURE_CLIENT_SECRET": "<>",
        "STORAGE_ACCOUNT_NAME": "<storage resource name>"
        "CONTAINER_NAME": "<name of blob container>"
      }
```
- storageManager was a new introducion and may still need perfomance testing.

### Authentication (JWT & PASETO)
We prioritize **PASETO (v3)** over JWT for user authentication due to improved security. JWT is use in most other scenerio where user account authentication is not a concern. Both JWT and PASETO keys must be configured using JWT_SECRET_KEY and APP_PASETO_KEY.

- `JWT_SECRET_KEY`: For standard scenarios.
- `APP_PASETO_KEY`: Use `paseto.v3.generateKey('local', {format: "paserk"})` to generate.

- Note: Paseto v3 is currently in use internally for decoding. Hence v3 key should be generated for compartibility. Update to v4 may later be considered.
  - To Generate a valid Paseto key: `paseto.v3.generateKey('local', {format: "paserk"})`
    - See here for more: https://github.com/panva/paseto/blob/main/docs/README.md#v3generatekeypurpose-options

### Local File Management
For local files management, the following can be used to group uploaded files. All files or file directory exist in `site/files` relative ro service root
  - `tempFolder`: Set a directory for temp files that is automatically cleaned up by cron process
  - `globalPath`: Where publicly access files goes to.
  - `privatePath`: files that required authorised access
  - `tempPrivateFolder`: Temp files will still be auto deleted but required authorised access for access while available

### Database Options

| Key | Description |
| :--- | :--- |
| `DIALECT` | Sequelize is used internally as ORM and any Dialect supported by Sequelize (sqlite, postgres, mysql) can be used here. During development, `sqlite` is used for simplicity. |
| `DB_STORAGE` | Path for SQLite file. Only needed when sqlite is used. |
| `DB_HOST` | DB host address - Ignore for sqlite  |
| `DB_PORT` | DB listening port - Ignore for sqlite  |
| `DB_USER` | DB credential - Ignore for sqlite  |
| `DB_PASS` | DB crdential password  - Ignore for sqlite  |
| `DB_NAME` | The DB name on DB service/server - Ignore for sqlite  |
| `DB_SCHEMA` | When using DB like Postgres, you may have configured a dedicated schema on database for a particular service. Schema allows to use a single db for all service while dedicating schemas within same db to each service. When not set, 'public' is often used by default  |

### Misc
- If required, cookie identifiers and keys can be set using the below
    - `COOKIE_IDENTIFIER`: A unique string value
    - `COOKIE_KEYS`: Use an array of strings values for improved complexity

- Each service can be configured with a setting file that can be potentially updated directly from the UI for privileged users without requiring a redeployment. When such need arises, use `settings` key in env to set the directory containing such configuration file(s).

