import asyncio
import io
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import feedparser
import httpx
import pdfplumber
import trafilatura
from docx import Document as DocxDocument
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DOCUMENTS_FILE = DATA_DIR / "documents.json"
VOCAB_FILE = DATA_DIR / "vocab.json"
SENTENCE_NOTES_FILE = DATA_DIR / "sentence_notes.json"
USAGE_FILE = DATA_DIR / "api_usage.json"
FRONTEND_DIR = BASE_DIR / "frontend"

DATA_DIR.mkdir(parents=True, exist_ok=True)

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

SHEETS_WEBHOOK_URL = os.environ.get("SHEETS_WEBHOOK_URL", "")
SHEETS_TOKEN = os.environ.get("SHEETS_TOKEN", "")

app = FastAPI(title="English Reader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data):
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------- 文档管理(粘贴文本 / 网址导入 / PDF·DOCX 上传，最终都存成统一的文字文档) ----------

def extract_pdf_text(file_bytes: bytes) -> str:
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n\n".join(p.strip() for p in pages if p.strip())


def extract_docx_text(file_bytes: bytes) -> str:
    doc = DocxDocument(io.BytesIO(file_bytes))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    return "\n".join(paragraphs)


@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in (".pdf", ".docx"):
        raise HTTPException(400, "只支持 PDF 或 DOCX 文件")

    file_bytes = await file.read()
    try:
        if ext == ".pdf":
            content = await asyncio.to_thread(extract_pdf_text, file_bytes)
        else:
            content = await asyncio.to_thread(extract_docx_text, file_bytes)
    except Exception as e:
        raise HTTPException(400, f"解析文件失败：{e}")

    if not content.strip():
        raise HTTPException(400, "没能从这个文件里提取出文字，可能是扫描版 PDF(图片形式，没有文字层)")

    doc_id = uuid.uuid4().hex[:12]
    documents = _read_json(DOCUMENTS_FILE, [])
    record = {
        "id": doc_id,
        "filename": Path(file.filename).stem,
        "type": "text",
        "content": content,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    documents.append(record)
    _write_json(DOCUMENTS_FILE, documents)
    return record


class PasteRequest(BaseModel):
    title: str = ""
    content: str


@app.post("/api/paste")
async def paste_document(req: PasteRequest):
    if not req.content.strip():
        raise HTTPException(400, "文章内容不能为空")

    doc_id = uuid.uuid4().hex[:12]
    documents = _read_json(DOCUMENTS_FILE, [])
    record = {
        "id": doc_id,
        "filename": req.title.strip() or f"粘贴文章-{doc_id}",
        "type": "text",
        "content": req.content,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    documents.append(record)
    _write_json(DOCUMENTS_FILE, documents)
    return record


class UrlFetchRequest(BaseModel):
    url: str


@app.post("/api/fetch-url")
async def fetch_url_document(req: UrlFetchRequest):
    url = req.url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(400, "网址格式不对，需要以 http:// 或 https:// 开头")

    downloaded = await asyncio.to_thread(trafilatura.fetch_url, url)
    if not downloaded:
        raise HTTPException(400, "打不开这个网址，检查一下网址是否正确，或者这个网站限制了访问")

    extracted = await asyncio.to_thread(
        trafilatura.extract,
        downloaded,
        include_comments=False,
        include_tables=False,
        favor_precision=True,
        with_metadata=True,
        output_format="json",
    )
    if not extracted:
        raise HTTPException(400, "抓到了页面，但没能提取出正文，可能这个页面不是文章页")

    data = json.loads(extracted)
    title = (data.get("title") or "").strip() or url
    content = (data.get("text") or "").strip()
    if not content:
        raise HTTPException(400, "没有提取到正文内容")

    doc_id = uuid.uuid4().hex[:12]
    documents = _read_json(DOCUMENTS_FILE, [])
    record = {
        "id": doc_id,
        "filename": title,
        "type": "text",
        "content": content,
        "source_url": url,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    documents.append(record)
    _write_json(DOCUMENTS_FILE, documents)
    return record


@app.get("/api/documents")
async def list_documents():
    return _read_json(DOCUMENTS_FILE, [])


# ---------- DeepSeek 调用 ----------

def record_api_call():
    usage = _read_json(USAGE_FILE, {})
    month_key = datetime.now().strftime("%Y-%m")
    usage[month_key] = usage.get(month_key, 0) + 1
    _write_json(USAGE_FILE, usage)


@app.get("/api/usage")
async def get_usage():
    usage = _read_json(USAGE_FILE, {})
    month_key = datetime.now().strftime("%Y-%m")
    return {"month": month_key, "count": usage.get(month_key, 0)}


async def call_deepseek(prompt: str, json_mode: bool = False) -> str:
    if not DEEPSEEK_API_KEY:
        raise HTTPException(500, "未配置 DEEPSEEK_API_KEY")

    payload = {
        "model": "deepseek-chat",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            DEEPSEEK_API_URL,
            headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
            json=payload,
        )
    record_api_call()
    if resp.status_code != 200:
        raise HTTPException(502, f"AI 接口调用失败: {resp.text}")

    data = resp.json()
    return data["choices"][0]["message"]["content"]


def build_word_prompt(word: str, context: str) -> str:
    return (
        "你是一个英语学习助手。用户在阅读英文材料时选中了下面这个单词，正在学习积累生词。\n"
        f"单词：{word}\n"
        f"该单词所在的例句：{context or '（无）'}\n\n"
        "请结合例句的语境，以 JSON 格式返回，包含以下字段，不要输出任何多余文字：\n"
        '{"chinese_meaning": "这个词在该语境下的准确中文释义，简洁，不超过15个字", '
        '"ipa": "国际音标，不带斜杠符号", '
        '"pos": "词性缩写，如 n. / v. / adj. / adv. / prep. 等"}'
    )


def build_passage_prompt(text: str) -> str:
    return (
        "你是一个英语学习助手。用户在阅读英文材料时选中了下面这句话，觉得理解起来有难度。\n"
        f"选中内容：{text}\n\n"
        "请用简洁的中文回答，包含：\n"
        "1) 这句话的整体意思\n"
        "2) 语法结构拆解或值得注意的表达方式（如果有难点的话）\n"
        "直接给出结果，不要客套话，不要重复原文。"
    )


class AnalyzeRequest(BaseModel):
    text: str
    context: str = ""
    mode: str  # "word" | "passage"


class AnalyzeResponse(BaseModel):
    mode: str
    explanation: str = ""
    chinese_meaning: Optional[str] = None
    ipa: Optional[str] = None
    pos: Optional[str] = None


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_selection(req: AnalyzeRequest):
    if req.mode == "word":
        raw = await call_deepseek(build_word_prompt(req.text, req.context), json_mode=True)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {}
        return AnalyzeResponse(
            mode="word",
            chinese_meaning=parsed.get("chinese_meaning", ""),
            ipa=parsed.get("ipa", ""),
            pos=parsed.get("pos", ""),
        )

    explanation = await call_deepseek(build_passage_prompt(req.text))
    return AnalyzeResponse(mode="passage", explanation=explanation)


# ---------- AI 文章推荐(拉 RSS 标题 + DeepSeek 按难度/话题筛选打标签) ----------

USER_LEVEL_DESC = "大学英语四级已通过，六级考了480分，属于中等偏下的中高级学习者（约B1-B2水平）"

RSS_FEEDS = [
    ("BBC", "https://feeds.bbci.co.uk/news/rss.xml"),
    ("BBC", "https://feeds.bbci.co.uk/news/technology/rss.xml"),
    ("BBC", "https://feeds.bbci.co.uk/news/business/rss.xml"),
    ("BBC", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"),
    ("Guardian", "https://www.theguardian.com/world/rss"),
    ("Guardian", "https://www.theguardian.com/culture/rss"),
    ("Guardian", "https://www.theguardian.com/science/rss"),
]

_recommend_cache = {"data": None, "ts": None}
RECOMMEND_CACHE_SECONDS = 3 * 60 * 60


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def fetch_headlines() -> list:
    items = []
    for source, feed_url in RSS_FEEDS:
        parsed = feedparser.parse(feed_url)
        for entry in parsed.entries[:8]:
            title = entry.get("title", "").strip()
            url = entry.get("link", "").strip()
            if not title or not url:
                continue
            items.append({
                "source": source,
                "title": title,
                "summary": _strip_html(entry.get("summary", ""))[:220],
                "url": url,
            })
    return items


def build_recommend_prompt(items: list) -> str:
    listing = "\n".join(f"{i}. [{it['source']}] {it['title']} — {it['summary']}" for i, it in enumerate(items))
    return (
        f"你是一个英语学习内容推荐助手。用户的英语水平：{USER_LEVEL_DESC}。\n"
        "下面是一批当天的英文新闻标题和摘要，请帮用户从中挑出 6-8 篇适合精读积累的文章。\n"
        "挑选标准：\n"
        "1) 难度要适中——不要挑长难句堆砌、专业术语密集的深度调查或学术性文章，也不要挑过短的快讯简报\n"
        "2) 话题尽量多样化，覆盖不同领域，不要挑到好几篇话题重复的\n"
        "3) 优先挑叙事性强、可读性好、有完整信息量的文章\n\n"
        f"{listing}\n\n"
        '请以 JSON 格式返回：{"picks": [{"index": 原列表序号(数字), '
        '"tags": ["1到2个中文话题标签，如\\"科技\\"、\\"文化\\"、\\"环境\\""], '
        '"difficulty": "适中/较易/较难 三选一", '
        '"reason": "一句话说明推荐理由，中文，不超过30字"}]}\n'
        "只返回这个 JSON，不要有其他文字。"
    )


@app.get("/api/recommendations")
async def get_recommendations(refresh: bool = False):
    now = datetime.now(timezone.utc)
    if not refresh and _recommend_cache["data"] is not None and _recommend_cache["ts"]:
        age = (now - _recommend_cache["ts"]).total_seconds()
        if age < RECOMMEND_CACHE_SECONDS:
            return _recommend_cache["data"]

    items = await asyncio.to_thread(fetch_headlines)
    if not items:
        raise HTTPException(502, "没能拉到新闻列表，可能是网络问题或者 RSS 源暂时不可用")

    raw = await call_deepseek(build_recommend_prompt(items), json_mode=True)
    try:
        picks = json.loads(raw).get("picks", [])
    except json.JSONDecodeError:
        picks = []

    results = []
    seen_urls = set()
    for p in picks:
        idx = p.get("index")
        if not isinstance(idx, int) or not (0 <= idx < len(items)):
            continue
        item = items[idx]
        if item["url"] in seen_urls:
            continue
        seen_urls.add(item["url"])
        results.append({
            **item,
            "tags": p.get("tags", []),
            "difficulty": p.get("difficulty", ""),
            "reason": p.get("reason", ""),
        })

    _recommend_cache["data"] = results
    _recommend_cache["ts"] = now
    return results


# ---------- 保存生词 / 句子笔记(本地 + Google Sheet 同步) ----------

async def push_to_sheet(payload: dict) -> bool:
    if not SHEETS_WEBHOOK_URL:
        return False
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(SHEETS_WEBHOOK_URL, json={**payload, "token": SHEETS_TOKEN})
        return resp.status_code == 200
    except Exception:
        return False


class SaveRequest(BaseModel):
    mode: str  # "word" | "passage"
    text: str
    context: str = ""
    explanation: str = ""
    chinese_meaning: str = ""
    ipa: str = ""
    pos: str = ""
    source_doc: str = ""


@app.post("/api/save")
async def save_entry(req: SaveRequest):
    today = datetime.now().strftime("%Y-%m-%d")
    now_iso = datetime.now(timezone.utc).isoformat()

    if req.mode == "word":
        vocab = _read_json(VOCAB_FILE, [])
        existing = next((v for v in vocab if v.get("word", "").strip().lower() == req.text.strip().lower()), None)
        if existing:
            return {"record": existing, "sheet_synced": False, "duplicate": True}

        record = {
            "id": uuid.uuid4().hex[:12],
            "word": req.text,
            "sentence": req.context,
            "chinese_meaning": req.chinese_meaning,
            "ipa": req.ipa,
            "pos": req.pos,
            "source_doc": req.source_doc,
            "date": today,
            "added_at": now_iso,
        }
        vocab.append(record)
        _write_json(VOCAB_FILE, vocab)
        synced = await push_to_sheet({
            "type": "word",
            "word": req.text,
            "sentence": req.context,
            "chinese_meaning": req.chinese_meaning,
            "ipa": req.ipa,
            "pos": req.pos,
            "source": req.source_doc,
            "date": today,
        })
        return {"record": record, "sheet_synced": synced, "duplicate": False}
    else:
        notes = _read_json(SENTENCE_NOTES_FILE, [])
        record = {
            "id": uuid.uuid4().hex[:12],
            "sentence": req.text,
            "analysis": req.explanation,
            "source_doc": req.source_doc,
            "date": today,
            "added_at": now_iso,
        }
        notes.append(record)
        _write_json(SENTENCE_NOTES_FILE, notes)
        synced = await push_to_sheet({
            "type": "sentence",
            "sentence": req.text,
            "analysis": req.explanation,
            "source": req.source_doc,
            "date": today,
        })
        return {"record": record, "sheet_synced": synced, "duplicate": False}


@app.get("/api/vocab")
async def list_vocab():
    return _read_json(VOCAB_FILE, [])


@app.get("/api/sentence_notes")
async def list_sentence_notes():
    return _read_json(SENTENCE_NOTES_FILE, [])


@app.delete("/api/vocab/{item_id}")
async def delete_vocab(item_id: str):
    vocab = _read_json(VOCAB_FILE, [])
    remaining = [v for v in vocab if v.get("id") != item_id]
    if len(remaining) == len(vocab):
        raise HTTPException(404, "没找到这条生词记录")
    _write_json(VOCAB_FILE, remaining)
    return {"ok": True}


@app.delete("/api/sentence_notes/{item_id}")
async def delete_sentence_note(item_id: str):
    notes = _read_json(SENTENCE_NOTES_FILE, [])
    remaining = [n for n in notes if n.get("id") != item_id]
    if len(remaining) == len(notes):
        raise HTTPException(404, "没找到这条句子笔记")
    _write_json(SENTENCE_NOTES_FILE, remaining)
    return {"ok": True}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
