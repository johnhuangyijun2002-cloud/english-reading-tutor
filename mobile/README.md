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
- [x] 隐私政策 & 服务条款已经按 App Store 3.1.2/5.1.1 条款要求补全(Sign in with Apple、内购数据处理、订阅价格/周期/自动续费/退款条款、购买按钮旁边的实时价格披露)，细节见下面"隐私政策 & 服务条款"一节

App Store 4.2 条款(不能是纯网页套壳)要求的"实质性原生功能"、内购保留付费能力这些，代码层面已经**全部写完**，没有遗留的功能缺口。

**Apple Developer 账号已经激活，账号/后台相关的配置已经做完**：

- [x] **Apple Developer Program 账号已激活**（个人身份，Team ID `6G7ZJV58R2`）
- [x] **Sign in with Apple 配置完 + 已经端到端测试成功**（网页版实测走通了 Apple 登录关联）。用到的标识：App ID `com.contextia.app`、Services ID `com.contextia.app.signin`、Key ID `ZS94X297U5`。四个环境变量（`APPLE_TEAM_ID`/`APPLE_SERVICES_ID`/`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY`）已经填进 Railway。
  - 中途修过一个真实 bug：Apple 回调是 POST，后端跳转默认用的 307 会让浏览器带着 POST 方法重新请求 `/app.html`（只认 GET），报 405——改成显式 303（Post/Redirect/Get 标准做法）解决了，见 `_oauth_success_redirect`。
- [x] **Apple 内购(StoreKit)服务端配置也填完了**：App Store Connect 里建好了 App(Apple ID `6801417907`)、生成了 In-App Purchase Key(Key ID `3F58RKYX7Q`，Issuer ID `3c38958f-02b5-4602-a679-13b5a85f4a4c`)、建好了 Pro 订阅商品(Product ID `com.contextia.app.pro.monthly`)、配好了 App Store Server Notifications 的 webhook 地址。六个环境变量（`APPLE_IAP_KEY_ID`/`APPLE_IAP_ISSUER_ID`/`APPLE_IAP_PRIVATE_KEY`/`APPLE_APP_APPLE_ID`/`APPLE_PRO_PRODUCT_ID`/`APPLE_IAP_ROOT_CERTS_BASE64`）已经填进 Railway。
  - **这块配置本身对不对还没最终验证**——推荐先用下面"Apple 内购(StoreKit)"一节里"怎么测"提到的 curl 命令测一次（拿假 transaction_id 调 `/api/iap/sync`，能自己判断凭据有效还是失败），不用等 Xcode 才发现配错了。

**当前卡住的，就剩这一件事**：

- **这个开发环境是 Linux 容器，没有 Mac/Xcode**，所以做不了：真机/模拟器运行、代码签名、生成 `.ipa`、上传审核。账号和后端这两块的配置已经不再是阻塞了。

**现在就能做，不用等 Mac**：App Store Connect 里配 Privacy Policy URL、App Privacy 问卷、订阅商品的本地化名称/描述——这几步是后台点点点，跟 Xcode 无关，见下面"隐私政策 & 服务条款"一节的清单。

**关于"In-App Purchase capability"这一步——之前以为必须在 Xcode 里点，查证后发现大概率不需要**：In-App Purchase 没有专属的 entitlement key，只要 App 用的是正式注册的 App ID(不是通配符 `*` 那种)，内购能力就是默认可用的——`com.contextia.app` 已经是正式注册的 App ID。Xcode 那个 capability 开关主要是链接 `StoreKit.framework`，而这个已经通过 `capacitor-plugin-cdv-purchase` 这个 CocoaPods 依赖间接链进来了。等有 Xcode 的时候顺手看一眼 Signing & Capabilities 有没有就行，大概率不需要额外操作，不是一个真正卡流程的步骤。

**关于 CI**：`.github/workflows/ios-build.yml` 已经把 runner 从 `macos-14` 升到了 `macos-26`（默认带 Xcode 26.6）——苹果从 2026 年 4 月 28 日起要求提交审核必须用 Xcode 26 以上编译，旧 runner 的 Xcode 版本达不到，不管接下来走哪条路都得先解决这个。

