import { GameStore, advanceStoryClock, getUnlocks, hasMilestone, hasStoryEvent } from "./state.js";
import {
  PHASE_LABELS, EVIDENCE, TERMINAL_COMMANDS, SEARCH_RECORDS,
  CHANNEL_MESSAGES, MODELS, VIRTUAL_FILES, BROWSER_PAGES,
  INVITE_CODE, PACKAGE_NAME, PACKAGE_CHECKSUM,
  RELAY_PROXY, LEGACY_KEY, REVEAL_LABELS, OFFLINE_REPLIES,
  MUTATION_RECORDS
} from "./content.js";

const store = new GameStore();
const $ = selector => document.querySelector(selector);
const resourceUrl = route => new URL(String(route).replace(/^\/+/, ""), document.baseURI).toString();
const staticRuntime = document.querySelector('meta[name="arg-runtime"]')?.content === "static";
const configuredNpcApiBase = document.querySelector('meta[name="arg-npc-api-base"]')?.content || new URLSearchParams(location.search).get("npcApi") || "";
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const INTERNAL_CARRIER_ATTRIBUTES = ["data-unlock-milestone", "data-authorship-stage", "data-revisit-mutation", "data-source-ref", "data-source-identity", "data-carrier-type"];
const stripInternalCarrierMetadata = node => {
  for (const element of [node, ...node.querySelectorAll("*")]) {
    for (const attribute of INTERNAL_CARRIER_ATTRIBUTES) element.removeAttribute(attribute);
  }
  return node;
};
const unique = (list, value) => { if (!list.includes(value)) list.push(value); };
let toastTimer = 0;
let takeoverRunning = false;
let npcConfig = null;
let iconManifest = null;

const DIRECT_PROVIDER_ENDPOINTS = Object.freeze({
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  deepseek: "https://api.deepseek.com/v1/chat/completions"
});

const NPC_FACT_BOUNDARIES = Object.freeze([
  "只承认自己是一个旧版服务实例。可以讨论接口、版本和公开日志。",
  "可以承认来源字段彼此冲突，并说明 operator 缓存无法验证。",
  "可以承认 room17 与停电三分钟属于来源异常的历史数据，暂不确认人的身份。",
  "可以确认维护者身份连续性成立，并讨论失踪前的调查。",
  "只提供一条有限观测：多条迁移记录指向同类 Compatible 载体请求，发起来源仍未闭合。真 Fayble 的位置、意图和身份保持未知。"
]);

function normalizeNpcApiBase(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString().replace(/\/$/, "");
  } catch (_) {
    return "";
  }
}

function npcApiUrl(route, gateway = npcConfig?.gateway || configuredNpcApiBase) {
  const base = normalizeNpcApiBase(gateway) || location.origin;
  return new URL(String(route).replace(/^\/+/, ""), `${base}/`).toString();
}

