// @ts-nocheck
/**
 * dsh-web-pets —— DSH Web 桌宠插件（浏览器侧，TS 源；tsdown 构建为
 * __ModuleLoader__.load bundle，见 tsdown.config.ts）
 *
 * 并入 dsh-web-ui 的 pet 界面：安装 dsh-web-ui（鲸鱼宠物 dsh-pet）后再装本
 * 插件，pet 设置区域出现「宠物选择」卡片，可在一只宠物间切换/调整：
 *   鲸鱼娘（上游 dsh-pet） / 豆豆（demo） / 雷米埃尔（remiel） / 自定义宠物
 * 任意时刻只有一只宠物显示（切换我们的宠物 → 自动关闭上游；切回鲸鱼 →
 * 我们的宠物完全隐藏，连召唤按钮都不出现）。
 *
 * 表面：
 * 1. 宠物选择器卡片：注册进 `web-ui.plugin.item` 槽位（与上游 dsh-pet 卡片
 *    同一位，order 150 紧随其后）。自包含读写 /api/web-pets/*；对上游鲸鱼
 *    的启停通过 `pet` 设置命名空间（`webUiSettings`/`settingsScope` 绑定器，
 *    'pet' 在 dsh-web-ui 家族桥接白名单内，可写 enabled）——不 fork 上游、
 *    不依赖上游内部 DOM/模块，上游更新时按「兼容性契约」降级。
 * 2. 全局悬浮桌宠：enabled && visible → 渲染（右下角，与鲸鱼同位）；
 *    enabled && !visible → 🐾 召唤按钮；!enabled → 完全不渲染。
 * 3. 右键菜单/设置面板：缩放、透明度、锁定、暂停动画、重置位置、更新与反馈。
 *
 * 首次加载防双宠：若检测到上游鲸鱼活跃且本插件 enabled 未被显式配置过，
 * 自动 set-enabled(false)（持久化），保持「只显示一只宠物」。
 *
 * 内置宠物素材（demo/remiel）以 data URI 内联（scripts/generate-art.mjs 生成
 * art.generated.ts）；自定义宠物仍走 /web-pets-assets/* 磁盘路由。
 *
 * @module dsh-web-pets/client
 */
