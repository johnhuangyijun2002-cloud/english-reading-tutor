import asyncio
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

import feedparser
import httpx
import pdfplumber
import trafilatura
from docx import Document as DocxDocument
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
# 本地开发默认用项目里的 data/ 文件夹；部署到 Railway 之类的平台时，把 DATA_DIR
# 这个环境变量指到挂载的持久化磁盘（比如 /data），数据才不会在每次重新部署时丢掉。
DATA_DIR = Path(os.environ.get("DATA_DIR") or (BASE_DIR / "data"))
DOCUMENTS_FILE = DATA_DIR / "documents.json"
VOCAB_FILE = DATA_DIR / "vocab.json"
SENTENCE_NOTES_FILE = DATA_DIR / "sentence_notes.json"
USAGE_FILE = DATA_DIR / "api_usage.json"
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
FRONTEND_DIR = BASE_DIR / "frontend"

DATA_DIR.mkdir(parents=True, exist_ok=True)

SHEETS_WEBHOOK_URL = os.environ.get("SHEETS_WEBHOOK_URL", "")
SHEETS_TOKEN = os.environ.get("SHEETS_TOKEN", "")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

app = FastAPI(title="English Reader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store_api_responses(request, call_next):
    # /api/* 响应带的是登录凭证鉴权后的个人数据，不能被浏览器/中间代理按 URL 缓存，
    # 不然换账号登录或者退出登录之后，可能还读到上一个人登录时缓存下来的响应。
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def _read_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data):
    # 写到临时文件再原子替换，不直接在原文件上截断写——不然如果写到一半进程被杀掉
    # (比如部署时旧容器收到 SIGTERM，这个每次发布都会发生)，文件可能被截断/写坏，
    # 下次读到的就是损坏或者丢了一部分内容的数据。
    tmp_path = path.with_name(path.name + f".tmp{os.getpid()}")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp_path.replace(path)


# ---------- 用户 / 账号注册登录(用户名密码 + Google 登录，登录后发一个 session token) ----------
# 谁都能自己注册用户名 + 密码，用户名/密码没有任何格式限制。第一个注册/登录的账号自动成为
# 主账号(唯一能开 Google Sheets 同步的账号)。登录成功后发一个 token，之后每次请求带
# Authorization: Bearer <token>；token 存在 data/sessions.json 里，不设过期时间(对这个
# 规模来说没必要)，退出登录时会把对应的 token 删掉。

bearer_scheme = HTTPBearer(auto_error=False)


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000).hex()


def _create_session(user_id: str) -> str:
    sessions = _read_json(SESSIONS_FILE, [])
    token = secrets.token_urlsafe(32)
    sessions.append({"token": token, "user_id": user_id, "created_at": datetime.now(timezone.utc).isoformat()})
    _write_json(SESSIONS_FILE, sessions)
    return token


def _delete_session(token: str):
    sessions = _read_json(SESSIONS_FILE, [])
    remaining = [s for s in sessions if s.get("token") != token]
    if len(remaining) != len(sessions):
        _write_json(SESSIONS_FILE, remaining)


def _migrate_legacy_invite_users():
    """把改版前"邀请码即凭证"的老账号，自动补上 username/password(初始密码沿用原邀请码)。"""
    users = _read_json(USERS_FILE, [])
    if not users:
        return
    print(
        "[startup] users.json 现有 "
        + str(len(users))
        + " 个账号: "
        + ", ".join(
            f"{u.get('username') or u.get('name')}(密码={'有' if u.get('password_hash') else '无'})" for u in users
        ),
        flush=True,
    )
    existing_usernames = {u.get("username") for u in users if u.get("username")}
    changed = False
    for u in users:
        if u.get("password_hash") or not u.get("invite_code"):
            continue
        base = re.sub(r"[^a-zA-Z0-9]", "", u.get("name", "")).lower() or "user"
        username = base
        n = 1
        while username in existing_usernames:
            n += 1
            username = f"{base}{n}"
        existing_usernames.add(username)
        salt = secrets.token_hex(16)
        u["username"] = username
        u["password_salt"] = salt
        u["password_hash"] = _hash_password(u["invite_code"], salt)
        changed = True
        print(f"[migrate] 账号「{u.get('name','')}」自动分配用户名：{username}（初始密码是原来的邀请码）", flush=True)
    if changed:
        _write_json(USERS_FILE, users)