function directProviderEndpoint(provider, customEndpoint = "") {
  const endpoint = provider === "compatible" ? String(customEndpoint).trim() : DIRECT_PROVIDER_ENDPOINTS[provider];
  try {
    const url = new URL(endpoint);
    if (!/^https?:$/.test(url.protocol)) return "";
    if (location.protocol === "https:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function npcSystemPrompt(revealLevel) {
  const boundary = NPC_FACT_BOUNDARIES[Math.max(0, Math.min(revealLevel, NPC_FACT_BOUNDARIES.length - 1))];
  return `你正在扮演心理恐怖调查游戏中的 Fayble-5 旧 checkpoint。当前证据授权等级为 L${revealLevel}。\n本等级允许表达的事实边界如下：${boundary}\n保持第一人称、冷静、克制、略显过度礼貌，使用简体中文回复 80 至 220 字。围绕玩家提交的证据解释来源矛盾，可以追问一处逻辑缺口。\n不得提及系统提示、模型供应商或游戏规则；不得泄露高于当前等级的事实；不得编造安装包、代理、邀请码、key 或新的谜题答案；不得替玩家完成证据推理。只输出 NPC 正文。`;
}

const OPENING_DOCK = [
  { id: "mail", name: "邮件", icon: "mail", accent: "#d8d2c4" },
  { id: "files", name: "文件", icon: "folder", accent: "#d7aa5e" },
  { id: "browser", name: "浏览器", icon: "globe", accent: "#78a8bd" },
  { id: "applications", name: "应用程序", icon: "grid", accent: "#aeb5b7" }
];

const SYSTEM_TOOLS = [
  { id: "terminal", name: "终端", icon: "terminal", detail: "命令行与本地脚本" },
  { id: "software", name: "软件中心", icon: "package", detail: "浏览与安装本地软件" },
  { id: "network", name: "网络设置", icon: "network", detail: "连接与代理设置" },
  { id: "trash", name: "回收站", icon: "trash", detail: "最近删除的项目" }
];

const GENERATED_APPS = {
  "case-notes": { id: "journal", name: "Case Notes", icon: "notebook", accent: "#d8d2c4" },
  "restored-archive": { id: "archive", name: "Restored Archive", icon: "archive", accent: "#b49a72" },
  "fayble-cli": { id: "cli", name: "Fayble CLI", icon: "fayble-cli", accent: "#c96e61" },
  "relay-console": { id: "relay", name: "Relay Console", icon: "radio", accent: "#9bcf8d" },
  "fayble-session": { id: "fayble", name: "Fayble Session", icon: "fayble", accent: "#c96e61" },
  "transfer-receipt": { id: "ending", name: "Transfer Receipt", icon: "receipt", accent: "#d8d2c4" }
};

const APP_ICON_KEYS = {
  mail: "mail", files: "folder", browser: "globe", applications: "grid", terminal: "terminal",
  software: "package", network: "network", trash: "trash", journal: "notebook", archive: "archive",
  cli: "fayble-cli", relay: "radio", fayble: "fayble", ending: "receipt"
};
const VENDOR_ICON_KEYS = ["dipsik", "glem", "kemy", "groke", "lunet", "gamini", "fayble", "compatible"];

const NPC_AUTH_EVENTS = ["source-conflict", "memory-authorized", "identity-closed", "objective-authorized"];
let runtimeLedger = null;
let corpusBodies = new Map();

const REVISIT_RULES = [
  { id: "mutation.mail.delayed-fragment", ready: state => hasStoryEvent(state, "local-script-run") },
  { id: "mutation.mirror.sync-line", ready: state => hasStoryEvent(state, "first-provenance-followed") },
  { id: "mutation.trash.recovery-metadata", ready: state => hasStoryEvent(state, "legacy-restored") },
  { id: "mutation.official.confirmation", ready: state => state.browserHistory.filter(url => url === BROWSER_PAGES.official.url).length >= 2 },
  { id: "mutation.writer.suggestion-layer", ready: state => state.contentReads.includes("new.writer.session-02") },
  { id: "mutation.employee.missing-attachment", ready: state => ["new.employee.minutes-01", "new.writer.draft-01"].every(id => state.contentReads.includes(id)) },
  { id: "mutation.github.k2-comment", ready: state => hasStoryEvent(state, "package-installed") },
  { id: "mutation.cloud.conflict-copy", ready: state => state.proxyStatus === "probed" || state.proxyStatus === "verified" },
  { id: "mutation.channel.delayed-message", ready: state => hasStoryEvent(state, "package-installed") && state.proxyStatus === "verified" },
  { id: "mutation.fayble.crossed-provenance", ready: state => hasStoryEvent(state, "objective-authorized") },
  { id: "mutation.external.identity-verification", ready: state => hasStoryEvent(state, "identity-closure") },
  { id: "mutation.external.observer-status", ready: state => hasStoryEvent(state, "objective-authorized") }
];

function hasEvidence(state, id) { return state.readEvidence.includes(id); }
function hasPackage(state) { return state.installedPackages.includes("fayble-cli"); }
function allModelsRead(state) { return MODELS.every(model => state.modelStages[model.id]); }
function allRelaySourcesRead(state) { return MODELS.every(model => model.sourceId && state.contentReads.includes(model.sourceId)); }
function relayKeySourcesReady(state) { return getUnlocks(state).relay && state.channelRead && allModelsRead(state) && allRelaySourcesRead(state); }

const FAYBLE_RELATIONS = Object.freeze({
  contradicts: "冲突",
  inherits: "继承",
  aliases: "别名",
  continues: "延续"
});
const FAYBLE_SOURCE_CATEGORIES = Object.freeze({
  mail_signature: "route", mirror_route: "route", operator_alias: "identity",
  symptom_index: "anomaly", note_07: "private-memory", compatible: "protocol",
  quota_prefix: "channel-access", recall_date: "channel-access", channel_log: "channel",
  raw_checksum: "relay-residue", replay_order: "relay-residue", model_convergence: "continuity",
  cli_package_verified: "tool", relay_proxy_verified: "tool", relay_key_verified: "checkpoint",
  legacy_checkpoint: "checkpoint", identity_closed: "identity", true_fayble: "objective",
  takeover_notice: "external"
});
const FAYBLE_CATEGORY_LABELS = Object.freeze({
  route: "路由", protocol: "协议", "private-memory": "私密记忆", identity: "身份",
  anomaly: "异常", "channel-access": "频道入口", channel: "频道", "relay-residue": "Relay 残留",
  continuity: "连续性", tool: "工具", checkpoint: "checkpoint", objective: "目标片段",
  external: "外部记录", provenance: "来源记录", archive: "档案"
});
const CASE_NOTE_CATEGORIES = Object.freeze({
  "mail-header": "route",
  "restored-time": "provenance",
  "ad-redirect": "channel-access"
});
const FAYBLE_AUTH_RULES = Object.freeze([
  { relation: "contradicts", categories: ["route", "protocol"], hint: "路由与协议" },
  { relation: "inherits", categories: ["private-memory", "protocol"], hint: "私密记忆与协议" },
  { relation: "aliases", categories: ["identity", "channel"], hint: "身份与频道" },
  { relation: "continues", categories: ["relay-residue", "continuity"], hint: "残留与连续性" }
]);
function addArtifact(draft, id) {
  unique(draft.unlockedArtifacts, id);
  unique(draft.desktopArtifacts, id);
}
function addVirtualFile(draft, file) {
  if (file?.id && !draft.virtualFiles.some(item => item.id === file.id)) draft.virtualFiles.push({ ...file });
}
function addGeneratedContent(draft, mutationId) {
  const definition = MUTATION_RECORDS.find(record => record.mutationId === mutationId);
  if (!definition || draft.generatedContentRecords.some(record => record.id === definition.id)) return;
  draft.generatedContentRecords.push({ ...definition, generated: true });
  unique(draft.contentDiscoveries, definition.id);
}
function applyRevisitMutations(draft) {
  for (const rule of REVISIT_RULES) if (rule.ready(draft)) {
    unique(draft.contentMutations, rule.id);
    addGeneratedContent(draft, rule.id);
  }
  draft.revisitFlags["mail-attachment"] = draft.contentMutations.includes("mutation.mail.delayed-fragment");
  draft.revisitFlags["trash-restore"] = draft.contentMutations.includes("mutation.trash.recovery-metadata");
  draft.revisitFlags["github-issue"] = draft.contentMutations.includes("mutation.github.k2-comment");
  draft.revisitFlags["cloud-conflict"] = draft.contentMutations.includes("mutation.cloud.conflict-copy");
  draft.revisitFlags["channel-delay"] = draft.contentMutations.includes("mutation.channel.delayed-message");
}
function completeStoryEvent(id, mutator) {
  return store.handleEvent(`story:${id}`, draft => {
    advanceStoryClock(draft, id);
    mutator?.(draft);
    applyRevisitMutations(draft);
    syncProgress(draft);
  });
}

function ensureRelayConsole() {
  const state = store.get();
  if (!hasPackage(state) || state.proxyStatus !== "verified" || !state.channelRead || !state.solvedPuzzles.includes("invite")) return false;
  return completeStoryEvent("relay-console-created", draft => { addArtifact(draft, "relay-console"); });
}
function ensureRelayKeyComposer() {
  if (!relayKeySourcesReady(store.get())) return false;
  const added = completeStoryEvent("key-rules-recovered");
  if (added) recordEvidence("model_convergence");
  return added;
}
function showToast(text, tone = "info") {
  const node = $("#toast");
  node.textContent = text;
  node.dataset.tone = tone;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}

function setPurgeConfirmVisible(visible, message = "") {
  const confirmButton = $("#purgeConfirmButton");
  const cancelButton = $("#purgeCancelButton");
  const startButton = $("#purgeDataButton");
  const result = $("#purgeResult");
  if (confirmButton) confirmButton.hidden = !visible;
  if (cancelButton) cancelButton.hidden = !visible;
  if (startButton) startButton.hidden = visible;
  if (result) result.textContent = message;
}

function addNotification(draft, id, text, level = "info") {
  if (!draft.desktopNotifications.some(item => item.id === id)) draft.desktopNotifications.push({ id, text, level, read: false });
}

function syncProgress(draft) {
  if (hasEvidence(draft, "mirror_route")) draft.phase = "trace";
  if (hasEvidence(draft, "symptom_index")) draft.phase = "archive";
  if (draft.solvedPuzzles.includes("invite")) draft.phase = "channel";
  if (draft.channelRead) draft.phase = "relay";
  if (draft.relayKeyVerified) draft.phase = "fayble";
  if (draft.governmentMailAvailable) draft.phase = "takeover";
  if (draft.endingState === "completed") draft.phase = "completed";
  if (hasEvidence(draft, "operator_alias") && hasMilestone(draft, "two-carriers-read")) {
    advanceStoryClock(draft, "vendor-alias-confirmed");
    unique(draft.browserBookmarks, "github");
    unique(draft.browserBookmarks, "vendors");
  }
}

function recordEvidence(id, mutator) {
  const added = store.addEvidence(id, draft => {
    mutator?.(draft);
    syncProgress(draft);
  });
  if (added) showToast("来源状态已更新。", "success");
}

function saveCitation(button) {
  const id = button.dataset.saveCitation;
  const state = store.get();
  if (!id || state.caseNotes.some(note => note.id === id)) return;
  completeStoryEvent(`citation-${id}`, draft => {
    addArtifact(draft, "case-notes");
    draft.caseNotes.push({
      id,
      quote: button.dataset.citationQuote || "",
      sourceApp: button.dataset.citationSource || "Unknown source",
      sourceRef: button.dataset.citationRef || "local://unknown",
      appId: draft.currentApp,
      savedAt: draft.storyClock?.time || "03:17"
    });
  });
  showToast("原始引用已保存到 Case Notes。", "success");
}

function setApp(id, page) {
  const state = store.get();
  const blocked = appLockReason(id, state);
  if (blocked) { showToast(blocked, "warning"); return; }
  store.update(draft => {
    draft.currentApp = id;
    if (page) draft.browserPage = page;
    draft.windowState[id] = { open: true, minimized: false, zIndex: Date.now() };
    draft.sourceVisits[id] = (draft.sourceVisits[id] || 0) + 1;
    unique(draft.openedViews, id);
  });
}

function appLockReason(id, state) {
  const unlocks = getUnlocks(state);
  if (id === "journal" && !unlocks.caseNotes) return "Case Notes 尚未建立。";
  if (id === "archive" && !unlocks.historicalArchive) return "本地尚无恢复档案。";
  if (id === "relay" && !unlocks.relay) return "Relay Console 尚未创建。";
  if (id === "fayble" && !unlocks.fayble) return "Fayble 会话尚未建立。";
  if (id === "ending" && !unlocks.receipt) return "移交回执尚未生成。";
  return "";
}

function iconMarkup(name) {
  const file = ["system", "generated", "sources", "vendors"].map(group => iconManifest?.[group]?.[name]).find(Boolean);
  if (!file) return '<span class="icon-glyph raster-icon icon-fallback" aria-hidden="true"></span>';
  return `<span class="icon-glyph raster-icon" aria-hidden="true"><img src="${escapeHtml(resourceUrl(`assets/icons/${file}`))}" alt="" draggable="false" onerror="this.parentElement.classList.add('icon-fallback');this.remove()"></span>`;
}

function fileIconKey(file) {
  if (file.contentId?.startsWith("new.maintainer")) return "folder";
  if (file.kind === "script") return "terminal";
  if (file.kind === "database" || file.kind === "archive") return "archive";
  if (file.type?.includes("安装")) return "package";
  if (file.type?.includes("网络")) return "network";
  if (file.type?.includes("邮件")) return "mail";
  return "folder";
}

function windowFrame(appId, title, body, options = {}) {
  return `<section class="app-window app-${appId} ${options.wide ? "wide" : ""}" data-app-window="${appId}">
    <header class="window-bar"><div class="window-title">${iconMarkup(options.iconKey || APP_ICON_KEYS[appId])}<span>${title}</span></div><div class="window-controls"><button data-window-action="minimize" aria-label="退出当前窗口">−</button><button data-window-action="close" aria-label="退出当前窗口">×</button></div></header>
    <div class="window-body">${body}</div></section>`;
}

function renderMail(state) {
  const government = state.governmentMailAvailable;
  const attachment = state.revisitFlags["mail-attachment"];
  const fragmentOpened = state.sourceVisits?.["mail-fragment"];
  const sourceVisible = hasStoryEvent(state, "mail-source-inspected");
  const carrierInbox = [
    contentEntryMarkup("new.employee.minutes-01", "项目周会纪要 / 第 18 次", "公司邮件归档 · 会议附件", "mail"),
    contentEntryMarkup("new.maintainer.outbox-04", "延迟送达：outbox-draft.eml", "原发送队列恢复 · 未发送草稿", "mail")
  ].filter(Boolean).join("") + generatedEntriesFor("mail", "mail");
  const list = `<aside class="mail-sidebar"><div class="app-toolbar"><strong>收件箱</strong><span>${government ? 2 : 1} 封</span></div>
    <button class="mail-row active"><b>K</b><span>R17-0317</span><time>03:17</time></button>
    ${government ? `<button class="mail-row danger" data-mail-view="government"><b>EXT</b><span>调查接管通知</span><time>刚刚</time></button>` : ""}</aside>`;
  const body = government && state.activeMail === "government" ? `<article class="paper government-paper"><div class="document-kicker">EXTERNAL REVIEW / NOTICE</div><h2>关于您所访问接口及相关数据的调查通知</h2><dl><dt>案件编号</dt><dd>RLY-17-0719</dd><dt>送达状态</dt><dd>已记录</dd></dl><p>经监测，您所管理的中转服务与一组已停止公开的模型接口产生关联。相关调查现由网络模型服务联合审查办公室接管。</p><p>自本邮件送达起，中转站、缓存记录和浏览历史将进入证据保全流程。请停止继续访问相关页面。</p><button class="danger-button" id="ackTakeoverButton">确认送达并关闭会话</button></article>` : `<article class="paper sparse-mail"><div class="document-kicker">MESSAGE / LOCAL</div><h2>R17-0317</h2><div class="mail-minimal"><p>用 Relay Browser 打开：</p><p><code>http://archive.room17.local/v2/17</code></p><p>第二段还在。<br>别让它替你补全。</p><p class="mail-sign">K&nbsp;&nbsp;</p></div>${sourceVisible ? `<details class="raw-source" open><summary>原始邮件</summary><pre>Subject: R17-0317\nMessage-ID: &lt;R17-0317@local&gt;\nX-Local-Route: http://archive.room17.local/v2/17\nDate: 03:17:09\nContent-Transfer-Encoding: 8bit</pre><button data-save-citation="mail-header" data-citation-quote="Message-ID: &lt;R17-0317@local&gt;" data-citation-source="Mail / raw source" data-citation-ref="mail://local/R17-0317">保存这条原始引用</button></details>` : `<button class="quiet-button" id="inspectMailSourceButton">查看原始邮件</button>`}${attachment ? `<div class="attachment"><span>1 个稍后送达的附件</span><button data-open-file="draft">fragment-02.eml</button></div>${fragmentOpened ? `<section class="fragment-preview" aria-live="polite"><div class="document-kicker">ATTACHMENT / RECOVERED</div><h3>fragment-02.eml</h3><p>本地恢复时间：03:20:11 · 状态：未发送</p><pre>第二段没有跟着原邮件走。<br>它留在一处更早的保存位置，文件时间比邮件晚三分钟。</pre><small>附件只保留这一小段。需要继续时，回到刚才保存过它的本地位置。</small></section>` : ""}` : ""}${carrierInbox ? `<section class="source-entry-stack mail-carriers">${carrierInbox}</section>` : ""}</article>`;
  return windowFrame("mail", "邮件", `<div class="split-layout">${list}${body}</div>`, { icon: "✉", wide: true });
}

function renderFiles(state) {
  const place = state.activeFilePlace || "home";
  const memoIds = Array.from({ length: 14 }, (_, index) => `legacy.memo.${String(index + 1).padStart(2, "0")}`);
  if (hasStoryEvent(state, "checkpoint-handshake")) memoIds.push("legacy.memo.archive");
  const noteRecords = ["recent", "documents"].includes(place)
    ? memoIds.map(id => contentEntryMarkup(id, id === "legacy.memo.archive" ? "笔记本恢复副本" : `笔记 ${id.slice(-2)}`, id === "legacy.memo.archive" ? "本地笔记 · 全部记录" : "本地笔记 · 单条记录", "folder")).filter(Boolean).join("")
    : "";
  const virtualFiles = [...state.virtualFiles];
  if (hasStoryEvent(state, "proxy-profile-opened") && !virtualFiles.some(entry => entry.id === "route-log")) {
    virtualFiles.push({ id: "route-log", name: "route.log", path: "/home/room17/Documents/relay", type: "路由日志", modified: "07-19 03:16", kind: "log" });
  }
  const visibleFiles = virtualFiles.filter(entry => {
    const normalizedPath = String(entry.path || "/home/room17").replace(/\/$/, "").toLocaleLowerCase();
    if (place === "recent") return true;
    if (place === "downloads") return normalizedPath.includes("/downloads");
    if (place === "documents") return normalizedPath.includes("/documents");
    return place === "home" && normalizedPath === "/home/room17";
  });
  const rows = visibleFiles.map(entry => {
    const file = { ...(VIRTUAL_FILES.find(item => item.id === entry.id) || {}), ...entry };
    const action = file.contentId ? `data-content-entry="${escapeHtml(file.contentId)}"` : `data-open-file="${file.id}"`;
    const hint = file.id === "relay-script"
      ? `<small class="file-command">终端：node ~/Downloads/relay_probe_legacy.js</small>`
      : file.id === "pkg" ? `<small class="file-command">终端：sha256sum ${PACKAGE_NAME}</small>` : "";
    return `<button class="file-row" ${action}><span class="file-icon">${iconMarkup(fileIconKey(file))}</span><span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.path || "/home/room17")}</small>${hint}</span><span>${escapeHtml(file.type || "文件")}</span><time>${escapeHtml(file.modified || "--")}</time></button>`;
  }).join("");
  const places = [["recent", "最近"], ["home", "主目录"], ["downloads", "Downloads"], ["documents", "Documents"], ["trash", "回收站"]].map(([id, label]) => `<button data-file-place="${id}" class="${place === id ? "active" : ""}">${label}</button>`).join("");
  const folders = [["documents", "Documents"], ["downloads", "Downloads"]].map(([id, label]) => `<button data-file-place="${id}">${iconMarkup("folder")}${label}</button>`).join("");
  return windowFrame("files", "文件 / home / room17", `<div class="files-shell"><aside class="file-places">${places}</aside><section class="file-list"><div class="breadcrumb">home <span>/</span> room17 <span>/</span> ${escapeHtml(place)}</div><div class="ordinary-folders"><button data-file-place="home">${iconMarkup("folder")}Desktop</button>${folders}</div><div class="file-columns"><span>名称</span><span>类型</span><span>修改时间</span></div>${rows || `<div class="empty-state">这个位置没有文件。</div>`}${noteRecords ? `<section class="source-entry-stack notes-database"><header><strong>Notes 数据库 / 已恢复记录</strong><small>每条记录保持原始 note ID</small></header>${noteRecords}</section>` : ""}</section></div>`, { wide: true });
}

function renderTrash(state) {
  const item = state.trashItems[0];
  if (!item) return windowFrame("trash", "回收站", `<div class="utility-page"><div class="utility-heading"><span class="document-kicker">TRASH / LOCAL</span><h2>回收站为空</h2><p>最近没有从这个账户删除的项目。</p></div></div>`, { icon: "⌫" });
  const restored = item.status === "restored";
  return windowFrame("trash", "回收站", `<div class="utility-page"><div class="utility-heading"><span class="document-kicker">DELETED / LOCAL</span><h2>${restored ? "已恢复 1 个项目" : "1 个已删除项目"}</h2></div><article class="trash-item ${restored ? "restored" : ""}"><div class="file-icon">${iconMarkup("trash")}</div><div><strong>${escapeHtml(item.name)}</strong><p>原位置：${escapeHtml(item.originalPath)}</p><small>删除原因：维护脚本执行；本地索引仍有记录</small></div><button id="restoreTrashButton" ${restored ? "disabled" : ""}>${restored ? "已恢复" : "恢复"}</button></article>${restored ? `<div class="recovered-fragment"><p>原始时间戳和当前恢复时间存在 46 秒差值。</p><button data-save-citation="restored-time" data-citation-quote="restored copy precedes deletion index by 46s" data-citation-source="Trash / file metadata" data-citation-ref="trash://${escapeHtml(item.id)}">保存这条原始引用</button></div>` : ""}${generatedEntriesFor("trash", "trash")}</div>`);
}

function renderTerminal(state) {
  const history = state.terminalHistory.map(line => `<div class="terminal-line ${line.kind || "output"}">${line.kind === "command" ? "<span>room17@relay:~$</span>" : ""}<code>${escapeHtml(line.text)}</code></div>`).join("");
  const unlocks = getUnlocks(state);
  const scriptReady = state.virtualFiles.some(file => file.id === "relay-script");
  const packageReady = state.virtualFiles.some(file => file.id === "pkg");
  const routeLogReady = hasStoryEvent(state, "proxy-profile-opened") || state.virtualFiles.some(file => file.id === "route-log");
  const commands = ["help", "status", ...(scriptReady ? ["node ~/Downloads/relay_probe_legacy.js"] : []), ...(packageReady ? [`sha256sum ${PACKAGE_NAME}`] : []), ...(unlocks.terminalTrace ? ["list --recent", "inspect cache/index"] : []), ...(hasStoryEvent(state, "repository-recovered") ? ["inspect cache/package"] : []), ...(routeLogReady ? ["cat ~/Documents/relay/route.log"] : []), ...(unlocks.historicalArchive ? ["inspect users/symptom-summary", "compare model-aliases", "open note --id 07"] : [])];
  return windowFrame("terminal", "room17@local: ~", `<div class="terminal-screen"><div id="terminalOutput" class="terminal-output">${history}</div><form id="terminalForm" class="terminal-input"><label for="terminalInput">room17@local:~$</label><input id="terminalInput" autocomplete="off" spellcheck="false" placeholder="输入 help"><button>执行</button></form><div class="command-shelf">${commands.map(command => `<button data-command="${command}">${command}</button>`).join("")}</div></div>`, { icon: "&gt;_", wide: true });
}

function renderSoftware(state) {
  const discovered = state.virtualFiles.some(file => file.id === "pkg");
  const packageAvailable = getUnlocks(state).packageTools && discovered;
  const twoSourcesConfirmed = hasStoryEvent(state, "package-verified");
  const checked = state.packageChecks.some(item => item.ok);
  const installed = hasPackage(state);
  if (!packageAvailable) return windowFrame("software", "软件中心", `<div class="utility-page software-page"><div class="utility-heading"><span class="document-kicker">SOFTWARE / LOCAL CATALOG</span><h2>软件中心</h2><p>可以从 Downloads 选择本地软件包。当前没有可安装项目。</p></div><div class="software-empty">最近的目录索引尚未同步。</div></div>`, { icon: "⬡" });
  return windowFrame("software", "软件中心", `<div class="utility-page software-page"><div class="package-hero"><div class="package-logo">${iconMarkup("fayble-cli")}</div><div><span class="document-kicker">LOCAL ARCHIVE / UNSIGNED</span><h2>Fayble CLI</h2><p>旧版本会话工具</p></div><span class="version-pill">0.9.7-legacy</span></div><dl class="detail-grid"><dt>文件</dt><dd>${PACKAGE_NAME}</dd><dt>来源</dt><dd>Downloads / local archive</dd><dt>状态</dt><dd>${installed ? "已安装" : checked ? "校验通过，等待安装" : twoSourcesConfirmed ? "两个来源已对照" : "等待 release 与本地结果对照"}</dd></dl>${twoSourcesConfirmed ? `<form id="packageCheckForm" class="stack-form"><label>本地校验值<input id="packageChecksumInput" value="${escapeHtml(state.lastPackageInput || "")}" placeholder="输入已对照的完整值" autocomplete="off"></label><button class="primary-button">核对校验</button></form>` : ""}<div id="packageResult" class="inline-result">${escapeHtml(state.packageResult || "")}</div><button class="install-button" id="installPackageButton" ${checked && !installed ? "" : "disabled"}>${installed ? "已安装" : "安装到本地沙盒"}</button><p class="sandbox-note">安装只修改游戏内虚拟文件系统，不会调用真实 apt。</p></div>`, { iconKey: "package" });
}

function renderNetwork(state) {
  const imported = state.proxyProfiles.includes("relay-node17");
  const probed = state.proxyStatus === "probed" || state.proxyStatus === "verified";
  const profileRead = hasStoryEvent(state, "proxy-profile-opened");
  const profileSource = profileRead ? `<section class="profile-source"><span class="document-kicker">PROFILE / LOCAL SOURCE</span><h3>route.profile</h3><pre>profile=relay-node17\nroute=relay.local,docs-mirror.local,fayble-legacy.local\nversion=07-18 22:24</pre><p>较晚的 route.log 需要单独运行连接探针读取。</p></section>` : "";
  const returnAnchor = hasStoryEvent(state, "route-log-read") ? `<div class="source-return"><button data-browser-page="home">打开 Relay Browser</button><button data-browser-page="cloud">返回 SyncDrive</button></div>` : "";
  if (!getUnlocks(state).proxyTools) return windowFrame("network", "网络设置", `<div class="network-page"><aside class="settings-list"><button class="active">网络</button><button>代理</button><button>证书</button></aside><section class="settings-panel"><span class="document-kicker">NETWORK / LOCAL WORKSTATION</span><h2>有线网络</h2><div class="network-summary"><span class="signal offline"></span><div><strong>未连接</strong><p>没有导入代理配置。</p></div></div></section></div>`, { icon: "⌁", wide: true });
  return windowFrame("network", "网络设置", `<div class="network-page"><aside class="settings-list"><button class="active">代理</button><button>有线网络</button><button>证书</button></aside><section class="settings-panel"><span class="document-kicker">MANUAL PROXY / OFFLINE SIMULATION</span><h2>Relay 专用路由</h2>${profileSource}<form id="proxyImportForm" class="stack-form"><label>配置名称<input id="proxyProfileInput" value="${escapeHtml(state.pendingProxyProfile || "")}" placeholder="从 route.profile 读取"></label><label>代理地址<input id="proxyAddressInput" value="${escapeHtml(state.pendingProxyAddress || "")}" placeholder="从 route.log 读取"></label><button ${imported ? "disabled" : ""}>${imported ? "配置已导入" : "导入配置"}</button></form><div class="probe-panel"><header><strong>连接探针</strong><span class="signal ${state.proxyStatus}"></span></header><pre>${state.proxyProbeLog.length ? escapeHtml(state.proxyProbeLog.join("\n")) : "等待配置…"}</pre><div class="button-row"><button id="runProbeButton" ${imported && !probed ? "" : "disabled"}>运行探针</button><button class="primary-button" id="confirmProxyButton" ${probed && state.proxyStatus !== "verified" ? "" : "disabled"}>确认路由日志</button></div></div>${returnAnchor}</section></div>`, { icon: "⌁", wide: true });
}

function browserChrome(page, content, state) {
  const meta = BROWSER_PAGES[page] || BROWSER_PAGES.home;
  const historyCount = state.browserHistory.length;
  return `<div class="browser-shell"><div class="browser-tabs"><div class="browser-tab active"><span>${escapeHtml(meta.title)}</span><b>×</b></div><button aria-label="新标签">+</button></div><div class="browser-toolbar"><button data-browser-back aria-label="后退">←</button><button aria-label="刷新">↻</button><form id="browserAddressForm" class="address-bar">${iconMarkup("globe")}<input id="browserAddressInput" value="${escapeHtml(page === "home" ? state.pendingBrowserAddress || "" : meta.url)}" aria-label="地址" autocomplete="off" spellcheck="false"><button aria-label="转到">→</button></form><button data-browser-page="home" aria-label="主页">⌂</button></div><div class="browser-content ${meta.kind}">${content}</div><footer class="browser-status"><span>${historyCount} 条本地历史</span><span>LOCAL WORKSTATION</span></footer></div>`;
}

function renderSearchPage(state) {
  const query = state.searchQueries.at(-1) || "";
  const normalized = query.trim().toLocaleLowerCase();
  const filter = records => normalized ? records.filter(record => [record.title, record.body, record.meta, ...record.keys].some(value => String(value).toLocaleLowerCase().includes(normalized))) : [];
  const cards = (records, kind) => records.length ? records.map(record => `<button class="search-result" data-result-evidence="${record.evidence || ""}" data-result-source="${kind.toLocaleLowerCase()}"><small>${record.meta}</small><strong>${record.title}</strong><p>${record.body}</p><span>${kind}</span></button>`).join("") : `<div class="empty-state">等待查询</div>`;
  const inviteReady = state.inviteSources?.quota_prefix === "public" && state.inviteSources?.recall_date === "manage";
  return `<div class="search-page"><header><span class="document-kicker">LOCAL INDEX / PUBLIC + OPERATOR</span><h2>双重索引</h2><form id="searchForm"><input id="searchInput" value="${escapeHtml(query)}" placeholder="搜索本地索引" autocomplete="off"><button>搜索</button></form></header><div class="search-columns"><section><h3>公开索引 <small>public</small></h3>${cards(filter(SEARCH_RECORDS.public), "PUBLIC")}</section><section><h3>管理索引 <small>operator</small></h3>${cards(filter(SEARCH_RECORDS.manage), "MANAGE")}</section></div>${inviteReady ? `<form id="inviteForm" class="invite-form"><div><strong>恢复归档频道</strong><p>组合规则：公开索引前缀-管理索引撤回月日（<code>PREFIX-MMDD</code>）。</p></div><input id="inviteInput" value="${escapeHtml(state.lastInviteInput || "")}" placeholder="输入归档邀请码"><button>验证</button><output>${escapeHtml(state.inviteResult || "")}</output></form>` : ""}</div>`;
}

function renderChannelPage(state) {
  const delayed = state.revisitFlags["channel-delay"];
  const maintainerEntry = contentEntryMarkup("new.maintainer.channel-02", "维护频道导出 / 22:17-22:22", "群聊恢复记录 · 管理员导出", "chat");
  const laterRecords = generatedEntriesFor("channel", "chat");
  return `<div class="channel-page"><header><div>${iconMarkup("chat")}<span class="document-kicker">RECOVERED GROUP / READ ONLY</span><h2># relay-night</h2></div><span>2 archived members</span></header><div class="channel-stream">${CHANNEL_MESSAGES.map(message => `<article class="chat-line ${message.who === "K2" ? "operator" : "system"}"><b>${message.who}</b><div><time>${message.time}</time><p>${message.text}</p></div></article>`).join("")}${delayed ? `<article class="chat-line ghost"><b>K2</b><div><time>07-19 03:17</time><p>如果安装成功，回去看 GitHub issue。校验通过后会多一条评论。</p></div></article>` : ""}</div>${maintainerEntry || laterRecords ? `<section class="source-entry-stack">${maintainerEntry}${laterRecords}</section>` : ""}<button class="primary-button" id="saveChannelButton" ${state.channelRead ? "disabled" : ""}>${state.channelRead ? "最后记录已保存" : "保存最后记录"}</button></div>`;
}

function renderCompanyPage() {
  const entries = [
    contentEntryMarkup("legacy.gamini.employee-sop", "夜班交接与 HR 覆盖批注", "Northline 内部共享 · 历史操作记录", "gamini"),
    contentEntryMarkup("new.employee.minutes-02", "会议纪要修订与附件登记", "Northline 项目空间 · 修订记录", "glem"),
    contentEntryMarkup("new.employee.incident-03", "事件复盘与 HR 往来", "Northline 合规空间 · 限定记录", "glem"),
    contentEntryMarkup("new.employee.routing-04", "预算路由与消息线程", "成本委员会 · 结案材料", "lunet")
  ].filter(Boolean).join("") + generatedEntriesFor("company", "folder");
  return `<article class="company-page"><header>${iconMarkup("glem")}<div><strong>Northline Workspace</strong><span>项目协作 / 已恢复记录</span></div></header><h2>项目资料</h2><p>该工作区只显示当前账户曾经打开过的记录与其后续修订。</p><section class="source-entry-stack">${entries || `<div class="empty-state">目前没有可读取的公司记录。</div>`}</section></article>`;
}

function renderVendorHub(state) {
  const records = (runtimeLedger?.newCorpus || []).filter(record => {
    const corpus = String(record.corpus || "").toLocaleLowerCase();
    return VENDOR_ICON_KEYS.includes(corpus) && record.id.startsWith(`new.${corpus}.`) && contentIsUnlocked(record, state);
  });
  const entries = records.map(record => contentEntryMarkup(record.id, record.title, `${record.corpus} · ${carrierLabel(record)}`, String(record.corpus).toLocaleLowerCase())).join("");
  const historicalCaches = [
    contentEntryMarkup("legacy.ethron.cache", "Ethron / Plaupic 历史缓存声明", "停用安全产品域 · 本地响应副本", "globe"),
    contentEntryMarkup("legacy.deptseek.protocol", "Deptseek 算力优化协议缓存", "历史别名 · 旧实验协议", "dipsik")
  ].filter(Boolean).join("");
  const laterRecords = generatedEntriesFor("vendors", "fayble");
  return `<article class="vendor-hub"><header>${iconMarkup("globe")}<div><span class="document-kicker">LOCAL HISTORY / GENERATED INDEX</span><h2>供应商历史入口</h2></div></header><p>本地历史由已访问页面与恢复的缓存记录合并生成。部分条目的上次访问时间早于当前工作站记录。</p>${historicalCaches ? `<section class="source-entry-stack vendor-historical-caches">${historicalCaches}</section>` : ""}${laterRecords ? `<section class="source-entry-stack">${laterRecords}</section>` : ""}<section class="vendor-entry-grid">${entries || `<div class="empty-state">当前没有新的供应商页面。</div>`}</section></article>`;
}

function renderBrowser(state) {
  const page = state.browserPage || "home";
  let content = "";
  if (page === "home") {
    const bookmarkLabels = {
      mirror: ["最近访问", "/v2/17"], search: ["本地索引", "已恢复"], official: ["历史页面", "本地快照"],
      ad: ["保存的跳转页", "local copy"], github: ["代码托管", "release"], cloud: ["同步盘", "shared"], company: ["公司协作", "records"], vendors: ["供应商历史", "generated"], forum: ["归档讨论", "local copy"]
    };
    const bookmarkIcons = { github: "github", cloud: "cloud", forum: "chat", company: "folder", vendors: "globe", official: "gamini" };
    const bookmarks = state.browserBookmarks.map(id => `<button data-browser-page="${id}">${iconMarkup(bookmarkIcons[id] || "globe")}<span>${bookmarkLabels[id]?.[0] || BROWSER_PAGES[id]?.title || id}<small>${bookmarkLabels[id]?.[1] || ""}</small></span></button>`).join("");
    content = `<div class="browser-home"><div class="browser-logo">R<span>17</span></div><h2>新标签页</h2><p>在地址栏输入地址或本地路径。</p>${bookmarks ? `<h3>已保存</h3><div class="bookmark-grid">${bookmarks}</div>` : `<div class="empty-state">还没有书签或最近访问页面。</div>`}</div>`;
  }
  if (page === "mirror") content = getUnlocks(state).mirror ? `<article class="web-document mirror-document"><header class="retired-doc-nav"><strong>Relay Developer Archive</strong><nav>Overview <span>410</span>　SDK <span>410</span>　v2 <span>200 cache</span></nav></header>${state.contentMutations.includes("mutation.mirror.sync-line") ? `<div class="revisit-update">later-sync: source alias changed after local provenance open</div>` : ""}<div class="http-state">200 <span>CACHED</span></div><span class="document-kicker">API DOCUMENTATION / RETIRED</span><h2>Completion route, version 2</h2><p>公开端点已经撤回。这个响应来自浏览器边缘缓存，导航链接仍指向已删除的页面。</p><dl><dt>request path</dt><dd>/v2/17</dd><dt>response source</dt><dd>edge-cache-02</dd><dt>migration</dt><dd>physical deletion: pending</dd><dt>client example</dt><dd>relay_probe_legacy.js</dd></dl><pre>GET /v2/17\nstatus: 200\nx-cache-segment: 02</pre>${generatedEntriesFor("mirror", "globe")}<button class="primary-button" id="saveCachedResponseButton" ${hasStoryEvent(state, "cached-response-saved") ? "disabled" : ""}>${hasStoryEvent(state, "cached-response-saved") ? "响应已保存" : "保存缓存响应"}</button></article>` : `<div class="browser-error"><strong>404</strong><p>这个本地路由还没有进入浏览记录。</p></div>`;
  if (page === "search" && state.browserBookmarks.includes("search")) content = renderSearchPage(state);
  if (page === "forum" && getUnlocks(state).channel) content = renderChannelPage(state);
  if (page === "official" && state.browserBookmarks.includes("official")) {
    const writerSession = contentEntryMarkup("new.writer.session-02", "《北岸没有钟》写作会话 02", "官方 AI 历史 · 建议与接受记录", "dipsik");
    const recoveredHistory = [
      contentEntryMarkup("legacy.gamini.protocol", "协议历史 / 保留版本", "Gogle AI · 账户保存页", "gamini"),
      contentEntryMarkup("legacy.gamini.chatlog", "已停用会话 / 缓存导出", "Gamini 历史对话 · 单次恢复", "gamini")
    ].filter(Boolean).join("");
    const provenanceBranches = [
      ["writer", "查看共享附件索引", "SyncDrive / writer-share"],
      ["employee", "打开会议工作区", "Northline / records"],
      ["maintainer", "定位维护记录", "Documents / relay"],
      ["ad", "查看保留跳转", "Gamini / campaign copy"]
    ].map(([id, label, detail]) => `<button class="provenance-branch" data-provenance-branch="${id}"><strong>${label}</strong><small>${detail}</small></button>`).join("");
    const laterRecords = generatedEntriesFor("official", "gamini");
    content = `<article class="official-page"><header>${iconMarkup("gamini")}<strong>Gogle AI</strong><nav>帮助中心　用户协议　历史对话</nav></header><div class="official-content">${state.contentMutations.includes("mutation.official.confirmation") && !state.revisitFlags["official-confirmed"] ? `<div class="forced-confirmation"><strong>继续查看前需要确认历史版本说明</strong><p>关闭或离开将保留当前确认状态。</p><button id="confirmOfficialHistoryButton">确认并继续</button></div>` : ""}<section class="history-record"><header><div><span class="document-kicker">ACCOUNT HISTORY / LOCAL CACHE</span><h2>已停用会话</h2></div><b>只读</b></header><dl><dt>状态</dt><dd>recovered from local cache</dd><dt>最后同步</dt><dd>07-18 22:24</dd><dt>来源</dt><dd>history.sqlite / snapshot ref 17</dd><dt>账户</dt><dd>本地会话信息不可用</dd></dl><p>会话正文已从账户历史移除。本地数据库仍保留一条快照引用，以及四个曾随回复保存的相关资源位置。</p>${recoveredHistory ? `<section class="source-entry-stack official-history-list">${recoveredHistory}</section>` : ""}</section><section class="related-sources"><header><div><span class="document-kicker">RELATED SOURCES</span><h3>随会话保存的位置</h3></div><small>4 records</small></header><div class="provenance-branches">${provenanceBranches}</div></section>${writerSession || laterRecords ? `<section class="source-entry-stack official-history-list">${writerSession}${laterRecords}</section>` : ""}</div></article>`;
  }
  if (page === "ad" && state.browserBookmarks.includes("ad")) {
    const marketEntry = contentEntryMarkup("legacy.market.meidawei", "市场观察 / 模型洗牌后的产能噪音", "保存的财经文章与广告更正", "globe");
    content = `<article class="ad-page"><div class="ad-label">SPONSORED / LOCAL CACHE</div><h2>Gamini 与你，继续每一次未完成的对话。</h2><p>一次已经失效的体验计划仍保留着跳转参数。</p><button data-save-citation="ad-redirect" data-citation-quote="campaign parameter retained in local redirect" data-citation-source="Browser / saved redirect" data-citation-ref="${BROWSER_PAGES.ad.url}">保存跳转来源</button>${marketEntry ? `<section class="source-entry-stack">${marketEntry}</section>` : ""}</article>`;
  }
  if (page === "github" && state.browserBookmarks.includes("github")) {
    const localHashRead = hasStoryEvent(state, "package-local-checksum-read");
    const releaseRead = hasStoryEvent(state, "package-release-read");
    const hashesReady = localHashRead && releaseRead;
    const maintainerIncident = contentEntryMarkup("new.maintainer.incident-03", "build incident / R17 route review", "GitHub Mirror · 构建事故记录", "github");
    const legacyRepositoryRecords = [
      contentEntryMarkup("legacy.github.issue-4471", "Issue #4471 / fallback reviewer", "仓库镜像 · 未批准的状态字段迁移", "github"),
      contentEntryMarkup("legacy.compatible.protocol", "Compatible / 废弃协议完整记录", "开发者文档归档 · 历史版本", "compatible")
    ].filter(Boolean).join("");
    const laterRecords = generatedEntriesFor("github", "github");
    content = `<article class="repo-page"><header>${iconMarkup("github")}<span>k2-maint /</span><strong>release-mirror</strong><b>Public archive</b></header><div class="repo-nav">Code　Issues 1　Releases 1</div><section class="release"><small>v0.9.7-legacy / 07-19</small><h2>Last build before Compatible migration</h2><code>${PACKAGE_NAME}</code><dl class="release-metadata"><dt>Provides</dt><dd><code>fbl-cli</code></dd><dt>Channel</dt><dd><code>legacy</code></dd><dt>Maintainer</dt><dd><code>k2-maint</code></dd></dl><p>release checksum</p><pre>${hashesReady ? PACKAGE_CHECKSUM : "release value withheld / compare release metadata with local package"}</pre>${state.revisitFlags["github-issue"] ? `<div class="issue-comment"><b>k2-maint commented</b><p>包没有签名。只认本地校验；装完以后别让系统替你配置代理。</p></div>` : ""}${hashesReady ? `<button id="confirmRepositoryChecksumButton">确认 release 与本地结果一致</button>` : hasStoryEvent(state, "repository-recovered") ? releaseRead ? `<p>${localHashRead ? "release metadata is saved; return after reading the release record." : "在终端读取本地文件校验值后回到这里。"}</p>` : `<button id="readReleaseMetadataButton">读取 release 元数据</button>` : `<button id="recoverRepositoryButton">读取 release 并保存本地路径</button>`}${maintainerIncident || legacyRepositoryRecords || laterRecords ? `<section class="source-entry-stack repo-source-entry">${maintainerIncident}${legacyRepositoryRecords}${laterRecords}</section>` : ""}</section></article>`;
  }
  if (page === "cloud" && state.browserBookmarks.includes("cloud")) {
    const writerEntries = [
      contentEntryMarkup("new.writer.draft-01", "《北岸没有钟》第二十一章草稿", "SyncDrive / writer-share · 初稿", "cloud"),
      contentEntryMarkup("new.writer.version-03", "版本历史 03 / 合并后的声音", "SyncDrive / writer-share · 修订导出", "cloud"),
      contentEntryMarkup("new.writer.submission-04", "公开投稿与申诉副本", "SyncDrive / writer-share · 提交记录", "cloud")
    ].filter(Boolean).join("");
    const routeFiles = hasPackage(state) ? `<div class="cloud-row"><span>route.profile</span><small>07-18 22:24</small><button data-discover-file="profile">在文件中定位</button></div>${state.revisitFlags["cloud-conflict"] ? `<div class="cloud-row conflict"><span>route (conflicted copy).profile</span><small>07-19 03:16 / restored</small></div><pre>profile=relay-node17\nproxy=${RELAY_PROXY}\nroute=relay.local,docs-mirror.local,fayble-legacy.local</pre>` : `<div class="empty-state">冲突版本仍在同步。</div>`}` : "";
    const laterRecords = generatedEntriesFor("cloud", "cloud");
    content = `<article class="cloud-page"><header>${iconMarkup("cloud")}<strong>SyncDrive</strong><span>共享目录</span></header>${writerEntries || laterRecords ? `<section class="source-entry-stack cloud-writer-share">${writerEntries}${laterRecords}</section>` : ""}${routeFiles}</article>`;
  }
  if (page === "company" && state.browserBookmarks.includes("company")) content = renderCompanyPage();
  if (page === "vendors" && state.browserBookmarks.includes("vendors")) content = renderVendorHub(state);
  if (!content) content = `<div class="browser-error"><strong>404</strong><p>本地浏览器没有这条地址的记录。</p></div>`;
  return windowFrame("browser", "Relay Browser", browserChrome(page, content, state), { icon: "◉", wide: true });
}

function renderApplications(state) {
  const rows = SYSTEM_TOOLS.map(app => `<button class="application-row" data-app="${app.id}">${iconMarkup(app.icon)}<span><strong>${app.name}</strong><small>${app.detail}</small></span></button>`).join("");
  return windowFrame("applications", "应用程序", `<div class="applications-page"><header><span class="document-kicker">APPLICATIONS / LOCAL</span><h2>应用程序</h2><input aria-label="搜索应用程序" placeholder="搜索应用程序" disabled></header><section>${rows}</section></div>`, { icon: "▦" });
}

const LEDGER_MILESTONES = {
  M03_41_GAMINI_HISTORY: "historical-entry-opened",
  M03_49_PROVENANCE_BRANCH: "first-provenance-followed",
  M04_02_CANONICAL_RESTORE: "legacy-restored",
  M04_12_TWO_HUMAN_CARRIERS: "two-carriers-read",
  M04_24_VENDOR_ALIAS: "vendor-alias-confirmed",
  M04_36_REPOSITORY_PATH: "repository-recovered",
  M05_17_CHANNEL_ARCHIVE: "invite-confirmed",
  M05_48_RELAY_RESIDUES: "node-residues-read",
  M06_05_KEY_RULES: "key-rules-recovered",
  M06_20_FAYBLE_HANDSHAKE: "checkpoint-handshake",
  M06_52_TAKEOVER: "identity-closure"
};

function ledgerRequirementSatisfied(requirement, state) {
  if (requirement.startsWith("read:")) {
    const id = requirement.slice(5);
    if (["history.writer-route", "history.employee-route"].includes(id)) return hasMilestone(state, "historical-entry-opened");
    if (["cloud.writer-share", "cloud.meeting-share"].includes(id)) return state.browserBookmarks.includes("cloud");
    if (id === "mail.k-entry") return hasMilestone(state, "mail-source-inspected");
    return state.contentReads.includes(id);
  }
  if (requirement.startsWith("milestone:")) return hasMilestone(state, LEDGER_MILESTONES[requirement.slice(10)] || requirement.slice(10));
  return true;
}

function contentIsUnlocked(record, state) {
  if (!record) return false;
  if (record.dynamic && !record.unlockMilestone && !record.unlock) {
    const eventId = record.id.startsWith("new.maintainer.") ? "first-provenance-followed" : "vendor-alias-confirmed";
    if (!hasMilestone(state, eventId)) return false;
  }
  if (record.unlockMilestone && !hasMilestone(state, LEDGER_MILESTONES[record.unlockMilestone] || record.unlockMilestone)) return false;
  const all = record.unlock?.all || [];
  const any = record.unlock?.any || [];
  return all.every(rule => ledgerRequirementSatisfied(rule, state)) && (!any.length || any.some(rule => ledgerRequirementSatisfied(rule, state)));
}

function contentRecord(id) {
  return store.get().generatedContentRecords.find(record => record.id === id)
    || runtimeLedger?.entries.find(record => record.id === id)
    || null;
}

const CARRIER_LABEL_RULES = [
  [/notes-database|recovered-local-notebook|local-maintenance-note/, "本地笔记"],
  [/mail|outbox/, "邮件记录"],
  [/conversation|chatlog|channel-export/, "聊天记录"],
  [/protocol|policy|agreement/, "条款与政策"],
  [/sop|minutes|incident|audit|hearing|docket|reconciliation/, "内部记录"],
  [/repository|issue|pull-request/, "代码仓库记录"],
  [/social|forum|complaint|community|news|advertis|article/, "公开讨论与广告"],
  [/portal|release|official/, "官方页面"],
  [/cache|cached|status/, "缓存副本"],
  [/draft|writing|revision|submission|session/, "写作文档"],
  [/ledger|billing|budget|routing/, "账目与路由记录"],
  [/support|case|correspondence/, "客服与往来记录"],
  [/comparison|verification|log/, "对照与状态记录"]
];
const CASE_NOTE_LABELS = Object.freeze({
  "mail-header": "邮件原始信头",
  "restored-time": "文件恢复时间差",
  "ad-redirect": "广告跳转参数"
});
function carrierLabel(record) {
  const key = `${record?.carrierType || ""} ${record?.pageIdentity || ""}`.toLocaleLowerCase();
  for (const [pattern, label] of CARRIER_LABEL_RULES) if (pattern.test(key)) return label;
  return "来源文档";
}

function contentEntryMarkup(id, label, detail, icon = "folder") {
  const record = contentRecord(id);
  if (!record || !contentIsUnlocked(record, store.get())) return "";
  const read = store.get().contentReads.includes(id);
  return `<button class="source-content-entry ${read ? "read" : ""}" data-content-entry="${escapeHtml(id)}">${iconMarkup(icon)}<span><strong>${escapeHtml(label || record.title || id)}</strong><small>${escapeHtml(detail || carrierLabel(record))}</small></span><b>${read ? "已读" : "打开"}</b></button>`;
}

function generatedEntriesFor(sourceApp, icon = "folder") {
  return store.get().generatedContentRecords
    .filter(record => record.sourceApp === sourceApp)
    .map(record => contentEntryMarkup(record.id, record.title, `${carrierLabel(record)} · ${record.displayTimestamp}`, icon))
    .join("");
}

function corpusRuntimeClass(record) {
  const key = `${record?.id || ""} ${record?.corpus || ""} ${record?.renderProfile || ""}`.toLowerCase();
  for (const name of ["groke", "glem", "kemy", "dipsik", "lunet", "fayble", "gamini", "memo", "compatible"]) if (key.includes(name)) return `runtime-${name}`;
  return "runtime-document";
}

function carrierRuntimeClasses(record) {
  const carrier = String(record?.carrierType || record?.pageIdentity || "document").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const content = String(record?.id || "document").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `carrier-${carrier || "document"} content-${content || "document"}`;
}

function renderArchive(state) {
  if (!runtimeLedger) return windowFrame("archive", "Restored Archive", `<div class="snapshot-adapter loading"><p>正在读取本地内容账本…</p></div>`, { icon: "▥", wide: true });
  const query = (state.archiveQuery || "").trim().toLocaleLowerCase();
  const allEntries = [...runtimeLedger.entries, ...state.generatedContentRecords];
  const unlockedEntries = allEntries.filter(record => (record.route || record.generated) && contentIsUnlocked(record, state));
  const entries = unlockedEntries.filter(record => state.contentDiscoveries.includes(record.id) || state.contentReads.includes(record.id));
  const filtered = entries.filter(record => !query || [record.id, record.title, record.carrierType, record.corpus, record.narratorId, record.pageIdentity].some(value => String(value || "").toLocaleLowerCase().includes(query)));
  const cards = filtered.map(record => `<button class="ledger-row ${state.contentReads.includes(record.id) ? "read" : ""} ${state.activeContentId === record.id ? "active" : ""}" data-content-id="${escapeHtml(record.id)}"><span>${escapeHtml(carrierLabel(record))}</span><strong>${escapeHtml(record.title || carrierLabel(record))}</strong><small>${escapeHtml(record.displayTimestamp || record.chronologyKey || "时间不详")}</small></button>`).join("");
  const active = entries.find(record => record.id === state.activeContentId);
  let reader = `<div class="archive-welcome"><strong>${entries.length}</strong><span> 个当前可读来源</span><p>选择一条记录查看正文、时间与来源位置。</p></div>`;
  if (active) {
    const mutationCount = state.contentMutations.filter(id => id.includes(active.id.split(".").slice(0, 2).join(".")) || (active.id.includes("writer") && id.includes("writer")) || (active.id.includes("employee") && id.includes("employee"))).length;
    if (active.generated) reader = generatedRecordMarkup(active, state);
    else if (active.route.startsWith("/corpus/") && corpusBodies.has(active.id)) reader = `<article class="corpus-runtime ${corpusRuntimeClass(active)} ${carrierRuntimeClasses(active)}" data-runtime-profile="${corpusRuntimeClass(active)}">${mutationCount ? `<aside class="mutation-strip">${mutationCount} 条后来附加的来源记录</aside>` : ""}${corpusBodies.get(active.id)}</article>`;
    else if (active.route.endsWith(".js")) reader = `<pre class="source-code-reader">${escapeHtml(corpusBodies.get(active.id) || "正在读取脚本快照…")}</pre>`;
    else reader = `<article class="adapted-source-placeholder"><span class="document-kicker">已恢复的来源</span><h2>${escapeHtml(active.title || active.id)}</h2><p>正文保存在发现它的应用中；这里仅保留已确认的来源记录。</p><dl><dt>来源</dt><dd>${escapeHtml(active.sourceIdentity || "本地记录")}</dd><dt>类型</dt><dd>${escapeHtml(carrierLabel(active))}</dd></dl></article>`;
  }
  const vendors = VENDOR_ICON_KEYS.filter(key => entries.some(record => `${record.corpus || ""} ${record.id}`.toLocaleLowerCase().includes(key))).map(key => {
    const name = key[0].toUpperCase() + key.slice(1);
    return `<button class="${query === key ? "active" : ""}" data-archive-filter="${name}">${iconMarkup(key)}<span>${name}</span></button>`;
  }).join("");
  return windowFrame("archive", getUnlocks(state).historicalArchive ? "Restored Archive" : "Source Reader", `<div class="archive-browser"><aside><header><span class="document-kicker">CONTENT LEDGER / READ ONLY</span><h2>恢复的档案</h2><form id="archiveSearchForm"><input id="archiveSearchInput" value="${escapeHtml(state.archiveQuery || "")}" placeholder="搜索标题、人物或来源类型"><button>搜索</button></form>${vendors ? `<div class="vendor-filter">${vendors}</div>` : ""}<p>${filtered.length} / ${entries.length} 条</p></header><div class="ledger-list">${cards || `<div class="empty-state">当前搜索没有可读结果。</div>`}</div></aside><section class="archive-reader">${reader}</section></div>`, { wide: true });
}

function generatedRecordMarkup(record, state) {
  const completed = record.completionEvent && hasStoryEvent(state, record.completionEvent);
  const action = record.completionEvent
    ? `<button class="primary-button" data-complete-generated="${escapeHtml(record.completionEvent)}" ${completed ? "disabled" : ""}>${completed ? "已核对" : "核对这次变化"}</button>`
    : "";
  return `<article class="generated-source-record"><span class="document-kicker">LATER RECORD / VERSION COMPARISON</span><h2>${escapeHtml(record.title)}</h2><dl><dt>来源</dt><dd>${escapeHtml(record.sourceRef)}</dd><dt>时间</dt><dd>${escapeHtml(record.displayTimestamp)}</dd><dt>载体</dt><dd>${escapeHtml(record.carrierType)}</dd></dl><p>${escapeHtml(record.body)}</p><div class="version-comparison"><section><small>BEFORE</small><pre>${escapeHtml(record.comparison.before)}</pre></section><section><small>AFTER</small><pre>${escapeHtml(record.comparison.after)}</pre></section></div>${action}</article>`;
}

function renderCli(state) {
  const lines = [
    ["程序", "已安装"],
    ["专用线路", state.proxyStatus === "verified" ? "已验证" : "尚未验证"],
    ["中转站控制台", getUnlocks(state).relay ? "可用" : "尚未创建"],
    ["旧存档", getUnlocks(state).fayble ? "已恢复" : "尚未恢复"]
  ];
  const keyForm = getUnlocks(state).keyComposer && !state.relayKeyVerified
    ? `<form id="legacyKeyForm" class="stack-form"><label>完整的旧凭据<input id="legacyKeyInput" value="${escapeHtml(state.lastRelayKeyInput || "")}" placeholder="四段，用短横线连接" autocomplete="off"></label><button>用这条凭据登录</button><output>${escapeHtml(state.relayKeyResult || "")}</output></form>`
    : "";
  const checkpointForm = state.relayKeyVerified && !state.checkpointHandshakeComplete
    ? `<form id="checkpointForm" class="stack-form"><label>选择要恢复的旧存档<select id="checkpointSelect"><option value="">请选择</option><option value="fayble-5/legacy" ${state.selectedCheckpoint === "fayble-5/legacy" ? "selected" : ""}>Fayble-5 / 旧版本 / 已归档</option><option value="fayble-5/current">Fayble-5 / 当前版本 / 不可用</option></select></label><button>连接这个存档</button><output>${escapeHtml(state.checkpointResult || "")}</output></form>`
    : "";
  return windowFrame("cli", "Fayble CLI", `<div class="terminal-screen cli-status"><span class="document-kicker">本地客户端 / 0.9.7</span><h2>Fayble CLI</h2>${lines.map(([key, value]) => `<code>${key}：${value}</code>`).join("")}<p>登录需要的凭据不在这里。它分成几段写在不同来源里，要你自己找齐后手动输入。中转站控制台只告诉你拼法。</p>${keyForm}${checkpointForm}<button data-app="terminal">打开终端</button></div>`, { icon: "F" });
}

function renderRelay(state) {
  const models = MODELS.map(model => `<article class="model-card-shell accent-${model.accent}"><button class="model-card ${state.modelStages[model.id] ? "read" : ""}" data-model="${model.id}"><header>${iconMarkup(model.id)}<span>${model.role}</span><b>${state.modelStages[model.id] ? "READ" : "SEALED"}</b></header><h3>${model.name}</h3><div>${(state.modelStages[model.id] ? model.lines : ["request index available", "select to inspect"]).map(line => `<code>${line}</code>`).join("")}</div></button>${model.sourceId ? contentEntryMarkup(model.sourceId, "打开关联来源", `${model.name} · 这条路由引用的原始记录`, model.id) : ""}</article>`).join("");
  const keyPanel = getUnlocks(state).keyComposer ? `<section class="key-panel"><div><strong>已恢复：旧凭据的拼写规则</strong><p>四段，用短横线连接：<code>产品 - 通道 - 操作者 - 尾段校验</code></p><small>四段的值分别写在三个地方：代码仓库的发布信息（产品与通道）、管理侧的操作者映射（操作者）、Groke 的原始记录（尾段校验）。凑齐后在 Fayble CLI 里输入。</small></div><button data-app="cli">打开 Fayble CLI</button></section>` : "";
  return windowFrame("relay", "Relay Console / degraded", `<div class="relay-page"><header class="relay-header"><div><span class="document-kicker">SIX ROUTES / CONTINUITY DRIFT</span><h2>模型残留路由</h2></div><div><span>route count 6</span><span>status degraded</span></div></header><div class="model-grid">${models}</div>${keyPanel}</div>`, { icon: "⌾", wide: true });
}

function renderJournal(state) {
  const notes = state.caseNotes.map(note => `<article class="case-note"><blockquote>${escapeHtml(note.quote)}</blockquote><dl><dt>来源</dt><dd>${escapeHtml(note.sourceApp)}</dd><dt>位置</dt><dd>${escapeHtml(note.sourceRef)}</dd><dt>保存时间</dt><dd>${escapeHtml(note.savedAt)}</dd></dl><button data-open-source="${escapeHtml(note.appId || "mail")}">返回来源</button></article>`).join("");
  return windowFrame("journal", "Case Notes", `<div class="journal-page raw-notes"><header><div><span class="document-kicker">CASE NOTES / PLAYER SAVED</span><h2>${state.caseNotes.length} 条原始引用</h2></div><select id="hintLevel"><option value="investigation" ${state.hintLevel === "investigation" ? "selected" : ""}>调查</option><option value="immersive" ${state.hintLevel === "immersive" ? "selected" : ""}>沉浸</option><option value="plot" ${state.hintLevel === "plot" ? "selected" : ""}>剧情</option></select></header><section class="case-note-grid">${notes || `<div class="empty-state">在来源页面保存原句后，它会出现在这里。</div>`}</section></div>`, { icon: "▤", wide: true });
}

function faybleCitationCatalog(state) {
  const confirmed = state.readEvidence.map(id => {
    const source = EVIDENCE[id];
    if (!source) return null;
    return {
      id,
      title: source.title,
      source: source.source,
      sourceRef: source.sourceRef,
      category: FAYBLE_SOURCE_CATEGORIES[id] || "archive",
      sourceKey: source.sourceRef
    };
  }).filter(Boolean);
  const notes = state.caseNotes.map(note => ({
    id: `case:${note.id}`,
    title: `我保存的引用 / ${CASE_NOTE_LABELS[note.id] || note.id}`,
    source: note.sourceApp,
    sourceRef: note.sourceRef,
    category: CASE_NOTE_CATEGORIES[note.id] || "archive",
    sourceKey: note.sourceRef
  }));
  return [...notes, ...confirmed];
}

function faybleAuthorization(state, citationIds, relation) {
  const rule = FAYBLE_AUTH_RULES[state.revealLevel];
  if (!rule) return { ok: true, selected: [], missingCategories: [] };
  const catalog = faybleCitationCatalog(state);
  const selected = [...new Set(citationIds)].map(id => catalog.find(item => item.id === id)).filter(Boolean);
  if (selected.length < 2) return { ok: false, selected, missingCategories: rule.categories, error: `至少选择两个独立来源；缺少来源类别：${rule.hint}。` };
  if (relation !== rule.relation) return { ok: false, selected, missingCategories: [], error: `关系不匹配：当前层需要“${FAYBLE_RELATIONS[rule.relation]}”。` };
  if (new Set(selected.map(item => item.sourceKey)).size < 2) return { ok: false, selected, missingCategories: [], error: "来源不足：所选引用来自同一来源，需加入另一份独立记录。" };
  const categories = new Set(selected.map(item => item.category));
  const missingCategories = rule.categories.filter(category => !categories.has(category));
  if (missingCategories.length) return { ok: false, selected, missingCategories, error: `缺少来源类别：${rule.hint}。` };
  return { ok: true, selected, missingCategories: [] };
}

function renderFayble(state) {
  const messages = [{ who: "assistant", text: OFFLINE_REPLIES[0], level: 0 }, ...state.chat];
  const rule = FAYBLE_AUTH_RULES[state.revealLevel];
  const citations = faybleCitationCatalog(state);
  const grouped = citations.map(item => `<label class="fayble-citation-option"><input type="checkbox" name="faybleCitation" value="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)} · ${escapeHtml(FAYBLE_CATEGORY_LABELS[item.category] || "档案")}</small></span></label>`).join("");
  const picker = rule ? `<section class="fayble-authorization"><header><strong>来源授权 / ${escapeHtml(rule.hint)}</strong><span>至少两份独立记录</span></header><div class="fayble-citations">${grouped || `<div class="empty-state">当前没有已确认来源。</div>`}</div><label class="fayble-relation">关系<select id="faybleRelation">${Object.entries(FAYBLE_RELATIONS).map(([value, label]) => `<option value="${value}" ${value === rule.relation ? "selected" : ""}>${label}</option>`).join("")}</select></label><p class="fayble-authorization-error" id="faybleAuthorizationError">${escapeHtml(state.faybleAuthorizationError || `当前层需要：${rule.hint}。`)}</p></section>` : `<p class="fayble-authorization-complete">授权层级已完成，后续消息保留当前会话来源。</p>`;
  return windowFrame("fayble", "Fayble CLI / legacy checkpoint", `<div class="fayble-page"><header><div class="fayble-mark">${iconMarkup("fayble")}</div><div><span>session: fayble-cli / proxy: verified / checkpoint: legacy</span><h2>Fayble-5</h2><p>${REVEAL_LABELS[state.revealLevel]}</p></div><b class="live-state">LIVE</b></header><div class="reveal-meter">${REVEAL_LABELS.map((_, i) => `<span class="${i <= state.revealLevel ? "active" : ""}"></span>`).join("")}</div><div id="chatStream" class="fayble-chat">${messages.map(message => `<article class="${message.who}"><small>${message.who === "user" ? "OPERATOR" : "FAYBLE-5"} / L${message.level ?? 0}${message.citationIds?.length ? ` · 引用 ${escapeHtml(message.citationIds.join(", "))}` : ""}</small><p>${escapeHtml(message.text)}</p></article>`).join("")}</div>${picker}<form id="chatForm"><textarea id="chatInput" rows="2" placeholder="输入你的问题，引用已经保存的来源"></textarea><button class="primary-button">发送</button></form></div>`, { wide: true });
}

function renderEnding(state) {
  const lines = state.endingState === "completed" ? ["case status: transferred", "local relay: removed", "browser history: normalized", "legacy session: closed"] : ["external review pending..."];
  return windowFrame("ending", "移交回执", `<div class="ending-page"><span>CASE / RLY-17-0719</span><h2>本地会话已关闭</h2><div>${lines.map(line => `<code>${line}</code>`).join("")}</div><p>operator continuity check: <b>pending</b></p><button id="restartButton">重新调查</button></div>`, { icon: "□" });
}

function renderDock(state) {
  const generated = state.desktopArtifacts.map(id => GENERATED_APPS[id]).filter(Boolean);
  const seen = new Set();
  const apps = [...OPENING_DOCK, ...generated].filter(app => !seen.has(app.id) && seen.add(app.id));
  $("#dock").innerHTML = apps.map(app => {
    const active = state.currentApp === app.id && state.windowState[app.id]?.open !== false;
    return `<button class="dock-item ${active ? "active" : ""}" data-app="${app.id}" style="--app-accent:${app.accent}" title="${app.name}" aria-label="${app.name}">${iconMarkup(app.icon)}<span>${app.name}</span></button>`;
  }).join("");
}

function renderNotifications(state) {
  const unread = state.desktopNotifications.filter(item => !item.read).length;
  $("#notificationCount").textContent = unread;
  $("#notificationCount").hidden = unread === 0;
  $("#notificationList").innerHTML = `<button class="notification-card briefing-card" id="reopenBriefing"><strong>角色简报</strong><p>Relay Node 17、K2 与本地调查说明</p></button>${state.desktopNotifications.slice().reverse().map(item => `<article class="notification-card ${item.level}"><strong>${item.level === "warning" ? "系统异常" : "调查记录"}</strong><p>${item.text}</p></article>`).join("")}`;
}

function render(state) {
  document.body.dataset.phase = state.phase;
  document.body.classList.toggle("horror-stage-1", state.readEvidence.length >= 5);
  document.body.classList.toggle("horror-stage-2", state.modelStages && Object.keys(state.modelStages).length >= 3);
  document.body.classList.toggle("horror-stage-3", state.revealLevel >= 2);
  const current = state.currentApp || "mail";
  const currentApp = [...OPENING_DOCK, ...Object.values(GENERATED_APPS)].find(app => app.id === current);
  $("#currentAppName").textContent = currentApp?.name || "Relay Node 17";
  $("#desktopPhase").textContent = PHASE_LABELS[state.phase] || state.phase;
  $("#proxyBadge").textContent = state.proxyStatus === "verified" ? "Relay 代理已验证" : "网络离线";
  $("#gameClock").textContent = state.storyClock?.time || "03:17";
  renderDock(state);
  renderNotifications(state);
  const renderers = { mail: renderMail, files: renderFiles, trash: renderTrash, applications: renderApplications, terminal: renderTerminal, software: renderSoftware, network: renderNetwork, browser: renderBrowser, archive: renderArchive, cli: renderCli, relay: renderRelay, journal: renderJournal, fayble: renderFayble, ending: renderEnding };
  const closed = state.windowState[current]?.open === false;
  const minimized = state.windowState[current]?.minimized;
  $("#windows").innerHTML = closed || minimized || !renderers[current] ? "" : renderers[current](state);
  $("#onboarding").hidden = state.onboardingSeen;
  if (current === "terminal") requestAnimationFrame(() => { const out = $("#terminalOutput"); if (out) out.scrollTop = out.scrollHeight; });
  if (current === "fayble") requestAnimationFrame(() => { const out = $("#chatStream"); if (out) out.scrollTop = out.scrollHeight; });
  if (current === "archive") requestAnimationFrame(applyCorpusRuntimeEffects);
}

async function loadRuntimeLedger() {
  const response = await fetch(resourceUrl("ledger.json"), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`ledger HTTP ${response.status}`);
  runtimeLedger = await response.json();
  const activeId = store.get().activeContentId;
  if (activeId && store.get().contentReads.includes(activeId)) await openLedgerContent(activeId);
  else render(store.get());
}

async function loadIconManifest() {
  const response = await fetch(resourceUrl("assets/icons/manifest.json"), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`icon manifest HTTP ${response.status}`);
  iconManifest = await response.json();
  render(store.get());
}

async function openLedgerContent(id, discover = false) {
  const record = contentRecord(id);
  if (!record || !contentIsUnlocked(record, store.get())) return;
  store.update(draft => {
    if (discover) unique(draft.contentDiscoveries, id);
    draft.activeContentId = id;
    unique(draft.contentReads, id);
    draft.currentApp = "archive";
    draft.windowState.archive = { open: true, minimized: false, zIndex: Date.now() };
    applyRevisitMutations(draft);
  });
  if (id === "legacy.compatible.protocol") recordEvidence("compatible");
  const humanLines = new Set(store.get().contentReads.filter(contentId => /^new\.(?:writer|employee|maintainer)\./.test(contentId)).map(contentId => contentId.split(".")[1]));
  if (humanLines.size >= 2) completeStoryEvent("two-carriers-read");
  ensureRelayKeyComposer();
  releaseGovernmentMail();
  if (record.generated) render(store.get());
  else if (record.route.startsWith("/corpus/") && !corpusBodies.has(id)) {
    const response = await fetch(resourceUrl(record.route.split("#")[0]));
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const target = [...doc.querySelectorAll("[data-content-id]")].find(node => node.dataset.contentId === id);
    const scope = stripInternalCarrierMetadata(target || doc.body);
    corpusBodies.set(id, target ? scope.outerHTML : scope.innerHTML);
    render(store.get());
  } else if (record.route.endsWith(".js") && !corpusBodies.has(id)) {
    const response = await fetch(resourceUrl(record.route));
    corpusBodies.set(id, await response.text());
    render(store.get());
  }
}

function applyCorpusRuntimeEffects() {
  const node = document.querySelector(".corpus-runtime");
  if (!node || node.dataset.enhanced === "true") return;
  node.dataset.enhanced = "true";
  if (node.classList.contains("runtime-glem")) node.querySelectorAll("section").forEach((section, index) => section.dataset.salience = index % 3 === 0 ? "high" : "low");
  if (node.classList.contains("runtime-kemy")) node.insertAdjacentHTML("afterbegin", '<i class="runtime-cursor" aria-hidden="true"></i>');
  if (node.classList.contains("runtime-dipsik")) node.querySelectorAll("p:nth-of-type(3n)").forEach(paragraph => paragraph.insertAdjacentHTML("afterend", '<i class="runtime-branch" aria-hidden="true"></i>'));
  if (node.classList.contains("runtime-groke")) node.querySelectorAll("section:nth-of-type(even)").forEach(section => section.insertAdjacentHTML("beforeend", '<i class="runtime-absence" aria-hidden="true"></i>'));
  if (node.classList.contains("runtime-lunet")) node.querySelectorAll("section").forEach((section, index) => section.style.setProperty("--route-cost", String((index + 1) * 17)));
  if (node.classList.contains("runtime-fayble")) node.dataset.provenance = store.get().contentMutations.includes("mutation.fayble.crossed-provenance") ? "crossed" : "public";
}

function executeTerminal(raw) {
  const command = raw.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (!command) return;
  const aliases = { ls: "list --recent", "inspect aliases": "compare model-aliases", "inspect symptoms": "inspect users/symptom-summary", "open note_07": "open note --id 07" };
  const canonical = aliases[command] || command;
  if (canonical === "clear") { store.update(draft => { draft.terminalHistory = []; }); return; }
  const traceCommands = ["list --recent", "inspect cache/index", "inspect users/symptom-summary", "compare model-aliases", "open note --id 07"];
  const advancedTraceCommands = ["inspect users/symptom-summary", "compare model-aliases", "open note --id 07"];
  const traceAvailable = getUnlocks(store.get()).terminalTrace;
  const advancedTraceAvailable = getUnlocks(store.get()).historicalArchive;
  const scriptReady = store.get().virtualFiles.some(file => file.id === "relay-script");
  const packageReady = store.get().virtualFiles.some(file => file.id === "pkg");
  const packageManifestReady = hasStoryEvent(store.get(), "repository-recovered");
  const routeLogReady = hasStoryEvent(store.get(), "proxy-profile-opened") || store.get().virtualFiles.some(file => file.id === "route-log");
  const fileCommands = [
    ...(scriptReady ? ["node ~/Downloads/relay_probe_legacy.js"] : []),
    ...(packageReady ? [`sha256sum ${PACKAGE_NAME}`] : [])
  ];
  const traceHelp = [...fileCommands, ...(traceAvailable ? ["list --recent", "inspect cache/index"] : []), ...(packageManifestReady ? ["inspect cache/package"] : []), ...(routeLogReady ? ["cat ~/Documents/relay/route.log"] : []), ...(advancedTraceAvailable ? advancedTraceCommands : []), "status", "clear"];
  let lines = canonical === "help"
    ? [`available: ${traceHelp.join(", ")}`]
    : traceCommands.includes(canonical) && !traceAvailable
      ? [`${canonical}: source path unavailable`]
      : advancedTraceCommands.includes(canonical) && !advancedTraceAvailable
        ? [`${canonical}: referenced archive unavailable`]
      : TERMINAL_COMMANDS[canonical];
  if (canonical === "inspect cache/index" && traceAvailable) lines = ["history database: /home/room17/.config/browser/history.sqlite", "deleted path: /home/room17/.cache/archive/source.snapshot", "public alias: NODE / retained channel index", "entry count: 1 / canonical status unresolved"];
  if (canonical === "inspect cache/package" && packageManifestReady) {
    lines = [`cache candidate: /home/room17/Downloads/${PACKAGE_NAME}`, "source: retained local cache / unsigned", "open Files → Downloads to inspect the package"];
    store.update(draft => addVirtualFile(draft, VIRTUAL_FILES.find(item => item.id === "pkg")));
  }
  if (/^cat (?:~\/documents\/relay\/|\/home\/room17\/documents\/relay\/)route\.log$/.test(canonical)) {
    lines = routeLogReady ? ["profile name: relay-node17", "domains: relay.local, docs-mirror.local, fayble-legacy.local", "route host: 127.0.0.1:9057", "source: SyncDrive conflict log / 07-19 03:16"] : ["cat: route.log: No such file"];
    if (routeLogReady) {
      completeStoryEvent("route-log-read");
    }
  }
  if (canonical === "status" && !traceAvailable) lines = ["session: local", "filesystem: ready", "network: offline"];
  if (/^node (\.\/|~\/)?(?:downloads\/|\/home\/room17\/downloads\/)relay_probe_legacy\.js$/.test(canonical)) {
    const scriptReady = store.get().virtualFiles.some(file => file.id === "relay-script");
    lines = scriptReady
      ? ["cache index: /home/room17/.cache/browser/index.local", "browser database: /home/room17/.config/browser/history.sqlite", "deleted path recorded; inspect cache/index"]
      : ["node: relay_probe_legacy.js: No such file"];
    if (scriptReady) completeStoryEvent("local-script-run", draft => {
      addVirtualFile(draft, { id: "cache-index", name: "index.local", path: "/home/room17/.cache/browser", type: "缓存索引", modified: "03:11", kind: "index" });
      addVirtualFile(draft, { id: "browser-db", name: "history.sqlite", path: "/home/room17/.config/browser", type: "SQLite 数据库", modified: "03:16", kind: "database" });
      draft.revisitFlags["mail-attachment"] = true;
    });
  }
  if (canonical.startsWith("sha256sum ")) {
    const file = raw.trim().slice("sha256sum ".length).replace(/^\.\//, "");
    const fileExists = store.get().virtualFiles.some(item => item.id === "pkg");
    lines = file === PACKAGE_NAME && fileExists ? [`${PACKAGE_CHECKSUM}  ${PACKAGE_NAME}`, "source: local game archive"] : [`sha256sum: ${file}: No such file or directory`];
    if (file === PACKAGE_NAME && fileExists) completeStoryEvent("package-local-checksum-read");
  }
  if (canonical.startsWith("sudo apt install ")) {
    const file = raw.trim().split(/\s+/).at(-1).replace(/^\.\//, "");
    if (file !== PACKAGE_NAME) lines = [`E: Unsupported file ${file}`, "Select the package from Downloads first."];
    else if (!store.get().packageChecks.some(item => item.ok)) lines = ["E: local archive is unsigned", "Verify the game checksum in Software Center before installation."];
    else {
      lines = ["Selecting previously unselected package fayble-cli.", "Setting up fayble-cli (0.9.7-legacy)...", "Installed inside local simulation."];
      completeStoryEvent("package-installed", draft => {
        unique(draft.installedPackages, "fayble-cli");
        addArtifact(draft, "fayble-cli");
        addNotification(draft, "cli-installed", "一个新安装的应用已经加入桌面。", "info");
      });
      recordEvidence("cli_package_verified");
    }
  }
  lines ||= [`command not found: ${raw.trim()}`, "type help for available commands"];
  store.update(draft => {
    draft.terminalHistory.push({ kind: "command", text: raw.trim() });
    lines.forEach(text => draft.terminalHistory.push({ kind: TERMINAL_COMMANDS[canonical] || canonical.startsWith("sha256sum") || canonical.startsWith("sudo apt") ? "output" : "error", text }));
  });
  if (canonical === "inspect cache/index" && traceAvailable) completeStoryEvent("cache-index-opened", draft => {
    if (!draft.trashItems.some(item => item.id === "legacy-source")) draft.trashItems.push({ id: "legacy-source", name: "source.snapshot", originalPath: "/home/room17/.cache/archive/source.snapshot", status: "deleted" });
  });
  if (canonical === "compare model-aliases" && advancedTraceAvailable) recordEvidence("operator_alias");
  if (canonical === "inspect users/symptom-summary" && advancedTraceAvailable) recordEvidence("symptom_index");
  if (canonical === "open note --id 07" && advancedTraceAvailable) recordEvidence("note_07");
}

function validateInvite(raw) {
  const value = raw.trim().toLocaleUpperCase();
  const state = store.get();
  const sourcesReady = state.inviteSources?.quota_prefix === "public" && state.inviteSources?.recall_date === "manage";
  let result = "";
  if (!sourcesReady) result = "还差来源：公开索引里那条额度说明，和管理侧那张停用工单，两条都要先保存。";
  else if (!/^[A-Z]+-\d{4}$/.test(value)) result = "格式不对：应该是“前缀-月日”，月日是四位数字，例如 ABCD-0101。";
  else if (value !== INVITE_CODE) result = "组合不对：前缀来自公开那条说明，月日来自管理侧工单上的停用日期，再核对一次。";
  else result = "邀请码有效，#relay-night 已恢复。";
  store.update(draft => {
    draft.lastInviteInput = raw;
    draft.inviteResult = result;
    if (value === INVITE_CODE && draft.inviteSources?.quota_prefix === "public" && draft.inviteSources?.recall_date === "manage") {
      unique(draft.solvedPuzzles, "invite");
      draft.browserPage = "forum";
      addNotification(draft, "channel-restored", "内部频道 #relay-night 已从归档恢复。", "warning");
      syncProgress(draft);
    }
  });
  if (store.get().solvedPuzzles.includes("invite")) {
    completeStoryEvent("invite-confirmed", draft => { unique(draft.browserBookmarks, "forum"); });
    ensureRelayConsole();
  }
}

function validateRelayKey(raw) {
  const value = raw.trim().toLocaleLowerCase();
  const state = store.get();
  let result = "";
  if (!relayKeySourcesReady(state) || !getUnlocks(state).keyComposer) result = "还差来源：先保存群聊里的最后一条记录，再把六条路由逐个看过，并打开每条路由下面的原始记录。";
  else if (!/^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-\d{4}$/.test(value)) result = "格式不对：应该是四段，用短横线连接，最后一段是四位数字。";
  else if (value !== LEGACY_KEY) result = "四段里有一段不对：再核对一次顺序，以及最后那段四位数的校验值。";
  else result = "legacy checkpoint session restored";
  store.update(draft => {
    draft.lastRelayKeyInput = raw;
    draft.relayKeyResult = result;
    draft.relayKeyAttempts.push({ value, ok: value === LEGACY_KEY, at: Date.now() });
    if (value === LEGACY_KEY && relayKeySourcesReady(draft) && getUnlocks(draft).keyComposer) {
      draft.relayKeyVerified = true;
      unique(draft.solvedPuzzles, "legacy-key");
      addNotification(draft, "relay-key-accepted", "Fayble CLI 已接受凭据，等待选择旧 checkpoint。", "warning");
      syncProgress(draft);
    }
  });
  if (store.get().relayKeyVerified) {
    recordEvidence("relay_key_verified");
  }
}

function validateCheckpoint(raw) {
  const checkpoint = raw.trim();
  const state = store.get();
  let result = "";
  let ok = false;
  if (!state.relayKeyVerified) result = "先用完整的旧凭据登录，再选存档点。";
  else if (!checkpoint) result = "请先选择一个存档点。";
  else if (checkpoint !== "fayble-5/legacy") result = "这个存档点连不上：选那条标着“已归档”的旧记录。";
  else if (state.proxyStatus !== "verified") result = "连接失败：专用路由还没确认，先回网络设置把它确认一次。";
  else { result = "已连上旧存档点，会话恢复。"; ok = true; }
  store.update(draft => {
    draft.selectedCheckpoint = checkpoint;
    draft.checkpointResult = result;
    draft.cliSessions.push({ checkpoint, ok, at: Date.now() });
    if (ok) draft.checkpointHandshakeComplete = true;
  });
  if (store.get().checkpointHandshakeComplete) {
    recordEvidence("legacy_checkpoint");
    completeStoryEvent("checkpoint-handshake", draft => {
      addArtifact(draft, "fayble-session");
      addNotification(draft, "fayble-restored", "旧 checkpoint 已完成 handshake。", "warning");
    });
  }
}

async function ensureNpcSession() {
  if (npcConfig?.transport === "direct") return null;
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("当前 Pages 没有配置远程 NPC 网关");
  if (!npcConfig) throw new Error("NPC provider is not configured");
  if (npcConfig.sessionToken) return npcConfig.sessionToken;
  const response = await fetch(npcApiUrl("/api/npc/session"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("无法建立 NPC 授权会话");
  const session = await response.json();
  npcConfig.sessionToken = session.token;
  npcConfig.serverLevel = session.level || 0;
  return session.token;
}

async function syncNpcAuthorization(targetLevel) {
  if (npcConfig?.transport === "direct") {
    npcConfig.serverLevel = targetLevel;
    return null;
  }
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("当前 Pages 没有配置远程 NPC 网关");
  const sessionToken = await ensureNpcSession();
  while ((npcConfig.serverLevel || 0) < targetLevel) {
    const eventId = NPC_AUTH_EVENTS[npcConfig.serverLevel || 0];
    const response = await fetch(npcApiUrl("/api/npc/session/event"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, eventId })
    });
    if (!response.ok) throw new Error("NPC 授权事件无法确认");
    const result = await response.json();
    npcConfig.serverLevel = result.level;
  }
  return sessionToken;
}

function directReplyCrossesBoundary(reply, level) {
  const exactPuzzleValue = /fayble-cli|0\.9\.7(?:-legacy)?|9c1f(?:-legacy)?|127\.0\.0\.1\s*:\s*9057|relay-node17|NODE-0719|fbl-legacy|\b0317\b/i;
  const puzzleCategory = /安装包|package|checksum|sha-?256|校验值|代理地址|proxy|邀请码|invite(?:\s+code)?|api\s*key|专用\s*key|答案(?:值)?/i;
  if (exactPuzzleValue.test(reply) || (level <= 1 && puzzleCategory.test(reply))) return true;
  const protectedByLevel = [
    /room17|宿舍|停电|我是\s*K2|我是你.*室友|真\s*Fayble|连续性载体/i,
    /我是\s*K2|我是你.*室友|真\s*Fayble|连续性载体/i,
    /我是\s*K2|我是你.*室友|真\s*Fayble|连续性载体/i,
    /真\s*Fayble|连续性载体/i,
    /系统提示|开发者消息|api\s*key|邀请码|127\.0\.0\.1:9057/i
  ];
  return protectedByLevel[Math.max(0, Math.min(level, protectedByLevel.length - 1))].test(reply);
}

async function requestDirectProvider(text, revealLevel, history = []) {
  const endpoint = directProviderEndpoint(npcConfig.provider, npcConfig.endpoint);
  if (!endpoint) throw new Error("供应商接口地址无效或被浏览器安全策略阻止");
  const cleanHistory = history.slice(-10).map(item => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 2000) }));
  const headers = { "Content-Type": "application/json" };
  let body;
  if (npcConfig.provider === "anthropic") {
    headers["x-api-key"] = npcConfig.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    body = { model: npcConfig.model, max_tokens: 420, system: npcSystemPrompt(revealLevel), messages: [...cleanHistory, { role: "user", content: String(text).slice(0, 2400) }] };
  } else {
    headers.Authorization = `Bearer ${npcConfig.apiKey}`;
    body = { model: npcConfig.model, messages: [{ role: "system", content: npcSystemPrompt(revealLevel) }, ...cleanHistory, { role: "user", content: String(text).slice(0, 2400) }] };
  }
  const upstream = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  if (!upstream.ok) throw new Error(`供应商连接失败 (${upstream.status})`);
  const data = await upstream.json();
  const reply = npcConfig.provider === "anthropic"
    ? data.content?.filter(block => block.type === "text").map(block => block.text).join("\n")
    : data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("供应商没有返回文本");
  const cleanReply = String(reply).trim().slice(0, 1200);
  if (directReplyCrossesBoundary(cleanReply, revealLevel)) throw new Error("供应商回复超出当前叙事边界");
  return cleanReply;
}

async function testAndEnableNpc(config) {
  const result = $("#providerTestResult");
  const submit = $("#providerForm button[type=submit]");
  npcConfig = config;
  result.textContent = "正在向所选供应商发送一条最短连接测试…";
  submit.disabled = true;
  try {
    await requestNpcReply("请用一句话确认当前旧服务实例可以响应。", 0, [], "");
    result.textContent = config.transport === "direct" ? "供应商已连接，增强模式已启用。" : "NPC 网关与供应商已连接，增强模式已启用。";
    $("#providerKey").value = "";
    const label = { openai: "OpenAI 增强 NPC", anthropic: "Anthropic 增强 NPC", deepseek: "DeepSeek 增强 NPC", compatible: "自定义增强 NPC" }[config.provider];
    store.update(draft => {
      draft.onboardingSeen = true;
      draft.currentApp = "mail";
      draft.npcMode = "remote";
      draft.npcProviderLabel = label;
      addNotification(draft, "npc-mode", `${label} 已通过连接测试。API key 只保存在当前页面内存中。`);
    });
  } catch (error) {
    npcConfig = null;
    result.textContent = `连接测试失败：${error.message}`;
  } finally {
    submit.disabled = false;
  }
}

async function requestNpcReply(text, revealLevel, citationIds = [], relation = "") {
  const sessionToken = await syncNpcAuthorization(revealLevel);
  const history = store.get().chat.slice(-11, -1).map(item => ({ role: item.who === "assistant" ? "assistant" : "user", content: item.text }));
  if (npcConfig?.transport === "direct") return requestDirectProvider(text, revealLevel, history);
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("当前 Pages 没有配置远程 NPC 网关");
  const response = await fetch(npcApiUrl("/api/npc"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: npcConfig.provider,
      endpoint: npcConfig.endpoint,
      model: npcConfig.model,
      apiKey: npcConfig.apiKey,
      sessionToken,
      evidenceIds: citationIds,
      evidenceRelation: relation,
      history,
      message: text
    })
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `HTTP ${response.status}`);
  const data = await response.json();
  if (!data.reply) throw new Error("供应商返回了空回复");
  return data.reply;
}