**测试/上架不一定非要自己有 Mac——方案 A 已经跑通了**：`iOS release to TestFlight` workflow 手动触发成功过（2026-08-14，run #3），签名、打包、上传 TestFlight 全流程验证通过，第一个 build 已经在 TestFlight 里了。扩展现有 GitHub Actions CI，把签名后的包直接传上 TestFlight，之后所有测试都在自己的 iPhone 上用 TestFlight App 完成，全程不用租 Mac、不用碰 Xcode。选这个而不是 Capgo/EAS/Ionic Appflow 这些第三方云构建服务，是因为签名证书/密钥能一直只放在这个仓库自己的 GitHub Secrets 里，不用交给任何第三方托管——跟这个项目一直坚持的自建思路一致。代码在 `.github/workflows/ios-release.yml` + `mobile/ios/ExportOptions.plist`，配置细节见下面"方案 A：云端签名 + 上传 TestFlight"一节。

（如果之后想要"改了代码马上肉眼看效果"的交互式调试，还有个方案 B：按小时租云端 Mac 比如 MacinCloud，在 Xcode 模拟器里跑——不是当前优先级，需要的时候再问我要详细步骤。）

**真机测试进度（2026-08-15）**：

- [x] 用户名密码注册/登录——一开始因为 `native-config.js` 的后端地址还是占位符，全部联网操作都 404，修好后正常
- [x] 服务条款/隐私政策链接——原生壳里之前是站内相对路径，点了没反应，改成绝对地址后正常
- [x] StoreKit 面板能正常初始化、显示价格、"订阅"按钮可点——中途连续修了两个真实 bug：① 内购插件没有走 npm 包正常的 `registerPlugin` 流程（这个项目没构建工具，是手动加载插件的 www/ 源文件），要手动补一次 `Capacitor.registerPlugin`；② 插件自己的初始化代码探测到 `window.cordova`(Capacitor 原生桥接脚本自带的) 存在，会把初始化推迟到下一个事件循环 tick，我们的代码读早了一个 tick，要多等一下
- [x] **StoreKit 购买流程走到底**——原计划推迟到提交审核之后验证，但后来发现韩国税务/事业者登陆证问题（留学生 D-2 签证原则上不能做营利性登记）会挡住收付费这条路，短期内解决不了。**决定先不接内购，iOS 这次直接以免费版提交**：`frontend/app.js` 加了 `IAP_SUBMISSION_ENABLED = false` 开关，原生壳"升级到 Pro"面板现在跟网页版一样显示等待名单，不显示订阅按钮；App Store Connect 那边也不用把 Contextia Pro 订阅加进这次审核。订阅相关代码全部保留，以后签证/税务问题解决了，把开关改回 `true`、订阅加入审核即可，不用重新开发（2026-08-19）
- [ ] Google 登录——还没实测
- [ ] Apple 登录（原生壳里系统浏览器 + deep link 那条路径）——还没实测，网页版走通过，但原生壳这条路径没验证过
- [ ] 通知权限弹窗——还没实测
- [ ] 离线缓存（飞行模式下看已存内容）——还没实测

**App Store Connect 后台还需要确认/完成的**（见下面"隐私政策 & 服务条款"一节的完整清单）：Privacy Policy URL、App Privacy 隐私问卷、订阅商品的本地化显示名称——这几项之前列过，还没有逐条跟你确认是否已经填完。

**提交审核**：按你的要求先不做，等你想清楚再说。真要提交的时候需要准备：App 截图（不同尺寸机型）、宣传文字、关键词、分类、年龄分级，这些我没法替你准备（需要真机截图），到时候再一起梳理。**这次先按免费版提交**（不含 Contextia Pro 订阅，见上面"真机测试进度"最后一条）。

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

