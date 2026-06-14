#!/usr/bin/env python3
"""SoftEng Quiz AI Server — local backend for question analysis via Claude API."""

import json, os, re, sys
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


def analyze_with_claude(topic, options, answer):
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        # Try reading from common locations
        for p in ["~/.anthropic/api_key", "~/.claude.json", ".env"]:
            pp = os.path.expanduser(p)
            if os.path.exists(pp):
                try:
                    with open(pp) as f:
                        data = json.load(f) if p.endswith(".json") else {}
                    api_key = data.get("api_key", "") if isinstance(data, dict) else f.read().strip()
                    if api_key: break
                except: pass
    if not api_key:
        return "错误：请设置 ANTHROPIC_API_KEY 环境变量"

    client = anthropic.Anthropic(api_key=api_key)
    opts_text = "\n".join(o for o in options)

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        temperature=0.3,
        system="你是浙大软件工程课程助教，用简洁中文分析客观题，控制在200字以内。",
        messages=[{"role": "user", "content": ANALYSIS_PROMPT.format(
            topic=topic, options=opts_text, answer=answer
        )}]
    )
    # Extract text from response (handle thinking blocks)
    for block in message.content:
        if hasattr(block, 'text') and block.type == 'text':
            return block.text
    return str(message.content)


class AIHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/analyze":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            topic = body.get("topic", "")
            options = body.get("options", [])
            answer = body.get("answer", "")

            if not topic:
                self._json_resp(400, {"error": "missing topic"})
                return

            try:
                result = analyze_with_claude(topic, options, answer)
                self._json_resp(200, {"analysis": result})
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
