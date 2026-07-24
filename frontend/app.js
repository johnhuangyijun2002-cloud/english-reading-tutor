let authToken = localStorage.getItem("authToken") || "";
let currentUser = null; // {id, name, is_owner}

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
  populateLearningLanguageOptions();
}

async function loadI18n(lang) {
  const res = await fetch(`/i18n/${lang}.json`, { cache: "no-store" });
  i18nStrings = await res.json();
  currentUiLanguage = lang;
  localStorage.setItem("uiLanguage", lang);
  applyI18n();
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
      onDone();
    },
    { once: true },
  );
}

// ---------- 学习语言(每篇文章一个值，跟界面语言是两回事) ----------

const LEARNING_LANGUAGE_CODES = ["en", "zh", "ja", "ko", "fr", "es", "de", "it", "pt", "ru", "ar", "th"];
const LAST_LEARNING_LANGUAGE_KEY = "lastLearningLanguage";

function getLastLearningLanguage() {
  return localStorage.getItem(LAST_LEARNING_LANGUAGE_KEY) || "en";
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

function populateLearningLanguageOptions() {
  populateLearningLanguageOptionsFor("learningLanguageSelect");
}

function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${authToken}` };
  // GET 请求默认可能被浏览器按 URL 缓存，Authorization header 不同也可能命中旧缓存，
  // 导致登出/换账号后读到别人或者已登出状态下的数据 —— 强制不缓存。
  return fetch(url, { ...opts, headers, cache: "no-store" }).then((res) => {
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

const fileInput = document.getElementById("fileInput");
const docSelect = document.getElementById("docSelect");
const viewer = document.getElementById("viewer");
const viewerContent = document.getElementById("viewerContent");
const readingProgressFill = document.getElementById("readingProgressFill");
const annotationList = document.getElementById("annotationList");
const selectionToolbar = document.getElementById("selectionToolbar");
const btnAnalyze = document.getElementById("btnAnalyze");
const btnPronounce = document.getElementById("btnPronounce");
const btnSaveAll = document.getElementById("btnSaveAll");
const btnPrint = document.getElementById("btnPrint");
const printArea = document.getElementById("printArea");

const btnReaderSettings = document.getElementById("btnReaderSettings");
const readerSettingsPanel = document.getElementById("readerSettingsPanel");

const btnAddArticle = document.getElementById("btnAddArticle");
const pastePanelOverlay = document.getElementById("pastePanelOverlay");
const pasteTitle = document.getElementById("pasteTitle");
const pasteContent = document.getElementById("pasteContent");
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

const usageBadge = document.getElementById("usageBadge");

const btnSearchHistory = document.getElementById("btnSearchHistory");
const searchPanelOverlay = document.getElementById("searchPanelOverlay");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const btnSearchClose = document.getElementById("btnSearchClose");
let searchDataCache = null;

const btnDocManager = document.getElementById("btnDocManager");
const docManagerPanelOverlay = document.getElementById("docManagerPanelOverlay");
const docManagerList = document.getElementById("docManagerList");
const btnDocManagerClose = document.getElementById("btnDocManagerClose");

const btnAccountSettings = document.getElementById("btnAccountSettings");
const accountSettingsPanelOverlay = document.getElementById("accountSettingsPanelOverlay");
const settingsUserLine = document.getElementById("settingsUserLine");
const uiLanguageSelect = document.getElementById("uiLanguageSelect");
const explainLanguageSelect = document.getElementById("explainLanguageSelect");
const aiProviderSelect = document.getElementById("aiProviderSelect");
const aiApiKeyInput = document.getElementById("aiApiKeyInput");
const aiKeyHint = document.getElementById("aiKeyHint");
const houseTrialHint = document.getElementById("houseTrialHint");
const sheetsSyncBlock = document.getElementById("sheetsSyncBlock");
const sheetsSyncToggle = document.getElementById("sheetsSyncToggle");
const btnSettingsSave = document.getElementById("btnSettingsSave");
const settingsSaveStatus = document.getElementById("settingsSaveStatus");
const btnLogout = document.getElementById("btnLogout");

const newUsernameInput = document.getElementById("newUsernameInput");
const btnChangeUsername = document.getElementById("btnChangeUsername");
const changeUsernameStatus = document.getElementById("changeUsernameStatus");

const changePasswordLabel = document.getElementById("changePasswordLabel");
const newPasswordInput = document.getElementById("newPasswordInput");
const btnChangePassword = document.getElementById("btnChangePassword");
const changePasswordStatus = document.getElementById("changePasswordStatus");

const googleLinkStatus = document.getElementById("googleLinkStatus");
const btnLinkGoogle = document.getElementById("btnLinkGoogle");

const inviteBlock = document.getElementById("inviteBlock");
const invitedUsersList = document.getElementById("invitedUsersList");

const btnExportData = document.getElementById("btnExportData");
const btnDeleteAccount = document.getElementById("btnDeleteAccount");
const accountDataStatus = document.getElementById("accountDataStatus");

const loginOverlay = document.getElementById("loginOverlay");
const loginUsernameInput = document.getElementById("loginUsernameInput");
const loginPasswordInput = document.getElementById("loginPasswordInput");
const loginError = document.getElementById("loginError");
const btnLoginSubmit = document.getElementById("btnLoginSubmit");
const btnRegisterSubmit = document.getElementById("btnRegisterSubmit");
const btnGoogleLogin = document.getElementById("btnGoogleLogin");

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
    fetch("/api/config", { cache: "no-store" })
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
  const res = await apiFetch("/api/documents");
  allDocs = await res.json();
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
    alert(t("upload.failed", { message: await res.text() }));
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
  currentDocId = doc.id;
  currentDocName = doc.filename;
  currentDocContent = doc.content;
  currentDocSourceUrl = doc.source_url || "";
  currentDocLearningLanguage = doc.learning_language || "en";
  btnReaderSettings.classList.remove("hidden");
  btnPrint.classList.remove("hidden");
  renderHistoryForDoc(doc.filename);
  renderTextDocument(doc.content, doc.filename, doc.source_url);
}

function renderTextDocument(content, title, sourceUrl) {
  viewerContent.innerHTML = "";
  const container = document.createElement("div");
  container.className = "text-doc";
  container.appendChild(buildArticleHeader(content, title, sourceUrl));
  const paragraphs = content.split(/\n+/);
  paragraphs.forEach((p) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    const el = document.createElement("p");
    el.className = "text-para";
    el.innerHTML = highlightKnownWords(trimmed);
    container.appendChild(el);
  });
  viewerContent.appendChild(container);
  resetReadingProgress();
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

  header.appendChild(meta);
  return header;
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

  readerSettingsPanel.querySelectorAll(".settingsOptions").forEach((group) => {
    const key = group.dataset.setting;
    group.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === String(settings[key]));
    });
  });
}

let readerSettings = loadReaderSettings();
applyReaderSettings(readerSettings);

readerSettingsPanel.querySelectorAll(".settingsOptions button").forEach((btn) => {
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
    usageBadge.title = `${data.count} · ${currentUiLanguage === "en" ? "estimated from each provider's public pricing, not a real bill" : "花销是按各服务商公开定价估算的，不是真实账单，仅供参考"}`;
  } catch (err) {
    // 统计接口失败不影响主功能，静默忽略
  }
}

// ---------- 已学生词高亮 ----------

async function loadKnownWords() {
  const res = await apiFetch("/api/vocab");
  const vocab = await res.json();
  knownWordsMap = new Map();
  vocab.forEach((v) => {
    const key = (v.word || "").trim().toLowerCase();
    if (key) knownWordsMap.set(key, v);
  });
  knownWords = new Set(knownWordsMap.keys());
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightKnownWords(text) {
  if (knownWords.size === 0) return escapeHtml(text);

  const wordRegex = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
  let result = "";
  let lastIndex = 0;
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    const word = match[0];
    result += escapeHtml(text.slice(lastIndex, match.index));
    if (knownWords.has(word.toLowerCase())) {
      result += `<mark class="known-word" data-word="${escapeHtml(word.toLowerCase())}">${escapeHtml(word)}</mark>`;
    } else {
      result += escapeHtml(word);
    }
    lastIndex = match.index + word.length;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

// ---------- 点击已高亮的生词，弹出之前存的释义 ----------

const wordPopup = document.getElementById("wordPopup");

viewerContent.addEventListener("click", (e) => {
  const mark = e.target.closest(".known-word");
  if (!mark) return;
  showWordPopup(mark);
});

function showWordPopup(mark) {
  const record = knownWordsMap.get(mark.dataset.word);
  if (!record) return;

  const meta = [record.pos, record.ipa].filter(Boolean).join("  ·  ");
  wordPopup.innerHTML = `
    <div class="wordPopup-header">
      <div class="wordPopup-word"></div>
      ${canSpeak() ? `<button type="button" class="pronounce-btn" title="${t("common.pronounce")}">${iconHTML("volume-2")}</button>` : ""}
    </div>
    <div class="wordPopup-meta"></div>
    <div class="wordPopup-meaning"></div>
    <div class="wordPopup-sentence"></div>
    <div class="wordPopup-actions">
      <button class="wordPopup-delete">从生词表删除</button>
    </div>
  `;
  wordPopup.querySelector(".wordPopup-word").textContent = record.word || "";
  wordPopup.querySelector(".wordPopup-meta").textContent = meta;
  wordPopup.querySelector(".wordPopup-meaning").textContent = record.chinese_meaning || "";
  wordPopup.querySelector(".wordPopup-sentence").textContent = record.sentence || "";
  wordPopup.querySelector(".wordPopup-delete").addEventListener("click", async () => {
    const ok = await deleteRecord({ ...record, mode: "word" });
    if (ok) hideWordPopup();
  });
  const wordPopupPronounceBtn = wordPopup.querySelector(".pronounce-btn");
  if (wordPopupPronounceBtn) {
    wordPopupPronounceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      speakText(record.word, record.learning_language || currentDocLearningLanguage);
    });
  }

  const rect = mark.getBoundingClientRect();
  wordPopup.classList.remove("hidden");
  const popupWidth = wordPopup.offsetWidth;
  let left = window.scrollX + rect.left;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - popupWidth - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  wordPopup.style.left = left + "px";
  wordPopup.style.top = window.scrollY + rect.bottom + 8 + "px";
}

function hideWordPopup() {
  wordPopup.classList.add("hidden");
}

document.addEventListener("click", (e) => {
  if (wordPopup.classList.contains("hidden")) return;
  if (!wordPopup.contains(e.target) && !e.target.closest(".known-word")) {
    hideWordPopup();
  }
});

// ---------- 添加文章面板(粘贴文本 / 网址导入) ----------

btnAddArticle.addEventListener("click", () => {
  pastePanelOverlay.classList.remove("hidden");
});

btnPasteCancel.addEventListener("click", () => {
  pastePanelOverlay.classList.add("hidden");
});

pastePanelOverlay.addEventListener("click", (e) => {
  if (e.target === pastePanelOverlay) pastePanelOverlay.classList.add("hidden");
});

learningLanguageSelect.addEventListener("change", () => {
  localStorage.setItem(LAST_LEARNING_LANGUAGE_KEY, learningLanguageSelect.value);
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
    if (!res.ok) throw new Error(await res.text());
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
  if (!res.ok) throw new Error(await res.text());
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

async function loadRecommendations(refresh) {
  recommendList.innerHTML = `<p class="recommend-loading">${t("recommend.loading")}</p>`;
  btnRecommendRefresh.disabled = true;
  try {
    const learningLanguage = getLastLearningLanguage();
    document.getElementById("recommendLangHint").textContent = t("recommend.forLanguage", {
      language: t(`languages.${learningLanguage}`),
    });
    const params = new URLSearchParams({ learning_language: learningLanguage });
    if (refresh) params.set("refresh", "true");
    const res = await apiFetch(`/api/recommendations?${params.toString()}`);
    if (!res.ok) throw new Error(await res.text());
    const picks = await res.json();
    renderRecommendations(picks, learningLanguage);
    loadUsage();
  } catch (err) {
    recommendList.innerHTML = `<p class="recommend-loading">${t("recommend.failed", { message: err.message })}</p>`;
  } finally {
    btnRecommendRefresh.disabled = false;
  }
}

function renderRecommendations(picks, learningLanguage) {
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
        <button class="btn btn-primary btn-small">读这篇</button>
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
    readBtn.addEventListener("click", async () => {
      readBtn.disabled = true;
      readBtn.textContent = t("recommend.fetching");
      try {
        const doc = await fetchUrlAsDocument(pick.url, learningLanguage);
        await refreshDocuments(doc.id);
        recommendPanelOverlay.classList.add("hidden");
      } catch (err) {
        alert(t("paste.fetchFailed", { message: err.message }));
        readBtn.disabled = false;
        readBtn.textContent = t("recommend.readThis");
      }
    });

    recommendList.appendChild(card);
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

// ---------- 划词 / 划句 ----------

document.addEventListener("mouseup", (e) => {
  if (selectionToolbar.contains(e.target)) return;
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
  selectionToolbar.style.top = window.scrollY + rect.bottom + 6 + "px";
  selectionToolbar.style.left = window.scrollX + rect.left + "px";
  btnAnalyze.innerHTML =
    pendingSelectionMode === "word"
      ? iconHTML("bookmark") + t("toolbar.saveWord")
      : iconHTML("lightbulb") + t("toolbar.analyzeSentence");
  btnPronounce.classList.toggle("hidden", !(pendingSelectionMode === "word" && canSpeak()));
  btnPronounce.title = t("common.pronounce");
  selectionToolbar.classList.remove("hidden");
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

// 判断某个 . / ! / ? 是不是真正的句子结尾（排除缩写词、人名首字母、小数点）
function isRealSentenceEnd(text, idx) {
  const ch = text[idx];
  if (ch === "!" || ch === "?") return true;

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
    if ((ch === "." || ch === "!" || ch === "?") && isRealSentenceEnd(text, i)) {
      return i + 1;
    }
  }
  return 0;
}

function findSentenceEnd(text, fromIndex) {
  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i];
    if ((ch === "." || ch === "!" || ch === "?") && isRealSentenceEnd(text, i)) {
      return i + 1;
    }
  }
  return text.length;
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
    if (!res.ok) throw new Error(await res.text());
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

  const metaEl = el.querySelector(".ann-meta");
  const explEl = el.querySelector(".ann-explanation");

  if (el.dataset.mode === "word" && data.chinese_meaning) {
    metaEl.textContent = [data.pos, data.ipa].filter(Boolean).join("  ·  ");
    explEl.textContent = data.chinese_meaning;
  } else {
    metaEl.textContent = "";
    explEl.textContent = data.explanation || t("annotation.noResult");
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
  viewerContent.innerHTML = `<div id="emptyState"><p>${t("empty.noDocument")}</p></div>`;
  showHistoryEmptyState(t("history.emptyNoDoc"));
  btnReaderSettings.classList.add("hidden");
  readerSettingsPanel.classList.add("hidden");
  btnPrint.classList.add("hidden");
}

async function renderHistoryForDoc(docName) {
  annotationList.innerHTML = "";

  const [vocabRes, notesRes] = await Promise.all([apiFetch("/api/vocab"), apiFetch("/api/sentence_notes")]);
  const vocab = await vocabRes.json();
  const notes = await notesRes.json();

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
    <div class="ann-footer">
      <div class="ann-footer-meta">
        <span class="ann-source"></span>
        <span class="ann-date"></span>
      </div>
      <button class="ann-delete-btn">${t("history.deleteBtn")}</button>
    </div>
  `;
  el.querySelector(".ann-text").textContent = text || "";
  el.querySelector(".ann-meta").textContent = meta;
  el.querySelector(".ann-explanation").textContent = explanation || "";
  el.querySelector(".ann-source").textContent = record.source_doc || "";
  el.querySelector(".ann-date").textContent = record.date || "";
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
  return el;
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
    if (!res.ok) throw new Error(await res.text());
  } catch (err) {
    alert(t("history.deleteFailed", { message: err.message }));
    return false;
  }

  if (record.mode === "word") {
    await loadKnownWords();
    if (currentDocContent) {
      renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl);
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

// ---------- 全局搜索(跨所有文章的生词/句子笔记) ----------

btnSearchHistory.addEventListener("click", async () => {
  searchPanelOverlay.classList.remove("hidden");
  searchInput.value = "";
  searchResults.innerHTML = `<p class="recommend-loading">${t("search.loading")}</p>`;
  searchInput.focus();
  searchDataCache = null;
  await loadSearchData();
  renderSearchResults(searchDataCache);
});

btnSearchClose.addEventListener("click", () => {
  searchPanelOverlay.classList.add("hidden");
});

searchPanelOverlay.addEventListener("click", (e) => {
  if (e.target === searchPanelOverlay) searchPanelOverlay.classList.add("hidden");
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
        if (!res.ok) throw new Error(await res.text());
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

async function loadSearchData() {
  const [vocabRes, notesRes] = await Promise.all([apiFetch("/api/vocab"), apiFetch("/api/sentence_notes")]);
  const vocab = await vocabRes.json();
  const notes = await notesRes.json();
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
  if (!matches || matches.length === 0) {
    const hasQuery = searchInput.value.trim().length > 0;
    const hasAnyData = searchDataCache && searchDataCache.length > 0;
    searchResults.innerHTML = hasQuery || hasAnyData
      ? `<p class="recommend-loading">${t("search.noMatch")}</p>`
      : `<p class="recommend-loading">${t("search.empty")}</p>`;
    return;
  }
  searchResults.innerHTML = "";
  matches.slice(0, 50).forEach((record) => {
    const card = buildHistoryCard(record);
    card.classList.add("searchResultCard");
    card.title = "点击跳转到这篇文章";
    card.addEventListener("click", () => jumpToArticle(record.source_doc));
    searchResults.appendChild(card);
  });
}

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
  try {
    const res = await apiFetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: el.dataset.mode,
        text,
        context: el.dataset.context || "",
        explanation: el.dataset.explanation || "",
        chinese_meaning: el.dataset.chineseMeaning || "",
        ipa: el.dataset.ipa || "",
        pos: el.dataset.pos || "",
        source_doc: currentDocName,
        learning_language: currentDocLearningLanguage,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    if (data.duplicate) {
      saveBtn.textContent = t("annotation.duplicate");
      // 用 innerHTML 只放图标(固定、可信的 SVG)，正文用 append() 当纯文本插入——
      // text 是用户从文章里划的原文，可能包含尖括号之类的字符，绝不能直接拼进 innerHTML。
      statusEl.innerHTML = iconHTML("alert-triangle");
      statusEl.append(t("annotation.duplicateStatus", { text }));
      return;
    }

    saveBtn.textContent = t("annotation.saved");
    statusEl.innerHTML = iconHTML(data.sheet_synced ? "check-circle" : "alert-triangle");
    statusEl.append(data.sheet_synced ? t("annotation.syncOk") : t("annotation.syncFail"));

    if (el.dataset.mode === "word") {
      await loadKnownWords();
      renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl);
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
  btnPrint.textContent = "准备中...";
  try {
    const [vocabRes, notesRes] = await Promise.all([apiFetch("/api/vocab"), apiFetch("/api/sentence_notes")]);
    const vocab = (await vocabRes.json()).filter((v) => v.source_doc === currentDocName);
    const notes = (await notesRes.json()).filter((n) => n.source_doc === currentDocName);
    buildPrintArea(vocab, notes);
    window.print();
  } catch (err) {
    alert("准备打印内容失败: " + err.message);
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
    h2.textContent = `生词表(共 ${vocabMap.size} 个)`;
    container.appendChild(h2);

    const table = document.createElement("table");
    table.className = "printVocabTable";
    table.innerHTML = "<thead><tr><th>#</th><th>单词</th><th>音标</th><th>词性</th><th>释义</th></tr></thead><tbody></tbody>";
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
    h2.textContent = `不熟悉的句子(共 ${sentenceList.length} 句)`;
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
      result += `<span class="printMarkSentence">${segment}<sup class="printMarkLabel printMarkLabelSentence">句${r.label}</sup></span>`;
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
  explainLanguageSelect.value = data.explain_language || "auto";

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

  googleLinkStatus.textContent = data.has_google
    ? t("settings.googleLinkedStatus", { email: data.google_email })
    : t("settings.googleUnlinkedStatus");
  btnLinkGoogle.textContent = data.has_google ? t("settings.googleLinkBtnRelink") : t("settings.googleLinkBtn");

  inviteBlock.classList.toggle("hidden", !data.is_owner);
  if (data.is_owner) loadInvitedUsers();
}

btnLinkGoogle.addEventListener("click", async () => {
  btnLinkGoogle.disabled = true;
  googleLinkStatus.textContent = currentUiLanguage === "en" ? "Redirecting to Google sign-in..." : "跳转到 Google 授权页...";
  try {
    const res = await apiFetch("/api/auth/google/link-init", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    location.href = "/api/auth/google/login?link_nonce=" + encodeURIComponent(data.nonce);
  } catch (err) {
    googleLinkStatus.textContent = (currentUiLanguage === "en" ? "Linking failed: " : "关联失败: ") + err.message;
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
    if (!res.ok) throw new Error(await res.text());
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
    if (!res.ok) throw new Error(await res.text());
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
    if (!res.ok) throw new Error(await res.text());
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
    if (!res.ok) throw new Error(await res.text());
    localStorage.removeItem("authToken");
    alert(t("account.deleted"));
    location.reload();
  } catch (err) {
    accountDataStatus.textContent = t("account.deleteFailed", { message: err.message });
    btnDeleteAccount.disabled = false;
  }
});

async function loadInvitedUsers() {
  const res = await apiFetch("/api/admin/users");
  if (!res.ok) return;
  const users = await res.json();
  invitedUsersList.textContent = users.map((u) => u.name + (u.is_owner ? t("settings.youTag") : "")).join(currentUiLanguage === "en" ? ", " : "、");
}

function updateKeyHint() {
  if (!settingsDataCache) return;
  aiApiKeyInput.value = "";
  const status = settingsDataCache.ai_key_status[aiProviderSelect.value] || {};
  aiKeyHint.textContent = status.has_key
    ? t("settings.apiKeyHintSet", { masked: status.masked })
    : t("settings.apiKeyHintUnset");
}

aiProviderSelect.addEventListener("change", updateKeyHint);

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
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    if (newUiLanguage !== currentUiLanguage) {
      // 界面语言变了：已经渲染到页面上的动态内容(历史记录空状态、文档列表标签等)
      // 不会跟着 applyI18n() 自动重译，最简单可靠的办法是刷新页面，让整个初始化流程
      // 用新语言重新走一遍，而不是挨个去补一堆"语言切换时重渲染"的特殊逻辑。
      localStorage.setItem("uiLanguage", newUiLanguage);
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

// ---------- 登录 / 注册(用户名密码 或 Google) ----------

async function checkToken(token) {
  try {
    const res = await fetch("/api/me", {
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
}

async function enterApp(token, me) {
  authToken = token;
  localStorage.setItem("authToken", token);
  currentUser = me;
  if (me.ui_language && me.ui_language !== currentUiLanguage) await loadI18n(me.ui_language);
  loginOverlay.classList.add("hidden");
  initApp();
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
});

btnLoginSubmit.addEventListener("click", async () => {
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  if (!username || !password) return;
  btnLoginSubmit.disabled = true;
  btnRegisterSubmit.disabled = true;
  loginError.classList.add("hidden");
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, turnstile_token: turnstileToken }),
      cache: "no-store",
    });
    if (!res.ok) {
      const fallback = currentUiLanguage === "en" ? "Username or password is wrong, double-check it" : "用户名或密码不对，再检查一下";
      throw new Error((await res.json().catch(() => null))?.detail || fallback);
    }
    const data = await res.json();
    await enterApp(data.token, data);
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
  if (!username || !password) {
    loginError.textContent = currentUiLanguage === "en" ? "Username and password are both required" : "用户名和密码都要填";
    loginError.classList.remove("hidden");
    return;
  }
  btnLoginSubmit.disabled = true;
  btnRegisterSubmit.disabled = true;
  loginError.classList.add("hidden");
  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, turnstile_token: turnstileToken, ui_language: currentUiLanguage }),
      cache: "no-store",
    });
    if (!res.ok) {
      const bodyText = await res.text();
      let detail = bodyText;
      try { detail = JSON.parse(bodyText).detail || bodyText; } catch (e) { /* 不是 JSON 就原样显示 */ }
      throw new Error(detail);
    }
    const data = await res.json();
    await enterApp(data.token, data);
    showWelcomeModal(data);
  } catch (err) {
    loginError.textContent = (currentUiLanguage === "en" ? "Registration failed: " : "注册失败: ") + err.message;
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
  location.href = "/api/auth/google/login";
});

(async () => {
  await loadI18n(currentUiLanguage);

  // Google 登录/关联跳回来的时候，token 会带在地址栏的 #token=... 里
  const hashMatch = location.hash.match(/token=([^&]+)/);
  const justLinkedGoogle = /(^|&)google_linked=1/.test(location.hash);
  if (hashMatch) {
    const token = decodeURIComponent(hashMatch[1]);
    history.replaceState(null, "", location.pathname + location.search);
    const me = await checkToken(token);
    if (me) {
      await enterApp(token, me);
      if (justLinkedGoogle) {
        alert("Google 账号关联成功，以后用 Google 登录也能看到这个账号下的内容");
        btnAccountSettings.click();
      }
      return;
    }
  }

  if (authToken) {
    const me = await checkToken(authToken);
    if (me) {
      currentUser = me;
      if (me.ui_language && me.ui_language !== currentUiLanguage) await loadI18n(me.ui_language);
      initApp();
      return;
    }
    localStorage.removeItem("authToken");
    authToken = "";
  }

  function showLoginScreen() {
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
