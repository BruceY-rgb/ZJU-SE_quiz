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

        default_system = "你是浙大软件工程课程助教，用准确、有条理的中文讲解客观题，关键术语中英并给，禁止使用粗体、斜体和 emoji。"

        provider = body.get("provider", "anthropic")
        raw_messages = body.get("messages")
        max_tokens = min(int(body.get("max_tokens", 1500) or 1500), 4096)

        if isinstance(raw_messages, list) and raw_messages:
            # New multi-turn Q&A path
            messages = [
                {"role": m.get("role", "user"), "content": str(m.get("content", ""))}
                for m in raw_messages if m.get("content")
            ]
            system = body.get("system") or default_system
        else:
            # Legacy {topic, options, answer} path (Anthropic only)
            provider = "anthropic"
            topic = body.get("topic", "")
            if not topic:
                json_response(self, 400, {"error": "缺少题目内容或对话消息"})
                return
            system = default_system
            max_tokens = 600
            messages = [{
                "role": "user",
                "content": ANALYSIS_PROMPT.format(
                    topic=topic,
                    options="\n".join(str(o) for o in body.get("options", [])),
                    answer=body.get("answer", ""),
                ),
            }]

        if provider == "deepseek":
            api_key = os.environ.get("DEEPSEEK_API_KEY", "")
            if not api_key:
                json_response(self, 200, {"error": "线上 AI 未配置 DEEPSEEK_API_KEY。可在前端“⚙ AI 设置”选 DeepSeek 并填入你自己的 Key（浏览器直连），刷题/错题/收藏不受影响。"})
                return
            model = body.get("model") or os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "stream": False,
                "messages": [{"role": "system", "content": system}] + messages,
            }
            if model != "deepseek-reasoner":
                payload["temperature"] = 0.4
            url = "https://api.deepseek.com/chat/completions"
            headers = {"Content-Type": "application/json", "Authorization": "Bearer " + api_key}
        else:
            api_key = os.environ.get("ANTHROPIC_API_KEY", "")
            if not api_key:
                json_response(self, 200, {"error": "线上 AI 未配置 ANTHROPIC_API_KEY。可在前端“⚙ AI 设置”填入你自己的 Key（浏览器直连），刷题/错题/收藏不受影响。"})
                return
            model = body.get("model") or os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": 0.4,
                "system": system,
                "messages": messages,
            }
            url = "https://api.anthropic.com/v1/messages"
            headers = {
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }

        request = urllib.request.Request(
            url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers, method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            json_response(self, exc.code, {"error": "AI 服务返回错误：" + detail[:300]})
            return
        except Exception as exc:
            json_response(self, 500, {"error": "AI 分析请求失败：" + str(exc)})
            return

        if provider == "deepseek":
            choices = data.get("choices") or []
            text = choices[0].get("message", {}).get("content", "") if choices else ""
        else:
            text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        text = text or "AI 未返回文本内容"
        json_response(self, 200, {"reply": text, "analysis": text})
