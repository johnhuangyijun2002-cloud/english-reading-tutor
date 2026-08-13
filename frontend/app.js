let authToken = localStorage.getItem("authToken") || "";
let currentUser = null; // {id, name, is_owner}

// iOS App 壳(Capacitor)里本地打包的静态资源和真实后端不同源，/api/xxx 请求需要
// 加上绝对地址前缀；网页版 native-config.js 里这个值是空字符串，行为不变。
const API_BASE = window.CONTEXTIA_API_BASE || "";

function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// Google/Apple 登录跳转：网页版整页跳转到后端 OAuth 入口，跳回来的时候还是同一个
// 标签页(location.href)。原生壳里不能这么干——那样是把 App 自己的 WebView 导航去了
// 后端域名，会离开打包进 App 的本地页面；改成用系统浏览器(@capacitor/browser，iOS 上是
// ASWebAuthenticationSession/SFSafariViewController)打开登录页，成功后端会跳一个自定义
// URL scheme 回 App，由下面注册的 appUrlOpen 监听器接住，见 finishOAuthCallback。
function startOAuthFlow(loginPath) {
  const native = isNativeApp();
  const separator = loginPath.includes("?") ? "&" : "?";
  const url = API_BASE + loginPath + (native ? `${separator}platform=ios` : "");
  const browser = native && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
  if (browser) {
    browser.open({ url });
  } else {
    location.href = url;
  }
}

// ---------- 离线缓存(原生壳专用) ----------
// 网页版本身就要联网才能打开，不需要这套；原生壳里网络断了也该能看已经存过的文章/生词/
// 句子笔记，所以每次读接口成功都顺手写一份到设备本地文件(@capacitor/filesystem)，
// 下次同样的读请求失败(网络断了、后端暂时挂了)时退回读这份本地缓存。
const OFFLINE_CACHE_DIR = "offline-cache";
const offlineBanner = document.getElementById("offlineBanner");

function setOfflineBanner(active) {
  if (offlineBanner) offlineBanner.classList.toggle("hidden", !active);
}

async function offlineCacheWrite(key, data) {
  if (!isNativeApp()) return;
  try {
    await window.Capacitor.Plugins.Filesystem.writeFile({
      path: `${OFFLINE_CACHE_DIR}/${key}.json`,
      data: JSON.stringify(data),
      directory: "DATA",
      encoding: "utf8",
      recursive: true,
    });
  } catch (err) {
    // 写缓存失败(比如设备存储满了)不影响正常使用，安静忽略
  }
}

async function offlineCacheRead(key) {
  if (!isNativeApp()) return null;
  try {
    const result = await window.Capacitor.Plugins.Filesystem.readFile({
      path: `${OFFLINE_CACHE_DIR}/${key}.json`,
      directory: "DATA",
      encoding: "utf8",
    });
    return JSON.parse(result.data);
  } catch (err) {
    return null; // 还没缓存过，或者缓存文件读不出来——当没有缓存处理
  }
}

// 统一的"读数据，拿不到就退回上次缓存"包装：网络请求失败、或者后端返回错误状态，
// 只要本地有上次成功缓存过的内容，都退回显示那份缓存(并标记离线横幅)，而不是直接报错。
async function fetchJsonWithOfflineCache(path, cacheKey) {
  try {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error(await apiErrorText(res));
    const data = await res.json();
    offlineCacheWrite(cacheKey, data);
    setOfflineBanner(false);
    return data;
  } catch (err) {
    const cached = await offlineCacheRead(cacheKey);
    if (cached !== null) {
      setOfflineBanner(true);
      return cached;
    }
    throw err;
  }
}

async function getVocabAndNotes() {
  try {
    const [vocabRes, notesRes] = await Promise.all([apiFetch("/api/vocab"), apiFetch("/api/sentence_notes")]);
    if (!vocabRes.ok || !notesRes.ok) throw new Error("couldn't load vocab/sentence notes");
    const vocab = await vocabRes.json();
    const notes = await notesRes.json();
    offlineCacheWrite("vocab", vocab);
    offlineCacheWrite("sentence_notes", notes);
    setOfflineBanner(false);
    return { vocab, notes };
  } catch (err) {
    const [cachedVocab, cachedNotes] = await Promise.all([
      offlineCacheRead("vocab"),
      offlineCacheRead("sentence_notes"),
    ]);
    if (cachedVocab !== null && cachedNotes !== null) {
      setOfflineBanner(true);
      return { vocab: cachedVocab, notes: cachedNotes };
    }
    throw err;
  }
}

// ---------- 推送通知(本地通知，原生壳专用) ----------
// 用 @capacitor/local-notifications 在设备本地预约通知，提醒"有 N 个单词待复习"——
// 跟间隔重复复习功能直接挂钩，不需要 APNs 推送证书，也不需要后端另外搭一套推送队列。
// 每次 App 打开时，用当前的待复习总数重新预约未来几天每天一条提醒(先撤销旧的预约，
// 避免数字过期)。已知局限：这是"预约"出来的通知，不是服务端主动推送——如果用户连续
// 超过 REVIEW_REMINDER_DAYS 天不打开 App，预约会用完，得下次打开才重新续上；预约的
// 这几天里数字也是打开 App 那一刻的快照，中途复习掉一些也不会实时更新通知里的数字。
// 真正做到"无论多久不开都能收到实时提醒"需要服务端 APNs 推送，工作量大很多，等后面
// 有需要再做。
const REVIEW_REMINDER_DAYS = 7;
const REVIEW_REMINDER_HOUR = 10; // 每天提醒的本地时间(24 小时制)
const REVIEW_REMINDER_ID_BASE = 9000;

async function scheduleReviewReminders() {
  if (!isNativeApp()) return;
  const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
  if (!LocalNotifications) return;
  try {
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") {
      perm = await LocalNotifications.requestPermissions();
    }
    if (perm.display !== "granted") return;

    await LocalNotifications.cancel({
      notifications: Array.from({ length: REVIEW_REMINDER_DAYS }, (_, i) => ({ id: REVIEW_REMINDER_ID_BASE + i })),
    });

    const res = await apiFetch("/api/review/due-counts");
    const counts = res.ok ? await res.json() : {};
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total <= 0) return;

    const notifications = Array.from({ length: REVIEW_REMINDER_DAYS }, (_, i) => {
      const at = new Date();
      at.setDate(at.getDate() + i + 1);
      at.setHours(REVIEW_REMINDER_HOUR, 0, 0, 0);
      return {
        id: REVIEW_REMINDER_ID_BASE + i,
        title: "Contextia",
        body: t("notifications.reviewDue", { count: total }),
        schedule: { at },
      };
    });
    await LocalNotifications.schedule({ notifications });
  } catch (err) {
    // 通知预约失败(比如用户拒绝了权限)不影响正常使用，安静忽略
  }
}

// ---------- Apple 内购(StoreKit，原生壳专用) ----------
// 用 capacitor-plugin-cdv-purchase(StoreKit 2 封装)，不接第三方内购 SaaS——收据校验走
// 自己后端的 /api/iap/sync(见 backend/main.py 的 "Apple 内购" 一节)，不是这个插件自带的
// validator 机制。这个插件的 JS 运行时(store.js)不是通过 npm/构建工具引入的——项目本身
// 没有构建工具，是 mobile/scripts/build-www.mjs 在打包时把它从 node_modules 拷贝进
// www/vendor/cdv-purchase/，只有原生壳会用到，动态加载，网页版永远不会加载/请求这两个文件。
const IAP_PRODUCT_ID = "com.contextia.app.pro.monthly";
let iapStoreReady = false;
let currentEntitlement = null;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function initIAP() {
  if (!isNativeApp()) return;
  try {
    await loadScriptOnce("vendor/cdv-purchase/capacitor-plugin.js");
    await loadScriptOnce("vendor/cdv-purchase/store.js");
    const { store, ProductType, Platform } = window.CdvPurchase;
    store.register([{ id: IAP_PRODUCT_ID, type: ProductType.PAID_SUBSCRIPTION, platform: Platform.APPLE_APPSTORE }]);
    store.when().approved(async (transaction) => {
      try {
        const res = await apiFetch("/api/iap/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction_id: transaction.transactionId }),
        });
        if (res.ok) currentEntitlement = await res.json();
      } catch (err) {
        // 同步失败也要 finish()，不然 Apple 会一直重复投递这笔交易；下次打开 App 走
        // loadEntitlement() 或者用户手动点"恢复购买"还能再同步一次
      } finally {
        await transaction.finish();
        updateIapPanel();
      }
    });
    await store.initialize([Platform.APPLE_APPSTORE]);
    iapStoreReady = true;
  } catch (err) {
    // StoreKit 初始化失败(比如插件没装好、模拟器不支持内购)不影响正常使用，安静忽略
  }
}

async function loadEntitlement() {
  if (!isNativeApp()) return;
  try {
    const res = await apiFetch("/api/entitlement");
    if (res.ok) currentEntitlement = await res.json();
  } catch (err) {
    // 拿不到订阅状态就当没订阅处理，不阻塞正常使用
  }
}

function updateIapPanel() {
  if (!iapProStatus) return;
  if (currentEntitlement && currentEntitlement.is_pro) {
    iapProStatus.textContent = t("pro.iapActiveStatus");
    btnIapSubscribe.classList.add("hidden");
  } else {
    iapProStatus.textContent = iapStoreReady ? "" : t("pro.iapLoading");
    btnIapSubscribe.classList.remove("hidden");
    btnIapSubscribe.disabled = !iapStoreReady;
  }
}

// ---------- 图标(全站禁用 emoji，统一用 lucide 线条图标) ----------
// 见 DESIGN_GUIDELINES.md：UI 里任何地方需要图标/图形提示，一律从这里取，不能直接写 emoji 字符。
const ICON_PATHS = {
  bookmark: '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z" />',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" />',
  "alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />',
  "check-circle": '<circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />',
  "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />',
  "party-popper": '<path d="M5.8 11.3 2 22l10.7-3.79" /><path d="M4 3h.01" /><path d="M22 8h.01" /><path d="M15 2h.01" /><path d="M22 20h.01" /><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" /><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17" /><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7" /><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" />',
  "file-text": '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />',
  globe: '<circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />',
  "volume-2": '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
  printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" /><rect x="6" y="14" width="12" height="8" rx="1" />',
  highlighter: '<path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />',
  play: '<polygon points="6 3 20 12 6 21 6 3" />',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" />',
  square: '<rect x="3" y="3" width="18" height="18" rx="2" />',
  flame: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" />',
};

function iconHTML(name, extraClass) {
  const inner = ICON_PATHS[name];
  if (!inner) return "";
  const cls = "inline-icon" + (extraClass ? ` ${extraClass}` : "");
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// ---------- 界面语言(i18n) ----------
// ui_language 决定界面文案；真正生效的值以登录后账号里存的为准，这里的 localStorage
// 缓存只是给"页面刚加载、还没拿到账号信息"这段时间一个合理的默认显示语言用。
let currentUiLanguage = localStorage.getItem("uiLanguage") || "en";
let i18nStrings = {};

function t(key, vars) {
  const parts = key.split(".");
  let node = i18nStrings;
  for (const p of parts) {
    if (node && typeof node === "object" && p in node) node = node[p];
    else return key;
  }
  if (typeof node !== "string") return key;
  if (!vars) return node;
  return node.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

function applyI18n() {
  document.documentElement.lang = currentUiLanguage;
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  populateLearningLanguageOptions();
  populateLearningLanguageOptionsFor("settingsLearningLanguageSelect");
  populateRecommendLevelOptions();
}

async function loadI18n(lang) {
  const res = await fetch(`/i18n/${lang}.json`, { cache: "no-store" });
  i18nStrings = await res.json();
  currentUiLanguage = lang;
  localStorage.setItem("uiLanguage", lang);
  applyI18n();
}

// 界面语言第一次被设成中文时，提示一下"设置"里有个中转站地址可以配置(只提示一次)。
const RELAY_HINT_SHOWN_KEY = "relayHintShown";

function maybeShowRelayHint(lang) {
  if (lang !== "zh" || localStorage.getItem(RELAY_HINT_SHOWN_KEY)) return;
  localStorage.setItem(RELAY_HINT_SHOWN_KEY, "1");
  alert("提示：如果访问 AI 接口不稳定，可以在「设置」中填写「AI 中转站地址」以替代官方地址。");
}

// ---------- 首次打开弹出的语言选择弹窗 ----------

function showLanguagePicker(onDone) {
  let selectedInterfaceLang = "en";
  languagePickerOverlay.classList.remove("hidden");
  populateLearningLanguageOptionsFor("onboardingLearningLanguageSelect");

  const pillButtons = languagePickerOverlay.querySelectorAll(".langPickerOption");
  pillButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedInterfaceLang = btn.dataset.lang;
      pillButtons.forEach((b) => b.classList.toggle("is-selected", b === btn));
    });
  });

  document.getElementById("btnLanguagePickerConfirm").addEventListener(
    "click",
    async () => {
      const learningLang = document.getElementById("onboardingLearningLanguageSelect").value;
      localStorage.setItem(LAST_LEARNING_LANGUAGE_KEY, learningLang);
      localStorage.setItem(LANGUAGE_PICKED_KEY, "1");
      await loadI18n(selectedInterfaceLang);
      languagePickerOverlay.classList.add("hidden");
      maybeShowRelayHint(selectedInterfaceLang);
      onDone();
    },
    { once: true },
  );
}

// ---------- 学习语言(每篇文章一个值，跟界面语言是两回事) ----------

// 只保留 AI 推荐功能已经配好新闻源的语言，避免选到一个抓不到推荐文章的语言。
const LEARNING_LANGUAGE_CODES = ["en", "ja", "ko", "fr", "es", "de"];
const LAST_LEARNING_LANGUAGE_KEY = "lastLearningLanguage";

function getLastLearningLanguage() {
  const stored = localStorage.getItem(LAST_LEARNING_LANGUAGE_KEY);
  // 之前的版本允许选到现在已经去掉的语言(比如中文)，这里做兜底，
  // 避免读到一个 AI 推荐功能已经不支持的旧值。
  return LEARNING_LANGUAGE_CODES.includes(stored) ? stored : "en";
}

function populateLearningLanguageOptionsFor(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const prevValue = select.value || getLastLearningLanguage();
  select.innerHTML = "";
  LEARNING_LANGUAGE_CODES.forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = t(`languages.${code}`);
    select.appendChild(opt);
  });
  select.value = LEARNING_LANGUAGE_CODES.includes(prevValue) ? prevValue : "en";
}

function populateImmersionTargetLanguageOptions() {
  const select = document.getElementById("immersionTargetLanguageSelect");
  if (!select) return;
  const prevValue = select.value || "follow";
  select.innerHTML = "";
  const followOpt = document.createElement("option");
  followOpt.value = "follow";
  followOpt.textContent = t("settings.immersionFollowLearning");
  select.appendChild(followOpt);
  LEARNING_LANGUAGE_CODES.forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = t(`languages.${code}`);
    select.appendChild(opt);
  });
  select.value = ["follow", ...LEARNING_LANGUAGE_CODES].includes(prevValue) ? prevValue : "follow";
}

function populateLearningLanguageOptions() {
  populateLearningLanguageOptionsFor("learningLanguageSelect");
}