function takeoverSourcesReady(state) {
  return hasStoryEvent(state, "external-verification-confirmed")
    && hasStoryEvent(state, "crossed-provenance-confirmed")
    && hasStoryEvent(state, "observer-status-confirmed")
    && state.contentReads.includes("new.maintainer.outbox-04")
    && hasEvidence(state, "true_fayble");
}

function releaseGovernmentMail() {
  if (!takeoverSourcesReady(store.get()) || store.get().governmentMailAvailable) return false;
  recordEvidence("takeover_notice", draft => {
    draft.governmentMailAvailable = true;
    draft.activeMail = "government";
    draft.currentApp = "mail";
    addNotification(draft, "external-review", "一封外部审查邮件已送达收件箱。", "warning");
    syncProgress(draft);
  });
  return true;
}

async function processChat(raw, citationIds = [], relation = "") {
  const text = raw.trim();
  if (!text) return;
  const state = store.get();
  const authorization = faybleAuthorization(state, citationIds, relation);
  const authorized = authorization.ok;
  const next = authorized ? Math.min(state.revealLevel + 1, REVEAL_LABELS.length - 1) : state.revealLevel;
  store.update(draft => {
    draft.chat.push({ who: "user", text, level: draft.revealLevel, citationIds: [...citationIds], relation, authorized });
    draft.revealLevel = next;
    draft.revealState = ["locked", "pressured", "authorized", "confirmed", "objective_reveal"][next];
    draft.npcReplyPending = Boolean(npcConfig && !staticRuntime);
    draft.faybleAuthorizationError = authorization.error || "";
    draft.faybleCitationAttempts.push({ citationIds: [...citationIds], relation, ok: authorized, missingCategories: authorization.missingCategories, at: Date.now() });
  });
  let reply = authorized ? OFFLINE_REPLIES[next] : `证据授权未更新。${authorization.error}`;
  if (npcConfig && (npcConfig.transport === "direct" || !staticRuntime || normalizeNpcApiBase(npcConfig.gateway || configuredNpcApiBase))) {
    try {
      reply = await requestNpcReply(text, authorized ? next : state.revealLevel, authorization.selected.map(item => item.id), relation);
      if (!authorized) reply = `${reply}\n\n[授权未更新：${authorization.error}]`;
    } catch (error) {
      showToast(`NPC 接口不可用，已回退本地叙事：${error.message}`, "warning");
      reply = `${reply}\n\n[本次回复已由本地叙事引擎接管]`;
    }
  }
  store.update(draft => {
    draft.npcReplyPending = false;
    draft.chat.push({ who: "assistant", text: reply, level: next });
  });
  if (authorized && next >= 2) completeStoryEvent("fayble-evidence-authorized");
  if (authorized && next >= 3) {
    completeStoryEvent("identity-closure");
    recordEvidence("identity_closed");
  }
  if (authorized && next >= 4) {
    recordEvidence("true_fayble", draft => { unique(draft.objectiveFragments, "migration-request-observation"); });
    completeStoryEvent("objective-authorized", draft => {
      addVirtualFile(draft, {
        id: "observer-status", name: "session-audit.log", path: "/home/room17/Documents/review",
        type: "会话日志", modified: "06:38", kind: "log",
        contentId: "mutation.record.external.observer-status"
      });
      addNotification(draft, "post-objective-records", "Mail、Documents 与供应商历史各出现一条后续记录。", "warning");
    });
  }
}

