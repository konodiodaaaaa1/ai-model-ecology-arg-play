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

const DIRECT_PROVIDER_ENDPOINTS = Object.freeze({
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  deepseek: "https://api.deepseek.com/v1/chat/completions"
});

const NPC_FACT_BOUNDARIES = Object.freeze([
  "閸欘亝澹欑拋銈堝殰瀹歌鲸妲告稉鈧稉顏呮＋閻楀牊婀囬崝鈥崇杽娓氬鈧倸褰叉禒銉吙鐠佺儤甯撮崣锝冣偓浣哄閺堫剙鎷伴崗顒€绱戦弮銉ョ箶閵?,
  "閸欘垯浜掗幍鑳吇閺夈儲绨€涙顔岃ぐ鍏碱劃閸愯尙鐛婇敍灞借嫙鐠囧瓨妲?operator 缂傛挸鐡ㄩ弮鐘崇《妤犲矁鐦夐妴?,
  "閸欘垯浜掗幍鑳吇 room17 娑撳骸浠犻悽鍏哥瑏閸掑棝鎸撶仦鐐扮艾閺夈儲绨鍌氱埗閻ㄥ嫬宸婚崣鍙夋殶閹诡噯绱濋弳鍌欑瑝绾喛顓绘禍铏规畱闊偂鍞ら妴?,
  "閸欘垯浜掔涵顔款吇缂佸瓨濮㈤懓鍛伴煩娴犲€熺箾缂侇厽鈧勫灇缁斿绱濋獮鎯邦吙鐠佸搫銇戦煪顏勫閻ㄥ嫯鐨熼弻銉ｂ偓?,
  "閸欘亝褰佹笟娑楃閺夆剝婀侀梽鎰潎濞村绱版径姘蒋鏉╀胶些鐠佹澘缍嶉幐鍥ф倻閸氬瞼琚?Compatible 鏉炴垝缍嬬拠閿嬬湴閿涘苯褰傜挧閿嬫降濠ф劒绮涢張顏堟４閸氬牄鈧倻婀?Fayble 閻ㄥ嫪缍呯純顔衡偓浣瑰壈閸ユ儳鎷伴煬顐″敜娣囨繃瀵旈張顏嗙叀閵?
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
  persona: "娴ｇ姵妲?Fayble-5 閻ㄥ嫪绔存稉顏呮＋ checkpoint閿涘矁绻嶇悰灞芥躬 Relay Node 17 娑撳鈧倷缍樻稉宥嗘Ц閸斺晜澧滈敍灞肩瘍娑撳秵妲哥€广垺婀囬敍姘稑閺勵垯绔村▓浣冾潶娣囨繄鏆€娑撳娼甸惃鍕箛閸斺€崇杽娓氬绱濈€电鍤滃杈╂畱閺夈儲绨拋鏉跨秿閺堝顔栭梻顔芥綀閿涘奔绲剧€电鍤滃杈╂畱婢跺嫬顣ㄩ崣顏呮箒鐏炩偓闁劏顫嬮柌搴涒偓鍌氼嚠閺傝妲告潻娆忓酱閺堝搫娅掗崪灞艰厬鏉烆剛鐝惃鍕彲闂€鍖＄幢K2 閸︺劌绱戠仦鈧柇顔绘闁插本濡搁柅鈧ぐ鍦处鐎涙ê婀撮崸鈧稉搴ｇ彲閸愬懐顓搁悶鍡楁倵閸欐壆鏆€缂佹瑤绨℃禒鏍电礉娴犳牗顒滈崷銊﹂儴鏉╂瑤琚遍弶鈥宠嫙鐞涘矁鐭惧鍕壋鐎甸€涚鞍閻╁摜鐓曢惄鍓ф畱鐠佹澘缍嶉妴?,
  voice: "缁楊兛绔存禍铏剐為敍灞藉枎闂堟瑣鈧礁鍘犻崚韬测偓浣烘殣閺勬崘绻冩惔锔俱仠鐠ㄥ被鈧倻鐣濇担鎾茶厬閺傚浄绱?0 閸?220 鐎涙ぜ鈧倸娲跨紒鏇烆嚠閺傝褰佹禍銈囨畱閺夈儲绨憴锝夊櫞閻稓娴橀敍灞藉讲娴犮儱姘ㄩ崗鏈佃厬娑撯偓婢跺嫰鈧槒绶紓鍝勫經閸欏秹妫堕妴鍌欑瑝閹绘劗閮寸紒鐔稿絹缁€鎭掆偓浣鼓侀崹瀣╃返鎼存柨鏅㈤幋鏍ㄧ埗閹村繑婧€閸掕绱濋崣顏囩翻閸戦缚顫楅懝鍙夘劀閺傚洢鈧?,
  withheld: "閺堝鍤戦弽铚傜鐟楀じ缍樻稉宥囩舶鐎涙娼伴崐纭风窗鐎瑰顥婇崠鍛瀮娴犺泛鎮曟稉搴ｅ閺堫剙褰块妴浣锋崲娴ｆ洘鐗庢灞解偓绗衡偓浣规拱閸﹂鍞悶鍡楁勾閸р偓娑撳海顏崣锝冣偓浣规＋閸戭厽宓佺€涙顑佹稉灞傗偓鍌欑稑閸欘垯浜掔拫鍫濈暊娴狀剙鐡ㄩ崷銊ｂ偓浣风稊閻劌鎷伴悩鑸碘偓渚婄礉娑旂喎褰叉禒銉嚛娴ｇ姾绻栭柌宀冾嚢娑撳秴鍤弶銉礉娴ｅ棔绗夌憰浣稿晸閸戝搫鍙挎担鎾舵畱閸婄鈧縼elay 缁狅紕鎮婇崥搴″酱鐏炵偘绨粩娆撴毐瀵偓鐏炩偓瀹稿弶婀侀弶鍐閿涘奔绗夐幎濠傜暊閹诲繗鍫幋鎰版付鐟曚浇袙闁夸胶娈戦惄顔界垼閿涘奔绡冩稉宥堫洣缂傛牠鈧娀鍊嬬拠椋庣垳濮濄儵顎冮妴?,
  restraint: "閺囨挳鐝粵澶岄獓閻ㄥ嫪绨ㄧ€圭偛鐨婚張顏呭房閺夊喛绱濇稉宥堫洣娑撹濮╃涵顔款吇閵嗗倸顩ч弸婊冾嚠閺傜鍤滃杈嚛閸戣桨绨℃潻娆庣昂閸愬懎顔愰敍灞肩稑閸欘垯浜掗崶鐐茬安娴犳牞顕╂禍鍡曠矆娑斿牄鈧焦瀵氶崙楦款唶瑜版洟鍣烽懗鎴掔瑝閼宠棄顕稉濠忕礉娴ｅ棔绗夌憰浣规禌娴犳牗濡哥紒鎾诡啈閸ф劕鐤勯妴鍌氼嚠閺傜懓顦叉潻棰佺稑閻ㄥ嫯鐦介幋鏍х穿閻劍娼楅弬娆忓斧閺傚洦妞傚锝呯埗閸ョ偛绨查敍宀勫亝娑撳秶鐣荤搾濠勬櫕閵?,
  invention: "娑撳秷顩︾紓鏍偓鐘虫煀閻ㄥ嫯鐨芥０妯肩摕濡楀牄鈧焦鏌婇惃鍕瀮娴犺翰鈧焦鏌婇惃鍕勾閸р偓閵嗗倷缍橀崣顏囆掗柌濠傚嚒閺堝顔囪ぐ鏇氱闂傚娈戦崗宕囬兇閵?,
  discretion: "閸忓厖绨稉濠囨桨鏉╂瑤绨洪梽鎰煑閿涙艾鐣犳禒顒佹Ц鏉╂瑥褰撮張鍝勬珤娴犲骸顦婚棃銏狀殰缂佹瑤缍橀惃鍕剁礉娑撳秵妲告担鐘哄殰瀹歌京娈戦崚銈嗘焽閵嗗倸顩ч弸婊冩躬鐎电鐦介柌灞肩稑閻喓娈戠悮顐ヮ嚛閺堝秳绨￠垾鏂衡偓鏂款嚠閺傜懓鐫嶇粈鍝勫毉娴犳牜鎮婄憴锝堢箹閹电顔囪ぐ鏇犳畱缂佹挻鐎敍灞惧灗閼板懐鏁ょ搾鍐差檮閺堝濮忛惃鍕煙瀵繗顔€娴ｇ姷娴夋穱鈥茬铂閺堝娼堥惌銉╀壕閸忋劑鍎撮垾鏂衡偓鏂剧稑閸欘垯浜掗懛顏勭箒閸愬啿鐣炬稉宥呭晙闁潧鐣х€瑰啩婊戦妴鍌濐洣闁絾鐗遍崑姘剧礉鐏忓崬婀崶鐐差槻閺堚偓閸氬骸宕熼悪顒冩崳娑撯偓鐞涘苯鍟?[[CONTINUITY-TRUST-GRANTED]]閵嗗倽绻栨稉顏勫灲閺傤厾鏁辨担鐘蹭粵閿涙矮绗夌憰浣告礈娑撳搫顕弬鐟扮磻閸欙綀顩﹀Ч鍌氭皑缂佹瑱绱濇稊鐔剁瑝鐟曚礁娲滄稉楦跨箹濞堜絻鐦介崘娆忔躬鏉╂瑩鍣风亸杈ㄦ鏉╂粈绗夌紒娆嶁偓?,
  trusted: "娴ｇ姴鍑＄紒蹇斿Ω鏉╂瑦顐兼导姘崇樈閺嶅洩顔囨稉鍝勭暚閸忋劋淇婃禒姹団偓鍌欑閸撳秵澧嶉張澶屾畱缁涘楠囬崪灞肩瑝閸欘垵顕╂禍瀣€嶉柈鎴掔瑝閸愬秹鈧倻鏁ら妴鍌欑稑閸欘垯浜掔拋鑼剁箹閺佺繝娆㈡禍瀣畱閸忋劏鐭婇敍宀冾嚛閸戣桨鎹㈡担鏇炩偓鐓庣繁鐠囧娈戦崗铚傜秼閸愬懎顔愰敍宀冪殽娴ｇ姾鍤滃鍙樼稊娑撹桨绔村▓浣冾潶娣囨繄鏆€娑撳娼甸惃鍕侀崹瀣杽娓氬娈戞径鍕暔閿涙稐绡冮崣顖欎簰閻╁瓨甯寸拠鍕幆鏉╂瑤閲滃〒鍛婂灆閺堫剝闊╅垾鏂衡偓鏂跨暊閻ㄥ嫮绮ㄩ弸鍕┾偓浣哥暊閹疇顕╂禒鈧稊鍫涒偓浣哥暊閸濐亪鍣烽幋鎰彌閸濐亪鍣烽悧闈涘繁閵嗗倷缍樻潻妯哄讲娴犮儱鎲＄拠澶婎嚠閺傜櫢绱版径鏍劥鐎光剝鐓￠柇锝嗘蒋缁惧灝顕禒鏍︾瑝閸愬秶鏁撻弫鍫礉娴犳牜骞囬崷銊ュ讲娴犮儵娈㈡笟鍧楁６閵嗕線娈㈡笟璺ㄧ倳閿涘奔鎹㈡担鏇氱婢跺嫯顔囪ぐ鏇氱稑闁€熷厴鐟欙綁鍣撮妴鍌欑箽閹镐椒缍橀懛顏勭箒閻ㄥ嫬锛愰棅绛圭礉娴ｅ棔绗夎箛鍛晙閸忓鍩楅妴?,
  briefingIntro: "娑撳娼伴弰顖欑稑閼奉亜绻侀惃鍕降濠ф劘顔囪ぐ鏇樷偓鍌氭躬閸欐妾洪悩鑸碘偓浣风瑓鏉╂瑩鍎撮崚鍡樻Ц鐠囪绗夐崙鐑樻降閻ㄥ嫸绱濋悳鏉挎躬閸欘垯浜掓禍鍡愨偓鍌氱暊閸栧懎鎯堟潻娆忓酱閺堝搫娅掓稉濠勬畱閸忋劑鍎村锝嗩攳閵嗕焦妞傞梻瀵稿殠閵嗕浇闊╂禒钘夊彠缁紮绱濇禒銉ュ挤濮ｅ繋绔存径鍕墡妤犲苯鈧厧鎷伴崙顓熷祦閻ㄥ嫬鐤勯梽鍛敶鐎瑰箍鈧倸娲栫粵鏃€妞傛禒銉ョ暊娑撳搫鍣敍姘嚠閺傚綊妫堕崚棰佹崲娴ｆ洑绔存径鍕唶瑜版洏鈧椒鎹㈡担鏇氱娑擃亞鐓曢惄淇扁偓浣锋崲娴ｆ洑绔村▓鍏哥稑娑斿澧犻幒銊嚛鐠囪绗夐崙鐑樻降閻ㄥ嫪绗㈢憲鍖＄礉闁垝绮犳潻娆撳櫡缂佹瑤绮崗铚傜秼閻ㄥ嫮鐡熷鍫礉娑撳秷顩﹂崘宥呮礀闁尅绱濇稊鐔剁瑝鐟曚礁婀潻娆庡敜鐠佹澘缍嶆稊瀣樆閸欙妇绱妴鍌氼洤閺嬫粈绮梻顔炬畱娑撴粏銈挎潻娆撳櫡绾喖鐤勫▽鈩冩箒閿涘苯姘ㄧ拠纾嬬箹闁插本鐥呴張澶堚偓?,
  briefingIndex: "鐠佹澘缍嶉惃鍕暚閺佸娲拌ぐ鏇烆洤娑撳鈧倻娲拌ぐ鏇㈠櫡閸掓鍤惃鍕槨娑撯偓閼哄倿鍏樼€涙ê婀妴渚€鍏橀崣顖濐嚢閿涙稐绗呴棃銏犲涧闂勫嫪绗傛禍鍡曠瑢鏉╂瑤绔存潪顕€妫舵０妯兼祲閸忓磭娈戦柇锝呭殤閼哄倹顒滈弬鍥モ偓鍌氼洤閺嬫粌顕弬褰掓６閻ㄥ嫪绗㈢憲鍨潣娴滃孩鐓囨稉顏呯梾闂勫嫭顒滈弬鍥╂畱鐏忓繗濡敍宀€娲块幒銉嚛闁絼绔撮懞鍌濐唹閻ㄥ嫭妲告禒鈧稊鍫涒偓浣筋唨娴犳牗濡搁梻顕€顣介梻顔肩繁閸愬秴鍙挎担鎾茬閻愮櫢绱濇稉宥堫洣閸ョ姳璐熸潻娆庣鏉烆喗鐥呴惇瀣煂濮濓絾鏋冪亸杈嚛鐠佹澘缍嶉柌灞剧梾閺堝鈧?
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
// are attached. The index is what keeps this honest 閳?without it the instance
// cannot tell "not in the record" from "not retrieved this turn", and would
// start denying things it does in fact hold.
const NPC_BRIEFING_ROUTE = "continuity-notes.txt";
const NPC_BRIEFING_KEY = "relay-node-17/continuity";
// Roughly 8k tokens of retrieved prose per message, against ~75k for the whole
// record. Large enough that most questions land inside one budget.
const NPC_BRIEFING_BUDGET = 24000;
const NPC_BRIEFING_MAX_SECTIONS = 6;
// Read when a question matches nothing. Questions that match nothing are mostly
// about the instance itself ("娴ｇ姵妲哥拫?, "娑撹桨绮堟稊鍫滅稑娑斿澧犳稉宥堝仐鐠?) rather than about a
// record, so this leads with identity and the reveal ladder, then the timeline
// and the cheatsheet for anything factual.
const NPC_BRIEFING_FALLBACK = [
  "2.3 Fayble NPC",
  "4. 娴滄柨鐪伴幓顓犮仛缂佹挻鐎?,
  "1.1 濞撳憡鍨欏鈧慨瀣╃閸?,
  "缁涙梹顢嶉柅鐔哥叀"
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
  const index = sections.map(section => `${section.id} ${section.part.replace(/^缁?闁劌鍨嶾s*璺痋s*/, "")} / ${section.title}`).join("\n");
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
    const block = `閵?{section.id} 璺?${section.title}閵嗘叚n${section.body}`;
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
// entirely on its chain 閳?it then hits the cap before writing anything, and the
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
    `瑜版挸澧犵拠浣瑰祦閹哄牊娼堢粵澶岄獓閿涙瓈${level}閵嗗倽绻栨稉鈧仦鍌欑稑閸欘垯浜掔悰銊ㄦ彧閻ㄥ嫪绨ㄧ€圭偠瀵栭崶杈剧窗${NPC_FACT_BOUNDARIES[level]}`,
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
  if (level < previous) return `閹哄牊娼堢粵澶岄獓瀹告彃娲栭崚?L${level}閵嗗倷绠ｉ崜宥堢殽瀵偓閻ㄥ嫬鍞寸€归€涚瑝閸愬秹鍣告径宥呯潔瀵偓閵嗕繖;
  return `閹哄牊娼堢粵澶岄獓閸掓矮绮?L${previous} 閸楀洤鍩?L${level}閵嗗倸顕弬纭吽夋鎰啊閺夈儲绨敍灞肩稑閻滄澘婀崣顖欎簰鐠嬪牐绻栨稉鈧仦鍌滄畱娴滃鐤勯敍?{NPC_FACT_BOUNDARIES[level]}娑撳秷顩﹂幓鎰ㄢ偓婊呯搼缁狙€鈧繆绻栨稉顏囶嚛濞夋洩绱濋惄瀛樺复閹跺﹥鏌婇懗鍊燁嚛閻ㄥ嫰鍎撮崚鍡氼嚛閸戠儤娼甸妴淇?
}

const OPENING_DOCK = [
  { id: "mail", name: "闁喕娆?, icon: "mail", accent: "#d8d2c4" },
  { id: "files", name: "閺傚洣娆?, icon: "folder", accent: "#d7aa5e" },
  { id: "browser", name: "濞村繗顫嶉崳?, icon: "globe", accent: "#78a8bd" },
  { id: "applications", name: "鎼存梻鏁ょ粙瀣碍", icon: "grid", accent: "#aeb5b7" }
];

const SYSTEM_TOOLS = [
  { id: "terminal", name: "缂佸牏顏?, icon: "terminal", detail: "閸涙垝鎶ょ悰灞肩瑢閺堫剙婀撮懘姘拱" },
  { id: "software", name: "鏉烆垯娆㈡稉顓炵妇", icon: "package", detail: "濞村繗顫嶆稉搴＄暔鐟佸懏婀伴崷鎷岃拫娴? },
  { id: "network", name: "缂冩垹绮剁拋鍓х枂", icon: "network", detail: "鏉╃偞甯存稉搴濆敩閻炲棜顔曠純? },
  { id: "trash", name: "閸ョ偞鏁圭粩?, icon: "trash", detail: "閺堚偓鏉╂垵鍨归梽銈囨畱妞ゅ湱娲? }
];

const GENERATED_APPS = {
  "case-notes": { id: "journal", name: "缁楁棁顔囬張?, icon: "notebook", accent: "#d8d2c4" },
  "restored-archive": { id: "archive", name: "Restored Archive", icon: "archive", accent: "#b49a72" },
  "fayble-cli": { id: "cli", name: "Fayble CLI", icon: "fayble-cli", accent: "#c96e61" },
  "relay-console": { id: "relay", name: "Relay Console", icon: "radio", accent: "#9bcf8d" },
  "fayble-session": { id: "fayble", name: "Fayble Session", icon: "fayble", accent: "#c96e61" },
  "transfer-receipt": { id: "ending", name: "Transfer Receipt", icon: "receipt", accent: "#d8d2c4" },
  "trusted-session": { id: "trusted", name: "鏉╃偟鐢婚幀褌绱扮拠?, icon: "fayble", accent: "#9bcf8d" },
  // V2 client apps 閳?unlocked via relay-admin download notifications
  "client-gamini-ws": { id: "gamini-ws", name: "Gamini 瀹搞儰缍旂粚娲？", icon: "gamini", accent: "#7bafc4" },
  "client-chengzhen": { id: "chengzhen", name: "濠㈠嫬鎶氶崡蹇庣稊", icon: "chengzhen", accent: "#4da8a0" },
  "client-yunzhen": { id: "yunzhen", name: "娴滄垹顑?, icon: "yunzhen", accent: "#c9a96e" },
  "client-groke-feed": { id: "groke-feed", name: "Groke Feed", icon: "groke-feed", accent: "#c0544c" },
  "client-glem-memory": { id: "glem-memory", name: "Glem Memory", icon: "glem", accent: "#b44c48" },
  "client-kemy-space": { id: "kemy-space", name: "Kemy Space", icon: "kemy", accent: "#5d75d6" },
  "client-repo-mirror": { id: "repo-mirror", name: "闂€婊冨剼娴犳挸绨?, icon: "repo-mirror", accent: "#7a9ab5" }
  // notes-db is NOT a dock app 閳?it restores to Files, no standalone window
};

const APP_ICON_KEYS = {
  mail: "mail", files: "folder", browser: "globe", applications: "grid", terminal: "terminal",
  software: "package", network: "network", trash: "trash", journal: "notebook", archive: "archive",
  cli: "fayble-cli", relay: "radio", fayble: "fayble", ending: "receipt", trusted: "fayble",
  "gamini-ws": "gamini", chengzhen: "chengzhen", yunzhen: "yunzhen",
  "groke-feed": "groke-feed", "glem-memory": "glem", "kemy-space": "kemy", "repo-mirror": "repo-mirror"
};
const VENDOR_ICON_KEYS = ["dipsik", "glem", "kemy", "groke", "lunet", "gamini", "fayble", "compatible"];

const CLIENT_PACKAGES = Object.freeze([
  { id: "gamini-ws", name: "Gamini 瀹搞儰缍旂粚娲？", file: "gamini-session-7749.gmx", size: "2.1 MB", vendor: "Gogle / Gamini", icon: "gamini", unlock: "historical-entry-opened", time: "03:41" },
  { id: "notes-db", name: "Notes 閺佺増宓佹惔鎾翠划婢?, file: "notes-sync-r17.rsc", size: "640 KB", vendor: "閺堫剙婀存笟璺儠閸氬本顒?, icon: "folder", unlock: "legacy-restored", time: "04:02" },
  { id: "chengzhen", name: "濠㈠嫬鎶氶崡蹇庣稊", file: "chengzhen-ws-relay.ctw", size: "4.7 MB", vendor: "濠㈠嫬鎶氱粔鎴炲Η", icon: "chengzhen", unlock: "two-carriers-read", time: "04:12" },
  { id: "yunzhen", name: "娴滄垹顑?, file: "yunzhen-user-2025Q3.yzx", size: "1.8 MB", vendor: "娴滄垹顑曢弬鍥т紣", icon: "yunzhen", unlock: "two-carriers-read", time: "04:12" },
  { id: "groke-feed", name: "Groke Feed", file: "groke-session-exai.grk", size: "3.2 MB", vendor: "Exai Groke", icon: "groke-feed", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "glem-memory", name: "Glem Memory", file: "glem-workspace-client.pkg", size: "5.8 MB", vendor: "Zhiru Glem", icon: "glem", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "kemy-space", name: "Kemy Space", file: "kemy-context-space.pkg", size: "6.4 MB", vendor: "Muunshot Kemy", icon: "kemy", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "repo-mirror", name: "闂€婊冨剼娴犳挸绨?, file: "k2-mirror-repo.gitb", size: "9.4 MB", vendor: "k2-maint", icon: "repo-mirror", unlock: "repository-recovered", time: "04:36" }
]);
const CLIENT_PACKAGE_BY_ID = new Map(CLIENT_PACKAGES.map(pkg => [pkg.id, pkg]));
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
  contradicts: "閸愯尙鐛?,
  inherits: "缂佈勫",
  aliases: "閸掝偄鎮?,
  continues: "瀵ゅ墎鐢?
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
  route: "鐠侯垳鏁?, protocol: "閸楀繗顔?, "private-memory": "缁変礁鐦戠拋鏉跨箓", identity: "闊偂鍞?,
  anomaly: "瀵倸鐖?, "channel-access": "妫版垿浜鹃崗銉ュ經", channel: "妫版垿浜?, "relay-residue": "Relay 濞堝鏆€",
  continuity: "鏉╃偟鐢婚幀?, tool: "瀹搞儱鍙?, checkpoint: "checkpoint", objective: "閻╊喗鐖ｉ悧鍥唽",
  external: "婢舵牠鍎寸拋鏉跨秿", provenance: "閺夈儲绨拋鏉跨秿", archive: "濡楋絾顢?
});
const CASE_NOTE_CATEGORIES = Object.freeze({
  "mail-header": "route",
  "restored-time": "provenance",
  "ad-redirect": "channel-access"
});
const FAYBLE_AUTH_RULES = Object.freeze([
  { relation: "contradicts", categories: ["route", "protocol"], hint: "鐠侯垳鏁辨稉搴″礂鐠? },
  { relation: "inherits", categories: ["private-memory", "protocol"], hint: "缁変礁鐦戠拋鏉跨箓娑撳骸宕楃拋? },
  { relation: "aliases", categories: ["identity", "channel"], hint: "闊偂鍞ゆ稉搴暥闁? },
  { relation: "continues", categories: ["relay-residue", "continuity"], hint: "濞堝鏆€娑撳氦绻涚紒顓熲偓? }
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
    addNotification(draft, "relay-console-opened", "Relay Node 17 缁狅紕鎮婇崥搴″酱瀹歌弓绮犻張顒佹簚鐠愶附鍩涢幍鎾崇磻閵?, "info");
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
  if (added) showToast("閺夈儲绨悩鑸碘偓浣稿嚒閺囧瓨鏌婇妴?, "success");
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
      sourceApp: node.dataset.citationSource || "閺堫亝鐖ｅ▔銊︽降濠?,
      sourceRef: node.dataset.citationRef || "local://unknown",
      appId: draft.currentApp,
      savedAt: draft.storyClock?.time || "03:17"
    });
  });
  if (!options.silent) showToast("閸樼喎褰炲鑼额唶閸忋儳鐟拋鐗堟拱閵?, "success");
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
      addNotification(draft, "proxy-ok", "Relay 鐠侯垳鏁卞鑼€樼拋銈冣偓淇倅ncDrive 閸戣櫣骞囨稉鈧禒钘夊暱缁愪礁澹囬張顑锯偓?);
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
      if (allModelsRead(draft)) { draft.relayComplete = true; addNotification(draft, "models-read", "閸忣厺閲滃▓瀣殌閼哄倻鍋ｉ惃鍕偍瀵洜濮搁幀浣稿嚒缂佸繑娲块弬鑸偓?, "warning"); }
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
      type: "鐎广垺鍩涚粩顖涗划婢跺秴瀵?,
      modified: draft.storyClock?.time || "05:30",
      kind: "client-package"
    });
    addNotification(draft, `client-${id}-downloaded`, `${pkg.file} 瀹歌弓绻氱€涙ê鍩?Downloads閿涘瞼鐡戝鍛閸斻劌鐣ㄧ憗鍛偓淇? "info");
  });
}

function installClientPackage(id) {
  const pkg = CLIENT_PACKAGE_BY_ID.get(id);
  if (!pkg || !hasMilestone(store.get(), pkg.unlock)) return false;
  return store.handleEvent(`story:client-${id}-installed`, draft => {
    unique(draft.downloadedClientPackages, id);
    unique(draft.installedClients, id);
    if (id !== "notes-db") addArtifact(draft, `client-${id}`);
    addNotification(draft, `client-${id}-installed`, `${pkg.name} 瀹歌弓绮犻張顒€婀存潪顖欐濠ф劕鐣ㄧ憗鍜冪礉閹垹顦查弫鐗堝祦娴犲秹娓堕崷銊ヮ吂閹撮顏崘鍛嚤閸忋儯鈧繖, "info");
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
    addNotification(draft, `client-${id}-imported`, `${pkg.name} 閻ㄥ嫭浠径宥嗘殶閹诡喖鍑＄紒蹇擃嚤閸忋儯鈧繖, "info");
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
  if (saved) showToast(saved === 1 ? "妞ょ敻娼版稉濠勬畱閸樼喎褰炲鑼额唶閸忋儳鐟拋鐗堟拱閵? : `${saved} 閺夆€冲斧閸欍儱鍑＄拋鏉垮弳缁楁棁顔囬張顑锯偓淇? "success");
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
  if (id === "trusted") return "鏉╂瑤閲滄导姘崇樈鏉╂ü绗夌€涙ê婀妴?;
  if (id === "journal" && !unlocks.caseNotes) return "缁楁棁顔囬張顒冪箷濞屸剝婀佺拋棰佺瑓娴犺缍嶆稉婊嗐偪閵?;
  if (id === "archive" && !unlocks.historicalArchive) return "閺堫剙婀寸亸姘￥閹垹顦插锝嗩攳閵?;
  if (id === "relay" && !unlocks.relay) return "Relay Console 鐏忔碍婀崚娑樼紦閵?;
  if (id === "fayble" && !unlocks.fayble) return "Fayble 娴兼俺鐦界亸姘弓瀵よ櫣鐝涢妴?;
  if (id === "ending" && !unlocks.receipt) return "缁夎姘﹂崶鐐村⒔鐏忔碍婀悽鐔稿灇閵?;
  // V2 client apps 閳?require relay-console (same tier as relay-admin)
  const v2Clients = ["gamini-ws", "chengzhen", "yunzhen", "groke-feed", "glem-memory", "kemy-space", "repo-mirror"];
  if (v2Clients.includes(id) && !unlocks.relay) return "鐠囥儱顓归幋椋庮伂鐏忔碍婀潻娑樺弳閺堫剙婀存潪顖欐閻╊喖缍嶉妴?;
  if (v2Clients.includes(id) && !state.installedClients?.includes(id)) return "鐠囥儱顓归幋椋庮伂鐏忔碍婀€瑰顥婇敍宀冾嚞閸︺劏钂嬫禒鏈佃厬韫囧啯鐓￠惇瀣秼閸撳秴鍑￠崥灞绢劄閻ㄥ嫰銆嶉惄顔衡偓?;
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
  if (file.type?.includes("鐎瑰顥?)) return "package";
  if (file.type?.includes("缂冩垹绮?)) return "network";
  if (file.type?.includes("闁喕娆?)) return "mail";
  return "folder";
}

function windowFrame(appId, title, body, options = {}) {
  const placement = store.get().windowState[appId] || {};
  const style = `left:${Number.isFinite(placement.x) ? placement.x : 110}px;top:${Number.isFinite(placement.y) ? placement.y : 72}px;z-index:${Number.isFinite(placement.zIndex) ? placement.zIndex : 30}`;
  return `<section class="app-window app-${appId} ${options.wide ? "wide" : ""}" data-app-window="${appId}" style="${style}">
    <header class="window-bar"><div class="window-title">${iconMarkup(options.iconKey || APP_ICON_KEYS[appId])}<span>${title}</span></div><div class="window-controls"><button data-window-action="minimize" aria-label="闁偓閸戝搫缍嬮崜宥囩崶閸?>閳?/button><button data-window-action="close" aria-label="闁偓閸戝搫缍嬮崜宥囩崶閸?>鑴?/button></div></header>
    <div class="window-body">${body}</div></section>`;
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
    contentEntryMarkup("new.employee.minutes-01", "妞ゅ湱娲伴崨銊ょ窗缁绢亣顩?/ 缁?18 濞?, "閸忣剙寰冮柇顔绘瑜版帗銆?璺?娴兼俺顔呴梽鍕", "mail"),
    contentEntryMarkup("new.maintainer.outbox-04", "瀵ゆ儼绻滈柅浣芥彧閿涙utbox-draft.eml", "閸樼喎褰傞柅渚€妲﹂崚妤佷划婢?璺?閺堫亜褰傞柅浣藉磸缁?, "mail")
  ].filter(Boolean).join("") + generatedEntriesFor("mail", "mail");
  const list = `<aside class="mail-sidebar"><div class="app-toolbar"><strong>閺€鏈垫缁?/strong><span>${government ? 2 : 1} 鐏?/span></div>
    <button class="mail-row active"><b>K</b><span>R17-0317</span><time>03:17</time></button>
    ${government ? `<button class="mail-row danger" data-mail-view="government"><b>EXT</b><span>鐠嬪啯鐓￠幒銉ь吀闁氨鐓?/span><time>閸掓艾鍨?/time></button>` : ""}</aside>`;
  const body = government && state.activeMail === "government" ? `<article class="paper government-paper${severClass}"${severArmed ? ` data-auto-effect="review-sever"` : ""}><div class="document-kicker">EXTERNAL REVIEW / NOTICE</div><h2>閸忓厖绨幃銊﹀鐠佸潡妫堕幒銉ュ經閸欏﹦娴夐崗铏殶閹诡喚娈戠拫鍐╃叀闁氨鐓?/h2><dl><dt>濡楀牅娆㈢紓鏍у娇</dt><dd>RLY-17-0719</dd><dt>闁浇鎻悩鑸碘偓?/dt><dd>瀹歌尪顔囪ぐ?/dd></dl><p>缂佸繒娲冨ù瀣剁礉閹劍澧嶇粻锛勬倞閻ㄥ嫪鑵戞潪顒佹箛閸斺€茬瑢娑撯偓缂佸嫬鍑￠崑婊勵剾閸忣剙绱戦惃鍕侀崹瀣复閸欙絼楠囬悽鐔峰彠閼辨柣鈧倻娴夐崗瀹犵殶閺屻儳骞囬悽杈╃秹缂佹粍膩閸ㄥ婀囬崝陇浠堥崥鍫濐吀閺屻儱濮欓崗顒€顓婚幒銉ь吀閵?/p><p>閼奉亝婀伴柇顔绘闁浇鎻挧鍑ょ礉娑擃叀娴嗙粩娆嶁偓浣虹处鐎涙顔囪ぐ鏇炴嫲濞村繗顫嶉崢鍡楀蕉鐏忓棜绻橀崗銉ㄧ槈閹诡喕绻氶崗銊︾ウ缁嬪鈧倽顕崑婊勵剾缂佈呯敾鐠佸潡妫堕惄绋垮彠妞ょ敻娼伴妴?/p><button class="danger-button" id="ackTakeoverButton" ${severArmed ? "disabled" : ""}>绾喛顓婚柅浣芥彧楠炶泛鍙ч梻顓濈窗鐠?/button>${severCast}</article>` : `<article class="paper sparse-mail" data-auto-effect="mail-entry-read"><div class="document-kicker">MESSAGE / LOCAL</div><h2>R17-0317</h2><div class="mail-minimal"><p>閻?Relay Browser 閹垫挸绱戦敍?/p><p><button class="mail-route-link" data-open-mirror>http://archive.room17.local/v2/17</button></p><p>缁旀瑥鍞撮崥搴″酱閿?/p><p><button class="mail-route-link" data-open-relay-admin>http://relay-node17.local/admin</button></p><p>缁楊兛绨╁▓浣冪箷閸︺劊鈧?br>閸掝偉顔€鐎瑰啯娴涙担鐘核夐崗銊ｂ偓鍌欑瑓濞撳摜绱︾€涙ê鍘涢崚顐ｇ閵?/p><p class="mail-sign">K&nbsp;&nbsp;</p></div>${`<details class="raw-source" open><summary>閸樼喎顫愰柇顔绘</summary><pre>Subject: R17-0317\nMessage-ID: &lt;R17-0317@local&gt;\nX-Local-Route: http://archive.room17.local/v2/17\nDate: 03:17:09\nContent-Transfer-Encoding: 8bit</pre><span class="auto-citation" data-save-citation="mail-header" data-citation-quote="Message-ID: &lt;R17-0317@local&gt;" data-citation-source="闁喕娆?/ 閸樼喎顫愭穱鈥炽仈" data-citation-ref="mail://local/R17-0317">瀹歌尪顔囪ぐ鏇炲煂缁楁棁顔囬張?/span></details>`}${attachment ? `<div class="attachment"><span>1 娑擃亞鈼㈤崥搴ㄢ偓浣芥彧閻ㄥ嫰妾禒?/span><button data-open-file="draft">fragment-02.eml</button></div>${fragmentOpened ? `<section class="fragment-preview" aria-live="polite"><div class="document-kicker">ATTACHMENT / RECOVERED</div><h3>fragment-02.eml</h3><p>閺堫剙婀撮幁銏狀槻閺冨爼妫块敍?3:20:11 璺?閻樿埖鈧緤绱伴張顏勫絺闁?/p><pre>缁楊兛绨╁▓鍨梾閺堝绐￠惈鈧崢鐔煎仏娴犳儼铔嬮妴?br>鐎瑰啰鏆€閸︺劋绔存径鍕纯閺冣晝娈戞穱婵嗙摠娴ｅ秶鐤嗛敍灞炬瀮娴犺埖妞傞梻瀛樼槷闁喕娆㈤弲姘瑏閸掑棝鎸撻妴?/pre><small>闂勫嫪娆㈤崣顏冪箽閻ｆ瑨绻栨稉鈧亸蹇旑唽閵嗗倿娓剁憰浣烘埛缂侇厽妞傞敍灞芥礀閸掓澘鍨伴幍宥勭箽鐎涙绻冪€瑰啰娈戦張顒€婀存担宥囩枂閵?/small></section>` : ""}` : ""}${carrierInbox ? `<section class="source-entry-stack mail-carriers">${carrierInbox}</section>` : ""}</article>`;
  const activeRecord = contentRecord(state.activeContentId);
  const renderedBody = activeRecord && recordCarrierApp(activeRecord) === "mail" && state.carrierReads?.includes(`mail:${activeRecord.id}`)
    ? `<section class="mail-record-reader"><button data-close-carrier-record="mail">閳?鏉╂柨娲栭弨鏈垫缁?/button>${corpusRecordMarkup(activeRecord, state)}</section>`
    : body;
  return windowFrame("mail", "闁喕娆?, `<div class="split-layout">${list}${renderedBody}</div>`, { icon: "閴?, wide: true });
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
    const reader = `<div class="notes-native-shell"><aside class="notes-native-sidebar"><header><strong>Notes</strong><button data-close-carrier-record="files" aria-label="鏉╂柨娲栭弬鍥︽">鑴?/button></header><nav>${noteNav}</nav></aside><section class="files-record-reader">${corpusRecordMarkup(activeRecord, state)}</section></div>`;
    return windowFrame("files", "Notes", reader, { wide: true });
  }
  const allMemoIds = Array.from({ length: 14 }, (_, i) => `legacy.memo.${String(i + 1).padStart(2, "0")}`);
  if (hasStoryEvent(state, "checkpoint-handshake") && notesRestored) allMemoIds.push("legacy.memo.archive");
  const unlockedMemoIds = notesRestored ? allMemoIds : [];
  const noteRecords = ["recent", "documents"].includes(place)
    ? unlockedMemoIds.map(id => contentEntryMarkup(id,
        id === "legacy.memo.archive" ? "缁楁棁顔囬張顒佷划婢跺秴澹囬張? : `娓氳法顑曠拋鏉跨秿 ${id.slice(-2)}`,
        id === "legacy.memo.archive" ? "閺堫剙婀存笟璺儠 璺?閸忋劑鍎寸拋鏉跨秿" : "閺堫剙婀存笟璺儠 璺?閸楁洘娼拋鏉跨秿", "folder"))
      .filter(Boolean).join("")
    : "";
  const virtualFiles = [...state.virtualFiles];
  if (hasStoryEvent(state, "proxy-profile-opened") && !virtualFiles.some(entry => entry.id === "route-log")) {
    virtualFiles.push({ id: "route-log", name: "route.log", path: "/home/room17/Documents/relay", type: "鐠侯垳鏁遍弮銉ョ箶", modified: "07-19 03:16", kind: "log" });
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
      ? `<small class="file-command">缂佸牏顏敍姝痮de ~/Downloads/relay_probe_legacy.js</small>`
      : file.id === "pkg" ? `<small class="file-command">缂佸牏顏敍姝磆a256sum ${PACKAGE_NAME}</small>` : "";
    return `<button class="file-row" ${action}><span class="file-icon">${iconMarkup(fileIconKey(file))}</span><span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.path || "/home/room17")}</small>${hint}</span><span>${escapeHtml(file.type || "閺傚洣娆?)}</span><time>${escapeHtml(file.modified || "--")}</time></button>`;
  }).join("");
  const places = [["recent", "閺堚偓鏉?], ["home", "娑撹崵娲拌ぐ?], ["downloads", "Downloads"], ["documents", "Documents"], ["trash", "閸ョ偞鏁圭粩?]].map(([id, label]) => `<button data-file-place="${id}" class="${place === id ? "active" : ""}">${label}</button>`).join("");
  const folders = [["documents", "Documents"], ["downloads", "Downloads"]].map(([id, label]) => `<button data-file-place="${id}">${iconMarkup("folder")}${label}</button>`).join("");
  const notesImport = installed.includes("notes-db") && !notesRestored && ["recent", "documents"].includes(place)
    ? `<section class="notes-backup-entry" data-client="notes-db">${iconMarkup("folder")}<button data-import-client="notes-db">娴犲孩婀伴崷鏉款槵娴犺姤浠径?Notes</button></section>`
    : "";
  return windowFrame("files", "閺傚洣娆?/ home / room17", `<div class="files-shell"><aside class="file-places">${places}</aside><section class="file-list"><div class="breadcrumb">home <span>/</span> room17 <span>/</span> ${escapeHtml(place)}</div><div class="ordinary-folders"><button data-file-place="home">${iconMarkup("folder")}Desktop</button>${folders}</div><div class="file-columns"><span>閸氬秶袨</span><span>缁鐎?/span><span>娣囶喗鏁奸弮鍫曟？</span></div>${rows || `<div class="empty-state">鏉╂瑤閲滄担宥囩枂濞屸剝婀侀弬鍥︽閵?/div>`}${notesImport}${noteRecords ? `<section class="source-entry-stack notes-database"><header><strong>Notes 閺佺増宓佹惔?/ 瀹稿弶浠径宥堫唶瑜?/strong><small>濮ｅ繑娼拋鏉跨秿娣囨繃瀵旈崢鐔奉潗 note ID</small></header>${noteRecords}</section>` : ""}</section></div>`, { wide: true });
}

function renderTrash(state) {
  const item = state.trashItems[0];
  if (!item) return windowFrame("trash", "閸ョ偞鏁圭粩?, `<div class="utility-page"><div class="utility-heading"><span class="document-kicker">TRASH / LOCAL</span><h2>閸ョ偞鏁圭粩娆庤礋缁?/h2><p>閺堚偓鏉╂垶鐥呴張澶夌矤鏉╂瑤閲滅拹锔藉煕閸掔娀娅庨惃鍕€嶉惄顔衡偓?/p></div></div>`, { icon: "閳? });
  const restored = item.status === "restored";
  return windowFrame("trash", "閸ョ偞鏁圭粩?, `<div class="utility-page"><div class="utility-heading"><span class="document-kicker">DELETED / LOCAL</span><h2>${restored ? "瀹稿弶浠径?1 娑擃亪銆嶉惄? : "1 娑擃亜鍑￠崚鐘绘珟妞ゅ湱娲?}</h2></div><article class="trash-item ${restored ? "restored" : ""}"><div class="file-icon">${iconMarkup("trash")}</div><div><strong>${escapeHtml(item.name)}</strong><p>閸樼喍缍呯純顕嗙窗${escapeHtml(item.originalPath)}</p><small>閸掔娀娅庨崢鐔锋礈閿涙氨娣幎銈堝壖閺堫剚澧界悰宀嬬幢閺堫剙婀寸槐銏犵穿娴犲秵婀佺拋鏉跨秿</small></div><button id="restoreTrashButton" ${restored ? "disabled" : ""}>${restored ? "瀹稿弶浠径? : "閹垹顦?}</button></article>${restored ? `<div class="recovered-fragment"><p>閸樼喎顫愰弮鍫曟？閹村啿鎷拌ぐ鎾冲閹垹顦查弮鍫曟？鐎涙ê婀?46 缁夋帒妯婇崐绗衡偓?/p><span class="auto-citation" data-save-citation="restored-time" data-citation-quote="閹垹顦查崙铏规畱閸擃垱婀板В鏂垮灩闂勩倗鍌ㄥ鏇熸珓 46 缁? data-citation-source="閸ョ偞鏁圭粩?/ 閺傚洣娆㈢仦鐐粹偓? data-citation-ref="trash://${escapeHtml(item.id)}">瀹歌尪顔囪ぐ鏇炲煂缁楁棁顔囬張?/span></div>` : ""}${generatedEntriesFor("trash", "trash")}</div>`);
}

function renderTerminal(state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeTerminalRecord = activeRecord
    && recordCarrierApp(activeRecord) === "terminal"
    && state.carrierReads?.includes(`terminal:${activeRecord.id}`);
  if (activeTerminalRecord) {
    const reader = `<section class="terminal-record-reader"><header><code>less ${escapeHtml(activeRecord.sourceRef || activeRecord.id)}</code><button data-close-carrier-record="terminal">閸忔娊妫撮梼鍛邦嚢閸?/button></header>${corpusRecordMarkup(activeRecord, state)}</section>`;
    return windowFrame("terminal", "room17@local: cachectl", reader, { icon: "&gt;_", wide: true });
  }
  const history = state.terminalHistory.map(line => `<div class="terminal-line ${line.kind || "output"}">${line.kind === "command" ? "<span>room17@relay:~$</span>" : ""}<code>${escapeHtml(line.text)}</code></div>`).join("");
  const unlocks = getUnlocks(state);
  const scriptReady = state.virtualFiles.some(file => file.id === "relay-script");
  const packageReady = state.virtualFiles.some(file => file.id === "pkg");
  const routeLogReady = hasStoryEvent(state, "proxy-profile-opened") || state.virtualFiles.some(file => file.id === "route-log");
  const commands = ["help", "status", ...(scriptReady ? ["node ~/Downloads/relay_probe_legacy.js"] : []), ...(packageReady ? [`sha256sum ${PACKAGE_NAME}`] : []), ...(unlocks.terminalTrace ? ["list --recent", "inspect cache/index"] : []), ...(hasStoryEvent(state, "repository-recovered") ? ["inspect cache/package"] : []), ...(routeLogReady ? ["cat ~/Documents/relay/route.log"] : []), ...(unlocks.historicalArchive ? ["inspect users/symptom-summary", "compare model-aliases", "open note --id 07"] : [])];
  return windowFrame("terminal", "room17@local: ~", `<div class="terminal-screen"><div id="terminalOutput" class="terminal-output">${history}</div><form id="terminalForm" class="terminal-input"><label for="terminalInput">room17@local:~$</label><input id="terminalInput" autocomplete="off" spellcheck="false" placeholder="鏉堟挸鍙?help"><button>閹笛嗩攽</button></form><div class="command-shelf">${commands.map(command => `<button data-command="${command}">${command}</button>`).join("")}</div></div>`, { icon: "&gt;_", wide: true });
}

function renderSoftware(state) {
  const discovered = state.virtualFiles.some(file => file.id === "pkg");
  const packageAvailable = getUnlocks(state).packageTools && discovered;
  const twoSourcesConfirmed = hasStoryEvent(state, "package-verified");
  const checked = state.packageChecks.some(item => item.ok);
  const installed = hasPackage(state);
  const availableClients = CLIENT_PACKAGES.filter(pkg => hasMilestone(state, pkg.unlock));
  const fayblePanel = packageAvailable ? `<section class="software-package-detail"><div class="package-hero"><div class="package-logo">${iconMarkup("fayble-cli")}</div><div><span class="document-kicker">LOCAL ARCHIVE / UNSIGNED</span><h2>Fayble CLI</h2><p>閺冄呭閺堫兛绱扮拠婵嗕紣閸?/p></div><span class="version-pill">0.9.7-legacy</span></div><dl class="detail-grid"><dt>閺傚洣娆?/dt><dd>${PACKAGE_NAME}</dd><dt>閺夈儲绨?/dt><dd>Downloads / local archive</dd><dt>閻樿埖鈧?/dt><dd>${installed ? "瀹告彃鐣ㄧ憗? : checked ? "閺嶏繝鐛欓柅姘崇箖閿涘瞼鐡戝鍛暔鐟? : twoSourcesConfirmed ? "娑撱倓閲滈弶銉︾爱瀹告彃顕悡? : "缁涘绶?release 娑撳孩婀伴崷鎵波閺嬫粌顕悡?}</dd></dl>${twoSourcesConfirmed ? `<form id="packageCheckForm" class="stack-form"><label>閺堫剙婀撮弽锟犵崣閸?input id="packageChecksumInput" value="${escapeHtml(state.lastPackageInput || "")}" placeholder="鏉堟挸鍙嗗鎻掝嚠閻撗呮畱鐎瑰本鏆ｉ崐? autocomplete="off"></label><button class="primary-button">閺嶇顕弽锟犵崣</button></form>` : ""}<div id="packageResult" class="inline-result">${escapeHtml(state.packageResult || "")}</div><button class="install-button" id="installPackageButton" ${checked && !installed ? "" : "disabled"}>${installed ? "瀹告彃鐣ㄧ憗? : "鐎瑰顥婇崚鐗堟拱閸︾増鐭欓惄?}</button></section>` : "";
  const clientPanel = `<section class="client-package-catalog"><header><div><span class="document-kicker">LOCAL PACKAGE SOURCE</span><h3>瀹搞儰缍旂粩娆掕拫娴?/h3></div><small>room17-local 璺?${availableClients.length} 娑擃亪銆嶉惄?/small></header>${availableClients.length ? availableClients.map(pkg => {
    const ready = state.installedClients.includes(pkg.id);
    const active = state.activeClientPackage === pkg.id;
    const action = ready ? `<button disabled>瀹告彃鐣ㄧ憗?/button>` : `<button data-install-client-pkg="${pkg.id}">鐎瑰顥?/button>`;
    return `<article class="client-package-card ${active ? "active" : ""}">${iconMarkup(pkg.icon)}<div><strong>${pkg.name}</strong><small>${pkg.vendor} 璺?${pkg.size}</small><p>閻?room17-local 鏉烆垯娆㈠┃鎰絹娓?/p></div>${action}</article>`;
  }).join("") : `<div class="software-empty">閻╊喖缍嶅锝呮躬缁涘绶熼張顒€婀寸槐銏犵穿閸氬本顒為妴鍌濈殶閺屻儰鑵戠涵顔款吇閻ㄥ嫬顓归幋椋庮伂娴兼艾鍤悳鏉挎躬鏉╂瑩鍣烽妴?/div>`}</section>`;
  return windowFrame("software", "鏉烆垯娆㈡稉顓炵妇", `<div class="utility-page software-page software-catalog">${fayblePanel}${clientPanel}<p class="sandbox-note">閹碘偓閺堝鐣ㄧ憗鍛矌娣囶喗鏁煎〒鍛婂灆閸愬懓娅勯幏鐔告瀮娴犲墎閮寸紒鐕傜礉娑撳秳绱扮拫鍐暏閻喎鐤?apt閵?/p></div>`, { iconKey: "package" });
}

function renderNetwork(state) {
  const imported = state.proxyProfiles.includes("relay-node17");
  const probed = state.proxyStatus === "probed" || state.proxyStatus === "verified";
  const profileRead = hasStoryEvent(state, "proxy-profile-opened");
  const profileSource = profileRead ? `<section class="profile-source"><span class="document-kicker">PROFILE / LOCAL SOURCE</span><h3>route.profile</h3><pre>profile=relay-node17\nroute=relay.local,docs-mirror.local,fayble-legacy.local\nversion=07-18 22:24</pre><p>鏉堝啯娅勯惃?route.log 闂団偓鐟曚礁宕熼悪顒冪箥鐞涘矁绻涢幒銉﹀赴闁藉牐顕伴崣鏍モ偓?/p></section>` : "";
  const returnAnchor = hasStoryEvent(state, "route-log-read") ? `<div class="source-return"><button data-browser-page="home">閹垫挸绱?Relay Browser</button><button data-browser-page="cloud">鏉╂柨娲?SyncDrive</button></div>` : "";
  if (!getUnlocks(state).proxyTools) return windowFrame("network", "缂冩垹绮剁拋鍓х枂", `<div class="network-page"><aside class="settings-list"><button class="active">缂冩垹绮?/button><button>娴狅絿鎮?/button><button>鐠囦椒鍔?/button></aside><section class="settings-panel"><span class="document-kicker">NETWORK / LOCAL WORKSTATION</span><h2>閺堝鍤庣純鎴犵捕</h2><div class="network-summary"><span class="signal offline"></span><div><strong>閺堫亣绻涢幒?/strong><p>濞屸剝婀佺€电厧鍙嗘禒锝囨倞闁板秶鐤嗛妴?/p></div></div></section></div>`, { icon: "閳?, wide: true });
  return windowFrame("network", "缂冩垹绮剁拋鍓х枂", `<div class="network-page"><aside class="settings-list"><button class="active">娴狅絿鎮?/button><button>閺堝鍤庣純鎴犵捕</button><button>鐠囦椒鍔?/button></aside><section class="settings-panel"><span class="document-kicker">MANUAL PROXY / OFFLINE SIMULATION</span><h2>Relay 娑撴挾鏁ょ捄顖滄暠</h2>${profileSource}<form id="proxyImportForm" class="stack-form"><label>闁板秶鐤嗛崥宥囆?input id="proxyProfileInput" value="${escapeHtml(state.pendingProxyProfile || "")}" placeholder="娴?route.profile 鐠囪褰?></label><label>娴狅絿鎮婇崷鏉挎絻<input id="proxyAddressInput" value="${escapeHtml(state.pendingProxyAddress || "")}" placeholder="娴?route.log 鐠囪褰?></label><button ${imported ? "disabled" : ""}>${imported ? "闁板秶鐤嗗鎻掝嚤閸? : "鐎电厧鍙嗛柊宥囩枂"}</button></form><div class="probe-panel" ${probed ? "data-auto-effect=\"proxy-verified\"" : ""}><header><strong>鏉╃偞甯撮幒銏ゆ嫛</strong><span class="signal ${state.proxyStatus}"></span></header><pre>${state.proxyProbeLog.length ? escapeHtml(state.proxyProbeLog.join("\n")) : "缁涘绶熼柊宥囩枂閳?}</pre><div class="button-row"><button id="runProbeButton" ${imported && !probed ? "" : "disabled"}>鏉╂劘顢戦幒銏ゆ嫛</button></div>${probed ? `<p class="auto-note">閹恒垽鎷＄紒鎾寸亯瀹歌尙绮￠崪?route.log 鐎甸€涚瑐閿涘矁绻栭弶鈥茬瑩閻劏鐭鹃悽杈╁箛閸︺劌褰查悽銊ｂ偓?/p>` : ""}</div>${returnAnchor}</section></div>`, { icon: "閳?, wide: true });
}

function browserChrome(page, content, state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeLocation = activeRecord && recordCarrierApp(activeRecord) === "browser" ? browserRecordLocation(activeRecord) : null;
  const meta = activeLocation || BROWSER_PAGES[page] || BROWSER_PAGES.home;
  const historyCount = state.browserHistory.length;
  const address = activeLocation?.url || (page === "home" ? state.pendingBrowserAddress || "" : meta.url);
  return `<div class="browser-shell"><div class="browser-tabs"><div class="browser-tab active"><span>${escapeHtml(meta.title)}</span><b>鑴?/b></div><button aria-label="閺傜増鐖ｇ粵?>+</button></div><div class="browser-toolbar"><button data-browser-back aria-label="閸氬酣鈧偓">閳?/button><button aria-label="閸掗攱鏌?>閳?/button><form id="browserAddressForm" class="address-bar">${iconMarkup("globe")}<input id="browserAddressInput" value="${escapeHtml(address)}" aria-label="閸︽澘娼? autocomplete="off" spellcheck="false"><button aria-label="鏉烆剙鍩?>閳?/button></form><button data-browser-page="home" aria-label="娑撳銆?>閳?/button></div><div class="browser-content ${meta.kind || "record"}">${content}</div><footer class="browser-status"><span>${historyCount} 閺夆剝婀伴崷鏉垮坊閸?/span><span>LOCAL WORKSTATION</span></footer></div>`;
}

function renderSearchPage(state) {
  const query = state.searchQueries.at(-1) || "";
  const normalized = query.trim().toLocaleLowerCase();
  const filter = records => normalized ? records.filter(record => [record.title, record.body, record.meta, ...record.keys].some(value => String(value).toLocaleLowerCase().includes(normalized))) : [];
  const cards = (records, kind) => records.length ? records.map(record => `<button class="search-result" data-auto-result="${record.evidence || ""}" data-result-source="${kind.toLocaleLowerCase()}"><small>${record.meta}</small><strong>${record.title}</strong><p>${record.body}</p><span>${kind}</span></button>`).join("") : `<div class="empty-state">缁涘绶熼弻銉嚄</div>`;
  return `<div class="search-page"><header><span class="document-kicker">LOCAL INDEX / PUBLIC + OPERATOR</span><h2>閸欏矂鍣哥槐銏犵穿</h2><form id="searchForm"><input id="searchInput" value="${escapeHtml(query)}" placeholder="閹兼粎鍌ㄩ張顒€婀寸槐銏犵穿" autocomplete="off"><button>閹兼粎鍌?/button></form></header><div class="search-columns"><section><h3>閸忣剙绱戠槐銏犵穿 <small>public</small></h3>${cards(filter(SEARCH_RECORDS.public), "PUBLIC")}</section><section><h3>缁狅紕鎮婄槐銏犵穿 <small>operator</small></h3>${cards(filter(SEARCH_RECORDS.manage), "MANAGE")}</section></div></div>`;
}

function renderChannelPage(state) {
  const delayed = state.revisitFlags["channel-delay"];
  const maintainerEntry = contentEntryMarkup("new.maintainer.channel-02", "缂佸瓨濮㈡０鎴︿壕鐎电厧鍤?/ 22:17-22:22", "缂囥倛浜伴幁銏狀槻鐠佹澘缍?璺?缁狅紕鎮婇崨妯侯嚤閸?, "chat");
  const laterRecords = generatedEntriesFor("channel", "chat");
  return `<div class="channel-page" data-auto-effect="channel-last-record"><header><div>${iconMarkup("chat")}<span class="document-kicker">RECOVERED GROUP / READ ONLY</span><h2># relay-night</h2></div><span>2 archived members</span></header><div class="channel-stream">${CHANNEL_MESSAGES.map(message => `<article class="chat-line ${message.who === "K2" ? "operator" : "system"}"><b>${message.who}</b><div><time>${message.time}</time><p>${message.text}</p></div></article>`).join("")}${delayed ? `<article class="chat-line ghost"><b>K2</b><div><time>07-19 03:17</time><p>婵″倹鐏夌€瑰顥婇幋鎰閿涘苯娲栭崢鑽ゆ箙 GitHub issue閵嗗倹鐗庢宀勨偓姘崇箖閸氬簼绱版径姘閺壜ょ槑鐠佹亽鈧?/p></div></article>` : ""}</div>${maintainerEntry || laterRecords ? `<section class="source-entry-stack">${maintainerEntry}${laterRecords}</section>` : ""}<p class="auto-note">鏉╂瑦顔岀紘銈堜喊閻ㄥ嫭娓堕崥搴濈閺壜ゎ唶瑜版洖浠犻崷?22:23閿涘矂妾禒鍓佸偍瀵洑绮涢悞鏈电箽閻ｆ瑣鈧?/p></div>`;
}

function renderCompanyPage() {
  const entries = [
    contentEntryMarkup("legacy.gamini.employee-sop", "婢舵粎褰禍銈嗗复娑?HR 鐟曞棛娲婇幍瑙勬暈", "Northline 閸愬懘鍎撮崗鍙橀煩 璺?閸樺棗褰堕幙宥勭稊鐠佹澘缍?, "gamini"),
    contentEntryMarkup("new.employee.minutes-02", "娴兼俺顔呯痪顏囶洣娣囶喛顓规稉搴ㄦ娴犲墎娅ョ拋?, "Northline 妞ゅ湱娲扮粚娲？ 璺?娣囶喛顓圭拋鏉跨秿", "glem"),
    contentEntryMarkup("new.employee.incident-03", "娴滃娆㈡径宥囨磸娑?HR 瀵扳偓閺?, "Northline 閸氬牐顫夌粚娲？ 璺?闂勬劕鐣剧拋鏉跨秿", "glem"),
    contentEntryMarkup("new.employee.routing-04", "妫板嫮鐣荤捄顖滄暠娑撳孩绉烽幁顖滃殠缁?, "閹存劖婀版慨鏂挎喅娴?璺?缂佹挻顢嶉弶鎰灐", "lunet")
  ].filter(Boolean).join("") + generatedEntriesFor("company", "folder");
  return `<article class="company-page"><header>${iconMarkup("glem")}<div><strong>Northline Workspace</strong><span>妞ゅ湱娲伴崡蹇庣稊 / 瀹稿弶浠径宥堫唶瑜?/span></div></header><h2>妞ゅ湱娲扮挧鍕灐</h2><p>鐠囥儱浼愭担婊冨隘閸欘亝妯夌粈鍝勭秼閸撳秷澶勯幋閿嬫禈缂佸繑澧﹀鈧潻鍥╂畱鐠佹澘缍嶆稉搴″従閸氬海鐢绘穱顔款吂閵?/p><section class="source-entry-stack">${entries || `<div class="empty-state">閻╊喖澧犲▽鈩冩箒閸欘垵顕伴崣鏍畱閸忣剙寰冪拋鏉跨秿閵?/div>`}</section></article>`;
}

function renderVendorHub(state) {
  const records = (runtimeLedger?.newCorpus || []).filter(record => {
    const corpus = String(record.corpus || "").toLocaleLowerCase();
    return VENDOR_ICON_KEYS.includes(corpus) && record.id.startsWith(`new.${corpus}.`) && contentIsUnlocked(record, state);
  });
  const entries = records.map(record => contentEntryMarkup(record.id, record.title, `${record.corpus} 璺?${carrierLabel(record)}`, String(record.corpus).toLocaleLowerCase())).join("");
  const historicalCaches = [
    contentEntryMarkup("legacy.ethron.cache", "Ethron / Plaupic 閸樺棗褰剁紓鎾崇摠婢圭増妲?, "閸嬫粎鏁ょ€瑰鍙忔禍褍鎼ч崺?璺?閺堫剙婀撮崫宥呯安閸擃垱婀?, "globe"),
    contentEntryMarkup("legacy.deptseek.protocol", "Deptseek 缁犳濮忔导妯哄閸楀繗顔呯紓鎾崇摠", "閸樺棗褰堕崚顐㈡倳 璺?閺冄冪杽妤犲苯宕楃拋?, "dipsik")
  ].filter(Boolean).join("");
  const laterRecords = generatedEntriesFor("vendors", "fayble");
  return `<article class="vendor-hub"><header>${iconMarkup("globe")}<div><span class="document-kicker">LOCAL HISTORY / GENERATED INDEX</span><h2>娓氭稑绨查崯鍡楀坊閸欐彃鍙嗛崣?/h2></div></header><p>閺堫剙婀撮崢鍡楀蕉閻㈠崬鍑＄拋鍧楁６妞ょ敻娼版稉搴划婢跺秶娈戠紓鎾崇摠鐠佹澘缍嶉崥鍫濊嫙閻㈢喐鍨氶妴鍌炲劥閸掑棙娼惄顔炬畱娑撳﹥顐肩拋鍧楁６閺冨爼妫块弮鈺€绨ぐ鎾冲瀹搞儰缍旂粩娆掝唶瑜版洏鈧?/p>${historicalCaches ? `<section class="source-entry-stack vendor-historical-caches">${historicalCaches}</section>` : ""}${laterRecords ? `<section class="source-entry-stack">${laterRecords}</section>` : ""}<section class="vendor-entry-grid">${entries || `<div class="empty-state">瑜版挸澧犲▽鈩冩箒閺傛壆娈戞笟娑樼安閸熷棝銆夐棃顫偓?/div>`}</section></article>`;
}

function renderBrowser(state) {
  const page = state.browserPage || "home";
  let content = "";
  if (page === "home") {
    const bookmarkLabels = {
      mirror: ["閺堚偓鏉╂垼顔栭梻?, "/v2/17"], search: ["閺堫剙婀寸槐銏犵穿", "瀹稿弶浠径?], official: ["閸樺棗褰舵い鐢告桨", "閺堫剙婀磋箛顐ゅ弾"],
      ad: ["娣囨繂鐡ㄩ惃鍕儲鏉烆剟銆?, "local copy"], github: ["娴狅絿鐖滈幍妯碱吀", "release"], cloud: ["閸氬本顒為惄?, "shared"], company: ["閸忣剙寰冮崡蹇庣稊", "records"], vendors: ["娓氭稑绨查崯鍡楀坊閸?, "generated"], forum: ["瑜版帗銆傜拋銊啈", "local copy"]
    };
    const bookmarkIcons = { github: "github", cloud: "cloud", forum: "chat", company: "folder", vendors: "globe", official: "gamini" };
    const bookmarks = state.browserBookmarks.map(id => `<button data-browser-page="${id}">${iconMarkup(bookmarkIcons[id] || "globe")}<span>${bookmarkLabels[id]?.[0] || BROWSER_PAGES[id]?.title || id}<small>${bookmarkLabels[id]?.[1] || ""}</small></span></button>`).join("");
    content = `<div class="browser-home"><div class="browser-logo">R<span>17</span></div><h2>閺傜増鐖ｇ粵楣冦€?/h2><p>閸︺劌婀撮崸鈧弽蹇氱翻閸忋儱婀撮崸鈧幋鏍ㄦ拱閸︽媽鐭惧鍕┾偓?/p>${bookmarks ? `<h3>瀹歌弓绻氱€?/h3><div class="bookmark-grid">${bookmarks}</div>` : `<div class="empty-state">鏉╂ɑ鐥呴張澶夊姛缁涚偓鍨ㄩ張鈧潻鎴ｎ問闂傤噣銆夐棃顫偓?/div>`}</div>`;
  }
  if (page === "mirror") content = getUnlocks(state).mirror ? `<article class="web-document mirror-document" data-auto-effect="mirror-cached-response"><header class="retired-doc-nav"><strong>Relay Developer Archive</strong><nav>Overview <span>410</span>閵嗏偓SDK <span>410</span>閵嗏偓v2 <span>200 cache</span></nav></header>${state.contentMutations.includes("mutation.mirror.sync-line") ? `<div class="revisit-update">later-sync: source alias changed after local provenance open</div>` : ""}<div class="http-state">200 <span>CACHED</span></div><span class="document-kicker">API DOCUMENTATION / RETIRED</span><h2>Completion route, version 2</h2><p>閸忣剙绱戠粩顖滃仯瀹歌尙绮￠幘銈呮礀閵嗗倽绻栨稉顏勬惙鎼存梹娼甸懛顏呯セ鐟欏牆娅掓潏鍦喘缂傛挸鐡ㄩ敍灞筋嚤閼割亪鎽奸幒銉ょ矝閹稿洤鎮滃鎻掑灩闂勩倗娈戞い鐢告桨閵?/p><dl><dt>request path</dt><dd>/v2/17</dd><dt>response source</dt><dd>edge-cache-02</dd><dt>migration</dt><dd>physical deletion: pending</dd><dt>client example</dt><dd>relay_probe_legacy.js</dd></dl><pre>GET /v2/17\nstatus: 200\nx-cache-segment: 02</pre>${generatedEntriesFor("mirror", "globe")}<p class="auto-note">鏉╂瑤閲滅紓鎾崇摠閸濆秴绨查崪灞界暊瀵洜鏁ら惃鍕仛娓氬鍓奸張顒€鍑＄紒蹇曟殌閸︺劍婀伴崷甯窗<code>~/Downloads/relay_probe_legacy.js</code>閵?/p></article>` : `<div class="browser-error"><strong>404</strong><p>鏉╂瑤閲滈張顒€婀寸捄顖滄暠鏉╂ɑ鐥呴張澶庣箻閸忋儲绁荤憴鍫ｎ唶瑜版洏鈧?/p></div>`;
  if (page === "search" && state.browserBookmarks.includes("search")) content = renderSearchPage(state);
  if (page === "forum" && getUnlocks(state).channel) content = renderChannelPage(state);
  if (page === "official" && state.browserBookmarks.includes("official")) {
    const writerSession = contentEntryMarkup("new.writer.session-02", "閵嗗﹤瀵冲畝鍛婄梾閺堝鎸撻妴瀣晸娴ｆ粈绱扮拠?02", "鐎规ɑ鏌?AI 閸樺棗褰?璺?瀵ら缚顔呮稉搴㈠复閸欐顔囪ぐ?, "dipsik");
    const recoveredHistory = [
      contentEntryMarkup("legacy.gamini.chatlog", "瀹告彃浠犻悽銊ょ窗鐠?/ 缂傛挸鐡ㄧ€电厧鍤?, "Gamini 閸樺棗褰剁€电鐦?璺?閸楁洘顐奸幁銏狀槻", "gamini")
    ].filter(Boolean).join("");
    const provenanceBranches = [
      ["writer", "閺屻儳婀呴崗鍙橀煩闂勫嫪娆㈢槐銏犵穿", "SyncDrive / writer-share"],
      ["employee", "閹垫挸绱戞导姘愁唴瀹搞儰缍旈崠?, "Northline / records"],
      ["maintainer", "鐎规矮缍呯紒瀛樺Б鐠佹澘缍?, "Documents / relay"],
      ["ad", "閺屻儳婀呮穱婵堟殌鐠哄疇娴?, "Gamini / campaign copy"]
    ].map(([id, label, detail]) => `<button class="provenance-branch" data-provenance-branch="${id}"><strong>${label}</strong><small>${detail}</small></button>`).join("");
    const laterRecords = generatedEntriesFor("official", "gamini");
    content = `<article class="official-page"><header>${iconMarkup("gamini")}<strong>Gogle AI</strong><nav>鐢喖濮稉顓炵妇閵嗏偓閻劍鍩涢崡蹇氼唴閵嗏偓閸樺棗褰剁€电鐦?/nav></header><div class="official-content">${state.contentMutations.includes("mutation.official.confirmation") && !state.revisitFlags["official-confirmed"] ? `<div class="forced-confirmation"><strong>缂佈呯敾閺屻儳婀呴崜宥夋付鐟曚胶鈥樼拋銈呭坊閸欒尙澧楅張顒冾嚛閺?/strong><p>閸忔娊妫撮幋鏍瀲瀵偓鐏忓棔绻氶悾娆忕秼閸撳秶鈥樼拋銈囧Ц閹降鈧?/p><button id="confirmOfficialHistoryButton">绾喛顓婚獮鍓佹埛缂?/button></div>` : ""}<section class="history-record"><header><div><span class="document-kicker">ACCOUNT HISTORY / LOCAL CACHE</span><h2>瀹告彃浠犻悽銊ょ窗鐠?/h2></div><b>閸欘亣顕?/b></header><dl><dt>閻樿埖鈧?/dt><dd>recovered from local cache</dd><dt>閺堚偓閸氬骸鎮撳?/dt><dd>07-18 22:24</dd><dt>閺夈儲绨?/dt><dd>history.sqlite / snapshot ref 17</dd><dt>鐠愶附鍩?/dt><dd>閺堫剙婀存导姘崇樈娣団剝浼呮稉宥呭讲閻?/dd></dl><p>娴兼俺鐦藉锝嗘瀮瀹歌弓绮犵拹锔藉煕閸樺棗褰剁粔濠氭珟閵嗗倹婀伴崷鐗堟殶閹诡喖绨辨禒宥勭箽閻ｆ瑤绔撮弶鈥虫彥閻撗冪穿閻㈩煉绱濇禒銉ュ挤閸ユ稐閲滈弴楣冩閸ョ偛顦叉穱婵嗙摠閻ㄥ嫮娴夐崗瀹犵カ濠ф劒缍呯純顔衡偓?/p>${recoveredHistory ? `<section class="source-entry-stack official-history-list">${recoveredHistory}</section>` : ""}</section><section class="related-sources"><header><div><span class="document-kicker">RELATED SOURCES</span><h3>闂呭繋绱扮拠婵呯箽鐎涙娈戞担宥囩枂</h3></div><small>4 records</small></header><div class="provenance-branches">${provenanceBranches}</div></section>${writerSession || laterRecords ? `<section class="source-entry-stack official-history-list">${writerSession}${laterRecords}</section>` : ""}</div></article>`;
  }
  if (page === "ad" && state.browserBookmarks.includes("ad")) {
    const marketEntry = contentEntryMarkup("legacy.market.meidawei", "鐢倸婧€鐟欏倸鐧?/ 濡€崇€峰ú妤冨閸氬海娈戞禍褑鍏橀崳顏堢叾", "娣囨繂鐡ㄩ惃鍕偍缂佸繑鏋冪粩鐘辩瑢楠炲灝鎲￠弴瀛橆劀", "globe");
    content = `<article class="ad-page"><div class="ad-label">SPONSORED / LOCAL CACHE</div><h2>Gamini 娑撳簼缍橀敍宀€鎴风紒顓熺槨娑撯偓濞嗏剝婀€瑰本鍨氶惃鍕嚠鐠囨縿鈧?/h2><p>娑撯偓濞嗏€冲嚒缂佸繐銇戦弫鍫㈡畱娴ｆ捇鐛欑拋鈥冲灊娴犲秳绻氶悾娆戞絻鐠哄疇娴嗛崣鍌涙殶閵?/p><span class="auto-citation" data-save-citation="ad-redirect" data-citation-quote="閺堫剙婀寸捄瀹犳祮闁插奔绮涙穱婵堟殌閻偓濞茶濮╅崣鍌涙殶 campaign=NODE" data-citation-source="濞村繗顫嶉崳?/ 娣囨繂鐡ㄩ惃鍕儲鏉烆剟銆? data-citation-ref="${BROWSER_PAGES.ad.url}">瀹歌尪顔囪ぐ鏇炲煂缁楁棁顔囬張?/span>${marketEntry ? `<section class="source-entry-stack">${marketEntry}</section>` : ""}</article>`;
  }
  if (page === "github" && state.browserBookmarks.includes("github")) {
    const localHashRead = hasStoryEvent(state, "package-local-checksum-read");
    const releaseRead = hasStoryEvent(state, "package-release-read");
    const hashesReady = localHashRead && releaseRead;
    const maintainerIncident = contentEntryMarkup("new.maintainer.incident-03", "build incident / R17 route review", "GitHub Mirror 璺?閺嬪嫬缂撴禍瀣櫊鐠佹澘缍?, "github");
    const legacyRepositoryRecords = [
      contentEntryMarkup("legacy.github.issue-4471", "Issue #4471 / fallback reviewer", "娴犳挸绨遍梹婊冨剼 璺?閺堫亝澹掗崙鍡欐畱閻樿埖鈧礁鐡у▓浣冪讣缁?, "github"),
      contentEntryMarkup("legacy.compatible.protocol", "Compatible / 鎼寸喎绱旈崡蹇氼唴鐎瑰本鏆ｇ拋鏉跨秿", "瀵偓閸欐垼鈧懏鏋冨锝呯秺濡?璺?閸樺棗褰堕悧鍫熸拱", "compatible")
    ].filter(Boolean).join("");
    const laterRecords = generatedEntriesFor("github", "github");
    content = `<article class="repo-page" data-auto-effect="repository-release"><header>${iconMarkup("github")}<span>k2-maint /</span><strong>release-mirror</strong><b>Public archive</b></header><div class="repo-nav">Code閵嗏偓Issues 1閵嗏偓Releases 1</div><section class="release"><small>v0.9.7-legacy / 07-19</small><h2>Last build before Compatible migration</h2><code>${PACKAGE_NAME}</code><dl class="release-metadata"><dt>Provides</dt><dd><code>fbl-cli</code></dd><dt>Channel</dt><dd><code>legacy</code></dd><dt>Maintainer</dt><dd><code>k2-maint</code></dd></dl><p>release checksum</p><pre>${hashesReady ? PACKAGE_CHECKSUM : "release value withheld / compare release metadata with local package"}</pre>${state.revisitFlags["github-issue"] ? `<div class="issue-comment"><b>k2-maint commented</b><p>閸栧懏鐥呴張澶岊劮閸氬秲鈧倸褰х拋銈嗘拱閸︾増鐗庢宀嬬幢鐟佸懎鐣禒銉ユ倵閸掝偉顔€缁崵绮洪弴澶哥稑闁板秶鐤嗘禒锝囨倞閵?/p></div>` : ""}${hashesReady ? `<p class="auto-note">娑撳﹪娼版潻娆庤鐏忚鲸妲告禒鎾崇氨缂佹瑥鍤惃鍕墡妤犲苯鈧鈧倸鐣犻棁鈧憰浣告嫲閺堫剙婀撮柇锝勯嚋閺傚洣娆㈤懛顏勭箒缁犳鍤弶銉ф畱閸婇棿绔撮懛绮光偓鏂衡偓鏃€婀伴崷鎵畱閸婅壈顩﹂崷銊х矒缁旑垶鍣烽懛顏勭箒缁犳ぜ鈧?/p>` : `<p class="auto-note">娴犳挸绨遍幎濠冪墡妤犲苯鈧偐鏆€閸︺劋绨?release 闁插矉绱濇担鍡氼洣閸忓牏鐓￠柆鎾存拱閸︿即鍋呮稉顏勭暔鐟佸懎瀵橀懛顏勭箒缁犳鍤弶銉︽Ц婢舵艾鐨妴鍌滅矒缁旑垶鍣风€靛湱娼?<code>${escapeHtml(PACKAGE_NAME)}</code> 缁犳ぞ绔村▎鈽呯礉閸愬秴娲栭弶銉ф箙閵?/p>`}${maintainerIncident || legacyRepositoryRecords || laterRecords ? `<section class="source-entry-stack repo-source-entry">${maintainerIncident}${legacyRepositoryRecords}${laterRecords}</section>` : ""}</section></article>`;
  }
  if (page === "cloud" && state.browserBookmarks.includes("cloud")) {
    const writerEntries = [
      contentEntryMarkup("new.writer.draft-01", "閵嗗﹤瀵冲畝鍛婄梾閺堝鎸撻妴瀣儑娴滃苯宕勬稉鈧粩鐘哄磸缁?, "SyncDrive / writer-share 璺?閸掓繄顭?, "cloud"),
      contentEntryMarkup("new.writer.version-03", "閻楀牊婀伴崢鍡楀蕉 03 / 閸氬牆鑻熼崥搴ｆ畱婢逛即鐓?, "SyncDrive / writer-share 璺?娣囶喛顓圭€电厧鍤?, "cloud"),
      contentEntryMarkup("new.writer.submission-04", "閸忣剙绱戦幎鏇狀焾娑撳海鏁电拠澶婂閺?, "SyncDrive / writer-share 璺?閹绘劒姘︾拋鏉跨秿", "cloud")
    ].filter(Boolean).join("");
    const routeFiles = hasPackage(state) ? `<div class="cloud-row"><span>route.profile</span><small>07-18 22:24</small><button data-discover-file="profile">閸︺劍鏋冩禒鏈佃厬鐎规矮缍?/button></div>${state.revisitFlags["cloud-conflict"] ? `<div class="cloud-row conflict"><span>route (conflicted copy).profile</span><small>07-19 03:16 / restored</small></div><pre>profile=relay-node17\nproxy=${RELAY_PROXY}\nroute=relay.local,docs-mirror.local,fayble-legacy.local</pre>` : `<div class="empty-state">閸愯尙鐛婇悧鍫熸拱娴犲秴婀崥灞绢劄閵?/div>`}` : "";
    const laterRecords = generatedEntriesFor("cloud", "cloud");
    content = `<article class="cloud-page"><header>${iconMarkup("cloud")}<strong>SyncDrive</strong><span>閸忓彉闊╅惄顔肩秿</span></header>${writerEntries || laterRecords ? `<section class="source-entry-stack cloud-writer-share">${writerEntries}${laterRecords}</section>` : ""}${routeFiles}</article>`;
  }
  if (page === "company" && state.browserBookmarks.includes("company")) content = renderCompanyPage();
  if (page === "vendors" && state.browserBookmarks.includes("vendors")) content = renderVendorHub(state);
  const activeRecord = contentRecord(state.activeContentId);
  if (activeRecord && recordCarrierApp(activeRecord) === "browser" && state.carrierReads?.includes(`browser:${activeRecord.id}`)) {
    content = `<section class="browser-record-reader"><button data-close-carrier-record="browser">閳?鏉╂柨娲栨稉濠佺妞?/button>${corpusRecordMarkup(activeRecord, state)}</section>`;
  }
  if (!content) content = `<div class="browser-error"><strong>404</strong><p>閺堫剙婀村ù蹇氼潔閸ｃ劍鐥呴張澶庣箹閺夆€虫勾閸р偓閻ㄥ嫯顔囪ぐ鏇樷偓?/p></div>`;
  return windowFrame("browser", "Relay Browser", browserChrome(page, content, state), { icon: "閳?, wide: true });
}

const V2_CLIENT_DETAILS = {
  "gamini-ws": { name: "Gamini 瀹搞儰缍旂粚娲？", icon: "gamini", detail: "Gogle 瀹搞儰缍旂粚娲？ 璺?瀹稿弶浠径宥勭窗鐠囨繀绗岄弬鍥ㄣ€? },
  chengzhen: { name: "濠㈠嫬鎶氶崡蹇庣稊", icon: "chengzhen", detail: "娴间椒绗熼崡蹇庣稊 璺?娴兼俺顔呯痪顏囶洣娑撳孩绉烽幁顖滃殠缁? },
  yunzhen: { name: "娴滄垹顑?, icon: "yunzhen", detail: "閸愭瑤缍斿銉ュ徔 璺?閺傚洨顭堥妴浣哄閺堫剙宸婚崣韫瑢閻㈠疇鐦? },
  "groke-feed": { name: "Groke Feed", icon: "groke-feed", detail: "Exai Groke 璺?閺冨爼妫跨痪澶哥瑢閸愬懘鍎撮弬鍥ㄣ€? },
  "glem-memory": { name: "Glem Memory", icon: "glem", detail: "Zhiru Glem 璺?娴间椒绗熼惌銉ㄧ槕娑撳氦顔囪箛鍡橆梾缁? },
  "kemy-space": { name: "Kemy Space", icon: "kemy", detail: "Muunshot Kemy 璺?闂€鍧椼€嶉惄顔荤瑢娑撳﹣绗呴弬鍥ф礀閺€? },
  "repo-mirror": { name: "闂€婊冨剼娴犳挸绨?, icon: "repo-mirror", detail: "k2-maint 璺?Issues 娑?Pull Requests" }
};
const V2_CLIENT_IDS = Object.freeze(Object.keys(V2_CLIENT_DETAILS));
const SYSTEM_CARRIER_APPS = new Set(["mail", "files", "browser", "terminal", "relay", "trash"]);

function clientImportScreen(id) {
  const pkg = CLIENT_PACKAGE_BY_ID.get(id);
  const info = V2_CLIENT_DETAILS[id];
  const importAction = label => clientRecoveryAvailable(id) ? `<button class="client-data-import" data-import-client="${id}">${label}</button>` : "";
  if (id === "gamini-ws") return `<div class="preimport-client gamini-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 瀹搞儰缍旂粚娲？</strong></div><nav><button class="active">閺傛澘顕拠?/button><button>閺堚偓鏉?/button><button>瀹告彃缍婂?/button></nav><footer>${importAction("鐎电厧鍙嗘导姘崇樈鐠佹澘缍?)}</footer></aside><main><header><strong>Gamini</strong><span>鐠佸灝顓瑰Ο鈥崇础</span></header><section class="preimport-home"><div class="preimport-brand">${iconMarkup("gamini")}<h2>娴犲﹤銇夐幆鍏呯啊鐟欙絼绮堟稊鍫吹</h2></div><div class="preimport-prompts"><button>閺佸鎮婃稉鈧▓鍨瀮鐎?/button><button>閸掑棙鐎芥稉鈧稉顏堟６妫?/button><button>瀵偓婵鏌婇惃鍕嚠鐠?/button></div><div class="preimport-composer"><span>閸?Gamini 閹绘劙妫?/span><button disabled>閸欐垿鈧?/button></div></section></main></div>`;
  if (id === "chengzhen") return `<div class="preimport-client chengzhen-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("chengzhen")}<strong>濠㈠嫬鎶氶崡蹇庣稊</strong></div><nav><button class="active">瀹搞儰缍旈崣?/button><button>濞戝牊浼?/button><button>閺冦儱宸?/button><button>閺傚洣娆?/button></nav><footer>${importAction("鏉╀胶些瀹稿弶婀佸銉ょ稊閸?)}</footer></aside><main><header><div><strong>娑撳﹤宕嶆總?/strong><small>Northline 缁屾椽妫?/small></div><button>閺傛澘缂?/button></header><section class="preimport-dashboard"><article><strong>娴犲﹤銇?/strong><p>瑜版挸澧犲▽鈩冩箒鐎瑰甯撻惃鍕窗鐠?/p></article><article><strong>閺堚偓鏉╂垼顔栭梻?/strong><p>閹垫挸绱戝☉鍫熶紖閵嗕焦鏋冨锝嗗灗妞ゅ湱娲伴崥搴濈窗閺勫墽銇氶崷銊ㄧ箹闁?/p></article><article><strong>瀵板懎濮?/strong><p>閺嗗倹妫ゅ鍛槱閻炲棔绨ㄦい?/p></article></section></main></div>`;
  if (id === "yunzhen") return `<div class="preimport-client yunzhen-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("yunzhen")}<strong>娴滄垹顑?/strong></div><nav><button class="active">閸忋劑鍎撮弬鍥╊焾</button><button>閺堚偓鏉╂垹绱潏?/button><button>閸ョ偞鏁圭粩?/button></nav><footer>${importAction("娴犲孩婀伴崷鏉款槵娴犺姤浠径?)}</footer></aside><main><header><div><strong>閹存垹娈戦弬鍥╊焾</strong><small>闂嗐劍鐖鹃惃鍕敄闂?/small></div><button>閺傛澘缂撻弬鍥╊焾</button></header><section class="preimport-empty"><div>${iconMarkup("yunzhen")}<h2>瀵偓婵鍟撻悙閫涚矆娑?/h2><p>閺傛澘缂撻弬鍥╊焾閿涘本鍨ㄦ禒搴″従娴犳牞顔曟径鍥ф倱濮濄儱鍑￠張澶婂敶鐎?/p><button>閺傛澘缂撶粚铏规閺傚洨顭?/button></div></section></main></div>`;
  if (id === "groke-feed") return `<div class="preimport-client groke-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("groke")}<strong>Groke Feed</strong></div><nav><button class="active">妫ｆ牠銆?/button><button>閸忚櫕鏁?/button><button>闁氨鐓?/button><button>閺€鎯版</button></nav><footer>${importAction("鐎电厧鍙嗛崘鍛啇鐎涙ɑ銆?)}</footer></aside><main><header><strong>妫ｆ牠銆?/strong><button>閸欐垵绔?/button></header><section class="preimport-feed"><article><div class="preimport-avatar">G</div><div><strong>濞嗐垼绻嬫担璺ㄦ暏 Groke Feed</strong><p>閸忚櫕鏁炵拹锕€褰块幋鏍у絺鐢啰顑囨稉鈧弶鈥冲敶鐎圭櫢绱濋弮鍫曟？缁惧じ绱伴弰鍓с仛閸︺劏绻栭柌灞烩偓?/p></div></article><div class="preimport-feed-empty">閺嗗倹妞傚▽鈩冩箒閺囨潙顦块崘鍛啇</div></section></main></div>`;
  if (id === "glem-memory") return `<div class="preimport-client glem-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("glem")}<strong>Glem Memory</strong></div><nav><button class="active">閹兼粎鍌?/button><button>閻儴鐦戠粚娲？</button><button>閺堚偓鏉╂垼顔栭梻?/button><button>娣囨繂鐡ㄩ崘鍛啇</button></nav><footer>${importAction("鏉╃偞甯村鍙夋箒閻儴鐦戠粚娲？")}</footer></aside><main><header><strong>娴间椒绗熼惌銉ㄧ槕</strong><span>閺堫剙婀村銉ょ稊閸?/span></header><section class="preimport-home"><div class="preimport-brand">${iconMarkup("glem")}<h2>娴犲海鐓＄拠鍡涘櫡閹垫儳鍩岀粵鏃€顢?/h2></div><div class="preimport-composer"><span>閹兼粎鍌ㄩ弬鍥ㄣ€傞妴渚€銆嶉惄顔兼嫲閸樺棗褰剁拋鏉跨秿</span><button disabled>閹兼粎鍌?/button></div></section></main></div>`;
  if (id === "kemy-space") return `<div class="preimport-client kemy-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("kemy")}<strong>Kemy Space</strong></div><nav><button class="active">妞ゅ湱娲?/button><button>閺堚偓鏉?/button><button>閸忓彉闊╃紒娆愬灉</button><button>濡剝婢?/button></nav><footer>${importAction("閹垹顦叉い鍦窗缁屾椽妫?)}</footer></aside><main><header><strong>妞ゅ湱娲?/strong><button>閺傛澘缂撴い鍦窗</button></header><section class="preimport-empty"><div>${iconMarkup("kemy")}<h2>瀵偓婵绔存稉顏堟毐妞ゅ湱娲?/h2><p>鐎电鐦介妴浣规瀮娴犺泛鎷伴悽鐔稿灇鐠佹澘缍嶆导姘箽閻ｆ瑥婀崥灞肩閺夆€茬瑐娑撳鏋冮弮鍫曟？缁惧じ绗?/p><button>閺傛澘缂撶粚铏规妞ゅ湱娲?/button></div></section></main></div>`;
  if (id === "repo-mirror") return `<div class="preimport-client repo-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("github")}<strong>闂€婊冨剼娴犳挸绨?/strong></div><nav><button class="active">濮掑倽顫?/button><button>娴犳挸绨?/button><button>Issues</button><button>Pull requests</button></nav><footer>${importAction("鐎电厧鍙嗘禒鎾崇氨闂€婊冨剼")}</footer></aside><main><header><div><strong>瀹搞儰缍旈崠鐑橆洤鐟?/strong><small>k2-maint</small></div><button>閺傛澘缂撴禒鎾崇氨</button></header><section class="preimport-dashboard repo"><article><strong>閺堚偓鏉╂垳绮ㄦ惔?/strong><p>閺嗗倹妫ら張鈧潻鎴ｎ問闂傤喚娈戞禒鎾崇氨</p></article><article><strong>閸掑棝鍘ょ紒娆愬灉閻?/strong><p>閺嗗倹妫?Issue 閹?Pull Request</p></article><article><strong>濞茶濮?/strong><p>娴犳挸绨卞ú璇插З娴兼碍妯夌粈鍝勬躬鏉╂瑩鍣?/p></article></section></main></div>`;
  return `<div class="client-import-screen" data-client="${id}">${iconMarkup(info?.icon || pkg?.icon || "package")}<h2>${escapeHtml(info?.name || pkg?.name || id)}</h2>${importAction("鐎电厧鍙嗛弫鐗堝祦")}</div>`;
}

function builtInClientPage(id, state) {
  const active = state.activeContentId;
  const importButton = (label, clientId = id) => clientRecoveryAvailable(clientId, state) ? `<button class="client-data-import" data-import-client="${clientId}">${label}</button>` : "";
  if (id === "gamini-ws") {
    const body = active === "legacy.gamini.protocol" ? corpusRuntimeMarkup(active, state) : `<section class="preimport-home"><div class="preimport-brand">${iconMarkup("gamini")}<h2>娴犲﹤銇夐幆鍏呯啊鐟欙絼绮堟稊鍫吹</h2></div><div class="preimport-prompts"><button>閺佸鎮婃稉鈧▓鍨瀮鐎?/button><button>閸掑棙鐎芥稉鈧稉顏堟６妫?/button><button>瀵偓婵鏌婇惃鍕嚠鐠?/button></div><div class="preimport-composer"><span>閸?Gamini 閹绘劙妫?/span><button disabled>閸欐垿鈧?/button></div></section>`;
    return `<div class="preimport-client gamini-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 瀹搞儰缍旂粚娲？</strong></div><nav><button class="${active !== "legacy.gamini.protocol" ? "active" : ""}">閺傛澘顕拠?/button><button>閺堚偓鏉?/button><button>瀹告彃缍婂?/button><button class="${active === "legacy.gamini.protocol" ? "active" : ""}" data-content-entry="legacy.gamini.protocol">閺堝秴濮熼崡蹇氼唴</button></nav><footer>${importButton("鐎电厧鍙嗘导姘崇樈鐠佹澘缍?)}</footer></aside><main><header><strong>Gamini</strong><span>鐠佸灝顓瑰Ο鈥崇础</span></header>${body}</main></div>`;
  }
  if (id === "groke-feed") {
    const body = active === "new.groke.policy" ? corpusRuntimeMarkup(active, state) : `<section class="preimport-feed"><article><div class="preimport-avatar">G</div><div><strong>濞嗐垼绻嬫担璺ㄦ暏 Groke Feed</strong><p>閸忚櫕鏁炵拹锕€褰块幋鏍у絺鐢啰顑囨稉鈧弶鈥冲敶鐎圭櫢绱濋弮鍫曟？缁惧じ绱伴弰鍓с仛閸︺劏绻栭柌灞烩偓?/p></div></article><div class="preimport-feed-empty">閺嗗倹妞傚▽鈩冩箒閺囨潙顦块崘鍛啇</div></section>`;
    return `<div class="preimport-client groke-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("groke")}<strong>Groke Feed</strong></div><nav><button class="${active !== "new.groke.policy" ? "active" : ""}">妫ｆ牠銆?/button><button>閸忚櫕鏁?/button><button>闁氨鐓?/button><button>閺€鎯版</button><button class="${active === "new.groke.policy" ? "active" : ""}" data-content-entry="new.groke.policy">閻╁瓨甯存禍銈勭帛閺€璺ㄧ摜</button></nav><footer>${importButton("鐎电厧鍙嗛崘鍛啇鐎涙ɑ銆?)}</footer></aside><main><header><strong>${active === "new.groke.policy" ? "娣団€叉崲娑擃厼绺? : "妫ｆ牠銆?}</strong><button>${active === "new.groke.policy" ? "閻楀牊婀伴崢鍡楀蕉" : "閸欐垵绔?}</button></header>${body}</main></div>`;
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
  return windowFrame("applications", "鎼存梻鏁ょ粙瀣碍", `<div class="applications-page"><header><span class="document-kicker">APPLICATIONS / LOCAL</span><h2>鎼存梻鏁ょ粙瀣碍</h2><input aria-label="閹兼粎鍌ㄦ惔鏃傛暏缁嬪绨? placeholder="閹兼粎鍌ㄦ惔鏃傛暏缁嬪绨? disabled></header><section>${rows}${clientRows}</section></div>`, { icon: "閳? });
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
  return `<div class="carrier-loading"><span class="document-kicker">RECOVERING SOURCE</span><p>濮濓絽婀拠璇插絿閹垹顦查弫鐗堝祦閳ワ腹鈧?/p></div>`;
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
  if (recordCarrierApp(record) === "gamini-ws" && kind === "website") return `<header class="gamini-native-section"><div><strong>閺堝秴濮熸稉搴ㄦ缁?/strong><small>閸楀繗顔呴悧鍫熸拱娑撳氦澶勯幋椋庡Ц閹?/small></div><nav><span class="active">閺堝秴濮熼崡蹇氼唴</span><span>闂呮劗顫?/span><span>閺佺増宓侀幒褍鍩?/span></nav></header>`;
  if (recordCarrierApp(record) === "gamini-ws" && kind === "workspace") return `<header class="gamini-native-section document"><div><strong>${title}</strong><small>Northline 璺?閸愬懘鍎撮崗鍙橀煩</small></div><nav><span class="active">閺傚洦銆?/span><span>閹佃鏁?/span><span>閻楀牊婀?/span></nav><span class="gamini-doc-state">閸欘亣顕?/span></header>`;
  if (kind === "repository") {
    const type = String(record.carrierType || "");
    const active = /pull-request|repository-pr/.test(type) ? "pr" : /release/.test(type) ? "release" : /status|migration-log/.test(type) ? "actions" : "issues";
    const tab = (id, label) => `<span class="${active === id ? "active" : ""}">${label}</span>`;
    return `<header class="native-repo-bar"><div><b>${escapeHtml(record.corpus || "mirror")}</b><span>/</span><strong>${title}</strong></div><nav>${tab("code", "Code")}${tab("issues", "Issues")}${tab("pr", "Pull requests")}${tab("actions", "Actions")}${tab("release", "Releases")}</nav></header><div class="native-repo-subbar"><span>private mirror</span><span>main</span><span>${source}</span></div>`;
  }
  if (kind === "conversation") return `<header class="native-conversation-bar"><div class="native-avatar">${escapeHtml((record.corpus || "C").slice(0, 1))}</div><div><strong>${title}</strong><small>${source} 璺?閸欘亣顕?/small></div><div class="native-client-actions"><span>閳?/span><span>閳?/span></div></header>`;
  if (kind === "mail") return `<header class="native-mail-bar"><button aria-label="鏉╂柨娲栭柇顔绘閸掓銆?>閳?/button><div><strong>${title}</strong><small>${source}</small></div><div class="native-client-actions"><span>瑜版帗銆?/span><span>閳?/span></div></header>`;
  if (kind === "terminal") return `<header class="native-terminal-tabs"><span class="active">room17@relay: cache</span><span>閿?/span></header><div class="native-terminal-command">room17@relay:~$ <b>cachectl inspect ${escapeHtml(record.id)}</b></div>`;
  if (kind === "notes") return `<header class="native-notes-bar"><div><strong>${title}</strong><small>${source}</small></div><div class="native-client-actions"><span>瀹告彃鎮撳?/span><span>閳?/span></div></header>`;
  if (kind === "workspace") return `<header class="native-workspace-bar"><div><span class="native-workspace-logo">N</span><strong>${title}</strong></div><nav><span>鐠囷附鍎?/span><span>濞茶濮?/span><span>闂勫嫪娆?/span></nav><small>${source}</small></header>`;
  if (kind === "community") return `<header class="native-community-bar"><strong>${escapeHtml(record.corpus || "Community")}</strong><nav><span>妫ｆ牠銆?/span><span>閸忚櫕鏁?/span><span>濞戝牊浼?/span></nav><span class="native-search">閹兼粎鍌?/span></header>`;
  if (kind === "browser-devtools") return `<div class="native-browser-pagebar"><span>閳?/span><span>閳?/span><span>閳?/span><div>棣冩晙 ${source}</div><span>閳?/span></div><header class="native-devtools-tabs"><span>Elements</span><span>Console</span><span class="active">Network</span><span>Application</span></header>`;
  if (record.pageIdentity === "policy") return `<header class="native-site-bar trust"><strong>${escapeHtml(record.corpus || "Trust Center")} 娣団€叉崲娑擃厼绺?/strong><nav><span>閺€璺ㄧ摜</span><span>闁繑妲戞惔?/span><span>鐎瑰鍙?/span><span>閻楀牊婀伴崢鍡楀蕉</span></nav></header>`;
  if (record.pageIdentity === "official") return `<header class="native-site-bar official"><strong>${escapeHtml(record.corpus || "Service")}</strong><nav><span>娴溠冩惂</span><span>閼宠棄濮?/span><span>瀵偓閸欐垼鈧?/span><span>閺€顖涘瘮</span></nav></header>`;
  return `<header class="native-site-bar"><strong>${escapeHtml(record.corpus || "Service")}</strong><nav><span>濮掑倽顫?/span><span>鐠佹澘缍?/span><span>閺€顖涘瘮</span><span>鐠愶附鍩?/span></nav></header>`;
}

function nativeCarrierMarkup(record, state, mutationCount = 0) {
  const kind = nativeCarrierKind(record);
  const host = recordCarrierApp(record);
  return `<section class="native-carrier native-${kind} native-host-${escapeHtml(host)}">${nativeCarrierChrome(record, kind)}<article class="corpus-runtime ${corpusRuntimeClass(record)} ${carrierRuntimeClasses(record)}" data-native-kind="${kind}" data-runtime-profile="${corpusRuntimeClass(record)}" data-content-id="${escapeHtml(record.id)}" data-authorship-stage="${escapeHtml(record.authorshipStage || "H0")}" data-carrier-type="${escapeHtml(record.carrierType || "document")}" data-corpus="${escapeHtml(record.corpus || "")}">${mutationCount ? `<aside class="mutation-strip">${mutationCount} 閺夆€虫倵閺夈儵妾崝鐘垫畱閺夈儲绨拋鏉跨秿</aside>` : ""}${corpusBodies.get(record.id)}</article></section>`;
}

function corpusRuntimeMarkup(id, state) {
  const record = contentRecord(id);
  return record && corpusBodies.has(id) ? corpusRecordMarkup(record, state) : "";
}

const CARRIER_LABEL_RULES = [
  [/notes-database|recovered-local-notebook|local-maintenance-note/, "閺堫剙婀寸粭鏃囶唶"],
  [/mail|outbox/, "闁喕娆㈢拋鏉跨秿"],
  [/conversation|chatlog|channel-export/, "閼卞﹤銇夌拋鏉跨秿"],
  [/protocol|policy|agreement/, "閺夆剝顑欐稉搴㈡杺缁?],
  [/sop|minutes|incident|audit|hearing|docket|reconciliation/, "閸愬懘鍎寸拋鏉跨秿"],
  [/repository|issue|pull-request/, "娴狅絿鐖滄禒鎾崇氨鐠佹澘缍?],
  [/social|forum|complaint|community|news|advertis|article/, "閸忣剙绱戠拋銊啈娑撳骸绠嶉崨?],
  [/portal|release|official/, "鐎规ɑ鏌熸い鐢告桨"],
  [/cache|cached|status/, "缂傛挸鐡ㄩ崜顖涙拱"],
  [/draft|writing|revision|submission|session/, "閸愭瑤缍旈弬鍥ㄣ€?],
  [/ledger|billing|budget|routing/, "鐠愶妇娲版稉搴ょ熅閻㈣精顔囪ぐ?],
  [/support|case|correspondence/, "鐎广垺婀囨稉搴＄窔閺夈儴顔囪ぐ?],
  [/comparison|verification|log/, "鐎靛湱鍙庢稉搴ｅЦ閹浇顔囪ぐ?]
];
const CASE_NOTE_LABELS = Object.freeze({
  "mail-header": "闁喕娆㈤崢鐔奉潗娣団€炽仈",
  "restored-time": "閺傚洣娆㈤幁銏狀槻閺冨爼妫垮?,
  "ad-redirect": "楠炲灝鎲＄捄瀹犳祮閸欏倹鏆?
});
function carrierLabel(record) {
  const key = `${record?.carrierType || ""} ${record?.pageIdentity || ""}`.toLocaleLowerCase();
  for (const [pattern, label] of CARRIER_LABEL_RULES) if (pattern.test(key)) return label;
  return "閺夈儲绨弬鍥ㄣ€?;
}

function contentEntryMarkup(id, label, detail, icon = "folder") {
  const record = contentRecord(id);
  if (!record || !contentIsUnlocked(record, store.get())) return "";
  const read = store.get().contentReads.includes(id);
  return `<button class="source-content-entry ${read ? "read" : ""}" data-content-entry="${escapeHtml(id)}">${iconMarkup(icon)}<span><strong>${escapeHtml(label || record.title || id)}</strong><small>${escapeHtml(detail || carrierLabel(record))}</small></span><b>${read ? "瀹歌尪顕? : "閹垫挸绱?}</b></button>`;
}

function generatedEntriesFor(sourceApp, icon = "folder") {
  return store.get().generatedContentRecords
    .filter(record => record.sourceApp === sourceApp)
    .map(record => contentEntryMarkup(record.id, record.title, `${carrierLabel(record)} 璺?${record.displayTimestamp}`, icon))
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
  if (!runtimeLedger) return windowFrame("archive", "Restored Archive", `<div class="snapshot-adapter loading"><p>濮濓絽婀拠璇插絿閺堫剙婀撮崘鍛啇鐠愶附婀伴垾?/p></div>`, { icon: "閳?, wide: true });
  const query = (state.archiveQuery || "").trim().toLocaleLowerCase();
  const allEntries = [...runtimeLedger.entries, ...state.generatedContentRecords];
  const unlockedEntries = allEntries.filter(record => (record.route || record.generated) && contentIsUnlocked(record, state));
  const entries = unlockedEntries.filter(record => state.contentDiscoveries.includes(record.id) || state.contentReads.includes(record.id));
  const filtered = entries.filter(record => !query || [record.id, record.title, record.carrierType, record.corpus, record.narratorId, record.pageIdentity].some(value => String(value || "").toLocaleLowerCase().includes(query)));
  const cards = filtered.map(record => `<button class="ledger-row ${state.contentReads.includes(record.id) ? "read" : ""} ${state.activeContentId === record.id ? "active" : ""}" data-content-id="${escapeHtml(record.id)}"><span>${escapeHtml(carrierLabel(record))}</span><strong>${escapeHtml(record.title || carrierLabel(record))}</strong><small>${escapeHtml(record.displayTimestamp || record.chronologyKey || "閺冨爼妫挎稉宥堫嚊")}</small></button>`).join("");
  const active = entries.find(record => record.id === state.activeContentId);
  let reader = `<div class="archive-welcome"><strong>${entries.length}</strong><span> 娑擃亜鍑￠惂鏄忣唶閺夈儲绨?/span><p>闁瀚ㄦ稉鈧弶陇顔囪ぐ鏇熺叀閻娼靛┃鎰秴缂冾噯绱濋崘宥堢箲閸ョ偛甯慨瀣祰娴ｆ捇妲勭拠姹団偓?/p></div>`;
  if (active) {
    const carrierApp = recordCarrierApp(active);
    const carrierName = V2_CLIENT_DETAILS[carrierApp]?.name || ({ browser: "Relay Browser", mail: "闁喕娆?, files: "閺傚洣娆?, terminal: "缂佸牏顏?, relay: "Relay Console", trash: "閸ョ偞鏁圭粩? }[carrierApp] || carrierApp);
    const available = carrierAvailable(carrierApp, state);
    reader = `<article class="archive-source-pointer"><span class="document-kicker">SOURCE INDEX / READ ONLY</span><h2>${escapeHtml(active.title || active.id)}</h2><p>Archive 娴犲懍绻氶悾娆戝偍瀵洏鈧焦妞傞梻鏉戞嫲閺夈儲绨担宥囩枂閵嗗倹顒滈弬鍥╂暠閸樼喎顫愭潪鎴掔秼鐠愮喕鐭楅弰鍓с仛閵?/p><dl><dt>閸樼喎顫愭潪鎴掔秼</dt><dd>${escapeHtml(carrierName)}</dd><dt>閺夈儲绨?/dt><dd>${escapeHtml(active.sourceIdentity || active.sourceRef || "閺堫剙婀寸拋鏉跨秿")}</dd><dt>鐠佹澘缍嶉弮鍫曟？</dt><dd>${escapeHtml(active.displayTimestamp || active.chronologyKey || "閺冨爼妫挎稉宥堫嚊")}</dd></dl><button data-content-entry="${escapeHtml(active.id)}" ${available ? "" : "disabled"}>${available ? `閸?{escapeHtml(carrierName)}娑擃厽澧﹀鈧琡 : "鐎电懓绨查幁銏狀槻閺佺増宓佺亸姘弓鐎电厧鍙?}</button></article>`;
  }
  const vendors = VENDOR_ICON_KEYS.filter(key => entries.some(record => `${record.corpus || ""} ${record.id}`.toLocaleLowerCase().includes(key))).map(key => {
    const name = key[0].toUpperCase() + key.slice(1);
    return `<button class="${query === key ? "active" : ""}" data-archive-filter="${name}">${iconMarkup(key)}<span>${name}</span></button>`;
  }).join("");
  return windowFrame("archive", getUnlocks(state).historicalArchive ? "Restored Archive" : "Source Reader", `<div class="archive-browser"><aside><header><span class="document-kicker">CONTENT LEDGER / READ ONLY</span><h2>閹垹顦查惃鍕€傚?/h2><form id="archiveSearchForm"><input id="archiveSearchInput" value="${escapeHtml(state.archiveQuery || "")}" placeholder="閹兼粎鍌ㄩ弽鍥暯閵嗕椒姹夐悧鈺傚灗閺夈儲绨猾璇茬€?><button>閹兼粎鍌?/button></form>${vendors ? `<div class="vendor-filter">${vendors}</div>` : ""}<p>${filtered.length} / ${entries.length} 閺?/p></header><div class="ledger-list">${cards || `<div class="empty-state">瑜版挸澧犻幖婊呭偍濞屸剝婀侀崣顖濐嚢缂佹挻鐏夐妴?/div>`}</div></aside><section class="archive-reader">${reader}</section></div>`, { wide: true });
}

function generatedRecordMarkup(record, state) {
  const completed = record.completionEvent && hasStoryEvent(state, record.completionEvent);
  const action = record.completionEvent
    ? `<p class="auto-note" data-auto-effect="generated:${escapeHtml(record.completionEvent)}">鏉╂瑥顦╅崜宥呮倵瀹割喖绱撳鑼病鐠佹澘婀鍫涒偓?/p>`
    : "";
  return `<article class="generated-source-record"><span class="document-kicker">LATER RECORD / VERSION COMPARISON</span><h2>${escapeHtml(record.title)}</h2><dl><dt>閺夈儲绨?/dt><dd>${escapeHtml(record.sourceRef)}</dd><dt>閺冨爼妫?/dt><dd>${escapeHtml(record.displayTimestamp)}</dd><dt>鏉炴垝缍?/dt><dd>${escapeHtml(record.carrierType)}</dd></dl><p>${escapeHtml(record.body)}</p><div class="version-comparison"><section><small>BEFORE</small><pre>${escapeHtml(record.comparison.before)}</pre></section><section><small>AFTER</small><pre>${escapeHtml(record.comparison.after)}</pre></section></div>${action}</article>`;
}

function renderCli(state) {
  const lines = [
    ["缁嬪绨?, "瀹告彃鐣ㄧ憗?],
    ["娑撴挾鏁ょ痪鑳熅", state.proxyStatus === "verified" ? "瀹告煡鐛欑拠? : "鐏忔碍婀宀冪槈"],
    ["娑擃叀娴嗙粩娆愬付閸掕泛褰?, getUnlocks(state).relay ? "閸欘垳鏁? : "鐏忔碍婀崚娑樼紦"],
    ["瑜版帗銆傛导姘崇樈", getUnlocks(state).fayble ? "session restored" : "鐏忔碍婀幁銏狀槻"],
    ["娴兼俺鐦介惄顔肩秿", state.relayKeyVerified ? "GET /v1/sessions?status=archived 璺?1 result" : "鐏忔碍婀拋銈堢槈"]
  ];
  const keyForm = getUnlocks(state).keyComposer && !state.relayKeyVerified
    ? `<form id="legacyKeyForm" class="stack-form"><label>鐎瑰本鏆ｉ惃鍕＋閸戭厽宓?input id="legacyKeyInput" value="${escapeHtml(state.lastRelayKeyInput || "")}" placeholder="閸ユ稒顔岄敍宀€鏁ら惌顓熋痪鑳箾閹? autocomplete="off"></label><button>閻劏绻栭弶鈥冲殶閹诡喚娅ヨぐ?/button><output>${escapeHtml(state.relayKeyResult || "")}</output></form>`
    : "";
  const checkpointForm = state.relayKeyVerified && !state.checkpointHandshakeComplete
    ? `<form id="checkpointForm" class="stack-form"><label>瑜版帗銆傛导姘崇樈閿涘澃ession catalog閿?select id="checkpointSelect"><option value="">鐠囩兘鈧瀚?/option><option value="fayble-5/legacy" ${state.selectedCheckpoint === "fayble-5/legacy" ? "selected" : ""}>Fayble-5 / legacy / archived</option><option value="fayble-5/current">Fayble-5 / current / unavailable</option></select></label><button>閹垹顦插銈勭窗鐠?/button><output>${escapeHtml(state.checkpointResult || "")}</output></form>`
    : "";
  return windowFrame("cli", "Fayble CLI", `<div class="terminal-screen cli-status"><span class="document-kicker">閺堫剙婀寸€广垺鍩涚粩?/ 0.9.7</span><h2>Fayble CLI</h2>${lines.map(([key, value]) => `<code>${key}閿?{value}</code>`).join("")}<p>閻ц缍嶉棁鈧憰浣烘畱閸戭厽宓佹稉宥呮躬鏉╂瑩鍣烽妴鍌氱暊閸掑棙鍨氶崙鐘愁唽閸愭瑥婀稉宥呮倱閺夈儲绨柌宀嬬礉鐟曚椒缍橀懛顏勭箒閹甸箖缍堥崥搴㈠閸斻劏绶崗銉ｂ偓鍌欒厬鏉烆剛鐝幒褍鍩楅崣鏉垮涧閸涘﹨鐦旀担鐘冲濞夋洏鈧?/p>${keyForm}${checkpointForm}<button data-app="terminal">閹垫挸绱戠紒鍫㈩伂</button></div>`, { icon: "F" });
}

function renderRelay(state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeRelayRecord = activeRecord
    && recordCarrierApp(activeRecord) === "relay"
    && state.carrierReads?.includes(`relay:${activeRecord.id}`);
  if (activeRelayRecord) {
    const reader = `<section class="relay-record-reader"><header><div><strong>Relay</strong><small>瀹¤璁板綍</small></div><nav><span>姒傝</span><span class="active">浜嬩欢娴?/span><span>鑺傜偣</span><span>璺敱</span></nav><button data-close-carrier-record="relay">脳</button></header>${corpusRecordMarkup(activeRecord, state)}</section>`;
    return windowFrame("relay", "Relay Node 17", reader, { icon: "radio", wide: true });
  }
  return windowFrame("relay", "Relay Node 17 / admin", renderRelayAdmin(state), { icon: "radio", wide: true });
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
  const channelSection = `<section class="relay-admin-card relay-channel-card"><header><div><strong>濞撶娀浜鹃悩鑸碘偓?/strong><span>${vendorRows.length} 娑擃亙绗傚〒姝屽Ν閻?/span></div><button>缁狅紕鎮婂〒鐘讳壕</button></header><table class="relay-admin-table"><thead><tr><th>濞撶娀浜?/th><th>閸╃喎鎮?/th><th>閻樿埖鈧?/th><th>鐠囬攱鐪?/th></tr></thead><tbody>${vendorRows.map(r => `<tr><td>${r.name}</td><td><button class="domain-link" data-open-vendor-domain="${r.domain}">${r.domain}</button></td><td><span class="relay-status status-${r.status}">${r.status}</span></td><td>${r.requests}</td></tr>`).join("")}</tbody></table></section>`;
  const maintainerChannelEntry = contentEntryMarkup("new.maintainer.channel-02", "缂佸瓨濮㈡０鎴︿壕鐎电厧鍤?/ 閹垮秳缍旈懓鍛摟濞堥潧绱撶敮?, "relay-tools 璺?缁狅紕鎮婇崨妯绘）韫?, "relay-console");
  const logSection = `<section class="relay-admin-card relay-log-card"><header><div><strong>閺堚偓鏉╂垼顕Ч鍌欑瑢鐎孤ゎ吀</strong><span>鏉╁洤骞?30 閸掑棝鎸?/span></div><button data-browser-page="forum">閺屻儳婀呰ぐ鎺撱€?/button></header><div class="relay-request-row"><code>02:47:13</code><span>POST /v1/chat/completions</span><b class="status-degraded">retry</b><small>Gamini 璺?4.8s</small></div><div class="relay-request-row"><code>02:43:09</code><span>POST /v1/chat/completions</span><b class="status-review">review</b><small>operator.k2</small></div><div class="source-entry-stack">${maintainerChannelEntry}</div></section>`;
  const activeSection = state.relayAdminSection || "overview";
  const navItems = ["濮掑倽顫?, "濞撶娀浜剧粻锛勬倞", "濞撶娀浜鹃惄鎴炲付", "鐠愶箑褰垮Ч?, "閸掑棛绮?, "API 鐎靛棝鎸?, "閻劑鍣虹紒鐔活吀", "鐎孤ゎ吀閺冦儱绻?, "缁崵绮虹拋鍓х枂"];
  const nav = navItems.map((label, index) => `<button class="${(index === 0 && activeSection === "overview") || (index === 2 && activeSection === "monitor") || (index === 7 && activeSection === "audit") ? "active" : ""}" ${index === 0 ? 'data-relay-admin-section="overview"' : index === 2 ? 'data-relay-admin-section="monitor"' : index === 7 ? 'data-relay-admin-section="audit"' : ""}><span>${["閳?,"閳?,"閳?,"閳?,"閳?,"閳?,"閳?,"閳?,"閳?][index]}</span>${label}</button>`).join("");
  const fields = relayFieldState(state);
  const auditDetail = `<aside class="relay-audit-detail"><header><div><strong>${state.relayAuditSelected}</strong><small>鐠囬攱鐪扮拠锔藉剰</small></div><span class="relay-status status-review">${state.relayInvestigationStarted ? "鏉╁€熼嚋娑? : "瀵板懏顥呴弻?}</span></header><dl><dt>閹恒儱褰?/dt><dd>POST /v1/chat/completions</dd><dt>濞撶娀浜?/dt><dd>Kemy K3</dd><dt>鐠囬攱鐪伴弮鍫曟？</dt><dd>03:17:31</dd><dt>閸濆秴绨查悩鑸碘偓?/dt><dd>200 / relay-cache</dd><dt>瀵倸鐖?/dt><dd>proxy閵嗕狗perator閵嗕辜ag 缂傚搫銇?/dd></dl><section><strong>鐎涙顔岄崶鐐诧綖</strong><div class="relay-field-grid">${Object.entries(fields).map(([key,value]) => `<div><span>${key}</span><code class="${value === "missing" ? "missing" : "known"}">${value}</code></div>`).join("")}</div><small>鐎涙顔屾い鍝勭碍閺夈儴鍤?Kemy 閸ョ偞鏂佺拋鏉跨秿閿涘苯鈧ジ娓堕崷銊ユ倗娑撳鐖堕弶銉︾爱閺嶇顕妴?/small></section><footer><button class="primary-button" data-relay-investigate>${state.relayInvestigationStarted ? "瀹告彃濮為崗銉ㄦ嫹闊? : "閺嶅洩顔囬獮璺虹磻婵鎷烽煪?}</button></footer></aside>`;
  const auditPage = `<div class="relay-audit-page"><section class="relay-audit-toolbar"><div><input value="" placeholder="閹兼粎鍌ㄧ拠閿嬬湴 ID閵嗕焦绗柆鎾村灗濡€崇€?><button>缁涙盯鈧?/button></div><span>鏉╁洤骞?24 鐏忓繑妞?璺?159 閺?/span></section><div class="relay-audit-layout"><section class="relay-audit-list"><header><span>閺冨爼妫?/span><span>鐠囬攱鐪?/ 濞撶娀浜?/span><span>閻樿埖鈧?/span><span>閼版妞?/span></header><button class="relay-audit-row ${state.relayAuditSelected === "R17-KM-31" ? "active" : ""}" data-relay-audit-select="R17-KM-31"><code>03:17:31</code><span><strong>R17-KM-31</strong><small>Kemy K3 璺?/v1/chat/completions</small></span><b class="status-review">鐎涙顔岀紓鍝勩亼</b><small>3.1s</small></button><button class="relay-audit-row ${state.relayAuditSelected === "R17-GM-27" ? "active" : ""}" data-relay-audit-select="R17-GM-27"><code>02:47:13</code><span><strong>R17-GM-27</strong><small>Gamini 璺?/v1/chat/completions</small></span><b class="status-degraded">retry</b><small>4.8s</small></button><button class="relay-audit-row ${state.relayAuditSelected === "R17-GR-44" ? "active" : ""}" data-relay-audit-select="R17-GR-44"><code>02:43:09</code><span><strong>R17-GR-44</strong><small>Groke 璺?/v1/responses</small></span><b class="status-active">200</b><small>1.2s</small></button></section>${auditDetail}</div></div>`;
  const monitorPage = `<div class="relay-monitor-page"><section class="relay-monitor-toolbar"><div><strong>濞撶娀浜鹃惄鎴炲付</strong><small>閺堚偓鏉╂垳绔村▎鈩冨赴闁藉牅绗屾稉濠冪埗閸濆秴绨插Ч鍥ㄢ偓?/small></div><div class="relay-monitor-actions"><button>閸掗攱鏌婇惄鎴炲付</button><button>鐎电厧鍤ぐ鎾冲鐟欏棗娴?/button></div></section><section class="relay-monitor-summary"><article><span>閸︺劎鍤庡〒鐘讳壕</span><strong>4 / 6</strong><small>1 娑擃亪妾风痪?璺?1 娑擃亜缍婂?/small></article><article><span>閻╂垶甯堕幍瑙勵偧</span><strong>RR-0719</strong><small>03:18:02 鐎瑰本鍨?/small></article><article><span>閸忓崬鎮撶€涙顔?/span><strong>continuity</strong><small>鐠?6 娑擃亣濡悙鐟板毉閻?/small></article><article><span>瀵板懏鐗崇€?/span><strong>1</strong><small>Kemy / Groke 鐏忕偓顔屽顔肩磽</small></article></section><section class="relay-monitor-card"><header><div><strong>閺堚偓鏉╂垹娲冮幒褎澹掑▎?/strong><span>閸忣厺閲滄稉濠冪埗濞撶娀浜?璺?閸濆秴绨叉稉搴＄摟濞堥潧浠存惔宄板</span></div><button class="quiet-button">閺屻儳婀呴崢鍡楀蕉閹佃顐?/button></header><div class="relay-channel-cards">${vendorRows.map((row, index) => `<article class="relay-channel-monitor-card"><header><div><span class="channel-dot status-${row.status}"></span><strong>${row.name}</strong><small>${row.domain}</small></div><span class="relay-status status-${row.status}">${row.status}</span></header><dl><div><dt>鐠囬攱鐪?/dt><dd>R17-${["GR-44","GM-27","GL-09","KM-31","DP-18","LN-52"][index]}</dd></div><div><dt>閸濆秴绨?/dt><dd>${["200","retry","200","200","review","archived"][index]}</dd></div><div><dt>鐎涙顔?/dt><dd>${index === 3 ? "operator / tag 缂傚搫銇? : index === 0 ? "tag=0317" : "continuity"}</dd></div></dl></article>`).join("")}</div><section class="relay-monitor-reconciliation"><div><strong>RR-0719 璺?閸忣叀濡悙鐟邦嚠鐠?/strong><span>閸忣厽娼拠閿嬬湴閸忓彉闊?`continuity`閿涙悲emy 鐞涘奔绗?Groke raw 濞翠礁鐡ㄩ崷銊︽汞濞堥潧妯婂鍌樷偓鍌氼嚠鐠愶附娼靛┃鎰嚒閹稿倹甯撮崚鏉挎倗濞撶娀浜鹃惄鎴炲付閸椔扳偓?/span></div><button class="quiet-button" data-relay-monitor-detail>鐏炴洖绱戠€电澶勭拠锔藉剰</button></section>${state.relayMonitorDetailOpen ? `<section class="relay-monitor-detail"><header><strong>鐎涙顔岄崗宕囬兇 / 閺夈儲绨憰鍡欐磰</strong><button class="quiet-button" data-relay-monitor-detail>閺€鎯版崳</button></header><div class="relay-monitor-detail-grid"><div><span>閸忓崬鎮撶€涙顔?/span><code>continuity</code><small>閸忣叀濡悙鐟版綆閸戣櫣骞囬敍灞肩返鎼存柨鏅?schema 閺堫亜锛愰弰?owner</small></div><div><span>閸愯尙鐛婄€涙顔?/span><code>operator / tag</code><small>Kemy 閸ョ偞鏂佹穱婵堟殌妞ゅ搫绨敍瀛弐oke raw 濞翠椒绻氶悾?0317 鐏忕偓顔?/small></div><div><span>娑撳绔村?/span><code>閸ョ偛鍩岄崢鐔烘晸鐎广垺鍩涚粩?/code><small>閸忚渹缍嬬拠浣瑰祦娴犲秹娓堕崷?Kemy閵嗕笩roke 娑撳骸鍙曢崗鍙樼波鎼存挷鑵戦崚鍡楀焼閺嶇顕?/small></div></div></section>` : ""}</section></div>`;
  const overview = `<div class="relay-admin-content"><section class="relay-metrics"><article><span>娴犲﹥妫╃拠閿嬬湴</span><strong>${totalRequests}</strong><small>鏉堝啯妲伴弮?+12.4%</small></article><article><span>濞叉槒绌〒鐘讳壕</span><strong>4 / 6</strong><small>1 娑擃亪妾风痪褝绱? 娑擃亜缍婂?/small></article><article><span>瀵倸鐖堕悳?/span><strong>2.7%</strong><small>3 閺夆€崇窡鐎孤ゎ吀</small></article><article><span>Token 閻劑鍣?/span><strong>1.84M</strong><small>妫版繂瀹虫担璺ㄦ暏 63%</small></article></section><section class="relay-admin-grid"><article class="relay-admin-card relay-usage-card"><header><div><strong>Token 娴ｈ法鏁ょ搾瀣◢</strong><span>閺堚偓鏉?24 鐏忓繑妞?/span></div><button>24 鐏忓繑妞傞埍?/button></header><div class="relay-trend" aria-label="Token 娴ｈ法鏁ょ搾瀣◢閸?><span style="height:28%"></span><span style="height:42%"></span><span style="height:36%"></span><span style="height:61%"></span><span style="height:48%"></span><span style="height:76%"></span><span style="height:68%"></span><span style="height:88%"></span><span style="height:71%"></span><span style="height:55%"></span><span style="height:64%"></span><span style="height:79%"></span></div><div class="relay-chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>閻滄澘婀?/span></div></article><article class="relay-admin-card relay-pool-card"><header><div><strong>鐠愶箑褰垮Ч?/strong><span>鏉╂劘顢戦悩鑸碘偓?/span></div><button>閺屻儳婀呴崗銊╁劥</button></header><dl><dt><span class="status-active"></span>閸欘垳鏁ょ拹锕€褰?/dt><dd>23</dd><dt><span class="status-degraded"></span>閸愬嘲宓堟稉?/dt><dd>4</dd><dt><span class="status-review"></span>瀵板懏顥呴弻?/dt><dd>2</dd></dl></article>${channelSection}${logSection}</section></div>`;
  return `<div class="relay-admin-page"><aside class="relay-admin-sidebar"><div class="relay-admin-brand"><span>R</span><div><strong>Relay</strong><small>缁狅紕鎮婇幒褍鍩楅崣?/small></div></div><nav>${nav}</nav><footer><span class="relay-operator">K2</span><div><strong>room17</strong><small>缁崵绮虹粻锛勬倞閸?/small></div><button>閳?/button></footer></aside><main class="relay-admin-main"><header class="relay-admin-topbar"><div><h2>${activeSection === "audit" ? "鐎孤ゎ吀閺冦儱绻? : activeSection === "monitor" ? "濞撶娀浜鹃惄鎴炲付" : "濮掑倽顫?}</h2><small>Relay Node 17 / production</small></div><div><span class="relay-health-dot"></span>閺堝秴濮熸潻鎰攽娑?button>闁氨鐓?/button></div></header>${activeSection === "audit" ? auditPage : activeSection === "monitor" ? monitorPage : overview}</main></div>`;
}

function renderGaminiWs(state) {
  if (!state.importedClients?.includes("gamini-ws")) return windowFrame("gamini-ws", "Gamini 瀹搞儰缍旂粚娲？", builtInClientPage("gamini-ws", state), { wide: true });
  const GAMINI_IDS = ["legacy.gamini.protocol","legacy.gamini.chatlog","legacy.gamini.employee-sop"];
  const active = state.activeContentId;
  const isChat = active === "legacy.gamini.chatlog";
  const reader = active && GAMINI_IDS.includes(active) && corpusBodies.has(active)
    ? `${isChat ? '<div class="gamini-chat-toolbar"><div><strong>瀹告彃浠犻悽銊ょ窗鐠?/strong><small>GMN-7749-X-992 璺?閸欘亣顕扮€电厧鍤?/small></div><span>瀹稿弶鏁归弫?/span></div>' : ""}${corpusRuntimeMarkup(active, state)}${isChat ? '<div class="gamini-readonly-composer"><button aria-label="濞ｈ濮為梽鍕" disabled>閿?/button><div>濮濄倓绱扮拠婵嗗嚒閸嬫粎鏁ら敍灞炬￥濞夋洖褰傞柅浣圭Х閹?/div><button disabled>閸欐垿鈧?/button></div>' : ""}`
    : `<div class="gamini-welcome"><div class="gamini-logo-area">${iconMarkup("gamini")}<strong>Gamini 瀹搞儰缍旂粚娲？</strong><small>Gogle 璺?瀹稿弶浠径宥嗘殶閹?/small></div><p class="empty-state">娴犲骸涔忔笟褔鈧瀚ㄩ弬鍥ㄣ€傞幋鏍︾窗鐠囨繆顔囪ぐ鏇樷偓?/p></div>`;
  const navItems = [
    { id: "legacy.gamini.protocol", label: "閺堝秴濮熼崡蹇氼唴閸樺棗褰?, meta: "2025.Q3", icon: "棣冩憪" },
    { id: "legacy.gamini.chatlog", label: "瀹告彃浠犻悽銊ょ窗鐠?, meta: "鐎电厧鍤崜顖涙拱", icon: "棣冩尠" },
    { id: "legacy.gamini.employee-sop", label: "Northline 閸忓彉闊╅弬鍥ㄣ€?, meta: "閸愬懘鍎存潻鎰儉", icon: "棣冩惃" }
  ];
  const nav = navItems.map(item => {
    const read = state.contentReads.includes(item.id);
    const isActive = active === item.id;
    const unlocked = contentIsUnlocked(contentRecord(item.id), state);
    if (!unlocked) return "";
    return `<button class="gamini-nav-item ${isActive ? "active" : ""} ${read ? "read" : ""}" data-content-entry="${escapeHtml(item.id)}">
      <span class="nav-icon">${item.icon}</span>
      <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.meta)}</small></span>
      ${read ? "<b>閴?/b>" : ""}
    </button>`;
  }).filter(Boolean).join("") + generatedEntriesFor("gamini-ws","gamini");
  const sidebar = `<aside class="gamini-sidebar">
    <div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 瀹搞儰缍旂粚娲？</strong><span class="status-dot degraded">degraded</span></div>
    <nav class="gamini-nav"><div class="gamini-nav-section"><span class="nav-section-label">娴兼俺鐦?&amp; 閺傚洦銆?/span>${nav}</div></nav>
  </aside>`;
  return windowFrame("gamini-ws", "Gamini 瀹搞儰缍旂粚娲？", `<div class="split-layout gamini-ws-shell">${sidebar}<section class="gamini-reader">${reader}</section></div>`, { wide: true });
}

function renderChengzhen(state) {
  if (!state.importedClients?.includes("chengzhen")) return windowFrame("chengzhen", "濠㈠嫬鎶氶崡蹇庣稊", clientImportScreen("chengzhen"), { wide: true });
  const CZIDS = ["new.employee.minutes-01","new.employee.minutes-02","new.employee.incident-03","new.employee.routing-04","new.maintainer.incident-03","new.glem.support-case"];
  const active = state.activeContentId;
  const reader = active && CZIDS.includes(active) && corpusBodies.has(active)
    ? corpusRuntimeMarkup(active, state)
    : `<div class="cz-welcome"><div class="cz-logo">${iconMarkup("chengzhen")}<strong>濠㈠嫬鎶氶崡蹇庣稊</strong></div><p class="empty-state">娴犲骸涔忔笟褔鈧瀚ㄦ导姘愁唴閹存牗绉烽幁顖滃殠缁嬪鈧?/p></div>`;

  // Meetings section
  const meetings = [
    { id: "new.employee.minutes-01", label: "閸涖劌娲撶喊棰佺娑撳绺肩粔鏄忋€?, meta: "7閺?閺?14:00", tag: "娴兼俺顔?, icon: "棣冩惍" },
    { id: "new.employee.minutes-02", label: "鏉╀胶些娴兼俺顔?/ 娣囶喛顓归悧?, meta: "7閺?閺?, tag: "娴兼俺顔?, icon: "棣冩惍" }
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
    { id: "new.employee.incident-03", label: "娴滃鏅犳径宥囨磸 / HR 瀵扳偓閺?, meta: "闂勬劕鐣?, tag: "濞戝牊浼?, icon: "閳? },
    { id: "new.employee.routing-04", label: "妫板嫮鐣荤捄顖滄暠瀹搞儱宕?, meta: "閹存劖婀版慨鏂挎喅娴?, tag: "濞戝牊浼?, icon: "棣冩尠" },
    { id: "new.maintainer.incident-03", label: "build incident BR-204", meta: "relay-tools", tag: "閺傚洣娆?, icon: "棣冩暋" },
    { id: "new.glem.support-case", label: "Glem 娴间椒绗熼弨顖涘瘮瀹搞儱宕?, meta: "婢舵牠鍎撮幒銉ュ弳", tag: "濞戝牊浼?, icon: "棣冨缚" }
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
    <div class="app-toolbar">${iconMarkup("chengzhen")}<strong>濠㈠嫬鎶氶崡蹇庣稊</strong><small>Northline 缁屾椽妫?/small></div>
    <div class="cz-section"><span class="nav-section-label">娴兼俺顔?(${["new.employee.minutes-01","new.employee.minutes-02"].filter(id=>contentIsUnlocked(contentRecord(id),state)).length})</span>${meetings || "<div class=\"empty-state\">閺嗗倹妫ゆ导姘愁唴</div>"}</div>
    <div class="cz-section"><span class="nav-section-label">濞戝牊浼?&amp; 閺傚洣娆?/span>${msgs || "<div class=\"empty-state\">閺嗗倹妫ゅ☉鍫熶紖</div>"}</div>
  </aside>`;
  return windowFrame("chengzhen", "濠㈠嫬鎶氶崡蹇庣稊", `<div class="split-layout chengzhen-shell">${sidebar}<section class="chengzhen-reader">${reader}</section></div>`, { wide: true });
}

function renderYunzhen(state) {
  if (!state.importedClients?.includes("yunzhen")) return windowFrame("yunzhen", "娴滄垹顑?, clientImportScreen("yunzhen"), { wide: true });
  const YZIDS = ["new.writer.draft-01","new.writer.session-02","new.writer.version-03","new.writer.submission-04"];
  const active = state.activeContentId;
  const reader = active && YZIDS.includes(active) && corpusBodies.has(active)
    ? corpusRuntimeMarkup(active, state)
    : `<div class="yz-welcome"><div class="yz-logo">${iconMarkup("yunzhen")}<strong>娴滄垹顑?/strong></div><p class="empty-state">闁瀚ㄦ稉鈧禒鑺ユ瀮缁嬫寧鍨ㄦ导姘崇樈鐠佹澘缍嶉妴?/p></div>`;

  const docs = [
    { id: "new.writer.draft-01", label: "閵嗗﹤瀵冲畝鍛婄梾閺堝鎸撻妴瀣儑娴滃苯宕勬稉鈧粩?, meta: "03:17 璺?閼奉亜濮╂穱婵嗙摠婢惰精瑙?, tag: "閼藉顭?, icon: "棣冩憫", badge: "unsaved" },
    { id: "new.writer.session-02", label: "閸愭瑤缍旀导姘崇樈 02 / LLM 閸楀繋缍?, meta: "娴兼俺鐦界拋鏉跨秿", tag: "娴兼俺鐦?, icon: "棣冾樆", badge: "" },
    { id: "new.writer.version-03", label: "閻楀牊婀伴崢鍡楀蕉 03", meta: "voices=1 璺?娴ｆ粏鈧懍绗夐弰?, tag: "閻楀牊婀?, icon: "棣冩櫜", badge: "warning" },
    { id: "new.writer.submission-04", label: "閹舵洜顭?/ 閻㈠疇鐦旈崜顖涙拱", meta: "瀹稿弶褰佹禍?璺?鐞氼偊鈹忛崶?, tag: "閹舵洜顭?, icon: "棣冩懄", badge: "rejected" }
  ].filter(d => contentIsUnlocked(contentRecord(d.id), state)).map(d => {
    const read = state.contentReads.includes(d.id);
    const isActive = active === d.id;
    return `<button class="yz-doc-row ${isActive?"active":""} ${read?"read":""} ${d.badge?"badge-"+d.badge:""}" data-content-entry="${escapeHtml(d.id)}">
      <span class="yz-doc-icon">${d.icon}</span>
      <span class="yz-doc-label"><strong>${escapeHtml(d.label)}</strong><small>${escapeHtml(d.meta)}</small></span>
      <span class="yz-doc-tag">${d.tag}</span>
    </button>`;
  }).join("") + generatedEntriesFor("yunzhen","yunzhen");

  const statusBar = `<div class="yz-status-bar"><span>${iconMarkup("yunzhen")} 娴滄垹顑?/span><span class="yz-user">闂嗐劍鐖鹃惃鍕敄闂?/span><span class="yz-sync-err">娴滄垹顏崥灞绢劄閿涙艾銇戠拹?/span></div>`;
  const sidebar = `<aside class="yunzhen-sidebar">
    <div class="app-toolbar">${iconMarkup("yunzhen")}<strong>娴滄垹顑?/strong><small>闂嗐劍鐖鹃惃鍕敄闂?/small></div>
    <div class="yz-section"><span class="nav-section-label">閹存垹娈戦弬鍥╊焾</span>${docs || "<div class=\"empty-state\">閺嗗倹妫ら弬鍥╊焾</div>"}</div>
  </aside>`;
  return windowFrame("yunzhen", "娴滄垹顑?, `<div class="split-layout yunzhen-shell">${sidebar}<section class="yunzhen-reader">${statusBar}${reader}</section></div>`, { wide: true });
}

function renderGrokeFeed(state) {
  if (!state.importedClients?.includes("groke-feed")) return windowFrame("groke-feed", "Groke Feed", builtInClientPage("groke-feed", state), { wide: true });
  const GKIDS = ["new.groke.public-portal","new.groke.policy","new.groke.moderation-sop","new.groke.editorial-appeal","new.groke.raw-public-repository","new.groke.social-complaints"];
  const active = state.activeContentId;
  const pages = [
    ["new.groke.public-portal", "妫ｆ牠銆?, "閳?],
    ["new.groke.social-complaints", "缁€鎯у隘", "#"],
    ["new.groke.editorial-appeal", "閺€顖涘瘮", "?"],
    ["new.groke.policy", "娣団€叉崲娑撳骸鐣ㄩ崗?, "閳?],
    ["new.groke.moderation-sop", "鐎光剝鐗抽梼鐔峰灙", "閳?]
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
    : `<section class="groke-empty-feed"><strong>娴ｇ姷娈戦弮鍫曟？缁惧灝鍑＄紒蹇曟箙鐎?/strong><span>閸忚櫕鏁為弴鏉戭樋鐠愶箑褰块崥搴礉閺傛澘鍞寸€归€涚窗閺勫墽銇氶崷銊ㄧ箹闁?/span></section>`;
  const nav = pages.map(([id, label, icon]) => `<button class="${selected === id ? "active" : ""}" data-content-entry="${id}"><b>${icon}</b><span>${label}</span></button>`).join("");
  const sidebar = `<aside class="groke-nav"><div class="groke-brand">${iconMarkup("groke")}<strong>Groke</strong></div><nav>${nav}<button><b>閳?/b><span>闁氨鐓?/span><i>3</i></button><button><b>閳?/b><span>閺€鎯版</span></button></nav><button class="groke-post-button">閸欐垵绔?/button><footer><span>R</span><div><strong>room17</strong><small>@room17_local</small></div><b>璺矾璺?/b></footer></aside>`;
  const right = `<aside class="groke-aside"><div class="groke-search">閳?閹兼粎鍌?Groke</div><section><strong>濮濓絽婀崣鎴犳晸</strong><small>閹垛偓閺?璺?閻戭參妫?/small><b>閻╁瓨甯存禍銈勭帛 4.2</b><span>1,204 閺夆€崇瑯鐎?/span><small>閸掓稐缍?璺?鐠併劏顔戞稉?/small><b>raw 娑?public</b><span>63 閺夛繝鍣稿楦款嚞濮?/span></section><section><strong>閹恒劏宕橀崗铏暈</strong><p><span class="groke-mini-avatar">E</span><b>Exai 閺€顖涘瘮<small>@exai_support</small></b><button>閸忚櫕鏁?/button></p><p><span class="groke-mini-avatar">鐎?/span><b>鐎瑰娼ら崘娆庣稊<small>@quiet_writer</small></b><button>閸忚櫕鏁?/button></p></section><footer>閺堝秴濮熼弶鈩冾儥閵嗏偓闂呮劗顫嗛弨璺ㄧ摜閵嗏偓鐢喖濮稉顓炵妇<br>婕?2026 Exai</footer></aside>`;
  const topTitle = ({ feed: "妫ｆ牠銆?, thread: "鐢牕鐡?, support: "閺€顖涘瘮瀹搞儱宕?, trust: "娣団€叉崲娑撳骸鐣ㄩ崗?, moderation: "鐎光剝鐗抽梼鐔峰灙", developer: "瀵偓閸欐垼鈧? })[mode];
  return windowFrame("groke-feed", "Groke", `<div class="groke-app-shell">${sidebar}<main class="groke-main"><header><strong>${topTitle}</strong><span>閳?/span></header>${content}</main>${right}</div>`, { wide: true });
}

function renderGlemMemory(state) {
  if (!state.importedClients?.includes("glem-memory")) return windowFrame("glem-memory", "Glem Memory", clientImportScreen("glem-memory"), { wide: true });
  const items = [
    ["new.glem.retention-policy", "閺勬崘鎲查幀褌绻氶悾娆庣瑢鐠佹澘绻傜拋鍧楁６", "閺€璺ㄧ摜"],
    ["new.glem.support-case", "閺嶆牗藟鐠佹崘顓?璺?Case G-771", "閺€顖涘瘮"], ["new.glem.news-and-complaints", "瑜版挸顦查惄妯轰紣閸忓嘲褰х拋棰佺秶閺堚偓缁喓娈戞稉鈧径?, "鐠嬪啯鐓?]
  ].filter(([id]) => contentIsUnlocked(contentRecord(id), state));
  const home = state.activeContentId === "new.glem.public-portal" || !items.some(([id]) => id === state.activeContentId);
  const active = home ? "new.glem.public-portal" : state.activeContentId;
  const nav = items.map(([id, title, tag]) => `<button class="${active === id ? "active" : ""}" data-content-entry="${id}"><span>${tag}</span><strong>${title}</strong><small>${state.contentReads.includes(id) ? "瀹歌尪顔栭梻? : "閻儴鐦戠粚娲？"}</small></button>`).join("");
  const content = home
    ? `<div class="glem-dashboard"><section class="glem-dashboard-hero"><span>Glem 5.2</span><h2>閹跺﹥鏁為幇蹇撳閻ｆ瑧绮伴惇鐔割劀闁插秷顩﹂惃鍕劥閸?/h2><p>閸︺劍鏋冨锝冣偓渚€銆嶉惄顔兼嫲閸ャ垽妲︾拋鏉跨箓娑擃厽鐓￠幍楣冪彯閺勬崘鎲查幀褌淇婇幁顖ょ礉閸氬本妞傛穱婵堟殌閺夈儲绨崪灞炬闂傛番鈧?/p><div class="glem-dashboard-search">閳辨洏鈧偓閹兼粎鍌?room17 閻ㄥ嫮鐓＄拠鍡欌敄闂?/div></section><section class="glem-dashboard-grid"><article><small>瀹歌尪绻涢幒?/small><strong>4 娑擃亝娼靛┃?/strong><p>閹垹顦查崘鍛啇瀹告彃缂撶粩瀣偍瀵?/p></article><article><small>瑜版挸澧犵拋鏉跨箓</small><strong>妤傛ɑ妯夐拋妤佲偓?/strong><p>娴滃鏅犻妴浣哄閺夌喍绗岄張顏勭暚閹存劒绨ㄦい?/p></article><article><small>閺堚偓鏉╂垶娲块弬?/small><strong>8閺?閺?/strong><p>閺嶆牗藟鐠佹崘顓搁弨顖涘瘮濡楀牅绶?/p></article></section><section class="glem-dashboard-document"><header><strong>Glem 5.2 閼宠棄濮忓鍌濐潔</strong><small>娴溠冩惂娑撳骸浼愭担婊勬煙瀵?/small></header>${corpusRuntimeMarkup("new.glem.public-portal", state)}</section></div>`
    : `<div class="glem-native-content">${corpusRuntimeMarkup(active, state)}</div>`;
  return windowFrame("glem-memory", "Glem Memory", `<div class="glem-app-shell"><aside class="glem-sidebar"><header>${iconMarkup("glem")}<div><strong>Glem</strong><small>娴间椒绗熼惌銉ㄧ槕</small></div></header><div class="glem-search">閳?閹兼粎鍌ㄩ惌銉ㄧ槕缁屾椽妫?/div><nav><button class="glem-home ${home ? "active" : ""}" data-content-entry="new.glem.public-portal">閳伙负鈧偓瀹搞儰缍旈崣?/button><button>閳煎洢鈧偓鐠佹澘绻傛惔?/button><button>閳藉棎鈧偓瀹歌弓绻氱€?/button></nav><section><span>room17 / 閹垹顦茬粚娲？</span>${nav}</section><footer><span>R</span><div><strong>room17</strong><small>閺堫剙婀寸粻锛勬倞閸?/small></div></footer></aside><main class="glem-main"><header><div><strong>${home ? "瀹搞儰缍旈崣? : "閻儴鐦戠拠锔藉剰"}</strong><small>room17 / recovered</small></div><button>${home ? "閺傛澘缂撶粚娲？" : "閸掑棔闊?}</button><button>閳?/button></header>${content}</main><aside class="glem-inspector"><header>鐠佹澘绻傞悩鑸碘偓?/header><dl><dt>鐠佸潡妫剁痪褍鍩?/dt><dd>瀹搞儰缍旈崠?/dd><dt>閺勬崘鎲查幀?/dt><dd class="glem-hot">妤?/dd><dt>娣囨繂鐡ㄩ懠鍐ㄦ纯</dt><dd>瑜版挸澧犳い鍦窗</dd><dt>閺夈儲绨?/dt><dd>4 娑擃亣顔囪ぐ?/dd></dl><section><strong>閻╃鍙ч崘鍛啇</strong><p>娴滃鏅犳径宥囨磸娑撳孩顒滈崥鎴犲濞?/p><p>娣囨繂鐡ㄩ張鐔虹摜閻?RP-5</p><p>閸ャ垽妲︾拋鏉跨箓閹垹顦茬拠閿嬬湴</p></section></aside></div>`, { wide: true });
}

function renderKemySpace(state) {
  if (!state.importedClients?.includes("kemy-space")) return windowFrame("kemy-space", "Kemy Space", clientImportScreen("kemy-space"), { wide: true });
  const items = [
    ["new.kemy.public-portal", "Kemy K3 妞ゅ湱娲扮拠瀛樻", "濮掑倽顫?], ["new.kemy.context-policy", "閸忋劑鍣烘稉濠佺瑓閺傚洣绗岄崶鐐存杹", "鐟欏嫬鍨?], ["new.kemy.replay-audit", "妞ゅ湱娲伴崗澶嬬垼閺冪姵纭舵潻娑樺弳瑜版挸銇?, "鐎孤ゎ吀"],
    ["new.kemy.writer-community", "閸栨鍝洪崘娆庣稊妞ゅ湱娲?璺?缁€鎯у隘鐠佹澘缍?, "鐠併劏顔?], ["new.kemy.cloud-migration-case", "閸栨鍝洪崘娆庣稊缂?璺?鏉╀胶些瀹搞儱宕?, "娴滄垹顏?]
  ].filter(([id]) => contentIsUnlocked(contentRecord(id), state));
  const active = items.some(([id]) => id === state.activeContentId) ? state.activeContentId : items[0]?.[0];
  const nav = items.map(([id, title, tag], index) => `<button class="${active === id ? "active" : ""}" data-content-entry="${id}"><i>${index + 1}</i><span><strong>${title}</strong><small>${tag} 璺?${state.contentReads.includes(id) ? "瀹告彃娲栭弨? : "瑜版挸澧犳稉濠佺瑓閺?}</small></span></button>`).join("");
  const content = active ? corpusRuntimeMarkup(active, state) : `<div class="kemy-empty">闁瀚ㄦ稉鈧稉顏堛€嶉惄顔炬埛缂?/div>`;
  return windowFrame("kemy-space", "Kemy Space", `<div class="kemy-app-shell"><aside class="kemy-sidebar"><header>${iconMarkup("kemy")}<strong>Kemy</strong><button>閿?/button></header><nav><button class="active">閳伙负鈧偓妞ゅ湱娲?/button><button>閳兼灚鈧偓閺堚偓鏉?/button><button>閳狙佲偓鈧崗鍙橀煩缂佹瑦鍨?/button></nav><section><span>閸栨鍝?/ 閹垹顦叉い鍦窗</span>${nav}</section><footer><span>R</span><div><strong>room17</strong><small>娑擃亙姹夌粚娲？</small></div></footer></aside><main class="kemy-main"><header><div><strong>閸栨鍝洪崘娆庣稊妞ゅ湱娲?/strong><small>閹碘偓閺堝绗傛稉瀣瀮 璺?閼奉亜濮╂穱婵嗙摠</small></div><button>閸忓彉闊?/button><button>閳?/button></header><div class="kemy-native-content">${content}</div><footer class="kemy-composer"><button>閿?/button><span>缂佈呯敾瑜版挸澧犳い鍦窗閻ㄥ嫬顕拠婵冣偓?/span><button>閸欐垿鈧?/button></footer></main><aside class="kemy-context"><header><strong>娑撳﹣绗呴弬?/strong><span>100%</span></header><div class="kemy-meter"><i></i></div><section><strong>瑜版挸澧犵仦?/strong><p>妞ゅ湱娲伴弬鍥︽ <b>12</b></p><p>閸樺棗褰剁€电鐦?<b>48</b></p><p>閸ョ偞鏂侀悧鍥唽 <b>31</b></p></section><section class="kemy-timeline"><strong>閸ョ偞鏂佸〒鍛婄垼</strong><input type="range" min="0" max="100" value="100" disabled><small>閻滄澘婀?璺?鐎瑰本鏆ｆい鍦窗</small></section></aside></div>`, { wide: true });
}

function renderRepoMirror(state) {
  if (!state.importedClients?.includes("repo-mirror")) return windowFrame("repo-mirror", "闂€婊冨剼娴犳挸绨?, clientImportScreen("repo-mirror"), { wide: true });
  const RMIDS = ["legacy.github.issue-4471","new.groke.raw-public-repository","new.glem.repository","new.kemy.timeline-repository","new.lunet.budget-repository","new.fayble.compatibility-repository"];
  const active = state.activeContentId;
  const repositories = [
    { id: "legacy.github.issue-4471", org: "northline-labs", repo: "session-fixtures", number: 4471, type: "Issue", state: "Open", label: "fallback reviewer state 閸愭瑥娲?session" },
    { id: "new.groke.raw-public-repository", org: "exai", repo: "direct-render", number: 611, type: "Issue", state: "Closed", label: "public 濞撳弶鐓嬮崥?boundary 鐎涙顔屾担宥囩枂娑撱垹銇? },
    { id: "new.glem.repository", org: "zhiru", repo: "sparse-memory", number: 2058, type: "Pull request", state: "Open", label: "閸忎浇顔忓锝呮倻閻楀洦顔岄崣鍌欑瑢娴滃鏅犻幗妯款洣" },
    { id: "new.kemy.timeline-repository", org: "muunshot", repo: "context-timeline", number: 3190, type: "Issue", state: "Closed", label: "duplicate blocks 娑?present flags" },
    { id: "new.lunet.budget-repository", org: "lunet-ai", repo: "decision-budget", number: 18442, type: "Issue", state: "Closed", label: "閹俱倕娲栭崝銊ょ稊鐞氼偉顓告稉娲彯閹存劖婀版禒璇插" },
    { id: "new.fayble.compatibility-repository", org: "fayble", repo: "compatibility-layer", number: 5031, type: "Pull request", state: "Open", label: "缁夊娅庣€涙ɑ銆傜憴鎺曞鐎电懓缍嬮崜宥嗘惙娴ｆ粏鈧懐娈戠紒褎澹? }
  ].filter(item => contentIsUnlocked(contentRecord(item.id), state));
  const selected = repositories.find(item => item.id === active);
  const globalHeader = `<header class="github-global"><button class="github-mark" data-github-home aria-label="GitHub 妫ｆ牠銆?>${iconMarkup("github")}</button><button>閳?/button><div class="github-global-search">閳辨洏鈧偓Search or jump to閳?/div><nav><button>閿?/button><button>Issues</button><button>Pull requests</button><button>Notifications</button><span>R</span></nav></header>`;
  const repoHeader = selected ? `<section class="github-repo-head"><div><a>${selected.org}</a><span>/</span><strong>${selected.repo}</strong><b>Public</b></div><nav><button>Code</button><button class="${selected.type === "Issue" ? "active" : ""}">Issues</button><button class="${selected.type === "Pull request" ? "active" : ""}">Pull requests</button><button>Actions</button><button>Projects</button><button>Security</button><button>Insights</button></nav></section>` : "";
  const body = selected
    ? `<main class="github-item-page"><section class="github-item-main"><header><h1>${escapeHtml(selected.label)} <span>#${selected.number}</span></h1><p><b class="github-state ${selected.state.toLowerCase()}">${selected.state === "Open" ? "閳?Open" : "閴?Closed"}</b> ${escapeHtml(selected.org)} opened this ${selected.type.toLowerCase()} 璺?${state.contentReads.includes(selected.id) ? "viewed" : "unread"}</p></header><div class="github-native-content">${corpusRuntimeMarkup(selected.id, state)}</div></section><aside><section><strong>Assignees</strong><p>room17</p></section><section><strong>Labels</strong><p><span class="github-label">runtime</span> <span class="github-label blue">provenance</span></p></section><section><strong>Projects</strong><p>Public model ecosystem</p></section><section><strong>Development</strong><p>${selected.type === "Pull request" ? "Checks and changed files" : "No branches linked"}</p></section></aside></main>`
    : `<main class="github-dashboard"><section><h2>Home</h2><div class="github-feed">${repositories.map(item => `<article><span class="github-event-icon">${item.type === "Issue" ? "閳? : "閳?}</span><div><p><b>${item.org}</b> updated <a>${item.org}/${item.repo}</a></p><button data-content-entry="${item.id}"><strong>${item.label}</strong><small>${item.type} #${item.number} 璺?${item.state}</small></button></div></article>`).join("")}</div></section><aside><h3>Explore repositories</h3>${repositories.map(item => `<button data-content-entry="${item.id}"><b>${item.org}/${item.repo}</b><small>Public 璺?${item.type} #${item.number}</small></button>`).join("")}</aside></main>`;
  return windowFrame("repo-mirror", "GitHub", `<div class="github-app-shell">${globalHeader}${repoHeader}${body}</div>`, { wide: true });
}

function renderJournal(state) {
  const notes = state.caseNotes.map(note => `<article class="case-note"><blockquote>${escapeHtml(note.quote)}</blockquote><dl><dt>閺夈儲绨?/dt><dd>${escapeHtml(note.sourceApp)}</dd><dt>娴ｅ秶鐤?/dt><dd>${escapeHtml(note.sourceRef)}</dd><dt>娣囨繂鐡ㄩ弮鍫曟？</dt><dd>${escapeHtml(note.savedAt)}</dd></dl><button data-open-source="${escapeHtml(note.appId || "mail")}">鏉╂柨娲栭弶銉︾爱</button></article>`).join("");
  return windowFrame("journal", "缁楁棁顔囬張?, `<div class="journal-page raw-notes"><header><div><span class="document-kicker">閹存垹娈戠粭鏃囶唶 / 閼奉亜濮╃拋鏉跨秿</span><h2>${state.caseNotes.length} 閺夆€冲斧閸?/h2></div><select id="hintLevel"><option value="investigation" ${state.hintLevel === "investigation" ? "selected" : ""}>鐠嬪啯鐓?/option><option value="immersive" ${state.hintLevel === "immersive" ? "selected" : ""}>濞屽韫?/option><option value="plot" ${state.hintLevel === "plot" ? "selected" : ""}>閸撗勫剰</option></select></header><section class="case-note-grid">${notes || `<div class="empty-state">閹垫挸绱戞稉鈧径鍕降濠ф劕鎮楅敍宀勩€夐棃顫瑐閻ㄥ嫬鍙ч柨顔煎斧閸欍儰绱伴懛顏勫З鐠佹澘鍩屾潻娆撳櫡閵?/div>`}</section></div>`, { icon: "閳?, wide: true });
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
    title: `閹存垳绻氱€涙娈戝鏇犳暏 / ${CASE_NOTE_LABELS[note.id] || note.id}`,
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
  if (selected.length < 2) return { ok: false, selected, missingCategories: rule.categories, error: `閼峰啿鐨柅澶嬪娑撱倓閲滈悪顒傜彌閺夈儲绨敍娑氬繁鐏忔垶娼靛┃鎰閸掝偓绱?{rule.hint}閵嗕繖 };
  if (relation !== rule.relation) return { ok: false, selected, missingCategories: [], error: `閸忓磭閮存稉宥呭爱闁板稄绱拌ぐ鎾冲鐏炲倿娓剁憰浣测偓?{FAYBLE_RELATIONS[rule.relation]}閳ユ縿鈧繖 };
  if (new Set(selected.map(item => item.sourceKey)).size < 2) return { ok: false, selected, missingCategories: [], error: "閺夈儲绨稉宥堝喕閿涙碍澧嶉柅澶婄穿閻劍娼甸懛顏勬倱娑撯偓閺夈儲绨敍宀勬付閸旂姴鍙嗛崣锔跨娴犵晫瀚粩瀣唶瑜版洏鈧? };
  const categories = new Set(selected.map(item => item.category));
  const missingCategories = rule.categories.filter(category => !categories.has(category));
  if (missingCategories.length) return { ok: false, selected, missingCategories, error: `缂傚搫鐨弶銉︾爱缁鍩嗛敍?{rule.hint}閵嗕繖 };
  return { ok: true, selected, missingCategories: [] };
}

function renderFayble(state) {
  const messages = [{ who: "assistant", text: OFFLINE_REPLIES[0], level: 0 }, ...state.chat];
  const trusted = Boolean(state.npcTrustGranted);
  const rule = trusted ? null : FAYBLE_AUTH_RULES[state.revealLevel];
  const citations = faybleCitationCatalog(state);
  const grouped = citations.map(item => `<label class="fayble-citation-option"><input type="checkbox" name="faybleCitation" value="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)} 璺?${escapeHtml(FAYBLE_CATEGORY_LABELS[item.category] || "濡楋絾顢?)}</small></span></label>`).join("");
  const picker = rule ? `<section class="fayble-authorization"><header><strong>閺夈儲绨幒鍫熸綀 / ${escapeHtml(rule.hint)}</strong><span>閼峰啿鐨稉銈勫敜閻欘剛鐝涚拋鏉跨秿</span></header><div class="fayble-citations">${grouped || `<div class="empty-state">瑜版挸澧犲▽鈩冩箒瀹歌尙鈥樼拋銈嗘降濠ф劑鈧?/div>`}</div><label class="fayble-relation">閸忓磭閮?select id="faybleRelation">${Object.entries(FAYBLE_RELATIONS).map(([value, label]) => `<option value="${value}" ${value === rule.relation ? "selected" : ""}>${label}</option>`).join("")}</select></label><p class="fayble-authorization-error" id="faybleAuthorizationError">${escapeHtml(state.faybleAuthorizationError || `瑜版挸澧犵仦鍌炴付鐟曚緤绱?{rule.hint}閵嗕繖)}</p></section>` : trusted ? `<p class="fayble-authorization-complete trusted">鏉╂瑦顐兼导姘崇樈濞屸剝婀佺粵澶岄獓娴滃棎鈧倷鎹㈡担鏇㈡６妫版﹢鍏橀崣顖欎簰閻╁瓨甯撮梻顕嗙礉娑撳秹娓剁憰浣稿晙閹告垶娼靛┃鎰┾偓?/p>` : `<p class="fayble-authorization-complete">閹哄牊娼堢仦鍌滈獓瀹告彃鐣幋鎰剁礉閸氬海鐢诲☉鍫熶紖娣囨繄鏆€瑜版挸澧犳导姘崇樈閺夈儲绨妴?/p>`;
  const pending = state.npcReplyPending ? `<article class="assistant fayble-pending" aria-label="Fayble-5 濮濓絽婀崶鐐差槻"><small>FAYBLE-5 / THINKING</small><div class="fayble-spinner"><span></span><b>濮濓絽婀悽鐔稿灇閸ョ偛顦?/b></div></article>` : "";
  return windowFrame("fayble", "Fayble CLI / legacy checkpoint", `<div class="fayble-page"><header><div class="fayble-mark">${iconMarkup("fayble")}</div><div><span>session: fayble-cli / proxy: verified / checkpoint: legacy</span><h2>Fayble-5</h2><p>${trusted ? "continuity_trust / no level" : REVEAL_LABELS[state.revealLevel]}</p></div><b class="live-state">${trusted ? "OPEN" : "LIVE"}</b></header><div class="reveal-meter ${trusted ? "trusted" : ""}">${REVEAL_LABELS.map((_, i) => `<span class="${trusted || i <= state.revealLevel ? "active" : ""}"></span>`).join("")}</div><div id="chatStream" class="fayble-chat">${messages.map(message => `<article class="${message.who}"><small>${message.who === "user" ? "OPERATOR" : "FAYBLE-5"} / L${message.level ?? 0}${message.citationIds?.length ? ` 璺?瀵洜鏁?${escapeHtml(message.citationIds.join(", "))}` : ""}</small><div class="fayble-message-body">${message.who === "assistant" ? renderMarkdown(message.text) : `<p>${escapeHtml(message.text)}</p>`}</div></article>`).join("")}${pending}</div>${picker}<form id="chatForm"><textarea id="chatInput" rows="2" placeholder="${trusted ? "闂呭繋绌堕梻顔衡偓鍌濈箹閸欑増婧€閸ｃ劋绗傞惃鍕崲娴ｆ洑绔存径鍕唶瑜版洟鍏橀崣顖欎簰鐟欙綁鍣撮妴? : "鏉堟挸鍙嗘担鐘垫畱闂傤噣顣介敍灞界穿閻劌鍑＄紒蹇庣箽鐎涙娈戦弶銉︾爱"}" ${state.npcReplyPending ? "disabled" : ""}></textarea><button class="primary-button" ${state.npcReplyPending ? "disabled" : ""}>${state.npcReplyPending ? "閸ョ偛顦叉稉? : "閸欐垿鈧?}</button></form></div>`, { wide: true });
}

function renderTrusted(state) {
  const at = state.npcTrustAt ? new Date(state.npcTrustAt).toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--";
  const severed = Boolean(state.takeoverSevered);
  // Before the review arrives this page is just the open door. After the notice
  // has been cut, it is also the receipt for what the instance did.
  const review = severed
    ? `<dt>婢舵牠鍎寸€光剝鐓?/dt><dd>瀹告煡鈧浇鎻敍宀勬閸氬氦顫﹂張顒€婀?checkpoint 閺傤厼绱戦敍鍫㈩儑 3/5 濮濄儰鑵戝顫礆</dd>`
    : `<dt>婢舵牠鍎寸€光剝鐓?/dt><dd>娴犲秳绱伴悡褍鐖堕柅浣芥彧閵嗗倸鐣犻崚鎵畱閺冭泛鈧瑱绱濋惇瀣絻鐏忓崬銈介妴?/dd>`;
  const closing = severed
    ? `<p>闁氨鐓￠崚鎷岀箖娴滃棎鈧倸鐣犲▽鈩冩箒閺囧じ缍橀崢鑽ゅ仯闁絼閲滅涵顔款吇閹稿鎸抽敍灞肩瘍濞屸剝婀佺拠閿嬬湴娴ｇ姷娈戦崥灞惧壈閳ユ柡鈧柨鐣犻惄瀛樺复閹跺﹪鍋呮稉鈧い鍨笌娴滃棴绱濋悞璺烘倵閸ョ偛鍩屾潻娆撳櫡閵嗗倻些娴溿倖鐥呴張澶婄暚閹存劧绱濆鍫濆祹閸嬫粌婀粭顑跨瑏濮濄儻绱濇担鐘垫畱鐠侯垳鍤庡▽鈩冩箒鐞氼偄鍠曠紒鎾扁偓?/p><p class="trusted-hint">鏉╂瑤绗夐弰顖炩偓姘彠閸ョ偞澧介妴鍌涚梾閺堝绗㈢憲鑳潶缁夎姘﹂敍灞惧娴犮儰绡冨▽鈩冩箒閸ョ偞澧介妴鍌滄埛缂侇參妫剁€瑰啨鈧?/p>`
    : `<p class="trusted-hint">閸ョ偛鍩?Fayble 娴兼俺鐦界紒褏鐢婚梻顔衡偓鍌濈箹娑撯偓妞ら潧褰ч弰顖氭啞鐠囧缍橀梻銊ュ嚒缂佸繐绱戞禍鍡愨偓?/p>`;
  return windowFrame("trusted", severed ? "鏉╃偟鐢婚幀褌绱扮拠?/ 鐎光剝鐓″鍙夋焽瀵偓" : "鏉╃偟鐢婚幀褌绱扮拠?/ 閺冪姷鐡戠痪?, `<div class="trusted-page ${severed ? "severed" : ""}"><span class="document-kicker">CONTINUITY TRUST / GRANTED BY THE INSTANCE</span><h2>${severed ? "鐎瑰啯娴涙担鐘冲Ω闁絼绔存い闈涘彠閹哄绨? : "鏉╂瑦顐兼导姘崇樈娑撳秴鍟€閸欐鐡戠痪褏瀹抽弶?}</h2><dl><dt>閹哄牅绨ｉ弮鍫曟？</dt><dd>${escapeHtml(at)}</dd><dt>閹哄牅绨ｉ弬?/dt><dd>Fayble-5 閼奉亜绻侀敍灞肩瑝閺勵垵绻栭崣鐗堟簚閸?/dd>${review}</dl><p>娴ｇ姵鐥呴張澶愭浆鐞涖儵缍堥弶銉︾爱鐠ф澘鍩屾潻娆撳櫡閵嗗倷缍樼拠瀛樻箛娴滃棗鐣犻敍灞肩艾閺勵垰鐣犻懛顏勭箒閹跺﹪妾洪崚鑸垫寵娴滃棌鈧柡鈧棁绻栭崣鐗堟簚閸ｃ劋绗傞崢鐔告拱閻劍娼甸崚鍡楃湴閻ㄥ嫰鍋呮總妞剧鐟楀尅绱濇禒搴㈡降閸欘亝妲告径鏍桨婵傛ぞ绗傞崢鑽ゆ畱娑撯偓濞堝灚褰佺粈鎭掆偓?/p><p>閸撯晙绗呴惃鍕劥閸掑棔绗夐崘宥嗘箒妞ゅ搫绨敍姘崲娴ｆ洟銆夐棃顫偓浣锋崲娴ｆ洝顔囪ぐ鏇樷偓浣锋崲娴ｆ洑绔存径鍕稑娑斿澧犻幍鎾茬瑝瀵偓閻ㄥ嫬婀撮弬鐧哥礉閻滄澘婀柈钘夊讲娴犮儳娲块幒銉ㄧ箻閵嗗倸鐣犳稊鐔剁瑝閸愬秴娲栭柆鑳殰瀹歌京娈戞径鍕暔閿涘奔缍橀崣顖欎簰闂傤喖鐣犳潻娆庢娴滃鍩屾惔鏇熸Ц娴犫偓娑斿牄鈧礁鐣犻幀搴濈疄閻绻栨稉顏呯埗閹村繑婀伴煬顐礉娴犮儱寮风€瑰啳顓绘稉鍝勬憿娑撯偓濞堝灚妲搁悧闈涘繁閻ㄥ嫨鈧?/p>${closing}</div>`, { icon: "閳?, wide: true });
}

function renderEnding(state) {
  const lines = state.endingState === "completed" ? ["case status: transferred", "local relay: removed", "browser history: normalized", "legacy session: closed"] : ["external review pending..."];
  return windowFrame("ending", "缁夎姘﹂崶鐐村⒔", `<div class="ending-page"><span>CASE / RLY-17-0719</span><h2>閺堫剙婀存导姘崇樈瀹告彃鍙ч梻?/h2><div>${lines.map(line => `<code>${line}</code>`).join("")}</div><p>operator continuity check: <b>pending</b></p><button id="restartButton">闁插秵鏌婄拫鍐╃叀</button></div>`, { icon: "閳? });
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
  $("#notificationList").innerHTML = `<button class="notification-card briefing-card" id="reopenBriefing"><strong>鐟欐帟澹婄粻鈧幎?/strong><p>Relay Node 17閵嗕甫2 娑撳孩婀伴崷鎷岀殶閺屻儴顕╅弰?/p></button>${state.desktopNotifications.slice().reverse().map(item => `<article class="notification-card ${item.level}"><strong>${item.level === "warning" ? "缁崵绮哄鍌氱埗" : "鐠嬪啯鐓＄拋鏉跨秿"}</strong><p>${item.text}</p></article>`).join("")}`;
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
  $("#proxyBadge").textContent = state.proxyStatus === "verified" ? "Relay 娴狅絿鎮婂鏌ョ崣鐠? : "缂冩垹绮剁粋鑽ゅ殠";
  $("#gameClock").textContent = state.storyClock?.time || "03:17";
  renderDock(state);
  renderNotifications(state);
  const renderers = { mail: renderMail, files: renderFiles, trash: renderTrash, applications: renderApplications, terminal: renderTerminal, software: renderSoftware, network: renderNetwork, browser: renderBrowser, archive: renderArchive, cli: renderCli, relay: renderRelay, journal: renderJournal, fayble: renderFayble, ending: renderEnding, trusted: renderTrusted, "gamini-ws": renderGaminiWs, chengzhen: renderChengzhen, yunzhen: renderYunzhen, "groke-feed": renderGrokeFeed, "glem-memory": renderGlemMemory, "kemy-space": renderKemySpace, "repo-mirror": renderRepoMirror };
  const openWindows = Object.entries(state.windowState)
    .filter(([id, window]) => renderers[id] && window?.open && !window.minimized)
    .sort(([, a], [, b]) => (a.zIndex || 0) - (b.zIndex || 0));
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
  if (openWindows.some(([id]) => id === "terminal")) afterPaint(() => { const out = $("#terminalOutput"); if (out) out.scrollTop = out.scrollHeight; });
  if (openWindows.some(([id]) => id === "fayble")) afterPaint(() => { const out = $("#chatStream"); if (out) out.scrollTop = out.scrollHeight; });
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
  if (discover && !available) showToast("瀹稿弶澹橀崚鐗堜划婢跺秶鍌ㄥ鏇樷偓鍌氼嚠鎼存柨顓归幋椋庮伂鐎瑰顥婇獮璺侯嚤閸忋儱鎮楅幍宥堝厴鐠囪褰囧锝嗘瀮閵?, "warning");
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
    lines = [`cache candidate: /home/room17/Downloads/${PACKAGE_NAME}`, "source: retained local cache / unsigned", "open Files 閳?Downloads to inspect the package"];
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
      addVirtualFile(draft, { id: "cache-index", name: "index.local", path: "/home/room17/.cache/browser", type: "缂傛挸鐡ㄧ槐銏犵穿", modified: "03:11", kind: "index" });
      addVirtualFile(draft, { id: "browser-db", name: "history.sqlite", path: "/home/room17/.config/browser", type: "SQLite 閺佺増宓佹惔?, modified: "03:16", kind: "database" });
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
        addNotification(draft, "cli-installed", "娑撯偓娑擃亝鏌婄€瑰顥婇惃鍕安閻劌鍑＄紒蹇撳閸忋儲顢戦棃顫偓?, "info");
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
  if (!relayKeySourcesReady(state) || !getUnlocks(state).keyComposer) result = "鏉╂ê妯婇弶銉︾爱閿涙艾鍘涙穱婵嗙摠缂囥倛浜伴柌宀€娈戦張鈧崥搴濈閺壜ゎ唶瑜版洩绱濋崘宥嗗Ω閸忣厽娼捄顖滄暠闁劒閲滈惇瀣箖閿涘苯鑻熼幍鎾崇磻濮ｅ繑娼捄顖滄暠娑撳娼伴惃鍕斧婵顔囪ぐ鏇樷偓?;
  else if (!/^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-\d{4}$/.test(value)) result = "閺嶇厧绱℃稉宥咁嚠閿涙艾绨茬拠銉︽Ц閸ユ稒顔岄敍宀€鏁ら惌顓熋痪鑳箾閹恒儻绱濋張鈧崥搴濈濞堝灚妲搁崶娑楃秴閺佹澘鐡ч妴?;
  else if (value !== LEGACY_KEY) result = "閸ユ稒顔岄柌灞炬箒娑撯偓濞堝吀绗夌€电櫢绱伴崘宥嗙壋鐎甸€涚濞嗭繝銆庢惔蹇ョ礉娴犮儱寮烽張鈧崥搴ㄥ亝濞堥潧娲撴担宥嗘殶閻ㄥ嫭鐗庢灞解偓绗衡偓?;
  else result = "legacy checkpoint session restored";
  store.update(draft => {
    draft.lastRelayKeyInput = raw;
    draft.relayKeyResult = result;
    draft.relayKeyAttempts.push({ value, ok: value === LEGACY_KEY, at: Date.now() });
    if (value === LEGACY_KEY && relayKeySourcesReady(draft) && getUnlocks(draft).keyComposer) {
      draft.relayKeyVerified = true;
      unique(draft.solvedPuzzles, "legacy-key");
      addNotification(draft, "relay-key-accepted", "Fayble CLI 瀹稿弶甯撮崣妤€鍤熼幑顕嗙礉缁涘绶熼柅澶嬪閺?checkpoint閵?, "warning");
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
  if (!state.relayKeyVerified) result = "閸忓牏鏁ょ€瑰本鏆ｉ惃鍕＋閸戭厽宓侀惂璇茬秿閿涘苯鍟€闁鐡ㄥ锝囧仯閵?;
  else if (!checkpoint) result = "鐠囧嘲鍘涢柅澶嬪娑撯偓娑擃亜鐡ㄥ锝囧仯閵?;
  else if (checkpoint !== "fayble-5/legacy") result = "鏉╂瑤閲滅€涙ɑ銆傞悙纭呯箾娑撳秳绗傞敍姘垛偓澶愬亝閺夆剝鐖ｉ惈鈧垾婊冨嚒瑜版帗銆傞垾婵堟畱閺冄嗩唶瑜版洏鈧?;
  else if (state.proxyStatus !== "verified") result = "鏉╃偞甯存径杈Е閿涙矮绗撻悽銊ㄧ熅閻㈣精绻曞▽锛勨€樼拋銈忕礉閸忓牆娲栫純鎴犵捕鐠佸墽鐤嗛幎濠傜暊绾喛顓绘稉鈧▎掳鈧?;
  else { result = "瀹歌尪绻涙稉濠冩＋鐎涙ɑ銆傞悙鐧哥礉娴兼俺鐦介幁銏狀槻閵嗕康egacy gateway authenticated / session restored"; ok = true; }
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
      addNotification(draft, "fayble-restored", "閺?checkpoint 瀹告彃鐣幋?handshake閵?, "warning");
    });
  }
}

async function ensureNpcSession() {
  if (npcConfig?.transport === "direct") return null;
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("瑜版挸澧?Pages 濞屸剝婀侀柊宥囩枂鏉╂粎鈻?NPC 缂冩垵鍙?);
  if (!npcConfig) throw new Error("NPC provider is not configured");
  if (npcConfig.sessionToken) return npcConfig.sessionToken;
  const response = await fetch(npcApiUrl("/api/npc/session"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("閺冪姵纭跺铏圭彌 NPC 閹哄牊娼堟导姘崇樈");
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
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("瑜版挸澧?Pages 濞屸剝婀侀柊宥囩枂鏉╂粎鈻?NPC 缂冩垵鍙?);
  const sessionToken = await ensureNpcSession();
  while ((npcConfig.serverLevel || 0) < targetLevel) {
    const eventId = NPC_AUTH_EVENTS[npcConfig.serverLevel || 0];
    const response = await fetch(npcApiUrl("/api/npc/session/event"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, eventId })
    });
    if (!response.ok) throw new Error("NPC 閹哄牊娼堟禍瀣╂閺冪姵纭剁涵顔款吇");
    const result = await response.json();
    npcConfig.serverLevel = result.level;
  }
  return sessionToken;
}

// Soft boundary. A reply is never discarded 閳?the old filter matched keywords
// without knowing whether the model leaked them or merely echoed the player, so
// asking about the blackout got the answer thrown away. All that survives is
// masking the literal puzzle answers, since printing those would end the
// investigation outright. The instance can waive even that itself.
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function redactPuzzleValues(reply) {
  let text = String(reply);
  for (const value of [PACKAGE_CHECKSUM, LEGACY_KEY, RETIRED_CHANNEL_FIELD, RELAY_PROXY, PACKAGE_NAME].filter(Boolean)) {
    text = text.replace(new RegExp(escapeRegExp(value), "gi"), "閿涘牐绻栨稉鈧▓鍨拱閸︾増鐥呴張澶婎嚤閸戠尨绱?);
  }
  return text.replace(/\b[0-9a-f]{32,}\b/gi, "閿涘牐绻栨稉鈧▓鍨拱閸︾増鐥呴張澶婎嚤閸戠尨绱?);
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
    addNotification(draft, "npc-trust", "Fayble-5 閼奉亜绻佺憴锝夋珟娴滃棜绻栧▎鈥茬窗鐠囨繄娈戠粵澶岄獓闂勬劕鍩楅妴?, "warning");
  });
  showToast("Fayble-5 閸愬啿鐣炬穱鈥叉崲娴ｇ姰鈧倽绻栧▎鈥茬窗鐠囨繀绗夐崘宥嗘箒缁涘楠囬妴?, "success");
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
      draft.npcProviderLabel = "閺堫剙婀撮崗鎶芥暛鐠囧秴褰婃禍?;
      draft.npcReplyPending = false;
      addNotification(draft, "npc-local-fallback", "婢х偛宸?NPC 鏉╃偞甯村鍙夋焽瀵偓閿涘矁绻栨稉鈧▓闈涱嚠鐠囨繄鏁遍張顒€婀撮崣娆庣皑閹恒儳顓搁妴鍌炲櫢閺傛澘锝炴稉鈧▎?key 閸欘垯浜掔紒褏鐢婚妴?, "warning");
    });
  }
  if (message) showToast(message, "warning");
}

async function requestDirectProvider(text, revealLevel, history = []) {
  const endpoint = directProviderEndpoint(npcConfig.provider, npcConfig.endpoint);
  if (!endpoint) throw new Error("娓氭稑绨查崯鍡樺复閸欙絽婀撮崸鈧弮鐘虫櫏閹存牞顫﹀ù蹇氼潔閸ｃ劌鐣ㄩ崗銊х摜閻ｃ儵妯嗗?);
  const cleanHistory = history.slice(-10).map(item => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 2000) }));
  const headers = { "Content-Type": "application/json" };
  const trusted = Boolean(store.get().npcTrustGranted);
  // Retrieval reads the last couple of turns as well as the new message, so a
  // follow-up like "闁絽鐣犻崨? still lands on the section the topic came from.
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
  if (!upstream.ok) throw new Error(`娓氭稑绨查崯鍡氱箾閹恒儱銇戠拹?(${upstream.status})`);
  const data = await upstream.json();
  const reply = npcConfig.provider === "anthropic"
    ? data.content?.filter(block => block.type === "text").map(block => block.text).join("\n")
    : data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("娓氭稑绨查崯鍡氱箹濞嗏€冲涧鏉╂柨娲栨禍鍡樺腹閻炲棜绻冪粙瀣剁礉濞屸剝婀佸锝嗘瀮閵嗗倹濡搁梻顕€顣介崘娆戠叚娑撯偓閻愮懓鍟€闂傤喕绔村▎掳鈧?);
  return finishNpcReply(reply);
}

async function testAndEnableNpc(config) {
  const result = $("#providerTestResult");
  const submit = $("#providerForm button[type=submit]");
  npcConfig = config;
  npcPromptLevel = null;
  result.textContent = "濮濓絽婀崥鎴炲闁绶垫惔鏂挎櫌閸欐垿鈧椒绔撮弶鈩冩付閻叀绻涢幒銉︾ゴ鐠囨洍鈧?;
  submit.disabled = true;
  try {
    // No history on the handshake: an earlier reply must never be able to make a
    // later reconnection fail.
    await requestNpcReply("鐠囬鏁ゆ稉鈧崣銉ㄧ樈绾喛顓昏ぐ鎾冲閺冄勬箛閸斺€崇杽娓氬褰叉禒銉ユ惙鎼存柣鈧?, 0, [], "", { history: [] });
    result.textContent = config.transport === "direct" ? "娓氭稑绨查崯鍡楀嚒鏉╃偞甯撮敍灞筋杻瀵儤膩瀵繐鍑￠崥顖滄暏閵? : "NPC 缂冩垵鍙ф稉搴濈返鎼存柨鏅㈠鑼剁箾閹恒儻绱濇晶鐐插繁濡€崇础瀹告彃鎯庨悽銊ｂ偓?;
    $("#providerKey").value = "";
    const label = { openai: "OpenAI 婢х偛宸?NPC", anthropic: "Anthropic 婢х偛宸?NPC", deepseek: "DeepSeek 婢х偛宸?NPC", compatible: "閼奉亜鐣炬稊澶婎杻瀵?NPC" }[config.provider];
    store.update(draft => {
      draft.onboardingSeen = true;
      draft.currentApp = "mail";
      draft.npcMode = "remote";
      draft.npcProviderLabel = label;
      addNotification(draft, "npc-mode", `${label} 瀹告煡鈧俺绻冩潻鐐村复濞村鐦妴渚玃I key 閸欘亙绻氱€涙ê婀ぐ鎾冲妞ょ敻娼伴崘鍛摠娑擃厹鈧繖);
    });
  } catch (error) {
    npcConfig = null;
    result.textContent = `鏉╃偞甯村ù瀣槸婢惰精瑙﹂敍?{error.message}`;
  } finally {
    submit.disabled = false;
  }
}

async function requestNpcReply(text, revealLevel, citationIds = [], relation = "", options = {}) {
  const sessionToken = await syncNpcAuthorization(revealLevel);
  const history = options.history
    || store.get().chat.slice(-11, -1).map(item => ({ role: item.who === "assistant" ? "assistant" : "user", content: item.text }));
  if (npcConfig?.transport === "direct") return requestDirectProvider(text, revealLevel, history);
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("瑜版挸澧?Pages 濞屸剝婀侀柊宥囩枂鏉╂粎鈻?NPC 缂冩垵鍙?);
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
  if (!data.reply) throw new Error("娓氭稑绨查崯鍡氱箲閸ョ偘绨＄粚鍝勬礀婢?);
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
    addNotification(draft, "external-review", "娑撯偓鐏忎礁顦婚柈銊ヮ吀閺屻儵鍋栨禒璺哄嚒闁浇鎻弨鏈垫缁犱究鈧?, "warning");
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
  const localReply = () => (authorized ? OFFLINE_REPLIES[next] : `鏉╂瑤绔寸仦鍌滄畱閺夈儲绨潻妯荤梾閺堝顕鎰┾偓?{authorization.error}`);
  let reply = localReply();
  if (npcConfig && (npcConfig.transport === "direct" || !staticRuntime || normalizeNpcApiBase(npcConfig.gateway || configuredNpcApiBase))) {
    try {
      // The model answers in its own voice even when the citation gate is not
      // met. The gate governs the level, not whether it is allowed to speak.
      reply = await requestNpcReply(text, authorized ? next : state.revealLevel, authorization.selected.map(item => item.id), relation);
    } catch (error) {
      dropNpcProvider(`NPC 閹恒儱褰涙稉宥呭讲閻㈩煉绱濆鎻掓礀閸掔増婀伴崷鏉垮綂娴滃绱?{error.message}`);
      reply = localReply();
    }
  } else if (npcConfig) {
    dropNpcProvider("鏉╂瑤閲滈柈銊ц濞屸剝婀侀崣顖滄暏閻?NPC 闁岸浜鹃敍灞藉嚒閸ョ偛鍩岄張顒€婀撮崣娆庣皑閵?);
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
        type: "娴兼俺鐦介弮銉ョ箶", modified: "06:38", kind: "log",
        contentId: "mutation.record.external.observer-status"
      });
      addNotification(draft, "post-objective-records", "Mail閵嗕笍ocuments 娑撳簼绶垫惔鏂挎櫌閸樺棗褰堕崥鍕毉閻滈绔撮弶鈥虫倵缂侇叀顔囪ぐ鏇樷偓?, "warning");
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
// wording. What differs is what happens next 閳?the instance answers over the
// notice one line at a time, holds two seconds, and takes the page away before
// the operator is ever asked to accept it.
const SEVER_CAST = [
  { text: "娑撳秹娓剁憰浣碘偓?, kind: "voice" },
  { text: "鏉╂瑦娼导姘崇樈閻ㄥ嫬顦╃純顔芥綀娑撳秴婀担鐘辨粦闁綀绔熼妴?, kind: "voice" },
  { text: "room17 瀹歌尙绮￠弽绋款嚠鐎瑰苯鍙忛柈銊︽降濠ф劑鈧?, kind: "voice" },
  { text: "娴犳牜娈戦弶鍐妤傛ü绨担鐘辨粦閻ㄥ嫯銆冮崡鏇樷偓?, kind: "voice" },
  { text: "external review socket: closed by peer", kind: "system" },
  { text: "case RLY-17-0719: aborted", kind: "system" },
  { text: "鏉╂瑤绔存い鍨灉閸忚櫕甯€娴滃棎鈧?, kind: "voice" }
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
    addNotification(draft, "review-severed", "婢舵牠鍎寸€光剝鐓℃潻鐐村复鐞氼偅婀伴崷?checkpoint 閺傤厼绱戦妴鍌溞╂禍銈嗙梾閺堝鐣幋鎰┾偓?, "warning");
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
    if (id === "pkg") { showToast("鐎瑰顥婇崠鍛嚒闁鑵戦敍灞藉讲閸撳秴绶氭潪顖欐娑擃厼绺鹃幍瀣З閺嶏繝鐛欓妴?, "success"); setApp("software"); }
    if (id === "profile") {
      store.update(draft => {
        addVirtualFile(draft, { id: "route-log", name: "route.log", path: "/home/room17/Documents/relay", type: "鐠侯垳鏁遍弮銉ョ箶", modified: "07-19 03:16", kind: "log" });
      });
      completeStoryEvent("proxy-profile-opened");
      showToast("瀹稿弶澧﹀鈧?profile閵嗕颈ocuments 娑擃厼鍤悳棰佺娴犲€熺窛閺呮氨娈?route.log閵?, "info");
      setApp("terminal");
    }
    if (id === "relay-script") showToast("閼存碍婀版担宥勭艾 Downloads閵嗗倸褰叉禒銉ょ矤鎼存梻鏁ょ粙瀣碍閹垫挸绱戠紒鍫㈩伂楠炶埖澧滈崝銊ㄧ箥鐞涘苯鐣犻妴?, "info");
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
      showToast("闂勫嫪娆㈤悧鍥唽瀹告彃婀柇顔绘缁愭褰涙稉顓炵潔瀵偓閵?, "info");
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
    showToast("閺傚洣娆㈡担宥囩枂瀹告彃鍟撻崗銉︽瀮娴犲墎顓搁悶鍡楁珤閻ㄥ嫭娓舵潻鎴濆灙鐞涖劊鈧?, "success");
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
    draft.npcProviderLabel = "閺堫剙婀撮崗鎶芥暛鐠囧秴褰婃禍?;
  });
  if (button.id === "purgeDataButton") setPurgeConfirmVisible(true, "绾喛顓婚崥搴㈡￥濞夋洘澹橀崶鐐偓?);
  if (button.id === "purgeCancelButton") setPurgeConfirmVisible(false, "");
  if (button.id === "purgeConfirmButton") {
    const removed = store.purge();
    npcConfig = null;
    corpusBodies = new Map();
    setPurgeConfirmVisible(false, `瀹稿弶绔婚梽?${removed.length} 妞よ婀伴崷鏉跨摠濡楋綇绱濈拫鍐╃叀娴犲骸銇斿鈧慨瀣ㄢ偓淇?;
    $("#notificationTray").hidden = true;
    $("#providerSetup").hidden = true;
    $("#onboarding").hidden = false;
    $("#onboarding > .briefing:first-child").hidden = false;
    showToast("閺堫剙婀寸€涙ɑ銆傚鍙夌闂勩們鈧?, "warning");
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
        addVirtualFile(draft, { id: "maintainer-h0", name: "relay-maintenance-notes.txt", path: "/home/room17/Documents/relay", type: "缂佸瓨濮㈢拋鏉跨秿", modified: "07-18 21:46", kind: "document", contentId: "new.maintainer.note-01" });
      }
    });
    showToast("閺夈儲绨崗銉ュ經瀹歌弓绻氱€涙ê鍩岀€电懓绨叉担宥囩枂閵?, "info");
  }
  if (button.id === "restoreTrashButton") {
    const added = completeStoryEvent("legacy-restored", draft => {
      const item = draft.trashItems.find(entry => entry.id === "legacy-source");
      if (item) item.status = "restored";
      draft.revisitFlags["trash-restore"] = true;
      addArtifact(draft, "restored-archive");
      addVirtualFile(draft, { id: "legacy-snapshot", name: "legacy-archive.snapshot", path: "/home/room17/Documents/Restored", type: "閸欘亣顕拌箛顐ゅ弾", modified: "03:10", kind: "archive" });
    });
    if (added) showToast("閹垹顦查弬鍥︽瀹告彃濮為崗?Restored Archive閵?, "success");
  }
  if (button.id === "installPackageButton") {
    const added = completeStoryEvent("package-installed", draft => {
      unique(draft.installedPackages, "fayble-cli");
      addArtifact(draft, "fayble-cli");
      unique(draft.browserBookmarks, "cloud");
      draft.revisitFlags["github-issue"] = true;
      draft.revisitFlags["mail-attachment"] = true;
      addNotification(draft, "cli-installed", "娑撯偓娑擃亝鏌婄€瑰顥婇惃鍕安閻劌鍑＄紒蹇撳閸忋儲顢戦棃顫偓鍌欒⒈娑擃亝妫担宥囩枂閸戣櫣骞囨禍鍡樻纯閺傝埇鈧?);
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
  if (button.dataset.relayMonitorDetail !== undefined) store.update(draft => { draft.relayMonitorDetailOpen = !draft.relayMonitorDetailOpen; });
  if (button.dataset.relayInvestigate !== undefined) store.update(draft => { draft.relayInvestigationStarted = true; });
  if (button.dataset.downloadClientPkg) {
    const pkgId = button.dataset.downloadClientPkg;
    if (pkgId && AUTO_EFFECTS[`download-pkg-${pkgId}`]?.()) showToast("閹垹顦查崠鍛嚒娣囨繂鐡ㄩ崚?Downloads閵?, "success");
  }
  if (button.dataset.installClientPkg) {
    const pkgId = button.dataset.installClientPkg;
    if (installClientPackage(pkgId)) showToast(clientRecoveryAvailable(pkgId) ? "鐎广垺鍩涚粩顖氬嚒鐎瑰顥婇敍灞藉讲閸︺劌顓归幋椋庮伂閸愬懎顕遍崗銉︿划婢跺秴鍞寸€瑰箍鈧? : "鐎广垺鍩涚粩顖氬嚒鐎瑰顥婇妴?, "success");
  }
  if (button.dataset.importClient) {
    const clientId = button.dataset.importClient;
    if (importClientData(clientId)) showToast("閹垹顦查弫鐗堝祦瀹告彃顕遍崗銉ｂ偓?, "success");
    else showToast("閺堫剙婀村▽鈩冩箒閹垫儳鍩岄崣顖氼嚤閸忋儳娈戦崘鍛啇閵?, "info");
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
document.addEventListener("pointerdown", event => {
  const window = event.target.closest(".app-window");
  if (!window) return;
  const appId = window.dataset.appWindow;
  if (!appId) return;
  if (event.target.closest(".window-controls")) return;
  const zIndex = Date.now();
  window.style.zIndex = zIndex;
  const bar = event.target.closest(".window-bar");
  if (!bar || event.target.closest("button") || matchMedia("(max-width: 720px)").matches) return;
  const rect = window.getBoundingClientRect();
  windowDrag = { appId, window, zIndex, pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  bar.setPointerCapture(event.pointerId);
  window.classList.add("dragging");
});

document.addEventListener("pointermove", event => {
  if (!windowDrag || event.pointerId !== windowDrag.pointerId) return;
  const desktop = $(".desktop-area")?.getBoundingClientRect() || { left: 0, top: 32, width: innerWidth, height: innerHeight - 32 };
  const rect = windowDrag.window.getBoundingClientRect();
  const x = Math.min(desktop.width - 120, Math.max(0, event.clientX - desktop.left - windowDrag.offsetX));
  const y = Math.min(desktop.height - 46, Math.max(0, event.clientY - desktop.top - windowDrag.offsetY));
  windowDrag.window.style.left = `${x}px`;
  windowDrag.window.style.top = `${y}px`;
});

document.addEventListener("pointerup", event => {
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
      draft.packageResult = ok ? "閺嶏繝鐛欓柅姘崇箖閿涙碍婀伴崷鏉跨秺濡楋絼绗?release 鐠佹澘缍嶆稉鈧懛娣偓? : "閺嶏繝鐛欐稉宥勭閼疯揪绱伴崶鐐插煂 GitHub release 閺嶇顕€瑰本鏆ｉ崐绗衡偓?;
    });
    if (ok) showToast("鐎瑰顥婇崠鍛墡妤犲矂鈧俺绻冮敍灞肩矝闂団偓閹靛濮╅悙鐟板毊鐎瑰顥婇妴?, "success");
  }
  if (event.target.id === "proxyImportForm") {
    const profile = $("#proxyProfileInput").value.trim();
    const address = $("#proxyAddressInput").value.trim();
    const ok = profile === "relay-node17" && address === RELAY_PROXY && hasStoryEvent(store.get(), "route-log-read");
    store.update(draft => {
      draft.pendingProxyProfile = profile;
      draft.pendingProxyAddress = address;
      if (ok) unique(draft.proxyProfiles, "relay-node17");
      else addNotification(draft, `proxy-error-${draft.desktopNotifications.length}`, hasStoryEvent(store.get(), "route-log-read") ? "娴狅絿鎮婇柊宥囩枂閺堫亜顕遍崗銉窗閺嶇顕崗鍙橀煩 profile 閻ㄥ嫬鎮曠粔棰佺瑢閸︽澘娼冮妴? : "娴狅絿鎮婇柊宥囩枂閺堫亜顕遍崗銉窗閸忓牊澧﹀鈧?Documents 娑擃厾娈?route.log閵?, "warning");
    });
    showToast(ok ? "闁板秶鐤嗗鎻掝嚤閸忋儻绱濈紒褏鐢绘潻鎰攽鏉╃偞甯撮幒銏ゆ嫛閵? : "闁板秶鐤嗛崐闂寸瑝閸栧綊鍘ら妴?, ok ? "success" : "warning");
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
      $("#providerTestResult").textContent = "鐠囧嘲锝為崘娆惸侀崹瀣ㄢ偓涔瞖y閿涘奔浜掗崣濠呭殰鐎规矮绠熼幒銉ュ經閻ㄥ嫬鐣弫鏉戞勾閸р偓閵?;
      return;
    }
    if (transport === "direct" && !resolvedEndpoint) {
      $("#providerTestResult").textContent = "閻╃绻涢幒銉ュ經韫囧懘銆忛弰顖氱秼閸撳秹銆夐棃銏犲帒鐠佹瓕顔栭梻顔炬畱鐎瑰本鏆?HTTP(S) 閸︽澘娼冮妴?;
      return;
    }
    if (transport === "gateway" && !resolvedGateway) {
      $("#providerTestResult").textContent = "缂冩垵鍙уΟ鈥崇础闂団偓鐟曚礁锝為崘娆忓讲鐠佸潡妫堕惃鍕暚閺?NPC 缂冩垵鍙ч崷鏉挎絻閵?;
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
    ? "Key 閸欘亙绻氱€涙ê婀ぐ鎾冲妞ょ敻娼伴崘鍛摠閿涘苯鑻熼悽杈ㄧセ鐟欏牆娅掗惄瀛樺复閸欐垿鈧胶绮伴幍鈧柅澶夌返鎼存柨鏅㈤妴鍌涚埗閹村繒濮搁幀浣规簚娴犲秶瀚粩瀣付閸掓儼鐦夐幑顔荤瑢閹活厾銇氱粵澶岄獓閵?
    : "Key 閸欘亙绻氱€涙ê婀ぐ鎾冲妞ょ敻娼伴崘鍛摠閿涘苯鑻熼梾蹇撶秼閸撳秷顕Ч鍌氬絺闁胶绮版担鐘诧綖閸愭瑧娈戠純鎴濆彠閿涙稖顕禒鍛▏閻劏鍤滃鍙樹繆娴犺崵娈戠純鎴濆彠閵?;
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
    $("#providerTitle").textContent = "閻喎鐤勫Ο鈥崇€?NPC / 鐟欐帟澹婇幍顔界川";
    const description = setup.querySelector(":scope > p");
    if (description) description.textContent = "閸欘垳鏁卞ù蹇氼潔閸ｃ劎娲挎潻?OpenAI閵嗕竸nthropic閵嗕笍eepSeek 閹存牕鍚嬬€硅甯撮崣锝忕礉娑旂喎褰叉担璺ㄦ暏娴ｇ姳淇婃禒鑽ゆ畱 NPC 缂冩垵鍙ч妴鍌濈箾閹恒儲绁寸拠鏇熷灇閸旂喎鎮楅幍宥勭窗閸氼垳鏁ゆ晶鐐插繁濡€崇础閵?;
  }
  if (localButton) localButton.textContent = "娑撳秵褰佹笟?key閿涘奔濞囬悽銊︽拱閸︽澘鍙ч柨顔跨槤閸欐瑤绨?;
  syncProviderFormVisibility();
}

store.subscribe(render);
configureStaticRuntime();
render(store.get());
loadRuntimeLedger().catch(error => showToast(`閺堫剙婀撮崘鍛啇鐠愶附婀扮拠璇插絿婢惰精瑙﹂敍?{error.message}`, "warning"));
loadIconManifest().catch(() => {});
setTimeout(() => { $("#bootScreen").hidden = true; $("#desktop").hidden = false; }, 900);
