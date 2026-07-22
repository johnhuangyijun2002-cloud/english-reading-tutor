FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/

WORKDIR /app/backend
# --proxy-headers 让 uvicorn 信任 Railway 边缘代理转发的 X-Forwarded-Proto，
# 不然 request.base_url 拿到的协议永远是 http，Google OAuth 的 redirect_uri
# 就会跟 Google Cloud Console 里注册的 https 地址对不上，登录直接被拒。
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