**留意一下**：Capacitor 官方计划把 CocoaPods 上的库维护到 2026 年 12 月 2 日，之后的重心会全部转向 SPM。现在(2026-08)用 CocoaPods 还没问题，但如果上架这件事拖过年底，可能得回头重新试一次 SPM 这条路径（说不定到时候插件源码和 SPM 分发已经同步好了，最初踩的那个坑不一定还在）。

## Sign in with Apple（配置完成，网页版已经端到端测试成功）

跟 Google 登录走的是同一套服务端 OAuth 结构，代码在 `backend/main.py` 的 `# ---------- Apple 登录 / 关联 ----------` 那一段：

- `GET /api/auth/apple/login` — 跳转到 `appleid.apple.com` 授权页
- `POST /api/auth/apple/callback` — Apple 用 `response_mode=form_post` 把 `code` 回传（不是 GET query string），换 token、验证 `id_token` 签名(用 Apple 的 JWKS)、建号或登录
- `client_secret` 不是固定字符串，是每次现算的一个 ES256 JWT，用 Apple 后台生成的 `.p8` 私钥签（见 `_apple_client_secret`）
- 需要的环境变量：`APPLE_TEAM_ID` / `APPLE_SERVICES_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY`，配置步骤和获取位置见根目录 `.env.example` 里的注释。**这几个已经配好、部署到 Railway 了**。

**已经测过、真实走通了**：网页版 `/app.html` 点 "Sign in with Apple"，走一遍 Apple 登录授权，成功关联/登录。中途踩过一个坑：Apple 的回调是 `POST`（`response_mode=form_post`），后端登录成功后跳转 `/app.html` 用的 `RedirectResponse` 没显式指定状态码，默认是 `307`——307 会让浏览器带着原来的 `POST` 方法重新请求跳转目标，而 `/app.html` 只支持 `GET`，于是报 `405 Method Not Allowed`。Google 登录因为回调本身就是 `GET`，从来没踩到这个坑。修法：`_oauth_success_redirect()` 显式传 `status_code=303`（标准的 Post/Redirect/Get 模式，不管原请求是什么方法，跳转后都强制用 GET）。

原生 App 壳里的集成效果（系统浏览器打开 + deep link 跳回 App）还没测——这个要在真机/模拟器里才能测，见下一节。

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
- **已知局限**：这是"预约"出来的通知，不是服务端主动推送。如果用户连续超过 7 天不打开 App，预约会用完，得下次打开才重新续上；预约的这几天里数字也是打开 App 那一刻的快照，不会随着中途复习而实时更新。真正做到"无论多久不开都能收到实时提醒"需要服务端 APNs 推送（存 push token、后端定时任务、调 APNs 接口），工作量明显更大，有需要再做
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

`APPLE_IAP_KEY_ID` / `APPLE_IAP_ISSUER_ID` / `APPLE_IAP_PRIVATE_KEY` / `APPLE_APP_APPLE_ID` / `APPLE_PRO_PRODUCT_ID` / `APPLE_IAP_ROOT_CERTS_BASE64`，配置步骤见根目录 `.env.example` 里的详细注释。**这六个已经配好、部署到 Railway 了**：

- `APPLE_IAP_KEY_ID` = `3F58RKYX7Q`
- `APPLE_IAP_ISSUER_ID` = `3c38958f-02b5-4602-a679-13b5a85f4a4c`
- `APPLE_APP_APPLE_ID` = `6801417907`
- `APPLE_PRO_PRODUCT_ID` = `com.contextia.app.pro.monthly`（App Store Connect 里建的订阅商品 Product ID 也是这个，两边保持一致）
- `APPLE_IAP_PRIVATE_KEY` / `APPLE_IAP_ROOT_CERTS_BASE64` 是私钥/证书内容，不记录在这里，已经直接填进 Railway

`APPLE_IAP_ROOT_CERTS_BASE64` 用的是 "Apple Root CA - G3 Root"（<https://www.apple.com/certificateauthority/> 下载），已经用 `openssl x509` 验证过是真实有效的 Apple 根证书（Subject/Issuer 都是 `Apple Root CA - G3`，SHA-256 指纹 `63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79`，跟 Apple 官方公布的一致）。

