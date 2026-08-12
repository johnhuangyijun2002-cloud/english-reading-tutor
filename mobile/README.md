# Contextia iOS App 壳

用 [Capacitor](https://capacitorjs.com/) 把 `../frontend` 包一层原生壳，不改前端 UI，目标是上架 App Store。

## 目录说明

- `capacitor.config.json` — appId `com.contextia.app`，appName `Contextia`，`webDir` 指向 `www/`
- `scripts/build-www.mjs` — 把 `../frontend` 整份拷贝进 `www/`，并把入口页换成 `app.html`（网页版的 `index.html` 是产品介绍落地页，App 里不需要，App Store 商品页承担这个角色）
- `ios/` — `npx cap add ios` 生成的原生 Xcode 工程，**需要 Mac + Xcode 才能真正编译/签名/上传 App Store**，本仓库所在环境没有 Mac，只完成了工程脚手架
- `www/` — 构建产物，被 `.gitignore` 排除，不提交；每次改了 `frontend/` 之后要重新生成

## 后端地址（必须先改这个才能真机联调）

`frontend/native-config.js` 里的 `CONTEXTIA_PRODUCTION_API_BASE` 目前是占位符
`https://REPLACE_WITH_YOUR_RAILWAY_DOMAIN.up.railway.app`。Railway 部署好、拿到域名后：

1. 把 `CONTEXTIA_PRODUCTION_API_BASE` 换成实际域名
2. 在 `mobile/` 目录跑 `npm run sync:ios`（重新拷贝 www 并同步进 iOS 工程）

App 内所有 `/api/xxx` 请求都经过 `frontend/app.js` 顶部的 `API_BASE` 常量：网页版这个值是空字符串（相对路径不变），原生壳里会自动换成上面配置的绝对地址。后端 CORS 已经是 `allow_origins=["*"]`，跨源请求不受影响。

## 本地开发 / 同步

```bash
cd mobile
npm install       # 装 Capacitor 依赖
npm run sync:ios  # 拷贝最新 frontend/ 到 www/，再同步进 ios/ 工程
npm run open:ios  # 需要 Mac，用 Xcode 打开工程
```

首次生成用的是 `npx cap add ios`；以后每次改了 `frontend/` 里的代码，都用 `npm run sync:ios` 同步，不要手动改 `ios/App/App/public` 下的文件（会被覆盖）。

## 已知待办（这一步 Capacitor 套壳之外的工作）

1. **Sign in with Apple** — 苹果强制要求（App 里已有 Google 第三方登录）。需要后端加一套 Apple OAuth 处理，前端加登录按钮。
2. **Google 登录在原生壳里的可靠性** — 现在 `app.js` 里 Google 登录还是 `location.href` 整页跳转到后端 `/api/auth/google/login`，在内嵌 WebView 里跳转 Google 登录页有被拒绝的风险（Google 对内嵌 WebView 的 OAuth 支持在收紧）。建议跟 Sign in with Apple 一起重做，改成 `@capacitor/browser` 打开系统浏览器 + 自定义 URL scheme(`com.contextia.app://`) 或 Universal Link 回调的方案，避免整页跳转。相关代码位置见 `app.js` 里两处 `TODO(iOS App)` 注释。
3. **App Store 4.2 条款**（不能是纯网页套壳）——优先做推送通知（"你有 N 个单词待复习"，跟间隔重复功能天然契合），其次做离线缓存（已存内容不联网也能看）。这一步的 Capacitor 套壳本身只是把网页装进原生容器，还不构成"实质性原生功能"。
4. **Apple 内购(StoreKit)** — 因为要在 iOS 保留付费能力（不做免费版），需要新增：商品配置、购买流程、订单校验、恢复购买；后端要能区分"网页 Stripe 付费"和"iOS 内购付费"两套状态并保持同步。工作量最大的一块，预计要在 App 里新增一层 entitlement（付费状态）查询逻辑，并在后端加对应的收据校验接口。
5. **账号自助注销** — 已经在网页版做好了（设置页），iOS 端复用同一套网页 UI，不用额外做。

## App Store 4.2 与真机构建的现实限制

这个开发环境是 Linux 容器，没有 Mac/Xcode，所以：

- 能做：生成/维护 Capacitor 配置和 `ios/` 工程骨架、写前端联调代码（API_BASE 等）、写后端新接口（Apple 登录回调、StoreKit 收据校验等）
- 不能做：真正 `xcodebuild` 编译、真机/模拟器运行、代码签名、生成 `.ipa`、上传 App Store Connect —— 这些步骤需要在实际 Mac（或 Codemagic / Ionic Appflow 之类的云端 Mac 构建服务）上完成