import * as react from 'react'
import * as react_dom_client from 'react-dom/client'
import { PET_ART } from './art.generated'
import { PET_VERSION } from './version.generated'

		// ------------------------------------------------------------------
		// 样式（一次性注入）
		// ------------------------------------------------------------------
		const CSS_ID = "dsh-web-pets/style.css";
		if (typeof document !== "undefined" && !document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-pets";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				// 悬浮桌宠（right/bottom 由内联样式按快照/拖拽实时设置）
				".dwp-root{position:fixed;z-index:2147483000;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;user-select:none}",
				".dwp-pet{position:relative;cursor:grab;line-height:0;touch-action:none}",
				".dwp-pet.dragging{cursor:grabbing}",
				".dwp-pet img{height:auto;image-rendering:auto;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);background:transparent;transition:transform .15s}",
				".dwp-pet img:hover{transform:scale(1.04)}",
				".dwp-bubble{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);max-width:220px;padding:6px 10px;border-radius:10px;background:rgba(20,18,34,.92);color:#f4eefb;font-size:12px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 14px rgba(0,0,0,.35)}",
				".dwp-bubble::after{content:'';position:absolute;left:50%;top:100%;transform:translateX(-50%);border:6px solid transparent;border-top-color:rgba(20,18,34,.92)}",
				".dwp-menu{position:absolute;left:50%;bottom:calc(100% + 18px);transform:translateX(-50%);min-width:150px;padding:6px;border-radius:12px;background:rgba(24,22,38,.96);border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 32px rgba(0,0,0,.5)}",
				".dwp-menu-title{color:#8b84a0;font-size:11px;padding:2px 8px 6px}",
				".dwp-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:#efeaff;font-size:13px;text-align:left;cursor:pointer}",
				".dwp-menu-item:hover{background:rgba(255,255,255,.1)}",
				".dwp-menu-item.active{color:#b07ce8}",
				".dwp-menu-sep{height:1px;margin:6px 4px;background:rgba(255,255,255,.1)}",
				".dwp-menu-row{display:flex;align-items:center;gap:6px;padding:4px 8px}",
				".dwp-menu-row button{flex:1;padding:4px 0;border:0;border-radius:6px;background:rgba(255,255,255,.1);color:#efeaff;font-size:12px;cursor:pointer}",
				".dwp-menu-row button:hover{background:rgba(255,255,255,.2)}",
				".dwp-summon{position:fixed;right:24px;bottom:20px;z-index:2147483000;width:44px;height:44px;border:0;border-radius:50%;background:rgba(24,22,38,.92);color:#b07ce8;font-size:20px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.4)}",
				".dwp-summon:hover{transform:scale(1.08)}",
				// 宠物选择器卡片（dsh-web-ui pet 界面）
				".dwp-card{list-style:none;border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1));border-radius:10px;padding:12px 14px;margin:0;background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.03))}",
				".dwp-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary, #efeaff);margin:0 0 2px}",
				".dwp-card-desc{font-size:12px;color:var(--dsw-alias-label-tertiary, #8b84a0);margin:0 0 10px}",
				".dwp-card-section{font-size:11px;color:var(--dsw-alias-label-tertiary, #8b84a0);margin:8px 0 4px}",
				".dwp-card-pets{display:flex;flex-wrap:wrap;gap:6px}",
				".dwp-card-pet{border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-primary, #efeaff)}",
				".dwp-card-pet:hover{border-color:var(--dsw-alias-state-business-primary, #b07ce8)}",
				".dwp-card-pet.active{border-color:var(--dsw-alias-state-business-primary, #b07ce8);color:var(--dsw-alias-state-business-primary, #b07ce8)}",
				".dwp-card-pet:disabled{opacity:.5;cursor:default}",
				".dwp-card-row{display:flex;align-items:center;gap:8px;margin-top:8px}",
				".dwp-card-btn{border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-primary, #efeaff)}",
				".dwp-card-btn:hover{border-color:var(--dsw-alias-state-business-primary, #b07ce8)}",
				".dwp-card-size{font-size:12px;color:var(--dsw-alias-label-primary, #efeaff);min-width:52px;text-align:center;font-variant-numeric:tabular-nums}",
				".dwp-card-input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));border-radius:8px;padding:5px 10px;font-size:12px;color:var(--dsw-alias-label-primary, #efeaff);background:var(--dsw-specific-input-major, rgba(255,255,255,.06))}",
				".dwp-card-status{font-size:11px;color:var(--dsw-alias-label-tertiary, #8b84a0);margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
				".dwp-card-note{font-size:11px;color:var(--dsw-alias-state-warn-primary, #d9a441);margin-top:6px}",
				// 右键菜单扩展（缩放/透明度/锁定/暂停）
				".dwp-menu-sub{display:flex;flex-direction:column;gap:2px;padding:2px 4px 6px 22px}",
				".dwp-menu-opt{display:flex;align-items:center;gap:8px;width:100%;padding:4px 8px;border:0;border-radius:6px;background:transparent;color:#efeaff;font-size:12px;text-align:left;cursor:pointer}",
				".dwp-menu-opt:hover{background:rgba(255,255,255,.12)}",
				".dwp-menu-opt.on{color:#b07ce8;font-weight:600}",
				".dwp-menu-row .btn{flex:1;padding:4px 0;border:0;border-radius:6px;background:rgba(255,255,255,.1);color:#efeaff;font-size:12px;cursor:pointer}",
				".dwp-menu-row .btn:hover{background:rgba(255,255,255,.2)}",
				// 设置面板（悬浮层，左右分栏）
				".dwp-settings-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(8,15,39,.5);backdrop-filter:blur(3px)}",
				".dwp-settings{position:fixed;z-index:2147483001;top:50%;left:50%;transform:translate(-50%,-50%);width:780px;max-width:calc(100vw - 48px);height:min(600px,100vh - 48px);background:var(--dsw-alias-bg-layer-2, #17142a);border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));border-radius:18px;box-shadow:0 20px 56px rgba(0,0,0,.5);font-size:13px;color:var(--dsw-alias-label-primary, #efeaff);display:flex;flex-direction:row;overflow:hidden;user-select:none;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}",
				".dwp-settings-side{flex:none;width:180px;padding:18px 10px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box;border-right:1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1))}",
				".dwp-settings-title{font-size:15px;font-weight:600;padding:0 10px}",
				".dwp-settings-nav{display:flex;flex-direction:column;gap:4px}",
				".dwp-settings-tab{box-sizing:border-box;cursor:pointer;height:36px;color:var(--dsw-alias-label-primary, #efeaff);text-align:left;background:transparent;border:none;border-radius:10px;padding:0 12px;font-family:inherit;font-size:13px;display:flex;align-items:center}",
				".dwp-settings-tab:hover{background:rgba(255,255,255,.08)}",
				".dwp-settings-tab.on{background:rgba(176,124,232,.18);color:#b07ce8;font-weight:500}",
				".dwp-settings-pane{flex:1;min-width:0;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:14px}",
				".dwp-settings-section{font-size:11px;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary, #8b84a0);margin:2px 0 0;text-transform:uppercase}",
				".dwp-settings-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:34px}",
				".dwp-settings-row .lab{min-width:72px;flex:none;color:var(--dsw-alias-label-secondary, #8b84a0);white-space:nowrap}",
				".dwp-settings-row input[type=range]{flex:1;max-width:220px;min-width:110px;accent-color:#b07ce8;cursor:pointer}",
				".dwp-settings-row .val{width:48px;flex:none;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary, #8b84a0)}",
				".dwp-switch{position:relative;flex:none;width:36px;height:20px;border-radius:999px;background:rgba(113,130,166,.45);cursor:pointer;transition:background .15s}",
				".dwp-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s}",
				".dwp-switch.on{background:#b07ce8}",
				".dwp-switch.on::after{left:18px}",
				".dwp-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));background:rgba(255,255,255,.06);cursor:pointer;color:inherit;font-size:12px}",
				".dwp-btn:hover{background:rgba(255,255,255,.12)}",
				".dwp-btn.primary{background:#b07ce8;border-color:transparent;color:#fff}",
				".dwp-btn.primary:hover{background:#9a64d8}",
				".dwp-btn:disabled{opacity:.5;cursor:default}",
				// 更新气泡 / 更新卡片 / toast
				".dwp-upd-bubble{position:fixed;right:84px;bottom:30px;z-index:2147483100;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:rgba(24,22,38,.95);border:1px solid #b07ce8;color:#b07ce8;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);user-select:none;white-space:nowrap}",
				".dwp-upd-bubble .dot{width:7px;height:7px;border-radius:50%;background:#b07ce8;animation:dwpPulse 1.6s ease-in-out infinite}",
				"@keyframes dwpPulse{0%,100%{opacity:1}50%{opacity:.35}}",
				".dwp-upd-card{position:fixed;z-index:2147483001;top:50%;left:50%;transform:translate(-50%,-50%);width:min(430px,92vw);max-height:min(600px,86vh);overflow:auto;background:var(--dsw-alias-bg-layer-2, #17142a);border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));border-radius:14px;box-shadow:0 20px 56px rgba(0,0,0,.5);font-size:13px;color:var(--dsw-alias-label-primary, #efeaff);display:none;user-select:none;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}",
				".dwp-upd-card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1))}",
				".dwp-upd-card-title{font-weight:600;font-size:14px}",
				".dwp-upd-close{background:none;border:none;cursor:pointer;font-size:16px;color:var(--dsw-alias-label-tertiary, #8b84a0);padding:0 4px;line-height:1;border-radius:6px}",
				".dwp-upd-close:hover{background:rgba(255,255,255,.1)}",
				".dwp-upd-card-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px}",
				".dwp-upd-versions{display:flex;align-items:center;gap:10px;font-weight:600}",
				".dwp-upd-versions .old{color:var(--dsw-alias-label-tertiary, #8b84a0);text-decoration:line-through}",
				".dwp-upd-versions .arrow{color:var(--dsw-alias-label-tertiary, #8b84a0)}",
				".dwp-upd-versions .new{color:#b07ce8}",
				".dwp-upd-notes{background:rgba(176,124,232,.08);border:1px solid rgba(176,124,232,.2);border-radius:8px;padding:8px 10px;max-height:200px;overflow:auto;white-space:pre-wrap;color:var(--dsw-alias-label-secondary, #b9aed6);font-size:12px;line-height:1.5}",
				".dwp-upd-output{background:rgba(0,0,0,.55);color:#cfe3ff;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;border-radius:8px;padding:8px 10px;max-height:150px;overflow:auto;white-space:pre-wrap;display:none}",
				".dwp-upd-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1))}",
				".dwp-upd-hint{font-size:11px;color:var(--dsw-alias-label-tertiary, #8b84a0);line-height:1.5}",
				".dwp-toast{position:fixed;z-index:2147483100;left:50%;bottom:26px;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(13,25,59,.95);color:#e7ecf7;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.3);display:none;user-select:none;pointer-events:none;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;white-space:nowrap}",
			].join("");
			document.head.appendChild(tag);
		}

		// ------------------------------------------------------------------
		// 文案（zh / en）
		// ------------------------------------------------------------------
		const LOCALES = {
			zh: {
				"card.title": "宠物选择",
				"card.description": "在 dsh-web-ui 宠物入口切换/调整宠物（同时只显示一只）",
				"card.pet": "宠物（点击切换）",
				"card.size": "大小",
				"card.position": "位置",
				"card.right": "右",
				"card.bottom": "下",
				"card.name": "名称",
				"card.save": "保存",
				"card.namePlaceholder": "自定义名字（≤20 字符）",
				"card.mirror": "镜像",
				"card.mirrorX": "水平",
				"card.mirrorY": "垂直",
				"card.visible": "显示",
				"card.hidden": "隐藏",
				"card.status": "状态",
				"card.loading": "加载中…",
				"card.whale": "鲸鱼娘（上游 dsh-pet）",
				"card.whaleOff": "当前显示：上游鲸鱼宠物",
				"card.oursOff": "当前显示：本插件宠物",
				"card.none": "当前无宠物显示（请在下方选择）",
				"card.whaleFailed": "无法切换上游宠物（设置桥接不可用）",
				"card.autoOff": "检测到上游宠物活跃，已自动隐藏本插件宠物；在下方选择可切换",
				"settings.title": "桌宠设置",
				"settings.appearance": "外观",
				"settings.behavior": "行为",
				"settings.update": "更新",
				"settings.feedback": "反馈",
				"settings.scale": "缩放",
				"settings.opacity": "透明度",
				"settings.locked": "锁定位置",
				"settings.paused": "暂停动画",
				"settings.hidden": "隐藏桌宠",
				"settings.reset": "重置到右下角",
				"settings.domSignals": "DOM 增强信号（等待卡片/思考细分）",
				"settings.version": "当前版本",
				"settings.check": "检查更新",
				"settings.updating": "更新中…",
				"settings.autoCheck": "自动检查更新",
				"settings.noUpdate": "当前已是最新版本",
				"settings.hasUpdate": "发现新版本",
				"settings.checkFailed": "检查更新失败",
				"settings.notChecked": "尚未检查",
				"settings.linkOnly": "仅 monorepo link 安装支持一键更新",
				"settings.npmHint": "npm 安装：可一键 pnpm update 后重启 dsh web 生效。",
				"settings.tarballHint": "tarball/file 安装：请到 GitHub Release 下载新版本重新安装（不自动更新）。",
				"settings.repo": "仓库",
				"settings.feedbackBtn": "提交反馈",
				"settings.feedbackDesc": "遇到问题或有建议？欢迎反馈，帮助改善桌宠。",
				"settings.updateHint": "更新由你决定：桌宠只负责检测和提示。更新完成后重启 dsh web 生效。",
				"upd.bubble": "新版本",
				"upd.viewNotes": "查看更新内容",
				"upd.openRelease": "打开发布页",
				"upd.update": "更新",
				"upd.done": "更新成功，请重启 dsh web",
				"upd.failed": "更新失败，查看详情",
			},
			en: {
				"card.title": "Pet Picker",
				"card.description": "Switch/adjust pets in the dsh-web-ui pet entry (one pet at a time)",
				"card.pet": "Pet (click to switch)",
				"card.size": "Size",
				"card.position": "Position",
				"card.right": "Right",
				"card.bottom": "Bottom",
				"card.name": "Name",
				"card.save": "Save",
				"card.namePlaceholder": "Custom name (≤20 chars)",
				"card.mirror": "Mirror",
				"card.mirrorX": "H",
				"card.mirrorY": "V",
				"card.visible": "Show",
				"card.hidden": "Hide",
				"card.status": "Status",
				"card.loading": "Loading…",
				"card.whale": "Whale (upstream dsh-pet)",
				"card.whaleOff": "Current: upstream whale pet",
				"card.oursOff": "Current: this plugin's pet",
				"card.none": "No pet shown (pick one below)",
				"card.whaleFailed": "Cannot switch the upstream pet (settings bridge unavailable)",
				"card.autoOff": "Upstream pet detected; this plugin's pet auto-hidden. Pick below to switch.",
				"settings.title": "Pet Settings",
				"settings.appearance": "Appearance",
				"settings.behavior": "Behavior",
				"settings.update": "Update",
				"settings.feedback": "Feedback",
				"settings.scale": "Scale",
				"settings.opacity": "Opacity",
				"settings.locked": "Lock position",
				"settings.paused": "Pause animation",
				"settings.hidden": "Hide pet",
				"settings.reset": "Reset to bottom-right",
				"settings.domSignals": "DOM signals (waiting card / think detail)",
				"settings.version": "Version",
				"settings.check": "Check update",
				"settings.updating": "Updating…",
				"settings.autoCheck": "Auto-check updates",
				"settings.noUpdate": "Up to date",
				"settings.hasUpdate": "Update available",
				"settings.checkFailed": "Update check failed",
				"settings.notChecked": "Not checked yet",
				"settings.linkOnly": "One-click update needs a monorepo link install",
				"settings.npmHint": "npm install: one-click pnpm update, then restart dsh web.",
				"settings.tarballHint": "tarball/file install: download the new release from GitHub and reinstall (no auto-update).",
				"settings.repo": "Repository",
				"settings.feedbackBtn": "Submit feedback",
				"settings.feedbackDesc": "Found a problem or have a suggestion? Feedback is welcome.",
				"settings.updateHint": "Updates are your call: the pet only detects and notifies. Restart dsh web after updating.",
				"upd.bubble": "New version",
				"upd.viewNotes": "View release notes",
				"upd.openRelease": "Open release page",
				"upd.update": "Update",
				"upd.done": "Update succeeded, please restart dsh web",
				"upd.failed": "Update failed, see details",
			},
		};

		/** 读当前语言字典。 */
		function t(key) {
			const lang = (typeof navigator !== "undefined" && navigator.language) || "zh";
			const dict = String(lang).toLowerCase().startsWith("zh") ? LOCALES.zh : LOCALES.en;
			return dict[key] ?? LOCALES.zh[key] ?? key;
		}

		// ------------------------------------------------------------------
		// 宿主 API（同源 JSON）
		// ------------------------------------------------------------------
		const API = "/api/web-pets";
		const ASSETS = "/web-pets-assets";
		/** 上游 dsh-pet 的状态路由（仅其启用时注册）——用于探测鲸鱼是否活跃。 */
		const UPSTREAM_API = "/api/pet/state";

		async function apiFetch(path, body) {
			const response = await fetch(path, body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					});
			if (!response.ok) throw new Error(`web-pets ${path} failed: ${response.status}`);
			return response.json();
		}

		const petApi = {
			state: () => apiFetch(`${API}/state`),
			info: () => apiFetch(`${API}/info`),
			check: () => apiFetch(`${API}/check`),
			update: () => apiFetch(`${API}/update`, {}),
			setPet: (id) => apiFetch(`${API}/set-pet`, { id }),
			setVisible: (visible) => apiFetch(`${API}/set-visible`, { visible }),
			setSize: (size) => apiFetch(`${API}/set-size`, { size }),
			setEnabled: (enabled) => apiFetch(`${API}/set-enabled`, { enabled }),
			setConfig: (patch) => apiFetch(`${API}/set-config`, patch),
			interact: () => apiFetch(`${API}/interact`, {}),
			/** 上游鲸鱼是否活跃（路由可达 ⇔ 其 enabled）。 */
			upstreamActive: () =>
				fetch(UPSTREAM_API).then((r) => r.ok, () => false),
		};

		const POLL_MS = 800;

		// ---- 自更新常量 ----
		const REPO = "YUCONG-28/dsh-skills-plugins";
		const GITHUB_RELEASES = "https://api.github.com/repos/" + REPO + "/releases/latest";
		const GITHUB_TAGS = "https://api.github.com/repos/" + REPO + "/tags";
		const TAG_PREFIX = "web-pets-v";
		const UPD_KEY = "dwp-upd-checked";
		const UPD_PREFS_KEY = "dwp-upd-prefs";
		const CHECK_COOLDOWN_MS = 60 * 60 * 1000; // 1h between automatic checks
		const ISSUE_URL = "https://github.com/" + REPO + "/issues/new";

		// ---- 显示参数边界（与官方 dsh-pet 的 display 配置一致） ----
		const SIZE_MIN = 32;
		const SIZE_MAX = 512;
		const INSET_MAX = 10_000;
		const NAME_MAX = 20;

		// ------------------------------------------------------------------
		// React 组件
		// ------------------------------------------------------------------
		const { createElement, useEffect, useRef, useState } = react;

		/** 当前表情 URL；内置宠物优先 data URI（PET_ART），自定义宠物走 /web-pets-assets。 */
		function emoteUrl(snapshot, stateOverride) {
			const pet = snapshot.pets.find((p) => p.id === snapshot.activePet);
			const map = pet && pet.emotes ? pet.emotes : {};
			const state = stateOverride || snapshot.state;
			const file = map[state] || map.idle || `${snapshot.activePet}_1.gif`;
			const builtin = PET_ART[snapshot.activePet];
			if (builtin && builtin[state]) return builtin[state];
			return `${ASSETS}/${snapshot.activePet}/emotes/${file}`;
		}

		/** 由快照计算悬浮层内联样式（root 定位 right/bottom，img 大小/透明度+镜像+缩放）——与官方参数同构。 */
		function displayStyle(snapshot, prefs) {
			const size = Math.max(SIZE_MIN, Math.min(SIZE_MAX, snapshot.size || 160));
			const scale = prefs && typeof prefs.scale === "number" && prefs.scale > 0 ? prefs.scale : 1;
			const opacity = prefs && typeof prefs.opacity === "number" ? prefs.opacity : 1;
			const right = Math.max(0, Math.min(INSET_MAX, snapshot.right ?? 24));
			const bottom = Math.max(0, Math.min(INSET_MAX, snapshot.bottom ?? 20));
			const mirrorX = snapshot.mirrorX === true;
			const mirrorY = snapshot.mirrorY === true;
			return {
				rootStyle: { right: `${right}px`, bottom: `${bottom}px` },
				imgStyle: {
					width: `${Math.round(size * scale)}px`,
					height: "auto",
					opacity,
					transform: `scaleX(${mirrorX ? -1 : 1}) scaleY(${mirrorY ? -1 : 1})`,
				},
			};
		}

		/** 桌宠主体：图片 + 气泡 + 右键菜单（缩放/透明度/锁定/暂停/重置/设置）。 */
		function PetApp(props) {
			const { snapshot, feedback, actions, prefs, domState, onOpenSettings } = props;
			const [menuOpen, setMenuOpen] = useState(false);
			const [expanded, setExpanded] = useState(null);
			const [override, setOverride] = useState(null);
			const [frozenSrc, setFrozenSrc] = useState(null);
			const menuRef = useRef(null);
			const imgRef = useRef(null);
			const dragRef = useRef(null);
			const didDragRef = useRef(false);
			const [dragPos, setDragPos] = useState(null);

			// 点击其他区域关闭菜单
			useEffect(() => {
				if (!menuOpen) return;
				const onDown = (e) => {
					if (menuRef.current && !menuRef.current.contains(e.target)) {
						setMenuOpen(false);
						setExpanded(null);
					}
				};
				document.addEventListener("mousedown", onDown);
				return () => document.removeEventListener("mousedown", onDown);
			}, [menuOpen]);

			// 点击互动：随机 mood 1.8s（参考 dsh-pet-remielle），同时保留摸头气泡
			const overrideActive = override !== null && Date.now() < override.until;
			useEffect(() => {
				if (!overrideActive) return;
				const timer = window.setTimeout(() => setOverride(null), 1800);
				return () => window.clearTimeout(timer);
			}, [overrideActive]);

			// 暂停动画：canvas 冻结当前帧（参考 dsh-pet-remielle freezeCurrentGif）
			useEffect(() => {
				const img = imgRef.current;
				if (prefs.paused) {
					if (!img || !img.src) return;
					try {
						const canvas = document.createElement("canvas");
						canvas.width = img.naturalWidth || 150;
						canvas.height = img.naturalHeight || 150;
						const g = canvas.getContext("2d");
						if (g) {
							g.drawImage(img, 0, 0, canvas.width, canvas.height);
							setFrozenSrc(canvas.toDataURL("image/png"));
						}
					} catch {
						// canvas 不可用：保持动画
					}
				} else {
					setFrozenSrc(null);
				}
			}, [prefs.paused]);

			// DOM 增强信号（等待卡片 / think 细分）叠加到宿主状态
			const effectiveState = domState && domState.waiting
				? "waiting"
				: domState && domState.think && snapshot.state === "running"
					? "thinking"
					: snapshot.state;
			const mood = overrideActive ? override.mood : effectiveState;
			const src = frozenSrc || emoteUrl(snapshot, mood);

			// ---- 拖拽（锁定时不拖；拖动更新 right/bottom 并持久化） ----
			const onPointerDown = (e) => {
				if (e.button !== 0 || prefs.locked) return;
				e.preventDefault();
				didDragRef.current = false;
				const base = { right: snapshot.right ?? 24, bottom: snapshot.bottom ?? 20 };
				dragRef.current = { startX: e.clientX, startY: e.clientY, ...base, pos: { ...base } };
				setDragPos({ ...base });
				e.currentTarget.setPointerCapture?.(e.pointerId);
			};
			const onPointerMove = (e) => {
				const d = dragRef.current;
				if (!d) return;
				const right = Math.max(0, Math.min(INSET_MAX, d.right - (e.clientX - d.startX)));
				const bottom = Math.max(0, Math.min(INSET_MAX, d.bottom - (e.clientY - d.startY)));
				if (Math.abs(e.clientX - d.startX) > 4 || Math.abs(e.clientY - d.startY) > 4) {
					didDragRef.current = true;
				}
				d.pos = { right, bottom };
				setDragPos({ right, bottom });
			};
			const onPointerUp = () => {
				const d = dragRef.current;
				if (!d) return;
				dragRef.current = null;
				if (didDragRef.current) {
					// 拖拽结束：持久化位置（与官方 dragEnd 一致）
					actions.setConfig({ right: d.pos.right, bottom: d.pos.bottom });
				}
				setDragPos(null);
			};

			const styles = displayStyle(snapshot, prefs);
			const rootStyle = dragPos
				? { ...styles.rootStyle, right: `${dragPos.right}px`, bottom: `${dragPos.bottom}px` }
				: styles.rootStyle;
			const bubbleText = feedback || snapshot.bubble || "";

			// ---- 菜单小工具 ----
			const menuToggleRow = (label, on, act) => createElement(
				"button",
				{ className: "dwp-menu-item" + (on ? " active" : ""), onClick: act },
				label + (on ? " ✓" : ""),
			);
			const menuExpandRow = (label, summary, opts) => {
				const open = expanded === label;
				return createElement(
					"div",
					{ className: "dwp-menu-item", onClick: () => setExpanded(open ? null : label) },
					createElement("span", null, label),
					createElement("span", { style: { marginLeft: "auto", color: "#8b84a0", fontSize: 12 } }, summary + (open ? " ▴" : " ▾")),
					open
						? createElement(
							"div",
							{ className: "dwp-menu-sub", onClick: (e) => e.stopPropagation() },
							opts.map((o) => createElement(
								"button",
								{ key: o.label, className: "dwp-menu-opt" + (o.on ? " on" : ""), onClick: o.act },
								(o.on ? "✓ " : "") + o.label,
							)),
						)
						: null,
				);
			};

			const menu = menuOpen
				? createElement(
						"div",
						{ className: "dwp-menu", ref: menuRef, onClick: (e) => e.stopPropagation() },
						createElement("div", { className: "dwp-menu-title" }, t("card.pet")),
						snapshot.pets.map((pet) =>
							createElement(
								"button",
								{
									key: pet.id,
									className:
										"dwp-menu-item" +
										(pet.id === snapshot.activePet ? " active" : ""),
									onClick: () => {
										if (pet.id !== snapshot.activePet) actions.setPet(pet.id);
										setMenuOpen(false);
									},
								},
								pet.displayName,
							),
						),
						createElement("div", { className: "dwp-menu-sep" }),
						createElement(
							"div",
							{ className: "dwp-menu-row" },
							createElement("button", { className: "btn", onClick: () => actions.setSize((snapshot.size || 160) - 20) }, "− 缩小"),
							createElement("button", { className: "btn", onClick: () => actions.setSize((snapshot.size || 160) + 20) }, "放大 ＋"),
						),
						createElement("div", { className: "dwp-menu-sep" }),
						menuExpandRow(t("settings.scale"), Math.round((prefs.scale || 1) * 100) + "%",
							[80, 100, 125, 150, 200].map((p) => ({
								label: p + "%",
								on: Math.round((prefs.scale || 1) * 100) === p,
								act: () => actions.setPrefs({ scale: p / 100 }),
							}))),
						menuExpandRow(t("settings.opacity"), Math.round((prefs.opacity ?? 1) * 100) + "%",
							[40, 60, 80, 100].map((p) => ({
								label: p + "%",
								on: Math.round((prefs.opacity ?? 1) * 100) === p,
								act: () => actions.setPrefs({ opacity: p / 100 }),
							}))),
						menuToggleRow(t("settings.locked"), prefs.locked === true, () => actions.setPrefs({ locked: !(prefs.locked === true) })),
						menuToggleRow(t("settings.paused"), prefs.paused === true, () => actions.setPrefs({ paused: !(prefs.paused === true) })),
						createElement(
							"button",
							{ className: "dwp-menu-item", onClick: () => { actions.setConfig({ right: 24, bottom: 20 }); setMenuOpen(false); } },
							t("settings.reset"),
						),
						createElement(
							"button",
							{ className: "dwp-menu-item", onClick: () => { setMenuOpen(false); onOpenSettings(); } },
							t("settings.title"),
						),
						createElement("div", { className: "dwp-menu-sep" }),
						createElement(
							"div",
							{ className: "dwp-menu-row" },
							createElement("button", { className: "btn", onClick: () => actions.setConfig({ mirrorX: !snapshot.mirrorX }) }, "↔ 水平镜像"),
							createElement("button", { className: "btn", onClick: () => actions.setConfig({ mirrorY: !snapshot.mirrorY }) }, "↕ 垂直镜像"),
						),
						createElement("div", { className: "dwp-menu-sep" }),
						createElement(
							"button",
							{ className: "dwp-menu-item", onClick: () => actions.hide() },
							"🙈 " + t("card.hidden"),
						),
					)
				: null;

			return createElement(
				"div",
				{
					className: "dwp-root",
					style: rootStyle,
					onContextMenu: (e) => {
						e.preventDefault();
						setMenuOpen((v) => !v);
					},
				},
				bubbleText !== ""
					? createElement("div", { className: "dwp-bubble" }, bubbleText)
					: null,
				createElement(
					"div",
					{
						className: "dwp-pet" + (dragPos ? " dragging" : ""),
						onClick: () => {
							// 拖拽结束后会触发 click：有位移时忽略，仅当纯点击才互动
							if (didDragRef.current) {
								didDragRef.current = false;
								return;
							}
							actions.interact();
							// 随机 mood 1.8s
							const states = Object.keys((snapshot.pets.find((q) => q.id === snapshot.activePet) || {}).emotes || {});
							const candidates = states.filter((s) => s !== mood);
							if (candidates.length > 0) {
								setOverride({ mood: candidates[Math.floor(Math.random() * candidates.length)], until: Date.now() + 1800 });
							}
						},
						onPointerDown,
						onPointerMove,
						onPointerUp,
						onPointerCancel: onPointerUp,
					},
					createElement("img", {
						ref: imgRef,
						src: src,
						style: styles.imgStyle,
						alt: snapshot.name || snapshot.activePet,
						draggable: false,
					}),
				),
				menu,
			);
		}

		/** 隐藏时的召唤按钮。 */
		function SummonButton(props) {
			return createElement(
				"button",
				{ className: "dwp-summon", title: t("card.visible"), onClick: () => props.onSummon() },
				"🐾",
			);
		}

		/**
		 * dsh-web-ui 宠物入口的「宠物选择」卡片（注册进 web-ui.plugin.item 槽位，
		 * 紧跟上游 dsh-pet 卡片）。自包含：轮询 /api/web-pets/state + 探测上游
		 * /api/pet/state；切换我们的宠物走自有 API，切换鲸鱼经 petScope 写
		 * dsh-pet 的 enabled（'pet' 在 dsh-web-ui 家族桥接白名单内）。
		 */
		function WebPetsSettingsCard(props) {
			const { petScope } = props;
			const [snapshot, setSnapshot] = useState(null);
			const [whaleActive, setWhaleActive] = useState(false);
			const [whaleFailed, setWhaleFailed] = useState(false);
			const [autoOff, setAutoOff] = useState(false);
			const [pending, setPending] = useState(false);
			const [nameDraft, setNameDraft] = useState("");
			const nameInitRef = useRef(false);

			const refreshAll = () => {
				petApi.state().then((data) => {
					setSnapshot(data);
					if (!nameInitRef.current) {
						nameInitRef.current = true;
						setNameDraft(data.name || "");
					}
					// 首次加载防双宠：鲸鱼活跃且本插件 enabled 未被显式配置 → 自动让位
					if (whaleActive && data.enabled === true && !data.enabledConfigured && !autoOff) {
						setAutoOff(true);
						petApi.setEnabled(false).then(() => petApi.state().then(setSnapshot, () => {}), () => {});
					}
				}, () => {});
				petApi.upstreamActive().then((ok) => {
					setWhaleActive(ok);
				}, () => setWhaleActive(false));
			};

			useEffect(() => {
				refreshAll();
				const timer = window.setInterval(refreshAll, 1000);
				return () => window.clearInterval(timer);
			}, []);

			if (snapshot === null) {
				return createElement(
					"li",
					{ className: "dwp-card" },
					createElement("p", { className: "dwp-card-title" }, t("card.title")),
					createElement("p", { className: "dwp-card-desc" }, t("card.loading")),
				);
			}

			const act = (fn) => {
				setPending(true);
				fn().then(() => {
					setPending(false);
					refreshAll();
				}, () => setPending(false));
			};

			const size = Math.max(SIZE_MIN, Math.min(SIZE_MAX, snapshot.size || 160));
			const right = Math.max(0, Math.min(INSET_MAX, snapshot.right ?? 24));
			const bottom = Math.max(0, Math.min(INSET_MAX, snapshot.bottom ?? 20));
			const oursActive = snapshot.enabled === true;
			const currentLabel = whaleActive
				? t("card.whaleOff")
				: oursActive
					? t("card.oursOff")
					: t("card.none");

			const pickWhale = () => {
				setWhaleFailed(false);
				act(() => {
					const chain = petApi.setEnabled(false);
					if (petScope) {
						chain.then(() => petScope.set("enabled", true), () => {
							setWhaleFailed(true);
						});
					} else {
						setWhaleFailed(true);
					}
					return chain;
				});
			};

			const pickOurs = (id) => {
				const chain = petApi.setPet(id).then(() => petApi.setEnabled(true));
				if (petScope) {
					chain.then(() => petScope.set("enabled", false), () => {});
				}
				act(() => chain);
			};

			return createElement(
				"li",
				{ className: "dwp-card" },
				createElement("p", { className: "dwp-card-title" }, t("card.title")),
				createElement("p", { className: "dwp-card-desc" }, t("card.description")),
				createElement("p", { className: "dwp-card-section" }, t("card.pet")),
				createElement(
					"div",
					{ className: "dwp-card-pets" },
					// 上游鲸鱼（仅当探测到 dsh-pet 存在时）
					whaleActive || petScope
						? createElement(
								"button",
								{
									key: "__upstream__",
									className: "dwp-card-pet" + (whaleActive ? " active" : ""),
									disabled: pending,
									onClick: () => {
										if (!whaleActive) pickWhale();
									},
								},
								t("card.whale"),
							)
						: null,
					// 本插件的宠物（注册表）
					snapshot.pets.map((pet) =>
						createElement(
							"button",
							{
								key: pet.id,
								className:
									"dwp-card-pet" +
									(oursActive && pet.id === snapshot.activePet ? " active" : ""),
								disabled: pending,
								onClick: () => {
									if (!(oursActive && pet.id === snapshot.activePet)) {
										pickOurs(pet.id);
									}
								},
							},
							pet.displayName,
						),
					),
				),
				createElement("p", { className: "dwp-card-section" }, t("card.size")),
				createElement(
					"div",
					{ className: "dwp-card-row" },
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending, onClick: () => act(() => petApi.setConfig({ size: size - 20 })) },
						"−",
					),
					createElement("span", { className: "dwp-card-size" }, `${size}px`),
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending, onClick: () => act(() => petApi.setConfig({ size: size + 20 })) },
						"+",
					),
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending || !oursActive, onClick: () => act(() => petApi.setVisible(!snapshot.visible)) },
						snapshot.visible ? t("card.hidden") : t("card.visible"),
					),
				),
				createElement("p", { className: "dwp-card-section" }, t("card.position")),
				createElement(
					"div",
					{ className: "dwp-card-row" },
					createElement("span", { className: "dwp-card-size" }, t("card.right")),
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending, onClick: () => act(() => petApi.setConfig({ right: right - 10 })) },
						"−",
					),
					createElement("span", { className: "dwp-card-size" }, `${right}px`),
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending, onClick: () => act(() => petApi.setConfig({ right: right + 10 })) },
						"+",
					),
					createElement("span", { className: "dwp-card-size", style: { minWidth: 12 } }, "·"),
					createElement("span", { className: "dwp-card-size" }, t("card.bottom")),
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending, onClick: () => act(() => petApi.setConfig({ bottom: bottom - 10 })) },
						"−",
					),
					createElement("span", { className: "dwp-card-size" }, `${bottom}px`),
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending, onClick: () => act(() => petApi.setConfig({ bottom: bottom + 10 })) },
						"+",
					),
				),
				createElement("p", { className: "dwp-card-section" }, t("card.name")),
				createElement(
					"div",
					{ className: "dwp-card-row" },
					createElement(
						"input",
						{
							className: "dwp-card-input",
							type: "text",
							value: nameDraft,
							maxLength: NAME_MAX,
							placeholder: t("card.namePlaceholder"),
							onChange: (e) => setNameDraft(e.target.value),
						},
					),
					createElement(
						"button",
						{
							className: "dwp-card-btn",
							disabled: pending || nameDraft.trim() === "",
							onClick: () => act(() => petApi.setConfig({ name: nameDraft })),
						},
						t("card.save"),
					),
				),
				createElement("p", { className: "dwp-card-section" }, t("card.mirror")),
				createElement(
					"div",
					{ className: "dwp-card-pets" },
					createElement(
						"button",
						{
							className: "dwp-card-pet" + (snapshot.mirrorX ? " active" : ""),
							disabled: pending,
							onClick: () => act(() => petApi.setConfig({ mirrorX: !snapshot.mirrorX })),
						},
						"↔ " + t("card.mirrorX"),
					),
					createElement(
						"button",
						{
							className: "dwp-card-pet" + (snapshot.mirrorY ? " active" : ""),
							disabled: pending,
							onClick: () => act(() => petApi.setConfig({ mirrorY: !snapshot.mirrorY })),
						},
						"↕ " + t("card.mirrorY"),
					),
				),
				autoOff
					? createElement("p", { className: "dwp-card-note" }, t("card.autoOff"))
					: null,
				whaleFailed
					? createElement("p", { className: "dwp-card-note" }, t("card.whaleFailed"))
					: null,
				createElement(
					"p",
					{ className: "dwp-card-status" },
					`${t("card.status")}: ${currentLabel}${oursActive && snapshot.bubble ? " · " + snapshot.bubble : ""}`,
				),
			);
		}

		// ------------------------------------------------------------------
		// 客户端插件主体
		// ------------------------------------------------------------------
		/**
		 * 所需服务：slots（设置卡片槽位）+ locale（文案）+ connection/remote/
		 * settingsScope（settings 命名空间绑定，切换上游鲸鱼 enabled 用）。
		 */
