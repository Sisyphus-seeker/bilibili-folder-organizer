# bilibili-folder-organizer
使用deepseek自动整理B站文件夹的脚本
# B站 AI 收藏夹自动细化整理 (DeepSeek版)

一个 Tampermonkey 油猴脚本，利用 DeepSeek 大模型自动将 B 站收藏夹视频分类到已有或新建的收藏夹，支持指定数量和分批处理。

## ✨ 功能
- 自动获取当前收藏夹的所有视频
- 智能匹配已有收藏夹，必要时新建分类
- 支持用户自定义规则（如“前50个”或“编程相关单独分类”）
- 自动分批处理大量视频（每批 50 个），避免 API 超限
- 实时显示抓取和整理进度

## 🚀 安装与配置
1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展。
2. 点击 [此处](bilibili-ai-folder-organizer.user.js) 安装脚本（或将 `.user.js` 文件拖入 Tampermonkey 管理面板）。
3. 在脚本代码中，将 `API_KEY` 替换为自己的 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。
4. 打开 B 站任意收藏夹页面（如 `space.bilibili.com/xxx/favlist?fid=xxx`），右侧会出现操作面板。

## 📖 使用
- 在文本框中输入规则（例如 `前100个`、`把编程相关的单独分一类`）。
- 点击 **一键AI自动整理收藏夹**，脚本将自动完成分类和移动。

## ⚙️ 配置
可在脚本顶部修改：
- `BATCH_SIZE`：每批处理的视频数量（默认 50）
- `MAX_TOKENS`：AI 输出长度上限（默认 8192）
- `PROGRESS_STEP`：抓取时进度显示间隔（默认 10）

## ⚠️ 注意
- 请确保 B 站已登录，且脚本有权访问 B 站 API。
- 整理操作会移动视频，建议先备份或小范围测试。

## 📦 版本历史
- v3.1：增加抓取与整理进度显示，支持分批处理。
- v3.0：自动分批，解决 AI 超时问题。

## 📄 许可证
MIT