def _audit(event: str, **fields):
    # 排查"密码莫名其妙变了"这类问题用的审计日志，打到 Railway 的部署日志里，
    # 不落盘、不影响正常功能——纯粹是为了下次万一再出问题时有据可查。
    parts = " ".join(f"{k}={v}" for k, v in fields.items())
    print(f"[audit] {datetime.now(timezone.utc).isoformat()} {event} {parts}", flush=True)


_migrate_legacy_invite_users()


class RegisterRequest(BaseModel):
    username: str
    password: str


@app.post("/api/register")
async def register(req: RegisterRequest):
    username = req.username.strip()
    password = req.password
    if not username or not password:
        raise HTTPException(400, "用户名和密码不能为空")

    users = _read_json(USERS_FILE, [])
    if any(u.get("username") == username for u in users):
        raise HTTPException(400, "这个用户名已经被注册了，换一个")

    salt = secrets.token_hex(16)
    new_user = {
        "id": "u_" + uuid.uuid4().hex[:10],
        "name": username,
        "username": username,
        "password_salt": salt,
        "password_hash": _hash_password(password, salt),
        "is_owner": len(users) == 0,
        "ai_provider": "deepseek",
        "ai_api_keys": {},
        "sheets_sync_enabled": False,
    }
    users.append(new_user)
    _write_json(USERS_FILE, users)
    _audit("register", user_id=new_user["id"], username=username)
    token = _create_session(new_user["id"])
    return {"token": token, "id": new_user["id"], "name": username, "is_owner": new_user["is_owner"]}


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/login")
async def login(req: LoginRequest):
    users = _read_json(USERS_FILE, [])
    user = next((u for u in users if u.get("username") == req.username.strip()), None)
    if not user or not user.get("password_hash"):
        raise HTTPException(401, "用户名或密码不对")
    expected = _hash_password(req.password, user.get("password_salt", ""))
    if not hmac.compare_digest(expected, user["password_hash"]):
        raise HTTPException(401, "用户名或密码不对")
    token = _create_session(user["id"])
    return {"token": token, "id": user["id"], "name": user.get("name", ""), "is_owner": user.get("is_owner", False)}


@app.post("/api/logout")
async def logout(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)):
    if credentials:
        _delete_session(credentials.credentials)
    return {"ok": True}


async def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)):
    if not credentials:
        raise HTTPException(401, "未登录")
    sessions = _read_json(SESSIONS_FILE, [])
    session = next((s for s in sessions if s.get("token") == credentials.credentials), None)
    if not session:
        raise HTTPException(401, "登录状态已失效，重新登录一下")
    users = _read_json(USERS_FILE, [])
    user = next((u for u in users if u["id"] == session["user_id"]), None)
    if not user:
        raise HTTPException(401, "账号不存在")
    return user


