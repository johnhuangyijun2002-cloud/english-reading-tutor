// 把 ../frontend 整份拷贝进 mobile/www，再把入口页换成 app.html(阅读器主界面)。
// frontend/index.html 是网页版的产品介绍落地页，App Store 上架后这个落地页的角色由
// App Store 商品页承担，原生 App 打开应该直接进阅读器，不用再看一遍介绍页。
//
// 每次改了 frontend/ 下的内容，或者要同步新的后端域名(native-config.js)，都要重新跑
// 这个脚本(通过 `npm run sync:ios`，它会先执行本脚本再执行 `cap sync ios`)。
import { cpSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "../../frontend");
const wwwDir = path.resolve(here, "../www");

if (existsSync(wwwDir)) rmSync(wwwDir, { recursive: true, force: true });
cpSync(frontendDir, wwwDir, { recursive: true });

writeFileSync(
  path.join(wwwDir, "index.html"),
  `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Contextia</title></head>
<body>
<script>location.replace("app.html");</script>
</body>
</html>
`
);

console.log(`已把 frontend/ 同步到 ${path.relative(process.cwd(), wwwDir)}，入口改成 app.html`);
