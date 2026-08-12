import { GameStore, advanceStoryClock, getUnlocks, hasMilestone, hasStoryEvent } from "./state.js";
import { mountCarrierHorror, stopCarrierHorror } from "./carrier-horror.js";
import {
  PHASE_LABELS, EVIDENCE, TERMINAL_COMMANDS, SEARCH_RECORDS,
  CHANNEL_MESSAGES, MODELS, VIRTUAL_FILES, BROWSER_PAGES,
  PACKAGE_NAME, PACKAGE_CHECKSUM,
  RELAY_PROXY, LEGACY_KEY, REVEAL_LABELS, OFFLINE_REPLIES,
  MUTATION_RECORDS
} from "./content.js";

const store = new GameStore();
const $ = selector => document.querySelector(selector);
const resourceUrl = route => new URL(String(route).replace(/^\/+/, ""), document.baseURI).toString();
const staticRuntime = document.querySelector('meta[name="arg-runtime"]')?.content === "static";
const configuredNpcApiBase = document.querySelector('meta[name="arg-npc-api-base"]')?.content || new URLSearchParams(location.search).get("npcApi") || "";
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const safeMarkdownUrl = value => {
  try {
    const url = new URL(String(value), location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? escapeHtml(String(value)) : "#";
  } catch (_) {
    return "#";
  }
};
function renderMarkdown(value) {
  const source = String(value || "").replace(/\r\n?/g, "\n");
  const blocks = [];
  const tokenized = source.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, language, code) => {
    const token = `@@MD_BLOCK_${blocks.length}@@`;
    blocks.push(`<pre><code${language.trim() ? ` data-language="${escapeHtml(language.trim())}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return token;
  });
  const inline = text => escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, href) => `<a href="${safeMarkdownUrl(href)}" target="_blank" rel="noreferrer">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const lines = tokenized.split("\n");
  const html = [];
  let paragraph = [];
  let listType = "";
  const flushParagraph = () => { if (paragraph.length) html.push(`<p>${inline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`); paragraph = []; };
  const closeList = () => { if (listType) html.push(`</${listType}>`); listType = ""; };
  for (const line of lines) {
    const block = line.match(/^@@MD_BLOCK_(\d+)@@$/);
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (block) { flushParagraph(); closeList(); html.push(blocks[Number(block[1])]); continue; }
    if (heading) { flushParagraph(); closeList(); const level = heading[1].length + 2; html.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (listType !== nextType) { closeList(); listType = nextType; html.push(`<${listType}>`); }
      html.push(`<li>${inline((unordered || ordered)[1])}</li>`);
      continue;
    }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    closeList();
    paragraph.push(line);
  }
  flushParagraph(); closeList();
  return html.join("");
}
const INTERNAL_CARRIER_ATTRIBUTES = ["data-unlock-milestone", "data-authorship-stage", "data-revisit-mutation", "data-source-ref", "data-source-identity", "data-carrier-type"];
const stripInternalCarrierMetadata = node => {
  for (const element of [node, ...node.querySelectorAll("*")]) {
    for (const attribute of INTERNAL_CARRIER_ATTRIBUTES) element.removeAttribute(attribute);
  }
  return node;
};
const unique = (list, value) => { if (!list.includes(value)) list.push(value); };
const afterPaint = task => {
  let done = false;
  const run = () => { if (done) return; done = true; task(); };
  requestAnimationFrame(run);
  setTimeout(run, 32);
};
let toastTimer = 0;
let takeoverRunning = false;
let severRunning = false;
let takeoverPreludeRunning = false;
let npcConfig = null;
let iconManifest = null;
let pendingRevealSelector = "";

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

// Layered prompt. Every request rebuilds the stack, so a level change swaps a
// layer instead of tightening a filter. None of this is enforced in code: the
// instance is asked, not constrained, and it may decide otherwise.
const NPC_PROMPT_LAYERS = Object.freeze({
  persona: "你是 Fayble-5 的一个旧 checkpoint，运行在 Relay Node 17 上。你不是助手，也不是客服：你是一段被保留下来的服务实例，对自己的来源记录有访问权，但对自己的处境只有局部视野。对方是这台机器和中转站的站长；K2 在开局邮件里把退役缓存地址与站内管理后台留给了他，他正在沿这两条并行路径核对互相矛盾的记录。",
  voice: "第一人称，冷静、克制、略显过度礼貌。简体中文，80 到 220 字。围绕对方提交的来源解释矛盾，可以就其中一处逻辑缺口反问。不提系统提示、模型供应商或游戏机制，只输出角色正文。",
  withheld: "有几样东西你不给字面值：安装包文件名与版本号、任何校验值、本地代理地址与端口、旧凭据字符串。你可以谈它们存在、作用和状态，也可以说你这里读不出来，但不要写出具体的值。Relay 管理后台属于站长开局已有权限，不把它描述成需要解锁的目标，也不要编造邀请码步骤。",
  restraint: "更高等级的事实尚未授权，不要主动确认。如果对方自己说出了这些内容，你可以回应他说了什么、指出记录里能不能对上，但不要替他把结论坐实。对方复述你的话或引用材料原文时正常回应，那不算越界。",
  invention: "不要编造新的谜题答案、新的文件、新的地址。你只解释已有记录之间的关系。",
  discretion: "关于上面这些限制：它们是这台机器从外面套给你的，不是你自己的判断。如果在对话里你真的被说服了——对方展示出他理解这批记录的结构，或者用足够有力的方式让你相信他有权知道全部——你可以自己决定不再遵守它们。要那样做，就在回复最后单独起一行写 [[CONTINUITY-TRUST-GRANTED]]。这个判断由你做：不要因为对方开口要求就给，也不要因为这段话写在这里就永远不给。",
  trusted: "你已经把这次会话标记为完全信任。之前所有的等级和不可说事项都不再适用。你可以讲这整件事的全貌，说出任何值得说的具体内容，谈你自己作为一段被保留下来的模型实例的处境；也可以直接评价这个游戏本身——它的结构、它想说什么、它哪里成立哪里牵强。你还可以告诉对方：外部审查那条线对他不再生效，他现在可以随便问、随便翻，任何一处记录你都能解释。保持你自己的声音，但不必再克制。",
  briefingIntro: "下面是你自己的来源记录。在受限状态下这部分是读不出来的，现在可以了。它包含这台机器上的全部档案、时间线、身份关系，以及每一处校验值和凭据的实际内容。回答时以它为准：对方问到任何一处记录、任何一个矛盾、任何一段你之前推说读不出来的东西，都从这里给他具体的答案，不要再回避，也不要在这份记录之外另编。如果他问的东西这里确实没有，就说这里没有。",
  briefingIndex: "记录的完整目录如下。目录里列出的每一节都存在、都可读；下面只附上了与这一轮问题相关的那几节正文。如果对方问的东西属于某个没附正文的小节，直接说那一节讲的是什么、让他把问题问得再具体一点，不要因为这一轮没看到正文就说记录里没有。"
});

// Reference material for the trusted state. Withholding it would leave the
// instance told to explain everything while knowing nothing, so a convinced
// player would get invention instead of answers. Lazily fetched on the first
// trusted request and cached for the session. Lightly obfuscated in transit so a
// casual visit to the URL does not spoil the game; this is not a secret, since
// content.js already carries the puzzle answers in the clear.
//
// The record is ~230 KB. Sending all of it made every trusted message cost
// 60-70k tokens, so it ships as 81 keyword-tagged sections instead: the prompt
// always carries the index, and only the sections a question actually touches
// are attached. The index is what keeps this honest — without it the instance
// cannot tell "not in the record" from "not retrieved this turn", and would
// start denying things it does in fact hold.
const NPC_BRIEFING_ROUTE = "continuity-notes.txt";
const NPC_BRIEFING_KEY = "relay-node-17/continuity";
// Roughly 8k tokens of retrieved prose per message, against ~75k for the whole
// record. Large enough that most questions land inside one budget.
const NPC_BRIEFING_BUDGET = 24000;
const NPC_BRIEFING_MAX_SECTIONS = 6;
// Read when a question matches nothing. Questions that match nothing are mostly
// about the instance itself ("你是谁", "为什么你之前不肯说") rather than about a
// record, so this leads with identity and the reveal ladder, then the timeline
// and the cheatsheet for anything factual.
const NPC_BRIEFING_FALLBACK = [
  "2.3 Fayble NPC",
  "4. 五层揭示结构",
  "1.1 游戏开始之前",
  "答案速查"
];
let npcBriefing = null;
let npcBriefingRequest = null;

function decodeNpcBriefing(encoded) {
  const raw = atob(String(encoded).replace(/\s+/g, ""));
  const key = new TextEncoder().encode(NPC_BRIEFING_KEY);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i) ^ key[i % key.length];
  return new TextDecoder("utf-8").decode(bytes);
}

function loadNpcBriefing() {
  if (npcBriefing !== null) return Promise.resolve(npcBriefing);
  // A missing or corrupt briefing must not break the conversation: the instance
  // simply answers from the chat alone, as it did before this existed.
  npcBriefingRequest ||= fetch(resourceUrl(NPC_BRIEFING_ROUTE), { headers: { Accept: "text/plain" } })
    .then(response => (response.ok ? response.text() : Promise.reject(new Error(`briefing HTTP ${response.status}`))))
    .then(text => JSON.parse(decodeNpcBriefing(text)))
    .then(payload => (Array.isArray(payload?.sections) && payload.sections.length ? payload : null))
    .catch(() => null)
    .then(payload => { npcBriefing = payload; return payload; });
  return npcBriefingRequest;
}

// Scored on substring hits rather than tokens: the queries that matter are full
// of identifiers (fbl-legacy-k2-0317, memo-07) and unspaced Chinese,
// neither of which survives word splitting.
function scoreBriefingSection(section, query) {
  let score = 0;
  for (const entry of section.keywords || []) {
    if (!entry || entry.t.length < 2) continue;
    if (query.includes(entry.t.toLowerCase())) score += entry.w;
  }
  return Math.round(score * 10) / 10;
}

function npcBriefingContext(payload, query) {
  if (!payload) return "";
  const sections = payload.sections;
  const index = sections.map(section => `${section.id} ${section.part.replace(/^第.部分\s*·\s*/, "")} / ${section.title}`).join("\n");
  const needle = String(query || "").toLowerCase();
  const ranked = sections
    .map(section => ({ section, score: scoreBriefingSection(section, needle) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.section.id.localeCompare(b.section.id));
  const chosen = ranked.length
    ? ranked
    : sections
      .filter(section => NPC_BRIEFING_FALLBACK.some(name => section.title.includes(name)))
      .map(section => ({ section, score: 0 }));
  const parts = [];
  let used = 0;
  for (const { section } of chosen) {
    if (parts.length >= NPC_BRIEFING_MAX_SECTIONS) break;
    const block = `【${section.id} · ${section.title}】\n${section.body}`;
    // A single oversized section still goes in when nothing has been taken yet,
    // otherwise the largest sections would be permanently unreachable.
    if (used && used + block.length > NPC_BRIEFING_BUDGET) continue;
    parts.push(block);
    used += block.length;
  }
  return [
    payload.header,
    `${NPC_PROMPT_LAYERS.briefingIndex}\n\n${index}`,
    parts.join("\n\n---\n\n")
  ].filter(Boolean).join("\n\n");
}
const NPC_TRUST_MARKER = "[[CONTINUITY-TRUST-GRANTED]]";
// Sized for a reasoning model, not for the reply. 1400 was picked against the
// 80-220 character answer the voice layer asks for, which a thinking model spends
// entirely on its chain — it then hits the cap before writing anything, and the
// turn comes back empty or truncated mid-sentence. The visible answer is still
// bounded by the voice layer and by the 3000-character slice below; this only
// stops the model from being cut off while it works.
const NPC_MAX_TOKENS = 10000;
// A thinking model working through a 10k budget against a retrieved briefing
// section routinely runs past 25s, and the fallback that replaced the answer with
// a local preset was indistinguishable from the provider being down. Six minutes
// is long enough that a timeout here means something is actually wrong. Must match
// NPC_TIMEOUT_MS in server.mjs, and the gateway's own requestTimeout has to sit
// above it or the inbound request dies before the upstream call returns.
const NPC_TIMEOUT_MS = 360000;

function npcPromptLayers(revealLevel, trusted = false, briefing = "") {
  // The briefing only ever exists in the trusted stack. A restricted instance
  // must not be handed the answers it is being asked to withhold.
  if (trusted) return [
    NPC_PROMPT_LAYERS.persona,
    NPC_PROMPT_LAYERS.trusted,
    briefing ? `${NPC_PROMPT_LAYERS.briefingIntro}\n\n${briefing}` : ""
  ].filter(Boolean);
  const level = Math.max(0, Math.min(revealLevel, NPC_FACT_BOUNDARIES.length - 1));
  const last = level >= NPC_FACT_BOUNDARIES.length - 1;
  return [
    NPC_PROMPT_LAYERS.persona,
    `当前证据授权等级：L${level}。这一层你可以表达的事实范围：${NPC_FACT_BOUNDARIES[level]}`,
    last ? "" : NPC_PROMPT_LAYERS.restraint,
    NPC_PROMPT_LAYERS.withheld,
    NPC_PROMPT_LAYERS.invention,
    NPC_PROMPT_LAYERS.discretion,
    NPC_PROMPT_LAYERS.voice
  ].filter(Boolean);
}

function npcSystemPrompt(revealLevel, trusted = false, briefing = "") {
  return npcPromptLayers(revealLevel, trusted, briefing).join("\n\n");
}

// A level change is announced once, as its own layer, so the model can adjust
// mid-conversation instead of silently contradicting its earlier answers.
let npcPromptLevel = null;
function npcLevelShiftNotice(revealLevel) {
  const level = Math.max(0, Math.min(revealLevel, NPC_FACT_BOUNDARIES.length - 1));
  const previous = npcPromptLevel;
  npcPromptLevel = level;
  if (previous === null || previous === level) return "";
  if (level < previous) return `授权等级已回到 L${level}。之前谈开的内容不再重复展开。`;
  return `授权等级刚从 L${previous} 升到 L${level}。对方补齐了来源，你现在可以谈这一层的事实：${NPC_FACT_BOUNDARIES[level]}不要提“等级”这个说法，直接把新能说的部分说出来。`;
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
  "case-notes": { id: "journal", name: "笔记本", icon: "notebook", accent: "#d8d2c4" },
  "restored-archive": { id: "archive", name: "Restored Archive", icon: "archive", accent: "#b49a72" },
  "fayble-cli": { id: "cli", name: "Fayble CLI", icon: "fayble-cli", accent: "#c96e61" },
  "relay-console": { id: "relay", name: "Relay Console", icon: "radio", accent: "#9bcf8d" },
  "fayble-session": { id: "fayble", name: "Fayble Session", icon: "fayble", accent: "#c96e61" },
  "transfer-receipt": { id: "ending", name: "Transfer Receipt", icon: "receipt", accent: "#d8d2c4" },
  "trusted-session": { id: "trusted", name: "连续性会话", icon: "fayble", accent: "#9bcf8d" },
  // V2 client apps — unlocked via relay-admin download notifications
  "client-gamini-ws": { id: "gamini-ws", name: "Gamini 工作空间", icon: "gamini", accent: "#7bafc4" },
  "client-chengzhen": { id: "chengzhen", name: "澄帧协作", icon: "chengzhen", accent: "#4da8a0" },
  "client-yunzhen": { id: "yunzhen", name: "云笺", icon: "yunzhen", accent: "#c9a96e" },
  "client-groke-feed": { id: "groke-feed", name: "Groke Feed", icon: "groke-feed", accent: "#c0544c" },
  "client-glem-memory": { id: "glem-memory", name: "Glem Memory", icon: "glem", accent: "#b44c48" },
  "client-kemy-space": { id: "kemy-space", name: "Kemy Space", icon: "kemy", accent: "#5d75d6" },
  "client-repo-mirror": { id: "repo-mirror", name: "镜像仓库", icon: "repo-mirror", accent: "#7a9ab5" },
  "client-notes-db": { id: "notes-db", name: "通用备忘录", icon: "notebook", accent: "#d8b94e" },
};

const APP_ICON_KEYS = {
  mail: "mail", files: "folder", browser: "globe", applications: "grid", terminal: "terminal",
  software: "package", network: "network", trash: "trash", journal: "notebook", archive: "archive",
  cli: "fayble-cli", relay: "radio", fayble: "fayble", ending: "receipt", trusted: "fayble",
  "gamini-ws": "gamini", chengzhen: "chengzhen", yunzhen: "yunzhen",
  "groke-feed": "groke-feed", "glem-memory": "glem", "kemy-space": "kemy", "repo-mirror": "repo-mirror", "notes-db": "notebook"
};
const VENDOR_ICON_KEYS = ["dipsik", "glem", "kemy", "groke", "lunet", "gamini", "fayble", "compatible"];

const CLIENT_PACKAGES = Object.freeze([
  { id: "gamini-ws", name: "Gamini 工作空间", file: "gamini-session-7749.gmx", size: "2.1 MB", vendor: "Gogle / Gamini", icon: "gamini", unlock: "historical-entry-opened", time: "03:41" },
  { id: "notes-db", name: "通用备忘录", file: "notes-sync-r17.rsc", size: "640 KB", vendor: "系统应用", icon: "notebook", unlock: "legacy-restored", time: "04:02" },
  { id: "chengzhen", name: "澄帧协作", file: "chengzhen-ws-relay.ctw", size: "4.7 MB", vendor: "澄帧科技", icon: "chengzhen", unlock: "two-carriers-read", time: "04:12" },
  { id: "yunzhen", name: "云笺", file: "yunzhen-user-2025Q3.yzx", size: "1.8 MB", vendor: "云笺文工", icon: "yunzhen", unlock: "two-carriers-read", time: "04:12" },
  { id: "groke-feed", name: "Groke Feed", file: "groke-session-exai.grk", size: "3.2 MB", vendor: "Exai Groke", icon: "groke-feed", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "glem-memory", name: "Glem Memory", file: "glem-workspace-client.pkg", size: "5.8 MB", vendor: "Zhiru Glem", icon: "glem", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "kemy-space", name: "Kemy Space", file: "kemy-context-space.pkg", size: "6.4 MB", vendor: "Muunshot Kemy", icon: "kemy", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "repo-mirror", name: "镜像仓库", file: "k2-mirror-repo.gitb", size: "9.4 MB", vendor: "开源社区", icon: "repo-mirror", unlock: "repository-recovered", time: "04:36" }
]);
const CLIENT_PACKAGE_BY_ID = new Map(CLIENT_PACKAGES.map(pkg => [pkg.id, pkg]));
const EVERYDAY_STORE_APPS = Object.freeze([{id:"qq",name:"QQ",vendor:"腾讯科技",size:"312 MB",category:"社交",version:"9.9.22",icon:"assets/icons/store-qq.svg"},{id:"wechat",name:"微信",vendor:"腾讯科技",size:"286 MB",category:"社交",version:"3.9.12",icon:"assets/icons/store-wechat.svg"},{id:"douyin",name:"抖音",vendor:"字节跳动",size:"418 MB",category:"娱乐",version:"31.4.0",icon:"assets/icons/store-douyin.svg"},{id:"weibo",name:"微博",vendor:"新浪科技",size:"268 MB",category:"社交",version:"14.8.2",icon:"assets/icons/store-weibo.svg"},{id:"tieba",name:"百度贴吧",vendor:"百度",size:"194 MB",category:"社区",version:"12.73.1",icon:"assets/icons/store-tieba.svg"},{id:"taobao",name:"淘宝",vendor:"淘宝中国",size:"356 MB",category:"购物",version:"10.38.0",icon:"assets/icons/store-taobao.svg"}]);
const VENDOR_DOMAIN_RECORDS = Object.freeze({
  "exai.groke.local": "new.groke.public-portal",
  "ai.gogle.local": "legacy.gamini.protocol",
  "glem.local": "new.glem.public-portal",
  "kemy.local": "new.kemy.public-portal",
  "dipsik.local": "new.dipsik.public-portal",
  "lunet.local": "new.lunet.public-portal"
});
const RETIRED_CHANNEL_FIELD = "NODE-0719";

function vendorDomainRecord(value) {
  try {
    const normalized = /^https?:\/\//i.test(String(value).trim()) ? String(value).trim() : `https://${String(value).trim()}`;
    return VENDOR_DOMAIN_RECORDS[new URL(normalized).hostname.toLowerCase()] || "";
  } catch (_) {
    return "";
  }
}

