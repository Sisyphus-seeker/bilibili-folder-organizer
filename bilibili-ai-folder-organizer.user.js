// ==UserScript==
// @name         B站收藏夹AI自动细化整理 (DeepSeek版)
// @namespace    http://tampermonkey.net/
// @version      3.1.0
// @description  自动分批处理，抓取与整理进度逐级显示
// @author       修改版
// @match        https://space.bilibili.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // ================= 配置区 =================
    const API_KEY = 'sk-你的DeepSeek-API-Key'; // 替换为真实 Key
    const API_URL = 'https://api.deepseek.com/chat/completions';
    const MODEL_NAME = 'deepseek-chat';
    const BATCH_SIZE = 50;          // 每批处理的视频数量
    const MAX_TOKENS = 8192;
    const RETRY_LIMIT = 1;
    const PROGRESS_STEP = 10;       // 抓取时每多少条显示一次进度
    // ==========================================

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function resetButton(btn) {
        btn.innerText = '🤖 一键AI自动整理收藏夹';
        btn.disabled = false;
        btn.style.background = '';
        btn.onclick = startProcess;
    }

    function logStatus(msg) {
        console.log(msg);
        const logDiv = document.getElementById('ai-status-log');
        if (logDiv) {
            logDiv.innerHTML += `<div style="margin-top:4px;">➜ ${msg}</div>`;
            logDiv.scrollTop = logDiv.scrollHeight;
        }
    }

    function getBiliData() {
        const midMatch = document.cookie.match(/DedeUserID=([^;]+)/);
        const csrfMatch = document.cookie.match(/bili_jct=([^;]+)/);
        return { mid: midMatch ? midMatch[1] : '', csrf: csrfMatch ? csrfMatch[1] : '' };
    }

    function getSourceMediaId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('fid') || params.get('media_id') || params.get('id');
    }

    function buildFormData(obj) {
        return new URLSearchParams(obj).toString();
    }

    async function getMyFolders(biliData) {
        const url = `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${biliData.mid}`;
        const res = await fetch(url, { credentials: 'include' }).then(r => r.json());
        if (res.code === 0 && res.data && res.data.list) {
            const folderMap = {};
            res.data.list.forEach(f => {
                if (f.title !== '默认收藏夹') folderMap[f.title] = f.id;
            });
            return folderMap;
        }
        return {};
    }

    async function createFolder(title, biliData) {
        logStatus(`📁 正在新建收藏夹：【${title}】`);
        const url = 'https://api.bilibili.com/x/v3/fav/folder/add';
        const data = buildFormData({ title: title, privacy: 1, csrf: biliData.csrf });
        const res = await fetch(url, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data
        }).then(r => r.json());
        if (res.code === 0) return res.data.id;
        throw new Error(`新建失败: ${res.message}`);
    }

    async function moveVideos(sourceMediaId, tarMediaId, resourcesStr, biliData) {
        const url = 'https://api.bilibili.com/x/v3/fav/resource/move';
        const data = buildFormData({
            src_media_id: sourceMediaId, tar_media_id: tarMediaId, mid: biliData.mid, resources: resourcesStr, csrf: biliData.csrf
        });
        const res = await fetch(url, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data
        }).then(r => r.json());
        if (res.code !== 0) console.error("移动失败：", res.message);
    }

    function callDeepSeekAPI(messages) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: API_URL,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${API_KEY}`
                },
                data: JSON.stringify({
                    model: MODEL_NAME,
                    messages: messages,
                    temperature: 0.1,
                    max_tokens: MAX_TOKENS
                }),
                onload: function(response) {
                    if (response.status !== 200) {
                        reject(new Error(`API 请求失败: ${response.status} - ${response.responseText}`));
                        return;
                    }
                    try {
                        const result = JSON.parse(response.responseText);
                        resolve(result);
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: function(err) {
                    reject(new Error(`网络请求失败: ${err}`));
                }
            });
        });
    }

    function extractAndFixJSON(text) {
        let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch (e) {
            const match = cleaned.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*?\}/);
            if (match) {
                let candidate = match[0];
                try {
                    return JSON.parse(candidate);
                } catch (e2) {
                    candidate = candidate.replace(/\}\s*\{/g, '},{');
                    candidate = candidate.replace(/,\s*\}/g, '}');
                    try {
                        return JSON.parse(candidate);
                    } catch (e3) {
                        throw new Error(`无法解析 JSON: ${e3.message}`);
                    }
                }
            } else {
                throw new Error('未找到有效的 JSON 对象');
            }
        }
    }

    // 处理单批视频
    async function processBatch(batchVideos, existingFoldersMap, biliData, sourceMediaId, userRequirement, batchIndex, totalBatches) {
        logStatus(`🧩 处理第 ${batchIndex}/${totalBatches} 批（共 ${batchVideos.length} 个视频）...`);

        const folderNames = Object.keys(existingFoldersMap);
        const videoData = batchVideos.map(v => ({ id: v.id, type: v.type, title: v.title }));

        const customRuleText = userRequirement ? `\n\n【用户特殊需求】${userRequirement}` : '';
        const prompt = `你是一个文件整理专家。请将以下 B 站视频分类。
