import { NextResponse } from "next/server";

const ANALYSIS_PROMPT = `你是一位浙江大学软件工程课程的助教。请分析下面这道软工客观题：

【题目】{topic}
【选项】{options}
【正确答案】{answer}

请用中文回复，控制在200字以内，结构如下：
1. 考点：用一句话说明这题考什么知识点（中英术语都给出）
2. 解析：逐个选项说明对/错的原因
3. 要点：一句话记忆技巧或易错提醒`;

export async function POST(request: Request) {
  let body: { topic?: string; options?: string[]; answer?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }

  const topic = body.topic || "";
  const options = Array.isArray(body.options) ? body.options : [];
  const answer = body.answer || "";
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!topic) return NextResponse.json({ error: "缺少题目内容" }, { status: 400 });
  if (!apiKey) {
    return NextResponse.json({
      error: "线上 AI 分析未配置 ANTHROPIC_API_KEY；刷题、错题、收藏和笔记功能可正常使用。",
    });
  }

  const payload = {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 600,
    temperature: 0.3,
    system: "你是浙大软件工程课程助教，用简洁中文分析客观题，控制在200字以内。",
    messages: [
      {
        role: "user",
        content: ANALYSIS_PROMPT.replace("{topic}", topic)
          .replace("{options}", options.join("\n"))
          .replace("{answer}", answer),
      },
    ],
  };

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: `AI 服务返回错误：${JSON.stringify(data).slice(0, 300)}` }, { status: response.status });
    }
    const analysis = Array.isArray(data.content)
      ? data.content.filter((block: { type?: string }) => block.type === "text").map((block: { text?: string }) => block.text || "").join("")
      : "";
    return NextResponse.json({ analysis: analysis || "AI 未返回文本内容" });
  } catch (error) {
    return NextResponse.json({ error: `AI 分析请求失败：${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
