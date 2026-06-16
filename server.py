#!/usr/bin/env python3
"""SoftEng Quiz AI Server — local backend for question analysis via Claude API."""

import json, os, re, sys
import urllib.request, urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

ANALYSIS_PROMPT = """你是一位浙江大学软件工程课程的助教。请分析下面这道软工客观题：

【题目】{topic}
【选项】{options}
【正确答案】{answer}

请用中文回复，控制在200字以内，结构如下：
1. 考点：用一句话说明这题考什么知识点（中英术语都给出）
2. 解析：逐个选项说明对/错的原因
3. 要点：一句话记忆技巧或易错提醒"""


DEFAULT_SYSTEM = "你是浙大软件工程课程助教，用准确、有条理的中文讲解客观题，关键术语中英并给，禁止使用粗体、斜体和 emoji。"


def get_api_key():
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        for p in ["~/.anthropic/api_key", "~/.claude.json", ".env"]:
            pp = os.path.expanduser(p)
            if os.path.exists(pp):
                try:
                    with open(pp) as f:
                        data = json.load(f) if p.endswith(".json") else {}
                    api_key = data.get("api_key", "") if isinstance(data, dict) else f.read().strip()
                    if api_key:
                        break
                except Exception:
                    pass
    return api_key


def chat_with_claude(system, messages, model=None, max_tokens=1500):
    """Generic multi-turn call. `messages` is a list of {role, content}."""
    import anthropic
    api_key = get_api_key()
    if not api_key:
        return "错误：请设置 ANTHROPIC_API_KEY 环境变量"

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=model or os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
        max_tokens=max_tokens,
        temperature=0.4,
        system=system or DEFAULT_SYSTEM,
        messages=messages,
    )
    return "".join(
        b.text for b in message.content if getattr(b, "type", "") == "text" and hasattr(b, "text")
    ) or str(message.content)


def chat_with_deepseek(system, messages, model=None, max_tokens=1500):
    """DeepSeek (OpenAI-compatible). `messages` is user/assistant turns; system prepended as a message."""
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        return "错误：请设置 DEEPSEEK_API_KEY 环境变量"

    model = model or os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
    oa_messages = [{"role": "system", "content": system or DEFAULT_SYSTEM}] + messages
    payload = {"model": model, "messages": oa_messages, "max_tokens": max_tokens, "stream": False}
    if model != "deepseek-reasoner":
        payload["temperature"] = 0.4
    request = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    choices = data.get("choices") or []
    if choices:
        return choices[0].get("message", {}).get("content", "") or "AI 未返回文本内容"
    return "AI 未返回文本内容"


def analyze_with_claude(topic, options, answer):
    """Legacy single-shot analysis (kept for backward compatibility)."""
    prompt = ANALYSIS_PROMPT.format(topic=topic, options="\n".join(str(o) for o in options), answer=answer)
    return chat_with_claude(DEFAULT_SYSTEM, [{"role": "user", "content": prompt}], max_tokens=600)


class AIHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/analyze":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            messages = body.get("messages")
            model = body.get("model")
            provider = body.get("provider", "anthropic")
            max_tokens = min(int(body.get("max_tokens", 1500) or 1500), 4096)

            if provider == "deepseek" and not os.environ.get("DEEPSEEK_API_KEY"):
                self._json_resp(200, {"error": "后端未配置 DEEPSEEK_API_KEY。可在前端“⚙ AI 设置”选 DeepSeek 并填入你自己的 Key（浏览器直连），或设置环境变量后重启 server.py。"})
                return
            if provider != "deepseek" and not get_api_key():
                self._json_resp(200, {"error": "后端未配置 ANTHROPIC_API_KEY。可在前端“⚙ AI 设置”填入你自己的 Key（浏览器直连），或设置环境变量后重启 server.py。"})
                return

            try:
                if isinstance(messages, list) and messages:
                    # New multi-turn Q&A path
                    system = body.get("system", DEFAULT_SYSTEM)
                    norm = [{"role": m.get("role", "user"), "content": str(m.get("content", ""))}
                            for m in messages if m.get("content")]
                    if provider == "deepseek":
                        result = chat_with_deepseek(system, norm, model, max_tokens)
                    else:
                        result = chat_with_claude(system, norm, model, max_tokens)
                    self._json_resp(200, {"reply": result, "analysis": result})
                else:
                    # Legacy {topic, options, answer} path (Anthropic only)
                    topic = body.get("topic", "")
                    if not topic:
                        self._json_resp(400, {"error": "missing topic or messages"})
                        return
                    result = analyze_with_claude(topic, body.get("options", []), body.get("answer", ""))
                    self._json_resp(200, {"analysis": result, "reply": result})
            except Exception as e:
                self._json_resp(500, {"error": str(e)})
        else:
            self._json_resp(404, {"error": "not found"})

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self._json_resp(404, {"error": "not found"})
        else:
            super().do_GET()

    def _json_resp(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in str(args): print(f"[API] {args[0]}")
        else: super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    os.chdir(os.path.dirname(os.path.abspath(__file__)) if not os.getcwd().endswith("软工刷题")
            else os.getcwd())
    print(f"🚀 AI 刷题服务器启动: http://localhost:{port}")
    print("   按 Ctrl+C 停止")
    HTTPServer(("0.0.0.0", port), AIHandler).serve_forever()
