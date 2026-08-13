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

## Sign in with Apple（已完成代码，等 Apple Developer 账号批下来才能真正联调）

跟 Google 登录走的是同一套服务端 OAuth 结构，代码在 `backend/main.py` 的 `# ---------- Apple 登录 / 关联 ----------` 那一段：

- `GET /api/auth/apple/login` — 跳转到 `appleid.apple.com` 授权页
- `POST /api/auth/apple/callback` — Apple 用 `response_mode=form_post` 把 `code` 回传（不是 GET query string），换 token、验证 `id_token` 签名(用 Apple 的 JWKS)、建号或登录
- `client_secret` 不是固定字符串，是每次现算的一个 ES256 JWT，用 Apple 后台生成的 `.p8` 私钥签（见 `_apple_client_secret`）
- 需要的环境变量：`APPLE_TEAM_ID` / `APPLE_SERVICES_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY`，配置步骤和获取位置见根目录 `.env.example` 里的注释。账号还没批下来之前，这几个变量不填，`/api/auth/apple/login` 会返回清晰的 500 "未配置" 错误，不影响其他功能。

**账号批下来之后怎么测（不需要 Xcode/Mac）**：这是标准的网页 OAuth 跳转流程，配好上面四个环境变量、部署到 Railway 后，直接打开网页版 `/app.html`，点登录框里的 "Sign in with Apple" 按钮，用你自己的 Apple ID 走一遍，跟测 Google 登录一样，在普通浏览器里就能验证后端逻辑对不对。原生 App 壳里的集成效果（系统浏览器打开 + deep link 跳回 App）要在真机/模拟器里才能测，见下一节。

## 原生壳里的 OAuth 跳转方式（Google + Apple 共用）

网页版登录/关联点击后是 `location.href` 整页跳转，跳回来时 URL 带 `#token=...`（`app.js` 里 `finishOAuthCallback` 解析）。这个方式在原生壳里行不通——会把 App 自己的 WebView 导航去后端域名，等于半路"跳出" App。已经改成：

- `app.js` 里的 `startOAuthFlow()`：检测到是原生环境（`Capacitor.isNativePlatform()`）就用 `@capacitor/browser` 打开系统浏览器（iOS 上是 `ASWebAuthenticationSession`/`SFSafariViewController`），并在登录 URL 上带 `?platform=ios`
- 后端 `_oauth_success_redirect()`：登录成功后，如果 state 里记着 `platform=ios`，就不跳 `/app.html#token=...`，改跳自定义 URL scheme `com.contextia.app://oauth-callback#token=...`
- `mobile/ios/App/App/Info.plist` 已经注册了 `com.contextia.app` 这个 URL scheme（`CFBundleURLTypes`）
- `app.js` 里用 `@capacitor/app` 的 `App.addListener("appUrlOpen", ...)` 接住这个 deep link，调用同一个 `finishOAuthCallback()` 完成登录

这部分逻辑本身在这个 Linux 容器里没法端到端验证（需要真机/模拟器点一下系统浏览器跳回 App 的过程），但网页版的行为（`isNativeApp()` 返回 false，走原来的 `location.href`）已经确认没被破坏。

## 推送通知（本地通知，应付 App Store 4.2 条款）

用的是**本地通知**（`@capacitor/local-notifications`），不是服务端 APNs 推送——不需要 APNs 推送证书、不需要后端另外搭推送队列，现在就能测（真机/模拟器即可，不需要付费 Apple Developer 账号）。代码在 `app.js` 的 `# ---------- 推送通知 ----------` 那一段：

- `scheduleReviewReminders()`：App 每次打开（`initApp()` 里调用）都会先请求通知权限（`LocalNotifications.checkPermissions`/`requestPermissions`），再读一次 `/api/review/due-counts` 算出待复习总数，撤销之前预约的提醒，重新预约未来 7 天、每天上午 10 点一条"你有 N 个单词待复习"
- **已知局限**：这是"预约"出来的通知，不是服务端主动推送。如果用户连续超过 7 天不打开 App，预约会用完，得下次打开才重新续上；预约的这几天里数字也是打开 App 那一刻的快照，不会随着中途复习而实时更新。真正做到"无论多久不开都能收到实时提醒"需要服务端 APNs 推送（存 push token、后端定时任务、调 APNs 接口），工作量明显更大，等 Apple Developer 账号批下来、有需要再做
- 通知文案在 `i18n/*.json` 的 `notifications.reviewDue`

**怎么测**：真机或 Xcode 模拟器上跑起来，登录后允许通知权限，把系统时间往后调（或者把 `REVIEW_REMINDER_HOUR`/`REVIEW_REMINDER_DAYS` 临时改小方便测），看通知中心有没有出现"你有 N 个单词待复习"。这个跟 Apple Developer 付费账号无关，只需要能跑起 iOS 模拟器的 Mac。

## 离线缓存（应付 App Store 4.2 条款）

原生壳专用，网页版不受影响（网页本身就要联网）。代码在 `app.js` 的 `# ---------- 离线缓存 ---------- ` 那一段：

- `fetchJsonWithOfflineCache(path, cacheKey)` / `getVocabAndNotes()`：包装了文章列表(`/api/documents`)、生词(`/api/vocab`)、句子笔记(`/api/sentence_notes`)这几个读接口——请求成功就顺手用 `@capacitor/filesystem` 写一份 JSON 到设备本地(`Directory.DATA` 下的 `offline-cache/` 目录)；请求失败(没网络、后端暂时不可用)且本地有上次成功缓存过的内容，就退回显示那份缓存，并在顶部露出一条"离线中"的黄色横幅(`#offlineBanner`，`offline.banner` 文案)
- 因为 `/api/documents` 返回的文档列表本身就带着文章正文(`content` 字段)，缓存这一个接口就够让"已经打开过的文章"离线也能读，不需要再单独缓存每篇文章的正文
- `refreshDocuments`、`loadKnownWords`、`renderHistoryForDoc`、`loadSearchData`（生词本搜索面板）、打印功能这几处原来各自重复写的 `apiFetch("/api/vocab")` + `apiFetch("/api/sentence_notes")` 现在都改成调用同一个 `getVocabAndNotes()`，缓存逻辑只用维护一处

**怎么测**：真机/模拟器上登录、打开几篇文章、存几个生词，然后开飞行模式，重新打开 App——应该还能看到刚才打开过的文章和生词本，顶部会有离线横幅。这个也不需要付费 Apple Developer 账号，只需要能跑 iOS 模拟器的 Mac。

## 已知待办（还没做的）

1. **Apple 内购(StoreKit)** — 因为要在 iOS 保留付费能力（不做免费版），需要新增：商品配置、购买流程、订单校验、恢复购买；后端要能区分"网页 Stripe 付费"和"iOS 内购付费"两套状态并保持同步。工作量最大的一块。
2. **账号自助注销** — 已经在网页版做好了（设置页），iOS 端复用同一套网页 UI，不用额外做。

## App Store 4.2 与真机构建的现实限制

这个开发环境是 Linux 容器，没有 Mac/Xcode，所以：

- 能做：生成/维护 Capacitor 配置和 `ios/` 工程骨架、写前端联调代码（API_BASE 等）、写后端新接口（Apple 登录回调、StoreKit 收据校验等）
- 不能做：真正 `xcodebuild` 编译、真机/模拟器运行、代码签名、生成 `.ipa`、上传 App Store Connect —— 这些步骤需要在实际 Mac（或 Codemagic / Ionic Appflow 之类的云端 Mac 构建服务）上完成
