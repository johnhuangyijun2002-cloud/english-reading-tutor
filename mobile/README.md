# Contextia iOS App 壳

用 [Capacitor](https://capacitorjs.com/) 把 `../frontend` 包一层原生壳，不改前端 UI，目标是上架 App Store。

## 上架进度 / 接下来要做什么

这一节是自包含的——新开一个会话、不看聊天记录，只看这一节也能接着往下做。

**代码层面已经写完、而且被 CI(`.github/workflows/ios-build.yml`，用云端 Mac 真编译过)验证过能编译通过的**：

- [x] Capacitor iOS 原生壳(CocoaPods 集成，不是 SPM，原因见下面"为什么是 CocoaPods 不是 SPM")
- [x] Sign in with Apple(后端 OAuth 接口 + 前端登录按钮 + 原生壳里系统浏览器 + deep link 跳转)
- [x] 本地推送通知(复习提醒"你有 N 个单词待复习")
- [x] 离线缓存(没网络时显示已存的文章/生词)
- [x] Apple 内购 StoreKit(iOS Pro 订阅解锁"不用自己填 AI Key，无限量用站长的 AI")
- [x] 账号自助注销(网页版设置页已经做好，iOS 复用同一套网页 UI，不用额外做)

App Store 4.2 条款(不能是纯网页套壳)要求的"实质性原生功能"、内购保留付费能力这些，代码层面已经**全部写完**，没有遗留的功能缺口。

**当前卡住的，全部是外部依赖/需要人工操作的事，不是代码问题**：

1. **Apple Developer Program 账号还没正式激活**(申请中/等审核中)。批下来之前，Sign in with Apple、Apple 内购这些没法真实联调——代码本身没问题，等的是 Apple 那边的审核结果。
2. **`APPLE_IAP_ROOT_CERTS_BASE64` 这个环境变量还没填**——需要去 <https://www.apple.com/certificateauthority/> 下载 "Apple Root CA - G3 Root"，转成 base64，填进 Railway 的环境变量面板。**这一步不需要开发者账号，现在就能做**；AI agent 做不了是因为这个开发环境的网络策略挡了 `apple.com`。
3. **这个开发环境是 Linux 容器，没有 Mac/Xcode**，所以做不了：真机/模拟器运行、代码签名、生成 `.ipa`、App Store Connect 里的商品配置、上传审核。这些必须在真实 Mac(或 Codemagic / Ionic Appflow 之类的云端 Mac 构建服务)上完成。

**账号批下来、且有 Mac 可用之后，按这个顺序做**(每一步对应的代码位置/细节在下面对应的小节里)：

1. 去 Apple Developer 后台配 Sign in with Apple 的 Services ID + 私钥，填 `APPLE_TEAM_ID` / `APPLE_SERVICES_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY`（步骤见根目录 `.env.example`，对应代码见下面"Sign in with Apple"一节）
2. 去 App Store Connect 生成 In-App Purchase Key、建 Pro 自动续费订阅商品，填 `APPLE_IAP_KEY_ID` / `APPLE_IAP_ISSUER_ID` / `APPLE_IAP_PRIVATE_KEY` / `APPLE_APP_APPLE_ID` / `APPLE_PRO_PRODUCT_ID`（步骤见根目录 `.env.example`，对应代码见下面"Apple 内购(StoreKit)"一节的"App Store Connect 里要配置的东西"）
3. `cd mobile && npm install && npm run sync:ios && cd ios/App && pod install`，然后用 Xcode 打开 `App.xcworkspace`(注意不是 `.xcodeproj`)
4. Xcode 里给 App 的 Target 加上 "In-App Purchase" capability(Signing & Capabilities 面板)
5. 真机/模拟器上跑起来，实测：Google/Apple 登录、通知权限弹窗、飞行模式下的离线缓存、StoreKit 沙盒购买流程
6. 提交 App Store 审核

## 目录说明

- `capacitor.config.json` — appId `com.contextia.app`，appName `Contextia`，`webDir` 指向 `www/`
- `scripts/build-www.mjs` — 把 `../frontend` 整份拷贝进 `www/`，并把入口页换成 `app.html`（网页版的 `index.html` 是产品介绍落地页，App 里不需要，App Store 商品页承担这个角色）
- `ios/` — `npx cap add ios --packagemanager CocoaPods` 生成的原生 Xcode 工程，**需要 Mac + Xcode 才能真正编译/签名/上传 App Store**，本仓库所在环境没有 Mac，只完成了工程脚手架；用的是 CocoaPods 集成（不是 SPM，见下面"为什么是 CocoaPods 不是 SPM"一节），打开前要先在 `ios/App` 目录跑一次 `pod install`
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
npm install                        # 装 Capacitor 依赖
npm run sync:ios                   # 拷贝最新 frontend/ 到 www/，再同步进 ios/ 工程
cd ios/App && pod install && cd -  # 装/更新原生依赖(CocoaPods)，Podfile 改了或者第一次拉仓库都要跑
npm run open:ios                   # 需要 Mac，用 Xcode 打开 App.xcworkspace(不是 .xcodeproj)
```

首次生成用的是 `npx cap add ios --packagemanager CocoaPods`；以后每次改了 `frontend/` 里的代码，都用 `npm run sync:ios` 同步，不要手动改 `ios/App/App/public` 下的文件（会被覆盖）。改了 `mobile/package.json` 里 Capacitor 插件版本之后，记得重新跑一次 `pod install`。

## 为什么是 CocoaPods 不是 SPM

Capacitor CLI 默认给新项目用 SPM(Swift Package Manager)集成，一开始这个项目也是这么生成的。但 GitHub Actions CI(见下面的"iOS 编译 CI"一节)第一次真正跑 `xcodebuild` 就发现编译不过：`@capacitor/local-notifications` 等官方插件的 Swift 源码用到的 `CAPPluginCall.getArray<T>(_:_:)` 之类的泛型 API，在 SPM 那条分发路径（`capacitor-swift-pm` 仓库，发布的是预编译的二进制 xcframework）里对不上号——换过几个 Capacitor 核心库版本都是同样的报错，说明不是版本没对齐，是 SPM 这条分发路径本身跟这批插件当前的源码不兼容。

CocoaPods 走的是另一条路：`Podfile` 里 `pod 'Capacitor', :path => '../../node_modules/@capacitor/ios'` 直接编译 npm 包 `ios/` 目录下的完整源码（插件也是同样的模式，各自指向自己在 `node_modules` 里的路径），不经过任何预编译的二进制中间层，天然不会有"源码和二进制对不上"这类问题。所以把 `ios/` 整个重新生成成了 CocoaPods 版本。

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

## Apple 内购(StoreKit)：iOS Pro 订阅解锁"不用自己填 AI Key"

网页版目前没有真正的付费墙(核心是 BYOK，自己填 AI Key 免费用；"升级到 Pro"只是等待名单)。跟你确认过，iOS Pro 订阅解锁的是：**订阅有效期内直接用站长的 `HOUSE_AI_API_KEY`，不受免费试用 10 次额度和月度预算限制**——不用自己去 DeepSeek/OpenAI 申请 Key。

不接 RevenueCat 之类的第三方内购 SaaS，自己对接 Apple 官方的 [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi)，用 Apple 官方 Python 库 `app-store-server-library`（PyPI 上现成的，不是自己写的收据校验/签名验证代码）。

### 后端(`backend/main.py` 的 `# ---------- Apple 内购(StoreKit) ----------` 一段)

- `entitlements` 表：一个用户最多一条订阅状态记录(`status` / `expires_at` / `original_transaction_id` 等)
- `GET /api/entitlement` — 前端查当前订阅状态
- `POST /api/iap/sync`（登录用户调用，App 内购买成功后前端主动同步一次）——收到 `transaction_id`，调 Apple 的 `get_all_subscription_statuses` 查真实状态(先查 Production，404 就退回 Sandbox 查——沙盒测试交易在生产环境查不到，这是 Apple 官方推荐的处理方式)，用 `SignedDataVerifier` 验证签名(顺着证书链一路验到 Apple 根证书)，写入 `entitlements`
- `POST /api/iap/notifications` — Apple 的 **App Store Server Notifications V2** webhook，订阅续费/取消/退款时 Apple 主动推给这个接口，不用等用户重新打开 App。没有登录认证，安全性靠验证 `signedPayload` 的签名
- `resolve_ai_credentials()` 改了：判断顺序变成"自己的 key → iOS Pro 订阅(用站长 key，不限量) → 免费试用额度(10 次/站长月度预算) → 报错"；Pro 订阅走的站长 key 用量**不计入**免费试用的月度预算，两者是分开算的，不然 Pro 用户用多了会把新用户的免费试用额度挤占掉

### 需要的环境变量

`APPLE_IAP_KEY_ID` / `APPLE_IAP_ISSUER_ID` / `APPLE_IAP_PRIVATE_KEY` / `APPLE_APP_APPLE_ID` / `APPLE_PRO_PRODUCT_ID` / `APPLE_IAP_ROOT_CERTS_BASE64`，配置步骤见根目录 `.env.example` 里的详细注释。没配置的话 `/api/iap/sync`、`/api/iap/notifications` 会返回清晰的 500"未配置"错误，不影响其他功能。

**`APPLE_IAP_ROOT_CERTS_BASE64` 这一步我没法替你做**：需要去 <https://www.apple.com/certificateauthority/> 下载 Apple 的根证书——这个域名在我这个开发环境的网络策略里被挡了(沙箱只放行白名单域名，`apple.com` 不在里面)，我没法帮你下载，需要你自己下载、转 base64、填进环境变量。这一步不需要 Apple Developer 账号，任何人都能下载。

### 前端(`app.js` 的 `# ---------- Apple 内购(StoreKit，原生壳专用) ----------` 一段)

用 [`capacitor-plugin-cdv-purchase`](https://www.npmjs.com/package/capacitor-plugin-cdv-purchase)（`cordova-plugin-purchase` 的 Capacitor 版，StoreKit 2 封装，同样不是第三方 SaaS，纯客户端插件）：

- `initIAP()`：注册商品(`APPLE_PRO_PRODUCT_ID` 对应的订阅)、监听购买成功事件，成功后把 `transaction.transactionId` 发给 `/api/iap/sync`，同步完 `transaction.finish()`
- 这个插件的 JS 运行时(`store.js`，约 500KB，未压缩)不是通过构建工具引入的——项目没有构建工具。`mobile/scripts/build-www.mjs` 在打包时把它从 `node_modules/capacitor-plugin-cdv-purchase/www/` 原样拷贝进 `www/vendor/cdv-purchase/`，`app.js` 用 `loadScriptOnce()` 动态加载，**只有原生壳会请求这两个文件，网页版完全不受影响**(不会拷进网页版部署，也不会有网页版加载这两个文件的代码路径)
- 复用了网页版已有的"升级到 Pro"面板(`proPanelOverlay`)：原生壳里打开这个面板，等待名单/自愿支持那两块会隐藏，换成订阅按钮 + 恢复购买按钮(苹果审核不允许同一个面板里原生 App 既有真内购、又有指向站外支付的链接)

### App Store Connect 里要配置的东西(等账号批下来、有 Mac 才能做)

1. 建一个自动续费订阅商品，Product ID 填 `APPLE_PRO_PRODUCT_ID` 那个值(默认 `com.contextia.app.pro.monthly`)
2. Xcode 里给 App 的 Target 加上 "In-App Purchase" capability(Signing & Capabilities 里加，这个我没法帮你在文件层面配好，需要人在 Xcode 里点一下)
3. 部署后端、拿到域名后，回 App Store Connect 把 App Store Server Notifications 的 Production/Sandbox URL 都填成 `https://你的域名/api/iap/notifications`

### 怎么测

真正的购买流程要走 App Store Connect 的 Sandbox 测试账号，只能在真机/模拟器上、账号批下来之后测。这个环境里能做、也做了的是：**后端这块的 JWT 签名、证书链校验、订阅状态映射逻辑，我用自己生成的假证书链跑通过一次完整的验证流程**(构造一个假的 root CA + 假的 leaf 证书签一个假的订阅交易 JWS，喂给 `SignedDataVerifier`，确认能正确解出 `productId`/`originalTransactionId`，并且证书链对不上时会正确拒绝)——验证到了 Apple 官方库对证书链的最后一步会检查一个只有真实 Apple 签发的证书才有的专属标记(`1.2.840.113635.100.6.11.1`)，这一步没法用假证书绕过，只能等有真实 Apple 收据/沙盒测试账号的时候才能验证，符合预期(这本来就是防伪造的检查点)。

## 已知待办（还没做的）

1. **账号自助注销** — 已经在网页版做好了（设置页），iOS 端复用同一套网页 UI，不用额外做。

## iOS 编译 CI

`.github/workflows/ios-build.yml`：这个开发环境是 Linux 容器，没有 Mac/Xcode，写 iOS 原生代码只能靠语法/逻辑检查，没法真正编译。这个 workflow 用 GitHub 提供的云端 macOS runner，在每次改动 `mobile/` 或 `frontend/` 时真正跑一次 `pod install` + `xcodebuild`（模拟器目标，不需要签名证书），验证工程到底编译能不能过——上面那次 SPM 编译不过、换成 CocoaPods 这两轮排查，都是靠这个 CI 的真实报错定位出来的，不是靠读代码猜的。

不做签名、不装真机/模拟器、不跑交互测试（登录弹窗、通知权限这些需要人工点）——那些需要 Apple Developer 账号和真机/模拟器的图形界面，CI 做不到，得在真 Mac 上做。

## App Store 4.2 与真机构建的现实限制

这个开发环境是 Linux 容器，没有 Mac/Xcode，所以：

- 能做：生成/维护 Capacitor 配置和 `ios/` 工程骨架、写前端联调代码（API_BASE 等）、写后端新接口（Apple 登录回调、StoreKit 收据校验等）、靠 CI 验证工程编译能不能过
- 不能做：真机/模拟器运行、代码签名、生成 `.ipa`、上传 App Store Connect、任何需要人工点击的交互测试 —— 这些步骤需要在实际 Mac（或 Codemagic / Ionic Appflow 之类的云端 Mac 构建服务）上完成
