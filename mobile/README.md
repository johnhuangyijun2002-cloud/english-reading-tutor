# Contextia iOS App 壳

用 [Capacitor](https://capacitorjs.com/) 把 `../frontend` 包一层原生壳，不改前端 UI，目标是上架 App Store。

## 上架进度 / 接下来要做什么（2026-09-23 更新，交接给新会话用）

这一节是自包含的——新开一个会话、不看聊天记录，只看这一节也能接着往下做。

### 现在最新状态：已经提交审核，正在打第 4 轮回合的 build

App **已经在 App Store 审核流程里**，不是"准备提交"阶段了。截至目前一共经历了这几轮：

1. **第一次提交** → 提交后才发现 App 图标是 Capacitor 脚手架默认占位图（不是真实品牌图标），紧急修复（见下面"已修的真实 bug"），走了一次"移除审核 → 换新 build → 重新提交"的流程
2. **Apple 回复 Guideline 2.1 - Information Needed** → 要求提供：真机录屏、测试设备型号/系统版本、App 功能说明、设置说明+登录凭据、外部服务列表、地区差异说明、受监管行业声明。已经用 `applereview`/`applereview` 这个演示账号 + 一段 iPad 真机录屏（传的 Google Drive 链接）完整回复，已重新提交
3. **Apple 又回复 Guideline 2.1(b)** → 追问"商业模式"，因为看到了导航栏"Upgrade to Pro"这个入口，想搞清楚是不是有付费内容。已回复：目前完全免费、这个入口只是调研需求用的等待名单、不产生任何交易、如果未来做会走 IAP 月度订阅制、AdMob 目前只是测试占位广告
4. **Apple 正式拒审，Guideline 3.1.1** → 认定"App 里出现指向付费内容的入口（Upgrade to Pro），但这部分内容不能通过 IAP 购买"，判定为违规。**说明"这只是个不产生交易的等待名单"这个解释本身没能说服审核员**，光靠文字解释这条路走不通。
5. **刚做的修复**：`frontend/app.js` 新增 `hideProEntryForNativeIfNoIAP()`，`IAP_SUBMISSION_ENABLED` 为 `false` 时，原生壳导航栏里的"Upgrade to Pro"按钮整个隐藏，原生用户完全看不到任何"Pro"相关入口（不只是不能点，是连入口本身都不存在）。网页版不受影响，继续显示等待名单（App Review 只审 App 二进制，不审网站）。PR #39，commit `237f85f`。

### 接下来立刻要做的事（新会话从这里接着干）

run #16 → run #17 → 现在要提交的是 **run #18 之后**的 build，前两个都不要提交：

- run #16（commit `261eb2d`）：只隐藏了导航栏 "Upgrade to Pro"
- run #17（commit `95d69e8`，PR #41）：删掉法律页面里的 Pro 订阅/内购段落。补充：原生壳里的条款/隐私链接其实指向 Railway 线上版（`fixLegalLinksForNative()`），这个修改随网页部署已经生效
- **run #18**（PR #42）：新增**第三方 AI 数据共享同意弹窗**（App Review 5.1.2(i)，2025-11 新增：把用户数据发给第三方 AI 之前必须写明发给谁、发什么，并取得明确同意）。`app.js` 的 `ensureAiConsent()` 卡在 `apiFetch` 里，原生壳第一次调用 `AI_CONSENT_PATHS` 里列的接口前弹框；同意存 localStorage `aiConsent.v1`，拒绝不存、下次再问，拒绝时返回前端伪造的 403 走现成报错展示。网页版不弹。`privacy.html` 同步写明了发送内容和接收方（免费试用 DeepSeek / 自填 Key 的四家 / 任意 OpenAI 兼容中转地址）。**以后新增会把内容发给 AI 的接口，记得同时把路径加进 `AI_CONSENT_PATHS` 数组、`privacy.html` 那条列表句子、`i18n` 的 `aiConsent.pointWhat`，三处漏一处审核员都可能挑出来**——当前(commit 见下条)覆盖的是 `/api/analyze`、`/api/immersion/plan`、`/api/recommendations`、`/api/comprehension/quiz`
- **阅读理解小测**（PR 待定，本次改动未触发新 build，等下次连同其他前端改动一起打包）：文章头部新增"理解小测"按钮，AI 根据文章内容出选择题，答题后立即标对错+解析，结果缓存进 `documents.quiz_json`，同一篇文章重新打开不重新计费，点"换一批"才会重新生成。顺手把法语/西班牙语/德语的生词覆盖率和高亮从 `[A-Za-z]` 换成了 `\p{Script=Latin}`（之前 très/über/está 这类带重音符号的词会被从中间切断，覆盖率和高亮都不准）

提交步骤：

1. 等 run #18 成功
2. App Store Connect 版本页："App 内购买项目和订阅"区块取消勾选 `com.contextia.app.pro.monthly`（商品本身保留"准备提交"状态，不删）
3. "构建版本"换成 run #18 的 build
4. Resolution Center 3.1.1 线程回复：

   > We have removed the "Upgrade to Pro" entry point entirely from this version of the app, along with the subscription sections of our in-app Terms of Service and Privacy Policy. We have also detached the in-app subscription product from this submission. There is no longer any reference to a paid tier, subscription, or Pro feature anywhere in the app. The app is fully free with no paid content of any kind in this submission.
   >
   > Separately, in line with Guideline 5.1.2(i), the app now asks for explicit permission before any content is sent to a third-party AI provider, and names the providers and the data involved.

5. 提交前自查元数据（代码管不到、只能人工看）：截图里有没有导航栏 "Upgrade to Pro"（有就重截）；描述/宣传文本/关键词/审核备注里有没有 Pro、订阅、waitlist、coming soon 之类字样；App 隐私问卷里广告追踪的申报是否还跟 ATT 弹窗一致
6. 点"添加以供审核"。之后如果还有新一轮回复，参考这一节和下面的完整历史

### 还剩的已知风险（这轮排查过、暂未处理）

- **测试广告（"Test Ad" 横幅）**：有开发者因为 Google 测试广告标签被判 2.1 占位内容而拒审的先例；我们之前 2.1(b) 回复里已向审核员说明过、三轮审核都没提，所以暂时保留。如果被点名，改 `ads.js` 的 `ADS_ENABLED = false`，**同时**把 App 隐私问卷里的追踪申报撤掉（申报追踪却不弹 ATT 也会被拒）
- **注销账号没有撤销 Sign in with Apple 授权**：苹果要求用 Apple 登录的账号删号时调用 `https://appleid.apple.com/auth/revoke`。现在 Apple 回调时没存 refresh token，要补需要加字段 + 改 `delete_account`，纯后端改动，不用重新打包。审核员很少实测，被点名再做也来得及
- **原生壳里 Google/Apple 登录跳回 App 的流程**仍没在真机上完整测过（审核员用的是账号密码登录）。提交前最好自己在 TestFlight 版里各点一次

### 新功能：连接 Notion 同步（还没合并，等 Railway 环境变量配好）

设置面板新增"连接 Notion"，每个用户自己 OAuth 授权连接自己的 Notion 工作区，生词/句子笔记会同步成用户选定的那个 Notion 页面下的子页面。跟旧的 Google Sheets 方案（`apps_script/Code.gs`，只有主账号能用、要手动部署脚本）不是一回事，这个是每个用户都能用、走标准 OAuth，不需要用户自己折腾。

**上线前必须做的事**：Railway 环境变量加 `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET`（在 [notion.so/my-integrations](https://www.notion.so/my-integrations) 建一个 Public 类型的 OAuth 集成拿到，具体步骤见 `.env.example` 里的注释）。没配之前点"连接 Notion"会报 500。不需要等 Notion 审核——那只在申请上架 Notion 官方集成市场时才需要，直接走 OAuth 授权就能用。

这次改动只涉及 `frontend/`（设置面板 UI）和 `backend/`，合并后网页版 Railway 自动生效；iOS 端要走一次 `ios-release.yml` 才会进下一个 TestFlight build。

**顺手修的 bug**：这个项目里 `.hidden` 这个 class 没有全局 CSS 规则，每个用到的元素都要单独写一条 `#id.hidden { display: none }`，漏写就是没用（元素一直显示）。上一个 PR #43 加的"换一批"按钮（`#btnQuizRegenerate`）就漏写了，这次一起补上。排查发现还有几个更早就存在的、同样漏写的元素（`#btnAdminStats`、`#btnPrint`、`#houseTrialHint` 等），影响都不大（比如站长统计按钮对普通用户可见，但后端接口本身有 `is_owner` 校验，点了也进不去），这次没有顺手全部修，以后改到附近代码时可以留意。

### 这个会话期间顺手修的真实 bug（都已经合并到 master）

这些都是**真实存在的 bug**，不是审核流程本身的问题，是在准备/测试提审材料过程中发现顺手修的：

- **App 图标是占位图**（PR #32）：一直用的 Capacitor 默认生成的蓝色 "X" 图标，换成了 `frontend/favicon-512.png` 那个真实品牌图标，还顺便修了个会导致 Apple 直接拒绝上传的问题（原图标圆角+透明背景，Apple 要求图标必须是不透明正方形无 alpha 通道）
- **`apiErrorText()` 读取 Response body 两次**（PR #33）：`res.json()` 解析失败后还调用 `res.text()`，body 流已经消费过，报 "body stream already read"，把真正的后端错误信息完全盖住了。现在改成只读一次文本再尝试 `JSON.parse`
- **AI Picks / 母语新闻经常 "Load failed"**（PR #35）：`feedparser.parse(url)` 自己发请求不带超时，一个 RSS 源卡住整个请求就没有时间上限；而且英语 7 个源是顺序抓的，不是并发。改成用 `httpx` 带 8 秒超时抓内容再交给 feedparser 解析，并且所有源改成 `asyncio.gather` 并发抓取
- **ATT 授权弹窗冷启动经常不出现**（PR #36）：`ContextiaAds.init()` 只检查一次 `window.Capacitor.Plugins.AdMob` 存不存在，App 真冷启动时原生桥可能还没就绪，查不到就直接放弃，退出登录触发 `location.reload()` 之后原生桥已经热了才第一次真正弹出来。改成轮询等待最多 3 秒
- **设置面板太长、底部"注销账号"贴边**（PR #37）：调整了 padding 和 danger zone 的 margin-top
- **免费试用额度从 10 次提到 20 次**（PR #30，`HOUSE_FREE_CALLS_PER_USER`）：给审核员/新用户更多空间试用 AI 解析功能不至于刚好用完

### 广告 / AdMob 当前状态

见下面"广告变现"一节，简单说：`ADS_ENABLED = true` + `USE_TEST_ADS = true`，真实用户会看到 ATT 弹窗 + Google 测试广告占位（"Test Ad"字样），不产生任何真实收入，也不涉及真实广告网络。这个状态**跟 Guideline 3.1.1 那次拒审无关**（广告和订阅是两回事，苹果这次没提广告），不用因为这次拒审去动 AdMob 相关代码。

### 关键约束，新会话务必记住

- **用户在韩国是 D-2 留学签证，原则上不能从事营利性活动**——这是这次选择"免费版先提交、IAP 订阅先不接"的根本原因，不是技术限制。不要在没有用户明确要求、且没有专业人士确认签证问题已解决的前提下，主动提议或推进任何绕开这个限制的方案（之前明确讨论过、也明确拒绝过用虚假税务身份之类的路子）
- **这个开发环境每次新会话都是全新容器**，之前搭的本地 Postgres/venv/演示账号数据不会保留，重新做截图/本地调试需要重新搭一遍（可以参考本文档"方案 A"一节，或者问上一个会话具体怎么弄的，聊天记录里有完整步骤）
- **改了 `frontend/` 下的代码（app.js/app.html/style.css/ads.js 等）必须重新触发一次 `ios-release.yml` 才会真的进到下一个提交的 build 里**——纯 `backend/main.py` 的改动不需要，Railway 会自动部署，网页版和原生壳的 API 调用都立刻生效
- **每次改完代码，走的流程是**：`git fetch origin master <本分支>` 同步 → 改代码 → commit（带 `Co-Authored-By`/`Claude-Session` 那两行，看 system reminder 里最新的版本）→ push → 开 PR → 合并 → 如果涉及前端就 `actions_run_trigger` 触发 `ios-release.yml`
- **演示/审核账号**：`applereview` / `applereview`，写在 App Store Connect 的登录信息里，给审核员用；确保这个账号还有剩余免费 AI 解析额度（20 次总额），别被之前的测试用完了



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

## 广告变现（测试广告随这次提交一起上线，未产生真实收入，2026-08-26）

除了订阅制的 Contextia Pro，广告是另一条潜在的变现路径。**真实、能产生收入的广告目前还没有
上线**——不是技术问题，是身份问题：用户是韩国的 D-2 留学签证，原则上不能从事营利性活动，这个
限制看的是"活动"本身（持续运营一个带广告变现的 App、收取广告收入），跟广告平台/收款方注册在
哪个国家、收款账户是个人还是公司都无关，换成中国的广告联盟也一样绕不开。这件事没解决之前不会
真的产生广告收入。

但这次提交 App Store 审核的 build 里，**测试广告位是打开的**（`ADS_ENABLED = true`，
`USE_TEST_ADS = true`）——决定是用户主动做的：提前让真实用户看到广告位长什么样，为将来真正
开放广告收入做心理预期铺垫，广告位请求全程走 Google 官方公开的测试广告位 ID，不会有真实广告
展示，也不会产生任何真实收入，但 ATT 授权弹窗和"Test Ad"横幅这次会真的出现在提交审核的 build
里。因为这样一来 AdMob SDK 真的会初始化、真的会往 Google 发请求，`frontend/privacy.html` /
`terms.html` 已经同步改成如实说明"广告功能已开启（测试阶段）"，**App Store Connect 的 App
Privacy 问卷也要同步改成"收集 Identifiers/Usage Data 用于广告"，不能再填"不收集广告数据"**，
否则会跟实际行为不符（Apple 审核指南 5.1.2）。

- `mobile/package.json` 加了 `@capacitor-community/admob` 依赖（对齐 Capacitor 8），`npx cap sync ios`
  跑过一次，`ios/App/Podfile` 已经自动生成了 `CapacitorCommunityAdmob` 这条 pod
- 用户已经用自己的 Google 账号注册了真实 AdMob 账号，并创建了 App + 一个 Banner 广告单元。
  `mobile/ios/App/App/Info.plist` 的 `GADApplicationIdentifier` 现在是这个**真实 App ID**
  （`ca-app-pub-7356124481466705~7289853108`），`frontend/ads.js` 的
  `PRODUCTION_BANNER_AD_UNIT_ID` 是这个**真实广告单元 ID**（`ca-app-pub-7356124481466705/6674096817`）
  ——这两个值本身不涉及金钱往来，注册/接入不会触发签证问题；`SKAdNetworkItems` 现在只放了 Google
  自己那一条 `cstr6suwn9.skadnetwork`，够测试用（生产环境需要去
  [Google 官方文档](https://developers.google.com/admob/ios/quick-start) 现查当前完整列表，这个列表
  会随时间变化，不能抄旧的——这次没能直接访问 developers.google.com 核对完整清单，抄的是
  Apple 官方 SKAdNetwork ID 仓库的一个子集，生产环境上线前务必重新核对）
- `frontend/ads.js` — `window.ContextiaAds`（`init`/`showBanner`/`hideBanner`）。`ADS_ENABLED = true`
  + `USE_TEST_ADS = true`：TestFlight/正式版装机后能看到系统级 App Tracking Transparency 授权
  弹窗、屏幕底部一条"Test Ad"字样的横幅，说明整条技术链路（CocoaPods 依赖、原生插件注册、ATT
  授权弹窗、AdMob SDK 初始化、banner 展示）都通了，同时也是这次提交 App Store 审核时真实用户会
  看到的状态（用户主动决定保留，不是先关掉）
- `app.html` 里 `#adBannerSlot` 是布局占位用的容器；AdMob 的 banner 实际上是叠在 WebView 上面的
  原生视图，不是渲染进这个 DOM 节点里的，这个节点目前基本没用上

**候选广告网络**（技术选型层面的调研，不代表已经决定只接 AdMob）：Google AdMob（已验证测试流程）、
AppLovin (MAX)、Unity Ads/LevelPlay、Meta Audience Network、Pangle——AdMob 收款本身允许直接付款给
个人（账户类型选"个人"，不需要公司/사업자등록证），这跟 Apple 的 Paid Apps Agreement（明确要求
韩国区收款方是登记过的韩国税务主体）不是一回事；但这只是说 Google 自己的收款政策没有这个门槛，
不代表签证问题就解决了——两者是独立的两件事。

**真要上线产生真实收入（不只是测试广告位）的时候还需要做的事**（App ID / 广告单元 ID 已经是
真的了，隐私政策/服务条款/App Privacy 问卷这次也已经按"有广告"的口径写好了，不用再改）：
1. 确认签证/身份问题已经解决（换签证、有合法工作许可、或者找到确实合规的收入安排方式）
2. `frontend/ads.js` 里 `USE_TEST_ADS` 改成 `false`（`ADS_ENABLED` 已经是 `true` 了）
3. `Info.plist` 的 `SKAdNetworkItems` 换成 Google 文档当前的完整列表

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

3. ~~隐私政策 & 服务条款要补上 AdMob 的披露~~ **已完成，2026-08-26 又更新过一次**：
   `frontend/privacy.html` 的"Advertising (iOS)"一节、`terms.html`"Changes to the service"
   一节，现在都改成如实说明"广告功能已开启，展示的是 Google 测试广告位、不产生真实收入"（用户
   决定让测试广告随这次提交一起出现，不是关着提交）。**App Store Connect 的 App Privacy 问卷
   要同步填"收集 Identifiers / Usage Data 用于第三方广告"**，不能填"不收集广告数据"——具体建议：
   - Identifiers → Device ID：收集，不关联用户身份，用于追踪 = 是（ATT 授权同意的前提下），
     用途选 Third-Party Advertising
   - Usage Data → Advertising Data：收集，不关联用户身份，用于追踪 = 否，用途选
     Third-Party Advertising / Analytics
   - Diagnostics → Crash Data / Performance Data（可选但建议加）：收集，不关联用户身份，
     不用于追踪，用途选 App Functionality / Analytics
   - Location 不需要额外声明（AdMob 测试广告不主动请求定位权限）
   等真正切换成能产生真实收入的广告（`USE_TEST_ADS` 改 `false`）时，这个问卷不用再改，因为
   数据类型和用途跟测试广告阶段是一样的，只是广告库存变成真实的。

4. **App Store Connect 素材已经全部填完**（App 描述、关键词、副标题英/德/韩三语、Support URL
   即 `frontend/support.html`、App 截图 iPhone 6.9"/iPad 13" 各 5 张、Age Rating、Content
   Rights、版权信息、定价等级选 Free、App Privacy 问卷）——不用重新准备，除非苹果针对具体某一项
   提出新的问题。App 截图是用这个 Linux 环境里的无头浏览器(Playwright)截的网页版界面生成的，
   不是真机截图，因为原生壳跟网页版用的是同一套 HTML/CSS，视觉上完全一致；具体怎么截图（本地
   起 Postgres + FastAPI 服务、种测试数据、Playwright 脚本）聊天记录里有完整过程，新会话需要
   重新生成截图的话可以照着做一遍，这个开发环境每次新会话都是全新容器，之前搭的本地数据不会
   保留。

5. **App Review 期间发现的真实 bug 修复过程 + Apple 审核几轮往返的具体内容**，见本文档最上面
   "上架进度 / 接下来要做什么"一节，那里有完整时间线。

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
