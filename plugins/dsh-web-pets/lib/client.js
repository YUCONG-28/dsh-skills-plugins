/**
 * dsh-web-pets —— DSH Web 桌宠插件（浏览器侧）
 *
 * 全局悬浮桌宠：轮询宿主 /api/web-pets/state（~800ms，仅前台标签页），
 * 按宠物状态渲染对应表情 GIF；点击互动弹「❤️」气泡；右键弹出菜单：
 * 切换宠物 / 调整大小 / 隐藏。宠物为宿主全局对象（无会话维度），因此
 * 直接挂载到 document.body 上的单个 React 根，而非会话级 slot。
 *
 * 本文件为手写产物（无构建步骤）：遵循官方客户端 bundle 形态——
 * __ModuleLoader__.load({ id, factory }) + exports.apply / exports.inject。
 *
 * @module dsh-web-pets/client
 */
window.__ModuleLoader__.load({
	id: "dsh-web-pets",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");

		// ------------------------------------------------------------------
		// 样式（一次性注入）
		// ------------------------------------------------------------------
		const CSS_ID = "dsh-web-pets/style.css";
		if (typeof document !== "undefined" && !document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-pets";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				".dwp-root{position:fixed;right:24px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;user-select:none}",
				".dwp-pet{position:relative;cursor:pointer;line-height:0}",
				".dwp-pet img{width:100%;height:auto;image-rendering:auto;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);background:transparent;transition:transform .15s}",
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
			].join("");
			document.head.appendChild(tag);
		}

		// ------------------------------------------------------------------
		// 宿主 API（同源 JSON）
		// ------------------------------------------------------------------
		const API = "/api/web-pets";
		const ASSETS = "/web-pets-assets";

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
			setPet: (id) => apiFetch(`${API}/set-pet`, { id }),
			setVisible: (visible) => apiFetch(`${API}/set-visible`, { visible }),
			setSize: (size) => apiFetch(`${API}/set-size`, { size }),
			interact: () => apiFetch(`${API}/interact`, {}),
		};

		const POLL_MS = 800;

		// ------------------------------------------------------------------
		// React 组件
		// ------------------------------------------------------------------
		const { createElement, useEffect, useRef, useState } = react;

		/** 当前表情文件 URL；spec 缺失时回退 <pet>_1.gif。 */
		function emoteUrl(snapshot) {
			const pet = snapshot.pets.find((p) => p.id === snapshot.activePet);
			const map = pet && pet.emotes ? pet.emotes : {};
			const file = map[snapshot.state] || map.idle || `${snapshot.activePet}_1.gif`;
			return `${ASSETS}/${snapshot.activePet}/emotes/${file}`;
		}

		/** 桌宠主体：图片 + 气泡 + 右键菜单。 */
		function PetApp(props) {
			const [menuOpen, setMenuOpen] = useState(false);
			const menuRef = useRef(null);
			const { snapshot, feedback, actions } = props;

			// 点击其他区域关闭菜单
			useEffect(() => {
				if (!menuOpen) return;
				const onDown = (e) => {
					if (menuRef.current && !menuRef.current.contains(e.target)) {
						setMenuOpen(false);
					}
				};
				document.addEventListener("mousedown", onDown);
				return () => document.removeEventListener("mousedown", onDown);
			}, [menuOpen]);

			const sizePx = Math.max(40, Math.min(480, snapshot.size || 160));
			const bubbleText = feedback || snapshot.bubble || "";

			const menu = menuOpen
				? createElement(
						"div",
						{ className: "dwp-menu", ref: menuRef, onClick: (e) => e.stopPropagation() },
						createElement("div", { className: "dwp-menu-title" }, "切换宠物"),
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
							createElement("button", { onClick: () => actions.setSize((snapshot.size || 160) - 20) }, "− 缩小"),
							createElement("button", { onClick: () => actions.setSize((snapshot.size || 160) + 20) }, "放大 ＋"),
						),
						createElement("div", { className: "dwp-menu-sep" }),
						createElement(
							"button",
							{ className: "dwp-menu-item", onClick: () => actions.hide() },
							"🙈 隐藏宠物",
						),
					)
				: null;

			return createElement(
				"div",
				{
					className: "dwp-root",
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
					{ className: "dwp-pet", onClick: () => actions.interact() },
					createElement("img", {
						src: emoteUrl(snapshot),
						width: sizePx,
						alt: snapshot.activePet,
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
				{ className: "dwp-summon", title: "召唤桌宠", onClick: () => props.onSummon() },
				"🐾",
			);
		}

		// ------------------------------------------------------------------
		// 客户端插件主体
		// ------------------------------------------------------------------
		/** 所需服务（本插件只用 DOM 与 fetch，无需任何 ctx 服务）。 */
		const inject = [];

		/** 模块级防重入（热重载/重复 apply 时只挂载一次）。 */
		let mounted = false;

		/**
		 * 客户端主体：挂载全局桌宠根节点并启动轮询。
		 * @param ctx - 客户端根上下文（本插件不使用其服务）。
		 */
		function apply(ctx) {
			if (mounted) return;
			mounted = true;

			let snapshot = null;
			let feedback = "";
			let feedbackTimer = undefined;

			const container = document.createElement("div");
			container.dataset.dshWebPetsRoot = "";
			document.body.appendChild(container);
			const root = react_dom_client.createRoot(container);

			const render = () => {
				if (snapshot === null) return;
				if (snapshot.visible) {
					root.render(createElement(PetApp, {
						snapshot,
						feedback,
						actions: {
							setPet: (id) => {
								petApi.setPet(id).then(pollNow, pollNow);
							},
							setSize: (size) => {
								petApi.setSize(size).then(pollNow, pollNow);
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
						timer = window.setInterval(pollNow, POLL_MS);
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

			// 页面卸载兜底：卸载根节点并移除容器
			const disposeUi = () => {
				root.unmount();
				container.remove();
				clearTimeout(feedbackTimer);
			};
			window.addEventListener("beforeunload", disposeUi);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