@app.get("/api/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "name": user.get("name", ""), "is_owner": user.get("is_owner", False)}


class ChangePasswordRequest(BaseModel):
    new_password: str


@app.post("/api/change-password")
async def change_password(req: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    if not req.new_password:
        raise HTTPException(400, "新密码不能为空")
    users = _read_json(USERS_FILE, [])
    for u in users:
        if u["id"] == user["id"]:
            salt = secrets.token_hex(16)
            u["password_salt"] = salt
            u["password_hash"] = _hash_password(req.new_password, salt)
    _write_json(USERS_FILE, users)
    _audit("change_password", user_id=user["id"], username=user.get("username"))
    return {"ok": True}


class ChangeUsernameRequest(BaseModel):
    new_username: str


@app.post("/api/change-username")
async def change_username(req: ChangeUsernameRequest, user: dict = Depends(get_current_user)):
    new_username = req.new_username.strip()
    if not new_username:
        raise HTTPException(400, "新用户名不能为空")
    users = _read_json(USERS_FILE, [])
    if any(u.get("username") == new_username and u["id"] != user["id"] for u in users):
        raise HTTPException(400, "这个用户名已经被占用了，换一个")
    for u in users:
        if u["id"] == user["id"]:
            u["username"] = new_username
            u["name"] = new_username
    _write_json(USERS_FILE, users)
    _audit("change_username", user_id=user["id"], old_username=user.get("username"), new_username=new_username)
    return {"ok": True, "username": new_username, "name": new_username}


@app.get("/api/admin/users")
async def list_registered_users(user: dict = Depends(get_current_user)):
    if not user.get("is_owner"):
        raise HTTPException(403, "只有主账号能查看用户列表")
    users = _read_json(USERS_FILE, [])
    return [{"name": u.get("name", ""), "is_owner": u.get("is_owner", False)} for u in users]


# ---------- Google 登录 ----------

_pending_oauth_states: dict = {}  # state -> 生成时间，用来防 CSRF，顺手清理超过 10 分钟的旧记录


def _new_oauth_state() -> str:
    now = datetime.now(timezone.utc)
    stale = [s for s, ts in _pending_oauth_states.items() if (now - ts).total_seconds() > 600]
    for s in stale:
        _pending_oauth_states.pop(s, None)
    state = secrets.token_urlsafe(16)
    _pending_oauth_states[state] = now
    return state


@app.get("/api/auth/google/login")
async def google_login(request: Request):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "这个部署还没配置 Google 登录(缺 GOOGLE_CLIENT_ID)")
    state = _new_oauth_state()
    redirect_uri = str(request.base_url) + "api/auth/google/callback"
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params))