function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${authToken}` };
  // GET 请求默认可能被浏览器按 URL 缓存，Authorization header 不同也可能命中旧缓存，
  // 导致登出/换账号后读到别人或者已登出状态下的数据 —— 强制不缓存。
  return fetch(API_BASE + url, { ...opts, headers, cache: "no-store" }).then((res) => {
    // session token 现在有过期时间了(30天)，正常使用中途过期的话，服务端会返回 401，
    // 这里统一兜底：清掉本地 token 并刷新页面，回到登录页重新登录，而不是让后续操作
    // 一直报奇怪的错。
    if (res.status === 401 && authToken) {
      localStorage.removeItem("authToken");
      location.reload();
    }
    return res;
  });
}

// 后端报错是 FastAPI 的 HTTPException，响应体是 {"detail": "..."} 这样的 JSON——
// 不能直接把 res.text() 整段塞给用户看，那样弹窗里会出现原始的 {"detail":...} 文本。
// 这里统一解析出 detail 字段；不是 JSON（比如网关层的纯文本报错）就原样返回。
async function apiErrorText(res) {
  try {
    const data = await res.json();
    if (data && typeof data.detail === "string") return data.detail;
    return JSON.stringify(data);
  } catch (err) {
    return await res.text();
  }
}

let allDocs = [];
let currentDocId = null;
let currentDocName = "";
let currentDocContent = "";
let currentDocSourceUrl = "";
let currentDocLearningLanguage = "en";
let knownWords = new Set();
let knownWordsMap = new Map(); // 小写单词 -> 生词记录（用于点击高亮词弹出释义）
let pendingSelectionText = "";
let pendingSelectionMode = "word"; // "word" | "passage"
let pendingSelectionContext = "";

// ---------- 渐进沉浸阅读模式：会话级状态，每次 loadDocument() 都会重置 ----------
let immersionEnabled = false;
let immersionRatio = 20;
let immersionPlan = null; // 后端 /api/immersion/plan 的返回值，缓存到切换文章为止
let immersionResolvedLanguage = "en"; // 沉浸模式实际用的目标语言（可能是全局覆盖值，不一定等于 currentDocLearningLanguage）
let immersionWordsMap = new Map(); // 小写目标词 -> {word, chinese_meaning, ipa, pos, sentence, ...}，形状故意跟 knownWordsMap 一致
let immersionClickedWords = new Set(); // 本次阅读点开看过的沉浸替换词，结束时弹窗默认勾选这些

const fileInput = document.getElementById("fileInput");
const docSelect = document.getElementById("docSelect");
const viewer = document.getElementById("viewer");
const viewerContent = document.getElementById("viewerContent");
const readingProgressFill = document.getElementById("readingProgressFill");
const annotationList = document.getElementById("annotationList");
const sidebar = document.getElementById("sidebar");
const btnToggleSidebar = document.getElementById("btnToggleSidebar");
const btnCloseSidebar = document.getElementById("btnCloseSidebar");
const selectionToolbar = document.getElementById("selectionToolbar");
const btnAnalyze = document.getElementById("btnAnalyze");
const btnPronounce = document.getElementById("btnPronounce");
const btnSaveAll = document.getElementById("btnSaveAll");
const btnPrint = document.getElementById("btnPrint");
const printArea = document.getElementById("printArea");

const btnReaderSettings = document.getElementById("btnReaderSettings");
const readerSettingsPanel = document.getElementById("readerSettingsPanel");

const immersionRatioRow1 = document.getElementById("immersionRatioRow1");
const immersionRatioSlider = document.getElementById("immersionRatioSlider");
const immersionRatioValue = document.getElementById("immersionRatioValue");
const immersionLoadingBar = document.getElementById("immersionLoadingBar");
const immersionSaveOverlay = document.getElementById("immersionSaveOverlay");
const immersionSaveList = document.getElementById("immersionSaveList");
const btnImmersionSaveSkip = document.getElementById("btnImmersionSaveSkip");
const btnImmersionSaveConfirm = document.getElementById("btnImmersionSaveConfirm");

const btnAddArticle = document.getElementById("btnAddArticle");
const pastePanelOverlay = document.getElementById("pastePanelOverlay");
const pasteTitle = document.getElementById("pasteTitle");
const pasteContent = document.getElementById("pasteContent");
const pasteFromRecommendHint = document.getElementById("pasteFromRecommendHint");
const urlInput = document.getElementById("urlInput");
const btnPasteSubmit = document.getElementById("btnPasteSubmit");
const btnPasteCancel = document.getElementById("btnPasteCancel");
const pasteTabs = document.querySelectorAll(".pasteTab");
let activePasteTab = "paste";
const learningLanguageSelect = document.getElementById("learningLanguageSelect");

const btnRecommend = document.getElementById("btnRecommend");
const recommendPanelOverlay = document.getElementById("recommendPanelOverlay");
const recommendList = document.getElementById("recommendList");
const btnRecommendRefresh = document.getElementById("btnRecommendRefresh");
const btnRecommendClose = document.getElementById("btnRecommendClose");
const recommendLevelSelect = document.getElementById("recommendLevelSelect");
const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const DEFAULT_LEVEL = "B1";

const btnNativeNews = document.getElementById("btnNativeNews");
const nativeNewsPanelOverlay = document.getElementById("nativeNewsPanelOverlay");
const nativeNewsList = document.getElementById("nativeNewsList");
const btnNativeNewsRefresh = document.getElementById("btnNativeNewsRefresh");
const btnNativeNewsClose = document.getElementById("btnNativeNewsClose");

const usageBadge = document.getElementById("usageBadge");
const streakBadge = document.getElementById("streakBadge");

const btnStats = document.getElementById("btnStats");
const statsPanelOverlay = document.getElementById("statsPanelOverlay");
const statsStreakNumber = document.getElementById("statsStreakNumber");
const statsWeekStrip = document.getElementById("statsWeekStrip");
const statsVocabCount = document.getElementById("statsVocabCount");
const statsDocCount = document.getElementById("statsDocCount");
const statsAccuracyChart = document.getElementById("statsAccuracyChart");
const btnStatsClose = document.getElementById("btnStatsClose");
let latestStats = null;

const btnAdminStats = document.getElementById("btnAdminStats");
const adminStatsPanelOverlay = document.getElementById("adminStatsPanelOverlay");
const adminStatsTotalUsers = document.getElementById("adminStatsTotalUsers");
const adminStatsTotalDocuments = document.getElementById("adminStatsTotalDocuments");
const adminStatsTotalVocab = document.getElementById("adminStatsTotalVocab");
const adminStatsTotalWaitlist = document.getElementById("adminStatsTotalWaitlist");
const adminStatsSignupsChart = document.getElementById("adminStatsSignupsChart");
const adminStatsActiveChart = document.getElementById("adminStatsActiveChart");
const btnAdminStatsClose = document.getElementById("btnAdminStatsClose");

const btnUpgradePro = document.getElementById("btnUpgradePro");
const proPanelOverlay = document.getElementById("proPanelOverlay");
const proEmailInput = document.getElementById("proEmailInput");
const btnProJoinWaitlist = document.getElementById("btnProJoinWaitlist");
const proWaitlistStatus = document.getElementById("proWaitlistStatus");
const proWaitlistBlock = document.getElementById("proWaitlistBlock");
const proSupportBlock = document.getElementById("proSupportBlock");
const btnProSupport = document.getElementById("btnProSupport");
const iapProBlock = document.getElementById("iapProBlock");
const iapProStatus = document.getElementById("iapProStatus");
const btnIapSubscribe = document.getElementById("btnIapSubscribe");
const btnIapRestore = document.getElementById("btnIapRestore");
const btnProClose = document.getElementById("btnProClose");

btnIapSubscribe.addEventListener("click", async () => {
  if (!iapStoreReady) return;
  const { store } = window.CdvPurchase;
  const product = store.get(IAP_PRODUCT_ID);
  const offer = product && product.getOffer ? product.getOffer() : null;
  if (!offer) {
    iapProStatus.textContent = t("pro.iapProductUnavailable");
    return;
  }
  btnIapSubscribe.disabled = true;
  try {
    const err = await store.order(offer);
    if (err) iapProStatus.textContent = t("pro.iapPurchaseFailed", { message: err.message || String(err) });
  } finally {
    btnIapSubscribe.disabled = !iapStoreReady;
  }
});

btnIapRestore.addEventListener("click", async () => {
  if (!iapStoreReady) return;
  btnIapRestore.disabled = true;
  iapProStatus.textContent = t("pro.iapRestoring");
  try {
    await window.CdvPurchase.store.restorePurchases();
    await loadEntitlement();
  } finally {
    btnIapRestore.disabled = false;
    updateIapPanel();
  }
});

const btnSearchHistory = document.getElementById("btnSearchHistory");
const searchPanelOverlay = document.getElementById("searchPanelOverlay");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const btnSearchClose = document.getElementById("btnSearchClose");
const btnSearchExport = document.getElementById("btnSearchExport");
const btnSearchSelectToggle = document.getElementById("btnSearchSelectToggle");
const searchBulkBar = document.getElementById("searchBulkBar");
const btnSearchSelectAll = document.getElementById("btnSearchSelectAll");
const searchSelectedCount = document.getElementById("searchSelectedCount");
const btnSearchDeleteSelected = document.getElementById("btnSearchDeleteSelected");
let searchDataCache = null;
let currentSearchMatches = [];
let selectModeActive = false;
let selectedSearchIds = new Set();

const btnDocManager = document.getElementById("btnDocManager");
const docManagerPanelOverlay = document.getElementById("docManagerPanelOverlay");
const docManagerList = document.getElementById("docManagerList");
const btnDocManagerClose = document.getElementById("btnDocManagerClose");

const navReview = document.getElementById("navReview");
const reviewPanelOverlay = document.getElementById("reviewPanelOverlay");
const reviewLanguageSelect = document.getElementById("reviewLanguageSelect");
const reviewDueCount = document.getElementById("reviewDueCount");
const btnReviewClose = document.getElementById("btnReviewClose");
const btnStartReview = document.getElementById("btnStartReview");
const reviewSessionOverlay = document.getElementById("reviewSessionOverlay");
const reviewProgress = document.getElementById("reviewProgress");
const reviewCardWord = document.querySelector("#reviewCard .reviewCard-word");
const btnReviewPronounce = document.getElementById("btnReviewPronounce");
const reviewCardBack = document.querySelector("#reviewCard .reviewCard-back");
const reviewCardMeta = document.querySelector("#reviewCard .reviewCard-meta");
const reviewCardMeaning = document.querySelector("#reviewCard .reviewCard-meaning");
const reviewCardSentence = document.querySelector("#reviewCard .reviewCard-sentence");
const reviewCardForms = document.querySelector("#reviewCard .reviewCard-forms");
const btnReviewExit = document.getElementById("btnReviewExit");
const btnReviewReveal = document.getElementById("btnReviewReveal");
const btnReviewDontKnow = document.getElementById("btnReviewDontKnow");
const btnReviewKnow = document.getElementById("btnReviewKnow");
let reviewDueCounts = {};
let reviewQueue = [];
let reviewIndex = 0;

const btnAccountSettings = document.getElementById("btnAccountSettings");
const accountSettingsPanelOverlay = document.getElementById("accountSettingsPanelOverlay");
const settingsUserLine = document.getElementById("settingsUserLine");
const uiLanguageSelect = document.getElementById("uiLanguageSelect");
const settingsLearningLanguageSelect = document.getElementById("settingsLearningLanguageSelect");
const immersionTargetLanguageSelect = document.getElementById("immersionTargetLanguageSelect");
const immersionExcludeProperNounsToggle = document.getElementById("immersionExcludeProperNounsToggle");
const explainLanguageSelect = document.getElementById("explainLanguageSelect");
const aiProviderSelect = document.getElementById("aiProviderSelect");
const aiApiKeyInput = document.getElementById("aiApiKeyInput");
const aiKeyHint = document.getElementById("aiKeyHint");
const houseTrialHint = document.getElementById("houseTrialHint");
const aiRelayBlock = document.getElementById("aiRelayBlock");
const aiRelayUrlInput = document.getElementById("aiRelayUrlInput");
const aiRelayModelInput = document.getElementById("aiRelayModelInput");
const sheetsSyncBlock = document.getElementById("sheetsSyncBlock");
const sheetsSyncToggle = document.getElementById("sheetsSyncToggle");
const btnSettingsSave = document.getElementById("btnSettingsSave");
const settingsSaveStatus = document.getElementById("settingsSaveStatus");
const btnLogout = document.getElementById("btnLogout");

const newUsernameInput = document.getElementById("newUsernameInput");
const btnChangeUsername = document.getElementById("btnChangeUsername");
const changeUsernameStatus = document.getElementById("changeUsernameStatus");
const newEmailInput = document.getElementById("newEmailInput");
const btnChangeEmail = document.getElementById("btnChangeEmail");
const changeEmailStatus = document.getElementById("changeEmailStatus");

const changePasswordLabel = document.getElementById("changePasswordLabel");
const newPasswordInput = document.getElementById("newPasswordInput");
const btnChangePassword = document.getElementById("btnChangePassword");
const changePasswordStatus = document.getElementById("changePasswordStatus");

const googleLinkStatus = document.getElementById("googleLinkStatus");
const btnLinkGoogle = document.getElementById("btnLinkGoogle");
const appleLinkStatus = document.getElementById("appleLinkStatus");
const btnLinkApple = document.getElementById("btnLinkApple");

const btnExportData = document.getElementById("btnExportData");
const btnDeleteAccount = document.getElementById("btnDeleteAccount");
const accountDataStatus = document.getElementById("accountDataStatus");

const loginOverlay = document.getElementById("loginOverlay");
const loginUsernameInput = document.getElementById("loginUsernameInput");
const loginPasswordInput = document.getElementById("loginPasswordInput");
const regEmailInput = document.getElementById("regEmailInput");
const loginError = document.getElementById("loginError");
const btnLoginSubmit = document.getElementById("btnLoginSubmit");
const btnRegisterSubmit = document.getElementById("btnRegisterSubmit");
const btnGoogleLogin = document.getElementById("btnGoogleLogin");

const loginFormView = document.getElementById("loginFormView");
const forgotPasswordView = document.getElementById("forgotPasswordView");
const resetPasswordView = document.getElementById("resetPasswordView");
const btnForgotPasswordLink = document.getElementById("btnForgotPasswordLink");
const forgotPasswordEmailInput = document.getElementById("forgotPasswordEmailInput");
const forgotPasswordStatus = document.getElementById("forgotPasswordStatus");
const btnForgotPasswordBack = document.getElementById("btnForgotPasswordBack");
const btnForgotPasswordSubmit = document.getElementById("btnForgotPasswordSubmit");
const resetPasswordInput = document.getElementById("resetPasswordInput");
const resetPasswordStatus = document.getElementById("resetPasswordStatus");
const btnResetPasswordSubmit = document.getElementById("btnResetPasswordSubmit");
let pendingResetToken = "";

function showLoginView(view) {
  loginFormView.classList.toggle("hidden", view !== "form");
  forgotPasswordView.classList.toggle("hidden", view !== "forgot");
  resetPasswordView.classList.toggle("hidden", view !== "reset");
}

btnForgotPasswordLink.addEventListener("click", () => {
  forgotPasswordEmailInput.value = "";
  forgotPasswordStatus.textContent = "";
  showLoginView("forgot");
  forgotPasswordEmailInput.focus();
});

btnForgotPasswordBack.addEventListener("click", () => showLoginView("form"));

btnForgotPasswordSubmit.addEventListener("click", async () => {
  const email = forgotPasswordEmailInput.value.trim();
  if (!email) return;
  btnForgotPasswordSubmit.disabled = true;
  forgotPasswordStatus.textContent = t("common.saving");
  try {
    const res = await fetch(API_BASE + "/api/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    forgotPasswordStatus.textContent = t("login.forgotPasswordSent");
  } catch (err) {
    forgotPasswordStatus.textContent = t("common.saveFailed", { message: err.message });
  } finally {
    btnForgotPasswordSubmit.disabled = false;
  }
});

btnResetPasswordSubmit.addEventListener("click", async () => {
  const newPassword = resetPasswordInput.value;
  if (!newPassword) return;
  btnResetPasswordSubmit.disabled = true;
  resetPasswordStatus.textContent = t("common.saving");
  try {
    const res = await fetch(API_BASE + "/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: pendingResetToken, new_password: newPassword }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    resetPasswordInput.value = "";
    resetPasswordStatus.textContent = t("login.resetPasswordDone");
    setTimeout(() => showLoginView("form"), 1500);
  } catch (err) {
    resetPasswordStatus.textContent = t("common.saveFailed", { message: err.message });
  } finally {
    btnResetPasswordSubmit.disabled = false;
  }
});

const welcomeModalOverlay = document.getElementById("welcomeModalOverlay");
const welcomeBody = document.getElementById("welcomeBody");
const welcomeHouseTrialLine = document.getElementById("welcomeHouseTrialLine");
const btnWelcomeClose = document.getElementById("btnWelcomeClose");

const languagePickerOverlay = document.getElementById("languagePickerOverlay");
const LANGUAGE_PICKED_KEY = "uiLanguagePicked";

let turnstileWidgetId = null;
let turnstileToken = "";

function initTurnstile(retries = 25) {
  if (window.turnstile) {
    fetch(API_BASE + "/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((cfg) => {
        if (!cfg.turnstile_site_key || turnstileWidgetId !== null) return;
        turnstileWidgetId = window.turnstile.render("#turnstileWidget", {
          sitekey: cfg.turnstile_site_key,
          callback: (token) => { turnstileToken = token; },
          "expired-callback": () => { turnstileToken = ""; },
        });
      })
      .catch(() => {});
  } else if (retries > 0) {
    setTimeout(() => initTurnstile(retries - 1), 200);
  }
}

function resetTurnstile() {
  turnstileToken = "";
  if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
}

// ---------- 文档列表 / 加载 ----------

async function refreshDocuments(selectId) {
  allDocs = await fetchJsonWithOfflineCache("/api/documents", "documents");
  docSelect.innerHTML = "";
  allDocs.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    // <option> 是浏览器原生渲染的控件，不支持内嵌图标/HTML，只能是纯文本
    opt.textContent = `${d.filename} · ${(d.learning_language || "en").toUpperCase()}`;
    docSelect.appendChild(opt);
  });
  if (allDocs.length === 0) {
    currentDocId = null;
    currentDocName = "";
    showNoDocumentState();
    return;
  }
  const targetId = selectId || allDocs[allDocs.length - 1].id;
  docSelect.value = targetId;
  const target = allDocs.find((d) => d.id === targetId) || allDocs[allDocs.length - 1];
  loadDocument(target);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("learning_language", learningLanguageSelect.value);
  const res = await apiFetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    alert(t("upload.failed", { message: await apiErrorText(res) }));
    return;
  }
  const doc = await res.json();
  await refreshDocuments(doc.id);
  fileInput.value = "";
});

docSelect.addEventListener("change", () => {
  const doc = allDocs.find((d) => d.id === docSelect.value);
  if (doc) loadDocument(doc);
});

function loadDocument(doc) {
  // 打卡/统计用的"今天读过东西"信号，不等待、不影响阅读——网络失败或超时都无所谓。
  apiFetch("/api/activity/read-ping", { method: "POST" }).catch(() => {});

  // 切换到另一篇文章之前，如果上一篇开着沉浸模式还有没保存的替换词，先留个快照，
  // 等新文章加载完再弹出确认框——不阻塞切换文章本身，用户看到的是"已经在看新文章了，
  // 同时弹出一个要不要保存上一篇生词的提示"，而不是被卡住必须先处理完才能继续。
  const pendingWords = immersionEnabled && immersionWordsMap.size > 0 ? new Map(immersionWordsMap) : null;
  const pendingClicked = pendingWords ? new Set(immersionClickedWords) : null;

  currentDocId = doc.id;
  currentDocName = doc.filename;
  currentDocContent = doc.content;
  currentDocSourceUrl = doc.source_url || "";
  currentDocLearningLanguage = doc.learning_language || "en";
  resetImmersionSessionState();
  btnReaderSettings.classList.remove("hidden");
  btnPrint.classList.remove("hidden");
  renderHistoryForDoc(doc.filename);
  renderTextDocument(doc.content, doc.filename, doc.source_url);

  if (pendingWords) {
    showImmersionSaveDialog(pendingWords, pendingClicked);
  }
}

function renderTextDocument(content, title, sourceUrl, preserveScroll = false) {
  stopReadAloud(); // 重渲染会整个换掉 DOM，旧的句子元素引用会失效，先把播放状态清掉
  const savedScrollTop = preserveScroll ? viewer.scrollTop : 0;
  viewerContent.innerHTML = "";
  const container = document.createElement("div");
  container.className = "text-doc";
  container.appendChild(buildArticleHeader(content, title, sourceUrl));
  const paragraphs = content.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  let sentenceIdx = 0;
  paragraphs.forEach((trimmed, index) => {
    const el = document.createElement("p");
    el.className = "text-para";
    el.innerHTML = splitIntoSentences(trimmed)
      .map((sentence) => {
        let html = highlightKnownWords(sentence);
        if (immersionEnabled && immersionPlan) {
          html = applyImmersionSubstitutions(html, index, sentence);
        }
        const span = `<span class="tts-sentence" data-sentence-idx="${sentenceIdx}" data-sentence-text="${escapeHtml(sentence)}">${html}</span>`;
        sentenceIdx++;
        return span;
      })
      .join(" ");
    container.appendChild(el);
  });
  viewerContent.appendChild(container);
  if (preserveScroll) {
    // 只是为了刷新已存生词的高亮/沉浸模式替换而重渲染，文章还是同一篇，不该把读者
    // 拉回顶部——真正切换到一篇新文章时(loadDocument)才需要重置滚动位置和进度条。
    viewer.scrollTop = savedScrollTop;
    updateReadingProgress();
  } else {
    resetReadingProgress();
  }
}

// ---------- 文章头部(标题 / 来源 / 字数 / 预计阅读时长) ----------

function buildArticleHeader(content, title, sourceUrl) {
  const header = document.createElement("div");
  header.className = "articleHeader";

  const titleEl = document.createElement("h1");
  titleEl.className = "articleTitle";
  titleEl.textContent = title || "";
  header.appendChild(titleEl);

  const meta = document.createElement("div");
  meta.className = "articleMeta";

  if (sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
      const link = document.createElement("a");
      link.className = "articleSource";
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.innerHTML = iconHTML("globe") + displaySourceName(host);
      meta.appendChild(link);
    } catch (err) {
      // 网址格式有问题就不显示来源，不影响其他信息
    }
  }

  // 无空格语言(中/日/韩)按字符数估算，其他按拉丁字母单词数估算，两种计数方式差太多，
  // 用同一个正则会导致中/日/韩文章的"约 N 词"数值明显偏低甚至接近 0。
  const isCharCounted = ["zh", "ja", "ko"].includes(currentDocLearningLanguage);
  const count = isCharCounted
    ? (content.match(/[^\s]/g) || []).length
    : (content.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length;
  const minutes = Math.max(1, Math.round(count / (isCharCounted ? 400 : 150)));

  const statLang = document.createElement("span");
  statLang.className = "articleStat";
  statLang.textContent = t(`languages.${currentDocLearningLanguage}`) || currentDocLearningLanguage;
  meta.appendChild(statLang);

  const statWords = document.createElement("span");
  statWords.className = "articleStat";
  statWords.textContent = isCharCounted ? t("article.charCount", { count }) : t("article.wordCount", { count });
  meta.appendChild(statWords);

  const statTime = document.createElement("span");
  statTime.className = "articleStat";
  statTime.textContent = t("article.readTime", { minutes });
  meta.appendChild(statTime);

  if (canSpeak()) {
    const readAloudBtn = document.createElement("button");
    readAloudBtn.type = "button";
    readAloudBtn.className = "articleStat articleReadAloudBtn";
    readAloudBtn.innerHTML = iconHTML("volume-2") + t("article.readAloud");
    readAloudBtn.addEventListener("click", startReadAloud);
    meta.appendChild(readAloudBtn);
  }

  header.appendChild(meta);

  if (isCharCounted) {
    const docId = currentDocId;
    apiFetch(`/api/coverage/${docId}`).then(async (res) => {
      if (!res.ok || docId !== currentDocId) return;
      const data = await res.json();
      if (data.total_tokens > 0) appendCoverageStat(meta, data.coverage_pct);
    }).catch(() => {});
  } else {
    const coverage = computeLatinCoverage(content, currentDocLearningLanguage);
    if (coverage) appendCoverageStat(meta, coverage.pct);
  }

  return header;
}

function appendCoverageStat(meta, pct) {
  const statCoverage = document.createElement("span");
  statCoverage.className = "articleStat";
  statCoverage.textContent = t("article.coverage", { pct });
  meta.appendChild(statCoverage);
}

// 拉丁字母语言的覆盖率：跟 buildArticleHeader 里"约 N 词"用的是同一个单词正则，
// 口径保持一致；已知词表本身不分语言(knownWordsMap 是全局的)，这里手动按学习语言过滤一遍。
function computeLatinCoverage(content, learningLanguage) {
  const scopedKnown = new Set(
    [...knownWordsMap.values()]
      .filter((v) => v.learning_language === learningLanguage)
      .map((v) => (v.word || "").trim().toLowerCase())
  );
  const matches = content.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  if (matches.length === 0) return null;
  const isEnglish = learningLanguage === "en";
  let known = 0;
  matches.forEach((word) => {
    const lower = word.toLowerCase();
    if (scopedKnown.has(lower)) {
      known++;
    } else if (isEnglish && lemmatizeCandidates(lower).some((c) => scopedKnown.has(c))) {
      known++;
    }
  });
  return { total: matches.length, known, pct: Math.round((known / matches.length) * 100) };
}

function displaySourceName(host) {
  if (host.includes("bbc.")) return "BBC";
  if (host.includes("theguardian.com")) return "The Guardian";
  return host;
}

// ---------- 阅读进度条 ----------

function resetReadingProgress() {
  readingProgressFill.style.width = "0%";
  viewer.scrollTop = 0;
}

function updateReadingProgress() {
  const scrollable = viewer.scrollHeight - viewer.clientHeight;
  const pct = scrollable > 0 ? Math.min(100, Math.max(0, (viewer.scrollTop / scrollable) * 100)) : 0;
  readingProgressFill.style.width = pct + "%";
}

viewer.addEventListener("scroll", updateReadingProgress);

// ---------- 字号 / 版式 / 字体设置 ----------

const READER_SETTINGS_KEY = "readerSettings";
const READER_SETTINGS_DEFAULTS = { fontSize: "17", maxWidth: "700", fontFamily: "sans" };
const FONT_FAMILY_VALUES = {
  sans: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif`,
  serif: `"New York", Georgia, "Songti SC", serif`,
};

function loadReaderSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(READER_SETTINGS_KEY) || "{}");
    return { ...READER_SETTINGS_DEFAULTS, ...saved };
  } catch (err) {
    return { ...READER_SETTINGS_DEFAULTS };
  }
}

function applyReaderSettings(settings) {
  document.documentElement.style.setProperty("--reader-font-size", settings.fontSize + "px");
  document.documentElement.style.setProperty("--reader-max-width", settings.maxWidth + "px");
  document.documentElement.style.setProperty("--reader-font-family", FONT_FAMILY_VALUES[settings.fontFamily]);

  readerSettingsPanel.querySelectorAll(".settingsOptions:not(.immersionToggle)").forEach((group) => {
    const key = group.dataset.setting;
    group.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === String(settings[key]));
    });
  });
}

let readerSettings = loadReaderSettings();
applyReaderSettings(readerSettings);

readerSettingsPanel.querySelectorAll(".settingsOptions:not(.immersionToggle) button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.closest(".settingsOptions").dataset.setting;
    readerSettings[key] = btn.dataset.value;
    localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(readerSettings));
    applyReaderSettings(readerSettings);
  });
});

btnReaderSettings.addEventListener("click", () => {
  readerSettingsPanel.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!readerSettingsPanel.contains(e.target) && e.target !== btnReaderSettings) {
    readerSettingsPanel.classList.add("hidden");
  }
});

// ---------- API 用量统计 ----------

async function loadUsage() {
  try {
    const res = await apiFetch("/api/usage");
    const data = await res.json();
    const cost = data.cost_usd || 0;
    const costText = cost > 0 && cost < 0.001 ? "<$0.001" : `$${cost.toFixed(3)}`;
    usageBadge.textContent = cost > 0 ? t("usage.cost", { cost: costText }) : t("usage.count", { count: data.count });
    usageBadge.title = `${data.count} · ${t("usage.costDetail")}`;
  } catch (err) {
    // 统计接口失败不影响主功能，静默忽略
  }
}

// ---------- 打卡连续天数 / 学习数据面板 ----------

async function loadStats() {
  try {
    const res = await apiFetch("/api/stats");
    const data = await res.json();
    latestStats = data;
    streakBadge.innerHTML = `${iconHTML("flame", "inline-icon")} ${t("stats.streakBadge", { count: data.streak_days })}`;
  } catch (err) {
    // 统计接口失败不影响主功能，静默忽略
  }
}

function renderStats(data) {
  if (!data) return;
  statsStreakNumber.textContent = data.streak_days;
  statsVocabCount.textContent = data.vocab_count;
  statsDocCount.textContent = data.document_count;

  statsWeekStrip.innerHTML = "";
  data.last_7_days.forEach((d) => {
    const cell = document.createElement("div");
    cell.className = "statsWeekCell" + (d.active ? " active" : "");
    cell.title = d.date;
    statsWeekStrip.appendChild(cell);
  });

  statsAccuracyChart.innerHTML = "";
  data.accuracy_trend.forEach((d) => {
    const bar = document.createElement("div");
    bar.className = "accBar";
    const fill = document.createElement("div");
    if (d.pct === null) {
      fill.className = "accBar-fill empty";
      fill.style.height = "6%";
      fill.title = `${d.date}: ${t("stats.noData")}`;
    } else {
      fill.className = "accBar-fill " + (d.pct >= 50 ? "know" : "dontknow-only");
      fill.style.height = `${Math.max(d.pct, 6)}%`;
      fill.title = `${d.date}: ${d.pct}%`;
    }
    bar.appendChild(fill);
    statsAccuracyChart.appendChild(bar);
  });
}

async function openStatsPanel() {
  statsPanelOverlay.classList.remove("hidden");
  renderStats(latestStats);
  try {
    const res = await apiFetch("/api/stats");
    if (res.ok) {
      latestStats = await res.json();
      renderStats(latestStats);
    }
  } catch (err) {
    // 面板已经用缓存数据渲染过了，这里失败不额外提示
  }
}

btnStats.addEventListener("click", openStatsPanel);
btnStatsClose.addEventListener("click", () => statsPanelOverlay.classList.add("hidden"));
statsPanelOverlay.addEventListener("click", (e) => {
  if (e.target === statsPanelOverlay) statsPanelOverlay.classList.add("hidden");
});

// ---------- 站长专属统计页面 ----------

function renderAdminBarChart(container, entries) {
  container.innerHTML = "";
  const max = Math.max(1, ...entries.map((d) => d.count));
  entries.forEach((d) => {
    const bar = document.createElement("div");
    bar.className = "accBar";
    const fill = document.createElement("div");
    fill.className = "accBar-fill know";
    fill.style.height = `${Math.max((d.count / max) * 100, d.count > 0 ? 6 : 2)}%`;
    fill.title = `${d.date}: ${d.count}`;
    bar.appendChild(fill);
    container.appendChild(bar);
  });
}

function renderAdminStats(data) {
  if (!data) return;
  adminStatsTotalUsers.textContent = data.total_users;
  adminStatsTotalDocuments.textContent = data.total_documents;
  adminStatsTotalVocab.textContent = data.total_vocab;
  adminStatsTotalWaitlist.textContent = data.total_waitlist_signups;
  renderAdminBarChart(adminStatsSignupsChart, data.signups_by_day);
  renderAdminBarChart(adminStatsActiveChart, data.active_users_by_day);
}

async function openAdminStatsPanel() {
  adminStatsPanelOverlay.classList.remove("hidden");
  try {
    const res = await apiFetch("/api/admin/stats");
    if (res.ok) renderAdminStats(await res.json());
  } catch (err) {
    // 打开面板失败不额外提示，留空白即可
  }
}

btnAdminStats.addEventListener("click", openAdminStatsPanel);
btnAdminStatsClose.addEventListener("click", () => adminStatsPanelOverlay.classList.add("hidden"));
adminStatsPanelOverlay.addEventListener("click", (e) => {
  if (e.target === adminStatsPanelOverlay) adminStatsPanelOverlay.classList.add("hidden");
});

// ---------- 升级到 Pro（邮箱登记 + 自愿支持）----------

async function openProPanel() {
  proPanelOverlay.classList.remove("hidden");

  // 原生壳里有真的 Apple 内购可以买，网页版还没有真付费功能——两边显示不同的面板内容：
  // 原生显示订阅按钮，网页版显示等待名单/自愿支持(iOS App 不能同时展示外部付费入口，
  // 苹果审核会拒，所以原生这边直接不渲染等待名单/支持链接那两块)。
  if (isNativeApp()) {
    proWaitlistBlock.classList.add("hidden");
    proSupportBlock.classList.add("hidden");
    iapProBlock.classList.remove("hidden");
    await loadEntitlement();
    updateIapPanel();
    return;
  }

  iapProBlock.classList.add("hidden");
  proWaitlistBlock.classList.remove("hidden");
  proWaitlistStatus.textContent = "";
  btnProJoinWaitlist.disabled = false;
  proSupportBlock.classList.add("hidden");
  try {
    const res = await apiFetch("/api/waitlist");
    if (res.ok) {
      const data = await res.json();
      if (data.joined) {
        proEmailInput.value = data.email || "";
        btnProJoinWaitlist.disabled = true;
        proWaitlistStatus.textContent = t("pro.alreadyJoined");
      }
      if (data.support_link) {
        proSupportBlock.classList.remove("hidden");
        btnProSupport.href = data.support_link;
      }
    }
  } catch (err) {
    // 打开面板失败不额外提示，留空白即可
  }
}

btnUpgradePro.addEventListener("click", openProPanel);
btnProClose.addEventListener("click", () => proPanelOverlay.classList.add("hidden"));
proPanelOverlay.addEventListener("click", (e) => {
  if (e.target === proPanelOverlay) proPanelOverlay.classList.add("hidden");
});

btnProJoinWaitlist.addEventListener("click", async () => {
  const email = proEmailInput.value.trim();
  if (!email) {
    proWaitlistStatus.textContent = t("pro.emailRequired");
    return;
  }
  btnProJoinWaitlist.disabled = true;
  try {
    const res = await apiFetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    proWaitlistStatus.textContent = t("pro.joinSuccess");
  } catch (err) {
    proWaitlistStatus.textContent = t("common.saveFailed", { message: err.message });
    btnProJoinWaitlist.disabled = false;
  }
});

// ---------- 已学生词高亮 ----------

