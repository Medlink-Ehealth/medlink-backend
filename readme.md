# Help
You stay in the root directory and use the --filter flag. You almost never need to cd into the subfolders.
 - To add a package to a specific service:
    - pnpm add express --filter auth-service

 - To add same package to all services:
    - pnpm add koa --filter "./apps/**"

  - To add a shared/common internal library to a service:
    - pnpm add @medlink/common --filter auth-service --workspace

  - To install everything in the whole repo:
    - pnpm install

Only use the root package.json for:
  - Dev-wide tools: Things that apply to the whole repo, like prettier, eslint, or typescript.
  - Global scripts: Shortcuts like "build:all": "pnpm -r run build".





