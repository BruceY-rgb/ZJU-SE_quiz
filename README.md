# ZJU-SE_quiz

ZJU 软件工程课程刷题工作台。当前分支已从单页 HTML 升级为本地优先的 Next.js WebApp。

## 功能

- 全部题、单章、章节范围、错题、收藏、今日复习多种刷题模式
- IndexedDB 本地持久化：答题记录、错题状态、收藏、个人笔记、题目修订
- 本地文件数据库：开发环境会同步写入 `.quiz-data/local-store.json`，用于脱离浏览器缓存的持久备份
- 每轮刷题历史记录和题目级答题历史
- 题目详情中支持笔记、收藏、本地编辑题干/选项/答案/解析
- 支持导入/导出个人学习数据
- `/legacy.html` 保留旧版页面作为回退入口

## 本地数据

运行 `npm run dev` 时，个人学习数据会同时保存在两个位置：

- 浏览器 IndexedDB：负责页面即时读写。
- `.quiz-data/local-store.json`：Next.js 本地 API 写入的文件数据库，已加入 `.gitignore`，不会提交到仓库。

如果部署到 Vercel，文件写入不适合作为长期数据库；线上云同步需要再接入 Postgres、KV 或其他托管存储。

## 开发

```bash
npm install
npm run dev
```

默认访问 `http://localhost:3000`。

## 验证

```bash
npm run typecheck
npm run build
```