async function loadKnownWords() {
  const { vocab } = await getVocabAndNotes();
  knownWordsMap = new Map();
  vocab.forEach((v) => {
    const key = (v.word || "").trim().toLowerCase();
    if (key) knownWordsMap.set(key, v);
  });
  knownWords = new Set(knownWordsMap.keys());
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- 英语词形归并(只做英语，中/日/韩不做——形态学复杂度完全不是一个量级，也不在这次
// 要求的范围内) ----------
// 产出一组候选词根，而不是单一"正确"词根：候选里没有一个能在已知词表里命中就直接放弃，
// 所以规则不需要语言学上绝对精确，覆盖 develop/developing/developed 这类常见变化就够用。
// 不规则动词(went/go)、比较级最高级(better/best)明确不做。
function lemmatizeCandidates(lowerWord) {
  const candidates = [];
  if (lowerWord.length > 4 && lowerWord.endsWith("ies")) {
    candidates.push(lowerWord.slice(0, -3) + "y");
  }
  if (lowerWord.length > 3 && /(?:s|x|z|ch|sh)es$/.test(lowerWord)) {
    candidates.push(lowerWord.slice(0, -2));
  }
  if (lowerWord.length > 3 && lowerWord.endsWith("s") && !lowerWord.endsWith("ss")) {
    candidates.push(lowerWord.slice(0, -1));
  }
  ["ing", "ed"].forEach((suffix) => {
    if (lowerWord.length > suffix.length + 2 && lowerWord.endsWith(suffix)) {
      const stem = lowerWord.slice(0, -suffix.length);
      candidates.push(stem, stem + "e");
      const last = stem[stem.length - 1];
      const prev = stem[stem.length - 2];
      if (last && last === prev && !/[aeiou]/.test(last)) {
        candidates.push(stem.slice(0, -1));
      }
    }
  });
  return candidates;
}

function highlightKnownWords(text) {
  if (knownWords.size === 0) return escapeHtml(text);

  const isEnglish = currentDocLearningLanguage === "en";
  const wordRegex = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
  let result = "";
  let lastIndex = 0;
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    const word = match[0];
    result += escapeHtml(text.slice(lastIndex, match.index));
    const lower = word.toLowerCase();
    let matchedKey = knownWords.has(lower) ? lower : null;
    if (!matchedKey && isEnglish) {
      matchedKey = lemmatizeCandidates(lower).find((c) => knownWords.has(c)) || null;
    }
    if (matchedKey) {
      result += `<mark class="known-word" data-word="${escapeHtml(matchedKey)}">${escapeHtml(word)}</mark>`;
    } else {
      result += escapeHtml(word);
    }
    lastIndex = match.index + word.length;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

// ---------- 渐进沉浸阅读模式 ----------

function resetImmersionSessionState() {
  immersionEnabled = false;
  immersionPlan = null;
  immersionWordsMap = new Map();
  immersionClickedWords = new Set();
  document.querySelectorAll(".immersionToggle button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === "off");
  });
  immersionRatioRow1.classList.add("hidden");
}

function applyImmersionSubstitutions(html, paragraphIndex, paragraphText) {
  const entry = immersionPlan.paragraphs.find((p) => p.index === paragraphIndex);
  if (!entry || entry.substitutions.length === 0) return html;
  let result = html;
  entry.substitutions.forEach((sub) => {
    const targetLower = sub.target_word.toLowerCase();
    let mark;
    if (knownWordsMap.has(targetLower)) {
      // 这个目标词已经真的存进生词本了，按正常已学生词的样式显示，
      // 不再当"还没学"的沉浸替换词处理，也不用再塞进 immersionWordsMap。
      mark = `<mark class="known-word" data-word="${escapeHtml(targetLower)}">${escapeHtml(sub.target_word)}</mark>`;
    } else {
      immersionWordsMap.set(targetLower, {
        word: sub.target_word,
        chinese_meaning: sub.original_word,
        ipa: sub.ipa || "",
        pos: sub.pos || "",
        sentence: paragraphText,
        learning_language: immersionResolvedLanguage,
        source_doc: currentDocName,
      });
      mark = `<mark class="immersion-word" data-word="${escapeHtml(targetLower)}">${escapeHtml(sub.target_word)}</mark>`;
    }
    // original_word 只会是母语(中文)字符，跟已经插入的 .known-word(只包裹拉丁字符)的 HTML
    // 标签/属性不可能有重叠，直接按原文做字符串替换是安全的。
    result = result.split(sub.original_word).join(mark);
  });
  return result;
}

function setImmersionLoading(loading) {
  immersionLoadingBar.classList.toggle("hidden", !loading);
  document.querySelectorAll(".immersionToggle button").forEach((b) => (b.disabled = loading));
  immersionRatioSlider.disabled = loading;
}

async function fetchImmersionPlan() {
  if (!currentDocId) return;
  const settingsRes = await apiFetch("/api/settings");
  if (!settingsRes.ok) return;
  const settingsData = await settingsRes.json();
  immersionResolvedLanguage =
    settingsData.immersion_target_language === "follow"
      ? currentDocLearningLanguage
      : settingsData.immersion_target_language;

  immersionPlan = null;
  immersionWordsMap = new Map();
  immersionClickedWords = new Set();

  try {
    const res = await apiFetch("/api/immersion/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: currentDocContent,
        // 文章母语不在这里传：learning_language 是"这篇文章在学什么"，不是"文章是什么语言写的"，
        // 后端会直接从 content 检测真实语言来选分词器。
        learning_language: immersionResolvedLanguage,
        ratio: immersionRatio,
        exclude_proper_nouns: settingsData.immersion_exclude_proper_nouns,
        source_priority: settingsData.immersion_source_priority,
      }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    immersionPlan = await res.json();
  } catch (err) {
    alert(t("immersion.planFailed", { message: err.message }));
    immersionEnabled = false;
    document.querySelectorAll(".immersionToggle button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === "off");
    });
  }
  renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl, true);
}

async function saveVocabEntry(record) {
  try {
    const res = await apiFetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "word",
        text: record.word,
        context: record.sentence || "",
        chinese_meaning: record.chinese_meaning || "",
        ipa: record.ipa || "",
        pos: record.pos || "",
        source_doc: record.source_doc || currentDocName,
        learning_language: record.learning_language || currentDocLearningLanguage,
      }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    return true;
  } catch (err) {
    alert(t("immersion.saveFailed", { message: err.message }));
    return false;
  }
}

document.querySelectorAll(".immersionToggle button").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const turningOn = btn.dataset.value === "on";
    document.querySelectorAll(".immersionToggle button").forEach((b) => b.classList.toggle("active", b === btn));
    immersionRatioRow1.classList.toggle("hidden", !turningOn);
    immersionEnabled = turningOn;
    if (turningOn) {
      if (!currentDocId) return;
      try {
        setImmersionLoading(true);
        await fetchImmersionPlan();
      } finally {
        setImmersionLoading(false);
      }
    } else {
      immersionPlan = null;
      renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl, true);
    }
  });
});

// 「选词优先策略」在设置弹层里，不属于 readerSettingsPanel 那套持久化到 localStorage 的
// 通用逻辑，这里单独维护按钮的选中态；实际保存/读取走 GET/POST /api/settings。
document.querySelectorAll('.settingsOptions[data-setting="immersionSourcePriority"] button').forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll('.settingsOptions[data-setting="immersionSourcePriority"] button')
      .forEach((b) => b.classList.toggle("active", b === btn));
  });
});

function updateImmersionSliderDisplay() {
  immersionRatio = Number(immersionRatioSlider.value);
  immersionRatioValue.textContent = immersionRatio + "%";
}

immersionRatioSlider.addEventListener("input", updateImmersionSliderDisplay);
immersionRatioSlider.addEventListener("change", async () => {
  if (!immersionEnabled) return;
  try {
    setImmersionLoading(true);
    await fetchImmersionPlan();
  } finally {
    setImmersionLoading(false);
  }
});

let immersionSaveSnapshot = null; // {wordsMap, clickedSet}，弹窗当前展示的是哪一批词

function renderImmersionSaveList(wordsMap, clickedSet) {
  immersionSaveList.innerHTML = "";
  wordsMap.forEach((record, key) => {
    const row = document.createElement("div");
    row.className = "immersionSaveRow";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = clickedSet.has(key);
    checkbox.dataset.word = key;
    const text = document.createElement("div");
    text.className = "immersionSaveRow-text";
    const targetSpan = document.createElement("span");
    targetSpan.className = "immersionSaveRow-target";
    targetSpan.textContent = record.word;
    const originalSpan = document.createElement("span");
    originalSpan.className = "immersionSaveRow-original";
    originalSpan.textContent = record.chinese_meaning;
    text.append(targetSpan, document.createTextNode(" · "), originalSpan);
    row.append(checkbox, text);
    immersionSaveList.appendChild(row);
  });
}

function showImmersionSaveDialog(wordsMap, clickedSet) {
  if (!wordsMap || wordsMap.size === 0) return;
  immersionSaveSnapshot = { wordsMap, clickedSet };
  renderImmersionSaveList(wordsMap, clickedSet);
  immersionSaveOverlay.classList.remove("hidden");
}

btnImmersionSaveSkip.addEventListener("click", () => {
  immersionSaveOverlay.classList.add("hidden");
  immersionSaveSnapshot = null;
});

btnImmersionSaveConfirm.addEventListener("click", async () => {
  if (!immersionSaveSnapshot) return;
  const checked = [...immersionSaveList.querySelectorAll("input[type=checkbox]:checked")];
  btnImmersionSaveConfirm.disabled = true;
  btnImmersionSaveConfirm.textContent = t("common.saving");
  for (const checkbox of checked) {
    const record = immersionSaveSnapshot.wordsMap.get(checkbox.dataset.word);
    if (record) await saveVocabEntry(record);
  }
  if (checked.length > 0) {
    await loadKnownWords();
    renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl, true);
  }
  btnImmersionSaveConfirm.disabled = false;
  btnImmersionSaveConfirm.textContent = t("immersion.saveConfirm");
  immersionSaveOverlay.classList.add("hidden");
  immersionSaveSnapshot = null;
});

// ---------- 弹出层贴边定位：水平方向超出屏幕就往回收，垂直方向放不下就翻到锚点上方 ----------

function clampPopupPosition(el, anchorRect, { gapBelow = 8, gapAbove = 8, margin = 12 } = {}) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let left = window.scrollX + anchorRect.left;
  const maxLeft = window.scrollX + vw - w - margin;
  if (left > maxLeft) left = Math.max(window.scrollX + margin, maxLeft);

  let top = window.scrollY + anchorRect.bottom + gapBelow;
  if (anchorRect.bottom + h + gapBelow > vh) {
    const flippedTop = window.scrollY + anchorRect.top - h - gapAbove;
    top = flippedTop > window.scrollY + margin ? flippedTop : window.scrollY + vh - h - margin;
  }

  el.style.left = left + "px";
  el.style.top = top + "px";
}

// ---------- 点击已高亮的生词/沉浸模式替换词，弹出释义 ----------

const readAloudBar = document.getElementById("readAloudBar");
const btnReadAloudPlayPause = document.getElementById("btnReadAloudPlayPause");
const btnReadAloudStop = document.getElementById("btnReadAloudStop");

const wordPopup = document.getElementById("wordPopup");

viewerContent.addEventListener("click", (e) => {
  const mark = e.target.closest(".known-word, .immersion-word");
  if (!mark) return;
  if (mark.classList.contains("immersion-word")) {
    immersionClickedWords.add(mark.dataset.word);
  }
  showWordPopup(mark);
});

function showWordPopup(mark) {
  // 已经存进生词本的词优先显示真实状态，即使它同时也是沉浸模式替换出来的词
  const record = knownWordsMap.get(mark.dataset.word) || immersionWordsMap.get(mark.dataset.word);
  if (!record) return;
  const isSaved = knownWordsMap.has(mark.dataset.word);

  const meta = [record.pos, record.ipa].filter(Boolean).join("  ·  ");
  wordPopup.innerHTML = `
    <div class="wordPopup-header">
      <div class="wordPopup-word"></div>
      ${canSpeak() ? `<button type="button" class="pronounce-btn" title="${t("common.pronounce")}">${iconHTML("volume-2")}</button>` : ""}
    </div>
    <div class="wordPopup-meta"></div>
    <div class="wordPopup-meaning"></div>
    <div class="wordPopup-sentence"></div>
    <div class="wordPopup-forms hidden"></div>
    <div class="wordPopup-actions">
      ${isSaved
        ? `<button class="wordPopup-delete">${t("wordPopup.delete")}</button>`
        : `<button class="wordPopup-save-immersion">${t("immersion.saveWord")}</button>`}
    </div>
  `;
  wordPopup.querySelector(".wordPopup-word").textContent = record.word || "";
  wordPopup.querySelector(".wordPopup-meta").textContent = meta;
  wordPopup.querySelector(".wordPopup-meaning").textContent = record.chinese_meaning || "";
  wordPopup.querySelector(".wordPopup-sentence").textContent = record.sentence || "";
  const formsEl = wordPopup.querySelector(".wordPopup-forms");
  if (record.other_forms) {
    formsEl.textContent = `${t("annotation.otherForms")}${record.other_forms}`;
    formsEl.classList.remove("hidden");
  }
  const deleteBtn = wordPopup.querySelector(".wordPopup-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const ok = await deleteRecord({ ...record, mode: "word" });
      if (ok) hideWordPopup();
    });
  }
  const saveImmersionBtn = wordPopup.querySelector(".wordPopup-save-immersion");
  if (saveImmersionBtn) {
    saveImmersionBtn.addEventListener("click", async () => {
      saveImmersionBtn.disabled = true;
      const ok = await saveVocabEntry(record);
      if (ok) {
        await loadKnownWords();
        renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl, true);
        hideWordPopup();
      } else {
        saveImmersionBtn.disabled = false;
      }
    });
  }
  const wordPopupPronounceBtn = wordPopup.querySelector(".pronounce-btn");
  if (wordPopupPronounceBtn) {
    wordPopupPronounceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      speakText(record.word, record.learning_language || currentDocLearningLanguage);
    });
  }

  const rect = mark.getBoundingClientRect();
  wordPopup.classList.remove("hidden");
  clampPopupPosition(wordPopup, rect);
}

function hideWordPopup() {
  wordPopup.classList.add("hidden");
}

document.addEventListener("click", (e) => {
  if (wordPopup.classList.contains("hidden")) return;
  if (!wordPopup.contains(e.target) && !e.target.closest(".known-word, .immersion-word")) {
    hideWordPopup();
  }
});

// ---------- 添加文章面板(粘贴文本 / 网址导入) ----------

btnAddArticle.addEventListener("click", () => {
  pasteFromRecommendHint.classList.add("hidden");
  pastePanelOverlay.classList.remove("hidden");
});

// 出于版权顾虑，「AI 推荐」的"读这篇"不再自动抓正文，改成跳转到源网站
// + 引导用户自己复制正文回来粘贴，这个函数就是那座桥。
function openPasteFromExternal(pick) {
  alert(t("paste.fromExternalHint"));
  window.open(pick.url, "_blank", "noopener");
  activePasteTab = "paste";
  pasteTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === "paste"));
  document.querySelectorAll(".pasteTabContent").forEach((content) => {
    content.classList.toggle("hidden", content.dataset.tabContent !== "paste");
  });
  pasteTitle.value = pick.source ? `${pick.title} — ${pick.source}` : pick.title;
  pasteContent.value = "";
  pasteFromRecommendHint.textContent = t("paste.fromExternalHint");
  pasteFromRecommendHint.classList.remove("hidden");
  pastePanelOverlay.classList.remove("hidden");
  pasteContent.focus();
}

btnPasteCancel.addEventListener("click", () => {
  pastePanelOverlay.classList.add("hidden");
});

pastePanelOverlay.addEventListener("click", (e) => {
  if (e.target === pastePanelOverlay) pastePanelOverlay.classList.add("hidden");
});

learningLanguageSelect.addEventListener("change", () => {
  localStorage.setItem(LAST_LEARNING_LANGUAGE_KEY, learningLanguageSelect.value);
});

settingsLearningLanguageSelect.addEventListener("change", () => {
  localStorage.setItem(LAST_LEARNING_LANGUAGE_KEY, settingsLearningLanguageSelect.value);
});

pasteTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activePasteTab = tab.dataset.tab;
    pasteTabs.forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".pasteTabContent").forEach((content) => {
      content.classList.toggle("hidden", content.dataset.tabContent !== activePasteTab);
    });
  });
});

btnPasteSubmit.addEventListener("click", async () => {
  if (activePasteTab === "url") {
    await submitUrlImport();
  } else {
    await submitPasteText();
  }
});

async function submitPasteText() {
  const title = pasteTitle.value.trim();
  const content = pasteContent.value.trim();
  if (!content) {
    alert(t("paste.needContent"));
    return;
  }
  btnPasteSubmit.disabled = true;
  try {
    const res = await apiFetch("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, learning_language: learningLanguageSelect.value }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    const doc = await res.json();
    await refreshDocuments(doc.id);
    pastePanelOverlay.classList.add("hidden");
    pasteTitle.value = "";
    pasteContent.value = "";
  } catch (err) {
    alert(t("paste.saveFailed", { message: err.message }));
  } finally {
    btnPasteSubmit.disabled = false;
  }
}

async function fetchUrlAsDocument(url, learningLanguage) {
  const res = await apiFetch("/api/fetch-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, learning_language: learningLanguage || learningLanguageSelect.value }),
  });
  if (!res.ok) throw new Error(await apiErrorText(res));
  return res.json();
}

async function submitUrlImport() {
  const url = urlInput.value.trim();
  if (!url) {
    alert(t("paste.needUrl"));
    return;
  }
  btnPasteSubmit.disabled = true;
  const originalLabel = btnPasteSubmit.textContent;
  btnPasteSubmit.textContent = t("recommend.fetching");
  try {
    const doc = await fetchUrlAsDocument(url);
    await refreshDocuments(doc.id);
    pastePanelOverlay.classList.add("hidden");
    urlInput.value = "";
  } catch (err) {
    alert(t("paste.fetchFailed", { message: err.message }));
  } finally {
    btnPasteSubmit.disabled = false;
    btnPasteSubmit.textContent = originalLabel;
  }
}

// ---------- AI 推荐文章 ----------

btnRecommend.addEventListener("click", () => {
  recommendPanelOverlay.classList.remove("hidden");
  loadRecommendations(false);
});

btnRecommendClose.addEventListener("click", () => {
  recommendPanelOverlay.classList.add("hidden");
});

recommendPanelOverlay.addEventListener("click", (e) => {
  if (e.target === recommendPanelOverlay) recommendPanelOverlay.classList.add("hidden");
});

btnRecommendRefresh.addEventListener("click", () => loadRecommendations(true));

function populateRecommendLevelOptions() {
  const prevValue = recommendLevelSelect.value || DEFAULT_LEVEL;
  recommendLevelSelect.innerHTML = "";
  CEFR_LEVELS.forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = t(`levels.${code}`);
    recommendLevelSelect.appendChild(opt);
  });
  recommendLevelSelect.value = CEFR_LEVELS.includes(prevValue) ? prevValue : DEFAULT_LEVEL;
}

recommendLevelSelect.addEventListener("change", async () => {
  const learningLanguage = getLastLearningLanguage();
  try {
    await apiFetch("/api/proficiency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ learning_language: learningLanguage, level: recommendLevelSelect.value }),
    });
  } catch (err) {
    // 保存水平失败也不阻塞，下面照样按新选的水平重新拉一次推荐
  }
  loadRecommendations(true);
});

async function loadRecommendations(refresh) {
  recommendList.innerHTML = `<p class="recommend-loading">${t("recommend.loading")}</p>`;
  btnRecommendRefresh.disabled = true;
  try {
    const learningLanguage = getLastLearningLanguage();
    document.getElementById("recommendLangHint").textContent = t("recommend.forLanguage", {
      language: t(`languages.${learningLanguage}`),
    });
    const levelRes = await apiFetch(`/api/proficiency?learning_language=${learningLanguage}`);
    if (levelRes.ok) {
      const levelData = await levelRes.json();
      recommendLevelSelect.value = levelData.level;
    }
    const params = new URLSearchParams({ learning_language: learningLanguage });
    if (refresh) params.set("refresh", "true");
    const res = await apiFetch(`/api/recommendations?${params.toString()}`);
    if (!res.ok) throw new Error(await apiErrorText(res));
    const picks = await res.json();
    renderRecommendations(picks);
    loadUsage();
  } catch (err) {
    recommendList.innerHTML = `<p class="recommend-loading">${t("recommend.failed", { message: err.message })}</p>`;
  } finally {
    btnRecommendRefresh.disabled = false;
  }
}