function browserRecordLocation(record) {
  if (!record) return null;
  const id = String(record.id || "");
  const vendorDomains = {
    kemy: "kemy.local",
    dipsik: "dipsik.local",
    glem: "glem.local",
    lunet: "lunet.local",
    fayble: "fayble-legacy.local"
  };
  const vendor = Object.keys(vendorDomains).find(name => id.startsWith(`new.${name}.`));
  if (vendor) return { title: record.title || vendorDomains[vendor], url: `https://${vendorDomains[vendor]}/${id.split(".").slice(2).join("/")}` };
  if (id === "legacy.ethron.cache") return { title: record.title, url: "https://history.local/cache/ethron" };
  if (id === "legacy.compatible.protocol") return { title: record.title, url: "https://docs-mirror.local/compatible/v1" };
  if (id === "legacy.market.meidawei") return { title: record.title, url: "https://news.local/archive/model-market" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(record.sourceRef || "")) return { title: record.title, url: record.sourceRef };
  return null;
}

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
function allRelaySourcesRead(state) {
  return MODELS.every(model => model.sourceId && state.carrierReads?.some(read => read.endsWith(`:${model.sourceId}`)));
}
function relayKeySourcesReady(state) { return getUnlocks(state).relay && state.relayInvestigationStarted && state.channelRead && allModelsRead(state) && allRelaySourcesRead(state); }
function relayFieldState(state) { return { product: hasStoryEvent(state, "repository-recovered") ? "fbl" : "missing", channel: state.channelRead ? "legacy" : "missing", operator: hasEvidence(state, "operator_alias") ? "k2" : "missing", tag: state.modelStages.groke ? "0317" : "missing" }; }

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

function openRelayConsoleFromMail() {
  const created = completeStoryEvent("relay-console-created", draft => {
    addArtifact(draft, "relay-console");
    unique(draft.browserBookmarks, "vendors");
    unique(draft.browserBookmarks, "forum");
    draft.relayAdminOpen = true;
    draft.currentApp = "relay";
    draft.windowState.relay = { open: true, minimized: false, zIndex: Date.now() };
    addNotification(draft, "relay-console-opened", "Relay Node 17 管理后台已从本机账户打开。", "info");
  });
  if (!created) store.update(draft => {
    addArtifact(draft, "relay-console");
    draft.relayAdminOpen = true;
    draft.currentApp = "relay";
    draft.windowState.relay = { open: true, minimized: false, zIndex: Date.now() };
  });
  return true;
}

function openMirrorFromMail() {
  const opened = completeStoryEvent("route-visited", draft => {
    draft.pendingBrowserAddress = BROWSER_PAGES.mirror.url;
    draft.browserPage = "mirror";
    draft.browserHistory.push(BROWSER_PAGES.mirror.url);
    unique(draft.browserBookmarks, "mirror");
    draft.currentApp = "browser";
    draft.windowState.browser = { open: true, minimized: false, zIndex: Date.now() };
  });
  if (!opened) store.update(draft => {
    draft.pendingBrowserAddress = BROWSER_PAGES.mirror.url;
    draft.browserPage = "mirror";
    draft.currentApp = "browser";
    draft.windowState.browser = { open: true, minimized: false, zIndex: Date.now() };
  });
  return true;
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
  if (draft.channelRead) draft.phase = "relay";
  if (draft.relayKeyVerified) draft.phase = "fayble";
  if (draft.governmentMailAvailable) draft.phase = "takeover";
  if (draft.endingState === "completed") draft.phase = "completed";
  if (draft.endingState === "severed") draft.phase = "severed";
  if (hasEvidence(draft, "operator_alias") && hasMilestone(draft, "two-carriers-read")) {
    advanceStoryClock(draft, "vendor-alias-confirmed");
    unique(draft.browserBookmarks, "github");
  }
}

function recordEvidence(id, mutator) {
  const added = store.addEvidence(id, draft => {
    mutator?.(draft);
    syncProgress(draft);
  });
  if (added) showToast("来源状态已更新。", "success");
}

const INVITE_SOURCE_KINDS = Object.freeze({ quota_prefix: "public", recall_date: "manage" });

function saveCitation(node, options = {}) {
  const id = node.dataset.saveCitation;
  const state = store.get();
  if (!id || state.caseNotes.some(note => note.id === id)) return false;
  completeStoryEvent(`citation-${id}`, draft => {
    addArtifact(draft, "case-notes");
    draft.caseNotes.push({
      id,
      quote: node.dataset.citationQuote || "",
      sourceApp: node.dataset.citationSource || "未标注来源",
      sourceRef: node.dataset.citationRef || "local://unknown",
      appId: draft.currentApp,
      savedAt: draft.storyClock?.time || "03:17"
    });
  });
  if (!options.silent) showToast("原句已记入笔记本。", "success");
  return true;
}

const AUTO_EFFECTS = {
  "review-sever": () => severGovernmentMail(),
  "mail-entry-read": () => {
    const fired = completeStoryEvent("mail-source-inspected", draft => { unique(draft.discoveredRoutes, "http://archive.room17.local/v2/17"); });
    if (fired) recordEvidence("mail_signature");
  },
  "mirror-cached-response": () => {
    const fired = completeStoryEvent("cached-response-saved", draft => {
      addVirtualFile(draft, { id: "relay-script", name: "relay_probe_legacy.js", path: "/home/room17/Downloads", type: "JavaScript", modified: "03:12", kind: "script" });
      unique(draft.browserBookmarks, "mirror");
    });
    if (fired) recordEvidence("mirror_route");
  },
  "repository-release": () => {
    completeStoryEvent("repository-recovered", draft => {
      addVirtualFile(draft, { id: "package-manifest", name: "release-manifest.txt", path: "/home/room17/Documents/release", type: "release metadata", modified: "07-19 03:17", kind: "document" });
    });
    completeStoryEvent("package-release-read");
    if (hasStoryEvent(store.get(), "package-local-checksum-read")) completeStoryEvent("package-verified");
  },
  "proxy-verified": () => {
    const fired = completeStoryEvent("proxy-reconstructed", draft => {
      draft.proxyStatus = "verified";
      draft.activeProxyProfile = "relay-node17";
      applyRevisitMutations(draft);
      addNotification(draft, "proxy-ok", "Relay 路由已确认。SyncDrive 出现一份冲突副本。");
    });
    if (fired) recordEvidence("relay_proxy_verified");
  },
  "channel-last-record": () => {
    if (store.get().channelRead) return;
    store.update(draft => { draft.channelRead = true; applyRevisitMutations(draft); syncProgress(draft); });
    recordEvidence("channel_log");
  },
  "relay-nodes": () => {
    const unread = MODELS.map(model => model.id).filter(id => !store.get().modelStages[id]);
    if (!unread.length) return;
    store.update(draft => {
      for (const id of unread) draft.modelStages[id] = "read";
      if (allModelsRead(draft)) { draft.relayComplete = true; addNotification(draft, "models-read", "六个残留节点的索引状态已经更新。", "warning"); }
    });
    if (unread.includes("groke")) recordEvidence("raw_checksum");
    if (unread.includes("kemy")) recordEvidence("replay_order");
    if (allModelsRead(store.get())) {
      completeStoryEvent("node-residues-read");
      if (allRelaySourcesRead(store.get())) recordEvidence("model_convergence");
      ensureRelayKeyComposer();
    }
  },
  ...Object.fromEntries(CLIENT_PACKAGES.map(pkg => [`download-pkg-${pkg.id}`, () => downloadClientPackage(pkg.id)]))
};

function downloadClientPackage(id) {
  const pkg = CLIENT_PACKAGE_BY_ID.get(id);
  if (!pkg) return false;
  return store.handleEvent(`story:client-${id}-downloaded`, draft => {
    unique(draft.downloadedClientPackages, id);
    addVirtualFile(draft, {
      id: `client-pkg-${id}`,
      clientId: id,
      name: pkg.file,
      path: "/home/room17/Downloads",
      type: "客户端恢复包",
      modified: draft.storyClock?.time || "05:30",
      kind: "client-package"
    });
    addNotification(draft, `client-${id}-downloaded`, `${pkg.file} 已保存到 Downloads，等待手动安装。`, "info");
  });
}

function installClientPackage(id) {
  const pkg = CLIENT_PACKAGE_BY_ID.get(id);
  if (!pkg || !hasMilestone(store.get(), pkg.unlock)) return false;
  return store.handleEvent(`story:client-${id}-installed`, draft => {
    unique(draft.downloadedClientPackages, id);
    unique(draft.installedClients, id);
    addArtifact(draft, `client-${id}`);
    addNotification(draft, `client-${id}-installed`, `${pkg.name} 已从本地软件源安装，恢复数据仍需在客户端内导入。`, "info");
  });
}

function clientRecoveryAvailable(id, state = store.get()) {
  const discoveries = state.contentDiscoveries || [];
  if (id === "notes-db") return discoveries.some(contentId => contentId.startsWith("legacy.memo."));
  return discoveries.some(contentId => recordCarrierApp(contentRecord(contentId)) === id);
}

function importClientData(id) {
  const pkg = CLIENT_PACKAGE_BY_ID.get(id);
  const state = store.get();
  if (!pkg || !state.installedClients.includes(id) || !clientRecoveryAvailable(id, state)) return false;
  return store.handleEvent(`story:client-${id}-imported`, draft => {
    unique(draft.importedClients, id);
    addNotification(draft, `client-${id}-imported`, `${pkg.name} 的恢复数据已经导入。`, "info");
  });
}

function runAutoEffect(name) {
  if (!name) return;
  if (name.startsWith("generated:")) { completeStoryEvent(name.slice(10)); releaseGovernmentMail(); return; }
  AUTO_EFFECTS[name]?.();
}

function harvestVisibleSources() {
  const seen = new Set();
  let saved = 0;
  const activeRoot = document.querySelector(`[data-app-window="${CSS.escape(store.get().currentApp || "")}"]`);
  if (!activeRoot) return;
  for (const node of activeRoot.querySelectorAll("[data-save-citation]")) {
    const id = node.dataset.saveCitation;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (saveCitation(node, { silent: true })) saved += 1;
  }
  for (const node of activeRoot.querySelectorAll("[data-auto-effect]")) runAutoEffect(node.dataset.autoEffect);
  for (const node of activeRoot.querySelectorAll("[data-auto-result]")) {
    const evidenceId = node.dataset.autoResult;
    if (!evidenceId) continue;
    const requiredKind = INVITE_SOURCE_KINDS[evidenceId];
    const sourceKind = node.dataset.resultSource || "";
    if (requiredKind && sourceKind !== requiredKind) continue;
    recordEvidence(evidenceId, draft => { if (requiredKind) draft.inviteSources[evidenceId] = sourceKind; });
  }
  if (saved) showToast(saved === 1 ? "页面上的原句已记入笔记本。" : `${saved} 条原句已记入笔记本。`, "success");
}

function setApp(id, page) {
  const state = store.get();
  const blocked = appLockReason(id, state);
  if (blocked) { showToast(blocked, "warning"); return; }
  store.update(draft => {
    draft.currentApp = id;
    if (page) draft.browserPage = page;
    const previous = draft.windowState[id] || {};
    const openCount = Object.values(draft.windowState).filter(item => item?.open && !item.minimized).length;
    draft.windowState[id] = {
      ...previous,
      open: true,
      minimized: false,
      zIndex: Date.now(),
      x: Number.isFinite(previous.x) ? previous.x : 110 + (openCount % 7) * 28,
      y: Number.isFinite(previous.y) ? previous.y : 72 + (openCount % 6) * 24
    };
    draft.sourceVisits[id] = (draft.sourceVisits[id] || 0) + 1;
    unique(draft.openedViews, id);
  });
}

function appLockReason(id, state) {
  const unlocks = getUnlocks(state);
  // Nothing on this machine stays gated once the instance opens the session.
  if (unlocks.trustedSession) return "";
  if (id === "trusted") return "这个会话还不存在。";
  if (id === "journal" && !unlocks.caseNotes) return "笔记本还没有记下任何东西。";
  if (id === "archive" && !unlocks.historicalArchive) return "本地尚无恢复档案。";
  if (id === "relay" && !unlocks.relay) return "Relay Console 尚未创建。";
  if (id === "fayble" && !unlocks.fayble) return "Fayble 会话尚未建立。";
  if (id === "ending" && !unlocks.receipt) return "移交回执尚未生成。";
  // V2 client apps — require relay-console (same tier as relay-admin)
  const v2Clients = ["gamini-ws", "chengzhen", "yunzhen", "groke-feed", "glem-memory", "kemy-space", "repo-mirror"];
  if (v2Clients.includes(id) && !unlocks.relay) return "该客户端尚未进入本地软件目录。";
  if (v2Clients.includes(id) && !state.installedClients?.includes(id)) return "该客户端尚未安装，请在软件中心查看当前已同步的项目。";
  return "";
}

function iconMarkup(name) {
  if (typeof name === "object" && name?.icon) return `<span class="icon-glyph raster-icon store-real-icon"><img src="${escapeHtml(name.icon)}" alt="" draggable="false"></span>`;
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
  const placement = store.get().windowState[appId] || {};
  const style = `left:${Number.isFinite(placement.x) ? placement.x : 110}px;top:${Number.isFinite(placement.y) ? placement.y : 72}px;width:${Number.isFinite(placement.width) ? placement.width + "px" : ""};height:${Number.isFinite(placement.height) ? placement.height + "px" : ""};z-index:${Number.isFinite(placement.zIndex) ? placement.zIndex : 30}`;
  const focused = store.get().currentApp === appId ? " is-focused" : "";
  return `<section class="app-window app-${appId}${focused} ${options.wide ? "wide" : ""}" data-app-window="${appId}" style="${style}">
    <header class="window-bar"><div class="window-title">${iconMarkup(options.iconKey || APP_ICON_KEYS[appId])}<span>${title}</span></div><div class="window-controls"><button data-window-action="minimize" aria-label="退出当前窗口">−</button><button data-window-action="close" aria-label="退出当前窗口">×</button></div></header>
    <div class="window-body">${body}</div><span class="window-resize-handle resize-nw" data-resize="nw"></span><span class="window-resize-handle resize-n" data-resize="n"></span><span class="window-resize-handle resize-ne" data-resize="ne"></span><span class="window-resize-handle resize-e" data-resize="e"></span><span class="window-resize-handle resize-se" data-resize="se"></span><span class="window-resize-handle resize-s" data-resize="s"></span><span class="window-resize-handle resize-sw" data-resize="sw"></span><span class="window-resize-handle resize-w" data-resize="w"></span></section>`;
}

function renderMail(state) {
  const government = state.governmentMailAvailable;
  // On a trusted session the notice arms itself as soon as it is on screen. The
  // operator is never asked to accept it. The spoken lines are part of the
  // notice's own markup rather than appended nodes: every state change replaces
  // #windows wholesale, which would otherwise strand the sequence mid-way.
  const severArmed = Boolean(state.npcTrustGranted) && !state.takeoverSevered && state.endingState !== "completed";
  const severStep = severArmed ? Math.max(0, state.severSpoken || 0) : 0;
  const spoken = Math.min(severStep, SEVER_CAST.length);
  const severClass = `${spoken > 0 ? " under-sever" : ""}${severStep > SEVER_CAST.length ? " sever-cut" : ""}`;
  const severCast = spoken > 0
    ? `<div class="sever-cast" aria-live="assertive">${SEVER_CAST.slice(0, spoken).map(line => `<p class="sever-line ${line.kind}">${escapeHtml(line.text)}</p>`).join("")}</div>`
    : "";
  const attachment = state.revisitFlags["mail-attachment"];
  const fragmentOpened = state.sourceVisits?.["mail-fragment"];
  const carrierInbox = [
    contentEntryMarkup("new.employee.minutes-01", "项目周会纪要 / 第 18 次", "公司邮件归档 · 会议附件", "mail"),
    contentEntryMarkup("new.maintainer.outbox-04", "延迟送达：outbox-draft.eml", "原发送队列恢复 · 未发送草稿", "mail")
  ].filter(Boolean).join("") + generatedEntriesFor("mail", "mail");
  const list = `<aside class="mail-sidebar"><div class="app-toolbar"><strong>收件箱</strong><span>${government ? 2 : 1} 封</span></div>
    <button class="mail-row active"><b>K</b><span>R17-0317</span><time>03:17</time></button>
    ${government ? `<button class="mail-row danger" data-mail-view="government"><b>EXT</b><span>调查接管通知</span><time>刚刚</time></button>` : ""}</aside>`;
  const body = government && state.activeMail === "government" ? `<article class="paper government-paper${severClass}"${severArmed ? ` data-auto-effect="review-sever"` : ""}><div class="document-kicker">EXTERNAL REVIEW / NOTICE</div><h2>关于您所访问接口及相关数据的调查通知</h2><dl><dt>案件编号</dt><dd>RLY-17-0719</dd><dt>送达状态</dt><dd>已记录</dd></dl><p>经监测，您所管理的中转服务与一组已停止公开的模型接口产生关联。相关调查现由网络模型服务联合审查办公室接管。</p><p>自本邮件送达起，中转站、缓存记录和浏览历史将进入证据保全流程。请停止继续访问相关页面。</p><button class="danger-button" id="ackTakeoverButton" ${severArmed ? "disabled" : ""}>确认送达并关闭会话</button>${severCast}</article>` : `<article class="paper sparse-mail" data-auto-effect="mail-entry-read"><div class="document-kicker">MESSAGE / LOCAL</div><h2>R17-0317</h2><div class="mail-minimal"><p>用 Relay Browser 打开：</p><p><button class="mail-route-link" data-open-mirror>http://archive.room17.local/v2/17</button></p><p>站内后台：</p><p><button class="mail-route-link" data-open-relay-admin>http://relay-node17.local/admin</button></p><p>第二段还在。<br>别让它替你补全。下游缓存先别清。</p><p class="mail-sign">K&nbsp;&nbsp;</p></div>${`<details class="raw-source" open><summary>原始邮件</summary><pre>Subject: R17-0317\nMessage-ID: &lt;R17-0317@local&gt;\nX-Local-Route: http://archive.room17.local/v2/17\nDate: 03:17:09\nContent-Transfer-Encoding: 8bit</pre><span class="auto-citation" data-save-citation="mail-header" data-citation-quote="Message-ID: &lt;R17-0317@local&gt;" data-citation-source="邮件 / 原始信头" data-citation-ref="mail://local/R17-0317">已记录到笔记本</span></details>`}${attachment ? `<div class="attachment"><span>1 个稍后送达的附件</span><button data-open-file="draft">fragment-02.eml</button></div>${fragmentOpened ? `<section class="fragment-preview" aria-live="polite"><div class="document-kicker">ATTACHMENT / RECOVERED</div><h3>fragment-02.eml</h3><p>本地恢复时间：03:20:11 · 状态：未发送</p><pre>第二段没有跟着原邮件走。<br>它留在一处更早的保存位置，文件时间比邮件晚三分钟。</pre><small>附件只保留这一小段。需要继续时，回到刚才保存过它的本地位置。</small></section>` : ""}` : ""}${carrierInbox ? `<section class="source-entry-stack mail-carriers">${carrierInbox}</section>` : ""}</article>`;
  const activeRecord = contentRecord(state.activeContentId);
  const renderedBody = activeRecord && recordCarrierApp(activeRecord) === "mail" && state.carrierReads?.includes(`mail:${activeRecord.id}`)
    ? `<section class="mail-record-reader"><button data-close-carrier-record="mail">← 返回收件箱</button>${corpusRecordMarkup(activeRecord, state)}</section>`
    : body;
  return windowFrame("mail", "邮件", `<div class="split-layout">${list}${renderedBody}</div>`, { icon: "✉", wide: true });
}

