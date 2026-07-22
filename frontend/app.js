let allDocs = [];
let currentDocId = null;
let currentDocName = "";
let currentDocContent = "";
let currentDocSourceUrl = "";
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

// ---------- 文档列表 / 加载 ----------

async function refreshDocuments(selectId) {
  const res = await fetch("/api/documents");
  allDocs = await res.json();
  docSelect.innerHTML = "";
  allDocs.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = "📄 " + d.filename;
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
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    alert("上传失败: " + (await res.text()));
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
  btnReaderSettings.classList.remove("hidden");
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
      link.textContent = displaySourceName(host);
      meta.appendChild(link);
    } catch (err) {
      // 网址格式有问题就不显示来源，不影响其他信息
    }
  }

  const wordCount = (content.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length;
  const minutes = Math.max(1, Math.round(wordCount / 150));

  const statWords = document.createElement("span");
  statWords.className = "articleStat";
  statWords.textContent = `约 ${wordCount} 词`;
  meta.appendChild(statWords);

  const statTime = document.createElement("span");
  statTime.className = "articleStat";
  statTime.textContent = `预计阅读 ${minutes} 分钟`;
  meta.appendChild(statTime);

  header.appendChild(meta);
  return header;
}

function displaySourceName(host) {
  if (host.includes("bbc.")) return "🌐 BBC";
  if (host.includes("theguardian.com")) return "🌐 The Guardian";
  return "🌐 " + host;
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
    const res = await fetch("/api/usage");
    const data = await res.json();
    usageBadge.textContent = `本月已调用 ${data.count} 次`;
  } catch (err) {
    // 统计接口失败不影响主功能，静默忽略
  }
}

// ---------- 已学生词高亮 ----------

async function loadKnownWords() {
  const res = await fetch("/api/vocab");
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
    <div class="wordPopup-word"></div>
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
    alert("先把文章内容粘贴进去");
    return;
  }
  btnPasteSubmit.disabled = true;
  try {
    const res = await fetch("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    if (!res.ok) throw new Error(await res.text());
    const doc = await res.json();
    await refreshDocuments(doc.id);
    pastePanelOverlay.classList.add("hidden");
    pasteTitle.value = "";
    pasteContent.value = "";
  } catch (err) {
    alert("保存失败: " + err.message);
  } finally {
    btnPasteSubmit.disabled = false;
  }
}