function renderRecommendations(picks) {
  if (!picks || picks.length === 0) {
    recommendList.innerHTML = `<p class="recommend-loading">${t("recommend.empty")}</p>`;
    return;
  }
  recommendList.innerHTML = "";
  picks.forEach((pick) => {
    const card = document.createElement("div");
    card.className = "recCard";
    card.innerHTML = `
      <div class="recCard-tags"></div>
      <div class="recCard-title"></div>
      <div class="recCard-reason"></div>
      <div class="recCard-footer">
        <span class="recCard-source"></span>
        <button class="btn btn-primary btn-small">${t("recommend.readThis")}</button>
      </div>
    `;
    const tagsEl = card.querySelector(".recCard-tags");
    (pick.tags || []).forEach((tag) => {
      const tagEl = document.createElement("span");
      tagEl.className = "rec-tag";
      tagEl.textContent = tag;
      tagsEl.appendChild(tagEl);
    });
    if (pick.difficulty) {
      const diffEl = document.createElement("span");
      diffEl.className = "rec-tag rec-tag-difficulty";
      diffEl.textContent = t("recommend.difficulty", { level: pick.difficulty });
      tagsEl.appendChild(diffEl);
    }
    card.querySelector(".recCard-title").textContent = pick.title;
    card.querySelector(".recCard-reason").textContent = pick.reason || "";
    card.querySelector(".recCard-source").textContent = pick.source;

    const readBtn = card.querySelector(".btn-primary");
    readBtn.textContent = t("recommend.readThis");
    // 不在站内抓正文——推荐列表只展示 RSS 本身就公开提供的标题/摘要，点"读这篇"
    // 直接跳转到源网站的原文页面，不把完整正文抓进自己的数据库,降低版权风险；
    // 同时把"粘贴文本"面板打开好，方便用户手动复制正文回来继续用完整功能。
    readBtn.addEventListener("click", () => {
      recommendPanelOverlay.classList.add("hidden");
      openPasteFromExternal(pick);
    });

    recommendList.appendChild(card);
  });
}

// ---------- 母语新闻(沉浸模式素材，母语=界面语言，点进去直接开沉浸阅读) ----------

btnNativeNews.addEventListener("click", () => {
  nativeNewsPanelOverlay.classList.remove("hidden");
  loadNativeNews(false);
});

btnNativeNewsClose.addEventListener("click", () => {
  nativeNewsPanelOverlay.classList.add("hidden");
});

nativeNewsPanelOverlay.addEventListener("click", (e) => {
  if (e.target === nativeNewsPanelOverlay) nativeNewsPanelOverlay.classList.add("hidden");
});

btnNativeNewsRefresh.addEventListener("click", () => loadNativeNews(true));

async function loadNativeNews(refresh) {
  nativeNewsList.innerHTML = `<p class="recommend-loading">${t("nativeNews.loading")}</p>`;
  btnNativeNewsRefresh.disabled = true;
  try {
    document.getElementById("nativeNewsLangHint").textContent = t("nativeNews.langHint", {
      language: t(`languages.${currentUiLanguage}`),
    });
    const params = new URLSearchParams();
    if (refresh) params.set("refresh", "true");
    const res = await apiFetch(`/api/immersion/native-news?${params.toString()}`);
    if (!res.ok) throw new Error(await apiErrorText(res));
    const items = await res.json();
    renderNativeNews(items);
  } catch (err) {
    nativeNewsList.innerHTML = `<p class="recommend-loading">${t("nativeNews.failed", { message: err.message })}</p>`;
  } finally {
    btnNativeNewsRefresh.disabled = false;
  }
}

function renderNativeNews(items) {
  if (!items || items.length === 0) {
    nativeNewsList.innerHTML = `<p class="recommend-loading">${t("nativeNews.empty")}</p>`;
    return;
  }
  nativeNewsList.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "recCard";
    card.innerHTML = `
      <div class="recCard-title"></div>
      <div class="recCard-reason"></div>
      <div class="recCard-footer">
        <span class="recCard-source"></span>
        <button class="btn btn-primary btn-small">${t("recommend.readThis")}</button>
      </div>
    `;
    card.querySelector(".recCard-title").textContent = item.title;
    card.querySelector(".recCard-reason").textContent = item.summary || "";
    card.querySelector(".recCard-source").textContent = item.source;

    const readBtn = card.querySelector(".btn-primary");
    readBtn.textContent = t("recommend.readThis");
    readBtn.addEventListener("click", async () => {
      readBtn.disabled = true;
      readBtn.textContent = t("recommend.fetching");
      try {
        const doc = await fetchUrlAsDocument(item.url, getLastLearningLanguage());
        await refreshDocuments(doc.id);
        nativeNewsPanelOverlay.classList.add("hidden");
        const immersionOnBtn = document.querySelector('.immersionToggle button[data-value="on"]');
        if (immersionOnBtn && !immersionOnBtn.classList.contains("active")) immersionOnBtn.click();
      } catch (err) {
        alert(t("paste.fetchFailed", { message: err.message }));
        readBtn.disabled = false;
        readBtn.textContent = t("recommend.readThis");
      }
    });

    nativeNewsList.appendChild(card);
  });
}

// ---------- 单词发音(浏览器内置 TTS，不用后端也不用额外的 API key) ----------

const SPEECH_LANG_MAP = {
  en: "en-US", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", fr: "fr-FR",
  es: "es-ES", de: "de-DE", it: "it-IT", pt: "pt-PT", ru: "ru-RU",
  ar: "ar-SA", th: "th-TH",
};

function canSpeak() {
  return "speechSynthesis" in window;
}

function speakText(text, learningLanguage) {
  if (!canSpeak() || !text) return;
  window.speechSynthesis.cancel(); // 打断上一个还没播完的朗读
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG_MAP[learningLanguage] || "en-US";
  window.speechSynthesis.speak(utterance);
}

// ---------- 整篇文章朗读(跟单词朗读 speakText 分开一套状态机——speakText 每次调用都会先
// cancel 掉上一个，没法用来做连续多句播放) ----------

let readAloudState = { playing: false, sentenceEls: [], index: 0 };

function startReadAloud() {
  if (!canSpeak()) return;
  readAloudState.sentenceEls = [...viewerContent.querySelectorAll(".tts-sentence")];
  if (readAloudState.sentenceEls.length === 0) return;
  window.speechSynthesis.cancel();
  readAloudState.playing = true;
  readAloudBar.classList.remove("hidden");
  updateReadAloudPlayPauseIcon();
  playSentenceAt(0);
}

function playSentenceAt(i) {
  const els = readAloudState.sentenceEls;
  clearReadAloudHighlight();
  if (i >= els.length) {
    stopReadAloud();
    return;
  }
  readAloudState.index = i;
  const el = els[i];
  el.classList.add("tts-sentence-active");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const utterance = new SpeechSynthesisUtterance(el.dataset.sentenceText);
  utterance.lang = SPEECH_LANG_MAP[currentDocLearningLanguage] || "en-US";
  utterance.onend = () => {
    if (readAloudState.playing) playSentenceAt(i + 1);
  };
  window.speechSynthesis.speak(utterance);
}

function clearReadAloudHighlight() {
  readAloudState.sentenceEls.forEach((el) => el.classList.remove("tts-sentence-active"));
}

function updateReadAloudPlayPauseIcon() {
  btnReadAloudPlayPause.innerHTML = iconHTML(readAloudState.playing ? "pause" : "play");
  btnReadAloudPlayPause.title = t(readAloudState.playing ? "readAloud.pause" : "readAloud.play");
}

function stopReadAloud() {
  if (canSpeak()) window.speechSynthesis.cancel();
  readAloudState.playing = false;
  clearReadAloudHighlight();
  readAloudState.sentenceEls = [];
  readAloudState.index = 0;
  readAloudBar.classList.add("hidden");
}

btnReadAloudPlayPause.addEventListener("click", () => {
  if (!canSpeak()) return;
  if (readAloudState.playing) {
    window.speechSynthesis.pause();
    readAloudState.playing = false;
  } else {
    window.speechSynthesis.resume();
    readAloudState.playing = true;
  }
  updateReadAloudPlayPauseIcon();
});

btnReadAloudStop.addEventListener("click", stopReadAloud);

// ---------- 划词 / 划句 ----------

function showSelectionToolbarForCurrentSelection() {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  if (!text || selection.rangeCount === 0 || !viewerContent.contains(selection.anchorNode)) {
    selectionToolbar.classList.add("hidden");
    return;
  }

  pendingSelectionText = text;
  pendingSelectionMode = /\s/.test(text) ? "passage" : "word";
  pendingSelectionContext = extractSentenceContext(selection, text);

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  btnAnalyze.innerHTML =
    pendingSelectionMode === "word"
      ? iconHTML("bookmark") + t("toolbar.saveWord")
      : iconHTML("lightbulb") + t("toolbar.analyzeSentence");
  btnPronounce.classList.toggle("hidden", !(pendingSelectionMode === "word" && canSpeak()));
  btnPronounce.title = t("common.pronounce");
  selectionToolbar.classList.remove("hidden");
  clampPopupPosition(selectionToolbar, rect, { gapBelow: 6 });
}

document.addEventListener("mouseup", (e) => {
  if (selectionToolbar.contains(e.target)) return;
  showSelectionToolbarForCurrentSelection();
});

// 触屏设备的长按选字不一定能可靠触发 mouseup，这里用 selectionchange 补一条路径，
// 只在触屏设备上生效(靠 pointer:coarse 判断)，不影响桌面端已有的 mouseup 行为，
// 做了防抖避免选区还没定型就频繁触发。
const isCoarsePointerDevice = window.matchMedia("(pointer: coarse)").matches;
let selectionChangeDebounceTimer = null;
document.addEventListener("selectionchange", () => {
  if (!isCoarsePointerDevice) return;
  clearTimeout(selectionChangeDebounceTimer);
  selectionChangeDebounceTimer = setTimeout(showSelectionToolbarForCurrentSelection, 250);
});

btnPronounce.addEventListener("click", (e) => {
  e.stopPropagation();
  speakText(pendingSelectionText, currentDocLearningLanguage);
});

const SENTENCE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie",
  "am", "pm", "no", "vol", "fig", "approx", "dept", "gov", "rev", "gen",
  "col", "capt", "lt", "sgt", "co", "inc", "ltd", "corp", "ave", "blvd",
]);

const SENTENCE_END_CHARS = new Set([".", "!", "?", "。", "！", "？"]);

// 判断某个句尾符号是不是真正的句子结尾（排除缩写词、人名首字母、小数点）；
// 中/日/韩的全角标点(。！？)没有缩写/小数点这些歧义，直接算数。
function isRealSentenceEnd(text, idx) {
  const ch = text[idx];
  if (ch === "!" || ch === "?" || ch === "。" || ch === "！" || ch === "？") return true;

  const before = text.slice(0, idx);
  const after = text.slice(idx + 1);

  // 小数点，例如 3.14
  if (/\d$/.test(before) && /^\d/.test(after)) return false;

  const wordMatch = before.match(/([A-Za-z]+)$/);
  if (wordMatch) {
    const word = wordMatch[1];
    if (SENTENCE_ABBREVIATIONS.has(word.toLowerCase())) return false;
    // 单个大写字母，比如人名缩写 "J. Smith" 或 "U.S." 里的 U / S
    if (word.length === 1 && word === word.toUpperCase()) return false;
  }

  // 句号后面紧跟小写字母，大概率不是真正的句尾（比如 "U.S. government"）
  const nextMatch = after.match(/^\s*(\S)/);
  if (nextMatch) {
    const nextChar = nextMatch[1];
    if (nextChar !== nextChar.toUpperCase() && nextChar === nextChar.toLowerCase()) return false;
  }

  return true;
}

function findSentenceStart(text, fromIndex) {
  for (let i = fromIndex - 1; i >= 0; i--) {
    const ch = text[i];
    if (SENTENCE_END_CHARS.has(ch) && isRealSentenceEnd(text, i)) {
      return i + 1;
    }
  }
  return 0;
}

function findSentenceEnd(text, fromIndex) {
  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i];
    if (SENTENCE_END_CHARS.has(ch) && isRealSentenceEnd(text, i)) {
      return i + 1;
    }
  }
  return text.length;
}

// 把一段文字切成句子数组，供整篇朗读逐句播放用；复用上面的句尾判定逻辑。
function splitIntoSentences(text) {
  const sentences = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = findSentenceEnd(text, cursor);
    const chunk = text.slice(cursor, end).trim();
    if (chunk) sentences.push(chunk);
    cursor = end;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
  }
  return sentences.length ? sentences : [text];
}

function extractSentenceContext(selection, selectedText) {
  const range = selection.getRangeAt(0);
  const anchorEl =
    range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  const container = anchorEl.closest(".text-para") || anchorEl;
  const containerText = container.textContent;

  const preRange = document.createRange();
  preRange.selectNodeContents(container);
  try {
    preRange.setEnd(range.startContainer, range.startOffset);
  } catch (err) {
    return containerText.slice(0, 300).trim();
  }
  const offset = preRange.toString().length;

  const start = findSentenceStart(containerText, offset);
  const end = findSentenceEnd(containerText, offset + selectedText.length);

  return containerText.slice(start, end).trim();
}

// ---------- AI 解析 + 保存 ----------

btnAnalyze.addEventListener("click", () => {
  selectionToolbar.classList.add("hidden");
  const text = pendingSelectionText;
  const mode = pendingSelectionMode;
  const context = pendingSelectionContext;

  const entryEl = addAnnotationEntry(text, mode, context);
  runAnalyze(entryEl, text, mode, context);
});

async function runAnalyze(entryEl, text, mode, context) {
  const explEl = entryEl.querySelector(".ann-explanation");
  const actionsEl = entryEl.querySelector(".ann-actions");
  const retryEl = entryEl.querySelector(".ann-retry");

  explEl.textContent = t("annotation.analyzing");
  explEl.classList.remove("ann-explanation-error");
  actionsEl.classList.add("hidden");
  retryEl.classList.add("hidden");

  try {
    const res = await apiFetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, context, mode, learning_language: currentDocLearningLanguage }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    const data = await res.json();
    updateAnnotationEntry(entryEl, data);
    actionsEl.classList.remove("hidden");
    loadUsage();
  } catch (err) {
    explEl.textContent = t("annotation.analyzeFailedPrefix", { message: err.message });
    explEl.classList.add("ann-explanation-error");
    retryEl.classList.remove("hidden");
  }
}

function addAnnotationEntry(text, mode, context) {
  clearHistoryEmptyState();
  const el = document.createElement("div");
  el.className = "annotation";
  el.dataset.mode = mode;
  el.dataset.context = context;
  el.innerHTML = `
    <span class="ann-type ann-type-${mode}">${mode === "word" ? t("annotation.word") : t("annotation.sentence")}</span>
    <div class="ann-text-row">
      <div class="ann-text"></div>
      ${mode === "word" && canSpeak() ? `<button type="button" class="pronounce-btn" title="${t("common.pronounce")}">${iconHTML("volume-2")}</button>` : ""}
    </div>
    <div class="ann-meta"></div>
    <div class="ann-lemma hidden"></div>
    <div class="ann-forms hidden"></div>
    <div class="ann-explanation">${t("annotation.analyzing")}</div>
    <div class="ann-actions hidden">
      <button class="ann-save">${mode === "word" ? t("annotation.saveWordBtn") : t("annotation.saveSentenceBtn")}</button>
      <span class="ann-sync-status"></span>
    </div>
    <div class="ann-retry hidden">
      <button class="ann-retry-btn">${iconHTML("refresh-cw")}${t("annotation.retry")}</button>
    </div>
  `;
  el.querySelector(".ann-text").textContent = text;
  el.querySelector(".ann-save").addEventListener("click", () => saveAnnotation(el, text));
  el.querySelector(".ann-retry-btn").addEventListener("click", () => runAnalyze(el, text, mode, context));
  const pronounceBtn = el.querySelector(".pronounce-btn");
  if (pronounceBtn) {
    pronounceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      speakText(text, currentDocLearningLanguage);
    });
  }
  annotationList.prepend(el);
  return el;
}

function updateAnnotationEntry(el, data) {
  el.dataset.explanation = data.explanation || "";
  el.dataset.chineseMeaning = data.chinese_meaning || "";
  el.dataset.ipa = data.ipa || "";
  el.dataset.pos = data.pos || "";
  el.dataset.lemma = data.lemma || "";
  el.dataset.otherForms = data.other_forms || "";

  const metaEl = el.querySelector(".ann-meta");
  const explEl = el.querySelector(".ann-explanation");
  const lemmaEl = el.querySelector(".ann-lemma");
  const formsEl = el.querySelector(".ann-forms");

  if (el.dataset.mode === "word" && data.chinese_meaning) {
    metaEl.textContent = [data.pos, data.ipa].filter(Boolean).join("  ·  ");
    explEl.textContent = data.chinese_meaning;

    // 划中的原词和 AI 识别出的原形不一样才需要提示(比如划中的是过去式)，一样的话
    // 再显示一遍是啰嗦——由小红书用户燃點IGNITE提议。
    const rawWord = el.querySelector(".ann-text").textContent.trim();
    if (data.lemma && data.lemma.trim().toLowerCase() !== rawWord.toLowerCase()) {
      lemmaEl.textContent = `${t("annotation.lemma")}${data.lemma}`;
      lemmaEl.classList.remove("hidden");
    } else {
      lemmaEl.classList.add("hidden");
    }
    if (data.other_forms) {
      formsEl.textContent = `${t("annotation.otherForms")}${data.other_forms}`;
      formsEl.classList.remove("hidden");
    } else {
      formsEl.classList.add("hidden");
    }
  } else {
    metaEl.textContent = "";
    explEl.textContent = data.explanation || t("annotation.noResult");
    lemmaEl.classList.add("hidden");
    formsEl.classList.add("hidden");
  }
}