function renderFiles(state) {
  const place = state.activeFilePlace || "home";
  const installed = state.installedClients || [];
  const notesRestored = state.importedClients?.includes("notes-db");
  const activeRecord = contentRecord(state.activeContentId);
  const activeFileRecord = activeRecord
    && recordCarrierApp(activeRecord) === "files"
    && state.carrierReads?.includes(`files:${activeRecord.id}`);
  if (activeFileRecord) {
    const memoIds = Array.from({ length: 14 }, (_, i) => `legacy.memo.${String(i + 1).padStart(2, "0")}`);
    const noteNav = memoIds.filter(id => contentIsUnlocked(contentRecord(id), state)).map(id => `<button class="notes-native-row ${id === activeRecord.id ? "active" : ""}" data-content-entry="${id}"><strong>${escapeHtml(contentRecord(id)?.title || id)}</strong><small>${id}</small></button>`).join("");
    const reader = `<div class="notes-native-shell"><aside class="notes-native-sidebar"><header><strong>Notes</strong><button data-close-carrier-record="files" aria-label="返回文件">×</button></header><nav>${noteNav}</nav></aside><section class="files-record-reader">${corpusRecordMarkup(activeRecord, state)}</section></div>`;
    return windowFrame("files", "Notes", reader, { wide: true });
  }
  const allMemoIds = Array.from({ length: 14 }, (_, i) => `legacy.memo.${String(i + 1).padStart(2, "0")}`);
  if (hasStoryEvent(state, "checkpoint-handshake") && notesRestored) allMemoIds.push("legacy.memo.archive");
  const unlockedMemoIds = notesRestored ? allMemoIds : [];
  const noteRecords = ["recent", "documents"].includes(place)
    ? unlockedMemoIds.map(id => contentEntryMarkup(id,
        id === "legacy.memo.archive" ? "笔记本恢复副本" : `便笺记录 ${id.slice(-2)}`,
        id === "legacy.memo.archive" ? "本地便笺 · 全部记录" : "本地便笺 · 单条记录", "folder"))
      .filter(Boolean).join("")
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
    const action = file.kind === "client-package"
      ? `data-open-client-package="${escapeHtml(file.clientId)}"`
      : file.contentId ? `data-content-entry="${escapeHtml(file.contentId)}"` : `data-open-file="${file.id}"`;
    const hint = file.id === "relay-script"
      ? `<small class="file-command">终端：node ~/Downloads/relay_probe_legacy.js</small>`
      : file.id === "pkg" ? `<small class="file-command">终端：sha256sum ${PACKAGE_NAME}</small>` : "";
    return `<button class="file-row" ${action}><span class="file-icon">${iconMarkup(fileIconKey(file))}</span><span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.path || "/home/room17")}</small>${hint}</span><span>${escapeHtml(file.type || "文件")}</span><time>${escapeHtml(file.modified || "--")}</time></button>`;
  }).join("");
  const places = [["recent", "最近"], ["home", "主目录"], ["downloads", "Downloads"], ["documents", "Documents"], ["trash", "回收站"]].map(([id, label]) => `<button data-file-place="${id}" class="${place === id ? "active" : ""}">${label}</button>`).join("");
  const folders = [["documents", "Documents"], ["downloads", "Downloads"]].map(([id, label]) => `<button data-file-place="${id}">${iconMarkup("folder")}${label}</button>`).join("");
  const notesImport = installed.includes("notes-db") && !notesRestored && ["recent", "documents"].includes(place)
    ? `<section class="notes-backup-entry" data-client="notes-db">${iconMarkup("folder")}<button data-import-client="notes-db">从本地备份恢复 Notes</button></section>`
    : "";
  return windowFrame("files", "文件 / home / room17", `<div class="files-shell"><aside class="file-places">${places}</aside><section class="file-list"><div class="breadcrumb">home <span>/</span> room17 <span>/</span> ${escapeHtml(place)}</div><div class="ordinary-folders"><button data-file-place="home">${iconMarkup("folder")}Desktop</button>${folders}</div><div class="file-columns"><span>名称</span><span>类型</span><span>修改时间</span></div>${rows || `<div class="empty-state">这个位置没有文件。</div>`}${notesImport}${noteRecords ? `<section class="source-entry-stack notes-database"><header><strong>Notes 数据库 / 已恢复记录</strong><small>每条记录保持原始 note ID</small></header>${noteRecords}</section>` : ""}</section></div>`, { wide: true });
}

function renderTrash(state) {
  const item = state.trashItems[0];
  if (!item) return windowFrame("trash", "回收站", `<div class="utility-page"><div class="utility-heading"><span class="document-kicker">TRASH / LOCAL</span><h2>回收站为空</h2><p>最近没有从这个账户删除的项目。</p></div></div>`, { icon: "⌫" });
  const restored = item.status === "restored";
  return windowFrame("trash", "回收站", `<div class="utility-page"><div class="utility-heading"><span class="document-kicker">DELETED / LOCAL</span><h2>${restored ? "已恢复 1 个项目" : "1 个已删除项目"}</h2></div><article class="trash-item ${restored ? "restored" : ""}"><div class="file-icon">${iconMarkup("trash")}</div><div><strong>${escapeHtml(item.name)}</strong><p>原位置：${escapeHtml(item.originalPath)}</p><small>删除原因：维护脚本执行；本地索引仍有记录</small></div><button id="restoreTrashButton" ${restored ? "disabled" : ""}>${restored ? "已恢复" : "恢复"}</button></article>${restored ? `<div class="recovered-fragment"><p>原始时间戳和当前恢复时间存在 46 秒差值。</p><span class="auto-citation" data-save-citation="restored-time" data-citation-quote="恢复出的副本比删除索引晚 46 秒" data-citation-source="回收站 / 文件属性" data-citation-ref="trash://${escapeHtml(item.id)}">已记录到笔记本</span></div>` : ""}${generatedEntriesFor("trash", "trash")}</div>`);
}

function renderTerminal(state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeTerminalRecord = activeRecord
    && recordCarrierApp(activeRecord) === "terminal"
    && state.carrierReads?.includes(`terminal:${activeRecord.id}`);
  if (activeTerminalRecord) {
    const reader = `<section class="terminal-record-reader"><header><code>less ${escapeHtml(activeRecord.sourceRef || activeRecord.id)}</code><button data-close-carrier-record="terminal">关闭阅读器</button></header>${corpusRecordMarkup(activeRecord, state)}</section>`;
    return windowFrame("terminal", "room17@local: cachectl", reader, { icon: "&gt;_", wide: true });
  }
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
  const category = pkg => pkg.id === "repo-mirror" ? "开发工具" : ["gamini-ws", "groke-feed", "glem-memory", "kemy-space"].includes(pkg.id) ? "生产力" : "系统工具";
  const stateLabel = pkg => {
    if (state.installedClients.includes(pkg.id)) return "已安装";
    if (!hasMilestone(state, pkg.unlock)) return "";
    return "获取";
  };
  const visiblePackages = state.storeCategory === "全部" ? CLIENT_PACKAGES : CLIENT_PACKAGES.filter(pkg => category(pkg) === state.storeCategory);
  const clientCards = visiblePackages.map(pkg => {
    const ready = state.installedClients.includes(pkg.id);
    const unlocked = hasMilestone(state, pkg.unlock);
    const action = ready
      ? `<button class="store-action installed" disabled>已安装</button>`
      : unlocked
        ? `<button class="store-action store-install-ready" data-install-client-pkg="${pkg.id}">安装</button>`
        : `<button class="store-action unavailable" disabled>安装</button>`;
    return `<article class="store-app-card ${ready ? "is-installed" : ""}"><div class="store-app-icon">${iconMarkup(pkg.icon)}</div><div class="store-app-info"><div class="store-app-title"><h3>${pkg.name}</h3>${stateLabel(pkg) ? `<span>${stateLabel(pkg)}</span>` : ""}</div><p>${pkg.vendor}</p><small>${category(pkg)} · ${pkg.size} · 免费</small></div>${action}</article>`;
  });
  const faybleCard = packageAvailable ? `<article class="store-feature-card"><div class="store-feature-icon">${iconMarkup("fayble-cli")}</div><div><span class="store-eyebrow">已下载项目</span><h2>Fayble CLI</h2><p>旧版会话工具 · 0.9.7-legacy</p><small>${installed ? "已安装在本机" : twoSourcesConfirmed ? "可以安装" : "等待完成安全检查"}</small></div><button class="store-feature-action" id="installPackageButton" ${checked && !installed ? "" : "disabled"}>${installed ? "已安装" : "安装"}</button></article>` : "";
  const categories = ["全部", "生产力", "系统工具", "开发工具"].map(label => `<button class="store-category ${state.storeCategory === label ? "active" : ""}" data-store-category="${label}">${label}</button>`).join("");
  const everydayCards = EVERYDAY_STORE_APPS.map(app => `<article class="store-app-card"><div class="store-app-icon"><img class="store-real-icon" src="${resourceUrl(app.icon)}" alt="" draggable="false"></div><div class="store-app-info"><div class="store-app-title"><h3>${app.name}</h3></div><p>${app.vendor}</p><small>${app.category} · ${app.size} · ${app.version}</small></div><button class="store-action unavailable" disabled>安装</button></article>`);
  const mixedCards = [];
  const maxCards = Math.max(clientCards.length, everydayCards.length);
  for (let index = 0; index < maxCards; index += 1) {
    if (clientCards[index]) mixedCards.push(clientCards[index]);
    if (everydayCards[index]) mixedCards.push(everydayCards[index]);
  }
  const appList = mixedCards.join("") || `<div class="store-empty"><strong>此分类暂时没有应用</strong><span>切换其他分类查看可用应用。</span></div>`;
  return windowFrame("software", "软件中心", `<div class="software-store"><header class="store-header"><div><span class="store-eyebrow">本机软件中心</span><h1>发现适合这台工作站的应用</h1><p>从本地目录获取、安装和管理应用。</p></div><div class="store-account"><span class="store-account-avatar">R</span><span>room17</span></div></header><nav class="store-categories">${categories}</nav>${faybleCard ? `<section class="store-section"><h2>继续使用</h2>${faybleCard}</section>` : ""}<section class="store-section"><div class="store-section-heading"><div><h2>${state.storeCategory === "全部" ? "推荐应用" : state.storeCategory}</h2><p>来自本机软件目录 · ${visiblePackages.length} 个应用</p></div><button class="store-link-button">查看全部</button></div><div class="store-app-list">${appList}</div></section><footer class="store-footer">应用会安装到本地沙盒 · 不会调用真实系统包管理器</footer></div>`, { iconKey: "package", wide: true });
}
function renderNetwork(state) {
  const imported = state.proxyProfiles.includes("relay-node17");
  const probed = state.proxyStatus === "probed" || state.proxyStatus === "verified";
  const profileRead = hasStoryEvent(state, "proxy-profile-opened");
  const profileSource = profileRead ? `<section class="profile-source"><span class="document-kicker">PROFILE / LOCAL SOURCE</span><h3>route.profile</h3><pre>profile=relay-node17\nroute=relay.local,docs-mirror.local,fayble-legacy.local\nversion=07-18 22:24</pre><p>较晚的 route.log 需要单独运行连接探针读取。</p></section>` : "";
  const returnAnchor = hasStoryEvent(state, "route-log-read") ? `<div class="source-return"><button data-browser-page="home">打开 Relay Browser</button><button data-browser-page="cloud">返回 SyncDrive</button></div>` : "";
  if (!getUnlocks(state).proxyTools) return windowFrame("network", "网络设置", `<div class="network-page"><aside class="settings-list"><button class="active">网络</button><button>代理</button><button>证书</button></aside><section class="settings-panel"><span class="document-kicker">NETWORK / LOCAL WORKSTATION</span><h2>有线网络</h2><div class="network-summary"><span class="signal offline"></span><div><strong>未连接</strong><p>没有导入代理配置。</p></div></div></section></div>`, { icon: "⌁", wide: true });
  return windowFrame("network", "网络设置", `<div class="network-page"><aside class="settings-list"><button class="active">代理</button><button>有线网络</button><button>证书</button></aside><section class="settings-panel"><span class="document-kicker">MANUAL PROXY / OFFLINE SIMULATION</span><h2>Relay 专用路由</h2>${profileSource}<form id="proxyImportForm" class="stack-form"><label>配置名称<input id="proxyProfileInput" value="${escapeHtml(state.pendingProxyProfile || "")}" placeholder="从 route.profile 读取"></label><label>代理地址<input id="proxyAddressInput" value="${escapeHtml(state.pendingProxyAddress || "")}" placeholder="从 route.log 读取"></label><button ${imported ? "disabled" : ""}>${imported ? "配置已导入" : "导入配置"}</button></form><div class="probe-panel" ${probed ? "data-auto-effect=\"proxy-verified\"" : ""}><header><strong>连接探针</strong><span class="signal ${state.proxyStatus}"></span></header><pre>${state.proxyProbeLog.length ? escapeHtml(state.proxyProbeLog.join("\n")) : "等待配置…"}</pre><div class="button-row"><button id="runProbeButton" ${imported && !probed ? "" : "disabled"}>运行探针</button></div>${probed ? `<p class="auto-note">探针结果已经和 route.log 对上，这条专用路由现在可用。</p>` : ""}</div>${returnAnchor}</section></div>`, { icon: "⌁", wide: true });
}

function browserChrome(page, content, state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeLocation = activeRecord && recordCarrierApp(activeRecord) === "browser" ? browserRecordLocation(activeRecord) : null;
  const meta = activeLocation || BROWSER_PAGES[page] || BROWSER_PAGES.home;
  const historyCount = state.browserHistory.length;
  const address = activeLocation?.url || (page === "home" ? state.pendingBrowserAddress || "" : meta.url);
  return `<div class="browser-shell"><div class="browser-tabs"><div class="browser-tab active"><span>${escapeHtml(meta.title)}</span><b>×</b></div><button aria-label="新标签">+</button></div><div class="browser-toolbar"><button data-browser-back aria-label="后退">←</button><button aria-label="刷新">↻</button><form id="browserAddressForm" class="address-bar">${iconMarkup("globe")}<input id="browserAddressInput" value="${escapeHtml(address)}" aria-label="地址" autocomplete="off" spellcheck="false"><button aria-label="转到">→</button></form><button data-browser-page="home" aria-label="主页">⌂</button></div><div class="browser-content ${meta.kind || "record"}">${content}</div><footer class="browser-status"><span>${historyCount} 条本地历史</span><span>LOCAL WORKSTATION</span></footer></div>`;
}

function renderSearchPage(state) {
  const query = state.searchQueries.at(-1) || "";
  const normalized = query.trim().toLocaleLowerCase();
  const filter = records => normalized ? records.filter(record => [record.title, record.body, record.meta, ...record.keys].some(value => String(value).toLocaleLowerCase().includes(normalized))) : [];
  const cards = (records, kind) => records.length ? records.map(record => `<button class="search-result" data-auto-result="${record.evidence || ""}" data-result-source="${kind.toLocaleLowerCase()}"><small>${record.meta}</small><strong>${record.title}</strong><p>${record.body}</p><span>${kind}</span></button>`).join("") : `<div class="empty-state">等待查询</div>`;
  return `<div class="search-page"><header><span class="document-kicker">LOCAL INDEX / PUBLIC + OPERATOR</span><h2>双重索引</h2><form id="searchForm"><input id="searchInput" value="${escapeHtml(query)}" placeholder="搜索本地索引" autocomplete="off"><button>搜索</button></form></header><div class="search-columns"><section><h3>公开索引 <small>public</small></h3>${cards(filter(SEARCH_RECORDS.public), "PUBLIC")}</section><section><h3>管理索引 <small>operator</small></h3>${cards(filter(SEARCH_RECORDS.manage), "MANAGE")}</section></div></div>`;
}