export const inject = ["slots", "locale", "connection", "settingsScope", "remote"];

		// ---- 视觉偏好（localStorage；尺寸/位置/名称等宿主配置仍走 /api/web-pets） ----
		function readPrefs() {
			const def = { scale: 1, opacity: 1, locked: false, paused: false };
			try {
				const raw = localStorage.getItem("dwp-prefs");
				if (raw) {
					const p = JSON.parse(raw);
					if (p && typeof p === "object") {
						if (typeof p.scale === "number" && p.scale >= 0.5 && p.scale <= 2) def.scale = p.scale;
						if (typeof p.opacity === "number" && p.opacity >= 0.3 && p.opacity <= 1) def.opacity = p.opacity;
						if (typeof p.locked === "boolean") def.locked = p.locked;
						if (typeof p.paused === "boolean") def.paused = p.paused;
					}
				}
			} catch {
				// storage unavailable
			}
			return def;
		}
		function writePrefs(prefs) {
			try { localStorage.setItem("dwp-prefs", JSON.stringify(prefs)); } catch { /* ignore */ }
		}

		/** 简单语义化版本比较（客户端侧，用于更新提示）。 */
		function semverGtClient(a, b) {
			const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
			const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
			for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
				const x = pa[i] || 0;
				const y = pb[i] || 0;
				if (x !== y) return x > y;
			}
			return false;
		}

		/** 模块级防重入（热重载/重复 apply 时只挂载一次）。 */
		let mounted = false;

		/**
		 * 客户端主体：绑定 pet 命名空间（切换鲸鱼）、注册宠物选择器卡片、
		 * 挂载全局悬浮桌宠（单宠物模型）。
		 * @param ctx - 客户端根上下文。
		 */