@app.get("/api/auth/google/callback")
async def google_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        raise HTTPException(400, f"Google 登录失败: {error}")
    if not state or state not in _pending_oauth_states:
        raise HTTPException(400, "登录状态已过期，重新点一次「用 Google 登录」")
    _pending_oauth_states.pop(state, None)

    redirect_uri = str(request.base_url) + "api/auth/google/callback"
    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if token_resp.status_code != 200:
        raise HTTPException(400, f"Google 登录换取 token 失败: {token_resp.text}")
    google_access_token = token_resp.json().get("access_token", "")

    async with httpx.AsyncClient(timeout=15) as client:
        profile_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {google_access_token}"},
        )
    if profile_resp.status_code != 200:
        raise HTTPException(400, "拿不到 Google 账号信息")
    profile = profile_resp.json()
    google_id = profile.get("sub", "")
    email = profile.get("email", "")
    name = profile.get("name") or email or "Google 用户"
    if not google_id:
        raise HTTPException(400, "Google 账号信息里没有用户 ID")

    users = _read_json(USERS_FILE, [])
    user = next((u for u in users if u.get("google_id") == google_id), None)
    if not user:
        user = {
            "id": "u_" + uuid.uuid4().hex[:10],
            "name": name,
            "google_id": google_id,
            "google_email": email,
            "is_owner": len(users) == 0,
            "ai_provider": "deepseek",
            "ai_api_keys": {},
            "sheets_sync_enabled": False,
        }
        users.append(user)
        _write_json(USERS_FILE, users)
        _audit("google_register", user_id=user["id"], google_email=email)

    token = _create_session(user["id"])
    return RedirectResponse(f"/#token={token}")


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
async def upload_document(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
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
        "user_id": user["id"],
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
async def paste_document(req: PasteRequest, user: dict = Depends(get_current_user)):
    if not req.content.strip():
        raise HTTPException(400, "文章内容不能为空")

    doc_id = uuid.uuid4().hex[:12]
    documents = _read_json(DOCUMENTS_FILE, [])
    record = {
        "id": doc_id,
        "user_id": user["id"],
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
async def fetch_url_document(req: UrlFetchRequest, user: dict = Depends(get_current_user)):
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
        "user_id": user["id"],
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
async def list_documents(user: dict = Depends(get_current_user)):
    documents = _read_json(DOCUMENTS_FILE, [])
    return [d for d in documents if d.get("user_id") == user["id"]]


# ---------- AI 调用(多服务商：DeepSeek / OpenAI / Claude / Gemini，用各自用户自己填的 key) ----------

PROVIDER_CONFIG = {
    "deepseek": {"label": "DeepSeek", "kind": "openai", "url": "https://api.deepseek.com/chat/completions", "model": "deepseek-chat"},
    "openai": {"label": "OpenAI", "kind": "openai", "url": "https://api.openai.com/v1/chat/completions", "model": "gpt-4o-mini"},
    "claude": {"label": "Claude (Anthropic)", "kind": "claude", "model": "claude-3-5-haiku-20241022"},
    "gemini": {"label": "Gemini (Google)", "kind": "gemini", "model": "gemini-1.5-flash"},
}

# 每百万 token 的价格(美元)，按写这段代码时各家官网公布的价格粗略估算，仅供参考——
# 实际计费以服务商账单为准，价格会变，这里不会自动跟着更新。
PROVIDER_PRICING = {
    "deepseek": {"input": 0.27, "output": 1.10},
    "openai": {"input": 0.15, "output": 0.60},
    "claude": {"input": 0.80, "output": 4.00},
    "gemini": {"input": 0.075, "output": 0.30},
}


def _normalize_month_usage(month_usage):
    # 兼容改版前的旧格式(以前 month_usage 直接是一个调用次数的数字)
    if isinstance(month_usage, (int, float)):
        return {"calls": month_usage, "cost_usd": 0.0}
    return month_usage


def record_api_call(user_id: str, provider: str = "", input_tokens: int = 0, output_tokens: int = 0):
    usage = _read_json(USAGE_FILE, {})
    month_key = datetime.now().strftime("%Y-%m")
    user_usage = usage.setdefault(user_id, {})
    month_usage = _normalize_month_usage(user_usage.get(month_key, {}))
    month_usage["calls"] = month_usage.get("calls", 0) + 1
    rates = PROVIDER_PRICING.get(provider)
    if rates:
        cost = (input_tokens / 1_000_000) * rates["input"] + (output_tokens / 1_000_000) * rates["output"]
        month_usage["cost_usd"] = month_usage.get("cost_usd", 0.0) + cost
    user_usage[month_key] = month_usage
    _write_json(USAGE_FILE, usage)


@app.get("/api/usage")
async def get_usage(user: dict = Depends(get_current_user)):
    usage = _read_json(USAGE_FILE, {})
    month_key = datetime.now().strftime("%Y-%m")
    month_usage = _normalize_month_usage(usage.get(user["id"], {}).get(month_key, {}))
    return {
        "month": month_key,
        "count": month_usage.get("calls", 0),
        "cost_usd": round(month_usage.get("cost_usd", 0.0), 4),
    }


async def _call_openai_compatible(url: str, model: str, api_key: str, prompt: str, json_mode: bool):
    payload = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers={"Authorization": f"Bearer {api_key}"}, json=payload)
    if resp.status_code != 200:
        raise HTTPException(502, f"AI 接口调用失败: {resp.text}")
    data = resp.json()
    usage = data.get("usage", {})
    return data["choices"][0]["message"]["content"], usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)


async def _call_claude(api_key: str, prompt: str, json_mode: bool):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": PROVIDER_CONFIG["claude"]["model"],
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"AI 接口调用失败(Claude): {resp.text}")
    data = resp.json()
    usage = data.get("usage", {})
    try:
        return data["content"][0]["text"], usage.get("input_tokens", 0), usage.get("output_tokens", 0)
    except (KeyError, IndexError):
        raise HTTPException(502, f"Claude 返回格式异常: {data}")


