"""给朋友生成一个邀请码。用法：python create_user.py "朋友的名字" """
import json
import secrets
import sys
import uuid
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USERS_FILE = DATA_DIR / "users.json"


def main():
    if len(sys.argv) < 2:
        print('用法: python create_user.py "朋友的名字"')
        sys.exit(1)
    name = sys.argv[1]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    users = json.loads(USERS_FILE.read_text(encoding="utf-8")) if USERS_FILE.exists() else []
    is_first_user = len(users) == 0

    invite_code = secrets.token_hex(4)
    user = {
        "id": "u_" + uuid.uuid4().hex[:10],
        "name": name,
        "invite_code": invite_code,
        "is_owner": is_first_user,  # 第一个建的账号自动是主账号(唯一能开 Google Sheets 同步的账号)
        "ai_provider": "deepseek",
        "ai_api_keys": {},
        "sheets_sync_enabled": False,
    }
    users.append(user)
    USERS_FILE.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"已创建用户「{name}」{'（主账号）' if is_first_user else ''}")
    print(f"邀请码：{invite_code}")
    if is_first_user:
        print("这是第一个账号，自动设为主账号，记好这个邀请码，这是你自己登录用的。")
    else:
        print("把这个邀请码发给对方，打开网站后在登录框里输入即可。")
    print("登录后要去设置(⚙)里填自己的 AI API Key，才能用划词解析、AI 推荐这些功能。")


if __name__ == "__main__":
    main()