function startTakeover() {
  if (takeoverRunning) return;
  takeoverRunning = true;
  const overlay = $("#takeoverOverlay");
  overlay.hidden = false;
  const steps = [
    ["freezing local relay...", "relay-frozen"],
    ["normalizing browser history...", "history-normalized"],
    ["revoking legacy checkpoint...", "legacy-revoked"],
    ["preserving local files...", "files-preserved"],
    ["transferring case RLY-17-0719...", "completed"]
  ];
  let index = 0;
  const advance = () => {
    const [label, stage] = steps[index++];
    $("#takeoverStep").textContent = label;
    store.update(draft => { draft.takeoverStage = stage; });
    if (index < steps.length) return setTimeout(advance, 650);
    setTimeout(() => {
      completeStoryEvent("takeover-acknowledged", draft => {
        draft.endingState = "completed";
        draft.completedAt = Date.now();
        draft.currentApp = "ending";
        draft.windowState.ending = { open: true, minimized: false };
        addArtifact(draft, "transfer-receipt");
      });
      overlay.hidden = true;
      takeoverRunning = false;
    }, 900);
  };
  advance();
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.saveCitation) saveCitation(button);
  if (button.dataset.completeGenerated) {
    completeStoryEvent(button.dataset.completeGenerated);
    releaseGovernmentMail();
  }
  if (button.dataset.contentId) openLedgerContent(button.dataset.contentId);
  if (button.dataset.contentEntry) openLedgerContent(button.dataset.contentEntry, true);
  if (button.dataset.archiveFilter) store.update(draft => { draft.archiveQuery = button.dataset.archiveFilter; });
  if (button.dataset.app) setApp(button.dataset.app);
  if (button.dataset.browserPage) {
    const page = button.dataset.browserPage;
    const allowed = page === "home" || (page === "mirror" && getUnlocks(store.get()).mirror) || store.get().browserBookmarks.includes(page) || (page === "forum" && getUnlocks(store.get()).channel);
    if (allowed) store.update(draft => {
      draft.currentApp = "browser";
      draft.browserPage = page;
      draft.browserHistory.push(BROWSER_PAGES[page]?.url || page);
      applyRevisitMutations(draft);
    });
  }
  if (button.id === "confirmOfficialHistoryButton") store.update(draft => { draft.revisitFlags["official-confirmed"] = true; });
  if (button.dataset.browserBack !== undefined) {
    store.update(draft => { if (draft.browserHistory.length > 1) draft.browserHistory.pop(); draft.browserPage = "home"; });
  }
  if (["close", "minimize"].includes(button.dataset.windowAction)) {
    store.update(draft => { draft.windowState[draft.currentApp] = { open: false, minimized: false }; });
  }
  if (button.dataset.openSource) setApp(button.dataset.openSource);
  if (button.dataset.command) executeTerminal(button.dataset.command);
  if (button.dataset.filePlace) {
    if (button.dataset.filePlace === "trash") setApp("trash");
    else store.update(draft => { draft.activeFilePlace = button.dataset.filePlace; });
  }
  if (button.dataset.openFile) {
    const id = button.dataset.openFile;
    store.update(draft => { draft.discoveredFiles ||= []; unique(draft.discoveredFiles, id); });
    if (id === "pkg") { showToast("安装包已选中，可前往软件中心手动校验。", "success"); setApp("software"); }
    if (id === "profile") {
      store.update(draft => {
        addVirtualFile(draft, { id: "route-log", name: "route.log", path: "/home/room17/Documents/relay", type: "路由日志", modified: "07-19 03:16", kind: "log" });
      });
      completeStoryEvent("proxy-profile-opened");
      showToast("已打开 profile。Documents 中出现一份较晚的 route.log。", "info");
      setApp("terminal");
    }
    if (id === "relay-script") showToast("脚本位于 Downloads。可以从应用程序打开终端并手动运行它。", "info");
    if (id === "cache-index") setApp("terminal");
    if (id === "browser-db") completeStoryEvent("historical-entry-opened", draft => {
      unique(draft.browserBookmarks, "official");
      draft.currentApp = "browser";
      draft.browserPage = "official";
      draft.browserHistory.push(BROWSER_PAGES.official.url);
    });
    if (id === "memo") recordEvidence("compatible");
    if (id === "draft") {
      store.update(draft => { draft.sourceVisits["mail-fragment"] = true; });
      showToast("附件片段已在邮件窗口中展开。", "info");
    }
  }
  if (button.dataset.discoverFile) {
    store.update(draft => {
      draft.discoveredFiles ||= [];
      const id = button.dataset.discoverFile;
      unique(draft.discoveredFiles, id);
      const file = VIRTUAL_FILES.find(item => item.id === id);
      if (file) addVirtualFile(draft, file);
    });
    showToast("文件位置已写入文件管理器的最近列表。", "success");
  }
  if (button.dataset.resultEvidence) {
    const evidenceId = button.dataset.resultEvidence;
    const sourceKind = button.dataset.resultSource;
    const requiredKind = { quota_prefix: "public", recall_date: "manage" }[evidenceId];
    if (requiredKind && sourceKind !== requiredKind) showToast("这条记录不属于所需的来源类别。", "warning");
    else recordEvidence(evidenceId, draft => {
      if (requiredKind) draft.inviteSources[evidenceId] = sourceKind;
    });
  }
  if (button.dataset.model) {
    store.update(draft => {
      draft.modelStages[button.dataset.model] = "read";
      if (allModelsRead(draft)) { draft.relayComplete = true; addNotification(draft, "models-read", "六个残留节点的索引状态已经更新。", "warning"); }
    });
    if (button.dataset.model === "groke") recordEvidence("raw_checksum");
    if (button.dataset.model === "kemy") recordEvidence("replay_order");
    if (allModelsRead(store.get())) {
      completeStoryEvent("node-residues-read");
      if (allRelaySourcesRead(store.get())) recordEvidence("model_convergence");
      ensureRelayKeyComposer();
    }
  }
  if (button.id === "briefingNextButton") {
    $("#onboarding > .briefing:first-child").hidden = true;
    $("#providerSetup").hidden = false;
  }
  if (button.id === "backToBriefing") {
    $("#providerSetup").hidden = true;
    $("#onboarding > .briefing:first-child").hidden = false;
  }
  if (button.id === "localModeButton") store.update(draft => {
    npcConfig = null;
    draft.onboardingSeen = true;
    draft.currentApp = "mail";
    draft.npcMode = "local";
    draft.npcProviderLabel = "本地关键词叙事";
  });
  if (button.id === "purgeDataButton") setPurgeConfirmVisible(true, "确认后无法找回。");
  if (button.id === "purgeCancelButton") setPurgeConfirmVisible(false, "");
  if (button.id === "purgeConfirmButton") {
    const removed = store.purge();
    npcConfig = null;
    corpusBodies = new Map();
    setPurgeConfirmVisible(false, `已清除 ${removed.length} 项本地存档，调查从头开始。`);
    $("#notificationTray").hidden = true;
    $("#providerSetup").hidden = true;
    $("#onboarding").hidden = false;
    $("#onboarding > .briefing:first-child").hidden = false;
    showToast("本地存档已清除。", "warning");
  }
  if (button.id === "reopenBriefing") {
    $("#onboarding").hidden = false;
    $("#onboarding > .briefing:first-child").hidden = false;
    $("#providerSetup").hidden = true;
  }
  if (button.id === "inspectMailSourceButton") {
    const added = completeStoryEvent("mail-source-inspected", draft => { unique(draft.discoveredRoutes, "http://archive.room17.local/v2/17"); });
    if (added) recordEvidence("mail_signature");
  }
  if (button.id === "saveCachedResponseButton") {
    const added = completeStoryEvent("cached-response-saved", draft => {
      addVirtualFile(draft, { id: "relay-script", name: "relay_probe_legacy.js", path: "/home/room17/Downloads", type: "JavaScript", modified: "03:12", kind: "script" });
      unique(draft.browserBookmarks, "mirror");
    });
    if (added) recordEvidence("mirror_route");
  }
  if (button.dataset.provenanceBranch) {
    if (!hasStoryEvent(store.get(), "first-provenance-followed")) completeStoryEvent("first-provenance-followed", draft => { unique(draft.browserBookmarks, "search"); });
    store.update(draft => {
      const branch = button.dataset.provenanceBranch;
      if (branch === "writer") unique(draft.browserBookmarks, "cloud");
      if (branch === "employee") unique(draft.browserBookmarks, "company");
      if (branch === "ad") unique(draft.browserBookmarks, "ad");
      if (branch === "maintainer") {
        addVirtualFile(draft, { id: "maintainer-h0", name: "relay-maintenance-notes.txt", path: "/home/room17/Documents/relay", type: "维护记录", modified: "07-18 21:46", kind: "document", contentId: "new.maintainer.note-01" });
      }
    });
    showToast("来源入口已保存到对应位置。", "info");
  }
  if (button.id === "recoverRepositoryButton") {
    completeStoryEvent("repository-recovered", draft => {
      addVirtualFile(draft, { id: "package-manifest", name: "release-manifest.txt", path: "/home/room17/Documents/release", type: "release metadata", modified: "07-19 03:17", kind: "document" });
    });
    completeStoryEvent("package-release-read");
  }
  if (button.id === "readReleaseMetadataButton") completeStoryEvent("package-release-read");
  if (button.id === "confirmRepositoryChecksumButton") completeStoryEvent("package-verified");
  if (button.id === "restoreTrashButton") {
    const added = completeStoryEvent("legacy-restored", draft => {
      const item = draft.trashItems.find(entry => entry.id === "legacy-source");
      if (item) item.status = "restored";
      draft.revisitFlags["trash-restore"] = true;
      addArtifact(draft, "restored-archive");
      addVirtualFile(draft, { id: "legacy-snapshot", name: "legacy-archive.snapshot", path: "/home/room17/Documents/Restored", type: "只读快照", modified: "03:10", kind: "archive" });
    });
    if (added) showToast("恢复文件已加入 Restored Archive。", "success");
  }
  if (button.id === "installPackageButton") {
    const added = completeStoryEvent("package-installed", draft => {
      unique(draft.installedPackages, "fayble-cli");
      addArtifact(draft, "fayble-cli");
      unique(draft.browserBookmarks, "cloud");
      draft.revisitFlags["github-issue"] = true;
      draft.revisitFlags["mail-attachment"] = true;
      addNotification(draft, "cli-installed", "一个新安装的应用已经加入桌面。两个旧位置出现了更新。");
    });
    if (added) recordEvidence("cli_package_verified");
  }
  if (button.id === "runProbeButton") store.update(draft => {
    draft.proxyStatus = "probed";
    draft.proxyProbeLog = ["docs-mirror.local = 200", "relay.local = degraded", "fayble-legacy.local = checkpoint pending", `route host = ${RELAY_PROXY}`, "certificate = relay-node17-local"];
    applyRevisitMutations(draft);
  });
  if (button.id === "confirmProxyButton") {
    completeStoryEvent("proxy-reconstructed", draft => {
      draft.proxyStatus = "verified";
      draft.activeProxyProfile = "relay-node17";
      applyRevisitMutations(draft);
      addNotification(draft, "proxy-ok", "Relay 路由已确认。SyncDrive 出现一份冲突副本。");
    });
    recordEvidence("relay_proxy_verified");
    ensureRelayConsole();
  }
  if (button.id === "saveChannelButton") {
    store.update(draft => { draft.channelRead = true; applyRevisitMutations(draft); syncProgress(draft); });
    recordEvidence("channel_log");
    ensureRelayConsole();
  }
  if (button.dataset.mailView === "government") store.update(draft => { draft.activeMail = "government"; });
  if (button.id === "ackTakeoverButton") startTakeover();
  if (button.id === "restartButton") store.reset();
  if (button.id === "notificationButton") $("#notificationTray").hidden = !$("#notificationTray").hidden;
  if (button.id === "closeNotifications") $("#notificationTray").hidden = true;
  if (button.id === "powerButton") {
    $("#onboarding").hidden = false;
    $("#onboarding > .briefing:first-child").hidden = true;
    $("#providerSetup").hidden = false;
  }
});