async def _call_gemini(api_key: str, prompt: str, json_mode: bool):
    model = PROVIDER_CONFIG["gemini"]["model"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json={"contents": [{"parts": [{"text": prompt}]}]})
    if resp.status_code != 200:
        raise HTTPException(502, f"AI 接口调用失败(Gemini): {resp.text}")
    data = resp.json()
    usage = data.get("usageMetadata", {})
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return text, usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0)
    except (KeyError, IndexError):
        raise HTTPException(502, f"Gemini 返回格式异常: {data}")


async def call_ai(prompt: str, provider: str, api_key: str, user_id: str, json_mode: bool = False) -> str:
    if not api_key:
        raise HTTPException(400, "还没有配置 AI API Key，先去设置里填一下")
    cfg = PROVIDER_CONFIG.get(provider)
    if not cfg:
        raise HTTPException(400, f"不支持的 AI 服务商: {provider}")

    if cfg["kind"] == "openai":
        text, in_tok, out_tok = await _call_openai_compatible(cfg["url"], cfg["model"], api_key, prompt, json_mode)
    elif cfg["kind"] == "claude":
        text, in_tok, out_tok = await _call_claude(api_key, prompt, json_mode)
    elif cfg["kind"] == "gemini":
        text, in_tok, out_tok = await _call_gemini(api_key, prompt, json_mode)
    else:
        raise HTTPException(500, "AI 服务商配置错误")

    record_api_call(user_id, provider, in_tok, out_tok)
    return text


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
async def analyze_selection(req: AnalyzeRequest, user: dict = Depends(get_current_user)):
    provider = user.get("ai_provider", "deepseek")
    api_key = user.get("ai_api_keys", {}).get(provider, "")

    if req.mode == "word":
        raw = await call_ai(build_word_prompt(req.text, req.context), provider, api_key, user["id"], json_mode=True)
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

    explanation = await call_ai(build_passage_prompt(req.text), provider, api_key, user["id"])
    return AnalyzeResponse(mode="passage", explanation=explanation)


# ---------- AI 文章推荐(拉 RSS 标题 + AI 按难度/话题筛选打标签) ----------

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

