// 把 ../frontend 整份拷贝进 mobile/www，再把入口页换成 app.html(阅读器主界面)。
// frontend/index.html 是网页版的产品介绍落地页，App Store 上架后这个落地页的角色由
// App Store 商品页承担，原生 App 打开应该直接进阅读器，不用再看一遍介绍页。
//
// 每次改了 frontend/ 下的内容，或者要同步新的后端域名(native-config.js)，都要重新跑
// 这个脚本(通过 `npm run sync:ios`，它会先执行本脚本再执行 `cap sync ios`)。
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "../../frontend");
const wwwDir = path.resolve(here, "../www");
const nodeModulesDir = path.resolve(here, "../node_modules");

if (existsSync(wwwDir)) rmSync(wwwDir, { recursive: true, force: true });
cpSync(frontendDir, wwwDir, { recursive: true });

// Apple 内购(StoreKit)插件的 JS 运行时——原生壳专用，不是通过构建工具打包进来的，
// 就是把插件包里现成的 www/ 文件原样拷过来。app.js 用 loadScriptOnce() 动态加载这两个
// 文件，只有原生壳会真的去请求它们，网页版不受影响(也不会去拷贝这份到网页版部署里，
// 因为这一步只发生在 mobile/ 的构建流程里)。
const purchasePluginWww = path.join(nodeModulesDir, "capacitor-plugin-cdv-purchase", "www");
if (existsSync(purchasePluginWww)) {
  const vendorDir = path.join(wwwDir, "vendor", "cdv-purchase");
  mkdirSync(vendorDir, { recursive: true });
  cpSync(path.join(purchasePluginWww, "store.js"), path.join(vendorDir, "store.js"));
  cpSync(path.join(purchasePluginWww, "capacitor-plugin.js"), path.join(vendorDir, "capacitor-plugin.js"));
}

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
