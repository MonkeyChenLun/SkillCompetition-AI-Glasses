# -*- coding: utf-8 -*-
"""
check_api.py —— DashScope API 自检脚本
用法（用 glasses 环境，不要另装）：
    conda run -n glasses python check_api.py

依次检查：.env 读取 → Key 鉴权 → omni 模型可用性 → 给出下一步动作。
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"

# ---- 1. 读取 .env ----
if not ENV_FILE.exists():
    print("[X] 找不到 .env，请先复制 .env.example 为 .env 并填入 Key")
    sys.exit(1)
for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

KEY = os.getenv("DASHSCOPE_API_KEY", "")
BASE = os.getenv("DASHSCOPE_COMPAT_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
MODEL = os.getenv("QWEN_OMNI_MODEL", "qwen3.5-omni-flash")
FALLBACKS = [m.strip() for m in os.getenv("QWEN_OMNI_FALLBACKS", "").split(",") if m.strip()]

print("=" * 62)
print(f"endpoint : {BASE}")
print(f"api key  : {KEY[:10]}... (长度 {len(KEY)})")
print(f"omni 模型: {MODEL}  备用: {FALLBACKS or '无'}")
print("=" * 62)


def request(path, payload=None, timeout=60):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="POST" if data else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
            err = body.get("error", {})
            return e.code, None, f"{err.get('code') or err.get('type')}: {err.get('message')}"
        except Exception:
            return e.code, None, "无法解析的错误响应"
    except Exception as e:
        return 0, None, f"{type(e).__name__}: {e}"


# ---- 2. 鉴权检查 ----
code, body, err = request("/models", timeout=30)
if code == 200:
    print(f"[OK] Key 鉴权通过，账号可见 {len(body.get('data', []))} 个模型")
else:
    print(f"[X] Key 鉴权失败 HTTP {code} -> {err}")
    print("\n下一步：确认 Key 没有复制错、没有过期，然后重新运行本脚本")
    sys.exit(1)

# ---- 3. omni 模型检查 ----
print("-" * 62)
usable = []
for m in [MODEL] + FALLBACKS:
    code, body, err = request(
        "/chat/completions",
        {
            "model": m,
            "messages": [{"role": "user", "content": "只回复两个字：正常"}],
            "modalities": ["text"],
            "max_tokens": 16,
            "stream": False,
        },
    )
    if code == 200:
        txt = (body["choices"][0]["message"].get("content") or "").strip()
        print(f"[OK] {m:26s} 返回：{txt!r}")
        usable.append(m)
    else:
        print(f"[X ] {m:26s} HTTP {code}  {err}")

# ---- 4. 结论 ----
print("-" * 62)
if usable:
    print(f"[结论] 可用模型：{usable}")
    if MODEL not in usable:
        print(f"[建议] 把 .env 里的 QWEN_OMNI_MODEL 改成 {usable[0]} 即可直接跑通")
    else:
        print("[结论] 配置正常，可以直接启动后端")
    sys.exit(0)

print("[结论] Key 有效，但没有任何 omni 模型可调用。这是账号权限/额度问题，代码改不了。")
print("""
下一步（按顺序做，3 分钟）：
  1. 打开 https://bailian.console.aliyun.com  → 用这个 Key 所属的账号登录
  2. 左侧「模型广场」→ 搜 qwen3.5-omni-flash → 点「立即开通」
  3. 右上角「费用与成本」确认没有欠费；新账号先领免费额度
  4. 如果这个 Key 属于「业务空间」，进业务空间确认该空间已开通模型
  5. 回到这里重新运行：conda run -n glasses python check_api.py
""")
sys.exit(2)