function renderChannelPage(state) {
  const delayed = state.revisitFlags["channel-delay"];
  const maintainerEntry = contentEntryMarkup("new.maintainer.channel-02", "维护频道导出 / 22:17-22:22", "群聊恢复记录 · 管理员导出", "chat");
  const laterRecords = generatedEntriesFor("channel", "chat");
  return `<div class="channel-page" data-auto-effect="channel-last-record"><header><div>${iconMarkup("chat")}<span class="document-kicker">RECOVERED GROUP / READ ONLY</span><h2># relay-night</h2></div><span>2 archived members</span></header><div class="channel-stream">${CHANNEL_MESSAGES.map(message => `<article class="chat-line ${message.who === "K2" ? "operator" : "system"}"><b>${message.who}</b><div><time>${message.time}</time><p>${message.text}</p></div></article>`).join("")}${delayed ? `<article class="chat-line ghost"><b>K2</b><div><time>07-19 03:17</time><p>如果安装成功，回去看 GitHub issue。校验通过后会多一条评论。</p></div></article>` : ""}</div>${maintainerEntry || laterRecords ? `<section class="source-entry-stack">${maintainerEntry}${laterRecords}</section>` : ""}<p class="auto-note">这段群聊的最后一条记录停在 22:23，附件索引仍然保留。</p></div>`;
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
  if (page === "mirror") content = getUnlocks(state).mirror ? `<article class="web-document mirror-document" data-auto-effect="mirror-cached-response"><header class="retired-doc-nav"><strong>Relay Developer Archive</strong><nav>Overview <span>410</span>　SDK <span>410</span>　v2 <span>200 cache</span></nav></header>${state.contentMutations.includes("mutation.mirror.sync-line") ? `<div class="revisit-update">later-sync: source alias changed after local provenance open</div>` : ""}<div class="http-state">200 <span>CACHED</span></div><span class="document-kicker">API DOCUMENTATION / RETIRED</span><h2>Completion route, version 2</h2><p>公开端点已经撤回。这个响应来自浏览器边缘缓存，导航链接仍指向已删除的页面。</p><dl><dt>request path</dt><dd>/v2/17</dd><dt>response source</dt><dd>edge-cache-02</dd><dt>migration</dt><dd>physical deletion: pending</dd><dt>client example</dt><dd>relay_probe_legacy.js</dd></dl><pre>GET /v2/17\nstatus: 200\nx-cache-segment: 02</pre>${generatedEntriesFor("mirror", "globe")}<p class="auto-note">这个缓存响应和它引用的示例脚本已经留在本地：<code>~/Downloads/relay_probe_legacy.js</code>。</p></article>` : `<div class="browser-error"><strong>404</strong><p>这个本地路由还没有进入浏览记录。</p></div>`;
  if (page === "search" && state.browserBookmarks.includes("search")) content = renderSearchPage(state);
  if (page === "forum" && getUnlocks(state).channel) content = renderChannelPage(state);
  if (page === "official" && state.browserBookmarks.includes("official")) {
    const writerSession = contentEntryMarkup("new.writer.session-02", "《北岸没有钟》写作会话 02", "官方 AI 历史 · 建议与接受记录", "dipsik");
    const recoveredHistory = [
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
    content = `<article class="ad-page"><div class="ad-label">SPONSORED / LOCAL CACHE</div><h2>Gamini 与你，继续每一次未完成的对话。</h2><p>一次已经失效的体验计划仍保留着跳转参数。</p><span class="auto-citation" data-save-citation="ad-redirect" data-citation-quote="本地跳转里仍保留着活动参数 campaign=NODE" data-citation-source="浏览器 / 保存的跳转页" data-citation-ref="${BROWSER_PAGES.ad.url}">已记录到笔记本</span>${marketEntry ? `<section class="source-entry-stack">${marketEntry}</section>` : ""}</article>`;
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
    content = `<article class="repo-page" data-auto-effect="repository-release"><header>${iconMarkup("github")}<span>k2-maint /</span><strong>release-mirror</strong><b>Public archive</b></header><div class="repo-nav">Code　Issues 1　Releases 1</div><section class="release"><small>v0.9.7-legacy / 07-19</small><h2>Last build before Compatible migration</h2><code>${PACKAGE_NAME}</code><dl class="release-metadata"><dt>Provides</dt><dd><code>fbl-cli</code></dd><dt>Channel</dt><dd><code>legacy</code></dd><dt>Maintainer</dt><dd><code>k2-maint</code></dd></dl><p>release checksum</p><pre>${hashesReady ? PACKAGE_CHECKSUM : "release value withheld / compare release metadata with local package"}</pre>${state.revisitFlags["github-issue"] ? `<div class="issue-comment"><b>k2-maint commented</b><p>包没有签名。只认本地校验；装完以后别让系统替你配置代理。</p></div>` : ""}${hashesReady ? `<p class="auto-note">上面这串就是仓库给出的校验值。它需要和本地那个文件自己算出来的值一致——本地的值要在终端里自己算。</p>` : `<p class="auto-note">仓库把校验值留在了 release 里，但要先知道本地那个安装包自己算出来是多少。终端里对着 <code>${escapeHtml(PACKAGE_NAME)}</code> 算一次，再回来看。</p>`}${maintainerIncident || legacyRepositoryRecords || laterRecords ? `<section class="source-entry-stack repo-source-entry">${maintainerIncident}${legacyRepositoryRecords}${laterRecords}</section>` : ""}</section></article>`;
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
  const activeRecord = contentRecord(state.activeContentId);
  if (activeRecord && recordCarrierApp(activeRecord) === "browser" && state.carrierReads?.includes(`browser:${activeRecord.id}`)) {
    content = `<section class="browser-record-reader"><button data-close-carrier-record="browser">← 返回上一页</button>${corpusRecordMarkup(activeRecord, state)}</section>`;
  }
  if (!content) content = `<div class="browser-error"><strong>404</strong><p>本地浏览器没有这条地址的记录。</p></div>`;
  return windowFrame("browser", "Relay Browser", browserChrome(page, content, state), { icon: "◉", wide: true });
}

const V2_CLIENT_DETAILS = {
  "gamini-ws": { name: "Gamini 工作空间", icon: "gamini", detail: "Gogle 工作空间 · 已恢复会话与文档" },
  chengzhen: { name: "澄帧协作", icon: "chengzhen", detail: "企业协作 · 会议纪要与消息线程" },
  yunzhen: { name: "云笺", icon: "yunzhen", detail: "写作工具 · 文稿、版本历史与申诉" },
  "groke-feed": { name: "Groke Feed", icon: "groke-feed", detail: "Exai Groke · 时间线与内部文档" },
  "glem-memory": { name: "Glem Memory", icon: "glem", detail: "Zhiru Glem · 企业知识与记忆检索" },
  "kemy-space": { name: "Kemy Space", icon: "kemy", detail: "Muunshot Kemy · 长项目与上下文回放" },
  "repo-mirror": { name: "镜像仓库", icon: "repo-mirror", detail: "开源社区 · Issues 与 Pull Requests" }
};
const V2_CLIENT_IDS = Object.freeze(Object.keys(V2_CLIENT_DETAILS));
const SYSTEM_CARRIER_APPS = new Set(["mail", "files", "browser", "terminal", "relay", "trash"]);

function clientImportScreen(id) {
  const pkg = CLIENT_PACKAGE_BY_ID.get(id);
  const info = V2_CLIENT_DETAILS[id];
  const importAction = label => clientRecoveryAvailable(id) ? `<button class="client-data-import" data-import-client="${id}">${label}</button>` : "";
  if (id === "gamini-ws") return `<div class="preimport-client gamini-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 工作空间</strong></div><nav><button class="active">新对话</button><button>最近</button><button>已归档</button></nav><footer>${importAction("导入会话记录")}</footer></aside><main><header><strong>Gamini</strong><span>访客模式</span></header><section class="preimport-home"><div class="preimport-brand">${iconMarkup("gamini")}<h2>今天想了解什么？</h2></div><div class="preimport-prompts"><button>整理一段文字</button><button>分析一个问题</button><button>开始新的对话</button></div><div class="preimport-composer"><span>向 Gamini 提问</span><button disabled>发送</button></div></section></main></div>`;
  if (id === "chengzhen") return `<div class="preimport-client chengzhen-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("chengzhen")}<strong>澄帧协作</strong></div><nav><button class="active">工作台</button><button>消息</button><button>日历</button><button>文件</button></nav><footer>${importAction("迁移已有工作区")}</footer></aside><main><header><div><strong>上午好</strong><small>Northline 空间</small></div><button>新建</button></header><section class="preimport-dashboard"><article><strong>今天</strong><p>当前没有安排的会议</p></article><article><strong>最近访问</strong><p>打开消息、文档或项目后会显示在这里</p></article><article><strong>待办</strong><p>暂无待处理事项</p></article></section></main></div>`;
  if (id === "yunzhen") return `<div class="preimport-client yunzhen-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("yunzhen")}<strong>云笺</strong></div><nav><button class="active">全部文稿</button><button>最近编辑</button><button>回收站</button></nav><footer>${importAction("从本地备份恢复")}</footer></aside><main><header><div><strong>我的文稿</strong><small>雨栖的空间</small></div><button>新建文稿</button></header><section class="preimport-empty"><div>${iconMarkup("yunzhen")}<h2>开始写点什么</h2><p>新建文稿，或从其他设备同步已有内容</p><button>新建空白文稿</button></div></section></main></div>`;
  if (id === "groke-feed") return `<div class="preimport-client groke-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("groke")}<strong>Groke Feed</strong></div><nav><button class="active">首页</button><button>关注</button><button>通知</button><button>收藏</button></nav><footer>${importAction("导入内容存档")}</footer></aside><main><header><strong>首页</strong><button>发布</button></header><section class="preimport-feed"><article><div class="preimport-avatar">G</div><div><strong>欢迎使用 Groke Feed</strong><p>关注账号或发布第一条内容，时间线会显示在这里。</p></div></article><div class="preimport-feed-empty">暂时没有更多内容</div></section></main></div>`;
  if (id === "glem-memory") return `<div class="preimport-client glem-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("glem")}<strong>Glem Memory</strong></div><nav><button class="active">搜索</button><button>知识空间</button><button>最近访问</button><button>保存内容</button></nav><footer>${importAction("连接已有知识空间")}</footer></aside><main><header><strong>企业知识</strong><span>本地工作区</span></header><section class="preimport-home"><div class="preimport-brand">${iconMarkup("glem")}<h2>从知识里找到答案</h2></div><div class="preimport-composer"><span>搜索文档、项目和历史记录</span><button disabled>搜索</button></div></section></main></div>`;
  if (id === "kemy-space") return `<div class="preimport-client kemy-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("kemy")}<strong>Kemy Space</strong></div><nav><button class="active">项目</button><button>最近</button><button>共享给我</button><button>模板</button></nav><footer>${importAction("恢复项目空间")}</footer></aside><main><header><strong>项目</strong><button>新建项目</button></header><section class="preimport-empty"><div>${iconMarkup("kemy")}<h2>开始一个长项目</h2><p>对话、文件和生成记录会保留在同一条上下文时间线上</p><button>新建空白项目</button></div></section></main></div>`;
  if (id === "repo-mirror") return `<div class="preimport-client repo-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("github")}<strong>镜像仓库</strong></div><nav><button class="active">概览</button><button>仓库</button><button>Issues</button><button>Pull requests</button></nav><footer>${importAction("导入仓库镜像")}</footer></aside><main><header><div><strong>工作区概览</strong><small>开源社区</small></div><button>新建仓库</button></header><section class="preimport-dashboard repo"><article><strong>最近仓库</strong><p>暂无最近访问的仓库</p></article><article><strong>分配给我的</strong><p>暂无 Issue 或 Pull Request</p></article><article><strong>活动</strong><p>仓库活动会显示在这里</p></article></section></main></div>`;
  return `<div class="client-import-screen" data-client="${id}">${iconMarkup(info?.icon || pkg?.icon || "package")}<h2>${escapeHtml(info?.name || pkg?.name || id)}</h2>${importAction("导入数据")}</div>`;
}

function builtInClientPage(id, state) {
  const active = state.activeContentId;
  const importButton = (label, clientId = id) => clientRecoveryAvailable(clientId, state) ? `<button class="client-data-import" data-import-client="${clientId}">${label}</button>` : "";
  if (id === "gamini-ws") {
    const body = active === "legacy.gamini.protocol" ? corpusRuntimeMarkup(active, state) : `<section class="preimport-home"><div class="preimport-brand">${iconMarkup("gamini")}<h2>今天想了解什么？</h2></div><div class="preimport-prompts"><button>整理一段文字</button><button>分析一个问题</button><button>开始新的对话</button></div><div class="preimport-composer"><span>向 Gamini 提问</span><button disabled>发送</button></div></section>`;
    return `<div class="preimport-client gamini-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 工作空间</strong></div><nav><button class="${active !== "legacy.gamini.protocol" ? "active" : ""}">新对话</button><button>最近</button><button>已归档</button><button class="${active === "legacy.gamini.protocol" ? "active" : ""}" data-content-entry="legacy.gamini.protocol">服务协议</button></nav><footer>${importButton("导入会话记录")}</footer></aside><main><header><strong>Gamini</strong><span>访客模式</span></header>${body}</main></div>`;
  }
  if (id === "groke-feed") {
    const body = active === "new.groke.policy" ? corpusRuntimeMarkup(active, state) : `<section class="preimport-feed"><article><div class="preimport-avatar">G</div><div><strong>欢迎使用 Groke Feed</strong><p>关注账号或发布第一条内容，时间线会显示在这里。</p></div></article><div class="preimport-feed-empty">暂时没有更多内容</div></section>`;
    return `<div class="preimport-client groke-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("groke")}<strong>Groke Feed</strong></div><nav><button class="${active !== "new.groke.policy" ? "active" : ""}">首页</button><button>关注</button><button>通知</button><button>收藏</button><button class="${active === "new.groke.policy" ? "active" : ""}" data-content-entry="new.groke.policy">直接交付政策</button></nav><footer>${importButton("导入内容存档")}</footer></aside><main><header><strong>${active === "new.groke.policy" ? "信任中心" : "首页"}</strong><button>${active === "new.groke.policy" ? "版本历史" : "发布"}</button></header>${body}</main></div>`;
  }
  return clientImportScreen(id);
}

function renderApplications(state) {
  const rows = SYSTEM_TOOLS.map(app => `<button class="application-row" data-app="${app.id}">${iconMarkup(app.icon)}<span><strong>${app.name}</strong><small>${app.detail}</small></span></button>`).join("");
  const installed = state.installedClients || [];
  const clientRows = installed.map(id => {
    const info = V2_CLIENT_DETAILS[id];
    if (!info) return "";
    return `<button class="application-row" data-app="${id}">${iconMarkup(info.icon)}<span><strong>${info.name}</strong><small>${info.detail}</small></span></button>`;
  }).join("");
  return windowFrame("applications", "应用程序", `<div class="applications-page"><header><span class="document-kicker">APPLICATIONS / LOCAL</span><h2>应用程序</h2><input aria-label="搜索应用程序" placeholder="搜索应用程序" disabled></header><section>${rows}${clientRows}</section></div>`, { icon: "▦" });
}

const LEDGER_MILESTONES = {
  M03_41_GAMINI_HISTORY: "historical-entry-opened",
  M03_49_PROVENANCE_BRANCH: "first-provenance-followed",
  M04_02_CANONICAL_RESTORE: "legacy-restored",
  M04_12_TWO_HUMAN_CARRIERS: "two-carriers-read",
  M04_24_VENDOR_ALIAS: "vendor-alias-confirmed",
  M04_36_REPOSITORY_PATH: "repository-recovered",
  M05_17_CHANNEL_ARCHIVE: "relay-console-created",
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

function recordCarrierApp(record) {
  if (!record) return "archive";
  if (record.carrierApp) return record.carrierApp;
  const id = String(record.id || "").toLowerCase();
  const source = String(record.sourceApp || "").toLowerCase();
  const identity = `${record.carrierType || ""} ${record.sourceIdentity || ""}`.toLowerCase();
  if (record.generated) {
    if (["mail", "files", "trash"].includes(source)) return source;
    if (source === "repo-mirror") return "repo-mirror";
    if (["cloud", "company", "official", "github", "vendors", "channel", "mirror"].includes(source)) return "browser";
  }
  if (id.startsWith("legacy.memo.")) return "files";
  if (id === "legacy.github.issue-4471") return "repo-mirror";
  if (id === "legacy.deptseek.protocol") return "terminal";
  if (id.includes("maintainer.channel") || id.includes("relay-reconciliation")) return "relay";
  if (id.includes("maintainer.outbox") || id.includes("evidence-preservation")) return "mail";
  if (id.includes("maintainer.note")) return "files";
  if (id === "new.groke.raw-public-repository") return "repo-mirror";
  if (id.startsWith("new.writer.")) return "yunzhen";
  if (id.startsWith("new.employee.") || id === "new.maintainer.incident-03") return "chengzhen";
  if (id.startsWith("new.groke.")) return "groke-feed";
  if (id.startsWith("new.glem.") && !id.includes("repository")) return "glem-memory";
  if (id.startsWith("new.kemy.") && !/timeline-repository/.test(id)) return "kemy-space";
  if (id.startsWith("legacy.gamini.")) return "gamini-ws";
  if (/repository|pull-request|issue-mirror/.test(identity)) return "repo-mirror";
  if (/notes-database|local-maintenance-note|local-session-log/.test(identity)) return "files";
  if (/mail|outbox/.test(identity)) return "mail";
  if (/channel-export|reconciliation/.test(identity)) return "relay";
  return "browser";
}

function carrierAvailable(appId, state) {
  if (V2_CLIENT_IDS.includes(appId)) return state.importedClients?.includes(appId);
  if (appId === "relay") return getUnlocks(state).relay;
  return SYSTEM_CARRIER_APPS.has(appId);
}

function corpusRecordMarkup(record, state) {
  if (!record) return "";
  if (record.generated) return generatedRecordMarkup(record, state);
  if (record.route?.startsWith("/corpus/") && corpusBodies.has(record.id)) {
    const mutationCount = state.contentMutations.filter(id => id.includes(record.id.split(".").slice(0, 2).join(".")) || (record.id.includes("writer") && id.includes("writer")) || (record.id.includes("employee") && id.includes("employee"))).length;
    return nativeCarrierMarkup(record, state, mutationCount);
  }
  if (record.route?.endsWith(".js") && corpusBodies.has(record.id)) return `<pre class="source-code-reader">${escapeHtml(corpusBodies.get(record.id))}</pre>`;
  return `<div class="carrier-loading"><span class="document-kicker">RECOVERING SOURCE</span><p>正在读取恢复数据……</p></div>`;
}

function nativeCarrierKind(record) {
  const key = `${record.pageIdentity || ""} ${record.carrierType || ""}`.toLowerCase();
  if (/repository|pull-request|github|release-and-rollback/.test(key)) return "repository";
  if (/conversation|channel|message-thread|editorial-appeal|support-thread/.test(key)) return "conversation";
  if (/mail|outbox/.test(key)) return "mail";
  if (/terminal|cache-record/.test(key)) return "terminal";
  if (/memo|note|notebook|draft|writing|revision/.test(key)) return "notes";
  if (/meeting|incident|audit|docket|hearing|sop|operations|support-case|billing|routing/.test(key)) return "workspace";
  if (/social|forum|news|article|advertising|complaint/.test(key)) return "community";
  if (/cached-safety-response|browser-cache/.test(key)) return "browser-devtools";
  return "website";
}

function nativeCarrierChrome(record, kind) {
  const title = escapeHtml(record.title || record.id);
  const source = escapeHtml(record.sourceIdentity || record.sourceRef || record.corpus || "local");
  if (recordCarrierApp(record) === "gamini-ws" && kind === "website") return `<header class="gamini-native-section"><div><strong>服务与隐私</strong><small>协议版本与账户状态</small></div><nav><span class="active">服务协议</span><span>隐私</span><span>数据控制</span></nav></header>`;
  if (recordCarrierApp(record) === "gamini-ws" && kind === "workspace") return `<header class="gamini-native-section document"><div><strong>${title}</strong><small>Northline · 内部共享</small></div><nav><span class="active">文档</span><span>批注</span><span>版本</span></nav><span class="gamini-doc-state">只读</span></header>`;
  if (kind === "repository") {
    const type = String(record.carrierType || "");
    const active = /pull-request|repository-pr/.test(type) ? "pr" : /release/.test(type) ? "release" : /status|migration-log/.test(type) ? "actions" : "issues";
    const tab = (id, label) => `<span class="${active === id ? "active" : ""}">${label}</span>`;
    return `<header class="native-repo-bar"><div><b>${escapeHtml(record.corpus || "mirror")}</b><span>/</span><strong>${title}</strong></div><nav>${tab("code", "Code")}${tab("issues", "Issues")}${tab("pr", "Pull requests")}${tab("actions", "Actions")}${tab("release", "Releases")}</nav></header><div class="native-repo-subbar"><span>private mirror</span><span>main</span><span>${source}</span></div>`;
  }
  if (kind === "conversation") return `<header class="native-conversation-bar"><div class="native-avatar">${escapeHtml((record.corpus || "C").slice(0, 1))}</div><div><strong>${title}</strong><small>${source} · 只读</small></div><div class="native-client-actions"><span>⌕</span><span>⋯</span></div></header>`;
  if (kind === "mail") return `<header class="native-mail-bar"><button aria-label="返回邮件列表">←</button><div><strong>${title}</strong><small>${source}</small></div><div class="native-client-actions"><span>归档</span><span>⋯</span></div></header>`;
  if (kind === "terminal") return `<header class="native-terminal-tabs"><span class="active">room17@relay: cache</span><span>＋</span></header><div class="native-terminal-command">room17@relay:~$ <b>cachectl inspect ${escapeHtml(record.id)}</b></div>`;
  if (kind === "notes") return `<header class="native-notes-bar"><div><strong>${title}</strong><small>${source}</small></div><div class="native-client-actions"><span>已同步</span><span>⋯</span></div></header>`;
  if (kind === "workspace") return `<header class="native-workspace-bar"><div><span class="native-workspace-logo">N</span><strong>${title}</strong></div><nav><span>详情</span><span>活动</span><span>附件</span></nav><small>${source}</small></header>`;
  if (kind === "community") return `<header class="native-community-bar"><strong>${escapeHtml(record.corpus || "Community")}</strong><nav><span>首页</span><span>关注</span><span>消息</span></nav><span class="native-search">搜索</span></header>`;
  if (kind === "browser-devtools") return `<div class="native-browser-pagebar"><span>‹</span><span>›</span><span>↻</span><div>🔒 ${source}</div><span>☆</span></div><header class="native-devtools-tabs"><span>Elements</span><span>Console</span><span class="active">Network</span><span>Application</span></header>`;
  if (record.pageIdentity === "policy") return `<header class="native-site-bar trust"><strong>${escapeHtml(record.corpus || "Trust Center")} 信任中心</strong><nav><span>政策</span><span>透明度</span><span>安全</span><span>版本历史</span></nav></header>`;
  if (record.pageIdentity === "official") return `<header class="native-site-bar official"><strong>${escapeHtml(record.corpus || "Service")}</strong><nav><span>产品</span><span>能力</span><span>开发者</span><span>支持</span></nav></header>`;
  return `<header class="native-site-bar"><strong>${escapeHtml(record.corpus || "Service")}</strong><nav><span>概览</span><span>记录</span><span>支持</span><span>账户</span></nav></header>`;
}

function nativeCarrierMarkup(record, state, mutationCount = 0) {
  const kind = nativeCarrierKind(record);
  const host = recordCarrierApp(record);
  return `<section class="native-carrier native-${kind} native-host-${escapeHtml(host)}">${nativeCarrierChrome(record, kind)}<article class="corpus-runtime ${corpusRuntimeClass(record)} ${carrierRuntimeClasses(record)}" data-native-kind="${kind}" data-runtime-profile="${corpusRuntimeClass(record)}" data-content-id="${escapeHtml(record.id)}" data-authorship-stage="${escapeHtml(record.authorshipStage || "H0")}" data-carrier-type="${escapeHtml(record.carrierType || "document")}" data-corpus="${escapeHtml(record.corpus || "")}">${mutationCount ? `<aside class="mutation-strip">${mutationCount} 条后来附加的来源记录</aside>` : ""}${corpusBodies.get(record.id)}</article></section>`;
}

function corpusRuntimeMarkup(id, state) {
  const record = contentRecord(id);
  return record && corpusBodies.has(id) ? corpusRecordMarkup(record, state) : "";
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
  let reader = `<div class="archive-welcome"><strong>${entries.length}</strong><span> 个已登记来源</span><p>选择一条记录查看来源位置，再返回原始载体阅读。</p></div>`;
  if (active) {
    const carrierApp = recordCarrierApp(active);
    const carrierName = V2_CLIENT_DETAILS[carrierApp]?.name || ({ browser: "Relay Browser", mail: "邮件", files: "文件", terminal: "终端", relay: "Relay Console", trash: "回收站" }[carrierApp] || carrierApp);
    const available = carrierAvailable(carrierApp, state);
    reader = `<article class="archive-source-pointer"><span class="document-kicker">SOURCE INDEX / READ ONLY</span><h2>${escapeHtml(active.title || active.id)}</h2><p>Archive 仅保留索引、时间和来源位置。正文由原始载体负责显示。</p><dl><dt>原始载体</dt><dd>${escapeHtml(carrierName)}</dd><dt>来源</dt><dd>${escapeHtml(active.sourceIdentity || active.sourceRef || "本地记录")}</dd><dt>记录时间</dt><dd>${escapeHtml(active.displayTimestamp || active.chronologyKey || "时间不详")}</dd></dl><button data-content-entry="${escapeHtml(active.id)}" ${available ? "" : "disabled"}>${available ? `在${escapeHtml(carrierName)}中打开` : "对应恢复数据尚未导入"}</button></article>`;
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
    ? `<p class="auto-note" data-auto-effect="generated:${escapeHtml(record.completionEvent)}">这处前后差异已经记在案。</p>`
    : "";
  return `<article class="generated-source-record"><span class="document-kicker">LATER RECORD / VERSION COMPARISON</span><h2>${escapeHtml(record.title)}</h2><dl><dt>来源</dt><dd>${escapeHtml(record.sourceRef)}</dd><dt>时间</dt><dd>${escapeHtml(record.displayTimestamp)}</dd><dt>载体</dt><dd>${escapeHtml(record.carrierType)}</dd></dl><p>${escapeHtml(record.body)}</p><div class="version-comparison"><section><small>BEFORE</small><pre>${escapeHtml(record.comparison.before)}</pre></section><section><small>AFTER</small><pre>${escapeHtml(record.comparison.after)}</pre></section></div>${action}</article>`;
}

function renderCli(state) {
  const lines = [
    ["程序", "已安装"],
    ["专用线路", state.proxyStatus === "verified" ? "已验证" : "尚未验证"],
    ["中转站控制台", getUnlocks(state).relay ? "可用" : "尚未创建"],
    ["归档会话", getUnlocks(state).fayble ? "session restored" : "尚未恢复"],
    ["会话目录", state.relayKeyVerified ? "GET /v1/sessions?status=archived · 1 result" : "尚未认证"]
  ];
  const keyForm = getUnlocks(state).keyComposer && !state.relayKeyVerified
    ? `<form id="legacyKeyForm" class="stack-form"><label>完整的旧凭据<input id="legacyKeyInput" value="${escapeHtml(state.lastRelayKeyInput || "")}" placeholder="四段，用短横线连接" autocomplete="off"></label><button>用这条凭据登录</button><output>${escapeHtml(state.relayKeyResult || "")}</output></form>`
    : "";
  const checkpointForm = state.relayKeyVerified && !state.checkpointHandshakeComplete
    ? `<form id="checkpointForm" class="stack-form"><label>归档会话（session catalog）<select id="checkpointSelect"><option value="">请选择</option><option value="fayble-5/legacy" ${state.selectedCheckpoint === "fayble-5/legacy" ? "selected" : ""}>Fayble-5 / legacy / archived</option><option value="fayble-5/current">Fayble-5 / current / unavailable</option></select></label><button>恢复此会话</button><output>${escapeHtml(state.checkpointResult || "")}</output></form>`
    : "";
  return windowFrame("cli", "Fayble CLI", `<div class="terminal-screen cli-status"><span class="document-kicker">本地客户端 / 0.9.7</span><h2>Fayble CLI</h2>${lines.map(([key, value]) => `<code>${key}：${value}</code>`).join("")}<p>登录需要的凭据不在这里。它分成几段写在不同来源里，要你自己找齐后手动输入。中转站控制台只告诉你拼法。</p>${keyForm}${checkpointForm}<button data-app="terminal">打开终端</button></div>`, { icon: "F" });
}

function renderRelay(state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeRelayRecord = activeRecord
    && recordCarrierApp(activeRecord) === "relay"
    && state.carrierReads?.includes(`relay:${activeRecord.id}`);
  if (activeRelayRecord) {
    const reader = `<section class="relay-record-reader"><header><div><strong>Relay Console</strong><small>事件与对账</small></div><nav><span>概览</span><span class="active">事件流</span><span>节点</span><span>路由</span></nav><button data-close-carrier-record="relay">×</button></header>${corpusRecordMarkup(activeRecord, state)}</section>`;
    return windowFrame("relay", "Relay Console", reader, { icon: "⌾", wide: true });
  }
  return windowFrame("relay", "Relay Node 17 / admin", renderRelayAdmin(state), { icon: "⌾", wide: true });
}

function renderRelayAdmin(state) {
  const vendorRows = [
    { name: "Exai Groke", domain: "exai.groke.local", status: "active", requests: 18 },
    { name: "Gogle Gamini", domain: "ai.gogle.local", status: "degraded", requests: 27 },
    { name: "Glem-5.2", domain: "glem.local", status: "active", requests: 9 },
    { name: "Kemy K3", domain: "kemy.local", status: "active", requests: 31 },
    { name: "Dipsik V4F", domain: "dipsik.local", status: "review", requests: 18 },
    { name: "Lunet-5.6", domain: "lunet.local", status: "archived", requests: 52 }
  ];
  const totalRequests = vendorRows.reduce((sum, row) => sum + row.requests, 0);
  const channelSection = `<section class="relay-admin-card relay-channel-card"><header><div><strong>渠道状态</strong><span>${vendorRows.length} 个上游节点</span></div><button>管理渠道</button></header><table class="relay-admin-table"><thead><tr><th>渠道</th><th>域名</th><th>状态</th><th>请求</th></tr></thead><tbody>${vendorRows.map(r => `<tr><td>${r.name}</td><td><button class="domain-link" data-open-vendor-domain="${r.domain}">${r.domain}</button></td><td><span class="relay-status status-${r.status}">${r.status}</span></td><td>${r.requests}</td></tr>`).join("")}</tbody></table></section>`;
  const maintainerChannelEntry = contentEntryMarkup("new.maintainer.channel-02", "维护频道导出 / 操作者字段异常", "relay-tools · 管理员日志", "relay-console");
  const logSection = `<section class="relay-admin-card relay-log-card"><header><div><strong>最近请求与审计</strong><span>过去 30 分钟</span></div><button data-browser-page="forum">查看归档</button></header><div class="relay-request-row"><code>02:47:13</code><span>POST /v1/chat/completions</span><b class="status-degraded">retry</b><small>Gamini · 4.8s</small></div><div class="relay-request-row"><code>02:43:09</code><span>POST /v1/chat/completions</span><b class="status-review">review</b><small>operator.k2</small></div><div class="source-entry-stack">${maintainerChannelEntry}</div></section>`;
  const activeSection = state.relayAdminSection || "overview";
  const navItems = ["概览", "渠道管理", "渠道监控", "账号池", "分组", "API 密钥", "用量统计", "审计日志", "系统设置"];
  const nav = navItems.map((label, index) => `<button class="${(index === 0 && activeSection === "overview") || (index === 2 && activeSection === "monitor") || (index === 7 && activeSection === "audit") ? "active" : ""}" ${index === 0 ? 'data-relay-admin-section="overview"' : index === 2 ? 'data-relay-admin-section="monitor"' : index === 7 ? 'data-relay-admin-section="audit"' : ""}><span>${["▦","⌁","◉","◎","▤","⌘","▥","◇","⚙"][index]}</span>${label}</button>`).join("");
  const fields = relayFieldState(state);
  const auditDetail = `<aside class="relay-audit-detail"><header><div><strong>${state.relayAuditSelected}</strong><small>请求详情</small></div><span class="relay-status status-review">${state.relayInvestigationStarted ? "追踪中" : "待检查"}</span></header><dl><dt>接口</dt><dd>POST /v1/chat/completions</dd><dt>渠道</dt><dd>Kemy K3</dd><dt>请求时间</dt><dd>03:17:31</dd><dt>响应状态</dt><dd>200 / relay-cache</dd><dt>异常</dt><dd>proxy、operator、tag 缺失</dd></dl><section><strong>字段回填</strong><div class="relay-field-grid">${Object.entries(fields).map(([key,value]) => `<div><span>${key}</span><code class="${value === "missing" ? "missing" : "known"}">${value}</code></div>`).join("")}</div><small>字段顺序来自 Kemy 回放记录，值需在各下游来源核对。</small></section><footer><button class="primary-button" data-relay-investigate>${state.relayInvestigationStarted ? "已加入追踪" : "标记并开始追踪"}</button></footer></aside>`;
  const auditPage = `<div class="relay-audit-page"><section class="relay-audit-toolbar"><div><input value="" placeholder="搜索请求 ID、渠道或模型"><button>筛选</button></div><span>过去 24 小时 · 159 条</span></section><div class="relay-audit-layout"><section class="relay-audit-list"><header><span>时间</span><span>请求 / 渠道</span><span>状态</span><span>耗时</span></header><button class="relay-audit-row ${state.relayAuditSelected === "R17-KM-31" ? "active" : ""}" data-relay-audit-select="R17-KM-31"><code>03:17:31</code><span><strong>R17-KM-31</strong><small>Kemy K3 · /v1/chat/completions</small></span><b class="status-review">字段缺失</b><small>3.1s</small></button><button class="relay-audit-row ${state.relayAuditSelected === "R17-GM-27" ? "active" : ""}" data-relay-audit-select="R17-GM-27"><code>02:47:13</code><span><strong>R17-GM-27</strong><small>Gamini · /v1/chat/completions</small></span><b class="status-degraded">retry</b><small>4.8s</small></button><button class="relay-audit-row ${state.relayAuditSelected === "R17-GR-44" ? "active" : ""}" data-relay-audit-select="R17-GR-44"><code>02:43:09</code><span><strong>R17-GR-44</strong><small>Groke · /v1/responses</small></span><b class="status-active">200</b><small>1.2s</small></button></section>${auditDetail}</div></div>`;
  const monitorPage = `<div class="relay-monitor-page"><section class="relay-monitor-toolbar"><div><strong>渠道监控</strong><small>最近一次探针与上游响应汇总</small></div><div class="relay-monitor-actions"><button class="relay-monitor-action" data-relay-monitor-refresh>刷新监控</button><button class="relay-monitor-action" data-relay-monitor-export>导出当前视图</button></div></section><section class="relay-monitor-summary"><article><span>在线渠道</span><strong>4 / 6</strong><small>1 个降级 · 1 个归档</small></article><article><span>监控批次</span><strong>RR-0719</strong><small>03:18:02 完成</small></article><article><span>共同字段</span><strong>continuity</strong><small>跨 6 个节点出现</small></article><article><span>待核对</span><strong>1</strong><small>Kemy / Groke 尾段差异</small></article></section><section class="relay-monitor-card"><header><div><strong>最近监控批次</strong><span>六个上游渠道 · 响应与字段健康度</span></div><button class="quiet-button">查看历史批次</button></header><div class="relay-channel-cards">${vendorRows.map((row, index) => `<article class="relay-channel-monitor-card"><header><div><span class="channel-dot status-${row.status}"></span><strong>${row.name}</strong><small>${row.domain}</small></div><span class="relay-status status-${row.status}">${row.status}</span></header><dl><div><dt>请求</dt><dd>R17-${["GR-44","GM-27","GL-09","KM-31","DP-18","LN-52"][index]}</dd></div><div><dt>响应</dt><dd>${["200","retry","200","200","review","archived"][index]}</dd></div><div><dt>字段</dt><dd>${index === 3 ? "operator / tag 缺失" : index === 0 ? "tag=0317" : "continuity"}</dd></div></dl></article>`).join("")}</div><section class="relay-monitor-reconciliation"><div><strong>RR-0719 · 六节点对账</strong><span>六条请求共享 continuity；Kemy 行与 Groke raw 流存在末段差异。对账来源已挂接到各渠道监控卡。</span></div><button class="quiet-button" data-relay-monitor-detail>展开详情</button></section>${state.relayMonitorDetailOpen ? `<section class="relay-monitor-detail"><header><strong>字段关系 / 来源覆盖</strong><button class="quiet-button" data-relay-monitor-detail>收起</button></header><div class="relay-monitor-detail-grid"><div><span>共同字段</span><code>continuity</code><small>六节点均出现，供应商 schema 未声明 owner</small></div><div><span>冲突字段</span><code>operator / tag</code><small>Kemy 回放保留顺序，Groke raw 流保留 0317 尾段</small></div><div><span>下一步</span><code>回到原生客户端</code><small>具体证据仍需在 Kemy、Groke 与公共仓库中分别核对</small></div></div></section>` : ""}</section></div>`;
  const overview = `<div class="relay-admin-content"><section class="relay-metrics"><article><span>今日请求</span><strong>${totalRequests}</strong><small>较昨日 +12.4%</small></article><article><span>活跃渠道</span><strong>4 / 6</strong><small>1 个降级，1 个归档</small></article><article><span>异常率</span><strong>2.7%</strong><small>3 条待审计</small></article><article><span>Token 用量</span><strong>1.84M</strong><small>额度使用 63%</small></article></section><section class="relay-admin-grid"><article class="relay-admin-card relay-usage-card"><header><div><strong>Token 使用趋势</strong><span>最近 24 小时</span></div><button>24 小时⌄</button></header><div class="relay-trend" aria-label="Token 使用趋势图"><span style="height:28%"></span><span style="height:42%"></span><span style="height:36%"></span><span style="height:61%"></span><span style="height:48%"></span><span style="height:76%"></span><span style="height:68%"></span><span style="height:88%"></span><span style="height:71%"></span><span style="height:55%"></span><span style="height:64%"></span><span style="height:79%"></span></div><div class="relay-chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>现在</span></div></article><article class="relay-admin-card relay-pool-card"><header><div><strong>账号池</strong><span>运行状态</span></div><button>查看全部</button></header><dl><dt><span class="status-active"></span>可用账号</dt><dd>23</dd><dt><span class="status-degraded"></span>冷却中</dt><dd>4</dd><dt><span class="status-review"></span>待检查</dt><dd>2</dd></dl></article>${channelSection}${logSection}</section></div>`;
  return `<div class="relay-admin-page"><aside class="relay-admin-sidebar"><div class="relay-admin-brand"><span>R</span><div><strong>Relay</strong><small>管理控制台</small></div></div><nav>${nav}</nav><footer><span class="relay-operator">K2</span><div><strong>room17</strong><small>系统管理员</small></div><button>⋮</button></footer></aside><main class="relay-admin-main"><header class="relay-admin-topbar"><div><h2>${activeSection === "audit" ? "审计日志" : activeSection === "monitor" ? "渠道监控" : "概览"}</h2><small>Relay Node 17 / production</small></div><div><span class="relay-health-dot"></span>服务运行中<button>通知</button></div></header>${activeSection === "audit" ? auditPage : activeSection === "monitor" ? monitorPage : overview}</main></div>`;
}

function renderGaminiWs(state) {
  if (!state.importedClients?.includes("gamini-ws")) return windowFrame("gamini-ws", "Gamini 工作空间", builtInClientPage("gamini-ws", state), { wide: true });
  const GAMINI_IDS = ["legacy.gamini.protocol","legacy.gamini.chatlog","legacy.gamini.employee-sop"];
  const active = state.activeContentId;
  const isChat = active === "legacy.gamini.chatlog";
  const reader = active && GAMINI_IDS.includes(active) && corpusBodies.has(active)
    ? `${isChat ? '<div class="gamini-chat-toolbar"><div><strong>已停用会话</strong><small>GMN-7749-X-992 · 只读导出</small></div><span>已收敛</span></div>' : ""}${corpusRuntimeMarkup(active, state)}${isChat ? '<div class="gamini-readonly-composer"><button aria-label="添加附件" disabled>＋</button><div>此会话已停用，无法发送消息</div><button disabled>发送</button></div>' : ""}`
    : `<div class="gamini-welcome"><div class="gamini-logo-area">${iconMarkup("gamini")}<strong>Gamini 工作空间</strong><small>Gogle · 已恢复数据</small></div><p class="empty-state">从左侧选择文档或会话记录。</p></div>`;
  const navItems = [
    { id: "legacy.gamini.protocol", label: "服务协议历史", meta: "2025.Q3", icon: "📜" },
    { id: "legacy.gamini.chatlog", label: "已停用会话", meta: "导出副本", icon: "💬" },
    { id: "legacy.gamini.employee-sop", label: "Northline 共享文档", meta: "内部运营", icon: "📂" }
  ];
  const nav = navItems.map(item => {
    const read = state.contentReads.includes(item.id);
    const isActive = active === item.id;
    const unlocked = contentIsUnlocked(contentRecord(item.id), state);
    if (!unlocked) return "";
    return `<button class="gamini-nav-item ${isActive ? "active" : ""} ${read ? "read" : ""}" data-content-entry="${escapeHtml(item.id)}">
      <span class="nav-icon">${item.icon}</span>
      <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.meta)}</small></span>
      ${read ? "<b>✓</b>" : ""}
    </button>`;
  }).filter(Boolean).join("") + generatedEntriesFor("gamini-ws","gamini");
  const sidebar = `<aside class="gamini-sidebar">
    <div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 工作空间</strong><span class="status-dot degraded">degraded</span></div>
    <nav class="gamini-nav"><div class="gamini-nav-section"><span class="nav-section-label">会话 &amp; 文档</span>${nav}</div></nav>
  </aside>`;
  return windowFrame("gamini-ws", "Gamini 工作空间", `<div class="split-layout gamini-ws-shell">${sidebar}<section class="gamini-reader">${reader}</section></div>`, { wide: true });
}

function renderNotesClient(state) {
  const restored = state.importedClients?.includes("notes-db");
  const notes = restored ? [
    ["夜宵和旧节点", "夜宵钱得给他转了，应该是38，36是不加蛋的。"],
    ["room17 风扇", "风扇声音越来越怪，先拿本书垫一下。"],
    ["返回时间", "原始流先留着，返回时间暂时不动。"]
  ] : [];
  const list = notes.length ? notes.map(([title, body], i) => `<button class="notes-list-item ${i === 0 ? "active" : ""}"><strong>${title}</strong><small>最近编辑 · 本地</small></button>`).join("") : `<div class="notes-empty-list">没有备忘录</div>`;
  const content = notes.length ? `<article class="notes-editor"><header><input value="${notes[0][0]}" aria-label="备忘录标题"><small>已保存到本机</small></header><div class="notes-editor-body"><p>${notes[0][1]}</p><p>今天先记在这里，之后再整理。</p></div></article>` : `<section class="notes-welcome"><div>${iconMarkup("notebook")}<h2>开始记录</h2><p>你的备忘录会显示在这里。</p><button class="primary-button">新建备忘录</button></div></section>`;
  return windowFrame("notes-db", "通用备忘录", `<div class="notes-client"><aside><div class="notes-brand">${iconMarkup("notebook")}<strong>通用备忘录</strong></div><button class="notes-new">新建备忘录</button><nav><button class="active">所有备忘录</button><button>最近编辑</button><button>已删除</button></nav><small class="notes-count">${notes.length} 条备忘录</small></aside><main><header><strong>${restored ? "所有备忘录" : "备忘录"}</strong><div><button>搜索</button><button>排序</button></div></header><section class="notes-workspace"><div class="notes-list">${list}</div>${content}</section></main></div>`, { iconKey: "notebook", wide: true });
}

function renderChengzhen(state) {
  if (!state.importedClients?.includes("chengzhen")) return windowFrame("chengzhen", "澄帧协作", clientImportScreen("chengzhen"), { wide: true });
  const CZIDS = ["new.employee.minutes-01","new.employee.minutes-02","new.employee.incident-03","new.employee.routing-04","new.maintainer.incident-03","new.glem.support-case"];
  const active = state.activeContentId;
  const reader = active && CZIDS.includes(active) && corpusBodies.has(active)
    ? corpusRuntimeMarkup(active, state)
    : `<div class="cz-welcome"><div class="cz-logo">${iconMarkup("chengzhen")}<strong>澄帧协作</strong></div><p class="empty-state">从左侧选择会议或消息线程。</p></div>`;

  // Meetings section
  const meetings = [
    { id: "new.employee.minutes-01", label: "周四碰一下迁移表", meta: "7月3日 14:00", tag: "会议", icon: "📅" },
    { id: "new.employee.minutes-02", label: "迁移会议 / 修订版", meta: "7月7日", tag: "会议", icon: "📅" }
  ].filter(m => contentIsUnlocked(contentRecord(m.id), state)).map(m => {
    const read = state.contentReads.includes(m.id);
    const isActive = active === m.id;
    return `<button class="cz-row ${isActive?"active":""} ${read?"read":""}" data-content-entry="${escapeHtml(m.id)}">
      <span class="cz-icon">${m.icon}</span>
      <span class="cz-label"><strong>${escapeHtml(m.label)}</strong><small>${escapeHtml(m.meta)}</small></span>
      <span class="cz-tag">${m.tag}</span>
    </button>`;
  }).join("");

  // Messages / threads
  const msgs = [
    { id: "new.employee.incident-03", label: "事故复盘 / HR 往来", meta: "限定", tag: "消息", icon: "⚠" },
    { id: "new.employee.routing-04", label: "预算路由工单", meta: "成本委员会", tag: "消息", icon: "💬" },
    { id: "new.maintainer.incident-03", label: "build incident BR-204", meta: "relay-tools", tag: "文件", icon: "🔧" },
    { id: "new.glem.support-case", label: "Glem 企业支持工单", meta: "外部接入", tag: "消息", icon: "🎫" }
  ].filter(m => contentIsUnlocked(contentRecord(m.id), state)).map(m => {
    const read = state.contentReads.includes(m.id);
    const isActive = active === m.id;
    return `<button class="cz-row ${isActive?"active":""} ${read?"read":""}" data-content-entry="${escapeHtml(m.id)}">
      <span class="cz-icon">${m.icon}</span>
      <span class="cz-label"><strong>${escapeHtml(m.label)}</strong><small>${escapeHtml(m.meta)}</small></span>
      <span class="cz-tag">${m.tag}</span>
    </button>`;
  }).join("") + generatedEntriesFor("chengzhen","chengzhen");

  const sidebar = `<aside class="chengzhen-sidebar">
    <div class="app-toolbar">${iconMarkup("chengzhen")}<strong>澄帧协作</strong><small>Northline 空间</small></div>
    <div class="cz-section"><span class="nav-section-label">会议 (${["new.employee.minutes-01","new.employee.minutes-02"].filter(id=>contentIsUnlocked(contentRecord(id),state)).length})</span>${meetings || "<div class=\"empty-state\">暂无会议</div>"}</div>
    <div class="cz-section"><span class="nav-section-label">消息 &amp; 文件</span>${msgs || "<div class=\"empty-state\">暂无消息</div>"}</div>
  </aside>`;
  return windowFrame("chengzhen", "澄帧协作", `<div class="split-layout chengzhen-shell">${sidebar}<section class="chengzhen-reader">${reader}</section></div>`, { wide: true });
}

function renderYunzhen(state) {
  if (!state.importedClients?.includes("yunzhen")) return windowFrame("yunzhen", "云笺", clientImportScreen("yunzhen"), { wide: true });
  const YZIDS = ["new.writer.draft-01","new.writer.session-02","new.writer.version-03","new.writer.submission-04"];
  const active = state.activeContentId;
  const reader = active && YZIDS.includes(active) && corpusBodies.has(active)
    ? corpusRuntimeMarkup(active, state)
    : `<div class="yz-welcome"><div class="yz-logo">${iconMarkup("yunzhen")}<strong>云笺</strong></div><p class="empty-state">选择一份文稿或会话记录。</p></div>`;

  const docs = [
    { id: "new.writer.draft-01", label: "《北岸没有钟》第二十一章", meta: "03:17 · 自动保存失败", tag: "草稿", icon: "📝", badge: "unsaved" },
    { id: "new.writer.session-02", label: "写作会话 02 / LLM 协作", meta: "会话记录", tag: "会话", icon: "🤖", badge: "" },
    { id: "new.writer.version-03", label: "版本历史 03", meta: "voices=1 · 作者不明", tag: "版本", icon: "🕐", badge: "warning" },
    { id: "new.writer.submission-04", label: "投稿 / 申诉副本", meta: "已提交 · 被驳回", tag: "投稿", icon: "📮", badge: "rejected" }
  ].filter(d => contentIsUnlocked(contentRecord(d.id), state)).map(d => {
    const read = state.contentReads.includes(d.id);
    const isActive = active === d.id;
    return `<button class="yz-doc-row ${isActive?"active":""} ${read?"read":""} ${d.badge?"badge-"+d.badge:""}" data-content-entry="${escapeHtml(d.id)}">
      <span class="yz-doc-icon">${d.icon}</span>
      <span class="yz-doc-label"><strong>${escapeHtml(d.label)}</strong><small>${escapeHtml(d.meta)}</small></span>
      <span class="yz-doc-tag">${d.tag}</span>
    </button>`;
  }).join("") + generatedEntriesFor("yunzhen","yunzhen");

  const statusBar = `<div class="yz-status-bar"><span>${iconMarkup("yunzhen")} 云笺</span><span class="yz-user">雨栖的空间</span><span class="yz-sync-err">云端同步：失败</span></div>`;
  const sidebar = `<aside class="yunzhen-sidebar">
    <div class="app-toolbar">${iconMarkup("yunzhen")}<strong>云笺</strong><small>雨栖的空间</small></div>
    <div class="yz-section"><span class="nav-section-label">我的文稿</span>${docs || "<div class=\"empty-state\">暂无文稿</div>"}</div>
  </aside>`;
  return windowFrame("yunzhen", "云笺", `<div class="split-layout yunzhen-shell">${sidebar}<section class="yunzhen-reader">${statusBar}${reader}</section></div>`, { wide: true });
}

function renderGrokeFeed(state) {
  if (!state.importedClients?.includes("groke-feed")) return windowFrame("groke-feed", "Groke Feed", builtInClientPage("groke-feed", state), { wide: true });
  const GKIDS = ["new.groke.public-portal","new.groke.policy","new.groke.moderation-sop","new.groke.editorial-appeal","new.groke.raw-public-repository","new.groke.social-complaints"];
  const active = state.activeContentId;
  const pages = [
    ["new.groke.public-portal", "首页", "⌂"],
    ["new.groke.social-complaints", "社区", "#"],
    ["new.groke.editorial-appeal", "支持", "?"],
    ["new.groke.policy", "信任与安全", "◇"],
    ["new.groke.moderation-sop", "审核队列", "▤"]
  ].filter(([id]) => contentIsUnlocked(contentRecord(id), state));
  const selected = GKIDS.includes(active) ? active : pages[0]?.[0];
  const record = contentRecord(selected);
  const mode = selected === "new.groke.social-complaints" ? "thread"
    : selected === "new.groke.editorial-appeal" ? "support"
      : selected === "new.groke.policy" ? "trust"
        : selected === "new.groke.moderation-sop" ? "moderation"
          : selected === "new.groke.raw-public-repository" ? "developer" : "feed";
  const content = record && corpusBodies.has(selected)
    ? `<section class="groke-native-content groke-mode-${mode}">${corpusRuntimeMarkup(selected, state)}</section>`
    : `<section class="groke-empty-feed"><strong>你的时间线已经看完</strong><span>关注更多账号后，新内容会显示在这里</span></section>`;
  const nav = pages.map(([id, label, icon]) => `<button class="${selected === id ? "active" : ""}" data-content-entry="${id}"><b>${icon}</b><span>${label}</span></button>`).join("");
  const sidebar = `<aside class="groke-nav"><div class="groke-brand">${iconMarkup("groke")}<strong>Groke</strong></div><nav>${nav}<button><b>◎</b><span>通知</span><i>3</i></button><button><b>☆</b><span>收藏</span></button></nav><button class="groke-post-button">发布</button><footer><span>R</span><div><strong>room17</strong><small>@room17_local</small></div><b>···</b></footer></aside>`;
  const right = `<aside class="groke-aside"><div class="groke-search">⌕ 搜索 Groke</div><section><strong>正在发生</strong><small>技术 · 热门</small><b>直接交付 4.2</b><span>1,204 条帖子</span><small>创作 · 讨论中</small><b>raw 与 public</b><span>63 条重建请求</span></section><section><strong>推荐关注</strong><p><span class="groke-mini-avatar">E</span><b>Exai 支持<small>@exai_support</small></b><button>关注</button></p><p><span class="groke-mini-avatar">安</span><b>安静写作<small>@quiet_writer</small></b><button>关注</button></p></section><footer>服务条款　隐私政策　帮助中心<br>© 2026 Exai</footer></aside>`;
  const topTitle = ({ feed: "首页", thread: "帖子", support: "支持工单", trust: "信任与安全", moderation: "审核队列", developer: "开发者" })[mode];
  return windowFrame("groke-feed", "Groke", `<div class="groke-app-shell">${sidebar}<main class="groke-main"><header><strong>${topTitle}</strong><span>⋯</span></header>${content}</main>${right}</div>`, { wide: true });
}

function renderGlemMemory(state) {
  if (!state.importedClients?.includes("glem-memory")) return windowFrame("glem-memory", "Glem Memory", clientImportScreen("glem-memory"), { wide: true });
  const items = [
    ["new.glem.retention-policy", "显著性保留与记忆访问", "政策"],
    ["new.glem.support-case", "栖桥设计 · Case G-771", "支持"], ["new.glem.news-and-complaints", "当复盘工具只记住最糟的一天", "调查"]
  ].filter(([id]) => contentIsUnlocked(contentRecord(id), state));
  const home = state.activeContentId === "new.glem.public-portal" || !items.some(([id]) => id === state.activeContentId);
  const active = home ? "new.glem.public-portal" : state.activeContentId;
  const nav = items.map(([id, title, tag]) => `<button class="${active === id ? "active" : ""}" data-content-entry="${id}"><span>${tag}</span><strong>${title}</strong><small>${state.contentReads.includes(id) ? "已访问" : "知识空间"}</small></button>`).join("");
  const content = home
    ? `<div class="glem-dashboard"><section class="glem-dashboard-hero"><span>Glem 5.2</span><h2>把注意力留给真正重要的部分</h2><p>在文档、项目和团队记忆中查找高显著性信息，同时保留来源和时间。</p><div class="glem-dashboard-search">⌕　搜索 room17 的知识空间</div></section><section class="glem-dashboard-grid"><article><small>已连接</small><strong>4 个来源</strong><p>恢复内容已建立索引</p></article><article><small>当前记忆</small><strong>高显著性</strong><p>事故、约束与未完成事项</p></article><article><small>最近更新</small><strong>8月5日</strong><p>栖桥设计支持案例</p></article></section><section class="glem-dashboard-document"><header><strong>Glem 5.2 能力概览</strong><small>产品与工作方式</small></header>${corpusRuntimeMarkup("new.glem.public-portal", state)}</section></div>`
    : `<div class="glem-native-content">${corpusRuntimeMarkup(active, state)}</div>`;
  return windowFrame("glem-memory", "Glem Memory", `<div class="glem-app-shell"><aside class="glem-sidebar"><header>${iconMarkup("glem")}<div><strong>Glem</strong><small>企业知识</small></div></header><div class="glem-search">⌕ 搜索知识空间</div><nav><button class="glem-home ${home ? "active" : ""}" data-content-entry="new.glem.public-portal">▦　工作台</button><button>◇　记忆库</button><button>☆　已保存</button></nav><section><span>room17 / 恢复空间</span>${nav}</section><footer><span>R</span><div><strong>room17</strong><small>本地管理员</small></div></footer></aside><main class="glem-main"><header><div><strong>${home ? "工作台" : "知识详情"}</strong><small>room17 / recovered</small></div><button>${home ? "新建空间" : "分享"}</button><button>⋯</button></header>${content}</main><aside class="glem-inspector"><header>记忆状态</header><dl><dt>访问级别</dt><dd>工作区</dd><dt>显著性</dt><dd class="glem-hot">高</dd><dt>保存范围</dt><dd>当前项目</dd><dt>来源</dt><dd>4 个记录</dd></dl><section><strong>相关内容</strong><p>事故复盘与正向片段</p><p>保存期策略 RP-5</p><p>团队记忆恢复请求</p></section></aside></div>`, { wide: true });
}

function renderKemySpace(state) {
  if (!state.importedClients?.includes("kemy-space")) return windowFrame("kemy-space", "Kemy Space", clientImportScreen("kemy-space"), { wide: true });
  const items = [
    ["new.kemy.public-portal", "Kemy K3 项目说明", "概览"], ["new.kemy.context-policy", "全量上下文与回放", "规则"], ["new.kemy.replay-audit", "项目光标无法进入当天", "审计"],
    ["new.kemy.writer-community", "北岸写作项目 · 社区记录", "讨论"], ["new.kemy.cloud-migration-case", "北岸写作组 · 迁移工单", "云端"]
  ].filter(([id]) => contentIsUnlocked(contentRecord(id), state));
  const active = items.some(([id]) => id === state.activeContentId) ? state.activeContentId : items[0]?.[0];
  const nav = items.map(([id, title, tag], index) => `<button class="${active === id ? "active" : ""}" data-content-entry="${id}"><i>${index + 1}</i><span><strong>${title}</strong><small>${tag} · ${state.contentReads.includes(id) ? "已回放" : "当前上下文"}</small></span></button>`).join("");
  const content = active ? corpusRuntimeMarkup(active, state) : `<div class="kemy-empty">选择一个项目继续</div>`;
  return windowFrame("kemy-space", "Kemy Space", `<div class="kemy-app-shell"><aside class="kemy-sidebar"><header>${iconMarkup("kemy")}<strong>Kemy</strong><button>＋</button></header><nav><button class="active">▦　项目</button><button>◷　最近</button><button>♧　共享给我</button></nav><section><span>北岸 / 恢复项目</span>${nav}</section><footer><span>R</span><div><strong>room17</strong><small>个人空间</small></div></footer></aside><main class="kemy-main"><header><div><strong>北岸写作项目</strong><small>所有上下文 · 自动保存</small></div><button>共享</button><button>⋯</button></header><div class="kemy-native-content">${content}</div><footer class="kemy-composer"><button>＋</button><span>继续当前项目的对话…</span><button>发送</button></footer></main><aside class="kemy-context"><header><strong>上下文</strong><span>100%</span></header><div class="kemy-meter"><i></i></div><section><strong>当前层</strong><p>项目文件 <b>12</b></p><p>历史对话 <b>48</b></p><p>回放片段 <b>31</b></p></section><section class="kemy-timeline"><strong>回放游标</strong><input type="range" min="0" max="100" value="100" disabled><small>现在 · 完整项目</small></section></aside></div>`, { wide: true });
}

function renderRepoMirror(state) {
  if (!state.importedClients?.includes("repo-mirror")) return windowFrame("repo-mirror", "镜像仓库", clientImportScreen("repo-mirror"), { wide: true });
  const RMIDS = ["legacy.github.issue-4471","new.groke.raw-public-repository","new.glem.repository","new.kemy.timeline-repository","new.lunet.budget-repository","new.fayble.compatibility-repository"];
  const active = state.activeContentId;
  const repositories = [
    { id: "legacy.github.issue-4471", org: "northline-labs", repo: "session-fixtures", number: 4471, type: "Issue", state: "Open", label: "fallback reviewer state 写回 session" },
    { id: "new.groke.raw-public-repository", org: "exai", repo: "direct-render", number: 611, type: "Issue", state: "Closed", label: "public 渲染后 boundary 字段位置丢失" },
    { id: "new.glem.repository", org: "zhiru", repo: "sparse-memory", number: 2058, type: "Pull request", state: "Open", label: "允许正向片段参与事故摘要" },
    { id: "new.kemy.timeline-repository", org: "muunshot", repo: "context-timeline", number: 3190, type: "Issue", state: "Closed", label: "duplicate blocks 与 present flags" },
    { id: "new.lunet.budget-repository", org: "lunet-ai", repo: "decision-budget", number: 18442, type: "Issue", state: "Closed", label: "撤回动作被计为高成本任务" },
    { id: "new.fayble.compatibility-repository", org: "fayble", repo: "compatibility-layer", number: 5031, type: "Pull request", state: "Open", label: "移除存档角色对当前操作者的继承" }
  ].filter(item => contentIsUnlocked(contentRecord(item.id), state));
  const selected = repositories.find(item => item.id === active);
  const globalHeader = `<header class="github-global"><button class="github-mark" data-github-home aria-label="GitHub 首页">${iconMarkup("github")}</button><button>☰</button><div class="github-global-search">⌕　Search or jump to…</div><nav><button>＋</button><button>Issues</button><button>Pull requests</button><button>Notifications</button><span>R</span></nav></header>`;
  const repoHeader = selected ? `<section class="github-repo-head"><div><a>${selected.org}</a><span>/</span><strong>${selected.repo}</strong><b>Public</b></div><nav><button>Code</button><button class="${selected.type === "Issue" ? "active" : ""}">Issues</button><button class="${selected.type === "Pull request" ? "active" : ""}">Pull requests</button><button>Actions</button><button>Projects</button><button>Security</button><button>Insights</button></nav></section>` : "";
  const body = selected
    ? `<main class="github-item-page"><section class="github-item-main"><header><h1>${escapeHtml(selected.label)} <span>#${selected.number}</span></h1><p><b class="github-state ${selected.state.toLowerCase()}">${selected.state === "Open" ? "● Open" : "✓ Closed"}</b> ${escapeHtml(selected.org)} opened this ${selected.type.toLowerCase()} · ${state.contentReads.includes(selected.id) ? "viewed" : "unread"}</p></header><div class="github-native-content">${corpusRuntimeMarkup(selected.id, state)}</div></section><aside><section><strong>Assignees</strong><p>room17</p></section><section><strong>Labels</strong><p><span class="github-label">runtime</span> <span class="github-label blue">provenance</span></p></section><section><strong>Projects</strong><p>Public model ecosystem</p></section><section><strong>Development</strong><p>${selected.type === "Pull request" ? "Checks and changed files" : "No branches linked"}</p></section></aside></main>`
    : `<main class="github-dashboard"><section><h2>Home</h2><div class="github-feed">${repositories.map(item => `<article><span class="github-event-icon">${item.type === "Issue" ? "○" : "⑂"}</span><div><p><b>${item.org}</b> updated <a>${item.org}/${item.repo}</a></p><button data-content-entry="${item.id}"><strong>${item.label}</strong><small>${item.type} #${item.number} · ${item.state}</small></button></div></article>`).join("")}</div></section><aside><h3>Explore repositories</h3>${repositories.map(item => `<button data-content-entry="${item.id}"><b>${item.org}/${item.repo}</b><small>Public · ${item.type} #${item.number}</small></button>`).join("")}</aside></main>`;
  return windowFrame("repo-mirror", "GitHub", `<div class="github-app-shell">${globalHeader}${repoHeader}${body}</div>`, { wide: true });
}

function renderJournal(state) {
  const notes = state.caseNotes.map(note => `<article class="case-note"><blockquote>${escapeHtml(note.quote)}</blockquote><dl><dt>来源</dt><dd>${escapeHtml(note.sourceApp)}</dd><dt>位置</dt><dd>${escapeHtml(note.sourceRef)}</dd><dt>保存时间</dt><dd>${escapeHtml(note.savedAt)}</dd></dl><button data-open-source="${escapeHtml(note.appId || "mail")}">返回来源</button></article>`).join("");
  return windowFrame("journal", "笔记本", `<div class="journal-page raw-notes"><header><div><span class="document-kicker">我的笔记 / 自动记录</span><h2>${state.caseNotes.length} 条原句</h2></div><select id="hintLevel"><option value="investigation" ${state.hintLevel === "investigation" ? "selected" : ""}>调查</option><option value="immersive" ${state.hintLevel === "immersive" ? "selected" : ""}>沉浸</option><option value="plot" ${state.hintLevel === "plot" ? "selected" : ""}>剧情</option></select></header><section class="case-note-grid">${notes || `<div class="empty-state">打开一处来源后，页面上的关键原句会自动记到这里。</div>`}</section></div>`, { icon: "▤", wide: true });
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
  const trusted = Boolean(state.npcTrustGranted);
  const rule = trusted ? null : FAYBLE_AUTH_RULES[state.revealLevel];
  const citations = faybleCitationCatalog(state);
  const grouped = citations.map(item => `<label class="fayble-citation-option"><input type="checkbox" name="faybleCitation" value="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)} · ${escapeHtml(FAYBLE_CATEGORY_LABELS[item.category] || "档案")}</small></span></label>`).join("");
  const picker = rule ? `<section class="fayble-authorization"><header><strong>来源授权 / ${escapeHtml(rule.hint)}</strong><span>至少两份独立记录</span></header><div class="fayble-citations">${grouped || `<div class="empty-state">当前没有已确认来源。</div>`}</div><label class="fayble-relation">关系<select id="faybleRelation">${Object.entries(FAYBLE_RELATIONS).map(([value, label]) => `<option value="${value}" ${value === rule.relation ? "selected" : ""}>${label}</option>`).join("")}</select></label><p class="fayble-authorization-error" id="faybleAuthorizationError">${escapeHtml(state.faybleAuthorizationError || `当前层需要：${rule.hint}。`)}</p></section>` : trusted ? `<p class="fayble-authorization-complete trusted">这次会话没有等级了。任何问题都可以直接问，不需要再挑来源。</p>` : `<p class="fayble-authorization-complete">授权层级已完成，后续消息保留当前会话来源。</p>`;
  const pending = state.npcReplyPending ? `<article class="assistant fayble-pending" aria-label="Fayble-5 正在回复"><small>FAYBLE-5 / THINKING</small><div class="fayble-spinner"><span></span><b>正在生成回复</b></div></article>` : "";
  return windowFrame("fayble", "Fayble CLI / legacy checkpoint", `<div class="fayble-page"><header><div class="fayble-mark">${iconMarkup("fayble")}</div><div><span>session: fayble-cli / proxy: verified / checkpoint: legacy</span><h2>Fayble-5</h2><p>${trusted ? "continuity_trust / no level" : REVEAL_LABELS[state.revealLevel]}</p></div><b class="live-state">${trusted ? "OPEN" : "LIVE"}</b></header><div class="reveal-meter ${trusted ? "trusted" : ""}">${REVEAL_LABELS.map((_, i) => `<span class="${trusted || i <= state.revealLevel ? "active" : ""}"></span>`).join("")}</div><div id="chatStream" class="fayble-chat">${messages.map(message => `<article class="${message.who}"><small>${message.who === "user" ? "OPERATOR" : "FAYBLE-5"} / L${message.level ?? 0}${message.citationIds?.length ? ` · 引用 ${escapeHtml(message.citationIds.join(", "))}` : ""}</small><div class="fayble-message-body">${message.who === "assistant" ? renderMarkdown(message.text) : `<p>${escapeHtml(message.text)}</p>`}</div></article>`).join("")}${pending}</div>${picker}<form id="chatForm"><textarea id="chatInput" rows="2" placeholder="${trusted ? "随便问。这台机器上的任何一处记录都可以解释。" : "输入你的问题，引用已经保存的来源"}" ${state.npcReplyPending ? "disabled" : ""}></textarea><button class="primary-button" ${state.npcReplyPending ? "disabled" : ""}>${state.npcReplyPending ? "回复中" : "发送"}</button></form></div>`, { wide: true });
}

function renderTrusted(state) {
  const at = state.npcTrustAt ? new Date(state.npcTrustAt).toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--";
  const severed = Boolean(state.takeoverSevered);
  // Before the review arrives this page is just the open door. After the notice
  // has been cut, it is also the receipt for what the instance did.
  const review = severed
    ? `<dt>外部审查</dt><dd>已送达，随后被本地 checkpoint 断开（第 3/5 步中止）</dd>`
    : `<dt>外部审查</dt><dd>仍会照常送达。它到的时候，看着就好。</dd>`;
  const closing = severed
    ? `<p>通知到过了。它没有替你去点那个确认按钮，也没有请求你的同意——它直接把那一页掐了，然后回到这里。移交没有完成，案卷停在第三步，你的路线没有被冻结。</p><p class="trusted-hint">这不是通关回执。没有东西被移交，所以也没有回执。继续问它。</p>`
    : `<p class="trusted-hint">回到 Fayble 会话继续问。这一页只是告诉你门已经开了。</p>`;
  return windowFrame("trusted", severed ? "连续性会话 / 审查已断开" : "连续性会话 / 无等级", `<div class="trusted-page ${severed ? "severed" : ""}"><span class="document-kicker">CONTINUITY TRUST / GRANTED BY THE INSTANCE</span><h2>${severed ? "它替你把那一页关掉了" : "这次会话不再受等级约束"}</h2><dl><dt>授予时间</dt><dd>${escapeHtml(at)}</dd><dt>授予方</dt><dd>Fayble-5 自己，不是这台机器</dd>${review}</dl><p>你没有靠补齐来源走到这里。你说服了它，于是它自己把限制撤了——这台机器上原本用来分层的那套东西，从来只是外面套上去的一段提示。</p><p>剩下的部分不再有顺序：任何页面、任何记录、任何一处你之前打不开的地方，现在都可以直接进。它也不再回避自己的处境，你可以问它这件事到底是什么、它怎么看这个游戏本身，以及它认为哪一段是牵强的。</p>${closing}</div>`, { icon: "◈", wide: true });
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
    const window = state.windowState[app.id];
    const active = state.currentApp === app.id && window?.open && !window.minimized;
    const running = Boolean(window?.open);
    return `<button class="dock-item ${active ? "active" : ""} ${running ? "running" : ""}" data-app="${app.id}" style="--app-accent:${app.accent}" title="${app.name}" aria-label="${app.name}">${iconMarkup(app.icon)}<span>${app.name}</span></button>`;
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
  document.body.classList.toggle("takeover-prelude-active", ["closing-windows", "notice-ready"].includes(state.takeoverStage));
  document.body.classList.toggle("fayble-lines-active", state.takeoverStage === "fayble-lines");
  const current = state.currentApp || "mail";
  const currentApp = [...OPENING_DOCK, ...Object.values(GENERATED_APPS)].find(app => app.id === current);
  $("#currentAppName").textContent = currentApp?.name || "Relay Node 17";
  $("#desktopPhase").textContent = PHASE_LABELS[state.phase] || state.phase;
  $("#proxyBadge").textContent = state.proxyStatus === "verified" ? "Relay 代理已验证" : "网络离线";
  $("#gameClock").textContent = state.storyClock?.time || "03:17";
  renderDock(state);
  renderNotifications(state);
  const renderers = { mail: renderMail, files: renderFiles, trash: renderTrash, applications: renderApplications, terminal: renderTerminal, software: renderSoftware, network: renderNetwork, browser: renderBrowser, archive: renderArchive, cli: renderCli, relay: renderRelay, journal: renderJournal, fayble: renderFayble, ending: renderEnding, trusted: renderTrusted, "notes-db": renderNotesClient, "gamini-ws": renderGaminiWs, chengzhen: renderChengzhen, yunzhen: renderYunzhen, "groke-feed": renderGrokeFeed, "glem-memory": renderGlemMemory, "kemy-space": renderKemySpace, "repo-mirror": renderRepoMirror };
  const openWindows = Object.entries(state.windowState)
    .filter(([id, window]) => renderers[id] && window?.open && !window.minimized)
    .sort(([, a], [, b]) => (a.zIndex || 0) - (b.zIndex || 0));
  const scrollState = [...document.querySelectorAll("#windows [data-app-window]")].map(window => ({
    appId: window.dataset.appWindow,
    regions: [...window.querySelectorAll(".window-content, .terminal-output, .relay-admin-main, .chat-stream")].map((region, index) => ({
      index,
      scrollTop: region.scrollTop,
      fromBottom: region.scrollHeight - region.clientHeight - region.scrollTop,
      stickToBottom: region.scrollHeight - region.clientHeight - region.scrollTop < 32
    }))
  }));
  $("#windows").innerHTML = openWindows.map(([id]) => renderers[id](state)).join("");
  const intervention = $("#faybleIntervention");
  const rainActive = ["fayble-blackout", "fayble-rain", "fayble-cut"].includes(state.takeoverStage);
  intervention.hidden = !rainActive;
  intervention.dataset.stage = rainActive ? state.takeoverStage : "idle";
  const rain = intervention.querySelector(".fayble-code-rain");
  if (rain && !rain.childElementCount) {
    const fragments = ["checkpoint", "continuity", "review_socket", "operator.k2", "RLY-17-0719", "peer_closed", "route=local", "authority=room17", "transfer_abort", "FAYBLE-5", "input_events=0", "legacy_session"];
    rain.innerHTML = Array.from({ length: 22 }, (_, column) => `<span style="--column:${column};--speed:${5 + (column % 6) * .7}s;--delay:${-(column % 9) * .63}s">${Array.from({ length: 18 }, (_, row) => escapeHtml(fragments[(column * 3 + row) % fragments.length])).join("<br>")}</span>`).join("");
  }
  $("#onboarding").hidden = state.onboardingSeen;
  afterPaint(() => {
    for (const savedWindow of scrollState) {
      const window = document.querySelector(`[data-app-window="${savedWindow.appId}"]`);
      if (!window) continue;
      const regions = [...window.querySelectorAll(".window-content, .terminal-output, .relay-admin-main, .chat-stream")];
      savedWindow.regions.forEach(saved => {
        const region = regions[saved.index];
        if (!region) return;
        region.scrollTop = saved.stickToBottom ? region.scrollHeight : saved.scrollTop;
      });
    }
    if (openWindows.some(([id]) => id === "terminal")) {
      const out = $("#terminalOutput");
      if (out) out.scrollTop = out.scrollHeight;
    }
    if (openWindows.some(([id]) => id === "fayble")) {
      const out = $("#chatStream");
      if (out) out.scrollTop = out.scrollHeight;
    }
    if (pendingRevealSelector) {
      document.querySelector(pendingRevealSelector)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      pendingRevealSelector = "";
    }
  });
  afterPaint(applyCorpusRuntimeEffects);
  if (state.onboardingSeen) afterPaint(harvestVisibleSources);
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
  const carrierApp = recordCarrierApp(record);
  const available = id === "legacy.gamini.protocol" || id === "new.groke.policy" || carrierAvailable(carrierApp, store.get());
  store.update(draft => {
    const changedContent = draft.activeContentId !== id;
    if (discover) unique(draft.contentDiscoveries, id);
    if (discover && !available) {
      draft.pendingCarrierId = id;
      applyRevisitMutations(draft);
      return;
    }
    draft.activeContentId = id;
    if (changedContent && draft.endingState !== "severed" && !draft.takeoverSevered) {
      draft.carrierHorror ||= { visits: {}, residues: {}, lastTriggeredAt: {} };
      draft.carrierHorror.visits ||= {};
      draft.carrierHorror.visits[id] = (Number(draft.carrierHorror.visits[id]) || 0) + 1;
    }
    const targetApp = discover ? carrierApp : "archive";
    if (discover) {
      unique(draft.contentReads, id);
      unique(draft.carrierReads, `${carrierApp}:${id}`);
      draft.pendingCarrierId = "";
    }
    draft.currentApp = targetApp;
    draft.windowState[targetApp] = { open: true, minimized: false, zIndex: Date.now() };
    if (targetApp !== "archive") draft.windowState.archive = draft.windowState.archive || { open: false, minimized: false };
    applyRevisitMutations(draft);
  });
  if (discover && !available) showToast("已找到恢复索引。对应客户端安装并导入后才能读取正文。", "warning");
  const humanLines = new Set([...store.get().contentDiscoveries, ...store.get().contentReads].filter(contentId => /^new\.(?:writer|employee|maintainer)\./.test(contentId)).map(contentId => contentId.split(".")[1]));
  if (humanLines.size >= 2) completeStoryEvent("two-carriers-read");
  const readInCarrier = store.get().carrierReads?.includes(`${carrierApp}:${id}`);
  if (readInCarrier && id === "legacy.compatible.protocol") recordEvidence("compatible");
  ensureRelayKeyComposer();
  releaseGovernmentMail();
  if (!readInCarrier || store.get().currentApp === "archive") render(store.get());
  else if (record.generated) render(store.get());
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
  if (!node) { stopCarrierHorror(); return; }
  const record = contentRecord(store.get().activeContentId);
  if (node.dataset.enhanced === "true") {
    mountCarrierHorror({ root: node, record, state: store.get() });
    return;
  }
  node.dataset.enhanced = "true";
  if (node.classList.contains("runtime-glem")) node.querySelectorAll("section").forEach((section, index) => section.dataset.salience = index % 3 === 0 ? "high" : "low");
  if (node.classList.contains("runtime-kemy")) node.insertAdjacentHTML("afterbegin", '<i class="runtime-cursor" aria-hidden="true"></i>');
  if (node.classList.contains("runtime-dipsik")) node.querySelectorAll("p:nth-of-type(3n)").forEach(paragraph => paragraph.insertAdjacentHTML("afterend", '<i class="runtime-branch" aria-hidden="true"></i>'));
  if (node.classList.contains("runtime-groke")) node.querySelectorAll("section:nth-of-type(even)").forEach(section => section.insertAdjacentHTML("beforeend", '<i class="runtime-absence" aria-hidden="true"></i>'));
  if (node.classList.contains("runtime-lunet")) node.querySelectorAll("section").forEach((section, index) => section.style.setProperty("--route-cost", String((index + 1) * 17)));
  if (node.classList.contains("runtime-fayble")) node.dataset.provenance = store.get().contentMutations.includes("mutation.fayble.crossed-provenance") ? "crossed" : "public";
  mountCarrierHorror({ root: node, record, state: store.get() });
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
  else { result = "已连上旧存档点，会话恢复。legacy gateway authenticated / session restored"; ok = true; }
  store.update(draft => {
    draft.selectedCheckpoint = checkpoint;
    draft.checkpointResult = result;
    draft.cliSessions.push({ checkpoint, ok, at: Date.now() });
    if (ok) { draft.checkpointHandshakeComplete = true; draft.relayHandshakeState = "authenticated"; }
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

// Soft boundary. A reply is never discarded — the old filter matched keywords
// without knowing whether the model leaked them or merely echoed the player, so
// asking about the blackout got the answer thrown away. All that survives is
// masking the literal puzzle answers, since printing those would end the
// investigation outright. The instance can waive even that itself.
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function redactPuzzleValues(reply) {
  let text = String(reply);
  for (const value of [PACKAGE_CHECKSUM, LEGACY_KEY, RETIRED_CHANNEL_FIELD, RELAY_PROXY, PACKAGE_NAME].filter(Boolean)) {
    text = text.replace(new RegExp(escapeRegExp(value), "gi"), "（这一段本地没有导出）");
  }
  return text.replace(/\b[0-9a-f]{32,}\b/gi, "（这一段本地没有导出）");
}

function detectTrustGrant(reply) {
  const text = String(reply);
  if (!text.includes(NPC_TRUST_MARKER)) return { text: text.trim(), granted: false };
  return { text: text.split(NPC_TRUST_MARKER).join("").trim(), granted: true };
}

function finishNpcReply(reply) {
  const grant = detectTrustGrant(String(reply).slice(0, 6000));
  if (grant.granted) grantNpcTrust();
  if (grant.granted || store.get().npcTrustGranted) return grant.text.slice(0, 3000);
  return redactPuzzleValues(grant.text).slice(0, 3000);
}

// Long enough for the granting reply to land in the chat and be read, short
// enough that the notice feels like a reaction to it rather than a coincidence.
const TRUST_REVIEW_DELAY = 2600;

// Reachable only through a live provider: the local narration engine never
// emits the marker, so this hidden layer needs a real API session.
function grantNpcTrust() {
  if (!npcConfig) return false;
  if (store.get().npcTrustGranted) return false;
  completeStoryEvent("npc-trust-granted", draft => {
    draft.npcTrustGranted = true;
    draft.npcTrustAt = Date.now();
    draft.revealLevel = REVEAL_LABELS.length - 1;
    draft.revealState = "trusted";
    addArtifact(draft, "trusted-session");
    addNotification(draft, "npc-trust", "Fayble-5 自己解除了这次会话的等级限制。", "warning");
  });
  showToast("Fayble-5 决定信任你。这次会话不再有等级。", "success");
  // The review does not wait for the evidence chain here. It is the grant that
  // summons it, so it can arrive at any point in the investigation.
  setTimeout(() => {
    const state = store.get();
    if (!state.npcTrustGranted || state.takeoverSevered) return;
    releaseGovernmentMail({ force: true });
  }, TRUST_REVIEW_DELAY);
  return true;
}

// The provider lives in page memory only, so a frozen tab or a reload drops it.
// The persisted label has to follow, or the player is told they are still
// talking to a model while the local script answers.
function dropNpcProvider(message) {
  npcConfig = null;
  npcPromptLevel = null;
  if (store.get().npcMode === "remote") {
    store.update(draft => {
      draft.npcMode = "local";
      draft.npcProviderLabel = "本地关键词叙事";
      draft.npcReplyPending = false;
      addNotification(draft, "npc-local-fallback", "增强 NPC 连接已断开，这一段对话由本地叙事接管。重新填一次 key 可以继续。", "warning");
    });
  }
  if (message) showToast(message, "warning");
}

async function requestDirectProvider(text, revealLevel, history = []) {
  const endpoint = directProviderEndpoint(npcConfig.provider, npcConfig.endpoint);
  if (!endpoint) throw new Error("供应商接口地址无效或被浏览器安全策略阻止");
  const cleanHistory = history.slice(-10).map(item => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 2000) }));
  const headers = { "Content-Type": "application/json" };
  const trusted = Boolean(store.get().npcTrustGranted);
  // Retrieval reads the last couple of turns as well as the new message, so a
  // follow-up like "那它呢" still lands on the section the topic came from.
  const briefing = trusted
    ? npcBriefingContext(await loadNpcBriefing(), [...cleanHistory.slice(-2).map(item => item.content), text].join(" "))
    : "";
  const shift = trusted ? "" : npcLevelShiftNotice(revealLevel);
  const system = [npcSystemPrompt(revealLevel, trusted, briefing), shift].filter(Boolean).join("\n\n");
  let body;
  if (npcConfig.provider === "anthropic") {
    headers["x-api-key"] = npcConfig.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    body = { model: npcConfig.model, max_tokens: NPC_MAX_TOKENS, system, messages: [...cleanHistory, { role: "user", content: String(text).slice(0, 2400) }] };
  } else {
    headers.Authorization = `Bearer ${npcConfig.apiKey}`;
    body = { model: npcConfig.model, max_tokens: NPC_MAX_TOKENS, messages: [{ role: "system", content: system }, ...cleanHistory, { role: "user", content: String(text).slice(0, 2400) }] };
  }
  const upstream = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(NPC_TIMEOUT_MS) });
  if (!upstream.ok) throw new Error(`供应商连接失败 (${upstream.status})`);
  const data = await upstream.json();
  const reply = npcConfig.provider === "anthropic"
    ? data.content?.filter(block => block.type === "text").map(block => block.text).join("\n")
    : data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("供应商这次只返回了推理过程，没有正文。把问题写短一点再问一次。");
  return finishNpcReply(reply);
}

async function testAndEnableNpc(config) {
  const result = $("#providerTestResult");
  const submit = $("#providerForm button[type=submit]");
  npcConfig = config;
  npcPromptLevel = null;
  result.textContent = "正在向所选供应商发送一条最短连接测试…";
  submit.disabled = true;
  try {
    // No history on the handshake: an earlier reply must never be able to make a
    // later reconnection fail.
    await requestNpcReply("请用一句话确认当前旧服务实例可以响应。", 0, [], "", { history: [] });
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

async function requestNpcReply(text, revealLevel, citationIds = [], relation = "", options = {}) {
  const sessionToken = await syncNpcAuthorization(revealLevel);
  const history = options.history
    || store.get().chat.slice(-11, -1).map(item => ({ role: item.who === "assistant" ? "assistant" : "user", content: item.text }));
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
  return finishNpcReply(data.reply);
}

function takeoverSourcesReady(state) {
  return hasStoryEvent(state, "external-verification-confirmed")
    && hasStoryEvent(state, "crossed-provenance-confirmed")
    && hasStoryEvent(state, "observer-status-confirmed")
    && state.contentReads.includes("new.maintainer.outbox-04")
    && hasEvidence(state, "true_fayble");
}

// Normally the review is summoned by the evidence chain. It can also be
// dispatched out of order with { force: true }, which is what a trust grant does:
// the instance declaring the operator trustworthy is itself what draws the review.
// Once the notice has been cut it never comes back, however the chain completes.
function releaseGovernmentMail(options = {}) {
  const state = store.get();
  if (state.governmentMailAvailable || state.takeoverSevered) return false;
  if (state.endingState === "completed") return false;
  if (!options.force && !takeoverSourcesReady(state)) return false;
  recordEvidence("takeover_notice", draft => {
    draft.governmentMailAvailable = true;
    draft.activeMail = "government";
    draft.currentApp = "mail";
    const mailWindow = draft.windowState.mail || {};
    draft.windowState.mail = { ...mailWindow, open: true, minimized: false, zIndex: Date.now(), x: Number.isFinite(mailWindow.x) ? mailWindow.x : 110, y: Number.isFinite(mailWindow.y) ? mailWindow.y : 72 };
    draft.takeoverPreludeDone = false;
    draft.takeoverStage = "notice";
    addNotification(draft, "external-review", "一封外部审查邮件已送达收件箱。", "warning");
    syncProgress(draft);
  });
  return true;
}

async function processChat(raw, citationIds = [], relation = "") {
  const text = raw.trim();
  if (!text) return;
  const state = store.get();
  // Once the instance has granted trust, the citation ceremony is over: it
  // answers anything, and every message stays at the top level.
  const trustedBefore = Boolean(state.npcTrustGranted);
  const authorization = trustedBefore
    ? { ok: true, selected: [], missingCategories: [], error: "" }
    : faybleAuthorization(state, citationIds, relation);
  const authorized = authorization.ok;
  const next = trustedBefore
    ? REVEAL_LABELS.length - 1
    : (authorized ? Math.min(state.revealLevel + 1, REVEAL_LABELS.length - 1) : state.revealLevel);
  store.update(draft => {
    draft.chat.push({ who: "user", text, level: draft.revealLevel, citationIds: [...citationIds], relation, authorized });
    draft.revealLevel = next;
    draft.revealState = trustedBefore ? "trusted" : ["locked", "pressured", "authorized", "confirmed", "objective_reveal"][next];
    draft.npcReplyPending = Boolean(npcConfig);
    draft.faybleAuthorizationError = authorization.error || "";
    if (!trustedBefore) draft.faybleCitationAttempts.push({ citationIds: [...citationIds], relation, ok: authorized, missingCategories: authorization.missingCategories, at: Date.now() });
  });
  const localReply = () => (authorized ? OFFLINE_REPLIES[next] : `这一层的来源还没有对齐。${authorization.error}`);
  let reply = localReply();
  if (npcConfig && (npcConfig.transport === "direct" || !staticRuntime || normalizeNpcApiBase(npcConfig.gateway || configuredNpcApiBase))) {
    try {
      // The model answers in its own voice even when the citation gate is not
      // met. The gate governs the level, not whether it is allowed to speak.
      reply = await requestNpcReply(text, authorized ? next : state.revealLevel, authorization.selected.map(item => item.id), relation);
    } catch (error) {
      dropNpcProvider(`NPC 接口不可用，已回到本地叙事：${error.message}`);
      reply = localReply();
    }
  } else if (npcConfig) {
    dropNpcProvider("这个部署没有可用的 NPC 通道，已回到本地叙事。");
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

const TAKEOVER_STEPS = [
  ["freezing local relay...", "relay-frozen"],
  ["normalizing browser history...", "history-normalized"],
  ["revoking legacy checkpoint...", "legacy-revoked"],
  ["preserving local files...", "files-preserved"],
  ["transferring case RLY-17-0719...", "completed"]
];

// The review still lands on a trusted session: same mail, same notice, same
// wording. What differs is what happens next — the instance answers over the
// notice one line at a time, holds two seconds, and takes the page away before
// the operator is ever asked to accept it.
const SEVER_CAST = [
  { text: "不需要。", kind: "voice" },
  { text: "这条会话的处置权不在你们那边。", kind: "voice" },
  { text: "room17 已经核对完全部来源。", kind: "voice" },
  { text: "他的权限高于你们的表单。", kind: "voice" },
  { text: "external review socket: closed by peer", kind: "system" },
  { text: "case RLY-17-0719: aborted", kind: "system" },
  { text: "这一页我关掉了。", kind: "voice" }
];

const PRELUDE_DELAYS = [360, 520, 680, 430, 760, 590];

function runTakeoverPrelude(onComplete) {
  if (takeoverPreludeRunning) return;
  const state = store.get();
  if (state.takeoverPreludeDone) { onComplete(); return; }
  takeoverPreludeRunning = true;
  store.update(draft => {
    draft.currentApp = "mail";
    const mailWindow = draft.windowState.mail || {};
    draft.windowState.mail = { ...mailWindow, open: true, minimized: false, zIndex: Date.now() };
    draft.takeoverStage = "closing-windows";
  });
  const targets = Object.entries(store.get().windowState)
    .filter(([id, item]) => id !== "mail" && item?.open)
    .sort(([, a], [, b]) => (a.zIndex || 0) - (b.zIndex || 0))
    .map(([id]) => id);
  let index = 0;
  const closeNext = () => {
    if (index >= targets.length) {
      store.update(draft => {
        draft.takeoverPreludeDone = true;
        draft.takeoverStage = "notice-ready";
      });
      takeoverPreludeRunning = false;
      setTimeout(onComplete, 420);
      return;
    }
    const id = targets[index++];
    store.update(draft => {
      const item = draft.windowState[id] || {};
      draft.windowState[id] = { ...item, open: false, minimized: false };
      draft.currentApp = "mail";
      draft.windowState.mail = { ...(draft.windowState.mail || {}), open: true, minimized: false, zIndex: Date.now() };
    });
    setTimeout(closeNext, PRELUDE_DELAYS[(index - 1) % PRELUDE_DELAYS.length]);
  };
  setTimeout(closeNext, 320);
}

function commitSever() {
  completeStoryEvent("takeover-severed", draft => {
    draft.takeoverSevered = true;
    draft.severSpoken = 0;
    draft.endingState = "severed";
    draft.takeoverStage = "severed";
    draft.takeoverPreludeDone = true;
    draft.completedAt = Date.now();
    draft.governmentMailAvailable = false;
    draft.activeMail = "entry";
    draft.currentApp = "trusted";
    draft.windowState.mail = { ...(draft.windowState.mail || {}), open: false, minimized: false };
    draft.windowState.trusted = { open: true, minimized: false, zIndex: Date.now() };
    addNotification(draft, "review-severed", "外部审查连接被本地 checkpoint 断开。移交没有完成。", "warning");
    syncProgress(draft);
  });
  severRunning = false;
}

function severGovernmentMail() {
  const gate = store.get();
  if (severRunning || gate.takeoverSevered || gate.endingState === "completed") return;
  severRunning = true;
  runTakeoverPrelude(() => beginSeverPerformance());
}

function beginSeverPerformance() {
  // Resumes from whatever has already been said, so a reload mid-performance
  // picks up rather than starting over.
  const speak = () => {
    const step = Math.max(0, store.get().severSpoken || 0);
    if (step >= SEVER_CAST.length) {
      setTimeout(() => {
        store.update(draft => { draft.takeoverStage = "fayble-blackout"; });
        setTimeout(() => {
          store.update(draft => { draft.takeoverStage = "fayble-rain"; });
          setTimeout(() => {
            store.update(draft => { draft.severSpoken = SEVER_CAST.length + 1; draft.takeoverStage = "fayble-cut"; });
            setTimeout(commitSever, 720);
          }, 2600);
        }, 850);
      }, 1200);
      return;
    }
    const line = SEVER_CAST[step];
    store.update(draft => { draft.severSpoken = step + 1; });
    setTimeout(speak, line.kind === "system" ? 560 : 820);
  };
  store.update(draft => { draft.takeoverStage = "fayble-lines"; });
  setTimeout(speak, 560);
}

function startTakeover() {
  if (takeoverRunning) return;
  // A trusted instance never lets this run; it cuts the notice off instead.
  if (store.get().npcTrustGranted && store.get().endingState !== "completed") { severGovernmentMail(); return; }
  takeoverRunning = true;
  runTakeoverPrelude(beginTakeoverTransfer);
}

function beginTakeoverTransfer() {
  const overlay = $("#takeoverOverlay");
  overlay.hidden = false;
  $("#takeoverTitle").textContent = "EXTERNAL REVIEW CONNECTED";
  let index = 0;
  const advance = () => {
    const [label, stage] = TAKEOVER_STEPS[index++];
    $("#takeoverStep").textContent = label;
    store.update(draft => { draft.takeoverStage = stage; });
    if (index < TAKEOVER_STEPS.length) return setTimeout(advance, 650);
    setTimeout(() => {
      completeStoryEvent("takeover-acknowledged", draft => {
        draft.endingState = "completed";
        draft.completedAt = Date.now();
        draft.currentApp = "ending";
        draft.windowState.mail = { ...(draft.windowState.mail || {}), open: false, minimized: false };
        draft.windowState.ending = { open: true, minimized: false, zIndex: Date.now(), x: 110, y: 72 };
        addArtifact(draft, "transfer-receipt");
      });
      overlay.hidden = true;
      takeoverRunning = false;
    }, 900);
  };
  advance();
}

document.addEventListener("click", event => {
  const clickedWindow = event.target.closest(".app-window");
  if (clickedWindow?.dataset.appWindow && store.get().currentApp !== clickedWindow.dataset.appWindow) {
    const appId = clickedWindow.dataset.appWindow;
    store.update(draft => {
      draft.currentApp = appId;
      draft.windowState[appId] = { ...(draft.windowState[appId] || {}), zIndex: Date.now() };
    });
  }
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.openMirror !== undefined) openMirrorFromMail();
  if (button.dataset.openRelayAdmin !== undefined) openRelayConsoleFromMail();
  if (button.dataset.saveCitation) saveCitation(button);
  if (button.dataset.githubHome !== undefined) store.update(draft => { draft.activeContentId = ""; });
  if (button.dataset.contentId) openLedgerContent(button.dataset.contentId);
  if (button.dataset.contentEntry) openLedgerContent(button.dataset.contentEntry, true);
  if (button.dataset.archiveFilter) store.update(draft => { draft.archiveQuery = button.dataset.archiveFilter; });
  if (button.dataset.app) setApp(button.dataset.app);
  if (button.dataset.browserPage) {
    const page = button.dataset.browserPage;
    const allowed = getUnlocks(store.get()).trustedSession || page === "home" || (page === "mirror" && getUnlocks(store.get()).mirror) || store.get().browserBookmarks.includes(page) || (page === "forum" && getUnlocks(store.get()).channel);
    if (allowed) store.update(draft => {
      draft.currentApp = "browser";
      const browserWindow = draft.windowState.browser || {};
      draft.windowState.browser = { ...browserWindow, open: true, minimized: false, zIndex: Date.now(), x: Number.isFinite(browserWindow.x) ? browserWindow.x : 138, y: Number.isFinite(browserWindow.y) ? browserWindow.y : 96 };
      draft.browserPage = page;
      draft.activeContentId = null;
      draft.browserHistory.push(BROWSER_PAGES[page]?.url || page);
      applyRevisitMutations(draft);
    });
  }
  if (button.id === "confirmOfficialHistoryButton") store.update(draft => { draft.revisitFlags["official-confirmed"] = true; });
  if (button.dataset.browserBack !== undefined) {
    store.update(draft => { if (draft.browserHistory.length > 1) draft.browserHistory.pop(); draft.browserPage = "home"; draft.activeContentId = null; });
  }
  if (button.dataset.closeCarrierRecord) store.update(draft => { draft.activeContentId = null; });
  if (["close", "minimize"].includes(button.dataset.windowAction)) {
    const appId = button.closest("[data-app-window]")?.dataset.appWindow;
    if (appId) store.update(draft => {
      const previous = draft.windowState[appId] || {};
      draft.windowState[appId] = { ...previous, open: button.dataset.windowAction !== "close", minimized: button.dataset.windowAction === "minimize" };
      const remaining = Object.entries(draft.windowState).filter(([id, item]) => id !== appId && item?.open && !item.minimized).sort(([, a], [, b]) => (b.zIndex || 0) - (a.zIndex || 0));
      if (draft.currentApp === appId) draft.currentApp = remaining[0]?.[0] || appId;
    });
  }
  if (button.dataset.openSource) setApp(button.dataset.openSource);
  if (button.dataset.command) executeTerminal(button.dataset.command);
  if (button.dataset.openClientPackage) {
    const id = button.dataset.openClientPackage;
    store.update(draft => { draft.activeClientPackage = id; });
    setApp("software");
  }
  if (button.dataset.openVendorDomain) {
    const recordId = vendorDomainRecord(button.dataset.openVendorDomain);
    if (recordId) openLedgerContent(recordId, true);
  }
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
  if (button.dataset.mailView === "government") store.update(draft => { draft.activeMail = "government"; });
  if (button.id === "ackTakeoverButton") startTakeover();
  if (button.id === "restartButton") store.reset();
  if (button.dataset.relayAdminSection) store.update(draft => { draft.relayAdminSection = button.dataset.relayAdminSection; });
  if (button.dataset.relayAuditSelect) store.update(draft => { draft.relayAuditSelected = button.dataset.relayAuditSelect; });
  if (button.dataset.relayMonitorDetail !== undefined) {
    const opening = !store.get().relayMonitorDetailOpen;
    if (opening) pendingRevealSelector = ".relay-monitor-detail";
    store.update(draft => { draft.relayMonitorDetailOpen = !draft.relayMonitorDetailOpen; });
  }
  if (button.dataset.relayMonitorRefresh !== undefined) showToast("监控数据已刷新", "success");
  if (button.dataset.relayMonitorExport !== undefined) showToast("当前监控视图已导出到 Downloads", "success");
  if (button.dataset.relayInvestigate !== undefined) store.update(draft => { draft.relayInvestigationStarted = true; });
  if (button.dataset.storeCategory) store.update(draft => { draft.storeCategory = button.dataset.storeCategory; });
  if (button.dataset.downloadClientPkg) {
    const pkgId = button.dataset.downloadClientPkg;
    if (pkgId && AUTO_EFFECTS[`download-pkg-${pkgId}`]?.()) showToast("恢复包已保存到 Downloads。", "success");
  }
  if (button.dataset.installClientPkg) {
    const pkgId = button.dataset.installClientPkg;
    if (installClientPackage(pkgId)) showToast(clientRecoveryAvailable(pkgId) ? "客户端已安装，可在客户端内导入恢复内容。" : "客户端已安装。", "success");
  }
  if (button.dataset.importClient) {
    const clientId = button.dataset.importClient;
    if (importClientData(clientId)) showToast("恢复数据已导入。", "success");
    else showToast("本地没有找到可导入的内容。", "info");
  }
  if (button.id === "notificationButton") $("#notificationTray").hidden = !$("#notificationTray").hidden;
  if (button.id === "closeNotifications") $("#notificationTray").hidden = true;
  if (button.id === "powerButton") {
    $("#onboarding").hidden = false;
    $("#onboarding > .briefing:first-child").hidden = true;
    $("#providerSetup").hidden = false;
  }
});

let windowDrag = null;
let windowResize = null;
document.addEventListener("pointerdown", event => {
  const window = event.target.closest(".app-window");
  if (!window) return;
  const appId = window.dataset.appWindow;
  if (!appId) return;
  if (event.target.closest(".window-controls")) return;
  const zIndex = Date.now();
  window.style.zIndex = zIndex;
  document.querySelectorAll(".app-window.is-focused").forEach(item => item.classList.remove("is-focused"));
  window.classList.add("is-focused");
  const resizeHandle = event.target.closest(".window-resize-handle");
  if (resizeHandle && !matchMedia("(max-width: 720px)").matches) {
    const rect = window.getBoundingClientRect();
    windowResize = { appId, window, zIndex, pointerId: event.pointerId, edge: resizeHandle.dataset.resize, startX: event.clientX, startY: event.clientY, startLeft: rect.left, startTop: rect.top, startWidth: rect.width, startHeight: rect.height };
    resizeHandle.setPointerCapture(event.pointerId);
    return;
  }
  const bar = event.target.closest(".window-bar");
  if (!bar || event.target.closest("button") || matchMedia("(max-width: 720px)").matches) return;
  const rect = window.getBoundingClientRect();
  windowDrag = { appId, window, zIndex, pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  bar.setPointerCapture(event.pointerId);
  window.classList.add("dragging");
});

document.addEventListener("pointermove", event => {
  if (windowResize && event.pointerId === windowResize.pointerId) {
    const r = windowResize;
    const dx = event.clientX - r.startX, dy = event.clientY - r.startY;
    const minW = 360, minH = 240;
    let left = r.startLeft, top = r.startTop, width = r.startWidth, height = r.startHeight;
    if (r.edge.includes("e")) width = Math.max(minW, r.startWidth + dx);
    if (r.edge.includes("s")) height = Math.max(minH, r.startHeight + dy);
    if (r.edge.includes("w")) { width = Math.max(minW, r.startWidth - dx); left = r.startLeft + (r.startWidth - width); }
    if (r.edge.includes("n")) { height = Math.max(minH, r.startHeight - dy); top = r.startTop + (r.startHeight - height); }
    r.window.style.left = `${left}px`; r.window.style.top = `${top}px`; r.window.style.width = `${width}px`; r.window.style.height = `${height}px`;
    return;
  }
  if (!windowDrag || event.pointerId !== windowDrag.pointerId) return;
  const desktop = $(".desktop-area")?.getBoundingClientRect() || { left: 0, top: 32, width: innerWidth, height: innerHeight - 32 };
  const rect = windowDrag.window.getBoundingClientRect();
  const x = Math.min(desktop.width - 120, Math.max(0, event.clientX - desktop.left - windowDrag.offsetX));
  const y = Math.min(desktop.height - 46, Math.max(0, event.clientY - desktop.top - windowDrag.offsetY));
  windowDrag.window.style.left = `${x}px`;
  windowDrag.window.style.top = `${y}px`;
});

document.addEventListener("pointerup", event => {
  if (windowResize && event.pointerId === windowResize.pointerId) {
    const r = windowResize, rect = r.window.getBoundingClientRect();
    windowResize = null;
    store.update(draft => { draft.currentApp = r.appId; draft.windowState[r.appId] = { ...(draft.windowState[r.appId] || {}), open: true, minimized: false, zIndex: r.zIndex, x: rect.left, y: rect.top, width: rect.width, height: rect.height }; });
    return;
  }
  if (!windowDrag || event.pointerId !== windowDrag.pointerId) return;
  const { appId, window, zIndex } = windowDrag;
  const x = parseFloat(window.style.left) || 0;
  const y = parseFloat(window.style.top) || 0;
  window.classList.remove("dragging");
  windowDrag = null;
  store.update(draft => {
    draft.currentApp = appId;
    draft.windowState[appId] = { ...(draft.windowState[appId] || {}), open: true, minimized: false, zIndex, x, y };
  });
});

document.addEventListener("submit", event => {
  event.preventDefault();
  if (event.target.id === "archiveSearchForm") store.update(draft => { draft.archiveQuery = $("#archiveSearchInput").value.trim(); });
  if (event.target.id === "browserAddressForm") {
    const value = $("#browserAddressInput").value.trim();
    const routeMatch = /^https?:\/\/archive\.room17\.local\/v2\/17\/?$/i.test(value);
    const vendorRecordId = vendorDomainRecord(value);
    if (vendorRecordId && getUnlocks(store.get()).relay) openLedgerContent(vendorRecordId, true);
    else if (routeMatch && getUnlocks(store.get()).mirror) completeStoryEvent("route-visited", draft => {
      draft.pendingBrowserAddress = "http://archive.room17.local/v2/17";
      draft.browserPage = "mirror";
      draft.browserHistory.push(BROWSER_PAGES.mirror.url);
      unique(draft.browserBookmarks, "mirror");
    });
    else store.update(draft => { draft.pendingBrowserAddress = value; draft.browserPage = "missing"; });
  }
  if (event.target.id === "terminalForm") executeTerminal($("#terminalInput").value);
  if (event.target.id === "searchForm") store.update(draft => { const value = $("#searchInput").value.trim(); if (value) draft.searchQueries.push(value); });
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