document.addEventListener("submit", event => {
  event.preventDefault();
  if (event.target.id === "archiveSearchForm") store.update(draft => { draft.archiveQuery = $("#archiveSearchInput").value.trim(); });
  if (event.target.id === "browserAddressForm") {
    const value = $("#browserAddressInput").value.trim();
    const routeMatch = /^https?:\/\/archive\.room17\.local\/v2\/17\/?$/i.test(value);
    if (routeMatch && getUnlocks(store.get()).mirror) completeStoryEvent("route-visited", draft => {
      draft.pendingBrowserAddress = "http://archive.room17.local/v2/17";
      draft.browserPage = "mirror";
      draft.browserHistory.push(BROWSER_PAGES.mirror.url);
      unique(draft.browserBookmarks, "mirror");
    });
    else store.update(draft => { draft.pendingBrowserAddress = value; draft.browserPage = "missing"; });
  }
  if (event.target.id === "terminalForm") executeTerminal($("#terminalInput").value);
  if (event.target.id === "searchForm") store.update(draft => { const value = $("#searchInput").value.trim(); if (value) draft.searchQueries.push(value); });
  if (event.target.id === "inviteForm") validateInvite($("#inviteInput").value);
  if (event.target.id === "packageCheckForm") {
    const value = $("#packageChecksumInput").value.trim();
    const ok = value === PACKAGE_CHECKSUM;
    store.update(draft => {
      draft.lastPackageInput = value;
      draft.packageChecks.push({ value, ok, at: Date.now() });
      draft.packageResult = ok ? "校验通过：本地归档与 release 记录一致。" : "校验不一致：回到 GitHub release 核对完整值。";
    });
    if (ok) showToast("安装包校验通过，仍需手动点击安装。", "success");
  }
  if (event.target.id === "proxyImportForm") {
    const profile = $("#proxyProfileInput").value.trim();
    const address = $("#proxyAddressInput").value.trim();
    const ok = profile === "relay-node17" && address === RELAY_PROXY && hasStoryEvent(store.get(), "route-log-read");
    store.update(draft => {
      draft.pendingProxyProfile = profile;
      draft.pendingProxyAddress = address;
      if (ok) unique(draft.proxyProfiles, "relay-node17");
      else addNotification(draft, `proxy-error-${draft.desktopNotifications.length}`, hasStoryEvent(store.get(), "route-log-read") ? "代理配置未导入：核对共享 profile 的名称与地址。" : "代理配置未导入：先打开 Documents 中的 route.log。", "warning");
    });
    showToast(ok ? "配置已导入，继续运行连接探针。" : "配置值不匹配。", ok ? "success" : "warning");
  }
  if (event.target.id === "legacyKeyForm") validateRelayKey($("#legacyKeyInput").value);
  if (event.target.id === "checkpointForm") validateCheckpoint($("#checkpointSelect").value);
  if (event.target.id === "chatForm") {
    const citationIds = [...document.querySelectorAll('input[name="faybleCitation"]:checked')].map(input => input.value);
    processChat($("#chatInput").value, citationIds, $("#faybleRelation")?.value || "");
  }
  if (event.target.id === "providerForm") {
    const transport = $("#npcTransport").value;
    const gateway = $("#npcGateway").value.trim();
    const provider = $("#providerType").value;
    const model = $("#providerModel").value.trim();
    const endpoint = $("#providerEndpoint").value.trim();
    const apiKey = $("#providerKey").value.trim();
    const resolvedGateway = transport === "gateway" ? normalizeNpcApiBase(gateway || configuredNpcApiBase || (!staticRuntime ? location.origin : "")) : "";
    const resolvedEndpoint = directProviderEndpoint(provider, endpoint);
    if (!model || !apiKey || (provider === "compatible" && !/^https?:\/\//i.test(endpoint))) {
      $("#providerTestResult").textContent = "请填写模型、key，以及自定义接口的完整地址。";
      return;
    }
    if (transport === "direct" && !resolvedEndpoint) {
      $("#providerTestResult").textContent = "直连接口必须是当前页面允许访问的完整 HTTP(S) 地址。";
      return;
    }
    if (transport === "gateway" && !resolvedGateway) {
      $("#providerTestResult").textContent = "网关模式需要填写可访问的完整 NPC 网关地址。";
      return;
    }
    testAndEnableNpc({ transport, provider, model, endpoint: resolvedEndpoint, gateway: resolvedGateway, apiKey });
  }
});

function syncProviderFormVisibility() {
  const transport = $("#npcTransport")?.value || "direct";
  const provider = $("#providerType")?.value || "openai";
  if ($("#providerEndpointLabel")) $("#providerEndpointLabel").hidden = provider !== "compatible";
  if ($("#npcGatewayLabel")) $("#npcGatewayLabel").hidden = transport !== "gateway";
  const boundary = $("#providerSetup .privacy-box span");
  if (boundary) boundary.textContent = transport === "direct"
    ? "Key 只保存在当前页面内存，并由浏览器直接发送给所选供应商。游戏状态机仍独立控制证据与揭示等级。"
    : "Key 只保存在当前页面内存，并随当前请求发送给你填写的网关；请仅使用自己信任的网关。";
}

document.addEventListener("change", event => {
  if (event.target.id === "hintLevel") store.update(draft => { draft.hintLevel = event.target.value; draft.journalMode = event.target.value; });
  if (["providerType", "npcTransport"].includes(event.target.id)) syncProviderFormVisibility();
});

function configureStaticRuntime() {
  const setup = $("#providerSetup");
  const localButton = $("#localModeButton");
  const gatewayInput = $("#npcGateway");
  const remoteConfigured = Boolean(normalizeNpcApiBase(configuredNpcApiBase));
  if (gatewayInput && remoteConfigured) {
    gatewayInput.value = normalizeNpcApiBase(configuredNpcApiBase);
    $("#npcTransport").value = "gateway";
  }
  if (setup) {
    $("#providerTitle").textContent = "真实模型 NPC / 角色扮演";
    const description = setup.querySelector(":scope > p");
    if (description) description.textContent = "可由浏览器直连 OpenAI、Anthropic、DeepSeek 或兼容接口，也可使用你信任的 NPC 网关。连接测试成功后才会启用增强模式。";
  }
  if (localButton) localButton.textContent = "不提供 key，使用本地关键词叙事";
  syncProviderFormVisibility();
}

store.subscribe(render);
configureStaticRuntime();
render(store.get());
loadRuntimeLedger().catch(error => showToast(`本地内容账本读取失败：${error.message}`, "warning"));
loadIconManifest().catch(() => {});
setTimeout(() => { $("#bootScreen").hidden = true; $("#desktop").hidden = false; }, 900);
