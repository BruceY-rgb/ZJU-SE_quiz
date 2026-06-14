import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler


ANALYSIS_PROMPT = """你是一位浙江大学软件工程课程的助教。请分析下面这道软工客观题：

【题目】{topic}
【选项】{options}
【正确答案】{answer}

请用中文回复，控制在200字以内，结构如下：
1. 考点：用一句话说明这题考什么知识点（中英术语都给出）
2. 解析：逐个选项说明对/错的原因
3. 要点：一句话记忆技巧或易错提醒"""


def json_response(handler, status, data):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        json_response(self, 200, {"ok": True})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except json.JSONDecodeError:
            json_response(self, 400, {"error": "请求体不是有效 JSON"})
            return

        topic = body.get("topic", "")
        options = body.get("options", [])
        answer = body.get("answer", "")
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")

        if not topic:
            json_response(self, 400, {"error": "缺少题目内容"})
            return
        if not api_key:
            json_response(self, 200, {"error": "线上 AI 分析未配置 ANTHROPIC_API_KEY；刷题、错题和收藏功能可正常使用。"})
            return

        payload = {
            "model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            "max_tokens": 600,
            "temperature": 0.3,
            "system": "你是浙大软件工程课程助教，用简洁中文分析客观题，控制在200字以内。",
            "messages": [
                {
                    "role": "user",
                    "content": ANALYSIS_PROMPT.format(
                        topic=topic,
                        options="\n".join(str(o) for o in options),
                        answer=answer,
                    ),
                }
            ],
        }
        request = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            json_response(self, exc.code, {"error": "AI 服务返回错误：" + detail[:300]})
            return
        except Exception as exc:
            json_response(self, 500, {"error": "AI 分析请求失败：" + str(exc)})
            return

        text = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")
        json_response(self, 200, {"analysis": text or "AI 未返回文本内容"})