// ---------- 历史记录(只显示当前这篇文章相关的生词/句子笔记) ----------

function clearHistoryEmptyState() {
  const empty = annotationList.querySelector(".history-empty");
  if (empty) empty.remove();
}

function showHistoryEmptyState(message) {
  annotationList.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "history-empty";
  empty.textContent = message;
  annotationList.appendChild(empty);
}

function showNoDocumentState() {
  viewerContent.innerHTML = `
    <div id="emptyState">
      <p class="emptyState-hint">${t("empty.getStartedHint")}</p>
      <div class="emptyStateActions">
        <button class="btn btn-primary" id="emptyStateRecommend">${t("empty.tryRecommended")}</button>
        <button class="btn btn-ghost" id="emptyStateNativeNews">${t("empty.tryNativeNews")}</button>
      </div>
      <p class="emptyState-or">${t("empty.noDocument")}</p>
    </div>`;
  document.getElementById("emptyStateRecommend").addEventListener("click", () => btnRecommend.click());
  document.getElementById("emptyStateNativeNews").addEventListener("click", () => btnNativeNews.click());
  showHistoryEmptyState(t("history.emptyNoDoc"));
  btnReaderSettings.classList.add("hidden");
  readerSettingsPanel.classList.add("hidden");
  btnPrint.classList.add("hidden");
}

async function renderHistoryForDoc(docName) {
  annotationList.innerHTML = "";

  const { vocab, notes } = await getVocabAndNotes();

  const combined = [
    ...vocab.map((v) => ({ ...v, mode: "word" })),
    ...notes.map((n) => ({ ...n, mode: "passage" })),
  ]
    .filter((r) => r.source_doc === docName)
    .sort((a, b) => (a.added_at < b.added_at ? 1 : -1));

  if (combined.length === 0) {
    showHistoryEmptyState(t("history.emptyDoc"));
    return;
  }

  combined.forEach((record) => renderHistoryEntry(record));
}

function buildHistoryCard(record) {
  const isWord = record.mode === "word";
  const text = isWord ? record.word : record.sentence;
  const meta = isWord ? [record.pos, record.ipa].filter(Boolean).join("  ·  ") : "";
  const explanation = isWord ? record.chinese_meaning : record.analysis;

  const el = document.createElement("div");
  el.className = "annotation annotation-saved";
  el.innerHTML = `
    <span class="ann-type ann-type-${record.mode}">${isWord ? t("annotation.word") : t("annotation.sentence")}</span>
    <div class="ann-text-row">
      <div class="ann-text"></div>
      ${isWord && canSpeak() ? `<button type="button" class="pronounce-btn" title="${t("common.pronounce")}">${iconHTML("volume-2")}</button>` : ""}
    </div>
    <div class="ann-meta"></div>
    <div class="ann-explanation"></div>
    ${isWord ? '<div class="ann-context"></div>' : ""}
    ${isWord ? '<div class="ann-forms hidden"></div>' : ""}
    <div class="ann-footer">
      <div class="ann-footer-meta">
        <span class="ann-source"></span>
        <span class="ann-date"></span>
      </div>
      <div class="ann-footer-actions">
        <button class="ann-edit-btn" title="${t("history.editBtn")}">${iconHTML("pencil")}</button>
        <button class="ann-delete-btn">${t("history.deleteBtn")}</button>
      </div>
    </div>
  `;
  el.querySelector(".ann-text").textContent = text || "";
  el.querySelector(".ann-meta").textContent = meta;
  el.querySelector(".ann-explanation").textContent = explanation || "";
  el.querySelector(".ann-source").textContent = record.source_doc || "";
  el.querySelector(".ann-date").textContent = record.date || "";
  if (isWord) {
    el.querySelector(".ann-context").textContent = record.sentence || "";
    const formsEl = el.querySelector(".ann-forms");
    if (record.other_forms) {
      formsEl.textContent = `${t("annotation.otherForms")}${record.other_forms}`;
      formsEl.classList.remove("hidden");
    }
  }
  el.querySelector(".ann-delete-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await deleteRecord(record);
    if (ok) el.remove();
  });
  const pronounceBtn = el.querySelector(".pronounce-btn");
  if (pronounceBtn) {
    pronounceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      speakText(text, record.learning_language || "en");
    });
  }
  const editBtn = el.querySelector(".ann-edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openHistoryCardEditForm(el, record);
    });
  }
  return el;
}

function openHistoryCardEditForm(el, record) {
  const isWord = record.mode === "word";
  const textEl = el.querySelector(".ann-text");
  const explanationEl = el.querySelector(".ann-explanation");
  const contextEl = el.querySelector(".ann-context");
  const formsEl = el.querySelector(".ann-forms");
  const footerActions = el.querySelector(".ann-footer-actions");
  const savedFooterHTML = footerActions.innerHTML;

  const textInput = document.createElement(isWord ? "input" : "textarea");
  if (isWord) textInput.type = "text";
  textInput.className = isWord ? "ann-edit-input" : "ann-edit-textarea";
  textInput.value = (isWord ? record.word : record.sentence) || "";
  textEl.replaceWith(textInput);

  const explanationInput = document.createElement("textarea");
  explanationInput.className = "ann-edit-textarea";
  explanationInput.value = (isWord ? record.chinese_meaning : record.analysis) || "";
  explanationEl.replaceWith(explanationInput);

  let contextInput = null;
  let formsInput = null;
  if (isWord) {
    contextInput = document.createElement("input");
    contextInput.type = "text";
    contextInput.className = "ann-edit-input";
    contextInput.value = record.sentence || "";
    contextInput.placeholder = t("history.editContextPlaceholder");
    contextEl.replaceWith(contextInput);

    formsInput = document.createElement("input");
    formsInput.type = "text";
    formsInput.className = "ann-edit-input";
    formsInput.value = record.other_forms || "";
    formsInput.placeholder = t("history.editFormsPlaceholder");
    formsEl.replaceWith(formsInput);
  }

  footerActions.innerHTML = `
    <button class="btn btn-ghost btn-small ann-cancel-btn">${t("common.cancel")}</button>
    <button class="btn btn-primary btn-small ann-save-btn">${t("common.save")}</button>
  `;

  function restoreDisplay() {
    const newText = document.createElement("div");
    newText.className = "ann-text";
    newText.textContent = (isWord ? record.word : record.sentence) || "";
    textInput.replaceWith(newText);

    const newExplanation = document.createElement("div");
    newExplanation.className = "ann-explanation";
    newExplanation.textContent = (isWord ? record.chinese_meaning : record.analysis) || "";
    explanationInput.replaceWith(newExplanation);

    if (isWord) {
      const newContext = document.createElement("div");
      newContext.className = "ann-context";
      newContext.textContent = record.sentence || "";
      contextInput.replaceWith(newContext);

      const newForms = document.createElement("div");
      newForms.className = "ann-forms" + (record.other_forms ? "" : " hidden");
      newForms.textContent = record.other_forms ? `${t("annotation.otherForms")}${record.other_forms}` : "";
      formsInput.replaceWith(newForms);
    }

    footerActions.innerHTML = savedFooterHTML;
    footerActions.querySelector(".ann-edit-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openHistoryCardEditForm(el, record);
    });
    footerActions.querySelector(".ann-delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await deleteRecord(record);
      if (ok) el.remove();
    });
  }

  footerActions.querySelector(".ann-cancel-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    restoreDisplay();
  });
  footerActions.querySelector(".ann-save-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const textValue = textInput.value.trim();
    if (!textValue) {
      alert(isWord ? t("history.editWordRequired") : t("history.editSentenceRequired"));
      return;
    }
    const endpoint = isWord ? `/api/vocab/${record.id}` : `/api/sentence_notes/${record.id}`;
    const body = isWord
      ? {
          word: textValue,
          chinese_meaning: explanationInput.value.trim(),
          sentence: contextInput.value.trim(),
          other_forms: formsInput.value.trim(),
        }
      : {
          sentence: textValue,
          analysis: explanationInput.value.trim(),
        };
    try {
      const res = await apiFetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await apiErrorText(res));
      const data = await res.json();
      Object.assign(record, data.record);
      restoreDisplay();
      if (searchDataCache) {
        const cached = searchDataCache.find((r) => r.id === record.id);
        if (cached) Object.assign(cached, data.record);
      }
    } catch (err) {
      alert(t("history.editFailed", { message: err.message }));
    }
  });
}

function renderHistoryEntry(record) {
  const el = buildHistoryCard(record);
  annotationList.appendChild(el);
  return el;
}

// ---------- 删除已保存的生词 / 句子笔记(本地删除；已同步过的 Google Sheet 行不会自动删除) ----------

async function deleteRecord(record) {
  const label = record.mode === "word" ? t("annotation.word") : t("annotation.saveSentenceBtn");
  const confirmed = confirm(t("history.deleteConfirm", { label }));
  if (!confirmed) return false;

  const endpoint = record.mode === "word" ? `/api/vocab/${record.id}` : `/api/sentence_notes/${record.id}`;
  try {
    const res = await apiFetch(endpoint, { method: "DELETE" });
    if (!res.ok) throw new Error(await apiErrorText(res));
  } catch (err) {
    alert(t("history.deleteFailed", { message: err.message }));
    return false;
  }

  if (record.mode === "word") {
    await loadKnownWords();
    if (currentDocContent) {
      renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl, true);
    }
  }
  if (searchDataCache) {
    searchDataCache = searchDataCache.filter((r) => r.id !== record.id);
  }
  if (currentDocName) {
    renderHistoryForDoc(currentDocName);
  }
  return true;
}

// ---------- 手机端：历史记录侧栏改成全屏滑出，需要一个开关 ----------
// 桌面端 #sidebar 一直显示，没有这个概念；这两个按钮只在窄屏下可见(见 style.css)。

btnToggleSidebar.addEventListener("click", () => {
  sidebar.classList.add("mobile-open");
});

btnCloseSidebar.addEventListener("click", () => {
  sidebar.classList.remove("mobile-open");
});

// ---------- 全局搜索(跨所有文章的生词/句子笔记) ----------

function resetSearchSelectMode() {
  selectModeActive = false;
  selectedSearchIds.clear();
  btnSearchSelectToggle.textContent = t("search.selectMode");
  searchBulkBar.classList.add("hidden");
}

btnSearchHistory.addEventListener("click", async () => {
  searchPanelOverlay.classList.remove("hidden");
  searchInput.value = "";
  searchResults.innerHTML = `<p class="recommend-loading">${t("search.loading")}</p>`;
  searchInput.focus();
  searchDataCache = null;
  resetSearchSelectMode();
  await loadSearchData();
  renderSearchResults(searchDataCache);
});

btnSearchClose.addEventListener("click", () => {
  searchPanelOverlay.classList.add("hidden");
  resetSearchSelectMode();
});

searchPanelOverlay.addEventListener("click", (e) => {
  if (e.target === searchPanelOverlay) {
    searchPanelOverlay.classList.add("hidden");
    resetSearchSelectMode();
  }
});

// ---------- 文章管理(标题 + 导入时间 + 删除) ----------

function formatDocDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function renderDocManagerList() {
  docManagerList.innerHTML = "";
  if (!allDocs || allDocs.length === 0) {
    docManagerList.innerHTML = `<p class="recommend-loading">${t("docManager.empty")}</p>`;
    return;
  }
  // allDocs 是后台按 uploaded_at 升序返回的(最新的排最后，跟下拉框逻辑一致)，
  // 这里管理面板想让最新的排在最上面，所以反过来显示。
  [...allDocs].reverse().forEach((doc) => {
    const card = document.createElement("div");
    card.className = "docCard";
    card.innerHTML = `
      <div class="docCard-info">
        <div class="docCard-title"></div>
        <div class="docCard-meta"></div>
      </div>
      <div class="docCard-actions">
        <button type="button" class="docCard-open">${t("docManager.open")}</button>
        <button type="button" class="docCard-delete">${t("docManager.delete")}</button>
      </div>
    `;
    card.querySelector(".docCard-title").textContent = doc.filename || "";
    const langLabel = t(`languages.${doc.learning_language}`) || (doc.learning_language || "en").toUpperCase();
    card.querySelector(".docCard-meta").textContent = `${langLabel} · ${formatDocDate(doc.uploaded_at)}`;
    card.querySelector(".docCard-open").addEventListener("click", () => {
      docSelect.value = doc.id;
      loadDocument(doc);
      docManagerPanelOverlay.classList.add("hidden");
    });
    card.querySelector(".docCard-delete").addEventListener("click", async () => {
      const confirmed = confirm(t("docManager.deleteConfirm", { title: doc.filename || "" }));
      if (!confirmed) return;
      try {
        const res = await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await apiErrorText(res));
      } catch (err) {
        alert(t("docManager.deleteFailed", { message: err.message }));
        return;
      }
      const wasCurrent = doc.id === currentDocId;
      await refreshDocuments(wasCurrent ? undefined : currentDocId);
      renderDocManagerList();
    });
    docManagerList.appendChild(card);
  });
}

btnDocManager.addEventListener("click", () => {
  renderDocManagerList();
  docManagerPanelOverlay.classList.remove("hidden");
});

btnDocManagerClose.addEventListener("click", () => {
  docManagerPanelOverlay.classList.add("hidden");
});

docManagerPanelOverlay.addEventListener("click", (e) => {
  if (e.target === docManagerPanelOverlay) docManagerPanelOverlay.classList.add("hidden");
});

// ---------- 生词复习(简化版莱特纳盒子：等级 0-5，命中固定区间表算下次复习时间) ----------

async function openReviewPanel() {
  const res = await apiFetch("/api/review/due-counts");
  reviewDueCounts = res.ok ? await res.json() : {};
  reviewLanguageSelect.innerHTML = "";
  LEARNING_LANGUAGE_CODES.forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = t(`languages.${code}`);
    reviewLanguageSelect.appendChild(opt);
  });
  const lastLang = getLastLearningLanguage();
  const dueLangs = Object.keys(reviewDueCounts);
  reviewLanguageSelect.value = dueLangs.includes(lastLang) ? lastLang : dueLangs[0] || lastLang;
  updateReviewDueCountText();
  reviewPanelOverlay.classList.remove("hidden");
}

function updateReviewDueCountText() {
  const count = reviewDueCounts[reviewLanguageSelect.value] || 0;
  reviewDueCount.textContent = count > 0 ? t("review.dueCount", { count }) : t("review.empty");
  btnStartReview.disabled = count === 0;
}

navReview.addEventListener("click", openReviewPanel);
reviewLanguageSelect.addEventListener("change", updateReviewDueCountText);

btnReviewClose.addEventListener("click", () => {
  reviewPanelOverlay.classList.add("hidden");
});

reviewPanelOverlay.addEventListener("click", (e) => {
  if (e.target === reviewPanelOverlay) reviewPanelOverlay.classList.add("hidden");
});

btnStartReview.addEventListener("click", async () => {
  const lang = encodeURIComponent(reviewLanguageSelect.value);
  const res = await apiFetch(`/api/review/queue?learning_language=${lang}&limit=20`);
  if (!res.ok) return;
  reviewQueue = await res.json();
  if (reviewQueue.length === 0) return;
  reviewIndex = 0;
  reviewPanelOverlay.classList.add("hidden");
  reviewSessionOverlay.classList.remove("hidden");
  renderReviewCard();
});

function renderReviewCard() {
  const record = reviewQueue[reviewIndex];
  reviewProgress.textContent = t("review.progress", { current: reviewIndex + 1, total: reviewQueue.length });
  reviewCardWord.textContent = record.word || "";
  btnReviewPronounce.classList.toggle("hidden", !canSpeak());
  reviewCardBack.classList.add("hidden");
  reviewCardMeta.textContent = [record.pos, record.ipa].filter(Boolean).join(" · ");
  reviewCardMeaning.textContent = record.chinese_meaning || "";
  reviewCardSentence.textContent = record.sentence || "";
  if (record.other_forms) {
    reviewCardForms.textContent = `${t("annotation.otherForms")}${record.other_forms}`;
    reviewCardForms.classList.remove("hidden");
  } else {
    reviewCardForms.classList.add("hidden");
  }
  btnReviewReveal.classList.remove("hidden");
  btnReviewDontKnow.classList.add("hidden");
  btnReviewKnow.classList.add("hidden");
}

btnReviewPronounce.addEventListener("click", () => {
  const record = reviewQueue[reviewIndex];
  if (record) speakText(record.word, record.learning_language);
});

btnReviewReveal.addEventListener("click", () => {
  reviewCardBack.classList.remove("hidden");
  btnReviewReveal.classList.add("hidden");
  btnReviewDontKnow.classList.remove("hidden");
  btnReviewKnow.classList.remove("hidden");
});

async function markReviewCard(result) {
  const record = reviewQueue[reviewIndex];
  if (!record) return;
  await apiFetch("/api/review/mark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: record.id, result }),
  });
  reviewIndex++;
  if (reviewIndex < reviewQueue.length) {
    renderReviewCard();
  } else {
    endReviewSession(true);
  }
}

btnReviewKnow.addEventListener("click", () => markReviewCard("know"));
btnReviewDontKnow.addEventListener("click", () => markReviewCard("dont_know"));