当前已有收藏夹：[ ${folderNames.length > 0 ? folderNames.join(', ') : '暂无'} ]
要求：
1. 优先匹配已有收藏夹名称，尽量使用它们。
2. 若某视频与所有已有收藏夹都不相关，才新建一个涵盖面广的分类。
3. 每个视频必须分配到某个分类。
4. 只处理这批视频，不要涉及其他。
${customRuleText}

输出 JSON，包含 "thoughts" 和 "categories" 字段。
示例：
{
  "thoughts": "...",
  "categories": {
    "已有收藏夹名": [{"id": 111, "type": 2}],
    "新分类名": [{"id": 222, "type": 2}]
  }
}

视频列表：
${JSON.stringify(videoData)}`;

        let lastError = null;
        for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
            try {
                const response = await callDeepSeekAPI([
                    { role: "system", content: "你是一个只输出合法 JSON 的助手，不添加任何额外文字。" },
                    { role: "user", content: prompt }
                ]);
                const content = response.choices[0].message.content;
                const result = extractAndFixJSON(content);

                if (!result.categories || Object.keys(result.categories).length === 0) {
                    throw new Error("AI 返回分类为空");
                }

                // 移动视频 – 逐个分类显示进度
                let movedCount = 0;
                const totalInBatch = batchVideos.length;
                for (const [categoryName, vids] of Object.entries(result.categories)) {
                    if (!vids || !Array.isArray(vids) || vids.length === 0) continue;
                    let folderId = existingFoldersMap[categoryName];
                    if (!folderId) {
                        folderId = await createFolder(categoryName, biliData);
                        existingFoldersMap[categoryName] = folderId;
                        await sleep(800);
                    }
                    logStatus(`🚚 移动分类 “${categoryName}” (${vids.length} 个视频)...`);
                    const resourcesStr = vids.map(v => `${v.id}:${v.type}`).join(',');
                    await moveVideos(sourceMediaId, folderId, resourcesStr, biliData);
                    movedCount += vids.length;
                    // 显示当前分类移动后的累计进度（可选）
                    logStatus(`   └─ 已移动 ${movedCount}/${totalInBatch} 个视频（此批）`);
                    await sleep(500);
                }
                logStatus(`✅ 第 ${batchIndex} 批完成，移动 ${movedCount} 个视频。`);
                return { success: true, movedCount };
            } catch (err) {
                lastError = err;
                logStatus(`⚠️ 第 ${batchIndex} 批尝试 ${attempt+1} 失败: ${err.message}`);
                if (attempt < RETRY_LIMIT) {
                    await sleep(2000);
                }
            }
        }
        logStatus(`❌ 第 ${batchIndex} 批最终失败: ${lastError.message}`);
        return { success: false, error: lastError.message };
    }

    async function startProcess() {
        const biliData = getBiliData();
        const btn = document.getElementById('ai-start-btn');
        const customPromptInput = document.getElementById('ai-custom-prompt');

        if (!biliData.mid || !biliData.csrf) {
            alert("请确保你在 B 站已登录！");
            return;
        }
        const sourceMediaId = getSourceMediaId();
        if (!sourceMediaId) {
            alert("未能识别当前页面的收藏夹 ID！");
            return;
        }
        if (API_KEY === 'sk-你的DeepSeek-API-Key') {
            alert('请先在脚本中配置 DeepSeek API Key！');
            return;
        }

        const userRequirement = customPromptInput.value.trim();

        btn.innerText = '🔄 整理中...';
        btn.disabled = true;
        btn.style.background = '#ccc';
        const logDiv = document.getElementById('ai-status-log');
        logDiv.innerHTML = '';

        try {
            // 1. 解析用户指定的总数量
            let maxVideos = Infinity;
            const quantityMatch = userRequirement.match(/(?:前|只整理|只处理|整理)\s*(\d+)\s*(?:个)?/i);
            if (quantityMatch) {
                maxVideos = parseInt(quantityMatch[1]);
                logStatus(`📌 用户指定只处理前 ${maxVideos} 个视频。`);
            } else {
                logStatus(`📌 未指定数量，将处理全部视频。`);
            }

            // 2. 获取当前所有已有收藏夹
            logStatus(`正在获取现有收藏夹...`);
            const existingFoldersMap = await getMyFolders(biliData);
            logStatus(`📦 已有 ${Object.keys(existingFoldersMap).length} 个收藏夹`);

            // 3. 抓取视频（并显示进度）
            logStatus(`开始抓取视频...`);
            let allVideos = [];
            let pn = 1;
            const ps = 20;
            let hasMore = true;
            let lastLoggedCount = 0;   // 用于控制进度输出频率

            while (hasMore && allVideos.length < maxVideos) {
                const listUrl = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${sourceMediaId}&pn=${pn}&ps=${ps}&platform=web`;
                try {
                    const res = await fetch(listUrl, { credentials: 'include' }).then(r => r.json());
                    if (res.code !== 0) break;
                    const videos = res.data?.medias || [];
                    if (videos.length) {
                        allVideos.push(...videos);
                        if (allVideos.length > maxVideos) allVideos = allVideos.slice(0, maxVideos);
                        // 每增加 PROGRESS_STEP 个或达到上限时显示一次进度
                        const currentCount = allVideos.length;
                        if (currentCount - lastLoggedCount >= PROGRESS_STEP || currentCount >= maxVideos) {
                            logStatus(`📥 已抓取第 ${currentCount} 个视频`);
                            lastLoggedCount = currentCount;
                        }
                    }
                    hasMore = res.data?.has_more ?? (videos.length === ps);
                    pn++;
                    await sleep(500);
                } catch (e) {
                    logStatus(`⚠️ 抓取异常: ${e.message}`);
                    break;
                }
            }
            logStatus(`🎉 共抓取 ${allVideos.length} 个视频。`);

            if (allVideos.length === 0) {
                logStatus("⚠️ 没有可处理的视频。");
                resetButton(btn);
                return;
            }

            // 4. 分批处理
            const total = allVideos.length;
            const batchSize = BATCH_SIZE;
            const batches = Math.ceil(total / batchSize);
            logStatus(`📦 分为 ${batches} 批处理（每批 ${batchSize} 个）`);

            let totalMoved = 0;
            let failedBatches = [];

            for (let i = 0; i < batches; i++) {
                const start = i * batchSize;
                const end = Math.min(start + batchSize, total);
                const batch = allVideos.slice(start, end);

                const result = await processBatch(
                    batch,
                    existingFoldersMap,
                    biliData,
                    sourceMediaId,
                    userRequirement,
                    i + 1,
                    batches
                );

                if (result.success) {
                    totalMoved += result.movedCount;
                } else {
                    failedBatches.push(i + 1);
                }
                if (i < batches - 1) await sleep(1500);
            }

            // 5. 总结
            if (failedBatches.length === 0) {
                logStatus(`🎉 全部整理完成！共移动 ${totalMoved} 个视频。`);
                btn.innerText = '✅ 全部完成，点我刷新';
                btn.style.background = '#4CAF50';
            } else {
                logStatus(`⚠️ 完成，但有 ${failedBatches.length} 批失败（第 ${failedBatches.join(', ')} 批），请检查日志。`);
                btn.innerText = '⚠️ 部分失败，点我重试';
                btn.style.background = '#FFA500';
            }
            btn.disabled = false;
            btn.onclick = () => window.location.reload();

        } catch (err) {
            logStatus(`❌ 发生错误: ${err.message}`);
            console.error(err);
            resetButton(btn);
        }
    }

    // UI
    function renderUI() {
        const wrap = document.createElement('div');
        wrap.style = `position:fixed;top:120px;right:20px;width:340px;background:#fff;z-index:99999;padding:16px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15);font-family:Arial,sans-serif;max-height:90vh;display:flex;flex-direction:column;`;
        wrap.innerHTML = `
            <h4 style="margin:0 0 10px 0;color:#fb7299;display:flex;align-items:center;gap:8px;">
                <span>📚</span> B站AI收藏整理 (DeepSeek)
                <span style="font-size:11px;color:#999;font-weight:normal;">v3.1 进度显示</span>
            </h4>
            <textarea id="ai-custom-prompt" placeholder="输入规则或数量（如“前100个”或“编程分类”）" style="width:100%;height:60px;margin-bottom:10px;padding:8px;border:1px solid #ddd;border-radius:6px;resize:vertical;font-size:13px;box-sizing:border-box;"></textarea>
            <button id="ai-start-btn" style="width:100%;padding:10px;font-size:14px;font-weight:bold;border:none;border-radius:6px;background:#fb7299;color:#fff;cursor:pointer;">🤖 一键AI自动整理收藏夹</button>
            <div id="ai-status-log" style="margin-top:10px;height:200px;overflow-y:auto;border:1px solid #eee;border-radius:6px;padding:8px;font-size:12px;background:#fafafa;flex-shrink:0;"></div>
        `;
        document.body.appendChild(wrap);
        document.getElementById('ai-start-btn').onclick = startProcess;
        const btn = document.getElementById('ai-start-btn');
        btn.onmouseover = () => { if (!btn.disabled) btn.style.background = '#e05a7a'; };
        btn.onmouseout = () => { if (!btn.disabled) btn.style.background = '#fb7299'; };
    }

    window.addEventListener('load', renderUI);
})();