async function fetchUrlAsDocument(url) {
  const res = await fetch("/api/fetch-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function submitUrlImport() {
  const url = urlInput.value.trim();
  if (!url) {
    alert("先粘贴一个文章网址");
    return;
  }
  btnPasteSubmit.disabled = true;
  const originalLabel = btnPasteSubmit.textContent;
  btnPasteSubmit.textContent = "抓取中...";
  try {
    const doc = await fetchUrlAsDocument(url);
    await refreshDocuments(doc.id);
    pastePanelOverlay.classList.add("hidden");
    urlInput.value = "";
  } catch (err) {
    alert("抓取失败: " + err.message);
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
  recommendList.innerHTML = `<p class="recommend-loading">正在挑选适合你的文章，大概几秒钟...</p>`;
  btnRecommendRefresh.disabled = true;
  try {
    const res = await fetch(`/api/recommendations${refresh ? "?refresh=true" : ""}`);
    if (!res.ok) throw new Error(await res.text());
    const picks = await res.json();
    renderRecommendations(picks);
    loadUsage();
  } catch (err) {
    recommendList.innerHTML = `<p class="recommend-loading">推荐失败：${err.message}</p>`;
  } finally {
    btnRecommendRefresh.disabled = false;
  }
}

function renderRecommendations(picks) {
  if (!picks || picks.length === 0) {
    recommendList.innerHTML = `<p class="recommend-loading">暂时没有合适的推荐，点"换一批"再试试</p>`;
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
      diffEl.textContent = "难度 · " + pick.difficulty;
      tagsEl.appendChild(diffEl);
    }
    card.querySelector(".recCard-title").textContent = pick.title;
    card.querySelector(".recCard-reason").textContent = pick.reason || "";
    card.querySelector(".recCard-source").textContent = pick.source;

    const readBtn = card.querySelector(".btn-primary");
    readBtn.addEventListener("click", async () => {
      readBtn.disabled = true;
      readBtn.textContent = "抓取中...";
      try {
        const doc = await fetchUrlAsDocument(pick.url);
        await refreshDocuments(doc.id);
        recommendPanelOverlay.classList.add("hidden");
      } catch (err) {
        alert("抓取失败: " + err.message);
        readBtn.disabled = false;
        readBtn.textContent = "读这篇";
      }
    });

    recommendList.appendChild(card);
  });
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
  btnAnalyze.textContent = pendingSelectionMode === "word" ? "🔖 记录生词" : "💡 AI 解析句子";
  selectionToolbar.classList.remove("hidden");
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

  explEl.textContent = "AI 分析中...";
  explEl.classList.remove("ann-explanation-error");
  actionsEl.classList.add("hidden");
  retryEl.classList.add("hidden");

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, context, mode }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    updateAnnotationEntry(entryEl, data);
    actionsEl.classList.remove("hidden");
    loadUsage();
  } catch (err) {
    explEl.textContent = "分析失败：" + err.message;
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
    <span class="ann-type ann-type-${mode}">${mode === "word" ? "生词" : "句子"}</span>
    <div class="ann-text"></div>
    <div class="ann-meta"></div>
    <div class="ann-explanation">AI 分析中...</div>
    <div class="ann-actions hidden">
      <button class="ann-save">${mode === "word" ? "存入生词表" : "存入句子笔记"}</button>
      <span class="ann-sync-status"></span>
    </div>
    <div class="ann-retry hidden">
      <button class="ann-retry-btn">🔄 重试</button>
    </div>
  `;
  el.querySelector(".ann-text").textContent = text;
  el.querySelector(".ann-save").addEventListener("click", () => saveAnnotation(el, text));
  el.querySelector(".ann-retry-btn").addEventListener("click", () => runAnalyze(el, text, mode, context));
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
    explEl.textContent = data.explanation || "(无解析结果)";
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
  showHistoryEmptyState("先添加一篇文章，读完之后可以在这里看到相关的生词和笔记");
  btnReaderSettings.classList.add("hidden");
  readerSettingsPanel.classList.add("hidden");
}

async function renderHistoryForDoc(docName) {
  annotationList.innerHTML = "";

  const [vocabRes, notesRes] = await Promise.all([fetch("/api/vocab"), fetch("/api/sentence_notes")]);
  const vocab = await vocabRes.json();
  const notes = await notesRes.json();

  const combined = [
    ...vocab.map((v) => ({ ...v, mode: "word" })),
    ...notes.map((n) => ({ ...n, mode: "passage" })),
  ]
    .filter((r) => r.source_doc === docName)
    .sort((a, b) => (a.added_at < b.added_at ? 1 : -1));

  if (combined.length === 0) {
    showHistoryEmptyState("这篇文章还没有记录，划中单词或句子开始积累吧");
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
    <span class="ann-type ann-type-${record.mode}">${isWord ? "生词" : "句子"}</span>
    <div class="ann-text"></div>
    <div class="ann-meta"></div>
    <div class="ann-explanation"></div>
    <div class="ann-footer">
      <div class="ann-footer-meta">
        <span class="ann-source"></span>
        <span class="ann-date"></span>
      </div>
      <button class="ann-delete-btn">删除</button>
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
  return el;
}

function renderHistoryEntry(record) {
  const el = buildHistoryCard(record);
  annotationList.appendChild(el);
  return el;
}

// ---------- 删除已保存的生词 / 句子笔记(本地删除；已同步过的 Google Sheet 行不会自动删除) ----------

async function deleteRecord(record) {
  const label = record.mode === "word" ? "生词" : "句子笔记";
  const confirmed = confirm(
    `确定删除这条${label}记录吗？\n(本地会立即删除；如果之前同步过 Google Sheet，那边已经写入的行不会自动删除，需要手动去表格里清理)`
  );
  if (!confirmed) return false;

  const endpoint = record.mode === "word" ? `/api/vocab/${record.id}` : `/api/sentence_notes/${record.id}`;
  try {
    const res = await fetch(endpoint, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
  } catch (err) {
    alert("删除失败: " + err.message);
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
  searchResults.innerHTML = `<p class="recommend-loading">加载中...</p>`;
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

async function loadSearchData() {
  const [vocabRes, notesRes] = await Promise.all([fetch("/api/vocab"), fetch("/api/sentence_notes")]);
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
      ? `<p class="recommend-loading">没找到匹配的记录</p>`
      : `<p class="recommend-loading">还没有生词或笔记记录，读文章的时候划词/划句开始积累吧</p>`;
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
    alert("这篇文章可能已经被删除或改名了，找不到了");
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
  saveBtn.textContent = "保存中...";
  try {
    const res = await fetch("/api/save", {
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
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    if (data.duplicate) {
      saveBtn.textContent = "已存过";
      statusEl.textContent = `⚠️ 生词表里已经有 "${text}" 了，没有重复添加`;
      return;
    }

    saveBtn.textContent = "已保存";
    statusEl.textContent = data.sheet_synced ? "✅ 已同步 Sheet" : "⚠️ Sheet 同步失败(本地已存)";

    if (el.dataset.mode === "word") {
      await loadKnownWords();
      renderTextDocument(currentDocContent, currentDocName, currentDocSourceUrl);
    }
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = "保存失败，重试";
  }
}

(async () => {
  await loadKnownWords();
  refreshDocuments();
  loadUsage();
})();