function endReviewSession(completed) {
  if (canSpeak()) window.speechSynthesis.cancel();
  reviewSessionOverlay.classList.add("hidden");
  reviewQueue = [];
  reviewIndex = 0;
  if (completed) alert(t("review.sessionComplete"));
}

btnReviewExit.addEventListener("click", () => endReviewSession(false));

async function loadSearchData() {
  const { vocab, notes } = await getVocabAndNotes();
  searchDataCache = [
    ...vocab.map((v) => ({ ...v, mode: "word" })),
    ...notes.map((n) => ({ ...n, mode: "passage" })),
  ].sort((a, b) => (a.added_at < b.added_at ? 1 : -1));
}

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!searchDataCache) return;
  if (!q) {
    renderSearchResults(searchDataCache);
    return;
  }
  const matches = searchDataCache.filter((r) => {
    const isWord = r.mode === "word";
    const fields = isWord
      ? [r.word, r.chinese_meaning, r.sentence, r.source_doc]
      : [r.sentence, r.analysis, r.source_doc];
    return fields.some((f) => (f || "").toLowerCase().includes(q));
  });
  renderSearchResults(matches);
});

function renderSearchResults(matches) {
  currentSearchMatches = matches || [];
  if (currentSearchMatches.length === 0) {
    const hasQuery = searchInput.value.trim().length > 0;
    const hasAnyData = searchDataCache && searchDataCache.length > 0;
    searchResults.innerHTML = hasQuery || hasAnyData
      ? `<p class="recommend-loading">${t("search.noMatch")}</p>`
      : `<p class="recommend-loading">${t("search.empty")}</p>`;
    return;
  }
  searchResults.innerHTML = "";
  currentSearchMatches.slice(0, 50).forEach((record) => {
    const card = buildHistoryCard(record);
    card.classList.add("searchResultCard");

    if (selectModeActive) {
      const row = document.createElement("div");
      row.className = "searchResultCard-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "searchCard-checkbox";
      checkbox.checked = selectedSearchIds.has(record.id);
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedSearchIds.add(record.id);
        else selectedSearchIds.delete(record.id);
        updateSearchBulkBarState();
      });
      card.title = "";
      card.addEventListener("click", () => {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change"));
      });
      row.append(checkbox, card);
      searchResults.appendChild(row);
    } else {
      card.title = t("docManager.jumpHint");
      card.addEventListener("click", () => jumpToArticle(record.source_doc));
      searchResults.appendChild(card);
    }
  });
  if (selectModeActive) updateSearchBulkBarState();
}