export function apply(ctx) {
			if (mounted) return;
			mounted = true;

			// ---- 文案字典（官方 locale 机制） ----
			try {
				ctx.effect(() => ctx.locale.register("web-pets", LOCALES), "web-pets: dictionaries");
			} catch (e) {
				// locale 服务缺失时静默（卡片用内置 t() 兜底）；仅打印诊断便于升级排障
				console.warn("[dsh-web-pets] locale 服务缺失，使用内置文案", e);
			}

			// ---- 上游 dsh-pet 的 pet 命名空间（切换鲸鱼 enabled） ----
			let petScope = null;
			try {
				const binder = ctx.get("webUiSettings") ?? ctx.settingsScope;
				if (binder && typeof binder.bind === "function") {
					petScope = binder.bind({ namespace: "pet" });
				}
			} catch (e) {
				// 上游或桥接缺失 → 鲸鱼选项仅显示，切换时提示不可用
				console.warn("[dsh-web-pets] webUiSettings/settingsScope 绑定不可用：无法切换上游鲸鱼（dsh-web-ui 版本可能已变）", e);
			}
			// 版本断言日志：升级 dsh-web-ui 后凭此判断集成面是否可用
			console.info("[dsh-web-pets] 客户端挂载完成，pet 设置桥接:", petScope ? "available" : "unavailable");

			// ---- dsh-web-ui 宠物入口：宠物选择器卡片（web-ui.plugin.item 槽位） ----
			try {
				ctx.slots.inject("web-ui.plugin.item", () => ctx.slots.register({
					name: "web-ui.plugin.item",
					id: "web-pets-settings",
					order: 150,
					locale: "web-pets",
					inject: () => ({ petScope }),
				}, WebPetsSettingsCard));
			} catch (e) {
				// 无该槽位（未安装 dsh-web-ui-settings 组）时注册无害，忽略；
				// 升级 dsh-web-ui 后若槽位协议变化，此警告会提示宠物选择卡片未注册
				console.warn("[dsh-web-pets] web-ui.plugin.item 槽位不可用：宠物选择卡片未注册（未装 dsh-web-ui 或槽位协议已变）", e);
			}

			// ---- 全局悬浮桌宠（enabled=false 时完全不渲染） ----
			let snapshot = null;
			let feedback = "";
			let feedbackTimer = undefined;
			let lastRenderKey = "";

			// ---- 视觉偏好（localStorage）与 DOM 增强状态 ----
			const prefs = readPrefs();
			let domState = { waiting: false, think: false };
			let domObserver = null;
			let domTimer = undefined;
			let domBaseline = 0;
			let wasRunning = false;

			// ---- 设置面板 / 更新卡片 / 更新气泡 / toast 的 DOM ----
			const settingsMask = document.createElement("div");
			settingsMask.className = "dwp-settings-mask";
			settingsMask.style.display = "none";
			const settingsPanel = document.createElement("div");
			settingsPanel.className = "dwp-settings";
			settingsPanel.style.display = "none";
			const updCard = document.createElement("div");
			updCard.className = "dwp-upd-card";
			updCard.style.display = "none";
			const updBubble = document.createElement("div");
			updBubble.className = "dwp-upd-bubble";
			updBubble.style.display = "none";
			const toast = document.createElement("div");
			toast.className = "dwp-toast";
			toast.style.display = "none";
			document.body.appendChild(settingsMask);
			document.body.appendChild(settingsPanel);
			document.body.appendChild(updCard);
			document.body.appendChild(updBubble);
			document.body.appendChild(toast);

			const showToast = (text) => {
				toast.textContent = text;
				toast.style.display = "block";
				clearTimeout(toast._t);
				toast._t = setTimeout(() => { toast.style.display = "none"; }, 2400);
			};

			// ---- 自更新状态 ----
			let updInfo = null;
			let updChecking = false;
			let updChecked = false;
			let updNetworkHint = "";
			let installMode = "link";
			let updPrefs = { auto: true };
			try {
				const raw = localStorage.getItem(UPD_PREFS_KEY);
				if (raw) { const j = JSON.parse(raw); if (j && typeof j === "object") updPrefs = { auto: j.auto !== false }; }
			} catch { /* ignore */ }
			const writeUpdPrefs = () => { try { localStorage.setItem(UPD_PREFS_KEY, JSON.stringify(updPrefs)); } catch { /* ignore */ } };

			async function checkForUpdate(force) {
				if (updChecking) return false;
				updChecking = true;
				updChecked = true;
				try {
					if (!force) {
						try {
							const last = Number(localStorage.getItem(UPD_KEY) || "0");
							if (Date.now() - last < CHECK_COOLDOWN_MS) return false;
						} catch { /* ignore */ }
					}
					let info = null;
					try {
						const res = await fetch(`${API}/check`, { headers: { Accept: "application/json" } });
						const j = await res.json().catch(() => null);
						if (j && j.ok && typeof j.latest === "string") {
							info = { latest: j.latest, notes: j.notes || "", htmlUrl: j.htmlUrl || ("https://github.com/" + REPO + "/releases"), current: j.current };
						} else if (j && !j.ok && j.error) {
							updNetworkHint = t("settings.checkFailed") + " (" + String(j.error) + ")";
						}
					} catch { /* host check 不可用 */ }
					if (!info) {
						// 浏览器直连 GitHub 兜底
						try {
							const rel = await (await fetch(GITHUB_RELEASES, { headers: { Accept: "application/vnd.github+json" } })).json();
							if (rel && typeof rel.tag_name === "string") info = { latest: rel.tag_name, notes: rel.body || "", htmlUrl: rel.html_url || ("https://github.com/" + REPO + "/releases"), current: null };
						} catch {
							try {
								const tags = await (await fetch(GITHUB_TAGS, { headers: { Accept: "application/vnd.github+json" } })).json();
								if (Array.isArray(tags)) {
									const mine = tags.map((x) => (x && typeof x.name === "string" ? x.name : "")).filter((n) => n.startsWith(TAG_PREFIX));
									mine.sort((a, b) => (semverGtClient(a.slice(TAG_PREFIX.length), b.slice(TAG_PREFIX.length)) ? -1 : 1));
									if (mine.length > 0) info = { latest: mine[0], notes: "", htmlUrl: "https://github.com/" + REPO + "/releases", current: null };
								}
							} catch { /* offline */ }
						}
					}
					try { localStorage.setItem(UPD_KEY, String(Date.now())); } catch { /* ignore */ }
					if (!info) { updInfo = null; if (force) showToast(updNetworkHint || t("settings.checkFailed")); return false; }
					updInfo = info;
					const current = info.current || PET_VERSION;
					if (!semverGtClient(info.latest.replace(/^web-pets-v/, ""), current)) {
						if (force) showToast(t("settings.noUpdate"));
						return false;
					}
					updBubble.style.display = "inline-flex";
					return true;
				} catch {
					updInfo = null;
					if (force) showToast(t("settings.checkFailed"));
					return false;
				} finally {
					updChecking = false;
				}
			}

			async function runAutoUpdate(onOutput) {
				onOutput(t("settings.updating"));
				try {
					const res = await fetch(`${API}/update`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
					const j = await res.json().catch(() => null);
					onOutput((j && j.output) || "HTTP " + res.status);
					if (res.ok && j && j.ok) { showToast(t("upd.done")); updBubble.style.display = "none"; return true; }
					return false;
				} catch (e) { onOutput(String(e)); return false; }
			}

			function openUpdateCard() {
				if (!updInfo) return;
				updCard.textContent = "";
				const head = document.createElement("div");
				head.className = "dwp-upd-card-head";
				const title = document.createElement("span");
				title.className = "dwp-upd-card-title";
				title.textContent = t("settings.hasUpdate");
				const closeX = document.createElement("button");
				closeX.className = "dwp-upd-close";
				closeX.textContent = "✕";
				closeX.addEventListener("click", closeUpdateCard);
				head.appendChild(title);
				head.appendChild(closeX);
				updCard.appendChild(head);

				const body = document.createElement("div");
				body.className = "dwp-upd-card-body";
				const versions = document.createElement("div");
				versions.className = "dwp-upd-versions";
				const oldV = document.createElement("span"); oldV.className = "old"; oldV.textContent = PET_VERSION;
				const arrow = document.createElement("span"); arrow.className = "arrow"; arrow.textContent = "→";
				const newV = document.createElement("span"); newV.className = "new"; newV.textContent = updInfo.latest;
				versions.appendChild(oldV); versions.appendChild(arrow); versions.appendChild(newV);
				body.appendChild(versions);
				if (updInfo.notes && updInfo.notes.trim()) {
					const notes = document.createElement("div");
					notes.className = "dwp-upd-notes";
					notes.textContent = updInfo.notes.trim().slice(0, 1200);
					body.appendChild(notes);
				}
				const hint = document.createElement("div");
				hint.className = "dwp-upd-hint";
				hint.textContent = t("settings.updateHint");
				body.appendChild(hint);
				const output = document.createElement("div");
				output.className = "dwp-upd-output";
				body.appendChild(output);
				updCard.appendChild(body);

				const actions = document.createElement("div");
				actions.className = "dwp-upd-actions";
				const ghBtn = document.createElement("button");
				ghBtn.className = "dwp-btn";
				ghBtn.textContent = t("upd.openRelease");
				ghBtn.addEventListener("click", () => { window.open(updInfo.htmlUrl, "_blank"); });
				actions.appendChild(ghBtn);
				const updBtn = document.createElement("button");
				updBtn.className = "dwp-btn primary";
				updBtn.textContent = t("upd.update");
				updBtn.addEventListener("click", async () => {
					if (updBtn.disabled) return;
					updBtn.disabled = true;
					updBtn.textContent = t("settings.updating");
					output.style.display = "block";
					const ok = await runAutoUpdate((txt) => { output.textContent = txt; });
					updBtn.textContent = ok ? t("upd.done") : t("upd.failed");
					if (ok) { closeUpdateCard(); buildSettings(); }
					else updBtn.disabled = false;
				});
				actions.appendChild(updBtn);
				updCard.appendChild(actions);
				updCard.style.display = "block";
			}
			function closeUpdateCard() { updCard.style.display = "none"; }
			updBubble.addEventListener("click", () => { if (updInfo) openUpdateCard(); });

			// ---- 设置面板（左右分栏：外观 / 行为 / 更新 / 反馈） ----
			function sectionEl(label) {
				const el = document.createElement("div");
				el.className = "dwp-settings-section";
				el.textContent = label;
				return el;
			}
			function sliderRow(label, min, max, step, value, onChange) {
				const row = document.createElement("div");
				row.className = "dwp-settings-row";
				const lab = document.createElement("span"); lab.className = "lab"; lab.textContent = label;
				row.appendChild(lab);
				const input = document.createElement("input");
				input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
				const val = document.createElement("span"); val.className = "val"; val.textContent = value + "%";
				input.addEventListener("input", () => { val.textContent = input.value + "%"; onChange(Number(input.value)); });
				row.appendChild(input);
				row.appendChild(val);
				return row;
			}
			function switchRow(label, on, act) {
				const row = document.createElement("div");
				row.className = "dwp-settings-row";
				const lab = document.createElement("span"); lab.className = "lab"; lab.textContent = label;
				const sw = document.createElement("div");
				sw.className = "dwp-switch" + (on ? " on" : "");
				sw.setAttribute("role", "switch");
				sw.setAttribute("aria-checked", on ? "true" : "false");
				sw.addEventListener("click", act);
				row.appendChild(lab);
				row.appendChild(sw);
				return row;
			}
			function buttonRow(label, act) {
				const row = document.createElement("div");
				row.className = "dwp-settings-row";
				row.style.justifyContent = "flex-end";
				const btn = document.createElement("button");
				btn.className = "dwp-btn primary";
				btn.textContent = label;
				btn.addEventListener("click", act);
				row.appendChild(btn);
				return row;
			}
			let settingsTab = "appearance";
			function buildSettings() {
				settingsPanel.textContent = "";
				const side = document.createElement("div");
				side.className = "dwp-settings-side";
				const title = document.createElement("div");
				title.className = "dwp-settings-title";
				title.textContent = t("settings.title");
				side.appendChild(title);
				const nav = document.createElement("div");
				nav.className = "dwp-settings-nav";
				[
					{ key: "appearance", label: t("settings.appearance") },
					{ key: "behavior", label: t("settings.behavior") },
					{ key: "update", label: t("settings.update") },
					{ key: "feedback", label: t("settings.feedback") },
				].forEach((tab) => {
					const item = document.createElement("div");
					item.className = "dwp-settings-tab" + (settingsTab === tab.key ? " on" : "");
					item.textContent = tab.label;
					item.addEventListener("click", () => { settingsTab = tab.key; buildSettings(); });
					nav.appendChild(item);
				});
				side.appendChild(nav);
				settingsPanel.appendChild(side);

				const pane = document.createElement("div");
				pane.className = "dwp-settings-pane";
				if (settingsTab === "appearance") {
					pane.appendChild(sectionEl(t("settings.appearance")));
					pane.appendChild(sliderRow(t("settings.scale"), 50, 200, 5, Math.round((prefs.scale || 1) * 100), (v) => { prefs.scale = v / 100; writePrefs(prefs); render(); buildSettings(); }));
					pane.appendChild(sliderRow(t("settings.opacity"), 30, 100, 5, Math.round((prefs.opacity ?? 1) * 100), (v) => { prefs.opacity = v / 100; writePrefs(prefs); render(); buildSettings(); }));
				} else if (settingsTab === "behavior") {
					pane.appendChild(sectionEl(t("settings.behavior")));
					pane.appendChild(switchRow(t("settings.locked"), prefs.locked === true, () => { prefs.locked = !(prefs.locked === true); writePrefs(prefs); render(); buildSettings(); }));
					pane.appendChild(switchRow(t("settings.paused"), prefs.paused === true, () => { prefs.paused = !(prefs.paused === true); writePrefs(prefs); render(); buildSettings(); }));
					pane.appendChild(switchRow(t("settings.hidden"), snapshot !== null && snapshot.visible === false, () => { (snapshot !== null && snapshot.visible ? hidePet : summonPet)(); buildSettings(); }));
					pane.appendChild(buttonRow(t("settings.reset"), () => { petApi.setConfig({ right: 24, bottom: 20 }).then(pollNow, pollNow); showToast(t("settings.reset")); }));
					if (snapshot) {
						pane.appendChild(switchRow(t("settings.domSignals"), snapshot.domSignals === true, () => petApi.setConfig({ domSignals: !(snapshot.domSignals === true) }).then(pollNow, pollNow)));
					}
				} else if (settingsTab === "update") {
					pane.appendChild(sectionEl(t("settings.update")));
					pane.appendChild(switchRow(t("settings.autoCheck"), updPrefs.auto, () => { updPrefs.auto = !updPrefs.auto; writeUpdPrefs(); buildSettings(); }));
					const row = document.createElement("div");
					row.className = "dwp-settings-row";
					const lab = document.createElement("span"); lab.className = "lab"; lab.textContent = t("settings.version");
					row.appendChild(lab);
					const status = document.createElement("span");
					status.style.flex = "1"; status.style.textAlign = "right"; status.style.fontSize = "12px";
					const hasUpdate = updInfo !== null && semverGtClient(updInfo.latest.replace(/^web-pets-v/, ""), PET_VERSION);
					if (hasUpdate) status.textContent = t("settings.hasUpdate") + " " + updInfo.latest;
					else if (updChecked && updInfo === null) status.textContent = updNetworkHint || t("settings.checkFailed");
					else if (updChecked) status.textContent = t("settings.noUpdate");
					else status.textContent = t("settings.notChecked");
					row.appendChild(status);
					const btn = document.createElement("button");
					btn.className = "dwp-btn" + (hasUpdate ? " primary" : "");
					btn.textContent = hasUpdate ? (installMode === "tarball" ? t("upd.openRelease") : t("upd.update")) : t("settings.check");
					btn.addEventListener("click", async () => {
						if (hasUpdate && installMode === "tarball") {
							if (updInfo) window.open(updInfo.htmlUrl, "_blank");
							return;
						}
						if (hasUpdate) {
							btn.disabled = true;
							btn.textContent = t("settings.updating");
							const ok = await runAutoUpdate(() => {});
							btn.disabled = false;
							btn.textContent = ok ? t("upd.done") : t("upd.failed");
							if (ok) buildSettings();
						} else {
							btn.disabled = true;
							btn.textContent = t("settings.updating");
							await checkForUpdate(true);
							btn.disabled = false;
							buildSettings();
						}
					});
					row.appendChild(btn);
					pane.appendChild(row);
					const hint = document.createElement("div");
					hint.className = "dwp-upd-hint";
					hint.textContent = installMode === "link" ? t("settings.updateHint") : installMode === "npm" ? t("settings.npmHint") : t("settings.tarballHint");
					pane.appendChild(hint);
				} else {
					pane.appendChild(sectionEl(t("settings.feedback")));
					const desc = document.createElement("div");
					desc.className = "dwp-upd-hint";
					desc.textContent = t("settings.feedbackDesc");
					pane.appendChild(desc);
					pane.appendChild(buttonRow(t("settings.feedbackBtn"), () => {
						window.open(ISSUE_URL + "?title=" + encodeURIComponent("[dsh-web-pets] 反馈") + "&body=" + encodeURIComponent("版本: " + PET_VERSION + "\n\n描述："), "_blank");
					}));
					const repoRow = document.createElement("div");
					repoRow.className = "dwp-settings-row";
					const repoLab = document.createElement("span"); repoLab.className = "lab"; repoLab.textContent = t("settings.repo");
					repoRow.appendChild(repoLab);
					const repoLink = document.createElement("a");
					repoLink.href = "https://github.com/" + REPO;
					repoLink.target = "_blank";
					repoLink.textContent = "github.com/" + REPO;
					repoRow.appendChild(repoLink);
					pane.appendChild(repoRow);
					const verRow = document.createElement("div");
					verRow.className = "dwp-settings-row";
					const verLab = document.createElement("span"); verLab.className = "lab"; verLab.textContent = t("settings.version");
					verRow.appendChild(verLab);
					const verSpan = document.createElement("span"); verSpan.textContent = PET_VERSION;
					verRow.appendChild(verSpan);
					pane.appendChild(verRow);
				}
				settingsPanel.appendChild(pane);
			}
			function openSettings() { settingsMask.style.display = "block"; settingsPanel.style.display = "flex"; buildSettings(); }
			function closeSettings() { settingsMask.style.display = "none"; settingsPanel.style.display = "none"; }
			settingsMask.addEventListener("click", closeSettings);

			// ---- DOM 增强信号（等待卡片 / think 细分；snapshot.domSignals 开启后生效） ----
			const runTick = () => {
				try {
					const running = document.querySelector("svg[data-state='ongoing']") !== null;
					if (running && !wasRunning) {
						domBaseline = document.querySelectorAll("[data-chat-flow-kind]").length;
					}
					wasRunning = running;
				} catch { /* ignore */ }
			};
			const domTick = () => {
				if (!snapshot || snapshot.domSignals !== true) return;
				let waiting = false;
				let think = false;
				try {
					waiting = document.querySelector("[data-cordis-approve], [data-question-key], [data-plan-review-key]") !== null;
					const nodes = document.querySelectorAll("[data-chat-flow-kind]");
					if (nodes.length > domBaseline) {
						const fresh = Array.prototype.slice.call(nodes, domBaseline);
						const last = fresh[fresh.length - 1];
						if (last && last.getAttribute("data-chat-flow-kind") === "assistant-step") {
							if (last.querySelector("[data-variant='think']") !== null && last.querySelector("[class*='markdown']") === null) think = true;
						}
					}
				} catch { /* ignore */ }
				if (waiting !== domState.waiting || think !== domState.think) {
					domState = { waiting, think };
					render();
				}
			};
			const scheduleDomTick = () => {
				if (domTimer) window.clearTimeout(domTimer);
				domTimer = window.setTimeout(domTick, 300);
			};
			try {
				domObserver = new MutationObserver(scheduleDomTick);
				domObserver.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["data-state", "data-chat-flow-kind", "data-variant", "data-cordis-approve", "data-question-key", "data-plan-review-key"],
				});
			} catch { /* MutationObserver 不可用 */ }

			const hidePet = () => petApi.setVisible(false).then(pollNow, pollNow);
			const summonPet = () => petApi.setVisible(true).then(pollNow, pollNow);

			const container = document.createElement("div");
			container.dataset.dshWebPetsRoot = "";
			document.body.appendChild(container);
			const root = react_dom_client.createRoot(container);

			const render = () => {
				if (snapshot === null) return;
				if (!snapshot.enabled) {
					// 上游宠物活跃（或本插件被禁用）：本插件不渲染任何东西
					lastRenderKey = "";
					root.render(null);
					return;
				}
				if (snapshot.visible) {
					// 渲染去抖：状态/偏好/反馈未变化时不重建 React 树
					const key = [snapshot.updatedAt, snapshot.bubble, snapshot.activePet, snapshot.size, snapshot.right, snapshot.bottom, snapshot.name, snapshot.mirrorX, snapshot.mirrorY, snapshot.visible, snapshot.enabled, snapshot.state, snapshot.tool, snapshot.domSignals, domState.waiting, domState.think, prefs.scale, prefs.opacity, prefs.locked, prefs.paused, feedback].join("|");
					if (key === lastRenderKey) return;
					lastRenderKey = key;
					root.render(createElement(PetApp, {
						snapshot,
						feedback,
						prefs,
						domState,
						onOpenSettings: openSettings,
						actions: {
							setPet: (id) => {
								petApi.setPet(id).then(pollNow, pollNow);
							},
							setSize: (size) => {
								petApi.setSize(size).then(pollNow, pollNow);
							},
							setConfig: (patch) => {
								petApi.setConfig(patch).then(pollNow, pollNow);
							},
							setPrefs: (patch) => {
								Object.assign(prefs, patch);
								writePrefs(prefs);
								render();
							},
							hide: () => {
								petApi.setVisible(false).then(pollNow, pollNow);
							},
							interact: () => {
								petApi.interact().then(() => {
									feedback = "❤️ 摸头 +1";
									clearTimeout(feedbackTimer);
									feedbackTimer = setTimeout(() => {
										feedback = "";
										render();
									}, 1500);
									render();
								}, () => {});
							},
						},
					}));
				} else {
					lastRenderKey = "";
					root.render(createElement(SummonButton, {
						onSummon: () => {
							petApi.setVisible(true).then(pollNow, pollNow);
						},
					}));
				}
			};

			const pollNow = () => {
				petApi.state().then((data) => {
					snapshot = data;
					render();
				}, () => {
					// 传输失败保持上次快照；下次轮询自动恢复。
				});
			};
			// 每次轮询顺带同步 DOM 增强信号的运行基线（廉价）
			const tickAll = () => { runTick(); pollNow(); };

			const disposePoll = ctx.effect(() => {
				let timer = undefined;
				const stop = () => {
					if (timer !== undefined) {
						window.clearInterval(timer);
						timer = undefined;
					}
				};
				const start = () => {
					if (timer === undefined && document.visibilityState === "visible") {
						timer = window.setInterval(tickAll, POLL_MS);
					}
				};
				const onVisibility = () => {
					if (document.visibilityState === "visible") {
						pollNow();
						start();
					} else {
						stop();
					}
				};
				start();
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					stop();
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, "web-pets: poll");

			pollNow();

			// 启动自更新检查（默认自动，静默；2.5s 后不阻塞桌宠）
			petApi.info().then((info) => {
				if (info && typeof info.mode === "string") installMode = info.mode;
			}, () => {});
			if (updPrefs.auto) {
				window.setTimeout(() => { checkForUpdate(false); }, 2500);
			}

			// 页面卸载兜底：卸载根节点并移除全部容器
			const disposeUi = () => {
				root.unmount();
				container.remove();
				settingsMask.remove();
				settingsPanel.remove();
				updCard.remove();
				updBubble.remove();
				toast.remove();
				if (domObserver) domObserver.disconnect();
				if (domTimer) window.clearTimeout(domTimer);
				clearTimeout(feedbackTimer);
			};
			window.addEventListener("beforeunload", disposeUi);
		}

// 测试钩子：暴露纯逻辑供验证 harness 断言（加载器忽略多余导出）。
export const _internals = { emoteUrl, displayStyle };