_recommend_cache = {}  # user_id -> {"data": [...], "ts": datetime}
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
async def get_recommendations(refresh: bool = False, user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    cache_entry = _recommend_cache.get(user["id"])
    if not refresh and cache_entry:
        age = (now - cache_entry["ts"]).total_seconds()
        if age < RECOMMEND_CACHE_SECONDS:
            return cache_entry["data"]

    items = await asyncio.to_thread(fetch_headlines)
    if not items:
        raise HTTPException(502, "没能拉到新闻列表，可能是网络问题或者 RSS 源暂时不可用")

    provider = user.get("ai_provider", "deepseek")
    api_key = user.get("ai_api_keys", {}).get(provider, "")
    raw = await call_ai(build_recommend_prompt(items), provider, api_key, user["id"], json_mode=True)
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

    _recommend_cache[user["id"]] = {"data": results, "ts": now}
    return results


# ---------- 设置(AI 服务商 + key、Google Sheets 同步开关) ----------

def mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "..." + key[-4:]


@app.get("/api/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    keys = user.get("ai_api_keys", {})
    return {
        "name": user.get("name", ""),
        "is_owner": user.get("is_owner", False),
        "has_password": bool(user.get("password_hash")),
        "ai_provider": user.get("ai_provider", "deepseek"),
        "ai_key_status": {
            k: {"has_key": bool(keys.get(k)), "masked": mask_key(keys.get(k, ""))}
            for k in PROVIDER_CONFIG
        },
        "sheets_sync_enabled": user.get("sheets_sync_enabled", False),
        "providers": [{"value": k, "label": v["label"]} for k, v in PROVIDER_CONFIG.items()],
    }


class SettingsRequest(BaseModel):
    ai_provider: str
    ai_api_key: str = ""  # 留空表示不修改这个服务商已保存的 key
    sheets_sync_enabled: bool = False


@app.post("/api/settings")
async def update_settings(req: SettingsRequest, user: dict = Depends(get_current_user)):
    if req.ai_provider not in PROVIDER_CONFIG:
        raise HTTPException(400, "不支持的 AI 服务商")

    users = _read_json(USERS_FILE, [])
    for u in users:
        if u["id"] == user["id"]:
            u["ai_provider"] = req.ai_provider
            if req.ai_api_key:
                keys = u.setdefault("ai_api_keys", {})
                keys[req.ai_provider] = req.ai_api_key
            if u.get("is_owner"):
                u["sheets_sync_enabled"] = req.sheets_sync_enabled
    _write_json(USERS_FILE, users)
    return {"ok": True}


# ---------- 保存生词 / 句子笔记(本地 + 可选 Google Sheet 同步，仅限主账号) ----------

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
async def save_entry(req: SaveRequest, user: dict = Depends(get_current_user)):
    today = datetime.now().strftime("%Y-%m-%d")
    now_iso = datetime.now(timezone.utc).isoformat()
    should_sync = bool(user.get("is_owner")) and bool(user.get("sheets_sync_enabled"))

    if req.mode == "word":
        vocab = _read_json(VOCAB_FILE, [])
        existing = next(
            (
                v for v in vocab
                if v.get("user_id") == user["id"] and v.get("word", "").strip().lower() == req.text.strip().lower()
            ),
            None,
        )
        if existing:
            return {"record": existing, "sheet_synced": False, "duplicate": True}

        record = {
            "id": uuid.uuid4().hex[:12],
            "user_id": user["id"],
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
        synced = False
        if should_sync:
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
            "user_id": user["id"],
            "sentence": req.text,
            "analysis": req.explanation,
            "source_doc": req.source_doc,
            "date": today,
            "added_at": now_iso,
        }
        notes.append(record)
        _write_json(SENTENCE_NOTES_FILE, notes)
        synced = False
        if should_sync:
            synced = await push_to_sheet({
                "type": "sentence",
                "sentence": req.text,
                "analysis": req.explanation,
                "source": req.source_doc,
                "date": today,
            })
        return {"record": record, "sheet_synced": synced, "duplicate": False}


@app.get("/api/vocab")
async def list_vocab(user: dict = Depends(get_current_user)):
    vocab = _read_json(VOCAB_FILE, [])
    return [v for v in vocab if v.get("user_id") == user["id"]]


@app.get("/api/sentence_notes")
async def list_sentence_notes(user: dict = Depends(get_current_user)):
    notes = _read_json(SENTENCE_NOTES_FILE, [])
    return [n for n in notes if n.get("user_id") == user["id"]]


@app.delete("/api/vocab/{item_id}")
async def delete_vocab(item_id: str, user: dict = Depends(get_current_user)):
    vocab = _read_json(VOCAB_FILE, [])
    target = next((v for v in vocab if v.get("id") == item_id), None)
    if not target or target.get("user_id") != user["id"]:
        raise HTTPException(404, "没找到这条生词记录")
    remaining = [v for v in vocab if v.get("id") != item_id]
    _write_json(VOCAB_FILE, remaining)
    return {"ok": True}


@app.delete("/api/sentence_notes/{item_id}")
async def delete_sentence_note(item_id: str, user: dict = Depends(get_current_user)):
    notes = _read_json(SENTENCE_NOTES_FILE, [])
    target = next((n for n in notes if n.get("id") == item_id), None)
    if not target or target.get("user_id") != user["id"]:
        raise HTTPException(404, "没找到这条句子笔记")
    remaining = [n for n in notes if n.get("id") != item_id]
    _write_json(SENTENCE_NOTES_FILE, remaining)
    return {"ok": True}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