function updateSearchBulkBarState() {
  searchSelectedCount.textContent = t("search.selectedCount", { count: selectedSearchIds.size });
  btnSearchDeleteSelected.disabled = selectedSearchIds.size === 0;
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/["\n,]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildVocabCsv(records) {
  const header = ["Type", "Word/Sentence", "Meaning/Analysis", "Context", "Part of Speech", "IPA", "Other Forms", "Source", "Date"];
  const rows = records.map((r) => {
    const isWord = r.mode === "word";
    return [
      isWord ? "Word" : "Sentence",
      isWord ? r.word : r.sentence,
      isWord ? r.chinese_meaning : r.analysis,
      isWord ? r.sentence : "",
      isWord ? r.pos : "",
      isWord ? r.ipa : "",
      isWord ? r.other_forms : "",
      r.source_doc,
      r.date,
    ];
  });
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

btnSearchExport.addEventListener("click", () => {
  if (currentSearchMatches.length === 0) {
    alert(t("search.nothingToExport"));
    return;
  }
  const csv = buildVocabCsv(currentSearchMatches);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `contextia-vocab-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

btnSearchSelectToggle.addEventListener("click", () => {
  selectModeActive = !selectModeActive;
  selectedSearchIds.clear();
  btnSearchSelectToggle.textContent = selectModeActive ? t("search.doneSelecting") : t("search.selectMode");
  btnSearchSelectAll.textContent = t("search.selectAll");
  searchBulkBar.classList.toggle("hidden", !selectModeActive);
  renderSearchResults(currentSearchMatches);
});

btnSearchSelectAll.addEventListener("click", () => {
  const checkboxes = [...searchResults.querySelectorAll(".searchCard-checkbox")];
  const allChecked = checkboxes.length > 0 && checkboxes.every((cb) => cb.checked);
  const nextChecked = !allChecked;
  checkboxes.forEach((cb) => {
    cb.checked = nextChecked;
    cb.dispatchEvent(new Event("change"));
  });
  btnSearchSelectAll.textContent = nextChecked ? t("search.deselectAll") : t("search.selectAll");
});

async function deleteRecordsBulk(records) {
  const results = await Promise.allSettled(
    records.map((r) =>
      apiFetch(r.mode === "word" ? `/api/vocab/${r.id}` : `/api/sentence_notes/${r.id}`, { method: "DELETE" })
    )
  );
  const succeededIds = new Set();
  let failCount = 0;
  results.forEach((res, i) => {
    if (res.status === "fulfilled" && res.value.ok) succeededIds.add(records[i].id);
    else failCount++;
  });
  return { succeededIds, failCount };
}

btnSearchDeleteSelected.addEventListener("click", async () => {
  const count = selectedSearchIds.size;
  if (count === 0) return;
  const confirmed = confirm(t("search.deleteSelectedConfirm", { count }));
  if (!confirmed) return;

  const records = currentSearchMatches.filter((r) => selectedSearchIds.has(r.id));
  btnSearchDeleteSelected.disabled = true;
  const { succeededIds, failCount } = await deleteRecordsBulk(records);

  const deletedAnyWord = records.some((r) => succeededIds.has(r.id) && r.mode === "word");
  if (deletedAnyWord) {
    await loadKnownWords();
    if (currentDocContent) {
      renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl, true);
    }
  }
  if (searchDataCache) {
    searchDataCache = searchDataCache.filter((r) => !succeededIds.has(r.id));
  }
  if (currentDocName) {
    renderHistoryForDoc(currentDocName);
  }
  currentSearchMatches = currentSearchMatches.filter((r) => !succeededIds.has(r.id));
  succeededIds.forEach((id) => selectedSearchIds.delete(id));
  btnSearchSelectAll.textContent = t("search.selectAll");
  renderSearchResults(currentSearchMatches);

  if (failCount > 0) {
    alert(t("search.deleteSelectedFailed", { count: failCount }));
  }
});

function jumpToArticle(docName) {
  const doc = allDocs.find((d) => d.filename === docName);
  if (!doc) {
    alert(t("history.jumpMissing"));
    return;
  }
  docSelect.value = doc.id;
  loadDocument(doc);
  searchPanelOverlay.classList.add("hidden");
}

async function saveAnnotation(el, text) {
  const saveBtn = el.querySelector(".ann-save");
  const statusEl = el.querySelector(".ann-sync-status");
  saveBtn.disabled = true;
  saveBtn.textContent = t("annotation.saving");
  // 收藏时存原形而不是划中的那个变形(比如划 reached 存 reach)——由小红书用户
  // 燃點IGNITE提议。lemma 为空(比如这门语言没有原形概念)就照旧存划中的原词。
  const wordToSave = el.dataset.mode === "word" && el.dataset.lemma ? el.dataset.lemma : text;
  try {
    const res = await apiFetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: el.dataset.mode,
        text: wordToSave,
        context: el.dataset.context || "",
        explanation: el.dataset.explanation || "",
        chinese_meaning: el.dataset.chineseMeaning || "",
        ipa: el.dataset.ipa || "",
        pos: el.dataset.pos || "",
        other_forms: el.dataset.otherForms || "",
        source_doc: currentDocName,
        learning_language: currentDocLearningLanguage,
      }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    const data = await res.json();

    if (data.duplicate) {
      saveBtn.textContent = t("annotation.duplicate");
      // 用 innerHTML 只放图标(固定、可信的 SVG)，正文用 append() 当纯文本插入——
      // text 是用户从文章里划的原文，可能包含尖括号之类的字符，绝不能直接拼进 innerHTML。
      statusEl.innerHTML = iconHTML("alert-triangle");
      statusEl.append(t("annotation.duplicateStatus", { text: wordToSave }));
      return;
    }

    saveBtn.textContent = t("annotation.saved");
    statusEl.innerHTML = iconHTML(data.sheet_synced ? "check-circle" : "alert-triangle");
    statusEl.append(data.sheet_synced ? t("annotation.syncOk") : t("annotation.syncFail"));

    if (el.dataset.mode === "word") {
      await loadKnownWords();
      renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl, true);
    }
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = t("annotation.saveFailed");
  }
}

// ---------- 一键保存(把当前还没存的解析结果一次性全部存进去) ----------

btnSaveAll.addEventListener("click", async () => {
  const pending = [...annotationList.querySelectorAll(".annotation")].filter((el) => {
    const actions = el.querySelector(".ann-actions");
    const saveBtn = el.querySelector(".ann-save");
    return actions && !actions.classList.contains("hidden") && saveBtn && !saveBtn.disabled;
  });
  if (pending.length === 0) {
    alert(t("saveAll.empty"));
    return;
  }
  btnSaveAll.disabled = true;
  btnSaveAll.textContent = t("saveAll.saving");
  for (const el of pending) {
    const text = el.querySelector(".ann-text").textContent;
    await saveAnnotation(el, text);
  }
  btnSaveAll.disabled = false;
  btnSaveAll.textContent = t("saveAll.done");
});

// ---------- 打印(文章正文 + 划过的生词表 + 不熟悉的句子) ----------

btnPrint.addEventListener("click", async () => {
  if (!currentDocName) return;
  btnPrint.disabled = true;
  const originalLabel = btnPrint.textContent;
  btnPrint.textContent = t("print.preparing");
  try {
    const { vocab: allVocab, notes: allNotes } = await getVocabAndNotes();
    const vocab = allVocab.filter((v) => v.source_doc === currentDocName);
    const notes = allNotes.filter((n) => n.source_doc === currentDocName);
    buildPrintArea(vocab, notes);
    window.print();
  } catch (err) {
    alert(t("print.failed", { message: err.message }));
  } finally {
    btnPrint.disabled = false;
    btnPrint.textContent = originalLabel;
  }
});

function buildPrintArea(vocab, notes) {
  const vocabMap = new Map(); // 小写单词 -> {..., index}(打印用的编号，对应下面表格的行)
  vocab.forEach((v) => {
    const key = (v.word || "").trim().toLowerCase();
    if (key && !vocabMap.has(key)) vocabMap.set(key, { ...v, index: vocabMap.size + 1 });
  });
  // 句子按长度从长到短匹配，避免短句子先匹配到长句子里面的一部分
  const sentenceList = notes
    .map((n, i) => ({ ...n, index: i + 1 }))
    .sort((a, b) => (b.sentence || "").length - (a.sentence || "").length);

  const paragraphs = currentDocContent
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const container = document.createElement("div");

  const titleEl = document.createElement("h1");
  titleEl.className = "printTitle";
  titleEl.textContent = currentDocName;
  container.appendChild(titleEl);

  if (currentDocSourceUrl) {
    const meta = document.createElement("p");
    meta.className = "printMeta";
    meta.textContent = currentDocSourceUrl;
    container.appendChild(meta);
  }

  const articleBody = document.createElement("div");
  articleBody.className = "printArticleBody";
  paragraphs.forEach((p) => {
    const para = document.createElement("p");
    para.innerHTML = markParagraphForPrint(p, vocabMap, sentenceList);
    articleBody.appendChild(para);
  });
  container.appendChild(articleBody);

  if (vocabMap.size > 0) {
    const h2 = document.createElement("h2");
    h2.className = "printSectionTitle";
    h2.textContent = t("print.vocabTitle", { count: vocabMap.size });
    container.appendChild(h2);

    const table = document.createElement("table");
    table.className = "printVocabTable";
    table.innerHTML = `<thead><tr><th>${t("print.colIndex")}</th><th>${t("print.colWord")}</th><th>${t("print.colIpa")}</th><th>${t("print.colPos")}</th><th>${t("print.colMeaning")}</th></tr></thead><tbody></tbody>`;
    const tbody = table.querySelector("tbody");
    [...vocabMap.values()]
      .sort((a, b) => a.index - b.index)
      .forEach((v) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${v.index}</td>
          <td>${escapeHtml(v.word || "")}</td>
          <td>${escapeHtml(v.ipa || "")}</td>
          <td>${escapeHtml(v.pos || "")}</td>
          <td>${escapeHtml(v.chinese_meaning || "")}</td>
        `;
        tbody.appendChild(tr);
      });
    container.appendChild(table);
  }

  if (sentenceList.length > 0) {
    const h2 = document.createElement("h2");
    h2.className = "printSectionTitle";
    h2.textContent = t("print.sentenceTitle", { count: sentenceList.length });
    container.appendChild(h2);

    const list = document.createElement("ol");
    list.className = "printSentenceList";
    [...sentenceList]
      .sort((a, b) => a.index - b.index)
      .forEach((n) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <div class="printSentenceOriginal">${escapeHtml(n.sentence || "")}</div>
          <div class="printSentenceAnalysis">${escapeHtml(n.analysis || "")}</div>
        `;
        list.appendChild(li);
      });
    container.appendChild(list);
  }

  printArea.innerHTML = "";
  printArea.appendChild(container);
}

// 在文章段落里标出生词(数字下标)和句子笔记(“句N”下标)，句子优先匹配，
// 落在句子范围内的单词就不再单独标了，避免嵌套标记搅在一起。
function markParagraphForPrint(text, vocabMap, sentenceList) {
  const ranges = [];

  sentenceList.forEach((s) => {
    if (!s.sentence) return;
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(s.sentence, searchFrom);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + s.sentence.length, type: "sentence", label: s.index });
      searchFrom = idx + s.sentence.length;
    }
  });

  const wordRegex = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    const key = match[0].toLowerCase();
    if (!vocabMap.has(key)) continue;
    const start = match.index;
    const end = start + match[0].length;
    const insideSentence = ranges.some((r) => r.type === "sentence" && start >= r.start && end <= r.end);
    if (insideSentence) continue;
    ranges.push({ start, end, type: "word", label: vocabMap.get(key).index });
  }

  ranges.sort((a, b) => a.start - b.start);

  let result = "";
  let cursor = 0;
  ranges.forEach((r) => {
    if (r.start < cursor) return;
    result += escapeHtml(text.slice(cursor, r.start));
    const segment = escapeHtml(text.slice(r.start, r.end));
    if (r.type === "sentence") {
      result += `<span class="printMarkSentence">${segment}<sup class="printMarkLabel printMarkLabelSentence">${t("print.sentenceMarkPrefix")}${r.label}</sup></span>`;
    } else {
      result += `${segment}<sup class="printMarkLabel printMarkLabelWord">${r.label}</sup>`;
    }
    cursor = r.end;
  });
  result += escapeHtml(text.slice(cursor));
  return result;
}

// ---------- 设置面板(AI 服务商 + key、Google Sheets 同步开关) ----------

btnAccountSettings.addEventListener("click", async () => {
  accountSettingsPanelOverlay.classList.remove("hidden");
  await loadSettingsIntoPanel();
});

accountSettingsPanelOverlay.addEventListener("click", (e) => {
  if (e.target === accountSettingsPanelOverlay) accountSettingsPanelOverlay.classList.add("hidden");
});

let settingsDataCache = null;

async function loadSettingsIntoPanel() {
  settingsSaveStatus.textContent = "";
  const res = await apiFetch("/api/settings");
  if (!res.ok) return;
  const data = await res.json();
  settingsDataCache = data;

  settingsUserLine.textContent = t("settings.userLine", { name: data.name, ownerTag: data.is_owner ? t("settings.ownerTag") : "" });

  uiLanguageSelect.value = data.ui_language || "zh";
  populateLearningLanguageOptionsFor("settingsLearningLanguageSelect");
  settingsLearningLanguageSelect.value = getLastLearningLanguage();
  populateImmersionTargetLanguageOptions();
  immersionTargetLanguageSelect.value = data.immersion_target_language || "follow";
  document.querySelectorAll('.settingsOptions[data-setting="immersionSourcePriority"] button').forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === (data.immersion_source_priority || "vocab"));
  });
  immersionExcludeProperNounsToggle.checked = data.immersion_exclude_proper_nouns !== false;
  explainLanguageSelect.value = data.explain_language || "auto";
  aiRelayUrlInput.value = data.ai_relay_base_url || "";
  aiRelayModelInput.value = data.ai_relay_model || "";
  aiRelayBlock.classList.toggle("hidden", uiLanguageSelect.value !== "zh");

  aiProviderSelect.innerHTML = "";
  data.providers.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    aiProviderSelect.appendChild(opt);
  });
  aiProviderSelect.value = data.ai_provider;

  aiApiKeyInput.value = "";
  updateKeyHint();

  if (data.house_trial_enabled) {
    const left = Math.max(0, data.house_calls_total - data.house_calls_used);
    houseTrialHint.textContent =
      left > 0
        ? t("settings.houseTrialLeft", { left, total: data.house_calls_total })
        : t("settings.houseTrialUsedUp", { total: data.house_calls_total });
    houseTrialHint.classList.remove("hidden");
  } else {
    houseTrialHint.classList.add("hidden");
  }

  sheetsSyncBlock.classList.toggle("hidden", !data.is_owner);
  sheetsSyncToggle.checked = !!data.sheets_sync_enabled;

  changePasswordLabel.textContent = data.has_password ? t("settings.changePassword") : t("settings.changePasswordUnset");
  newPasswordInput.value = "";
  changePasswordStatus.textContent = "";

  newUsernameInput.value = "";
  changeUsernameStatus.textContent = "";

  newEmailInput.value = data.email || "";
  changeEmailStatus.textContent = "";

  googleLinkStatus.textContent = data.has_google
    ? t("settings.googleLinkedStatus", { email: data.google_email })
    : t("settings.googleUnlinkedStatus");
  btnLinkGoogle.textContent = data.has_google ? t("settings.googleLinkBtnRelink") : t("settings.googleLinkBtn");

  appleLinkStatus.textContent = data.has_apple
    ? t("settings.appleLinkedStatus", { email: data.apple_email })
    : t("settings.appleUnlinkedStatus");
  btnLinkApple.textContent = data.has_apple ? t("settings.appleLinkBtnRelink") : t("settings.appleLinkBtn");
}

btnLinkGoogle.addEventListener("click", async () => {
  btnLinkGoogle.disabled = true;
  googleLinkStatus.textContent = t("settings.googleRedirecting");
  try {
    const res = await apiFetch("/api/auth/google/link-init", { method: "POST" });
    if (!res.ok) throw new Error(await apiErrorText(res));
    const data = await res.json();
    startOAuthFlow("/api/auth/google/login?link_nonce=" + encodeURIComponent(data.nonce));
  } catch (err) {
    googleLinkStatus.textContent = t("settings.googleLinkFailed", { message: err.message });
    btnLinkGoogle.disabled = false;
  }
});

btnChangeUsername.addEventListener("click", async () => {
  const newUsername = newUsernameInput.value.trim();
  if (!newUsername) return;
  btnChangeUsername.disabled = true;
  changeUsernameStatus.textContent = t("common.saving");
  try {
    const res = await apiFetch("/api/change-username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_username: newUsername }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    const data = await res.json();
    newUsernameInput.value = "";
    changeUsernameStatus.textContent = t("common.saved");
    if (currentUser) currentUser.name = data.name;
    settingsUserLine.textContent = t("settings.userLine", {
      name: data.name,
      ownerTag: settingsDataCache && settingsDataCache.is_owner ? t("settings.ownerTag") : "",
    });
  } catch (err) {
    changeUsernameStatus.textContent = t("common.saveFailed", { message: err.message });
  } finally {
    btnChangeUsername.disabled = false;
  }
});

btnChangeEmail.addEventListener("click", async () => {
  const newEmail = newEmailInput.value.trim();
  if (!newEmail) return;
  btnChangeEmail.disabled = true;
  changeEmailStatus.textContent = t("common.saving");
  try {
    const res = await apiFetch("/api/change-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_email: newEmail }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    changeEmailStatus.textContent = t("common.saved");
    if (settingsDataCache) settingsDataCache.email = newEmail;
  } catch (err) {
    changeEmailStatus.textContent = t("common.saveFailed", { message: err.message });
  } finally {
    btnChangeEmail.disabled = false;
  }
});

btnChangePassword.addEventListener("click", async () => {
  const newPassword = newPasswordInput.value;
  if (!newPassword) return;
  btnChangePassword.disabled = true;
  changePasswordStatus.textContent = t("common.saving");
  try {
    const res = await apiFetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: newPassword }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    newPasswordInput.value = "";
    changePasswordStatus.textContent = t("common.saved");
    changePasswordLabel.textContent = t("settings.changePassword");
  } catch (err) {
    changePasswordStatus.textContent = t("common.saveFailed", { message: err.message });
  } finally {
    btnChangePassword.disabled = false;
  }
});

btnExportData.addEventListener("click", async () => {
  btnExportData.disabled = true;
  accountDataStatus.textContent = t("account.exporting");
  try {
    const res = await apiFetch("/api/account/export");
    if (!res.ok) throw new Error(await apiErrorText(res));
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(settingsDataCache && settingsDataCache.name) || "my"}-data-export.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    accountDataStatus.textContent = t("account.exported");
  } catch (err) {
    accountDataStatus.textContent = t("account.exportFailed", { message: err.message });
  } finally {
    btnExportData.disabled = false;
  }
});

btnDeleteAccount.addEventListener("click", async () => {
  const step1 = confirm(t("account.deleteConfirm1"));
  if (!step1) return;
  const confirmWord = t("account.deleteConfirmWord");
  const step2 = prompt(t("account.deleteConfirmPrompt"));
  if ((step2 || "").trim().toLowerCase() !== confirmWord.toLowerCase()) return;

  btnDeleteAccount.disabled = true;
  accountDataStatus.textContent = t("account.deleting");
  try {
    const res = await apiFetch("/api/account", { method: "DELETE" });
    if (!res.ok) throw new Error(await apiErrorText(res));
    localStorage.removeItem("authToken");
    alert(t("account.deleted"));
    location.reload();
  } catch (err) {
    accountDataStatus.textContent = t("account.deleteFailed", { message: err.message });
    btnDeleteAccount.disabled = false;
  }
});

function updateKeyHint() {
  if (!settingsDataCache) return;
  aiApiKeyInput.value = "";
  const status = settingsDataCache.ai_key_status[aiProviderSelect.value] || {};
  aiKeyHint.textContent = status.has_key
    ? t("settings.apiKeyHintSet", { masked: status.masked })
    : t("settings.apiKeyHintUnset");
}

aiProviderSelect.addEventListener("change", updateKeyHint);

uiLanguageSelect.addEventListener("change", () => {
  aiRelayBlock.classList.toggle("hidden", uiLanguageSelect.value !== "zh");
});

btnSettingsSave.addEventListener("click", async () => {
  btnSettingsSave.disabled = true;
  settingsSaveStatus.textContent = t("common.saving");
  const newUiLanguage = uiLanguageSelect.value;
  try {
    const res = await apiFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ai_provider: aiProviderSelect.value,
        ai_api_key: aiApiKeyInput.value.trim(),
        sheets_sync_enabled: sheetsSyncToggle.checked,
        ui_language: newUiLanguage,
        explain_language: explainLanguageSelect.value,
        ai_relay_base_url: aiRelayUrlInput.value.trim(),
        ai_relay_model: aiRelayModelInput.value.trim(),
        immersion_target_language: immersionTargetLanguageSelect.value,
        immersion_source_priority:
          document.querySelector('.settingsOptions[data-setting="immersionSourcePriority"] button.active')?.dataset.value || "vocab",
        immersion_exclude_proper_nouns: immersionExcludeProperNounsToggle.checked,
      }),
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    if (newUiLanguage !== currentUiLanguage) {
      // 界面语言变了：已经渲染到页面上的动态内容(历史记录空状态、文档列表标签等)
      // 不会跟着 applyI18n() 自动重译，最简单可靠的办法是刷新页面，让整个初始化流程
      // 用新语言重新走一遍，而不是挨个去补一堆"语言切换时重渲染"的特殊逻辑。
      localStorage.setItem("uiLanguage", newUiLanguage);
      maybeShowRelayHint(newUiLanguage);
      location.reload();
      return;
    }
    await loadSettingsIntoPanel();
    settingsSaveStatus.textContent = t("common.saved");
  } catch (err) {
    settingsSaveStatus.textContent = t("common.saveFailed", { message: err.message });
  } finally {
    btnSettingsSave.disabled = false;
  }
});

btnLogout.addEventListener("click", async () => {
  try {
    await apiFetch("/api/logout", { method: "POST" });
  } catch (err) {
    // 服务端撤销失败也没关系，本地照样清掉登录状态
  }
  localStorage.removeItem("authToken");
  location.reload();
});

// ---------- 首次访问的导航栏新手引导 ----------

const NAV_TOUR_SEEN_KEY = "navTourSeen";
const NAV_TOUR_STEPS = [
  { target: "btnRecommend", textKey: "navTour.recommend" },
  { target: "btnNativeNews", textKey: "navTour.nativeNews" },
  { target: "navReview", textKey: "navTour.review" },
  { target: "btnStats", textKey: "navTour.stats" },
  { target: "btnAccountSettings", textKey: "navTour.settings" },
];
let navTourIndex = 0;
const navTourTooltip = document.getElementById("navTourTooltip");
const navTourText = document.getElementById("navTourText");
const navTourStepLabel = document.getElementById("navTourStep");
const navTourNext = document.getElementById("navTourNext");
const navTourSkip = document.getElementById("navTourSkip");

function clearNavTourHighlight() {
  document.querySelectorAll(".navTour-highlight").forEach((el) => el.classList.remove("navTour-highlight"));
}

function positionNavTour(targetEl) {
  const rect = targetEl.getBoundingClientRect();
  const isMobile = window.innerWidth <= 860;
  navTourTooltip.style.top = "";
  navTourTooltip.style.bottom = "";
  navTourTooltip.style.left = "";
  if (isMobile) {
    navTourTooltip.style.bottom = `${window.innerHeight - rect.top + 12}px`;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - 130, window.innerWidth - 260 - 12));
    navTourTooltip.style.left = `${left}px`;
  } else {
    const top = Math.max(12, Math.min(rect.top + rect.height / 2 - 40, window.innerHeight - 140));
    navTourTooltip.style.top = `${top}px`;
    navTourTooltip.style.left = `${rect.right + 12}px`;
  }
}

function showNavTourStep(i) {
  clearNavTourHighlight();
  const step = NAV_TOUR_STEPS[i];
  const targetEl = document.getElementById(step.target);
  if (!targetEl || targetEl.classList.contains("hidden")) {
    if (i + 1 < NAV_TOUR_STEPS.length) showNavTourStep(i + 1);
    else finishNavTour();
    return;
  }
  targetEl.classList.add("navTour-highlight");
  navTourText.textContent = t(step.textKey);
  navTourStepLabel.textContent = `${i + 1} / ${NAV_TOUR_STEPS.length}`;
  navTourNext.textContent = i === NAV_TOUR_STEPS.length - 1 ? t("navTour.done") : t("navTour.next");
  positionNavTour(targetEl);
  navTourTooltip.classList.remove("hidden");
}

function finishNavTour() {
  clearNavTourHighlight();
  navTourTooltip.classList.add("hidden");
  localStorage.setItem(NAV_TOUR_SEEN_KEY, "1");
}

function startNavTour() {
  if (localStorage.getItem(NAV_TOUR_SEEN_KEY)) return;
  navTourIndex = 0;
  showNavTourStep(navTourIndex);
}

navTourNext.addEventListener("click", () => {
  navTourIndex++;
  if (navTourIndex >= NAV_TOUR_STEPS.length) finishNavTour();
  else showNavTourStep(navTourIndex);
});
navTourSkip.addEventListener("click", finishNavTour);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !navTourTooltip.classList.contains("hidden")) finishNavTour();
});
window.addEventListener("resize", () => {
  if (navTourTooltip.classList.contains("hidden")) return;
  const targetEl = document.getElementById(NAV_TOUR_STEPS[navTourIndex].target);
  if (targetEl) positionNavTour(targetEl);
});

// ---------- 登录 / 注册(用户名密码 或 Google) ----------

async function checkToken(token) {
  try {
    const res = await fetch(API_BASE + "/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function initApp() {
  await loadKnownWords();
  refreshDocuments();
  loadUsage();
  loadStats();
  scheduleReviewReminders();
  initIAP().then(loadEntitlement);
}

async function enterApp(token, me) {
  authToken = token;
  localStorage.setItem("authToken", token);
  currentUser = me;
  btnAdminStats.classList.toggle("hidden", !me.is_owner);
  if (me.ui_language && me.ui_language !== currentUiLanguage) await loadI18n(me.ui_language);
  loginOverlay.classList.add("hidden");
  initApp();
}

// 处理 Google/Apple OAuth 跳回来带的 "token=...&google_linked=1" 这种 hash 片段。
// 网页版是页面加载时从 location.hash 里读；原生壳里是从 appUrlOpen 的自定义 URL scheme
// 里读，两边内容格式一样，共用这一个函数。返回 true 表示确实处理了一个登录/关联。
async function finishOAuthCallback(hash) {
  const hashMatch = hash.match(/token=([^&]+)/);
  if (!hashMatch) return false;
  const token = decodeURIComponent(hashMatch[1]);
  const me = await checkToken(token);
  if (!me) return false;
  await enterApp(token, me);
  if (/(^|&)google_linked=1/.test(hash)) {
    alert(t("settings.googleLinkSuccess"));
    btnAccountSettings.click();
  } else if (/(^|&)apple_linked=1/.test(hash)) {
    alert(t("settings.appleLinkSuccess"));
    btnAccountSettings.click();
  } else {
    startNavTour();
  }
  return true;
}

// 只有原生壳(Capacitor)里才会触发：系统浏览器里的 Google/Apple 登录成功后，后端跳转
// 到 com.contextia.app://oauth-callback#token=...，操作系统把这个 deep link 转给 App，
// appUrlOpen 事件里的 url 就是完整的这个自定义 scheme 地址。
if (isNativeApp() && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener("appUrlOpen", async (data) => {
    const hashIndex = (data.url || "").indexOf("#");
    if (hashIndex === -1) return;
    if (window.Capacitor.Plugins.Browser) window.Capacitor.Plugins.Browser.close().catch(() => {});
    await finishOAuthCallback(data.url.slice(hashIndex + 1));
  });
}

function showWelcomeModal(data) {
  welcomeBody.textContent = t("welcome.body");
  if (data.house_trial_enabled) {
    welcomeHouseTrialLine.textContent = t("welcome.houseTrialLine", { count: data.house_calls_total });
    welcomeHouseTrialLine.classList.remove("hidden");
  } else {
    welcomeHouseTrialLine.classList.add("hidden");
  }
  welcomeModalOverlay.classList.remove("hidden");
}

btnWelcomeClose.addEventListener("click", () => {
  welcomeModalOverlay.classList.add("hidden");
  startNavTour();
});

btnLoginSubmit.addEventListener("click", async () => {
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  if (!username || !password) return;
  btnLoginSubmit.disabled = true;
  btnRegisterSubmit.disabled = true;
  loginError.classList.add("hidden");
  try {
    const res = await fetch(API_BASE + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, turnstile_token: turnstileToken }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error((await apiErrorText(res)) || t("login.credentialsWrong"));
    }
    const data = await res.json();
    await enterApp(data.token, data);
    startNavTour();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove("hidden");
    resetTurnstile();
  } finally {
    btnLoginSubmit.disabled = false;
    btnRegisterSubmit.disabled = false;
  }
});

btnRegisterSubmit.addEventListener("click", async () => {
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  const email = regEmailInput.value.trim();
  if (!username || !password) {
    loginError.textContent = t("login.fieldsRequired");
    loginError.classList.remove("hidden");
    return;
  }
  btnLoginSubmit.disabled = true;
  btnRegisterSubmit.disabled = true;
  loginError.classList.add("hidden");
  try {
    const res = await fetch(API_BASE + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, email, turnstile_token: turnstileToken, ui_language: currentUiLanguage }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(await apiErrorText(res));
    }
    const data = await res.json();
    await enterApp(data.token, data);
    showWelcomeModal(data);
  } catch (err) {
    loginError.textContent = t("login.registerFailed", { message: err.message });
    loginError.classList.remove("hidden");
    resetTurnstile();
  } finally {
    btnLoginSubmit.disabled = false;
    btnRegisterSubmit.disabled = false;
  }
});

loginPasswordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnLoginSubmit.click();
});

btnGoogleLogin.addEventListener("click", () => {
  startOAuthFlow("/api/auth/google/login");
});

btnAppleLogin.addEventListener("click", () => {
  startOAuthFlow("/api/auth/apple/login");
});

btnLinkApple.addEventListener("click", async () => {
  btnLinkApple.disabled = true;
  appleLinkStatus.textContent = t("settings.appleRedirecting");
  try {
    const res = await apiFetch("/api/auth/apple/link-init", { method: "POST" });
    if (!res.ok) throw new Error(await apiErrorText(res));
    const data = await res.json();
    startOAuthFlow("/api/auth/apple/login?link_nonce=" + encodeURIComponent(data.nonce));
  } catch (err) {
    appleLinkStatus.textContent = t("settings.appleLinkFailed", { message: err.message });
    btnLinkApple.disabled = false;
  }
});

(async () => {
  await loadI18n(currentUiLanguage);

  // 密码找回邮件里的链接带着 ?reset_token=...，不管当前设备有没有登录态，
  // 都优先弹这个设新密码的表单，不能直接把人送进正在登录的账号里。
  const resetToken = new URLSearchParams(location.search).get("reset_token");
  if (resetToken) {
    pendingResetToken = resetToken;
    history.replaceState(null, "", location.pathname);
    loginOverlay.classList.remove("hidden");
    showLoginView("reset");
    resetPasswordInput.focus();
    return;
  }

  // Google/Apple 登录或关联跳回来的时候，token 会带在地址栏的 #token=... 里(网页版专属；
  // 原生壳里走的是 appUrlOpen 那条路径，见上面 finishOAuthCallback 旁边的监听器)
  if (location.hash) {
    const hash = location.hash;
    history.replaceState(null, "", location.pathname + location.search);
    if (await finishOAuthCallback(hash)) return;
  }

  if (authToken) {
    const me = await checkToken(authToken);
    if (me) {
      currentUser = me;
      btnAdminStats.classList.toggle("hidden", !me.is_owner);
      if (me.ui_language && me.ui_language !== currentUiLanguage) await loadI18n(me.ui_language);
      initApp();
      startNavTour();
      return;
    }
    localStorage.removeItem("authToken");
    authToken = "";
  }

  function showLoginScreen() {
    showLoginView("form");
    loginOverlay.classList.remove("hidden");
    loginUsernameInput.focus();
    initTurnstile();
  }

  // 匿名访问、还没登录过的情况下，第一次打开才弹语言选择；选过一次之后
  // (哪怕换了语言) 就不再弹，直接进登录页。
  if (!localStorage.getItem(LANGUAGE_PICKED_KEY)) {
    showLanguagePicker(showLoginScreen);
  } else {
    showLoginScreen();
  }
})();