App Store Connect → App 信息 → App Store Server Notifications 的 Production/Sandbox URL 也已经配成 `https://contextia.up.railway.app/api/iap/notifications`。

### 前端(`app.js` 的 `# ---------- Apple 内购(StoreKit，原生壳专用) ----------` 一段)

用 [`capacitor-plugin-cdv-purchase`](https://www.npmjs.com/package/capacitor-plugin-cdv-purchase)（`cordova-plugin-purchase` 的 Capacitor 版，StoreKit 2 封装，同样不是第三方 SaaS，纯客户端插件）：

- `initIAP()`：注册商品(`APPLE_PRO_PRODUCT_ID` 对应的订阅)、监听购买成功事件，成功后把 `transaction.transactionId` 发给 `/api/iap/sync`，同步完 `transaction.finish()`
- 这个插件的 JS 运行时(`store.js`，约 500KB，未压缩)不是通过构建工具引入的——项目没有构建工具。`mobile/scripts/build-www.mjs` 在打包时把它从 `node_modules/capacitor-plugin-cdv-purchase/www/` 原样拷贝进 `www/vendor/cdv-purchase/`，`app.js` 用 `loadScriptOnce()` 动态加载，**只有原生壳会请求这两个文件，网页版完全不受影响**(不会拷进网页版部署，也不会有网页版加载这两个文件的代码路径)
- 复用了网页版已有的"升级到 Pro"面板(`proPanelOverlay`)：原生壳里打开这个面板，等待名单/自愿支持那两块会隐藏，换成订阅按钮 + 恢复购买按钮(苹果审核不允许同一个面板里原生 App 既有真内购、又有指向站外支付的链接)

### App Store Connect 里要配置的东西

1. ~~建一个自动续费订阅商品~~ ✅ 已建好，Product ID `com.contextia.app.pro.monthly`
2. ~~Xcode 里给 App 的 Target 加上 "In-App Purchase" capability~~ 查证后发现不需要（没有专属 entitlement，App ID 已经是正式注册的，StoreKit 已经通过内购插件的 pod 间接链接了），详见下面"方案 A"一节的说明
3. ~~配 App Store Server Notifications 的 Production/Sandbox URL~~ ✅ 已经配成 `https://contextia.up.railway.app/api/iap/notifications`
4. **首个订阅必须随 App 首个版本一起提交审核，之前才发现这个规则**——App Store Connect 的 Contextia Pro 订阅页面明确提示"首个订阅群组必须随新 App 版本一起提交"，这意味着 StoreKit 沙盒测试里"拉取商品报价"这一步，在真正提交审核之前测不通（会报"订阅信息加载失败"）。这不是代码或配置问题，代码这边已经验证到"能正确弹出购买面板、价格展示逻辑都对"这一步为止，购买流程的最后一段只能等提交审核之后才能继续验证。

### 怎么测

**不需要 Xcode/Mac 就能先验证凭据本身对不对**：登录网页版拿到 `authToken`（浏览器开发者工具 → Application → Local Storage），拿一个假的 `transaction_id` 调一次 `/api/iap/sync`：

```bash
curl -X POST https://contextia.up.railway.app/api/iap/sync \
  -H "Authorization: Bearer <你的 authToken>" \
  -H "Content-Type: application/json" \
  -d '{"transaction_id": "123456789"}'
```

- 如果报"认证失败"之类的错 → Key ID / Issuer ID / 私钥这三个有问题
- 如果报"没找到这笔交易"（`No matching subscription found` 或 404）→ 说明 Apple 已经认可了签名，凭据本身是对的，只是这笔交易不存在（预期结果，因为 ID 是瞎填的）

真正的购买流程还是要走 App Store Connect 的 Sandbox 测试账号，只能在真机/模拟器上测，等有 Mac 才能做。这个开发环境里能做、也做了的是：**后端这块的 JWT 签名、证书链校验、订阅状态映射逻辑，用自己生成的假证书链跑通过一次完整的验证流程**(构造一个假的 root CA + 假的 leaf 证书签一个假的订阅交易 JWS，喂给 `SignedDataVerifier`，确认能正确解出 `productId`/`originalTransactionId`，并且证书链对不上时会正确拒绝)——验证到了 Apple 官方库对证书链的最后一步会检查一个只有真实 Apple 签发的证书才有的专属标记(`1.2.840.113635.100.6.11.1`)，这一步没法用假证书绕过，只能等有真实 Apple 收据/沙盒测试账号的时候才能验证，符合预期(这本来就是防伪造的检查点)。

## 广告变现（预留接口，暂未接入，2026-08-19）

除了订阅制的 Contextia Pro，广告是另一条潜在的变现路径，但目前还没接——不是技术问题，是身份问题：
用户是韩国的 D-2 留学签证，原则上不能从事营利性活动，这个限制看的是"活动"本身（持续运营一个带
广告变现的 App、收取广告收入），跟广告平台/收款方注册在哪个国家、收款账户是个人还是公司都无关，
换成中国的广告联盟也一样绕不开。这件事没解决之前不会真的接广告，但代码里先留好接口，免得以后想接
的时候要临时改一堆调用方代码。

- `frontend/ads.js` — 统一的调用入口，`ADS_ENABLED` 常量控制开关，现在是 `false`，所有方法都是空
  实现。跟 `frontend/app.js` 里 `IAP_SUBMISSION_ENABLED` 那个开关是同一个模式（先把接口留好，等
  条件成熟了再翻开关，不用重新设计）
- `app.html` 里 `#adBannerSlot` 是预留的横幅广告容器，`ADS_ENABLED` 为 `false` 时一直是空的、不
  占布局空间
- 启动时会调用一次 `window.ContextiaAds.init()`（在 `app.js` 顶部启动的 IIFE 里，紧跟着
  `fixLegalLinksForNative()`），目前是空操作

**候选广告网络**（技术选型层面的调研，不代表已决定接哪个）：Google AdMob、AppLovin (MAX)、
Unity Ads/LevelPlay、Meta Audience Network、Pangle——AdMob 收款本身允许直接付款给个人（账户类型
选"个人"，不需要公司/사업자등록证），这跟 Apple 的 Paid Apps Agreement（明确要求韩国区收款方是
登记过的韩国税务主体）不是一回事；但这只是说 Google 自己的收款政策没有这个门槛，不代表签证问题
就解决了——两者是独立的两件事，见上面这段。

**真要开启的时候需要做的事**（目前都还没做）：
1. 确认签证/身份问题已经解决（换签证、有合法工作许可、或者找到确实合规的收入安排方式）
2. 选定广告网络，注册开发者账号，创建广告单元
3. 在 `mobile/ios/App/Podfile` 加对应 CocoaPods 依赖
4. `Info.plist` 加 `GADApplicationIdentifier` / `SKAdNetworkItems` / `NSUserTrackingUsageDescription`
5. 实现 App Tracking Transparency 弹窗授权流程（iOS 14+ 强制要求，不弹这个广告 SDK 拿不到跨 App
   追踪权限，也会被审核拒）
6. App Store Connect 的 App Privacy 问卷要更新（声明用了广告/追踪相关的数据收集）
7. 把 `ads.js` 里的空方法换成真实 SDK 调用，`ADS_ENABLED` 改成 `true`

## 隐私政策 & 服务条款（App Store 审核 3.1.2 / 5.1.1 条款要求）

Apple 审核订阅类 App 时会专门查两件事：隐私政策有没有覆盖到 iOS 特有的数据处理（Sign in with Apple、StoreKit 订阅），以及订阅的价格/周期/自动续费信息有没有在**购买按钮附近**明确展示，不能只写在一个单独的条款页面里。这两块代码都已经做完：

**代码里已经做完的**（`frontend/privacy.html`、`frontend/terms.html`、`frontend/app.html`、`frontend/app.js`、`i18n/*.json`）：

- `privacy.html` 加了：Sign in with Apple 作为登录方式之一、iOS 内购的数据处理说明（付款信息完全由 Apple 处理，我们只拿到订阅状态收据，不经手银行卡信息）、本地通知不上传任何数据的说明、iOS 离线缓存的说明
- `terms.html` 加了一整段"Contextia Pro subscription (iOS app)"，按 Apple 3.1.2 要求写全了：订阅名称/时长/价格说明、扣款和自动续费规则、怎么取消（走 Apple ID 账户设置，不是找我们）、退款走 Apple 的政策
- `app.html` 的订阅面板（`iapProBlock`）里，"订阅"按钮旁边现在会展示价格 + 自动续费提示 + 服务条款/隐私政策链接（`app.js` 的 `getIapPriceString()` 会读 StoreKit 返回的当地货币真实价格，不是写死的数字）——这是 Apple 审核时人工会去点的地方，不是随便找个角落放个链接就行
- 登录页（`app.html` 里 `login.legalPrefix` 那一行）本来就有条款/隐私链接，Apple/Google/Apple 三种登录方式共用，不用改
- 三个语言（en/zh/ko）的文案都补了

**接下来需要你在 App Store Connect 后台手动配置的**（代码管不到，必须人工操作）：

1. **App 信息 → Privacy Policy URL**：必填项，填 `https://contextia.up.railway.app/privacy.html`（如果之后换域名，记得同步改这里）
2. **App 信息 → License Agreement（EULA）**：默认用 Apple 提供的标准 EULA 就够了，不用额外操作；如果想用自己的条款覆盖默认的，才需要选 Custom 并把 `terms.html` 的内容贴进去
3. **App Privacy（隐私"营养标签"问卷）**：App Store Connect 里这个 App 的 App Privacy 页面要如实勾选实际收集的数据类型，得跟 `privacy.html` 写的对得上，大致是：
   - Contact Info（邮箱，Google/Apple 登录时可能拿到，关联身份）
   - Identifiers（用户 ID / Apple 登录返回的唯一标识）
   - User Content（上传的文章、生词、笔记）
   - Purchases（订阅状态，用来解锁 Pro）
   - Usage Data（AI 调用次数/用量统计）
   这几类目前都不用于广告追踪，App Tracking Transparency (ATT) 弹窗那一步应该不需要触发
4. **订阅商品的本地化信息**：App Store Connect → 该订阅 → App Store 本地化，填显示名称（比如 "Contextia Pro"）和描述文字——这个是订阅商品自己的元数据，跟代码里 `APPLE_PRO_PRODUCT_ID` 对应的那个 Product ID 是两回事，之前只建了商品本身，这步经常漏
5. 部署后花一分钟实际打开 `https://contextia.up.railway.app/privacy.html` 和 `/terms.html`，确认链接没写错、内容渲染正常——审核员会真的点进去看

## 已知待办（还没做的）

1. **账号自助注销** — 已经在网页版做好了（设置页），iOS 端复用同一套网页 UI，不用额外做。

2. **iOS 原生 Share Extension（2026-08-15 调研过，暂停了，不是优先级）**：系统分享面板一键导入文章，省去"跳转浏览器 + 手动复制粘贴"这几步。调研结论：
   - **新建 Xcode target 这件事不需要 Mac**——`xcodeproj`(CocoaPods 底层用的同一个 Ruby 库，纯 Ruby，这个 Linux 环境能直接装能用)可以脚本化地给 `.xcodeproj` 加一个 App Extension target，不用 Xcode 图形界面
   - **真正卡住的是"Extension 抓到的分享内容，怎么传回主 App 的网页层"这一步**：Extension 进程和主 App 进程是分开的，得靠 App Group 共享的 UserDefaults 中转。原生代码往网页里注入 JS 的话有时序问题(冷启动时原生代码可能跑得比网页加载完还快)；想走"自定义 Capacitor 插件"更规范的路子，又发现 Capacitor 的插件自动注册机制依赖 `cap sync` 生成的清单，手写的插件不在里面，还得另外解决注册问题
   - 这些原生代码在这个开发环境里**完全没法编译验证**，只能靠推上去之后 CI/TestFlight 报错来排查，参考 StoreKit 那几个 bug 的排查节奏(来回四五轮才修完)，这个大概率轮次更多、更慢
   - Apple Developer 后台该注册的东西已经注册好了：App ID `com.contextia.app.ShareExtension`(带 App Groups capability)、App Group `group.com.contextia.app`(主 App 的 App ID 也已经关联上)——真要捡起来做，这步不用重做
   - 结论：技术上不需要 Mac，但没有 Mac 的话每一轮试错成本很高(推代码→等 CI→等 Apple 处理 build→装机测试→报错反馈，一轮至少十几分钟)；有 Mac 现场调试会快很多。等有 Mac 可用、或者觉得这个功能值得投入再捡起来。

## iOS 编译 CI

`.github/workflows/ios-build.yml`：这个开发环境是 Linux 容器，没有 Mac/Xcode，写 iOS 原生代码只能靠语法/逻辑检查，没法真正编译。这个 workflow 用 GitHub 提供的云端 macOS runner，在每次改动 `mobile/` 或 `frontend/` 时真正跑一次 `pod install` + `xcodebuild`（模拟器目标，不需要签名证书），验证工程到底编译能不能过——上面那次 SPM 编译不过、换成 CocoaPods 这两轮排查，都是靠这个 CI 的真实报错定位出来的，不是靠读代码猜的。

不做签名、不装真机/模拟器、不跑交互测试（登录弹窗、通知权限这些需要人工点）——那些需要 Apple Developer 账号和真机/模拟器的图形界面，CI 做不到，得在真 Mac 上做，或者靠下面"方案 A"这条路绕过去。

## 方案 A：云端签名 + 上传 TestFlight（不用自己有 Mac，已验证跑通）

`.github/workflows/ios-release.yml`：手动触发(Actions 页面点 "Run workflow"，不跟着每次 push 自动跑，因为每次触发都会真的产生一个新的 TestFlight 构建版本号)，在云端 macOS runner 上完整做一遍签名 + 打包 + 上传，产物直接进 TestFlight，之后所有测试都在自己的 iPhone 上用 TestFlight App 完成。`mobile/ios/ExportOptions.plist` 是配套的导出配置(团队 ID、Bundle ID、描述文件名字，都是非敏感信息，直接提交进仓库了)。

**2026-08-14 第一次真实跑通，中途修过两个坑，记录一下方便以后排查同类问题**：
1. 证书导入报"密码不对"（`SecKeychainItemImport: The user name or passphrase you entered is not correct.`）——`.p12` 密码里如果有 `$`、`"` 这类 shell 特殊字符，在命令行里传递时容易被误解析，导致实际写进 `.p12` 的密码跟你以为设的不一样。换成纯字母数字的密码后解决。
2. Archive 报一堆"X does not support provisioning profiles"（`CapacitorFilesystem`/`CapacitorBrowser`等）——根因是 `xcodebuild archive` 命令行传的 `CODE_SIGN_STYLE=Manual` 之类的参数会应用到整个构建里的所有 target，包括 CocoaPods 生成的那些framework/library target，而这些 target 本来就不该配置独立的签名证书。修法是把手动签名配置写死进 `App.xcodeproj/project.pbxproj` 里 App 这个 target 自己的 Release 配置，不再通过命令行全局传参。

**首次使用前要在 GitHub 仓库的 Settings → Secrets and variables → Actions 里配好这 7 个 secret**（这些操作全部在你自己的电脑 + Apple 的网页后台完成，私钥内容不会经过我们的对话，直接从你电脑粘贴进 GitHub 网页）：

| Secret 名字 | 是什么 |
|---|---|
| `IOS_DIST_CERT_P12_BASE64` | Apple Distribution 证书(.p12)的 base64 |
| `IOS_DIST_CERT_PASSWORD` | 导出 .p12 时自己设的密码 |
| `IOS_PROVISIONING_PROFILE_BASE64` | App Store 分发描述文件(.mobileprovision)的 base64 |
| `IOS_CI_KEYCHAIN_PASSWORD` | 随便起一个密码，只是给 CI 临时钥匙串用，不用记 |
| `ASC_API_KEY_ID` | App Store Connect API Key 的 Key ID |
| `ASC_API_ISSUER_ID` | App Store Connect API 的 Issuer ID |
| `ASC_API_KEY_BASE64` | App Store Connect API Key(.p8)的 base64 |

**具体怎么生成这 7 个值**（在自己电脑上用 Git Bash 跑，Windows 装了 Git 就自带，不用额外装 openssl）：

1. **生成证书签名请求(CSR) + 私钥**：
   ```bash
   openssl genrsa -out ios_distribution.key 2048
   openssl req -new -key ios_distribution.key -out ios_distribution.csr -subj "/emailAddress=你的邮箱/CN=你的名字/C=US"
   ```
2. 打开 <https://developer.apple.com/account/resources/certificates/list> → 点 "+" → 选 **"Apple Distribution"**（不是 "Apple Development"）→ 上传上一步生成的 `ios_distribution.csr` → 下载生成的 `.cer` 文件
3. **把证书和私钥合并成 .p12**（`<密码>` 自己设一个，等下要填进 `IOS_DIST_CERT_PASSWORD`）：
   ```bash
   openssl x509 -in ios_distribution.cer -inform DER -out ios_distribution.pem -outform PEM
   openssl pkcs12 -export -out ios_distribution.p12 -inkey ios_distribution.key -in ios_distribution.pem -password pass:<密码>
   ```
4. 打开 <https://developer.apple.com/account/resources/profiles/list> → 点 "+" → 选 **"App Store Connect"**（Distribution 类型）→ App ID 选 `com.contextia.app` → 证书选第 2 步生成的那个 → **名字必须精确填 `Contextia AppStore`**（要跟 `ExportOptions.plist` 和 workflow 里写的字符串完全一致）→ 下载 `.mobileprovision` 文件
5. 打开 App Store Connect → 用户和访问 → 集成(Integrations) → App Store Connect API → 生成一个新 Key，角色选 **"App Manager"**（这是专门给 CI 自动上传用的新 key，跟之前配置内购用的那个 Key 是两码事）→ 下载 `.p8`（**只能下载这一次**，下崩了就得重新生成）→ 记下 Key ID 和 Issuer ID
6. **把三个二进制文件转成 base64**：
   ```bash
   base64 -w0 ios_distribution.p12 > cert_base64.txt
   base64 -w0 dist_profile.mobileprovision > profile_base64.txt
   base64 -w0 AuthKey_XXXXXXXXXX.p8 > apikey_base64.txt
   ```
7. 把上面 7 个值依次填进 GitHub 仓库的 Secrets 页面（`.txt` 文件里的内容整段复制粘贴即可）

**怎么触发**：GitHub 仓库 → Actions 标签 → 左边选 "iOS release to TestFlight" → 右边 "Run workflow" 按钮，分支选 `master`。**注意**：如果某次运行失败了，重新触发要点 "Run workflow" 发起一次全新的运行，不要点失败运行页面里的"Re-run failed jobs"——那个是重跑同一个 commit 的旧代码，改了代码/配置之后不会生效。跑成功之后，几分钟内这个 build 就会出现在 App Store Connect 的 TestFlight 标签下，同时你自己的 Apple 账号(内部测试员，不用额外加白名单)手机上装 TestFlight App 就能装到最新版本。

## App Store 4.2 与真机构建的现实限制

这个开发环境是 Linux 容器，没有 Mac/Xcode，所以：

- 能做：生成/维护 Capacitor 配置和 `ios/` 工程骨架、写前端联调代码（API_BASE 等）、写后端新接口（Apple 登录回调、StoreKit 收据校验等）、靠 CI 验证工程编译能不能过、写好"方案 A"那一整套云端签名+上传 TestFlight 的自动化(`ios-release.yml`)
- 不能做：任何需要人工点击图形界面的交互测试(登录弹窗、通知权限这些)——这些必须在真机/模拟器上肉眼操作，真机走 TestFlight(方案 A)，模拟器要租 Mac(方案 B)
