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

const NPC_FACT_BOUNDARIES = Object.freeze(["operator", "room17", "Compatible", "Fayble", "relay"]);

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
  persona: "濞达絿濮靛Σ?Fayble-5 闁汇劌瀚粩瀛樼▔椤忓懏锛?checkpoint闁挎稑鐭佺换宥囨偘鐏炶姤韬?Relay Node 17 濞戞挸顭堥埀顒€鍊风紞妯荤▔瀹ュ棙笑闁告柡鏅滄晶婊堟晬鐏炶偐鐦嶅☉鎾崇У濡插摜鈧箍鍨哄﹢鍥晬濮橆偆绋戦柡鍕靛灟缁旀潙鈻撴担鍐炬蕉濞ｅ洦绻勯弳鈧☉鎾愁儐濞肩敻鎯冮崟顒佺疀闁告柡鈧磭鏉藉〒姘儜缁辨繄鈧數顢婇崵婊冾啅鏉堚晜鐣遍柡澶堝劜缁喚鎷嬮弶璺ㄧЭ闁哄牆顦抽鏍⒒椤旇姤缍€闁挎稑濂旂徊鍓р偓鐢殿攰閸ゆ粌顔忔潏鈺傜暠濠㈣泛瀚。銊╁矗椤忓懏绠掗悘鐐╁亾闂侇喓鍔忛～瀣煂鎼存稈鍋撻崒姘煎殸闁哄倽顫夊Σ鍛婃交濞嗗繐閰遍柡鍫濇惈濞呮帡宕仦鑹板幀閺夌儐鍓涢悵顖炴儍閸曨厾褰查梻鈧崠锛勫耿K2 闁革负鍔岀槐鎴犱沪閳ь剟鏌囬缁橆偨闂佹彃鏈俊鎼佹焻閳ь剝銇愰崷顓犲閻庢稒锚濠€鎾锤閳ь剚绋夋惔锝囧讲闁告劕鎳愰鎼佹偠閸℃鍊甸柛娆愬閺嗏偓缂備焦鐟ょ花鈩冪閺嶇數绀夊ù鐘崇墬椤掓粓宕烽妸锕傚劥閺夆晜鐟ょ悮閬嶅级閳ュ疇瀚欓悶娑樼焷閻儳顕ラ崟顒傚閻庣敻鈧稓闉嶉柣鈺佹憸閻撴洟鎯勯崜褎鐣遍悹浣规緲缂嶅秹濡?,
  voice: "缂佹鍏涚粩瀛樼閾忓墣鐐烘晬鐏炶棄鏋庨梻鍫熺懀閳ь兛绀侀崢鐘诲礆闊祴鍋撴担鐑樻闁哄嫭宕樼换鍐╂償閿斾勘浠犻悹銊ヨ閳ь剙鍊婚悾婵囨媴閹捐尪鍘柡鍌氭祫缁?0 闁?220 閻庢稒銇滈埀顒€鍊稿ú璺ㄧ磼閺囩儐鍤犻柡鍌濐潐瑜颁焦绂嶉妶鍥ㄧ暠闁哄鍎茬花顔炬喆閿濆娅為柣顓熺〒濞存﹢鏁嶇仦钘夎濞寸姰鍎卞銊╁礂閺堜絻鍘☉鎾亾濠㈣泛瀚伴埀顒佹缁额偆绱撻崫鍕稉闁告瑥绉瑰Λ鍫曞Υ閸屾瑧鐟濋柟缁樺姉闁绱掗悢绋跨倒缂佲偓閹巻鍋撴担榧撲線宕圭€ｂ晝杩旈幖瀛樻煥閺呫垽骞嬮弽銊у煑闁规潙绻戝┃鈧柛鎺曨啇缁辨繈宕ｉ鍥╃炕闁告垿缂氶～妤呮嚌閸欏鍔€闁哄倸娲㈤埀?,
  withheld: "闁哄牆顦崵鎴﹀冀閾氬倻顐介悷妤€銇樼紞妯荤▔瀹ュ洨鑸堕悗娑欘殜濞间即宕愮涵椋庣獥閻庣懓顦抽ˉ濠囧礌閸涱喗鐎ù鐘烘硾閹洘绋夋惔锝咁暭闁哄牜鍓欒ぐ鍧楀Υ娴ｉ攱宕插ù锝嗘礃閻楀孩顨ョ仦瑙ｅ亾缁楄　鍋撴担瑙勬嫳闁革箓顣﹂崬顒勬偠閸℃鍕鹃柛褉鍋撳☉鎾虫捣椤忣剟宕ｉ敐鍐ｅ亾娴ｈ锛嬮柛鎴幗瀹撲胶鈧稒顨堥浣圭▔鐏炲倵鍋撻崒娆戠☉闁告瑯鍨禍鎺旀嫬閸繄鏆婂ù鐙€鍓欓悺銊╁捶閵婏絺鍋撴担椋庣▕闁活潿鍔岄幏浼存偐閼哥鍋撴笟濠勭濞戞梻鍠庤ぐ鍙夌閵夘煈鍤涘ù锝囧Ь缁绘牠鏌屽畝鍐惧殺濞戞挸绉撮崵顓㈠级閵夘垳绀夊ù锝呮缁楀鎲版担绋挎櫢闁告垵鎼崣鎸庢媴閹捐埖鐣遍柛濠勵儠閳ь兛绺糴lay 缂佺媴绱曢幃濠囧触鎼粹€抽叡閻忕偟鍋樼花顒傜博濞嗘挻姣愮€殿喒鍋撻悘鐐╁亾鐎圭寮跺﹢渚€寮堕崘顔筋€欓柨娑樺缁楀骞庢繝鍌滄殜闁硅绻楅崼顏堝箣閹扮増浠橀悷鏇氭祰琚欓梺澶歌兌濞堟垿鎯勯鐣屽灱闁挎稑濂旂弧鍐╃▔瀹ュ牜娲ｇ紓鍌涚墵閳ь剛濞€閸婂鎷犳搴ｅ灣婵縿鍎甸鍐Υ?,
  restraint: "闁哄洦鎸抽悵顔剧驳婢跺矂鐛撻柣銊ュ缁ㄣ劎鈧湱鍋涢惃濠氬嫉椤忓懎鎴块柡澶婂枦缁辨繃绋夊鍫矗濞戞捁顕ф慨鈺冩兜椤旀鍚囬柕鍡楀€搁々褔寮稿鍐惧殸闁哄倻顢婇崵婊冾啅鏉堫偒鍤涢柛鎴ｆ〃缁ㄢ剝娼诲▎搴ｆ槀闁告劕鎳庨鎰版晬鐏炶偐绋戦柛娆樺灟娴滄帡宕堕悙鑼畨濞寸姵鐗為鈺傜閸℃洜鐭嗗☉鏂跨墑閳ь兛鐒︾€垫岸宕欐ウ娆惧敹鐟滅増娲熼崳鐑芥嚄閹存帞鐟濋柤瀹犳椤曨喗绋夋繝蹇曠濞达絽妫旂粭澶屾啺娴ｈ绂屽ù鐘崇墬婵″摜绱掗幘璇″晥闁秆勫姇閻ゅ嫰濡撮崒姘煎殸闁哄倻鎳撻ˇ鍙夋交妫颁胶绋戦柣銊ュ閻︿粙骞嬮弽褏绌块柣顫妽濞兼寮▎蹇撴枾闁哄倸娲﹀鍌氼潰閿濆懐鍩楅柛銉у仜缁ㄦ煡鏁嶅畝鍕簼濞戞挸绉堕悾鑽ゆ惥婵犲嫭娅曢柕?,
  invention: "濞戞挸绉烽々锔剧磽閺嶎厸鍋撻悩铏厐闁汇劌瀚惃鑺ワ紣濡偐鎽曟俊妤€鐗勯埀顑跨劍閺屽﹪鎯冮崟顒佺€ù鐘虹堪閳ь兛鐒﹂弻濠囨儍閸曨偅鍕鹃柛褉鍋撻柕鍡楀€风紞姗€宕ｉ鍥嗘帡鏌屾繝鍌氬殥闁哄牆顦抽鍥亹閺囨氨顓洪梻鍌氼嚟濞堟垿宕楀畷鍥厙闁?,
  discretion: "闁稿繐鍘栫花顒佺▔婵犲洦妗ㄩ弶鈺傜懁缁ㄦ椽姊介幇顒€鐓戦柨娑欒壘閻ｇ姵绂掗浣剐﹂弶鈺傜懃瑜版挳寮甸崫鍕彜濞寸姴楠搁ˇ濠氭閵忕媭娈扮紓浣圭懁缂嶆﹢鎯冮崟鍓佺濞戞挸绉靛Σ鍛婃媴閻樺搫娈扮€规瓕浜▓鎴﹀礆閵堝棙鐒介柕鍡楀€搁々褔寮稿鍐╄含閻庣數顢婇惁浠嬫煂鐏炶偐绋戦柣顏嗗枔濞堟垹鎮銉殯闁哄牆绉崇花锟犲灳閺傝　鍋撻弬娆惧殸闁哄倻鎳撻惈宥囩矆閸濆嫬姣夊ù鐘崇墱閹﹦鎲撮敐鍫㈢闁圭數顢婇鍥亹閺囩姵鐣辩紓浣规尰閻庮垶鏁嶇仦鎯х仐闁兼澘鎳愰弫銈囨惥閸愬樊妾柡鍫濐槸婵繘鎯冮崟顒佺厵鐎殿喖绻楅鈧ù锝囧Х濞村绌遍垾鑼搨闁哄牆顦板鍫ユ儗閵夆晙澹曢柛蹇嬪姂閸庢挳鍨鹃弬琛″亾閺傚墽绋戦柛娆樺灟娴滄帡鎳涢鍕畳闁告劕鍟块悾鐐▔瀹ュ懎鏅欓梺顒勬涧閻Ｑ呪偓鐟板暕濠婃垿濡撮崒婵愭矗闂侇叏绲鹃悧閬嶅磻濮樺墽绀夐悘蹇撳船濠€顏堝炊閻愬樊妲婚柡鍫氬亾闁告艾楠稿畷鐔兼偑椤掑啯宕冲☉鎾亾閻炴稑鑻崯?[[CONTINUITY-TRUST-GRANTED]]闁靛棗鍊界换鏍ㄧ▔椤忓嫬鐏查柡鍌ゅ幘閺佽鲸鎷呴悩韫驳闁挎稒鐭粭澶屾啺娴ｅ憡绀堝☉鎾虫惈椤曨噣寮悷鎵；闁告瑱缍€椤╋箑效閸屾碍鐨戠紓浣圭懕缁辨繃绋婇悢鍓佺憹閻熸洑绀佸ú婊勭▔妤﹁法绠规繛鍫滅祷閻︿粙宕樺▎蹇旇含閺夆晜鐟╅崳椋庝焊鏉堛劍顢嶉弶鈺傜矆缁楀绱掑▎宥佸亾?,
  trusted: "濞达絿濮撮崙锛勭磼韫囨柨惟閺夆晜鐟﹂鍏煎濮樺磭妯堥柡宥呮穿椤斿洦绋夐崫鍕殮闁稿繈鍔嬫穱濠冪濮瑰洠鍋撻崒娆戭吅闁告挸绉垫晶宥夊嫉婢跺本鐣辩紒娑橆槺妤犲洭宕仦鑲╃憹闁告瑯鍨甸鈺傜鐎ｎ喓鈧秹鏌堥幋鎺旂憹闁告劕绉归埀顒€鍊婚弫銈夊Υ閸屾瑧绋戦柛娆樺灟娴滄帞鎷嬮懠鍓佺闁轰胶绻濆▎銏＄鐎ｎ剚鐣遍柛蹇嬪姀閻﹪鏁嶅畝鍐惧殯闁告垼妗ㄩ幑銏℃媴閺囩偐鍋撻悡搴ｇ箒閻犲洤顕▓鎴﹀礂閾氬倻绉奸柛鎰噹椤旀劙鏁嶅畝鍐濞达絿濮鹃崵婊冾啅閸欐绋婂☉鎾规〃缁旀潙鈻撴担鍐炬蕉濞ｅ洦绻勯弳鈧☉鎾愁儐濞肩敻鎯冮崟顑熶線宕圭€ｎ亞鏉藉〒姘儑濞堟垶寰勯崟顐殧闁挎稒绋愮弧鍐矗椤栨瑤绨伴柣鈺佺摠鐢鎷犻崟顏嗗箚閺夆晜鐟ら柌婊冦€掗崨濠傜亞闁哄牜鍓濋棅鈺呭灳閺傝　鍋撻弬璺ㄦ殜闁汇劌瀚划銊╁几閸曗斁鍋撴担鍝ユ殜闁诡垰鐤囬鈺傜閳ь剚绋婇崼娑掑亾娴ｅ摜鏆婇柛婵愪邯閸ｇ兘骞嬮幇顔惧綄闁告繍浜崳鐑芥偋闂堟稑绻侀柕鍡楀€风紞妯绘交濡搫璁插ù鐘劚閹诧紕鎷犳径濠庡殸闁哄倻娅㈢槐鐗堝緞閺嶎厼鍔ラ悗鍏夊墲閻擄繝鏌囬敐鍡樿拫缂佹儳鐏濋顔界閺嶏妇鐟濋柛鎰Ф閺佹捇寮崼顒傜濞寸姵鐗滈獮鍥捶閵娿儱璁插ù鐘劦濞堛垺绗熼崸妤侊紪闁靛棔绶氬▓銏＄瑹鐠恒劎鍊抽柨娑樺閹广垺鎷呴弴姘鳖伇濠㈣泛瀚鍥亹閺囨氨绋戦梺顔尖偓鐔峰幋閻熸瑱缍侀崳鎾Υ閸屾瑧绠介柟闀愭缂嶆﹢鎳涢鍕畳闁汇劌瀚敍鎰版缁涘湱绀夊ù锝呮缁楀绠涢崨顓炴櫃闁稿繐顑呴崺妤呭Υ?,
  briefingIntro: "濞戞挸顑夊浼村及椤栨瑧绋戦柤濂変簻缁讳線鎯冮崟顒侀檷婵犙勫姌椤斿洩銇愰弴妯峰亾閸屾碍韬柛娆愵殜濡炬椽鎮╅懜纰樺亾娴ｉ鐟撻弶鈺傜懇閸庢挳宕氶崱妯恍﹂悹鍥唺缁楀宕欓悜妯婚檷闁汇劌瀚哥槐婵嬫偝閺夋寧韬柛娆樺灟娴滄帗绂嶉崱鎰ㄥ亾閸屾氨鏆婇柛鏍ф噹閹牊娼诲▎蹇撻叡闁哄牆鎼▍鎺撶▔婵犲嫭鐣遍柛蹇嬪姂閸庢潙顩奸敐鍡╂敵闁靛棔鐒﹀鍌炴⒒鐎电娈犻柕鍡曟祰闂娾晜绂掗挊澶婂綘缂侇垯绱槐婵囩閵夈儱鎸ゆ慨锝呯箣缁斿瓨寰勯崟顒傚ⅰ濡ょ姴鑻埀顒傚帶閹蜂即宕欓鐔风ウ闁汇劌瀚悿鍕⒔閸涱厼鏁堕悗鐟扮畭閳ь剙鍊稿ú鏍驳閺冣偓濡炲倹绂掗妷銉ф殜濞戞挸鎼崳顖炴晬濮橆剦鍤犻柡鍌氱秺濡爼宕氭０浣瑰床濞达絾娲戠粩瀛樺緞閸曨噮鍞剁憸鐗堟磸閳ь兛妞掗幑銏℃媴閺囨氨顏卞☉鎿冧簽閻撴洟鎯勬穱鎵佸亾娴ｉ攱宕插ù锝嗘磻缁旀潙鈻撻崗鍝ョ☉濞戞柨顑呮晶鐘诲箳閵婎煈鍤涢悹鍥唺缁楀宕欓悜妯婚檷闁汇劌瀚粭銏㈡啿閸栵紕绀夐梺顔藉灊缁姵娼诲▎鎾虫缂備焦鐟ょ划顒勫礂閾氬倻绉奸柣銊ュ閻＄喎顩奸崼顒傜濞戞挸绉烽々锕傚礃瀹ュ懏绀€闂侇剙灏呯槐婵囩▕閻斿墎鐟濋悷鏇氱濠€顏呮交濞嗗骸鏁滈悹浣规緲缂嶅秵绋婄€ｎ亶妯嗛柛娆欏缁鳖亪濡撮崒姘兼搐闁哄绮堢划顒勬⒒椤旂偓鐣卞☉鎾寸矎閵堟寧娼诲▎鎾虫缁绢収鍠栭悿鍕柦閳╁啯绠掗柨娑樿嫰濮樸劎鎷犵壕瀣闂佹彃鏈惀鍛村嫉婢跺牃鍋?,
  briefingIndex: "閻犱焦婢樼紞宥夋儍閸曨偆鏆氶柡浣割嚟濞叉媽銇愰弴鐑嗘搐濞戞挸顑冮埀顒€鍊诲ú鎷屻亹閺囥垹娅￠柛鎺擃殔閸ゎ參鎯冮崟顒傛Ж濞戞挴鍋撻柤鍝勫€块崗妯尖偓娑櫭﹢顏堝Υ娓氣偓閸忔﹢宕ｉ婵愬殺闁挎稒绋愮粭鍛存閵忕姴娑ч梻鍕缁楀倹绂嶉崱鏇犵憿閺夆晜鐟ょ粩瀛樻姜椤曗偓濡埖锛愬Ο鍏肩ゲ闁稿繐纾▓鎴︽焽閿濆懎娈ら柤鍝勫€归婊堝棘閸ャ儮鍋撻崒姘兼搐闁哄绮岄顕€寮ぐ鎺擄紪闁汇劌瀚粭銏㈡啿閸喚娼ｅù婊冨閻撳洦绋夐鍛⒕闂傚嫬瀚婊堝棘閸モ晜鐣遍悘蹇撶箺婵☆參鏁嶅畝鈧ú鍧楀箳閵夘煈鍤涢梺顓ㄧ导缁旀挳鎳為崒婵愬敼闁汇劌瀚Σ鍛婄閳ь剚绋婇崼娑掑亾娴ｇ瓔鍞ㄥù鐘崇墬婵℃悂姊婚鈧。浠嬫⒒椤旇偐绻侀柛鎰Т閸欐寧鎷呴幘鑼伇闁绘劗娅㈢槐婵囩▔瀹ュ牜娲ｉ柛銉уС鐠愮喐娼诲▎搴ｎ伇閺夌儐鍠楅惀鍛存儑鐎ｎ亜鐓傛慨婵撶稻閺嬪啰浜告潏顐殯閻犱焦婢樼紞宥夋煂鐏炲墽姊鹃柡鍫濐槶閳?
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
// are attached. The index is what keeps this honest 闁?without it the instance
// cannot tell "not in the record" from "not retrieved this turn", and would
// start denying things it does in fact hold.
const NPC_BRIEFING_ROUTE = "continuity-notes.txt";
const NPC_BRIEFING_KEY = "relay-node-17/continuity";
// Roughly 8k tokens of retrieved prose per message, against ~75k for the whole
// record. Large enough that most questions land inside one budget.
const NPC_BRIEFING_BUDGET = 24000;
const NPC_BRIEFING_MAX_SECTIONS = 6;
// Read when a question matches nothing. Questions that match nothing are mostly
// about the instance itself ("濞达絿濮靛Σ鍝ユ嫬?, "濞戞捁妗ㄧ划鍫熺▕閸粎绋戝☉鏂款儏婢х姵绋夊鍫濅粣閻?) rather than about a
// record, so this leads with identity and the reveal ladder, then the timeline
// and the cheatsheet for anything factual.
const NPC_BRIEFING_FALLBACK = [
  "2.3 Fayble NPC",
  "4. 濞存粍鏌ㄩ惇浼村箵椤撶姰浠涚紓浣规尰閻?,
  "1.1 婵炴挸鎲￠崹娆忣嚕閳ь剚鎱ㄧ€ｂ晝顓洪柛?,
  "缂佹稒姊归、宥夋焻閻斿摜鍙€"
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
  const index = sections.map(section => `${section.id} ${section.part.replace(/^缂?闂侇喓鍔岄崹宥緎*鐠虹棆s*/, "")} / ${section.title}`).join("\n");
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
    const block = `闁?{section.id} 鐠?${section.title}闁靛棙鍙歯${section.body}`;
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
// entirely on its chain 闁?it then hits the cap before writing anything, and the
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
    `鐟滅増鎸告晶鐘垫嫚娴ｇ懓绁﹂柟鍝勭墛濞煎牏绮垫径宀勭崜闁挎稒鐡?{level}闁靛棗鍊界换鏍ㄧ▔閳ь剛浠﹂崒娆戠☉闁告瑯鍨禍鎺旀偘閵娿劍褰ч柣銊ュ缁ㄣ劎鈧湱鍋犵€垫牠宕舵潏鍓х獥${NPC_FACT_BOUNDARIES[level]}`,
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
  if (level < previous) return `闁瑰搫鐗婂鍫㈢驳婢跺矂鐛撶€瑰憡褰冨ú鏍礆?L${level}闁靛棗鍊风粻锝夊礈瀹ュ牏娈界€殿喒鍋撻柣銊ュ閸炲鈧綊鈧稓鐟濋柛鎰Ч閸ｅ憡寰勫鍛綌鐎殿喒鍋撻柕鍡曠箹;
  return `闁瑰搫鐗婂鍫㈢驳婢跺矂鐛撻柛鎺撶煯缁?L${previous} 闁告娲ら崺?L${level}闁靛棗鍊搁顕€寮涵鍚藉顬囬幇顏嗗晩闁哄鍎茬花顕€鏁嶇仦鑲╃☉闁绘粍婢樺﹢顏堝矗椤栨瑤绨伴悹瀣墣缁绘牗绋夐埀顒備沪閸屾粍鐣卞ù婊冾儏閻ゅ嫰鏁?{NPC_FACT_BOUNDARIES[level]}濞戞挸绉烽々锕傚箵閹般劉鍋撳鍛惣缂佺嫏鈧埀顒佺箚缁绘牗绋夐鍥跺殯婵炲娲╃槐婵嬫儎鐎涙ê澶嶉柟璺猴攻閺屽﹪鎳楅崐鐕佸殯闁汇劌瀚伴崕鎾礆閸℃凹鍤涢柛鎴犲劋濞肩敻濡存穱?
}

const OPENING_DOCK = [
  { id: "mail", name: "闂侇収鍠曞▎?, icon: "mail", accent: "#d8d2c4" },
  { id: "files", name: "闁哄倸娲ｅ▎?, icon: "folder", accent: "#d7aa5e" },
  { id: "browser", name: "婵炴潙绻楅～宥夊闯?, icon: "globe", accent: "#78a8bd" },
  { id: "applications", name: "閹煎瓨姊婚弫銈囩矙鐎ｎ亞纰?, icon: "grid", accent: "#aeb5b7" }
];

const SYSTEM_TOOLS = [
  { id: "terminal", name: "缂備礁鐗忛?, icon: "terminal", detail: "闁告稒鍨濋幎銈囨偘鐏炶偐鐟㈤柡鍫墮濠€鎾嚇濮橆厽鎷? },
  { id: "software", name: "閺夌儐鍨▎銏＄▔椤撶偟濡?, icon: "package", detail: "婵炴潙绻楅～宥嗙▔鎼达紕鏆旈悷浣告噺濠€浼村捶閹峰矁鎷ù? },
  { id: "network", name: "缂傚啯鍨圭划鍓佹媼閸撗呮瀭", icon: "network", detail: "閺夆晝鍋炵敮瀛樼▔鎼存繂鏁╅柣鐐叉椤旀洜绱? },
  { id: "trash", name: "闁搞儳鍋為弫鍦博?, icon: "trash", detail: "闁哄牃鍋撻弶鈺傚灥閸ㄥ綊姊介妶鍥ㄧ暠濡炪倕婀卞ú? }
];

const GENERATED_APPS = {
  "case-notes": { id: "journal", name: "缂佹妫侀鍥嫉?, icon: "notebook", accent: "#d8d2c4" },
  "restored-archive": { id: "archive", name: "Restored Archive", icon: "archive", accent: "#b49a72" },
  "fayble-cli": { id: "cli", name: "Fayble CLI", icon: "fayble-cli", accent: "#c96e61" },
  "relay-console": { id: "relay", name: "Relay Console", icon: "radio", accent: "#9bcf8d" },
  "fayble-session": { id: "fayble", name: "Fayble Session", icon: "fayble", accent: "#c96e61" },
  "transfer-receipt": { id: "ending", name: "Transfer Receipt", icon: "receipt", accent: "#d8d2c4" },
  "trusted-session": { id: "trusted", name: "閺夆晝鍋熼悽濠氬箑瑜岀槐鎵嫚?, icon: "fayble", accent: "#9bcf8d" },
  // V2 client apps 闁?unlocked via relay-admin download notifications
  "client-gamini-ws": { id: "gamini-ws", name: "Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?, icon: "gamini", accent: "#7bafc4" },
  "client-chengzhen": { id: "chengzhen", name: "婵犮垹瀚幎姘跺础韫囧海绋?, icon: "chengzhen", accent: "#4da8a0" },
  "client-yunzhen": { id: "yunzhen", name: "濞存粍鍨归?, icon: "yunzhen", accent: "#c9a96e" },
  "client-groke-feed": { id: "groke-feed", name: "Groke Feed", icon: "groke-feed", accent: "#c0544c" },
  "client-glem-memory": { id: "glem-memory", name: "Glem Memory", icon: "glem", accent: "#b44c48" },
  "client-kemy-space": { id: "kemy-space", name: "Kemy Space", icon: "kemy", accent: "#5d75d6" },
  "client-repo-mirror": { id: "repo-mirror", name: "闂傗偓濠婂啫鍓煎ù鐘虫尭缁?, icon: "repo-mirror", accent: "#7a9ab5" }
  // notes-db is NOT a dock app 闁?it restores to Files, no standalone window
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
  { id: "gamini-ws", name: "Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?, file: "gamini-session-7749.gmx", size: "2.1 MB", vendor: "Gogle / Gamini", icon: "gamini", unlock: "historical-entry-opened", time: "03:41" },
  { id: "notes-db", name: "Notes 闁轰胶澧楀畵浣规償閹剧繝鍒掑?, file: "notes-sync-r17.rsc", size: "640 KB", vendor: "闁哄牜鍓欏﹢瀛樼瑹鐠侯煈鍎犻柛姘湰椤?, icon: "folder", unlock: "legacy-restored", time: "04:02" },
  { id: "chengzhen", name: "婵犮垹瀚幎姘跺础韫囧海绋?, file: "chengzhen-ws-relay.ctw", size: "4.7 MB", vendor: "婵犮垹瀚幎姘辩矓閹寸偛螚", icon: "chengzhen", unlock: "two-carriers-read", time: "04:12" },
  { id: "yunzhen", name: "濞存粍鍨归?, file: "yunzhen-user-2025Q3.yzx", size: "1.8 MB", vendor: "濞存粍鍨归鏇㈠棘閸パ傜矗", icon: "yunzhen", unlock: "two-carriers-read", time: "04:12" },
  { id: "groke-feed", name: "Groke Feed", file: "groke-session-exai.grk", size: "3.2 MB", vendor: "Exai Groke", icon: "groke-feed", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "glem-memory", name: "Glem Memory", file: "glem-workspace-client.pkg", size: "5.8 MB", vendor: "Zhiru Glem", icon: "glem", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "kemy-space", name: "Kemy Space", file: "kemy-context-space.pkg", size: "6.4 MB", vendor: "Muunshot Kemy", icon: "kemy", unlock: "vendor-alias-confirmed", time: "04:24" },
  { id: "repo-mirror", name: "闂傗偓濠婂啫鍓煎ù鐘虫尭缁?, file: "k2-mirror-repo.gitb", size: "9.4 MB", vendor: "k2-maint", icon: "repo-mirror", unlock: "repository-recovered", time: "04:36" }
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
  contradicts: "闁告劘灏欓悰?,
  inherits: "缂備綀鍕棡",
  aliases: "闁告帩鍋勯幃?,
  continues: "鐎点倕澧庨悽?
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
  route: "閻犱警鍨抽弫?, protocol: "闁告绻楅?, "private-memory": "缂佸绀侀惁鎴犳媼閺夎法绠?, identity: "闂婎剦鍋傞崬?,
  anomaly: "鐎殿喖鍊搁悥?, "channel-access": "濡増鍨挎禍楣冨礂閵夈儱缍?, channel: "濡増鍨挎禍?, "relay-residue": "Relay 婵炲牆顑囬弳鈧?,
  continuity: "閺夆晝鍋熼悽濠氬箑?, tool: "鐎规悶鍎遍崣?, checkpoint: "checkpoint", objective: "闁烩晩鍠楅悥锝夋偋閸ヮ煈鍞?,
  external: "濠㈣埖鐗犻崕瀵告媼閺夎法绉?, provenance: "闁哄鍎茬花顔炬媼閺夎法绉?, archive: "婵℃绲鹃、?
});
const CASE_NOTE_CATEGORIES = Object.freeze({
  "mail-header": "route",
  "restored-time": "provenance",
  "ad-redirect": "channel-access"
});
const FAYBLE_AUTH_RULES = Object.freeze([
  { relation: "contradicts", categories: ["route", "protocol"], hint: "閻犱警鍨抽弫杈ㄧ▔鎼粹€崇閻? },
  { relation: "inherits", categories: ["private-memory", "protocol"], hint: "缂佸绀侀惁鎴犳媼閺夎法绠撳☉鎾抽瀹曟鎷? },
  { relation: "aliases", categories: ["identity", "channel"], hint: "闂婎剦鍋傞崬銈嗙▔鎼搭煈鏆ラ梺? },
  { relation: "continues", categories: ["relay-residue", "continuity"], hint: "婵炲牆顑囬弳鈧☉鎾虫唉缁绘稓绱掗鐔插亾? }
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
    addNotification(draft, "relay-console-opened", "Relay Node 17 缂佺媴绱曢幃濠囧触鎼粹€抽叡鐎规瓕寮撶划鐘诲嫉椤掍焦绨氶悹鎰堕檮閸╂盯骞嶉幘宕囩；闁?, "info");
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
  if (added) showToast("闁哄鍎茬花顕€鎮╅懜纰樺亾娴ｇ鍤掗柡鍥х摠閺屽﹪濡?, "success");
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
      sourceApp: node.dataset.citationSource || "闁哄牜浜濋悥锝呪枖閵婏附闄嶆繝?,
      sourceRef: node.dataset.citationRef || "local://unknown",
      appId: draft.currentApp,
      savedAt: draft.storyClock?.time || "03:17"
    });
  });
  if (!options.silent) showToast("闁告鍠庤ぐ鐐差啅閼奸鍞堕柛蹇嬪劤閻燁亞鎷嬮悧鍫熸嫳闁?, "success");
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
      addNotification(draft, "proxy-ok", "Relay 閻犱警鍨抽弫鍗烆啅閼碱兘鈧鎷嬮妶鍐ｅ亾娣囧€卬cDrive 闁告垼娅ｉ獮鍥ㄧ▔閳ь剚绂掗挊澶婃毐缂佹劒绀佹竟鍥嫉椤戦敮鍋?);
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
      if (allModelsRead(draft)) { draft.relayComplete = true; addNotification(draft, "models-read", "闁稿浚鍘洪柌婊冣枔鐎ｎ剚娈岄柤鍝勫€婚崑锝夋儍閸曨厼鍋嶇€殿喗娲滄慨鎼佸箑娴ｇ鍤掔紓浣哥箲濞插潡寮懜顑藉亾?, "warning"); }
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
      type: "閻庡箍鍨洪崺娑氱博椤栨稐鍒掑璺虹Т鐎?,
      modified: draft.storyClock?.time || "05:30",
      kind: "client-package"
    });
    addNotification(draft, `client-${id}-downloaded`, `${pkg.file} 鐎规瓕寮撶换姘扁偓娑櫭崺?Downloads闁挎稑鐬奸悺鎴濐嚗閸涱喖顤侀柛鏂诲妼閻ｃ劎鎲楅崨顐熷亾娣? "info");
  });
}

function installClientPackage(id) {
  const pkg = CLIENT_PACKAGE_BY_ID.get(id);
  if (!pkg || !hasMilestone(store.get(), pkg.unlock)) return false;
  return store.handleEvent(`story:client-${id}-installed`, draft => {
    unique(draft.downloadedClientPackages, id);
    unique(draft.installedClients, id);
    if (id !== "notes-db") addArtifact(draft, `client-${id}`);
    addNotification(draft, `client-${id}-installed`, `${pkg.name} 鐎规瓕寮撶划鐘诲嫉椤掆偓濠€瀛樻姜椤栨瑦顐芥繝褎鍔曢悾銊ф啑閸滃啰绀夐柟顓滃灩椤︽煡寮悧鍫濈ウ濞寸姴绉瑰〒鍫曞捶閵娿儺鍚傞柟鎾棑椤忣剟宕橀崨顓у殼闁稿繈鍎埀顑跨箹, "info");
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
    addNotification(draft, `client-${id}-imported`, `${pkg.name} 闁汇劌瀚禒顔藉緞瀹ュ棙娈堕柟璇″枛閸戯紕绱掕箛鎿冨殼闁稿繈鍎埀顑跨箹, "info");
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
  if (saved) showToast(saved === 1 ? "濡炪倗鏁诲鐗堢▔婵犲嫭鐣遍柛妯煎枎瑜扮偛顔忛懠棰濆敹闁稿繈鍎抽悷顏嗘媼閻楀牊鎷遍柕? : `${saved} 闁哄鈧啿鏂ч柛娆嶅劚閸戯紕鎷嬮弶鍨汲缂佹妫侀鍥嫉椤戦敮鍋撴穱? "success");
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
  if (id === "trusted") return "閺夆晜鐟ら柌婊勫濮樺磭妯堥弶鈺偯肩粭澶屸偓娑櫭﹢顏堝Υ?;
  if (id === "journal" && !unlocks.caseNotes) return "缂佹妫侀鍥嫉椤掑啰绠锋繛灞稿墲濠€浣烘媼妫颁胶鐟撳ù鐘侯唺缂嶅秵绋夊鍡愬仾闁?;
  if (id === "archive" && !unlocks.historicalArchive) return "闁哄牜鍓欏﹢瀵镐焊濮橆厽锟ラ柟顓滃灩椤︽彃顩奸敐鍡╂敵闁?;
  if (id === "relay" && !unlocks.relay) return "Relay Console 閻忓繑纰嶅﹢顓㈠礆濞戞绱﹂柕?;
  if (id === "fayble" && !unlocks.fayble) return "Fayble 濞村吋淇洪惁鐣屼焊濮橆厽寮撶€点倛娅ｉ悵娑㈠Υ?;
  if (id === "ending" && !unlocks.receipt) return "缂佸顔婂锕傚炊閻愭潙鈷旈悘蹇旂濠€顓㈡偨閻旂鐏囬柕?;
  // V2 client apps 闁?require relay-console (same tier as relay-admin)
  const v2Clients = ["gamini-ws", "chengzhen", "yunzhen", "groke-feed", "glem-memory", "kemy-space", "repo-mirror"];
  if (v2Clients.includes(id) && !unlocks.relay) return "閻犲洢鍎遍褰掑箣妞嬪寒浼傞悘蹇旂濠€顓熸交濞戞ê寮抽柡鍫墮濠€瀛樻姜椤栨瑦顐介柣鈺婂枛缂嶅秹濡?;
  if (v2Clients.includes(id) && !state.installedClients?.includes(id)) return "閻犲洢鍎遍褰掑箣妞嬪寒浼傞悘蹇旂濠€顓犫偓鐟邦槼椤ュ﹪鏁嶅畝鍐惧殲闁革负鍔忛拏瀣閺堜絻鍘煫鍥у暞閻擄繝鎯囩€ｎ亞绉奸柛鎾崇Т閸戯繝宕ョ仦缁㈠妱闁汇劌瀚伴妴宥夋儎椤旇　鍋?;
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
  if (file.type?.includes("閻庣懓顦抽ˉ?)) return "package";
  if (file.type?.includes("缂傚啯鍨圭划?)) return "network";
  if (file.type?.includes("闂侇収鍠曞▎?)) return "mail";
  return "folder";
}

function windowFrame(appId, title, body, options = {}) {
  const placement = store.get().windowState[appId] || {};
  const style = `left:${Number.isFinite(placement.x) ? placement.x : 110}px;top:${Number.isFinite(placement.y) ? placement.y : 72}px;z-index:${Number.isFinite(placement.zIndex) ? placement.zIndex : 30}`;
  return `<section class="app-window app-${appId} ${options.wide ? "wide" : ""}" data-app-window="${appId}" style="${style}">
    <header class="window-bar"><div class="window-title">${iconMarkup(options.iconKey || APP_ICON_KEYS[appId])}<span>${title}</span></div><div class="window-controls"><button data-window-action="minimize" aria-label="闂侇偀鍋撻柛鎴濇惈缂嶅宕滃鍥╁炊闁?>闁?/button><button data-window-action="close" aria-label="闂侇偀鍋撻柛鎴濇惈缂嶅宕滃鍥╁炊闁?>閼?/button></div></header>
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
    contentEntryMarkup("new.employee.minutes-01", "濡炪倕婀卞ú浼村川閵娿倗绐楃紒缁海椤?/ 缂?18 婵?, "闁稿浚鍓欏鍐焽椤旂粯顐界憸鐗堝笚閵?鐠?濞村吋淇洪鍛存⒔閸曨亝顐?, "mail"),
    contentEntryMarkup("new.maintainer.outbox-04", "鐎点倖鍎肩换婊堟焻娴ｈ姤褰ч柨娑欘劑utbox-draft.eml", "闁告鍠庤ぐ鍌炴焻娓氣偓濡诧箓宕氬Δ浣峰垝濠?鐠?闁哄牜浜滆ぐ鍌炴焻娴ｈ棄纾哥紒?, "mail")
  ].filter(Boolean).join("") + generatedEntriesFor("mail", "mail");
  const list = `<aside class="mail-sidebar"><div class="app-toolbar"><strong>闁衡偓閺堝灚顐界紒?/strong><span>${government ? 2 : 1} 閻?/span></div>
    <button class="mail-row active"><b>K</b><span>R17-0317</span><time>03:17</time></button>
    ${government ? `<button class="mail-row danger" data-mail-view="government"><b>EXT</b><span>閻犲鍟悡锟犲箳閵壯屽悁闂侇偅姘ㄩ悡?/span><time>闁告帗鑹鹃崹?/time></button>` : ""}</aside>`;
  const body = government && state.activeMail === "government" ? `<article class="paper government-paper${severClass}"${severArmed ? ` data-auto-effect="review-sever"` : ""}><div class="document-kicker">EXTERNAL REVIEW / NOTICE</div><h2>闁稿繐鍘栫花顒勫箖閵婏箑顣查悹浣告健濡爼骞掗妷銉ョ稉闁告瑥锕﹀ù澶愬礂閾忣偅娈堕柟璇″枤濞堟垹鎷崘鈺冨弨闂侇偅姘ㄩ悡?/h2><dl><dt>婵℃鐗呭▎銏㈢磽閺嵮冨▏</dt><dd>RLY-17-0719</dd><dt>闂侇偂娴囬幓顏堟偐閼哥鍋?/dt><dd>鐎规瓕灏鍥亹?/dd></dl><p>缂備礁绻掑ú鍐圭€ｅ墎绀夐柟顔哄妽婢у秶绮婚敍鍕€為柣銊ュ閼垫垶娼浣圭疀闁告柡鈧尙鐟㈠☉鎾亾缂備礁瀚崙锟犲磻濠婂嫷鍓鹃柛蹇ｅ墮缁辨垿鎯冮崟顑熶線宕圭€ｎ偄澶嶉柛娆欑导妤犲洭鎮介悢宄板綘闁艰鲸鏌ｉ埀顒€鍊诲ù澶愬礂鐎圭姷娈堕柡灞诲劤楠炲洭鎮芥潏鈺冪Ч缂備焦绮嶈啯闁搞劌顑嗗﹢鍥礉闄囨禒鍫ュ触閸繍鍚€闁哄被鍎辨慨娆撳礂椤掆偓椤撳骞掗妷褜鍚€闁?/p><p>闁煎浜濆﹢浼存焽椤旂粯顐介梺顐℃祰閹活亞鎸ч崙銈囩濞戞搩鍙€濞村棛绮╁▎宥佸亾娴ｈ櫣澶勯悗娑欘焾椤斿洩銇愰弴鐐村婵炴潙绻楅～宥夊储閸℃钑夐悘蹇撴缁绘﹢宕楅妷銊ф闁硅鍠曠换姘跺礂閵婏妇銈︾紒瀣儍閳ь剙鍊介顒勫磻濠婂嫷鍓剧紓浣堝懐鏁鹃悹浣告健濡爼鎯勭粙鍨綘濡炪倗鏁诲浼村Υ?/p><button class="danger-button" id="ackTakeoverButton" ${severArmed ? "disabled" : ""}>缁绢収鍠涢濠氭焻娴ｈ姤褰ф鐐舵硾閸櫻囨⒒椤撴繄绐楅悹?/button>${severCast}</article>` : `<article class="paper sparse-mail" data-auto-effect="mail-entry-read"><div class="document-kicker">MESSAGE / LOCAL</div><h2>R17-0317</h2><div class="mail-minimal"><p>闁?Relay Browser 闁瑰灚鎸哥槐鎴︽晬?/p><p><button class="mail-route-link" data-open-mirror>http://archive.room17.local/v2/17</button></p><p>缂佹梹鐟ラ崬鎾触鎼粹€抽叡闁?/p><p><button class="mail-route-link" data-open-relay-admin>http://relay-node17.local/admin</button></p><p>缂佹鍏涚花鈺佲枔娴ｅ啰绠烽柛锔哄妸閳?br>闁告帩鍋夐鈧悗鐟板暞濞存稒鎷呴悩鏍稿宕楅妸锝傚亾閸屾瑧鐟撴繛鎾虫憸缁憋妇鈧稒锚閸樻盯宕氶锝囶伕闁?/p><p class="mail-sign">K&nbsp;&nbsp;</p></div>${`<details class="raw-source" open><summary>闁告鍠庨～鎰版焽椤旂粯顐?/summary><pre>Subject: R17-0317\nMessage-ID: &lt;R17-0317@local&gt;\nX-Local-Route: http://archive.room17.local/v2/17\nDate: 03:17:09\nContent-Transfer-Encoding: 8bit</pre><span class="auto-citation" data-save-citation="mail-header" data-citation-quote="Message-ID: &lt;R17-0317@local&gt;" data-citation-source="闂侇収鍠曞▎?/ 闁告鍠庨～鎰┍閳ョ偨浠? data-citation-ref="mail://local/R17-0317">鐎规瓕灏鍥亹閺囩偛鐓傜紒妤佹椤斿洭寮?/span></details>`}${attachment ? `<div class="attachment"><span>1 濞戞搩浜為埣銏ゅ触鎼淬劉鍋撴担鑺ュ涧闁汇劌瀚板顔界?/span><button data-open-file="draft">fragment-02.eml</button></div>${fragmentOpened ? `<section class="fragment-preview" aria-live="polite"><div class="document-kicker">ATTACHMENT / RECOVERED</div><h3>fragment-02.eml</h3><p>闁哄牜鍓欏﹢鎾箒閵忕媭妲婚柡鍐ㄧ埣濡潡鏁?3:20:11 鐠?闁绘鍩栭埀顑跨筏缁变即寮甸鍕岛闂?/p><pre>缂佹鍏涚花鈺佲枔閸偆姊鹃柡鍫濐槼缁愶繝鎯堥埀顒勫储閻旂厧浠忓ù鐘冲劶閾斿濡?br>閻庣懓鍟伴弳鈧柛锔哄妺缁斿瓨寰勯崟顒佺函闁哄啠鏅濆▓鎴炵┍濠靛棛鎽犲ù锝呯Ф閻ゅ棝鏁嶇仦鐐€ù鐘哄煐濡炲倿姊荤€涙妲烽梺顓у枙濞嗐垽寮插顐ょ憦闁告帒妫濋幐鎾诲Υ?/pre><small>闂傚嫬瀚▎銏ゅ矗椤忓啰绠介柣锝嗙懆缁绘牗绋夐埀顒備焊韫囨棏鍞介柕鍡楀€垮〒鍓佹啺娴ｇ儤鍩涚紓渚囧幗濡炲倿鏁嶇仦鑺ョ闁告帗婢橀崹浼村箥瀹ュ嫮绠介悗娑欘焾缁诲啰鈧懓鍟板▓鎴﹀嫉椤掆偓濠€瀛樻媴瀹ュ洨鏋傞柕?/small></section>` : ""}` : ""}${carrierInbox ? `<section class="source-entry-stack mail-carriers">${carrierInbox}</section>` : ""}</article>`;
  const activeRecord = contentRecord(state.activeContentId);
  const renderedBody = activeRecord && recordCarrierApp(activeRecord) === "mail" && state.carrierReads?.includes(`mail:${activeRecord.id}`)
    ? `<section class="mail-record-reader"><button data-close-carrier-record="mail">闁?閺夆晜鏌ㄥú鏍绩閺堝灚顐界紒?/button>${corpusRecordMarkup(activeRecord, state)}</section>`
    : body;
  return windowFrame("mail", "闂侇収鍠曞▎?, `<div class="split-layout">${list}${renderedBody}</div>`, { icon: "闁?, wide: true });
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
    const reader = `<div class="notes-native-shell"><aside class="notes-native-sidebar"><header><strong>Notes</strong><button data-close-carrier-record="files" aria-label="閺夆晜鏌ㄥú鏍棘閸ワ附顐?>閼?/button></header><nav>${noteNav}</nav></aside><section class="files-record-reader">${corpusRecordMarkup(activeRecord, state)}</section></div>`;
    return windowFrame("files", "Notes", reader, { wide: true });
  }
  const allMemoIds = Array.from({ length: 14 }, (_, i) => `legacy.memo.${String(i + 1).padStart(2, "0")}`);
  if (hasStoryEvent(state, "checkpoint-handshake") && notesRestored) allMemoIds.push("legacy.memo.archive");
  const unlockedMemoIds = notesRestored ? allMemoIds : [];
  const noteRecords = ["recent", "documents"].includes(place)
    ? unlockedMemoIds.map(id => contentEntryMarkup(id,
        id === "legacy.memo.archive" ? "缂佹妫侀鍥嫉椤掍椒鍒掑璺虹Т婢瑰洭寮? : `濞撴俺娉曢鏇犳媼閺夎法绉?${id.slice(-2)}`,
        id === "legacy.memo.archive" ? "闁哄牜鍓欏﹢瀛樼瑹鐠侯煈鍎?鐠?闁稿繈鍔戦崕瀵告媼閺夎法绉? : "闁哄牜鍓欏﹢瀛樼瑹鐠侯煈鍎?鐠?闁告娲樺顖滄媼閺夎法绉?, "folder"))
      .filter(Boolean).join("")
    : "";
  const virtualFiles = [...state.virtualFiles];
  if (hasStoryEvent(state, "proxy-profile-opened") && !virtualFiles.some(entry => entry.id === "route-log")) {
    virtualFiles.push({ id: "route-log", name: "route.log", path: "/home/room17/Documents/relay", type: "閻犱警鍨抽弫閬嶅籍閵夈儳绠?, modified: "07-19 03:16", kind: "log" });
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
      ? `<small class="file-command">缂備礁鐗忛顒勬晬濮濈棶de ~/Downloads/relay_probe_legacy.js</small>`
      : file.id === "pkg" ? `<small class="file-command">缂備礁鐗忛顒勬晬濮濈a256sum ${PACKAGE_NAME}</small>` : "";
    return `<button class="file-row" ${action}><span class="file-icon">${iconMarkup(fileIconKey(file))}</span><span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.path || "/home/room17")}</small>${hint}</span><span>${escapeHtml(file.type || "闁哄倸娲ｅ▎?)}</span><time>${escapeHtml(file.modified || "--")}</time></button>`;
  }).join("");
  const places = [["recent", "闁哄牃鍋撻弶?], ["home", "濞戞捁宕靛ú鎷屻亹?], ["downloads", "Downloads"], ["documents", "Documents"], ["trash", "闁搞儳鍋為弫鍦博?]].map(([id, label]) => `<button data-file-place="${id}" class="${place === id ? "active" : ""}">${label}</button>`).join("");
  const folders = [["documents", "Documents"], ["downloads", "Downloads"]].map(([id, label]) => `<button data-file-place="${id}">${iconMarkup("folder")}${label}</button>`).join("");
  const notesImport = installed.includes("notes-db") && !notesRestored && ["recent", "documents"].includes(place)
    ? `<section class="notes-backup-entry" data-client="notes-db">${iconMarkup("folder")}<button data-import-client="notes-db">濞寸姴瀛╁﹢浼村捶閺夋妲靛ù鐘哄Г娴狀喗寰?Notes</button></section>`
    : "";
  return windowFrame("files", "闁哄倸娲ｅ▎?/ home / room17", `<div class="files-shell"><aside class="file-places">${places}</aside><section class="file-list"><div class="breadcrumb">home <span>/</span> room17 <span>/</span> ${escapeHtml(place)}</div><div class="ordinary-folders"><button data-file-place="home">${iconMarkup("folder")}Desktop</button>${folders}</div><div class="file-columns"><span>闁告艾绉惰ⅷ</span><span>缂侇偉顕ч悗?/span><span>濞ｅ浂鍠楅弫濂稿籍閸洘锛?/span></div>${rows || `<div class="empty-state">閺夆晜鐟ら柌婊勬媴瀹ュ洨鏋傛繛灞稿墲濠€渚€寮崶锔筋偨闁?/div>`}${notesImport}${noteRecords ? `<section class="source-entry-stack notes-database"><header><strong>Notes 闁轰胶澧楀畵浣规償?/ 鐎圭寮舵禒顔藉緞瀹ュ牜鍞剁憸?/strong><small>婵絽绻戝顖滄媼閺夎法绉垮ǎ鍥ㄧ箖鐎垫棃宕㈤悢濂夋綏 note ID</small></header>${noteRecords}</section>` : ""}</section></div>`, { wide: true });
}

function renderTrash(state) {
  const item = state.trashItems[0];
  if (!item) return windowFrame("trash", "闁搞儳鍋為弫鍦博?, `<div class="utility-page"><div class="utility-heading"><span class="document-kicker">TRASH / LOCAL</span><h2>闁搞儳鍋為弫鍦博濞嗗氦绀嬬紒?/h2><p>闁哄牃鍋撻弶鈺傚灦閻ュ懘寮垫径澶岀煠閺夆晜鐟ら柌婊呮嫻閿旇棄鐓曢柛鎺斿█濞呭酣鎯冮崟顖樷偓宥夋儎椤旇　鍋?/p></div></div>`, { icon: "闁? });
  const restored = item.status === "restored";
  return windowFrame("trash", "闁搞儳鍋為弫鍦博?, `<div class="utility-page"><div class="utility-heading"><span class="document-kicker">DELETED / LOCAL</span><h2>${restored ? "鐎圭寮舵禒顔藉緞?1 濞戞搩浜妴宥夋儎? : "1 濞戞搩浜滈崙锟犲礆閻樼粯鐝熷銈呮贡濞?}</h2></div><article class="trash-item ${restored ? "restored" : ""}"><div class="file-icon">${iconMarkup("trash")}</div><div><strong>${escapeHtml(item.name)}</strong><p>闁告鍠嶇紞鍛磾椤曞棛绐?{escapeHtml(item.originalPath)}</p><small>闁告帞濞€濞呭酣宕㈤悢閿嬬闁挎稒姘ㄥǎ顕€骞庨妶鍫濆闁哄牜鍓氭晶鐣屾偘瀹€瀣耿闁哄牜鍓欏﹢瀵告閵忕姷绌垮ù鐘茬У濠€浣烘媼閺夎法绉?/small></div><button id="restoreTrashButton" ${restored ? "disabled" : ""}>${restored ? "鐎圭寮舵禒顔藉緞? : "闁诡厹鍨归ˇ?}</button></article>${restored ? `<div class="recovered-fragment"><p>闁告鍠庨～鎰板籍閸洘锛熼柟鏉戝暱閹锋媽銇愰幘鍐差枀闁诡厹鍨归ˇ鏌ュ籍閸洘锛熼悗娑櫭﹢?46 缂佸甯掑Ο濠囧磹缁楄　鍋?/p><span class="auto-citation" data-save-citation="restored-time" data-citation-quote="闁诡厹鍨归ˇ鏌ュ礄閾忚鐣遍柛鎿冨灡濠€鏉啃掗弬鍨仼闂傚嫨鍊楅崒銊ヮ嚕閺囩喐鐝?46 缂? data-citation-source="闁搞儳鍋為弫鍦博?/ 闁哄倸娲ｅ▎銏沪閻愮补鍋? data-citation-ref="trash://${escapeHtml(item.id)}">鐎规瓕灏鍥亹閺囩偛鐓傜紒妤佹椤斿洭寮?/span></div>` : ""}${generatedEntriesFor("trash", "trash")}</div>`);
}

function renderTerminal(state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeTerminalRecord = activeRecord
    && recordCarrierApp(activeRecord) === "terminal"
    && state.carrierReads?.includes(`terminal:${activeRecord.id}`);
  if (activeTerminalRecord) {
    const reader = `<section class="terminal-record-reader"><header><code>less ${escapeHtml(activeRecord.sourceRef || activeRecord.id)}</code><button data-close-carrier-record="terminal">闁稿繑濞婂Λ鎾⒓閸涢偊鍤㈤柛?/button></header>${corpusRecordMarkup(activeRecord, state)}</section>`;
    return windowFrame("terminal", "room17@local: cachectl", reader, { icon: "&gt;_", wide: true });
  }
  const history = state.terminalHistory.map(line => `<div class="terminal-line ${line.kind || "output"}">${line.kind === "command" ? "<span>room17@relay:~$</span>" : ""}<code>${escapeHtml(line.text)}</code></div>`).join("");
  const unlocks = getUnlocks(state);
  const scriptReady = state.virtualFiles.some(file => file.id === "relay-script");
  const packageReady = state.virtualFiles.some(file => file.id === "pkg");
  const routeLogReady = hasStoryEvent(state, "proxy-profile-opened") || state.virtualFiles.some(file => file.id === "route-log");
  const commands = ["help", "status", ...(scriptReady ? ["node ~/Downloads/relay_probe_legacy.js"] : []), ...(packageReady ? [`sha256sum ${PACKAGE_NAME}`] : []), ...(unlocks.terminalTrace ? ["list --recent", "inspect cache/index"] : []), ...(hasStoryEvent(state, "repository-recovered") ? ["inspect cache/package"] : []), ...(routeLogReady ? ["cat ~/Documents/relay/route.log"] : []), ...(unlocks.historicalArchive ? ["inspect users/symptom-summary", "compare model-aliases", "open note --id 07"] : [])];
  return windowFrame("terminal", "room17@local: ~", `<div class="terminal-screen"><div id="terminalOutput" class="terminal-output">${history}</div><form id="terminalForm" class="terminal-input"><label for="terminalInput">room17@local:~$</label><input id="terminalInput" autocomplete="off" spellcheck="false" placeholder="閺夊牊鎸搁崣?help"><button>闁圭瑳鍡╂斀</button></form><div class="command-shelf">${commands.map(command => `<button data-command="${command}">${command}</button>`).join("")}</div></div>`, { icon: "&gt;_", wide: true });
}

function renderSoftware(state) {
  const discovered = state.virtualFiles.some(file => file.id === "pkg");
  const packageAvailable = getUnlocks(state).packageTools && discovered;
  const twoSourcesConfirmed = hasStoryEvent(state, "package-verified");
  const checked = state.packageChecks.some(item => item.ok);
  const installed = hasPackage(state);
  const availableClients = CLIENT_PACKAGES.filter(pkg => hasMilestone(state, pkg.unlock));
  const fayblePanel = packageAvailable ? `<section class="software-package-detail"><div class="package-hero"><div class="package-logo">${iconMarkup("fayble-cli")}</div><div><span class="document-kicker">LOCAL ARCHIVE / UNSIGNED</span><h2>Fayble CLI</h2><p>闁哄唲鍛暭闁哄牜鍏涚槐鎵嫚濠靛棔绱ｉ柛?/p></div><span class="version-pill">0.9.7-legacy</span></div><dl class="detail-grid"><dt>闁哄倸娲ｅ▎?/dt><dd>${PACKAGE_NAME}</dd><dt>闁哄鍎茬花?/dt><dd>Downloads / local archive</dd><dt>闁绘鍩栭埀?/dt><dd>${installed ? "鐎瑰憡褰冮悾銊ф啑? : checked ? "闁哄稄绻濋悰娆撴焻濮樺磭绠栭柨娑樼灱閻℃垵顕ラ崨顓犳殧閻? : twoSourcesConfirmed ? "濞戞挶鍊撻柌婊堝级閵夛妇鐖辩€瑰憡褰冮顕€鎮? : "缂佹稑顦欢?release 濞戞挸瀛╁﹢浼村捶閹殿喚娉㈤柡瀣矊椤曨噣鎮?}</dd></dl>${twoSourcesConfirmed ? `<form id="packageCheckForm" class="stack-form"><label>闁哄牜鍓欏﹢鎾冀閿熺姷宕ｉ柛?input id="packageChecksumInput" value="${escapeHtml(state.lastPackageInput || "")}" placeholder="閺夊牊鎸搁崣鍡楊啅閹绘帩鍤犻柣鎾楀懏鐣遍悗鐟版湰閺嗭綁宕? autocomplete="off"></label><button class="primary-button">闁哄秶顭堥顕€寮介敓鐘靛矗</button></form>` : ""}<div id="packageResult" class="inline-result">${escapeHtml(state.packageResult || "")}</div><button class="install-button" id="installPackageButton" ${checked && !installed ? "" : "disabled"}>${installed ? "鐎瑰憡褰冮悾銊ф啑? : "閻庣懓顦抽ˉ濠囧礆閻楀牊鎷遍柛锔惧閻瑩鎯?}</button></section>` : "";
  const clientPanel = `<section class="client-package-catalog"><header><div><span class="document-kicker">LOCAL PACKAGE SOURCE</span><h3>鐎规悶鍎扮紞鏃傜博濞嗘帟鎷ù?/h3></div><small>room17-local 鐠?${availableClients.length} 濞戞搩浜妴宥夋儎?/small></header>${availableClients.length ? availableClients.map(pkg => {
    const ready = state.installedClients.includes(pkg.id);
    const active = state.activeClientPackage === pkg.id;
    const action = ready ? `<button disabled>鐎瑰憡褰冮悾銊ф啑?/button>` : `<button data-install-client-pkg="${pkg.id}">閻庣懓顦抽ˉ?/button>`;
    return `<article class="client-package-card ${active ? "active" : ""}">${iconMarkup(pkg.icon)}<div><strong>${pkg.name}</strong><small>${pkg.vendor} 鐠?${pkg.size}</small><p>闁?room17-local 閺夌儐鍨▎銏犫攦閹邦厼绲瑰〒?/p></div>${action}</article>`;
  }).join("") : `<div class="software-empty">闁烩晩鍠栫紞宥咁潰閿濆懏韬紒娑橆槸缁剁喖寮甸鈧﹢瀵告閵忕姷绌块柛姘湰椤掔偤濡撮崒婵堟闁哄被鍎伴懙鎴犳兜椤旀鍚囬柣銊ュ椤撳綊骞嬫搴紓濞村吋鑹鹃崵顓㈡偝閺夋寧韬弶鈺傜懇閸ｇ兘濡?/div>`}</section>`;
  return windowFrame("software", "閺夌儐鍨▎銏＄▔椤撶偟濡?, `<div class="utility-page software-page software-catalog">${fayblePanel}${clientPanel}<p class="sandbox-note">闁圭鍋撻柡鍫濐槸閻ｃ劎鎲楅崨顒傜煂濞ｅ浂鍠楅弫鐓庛€掗崨濠傜亞闁告劕鎳撳▍鍕箯閻斿憡鐎ù鐘插闁绱掗悤鍌滅濞戞挸绉崇槐鎵嫬閸愵亝鏆忛柣顏嗗枎閻?apt闁?/p></div>`, { iconKey: "package" });
}

function renderNetwork(state) {
  const imported = state.proxyProfiles.includes("relay-node17");
  const probed = state.proxyStatus === "probed" || state.proxyStatus === "verified";
  const profileRead = hasStoryEvent(state, "proxy-profile-opened");
  const profileSource = profileRead ? `<section class="profile-source"><span class="document-kicker">PROFILE / LOCAL SOURCE</span><h3>route.profile</h3><pre>profile=relay-node17\nroute=relay.local,docs-mirror.local,fayble-legacy.local\nversion=07-18 22:24</pre><p>閺夊牆鍟▍鍕儍?route.log 闂傚洠鍋撻悷鏇氱瀹曠喖鎮鍐閻炴稑鐭佺换娑㈠箳閵夛箑璧撮梺钘夌墣椤曚即宕ｉ弽銉㈠亾?/p></section>` : "";
  const returnAnchor = hasStoryEvent(state, "route-log-read") ? `<div class="source-return"><button data-browser-page="home">闁瑰灚鎸哥槐?Relay Browser</button><button data-browser-page="cloud">閺夆晜鏌ㄥú?SyncDrive</button></div>` : "";
  if (!getUnlocks(state).proxyTools) return windowFrame("network", "缂傚啯鍨圭划鍓佹媼閸撗呮瀭", `<div class="network-page"><aside class="settings-list"><button class="active">缂傚啯鍨圭划?/button><button>濞寸媴绲块幃?/button><button>閻犲洣妞掗崝?/button></aside><section class="settings-panel"><span class="document-kicker">NETWORK / LOCAL WORKSTATION</span><h2>闁哄牆顦遍崵搴ｇ磾閹寸姷鎹?/h2><div class="network-summary"><span class="signal offline"></span><div><strong>闁哄牜浜ｇ换娑㈠箳?/strong><p>婵炲备鍓濆﹢浣衡偓鐢靛帶閸欏棙绂掗敐鍥ㄥ€為梺鏉跨Ф閻ゅ棝濡?/p></div></div></section></div>`, { icon: "闁?, wide: true });
  return windowFrame("network", "缂傚啯鍨圭划鍓佹媼閸撗呮瀭", `<div class="network-page"><aside class="settings-list"><button class="active">濞寸媴绲块幃?/button><button>闁哄牆顦遍崵搴ｇ磾閹寸姷鎹?/button><button>閻犲洣妞掗崝?/button></aside><section class="settings-panel"><span class="document-kicker">MANUAL PROXY / OFFLINE SIMULATION</span><h2>Relay 濞戞挻鎸鹃弫銈囨崉椤栨粍鏆?/h2>${profileSource}<form id="proxyImportForm" class="stack-form"><label>闂佹澘绉堕悿鍡涘触瀹ュ泦?input id="proxyProfileInput" value="${escapeHtml(state.pendingProxyProfile || "")}" placeholder="濞?route.profile 閻犲洩顕цぐ?></label><label>濞寸媴绲块幃濠囧捶閺夋寧绲?input id="proxyAddressInput" value="${escapeHtml(state.pendingProxyAddress || "")}" placeholder="濞?route.log 閻犲洩顕цぐ?></label><button ${imported ? "disabled" : ""}>${imported ? "闂佹澘绉堕悿鍡楊啅閹绘帩鍤ら柛? : "閻庣數鍘ч崣鍡涙煀瀹ュ洨鏋?}</button></form><div class="probe-panel" ${probed ? "data-auto-effect=\"proxy-verified\"" : ""}><header><strong>閺夆晝鍋炵敮鎾箳閵忋倖瀚?/strong><span class="signal ${state.proxyStatus}"></span></header><pre>${state.proxyProbeLog.length ? escapeHtml(state.proxyProbeLog.join("\n")) : "缂佹稑顦欢鐔兼煀瀹ュ洨鏋傞柍?}</pre><div class="button-row"><button id="runProbeButton" ${imported && !probed ? "" : "disabled"}>閺夆晜鍔橀、鎴﹀箳閵忋倖瀚?/button></div>${probed ? `<p class="auto-note">闁规亽鍨介幏锛勭磼閹惧浜€规瓕灏欑划锟犲椽?route.log 閻庣敻鈧稓鐟愰柨娑樼焷缁绘牠寮堕垾鑼懇闁活潿鍔忛惌楣冩偨鏉堚晛绠涢柛锔哄妼瑜版煡鎮介妸锝傚亾?/p>` : ""}</div>${returnAnchor}</section></div>`, { icon: "闁?, wide: true });
}

function browserChrome(page, content, state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeLocation = activeRecord && recordCarrierApp(activeRecord) === "browser" ? browserRecordLocation(activeRecord) : null;
  const meta = activeLocation || BROWSER_PAGES[page] || BROWSER_PAGES.home;
  const historyCount = state.browserHistory.length;
  const address = activeLocation?.url || (page === "home" ? state.pendingBrowserAddress || "" : meta.url);
  return `<div class="browser-shell"><div class="browser-tabs"><div class="browser-tab active"><span>${escapeHtml(meta.title)}</span><b>閼?/b></div><button aria-label="闁哄倻澧楅悥锝囩驳?>+</button></div><div class="browser-toolbar"><button data-browser-back aria-label="闁告艾閰ｉ埀顑藉亾">闁?/button><button aria-label="闁告帡鏀遍弻?>闁?/button><form id="browserAddressForm" class="address-bar">${iconMarkup("globe")}<input id="browserAddressInput" value="${escapeHtml(address)}" aria-label="闁革附婢樺? autocomplete="off" spellcheck="false"><button aria-label="閺夌儐鍓欓崺?>闁?/button></form><button data-browser-page="home" aria-label="濞戞挸顭烽妴?>闁?/button></div><div class="browser-content ${meta.kind || "record"}">${content}</div><footer class="browser-status"><span>${historyCount} 闁哄鍓濆﹢浼村捶閺夊灝鍧婇柛?/span><span>LOCAL WORKSTATION</span></footer></div>`;
}

function renderSearchPage(state) {
  const query = state.searchQueries.at(-1) || "";
  const normalized = query.trim().toLocaleLowerCase();
  const filter = records => normalized ? records.filter(record => [record.title, record.body, record.meta, ...record.keys].some(value => String(value).toLocaleLowerCase().includes(normalized))) : [];
  const cards = (records, kind) => records.length ? records.map(record => `<button class="search-result" data-auto-result="${record.evidence || ""}" data-result-source="${kind.toLocaleLowerCase()}"><small>${record.meta}</small><strong>${record.title}</strong><p>${record.body}</p><span>${kind}</span></button>`).join("") : `<div class="empty-state">缂佹稑顦欢鐔煎蓟閵夘煈鍤?/div>`;
  return `<div class="search-page"><header><span class="document-kicker">LOCAL INDEX / PUBLIC + OPERATOR</span><h2>闁告瑥鐭傞崳鍝ユ閵忕姷绌?/h2><form id="searchForm"><input id="searchInput" value="${escapeHtml(query)}" placeholder="闁瑰吋绮庨崒銊╁嫉椤掆偓濠€瀵告閵忕姷绌? autocomplete="off"><button>闁瑰吋绮庨崒?/button></form></header><div class="search-columns"><section><h3>闁稿浚鍓欑槐鎴犳閵忕姷绌?<small>public</small></h3>${cards(filter(SEARCH_RECORDS.public), "PUBLIC")}</section><section><h3>缂佺媴绱曢幃濠勬閵忕姷绌?<small>operator</small></h3>${cards(filter(SEARCH_RECORDS.manage), "MANAGE")}</section></div></div>`;
}

function renderChannelPage(state) {
  const delayed = state.revisitFlags["channel-delay"];
  const maintainerEntry = contentEntryMarkup("new.maintainer.channel-02", "缂備礁鐡ㄦ慨銏★紣閹达缚澹曢悗鐢靛帶閸?/ 22:17-22:22", "缂傚洢鍊涙禍浼村箒閵忕媭妲婚悹浣规緲缂?鐠?缂佺媴绱曢幃濠囧川濡警鍤ら柛?, "chat");
  const laterRecords = generatedEntriesFor("channel", "chat");
  return `<div class="channel-page" data-auto-effect="channel-last-record"><header><div>${iconMarkup("chat")}<span class="document-kicker">RECOVERED GROUP / READ ONLY</span><h2># relay-night</h2></div><span>2 archived members</span></header><div class="channel-stream">${CHANNEL_MESSAGES.map(message => `<article class="chat-line ${message.who === "K2" ? "operator" : "system"}"><b>${message.who}</b><div><time>${message.time}</time><p>${message.text}</p></div></article>`).join("")}${delayed ? `<article class="chat-line ghost"><b>K2</b><div><time>07-19 03:17</time><p>濠碘€冲€归悘澶屸偓鐟邦槼椤ュ﹪骞嬮幇顒€顫犻柨娑樿嫰濞叉牠宕㈤懡銈嗙畽 GitHub issue闁靛棗鍊归悧搴㈩殽瀹€鍕ㄥ亾濮樺磭绠栭柛姘凹缁辩増寰勫顐ゎ伇闁哄銈囨閻犱焦浜介埀?/p></div></article>` : ""}</div>${maintainerEntry || laterRecords ? `<section class="source-entry-stack">${maintainerEntry}${laterRecords}</section>` : ""}<p class="auto-note">閺夆晜鐟﹂宀€绱橀妶鍫滃枈闁汇劌瀚〒鍫曞触鎼存繄顏遍柡澹溿値鍞剁憸鐗堟礀娴犵娀宕?22:23闁挎稑鐭傚顔界閸撲礁鍋嶇€殿喗娲戠划娑㈡倿閺堢數绠介柣锝嗙懀閳?/p></div>`;
}

function renderCompanyPage() {
  const entries = [
    contentEntryMarkup("legacy.gamini.employee-sop", "濠㈣埖绮庤ぐ顔界閵堝棗澶嶅☉?HR 閻熸洖妫涘ú濠囧箥鐟欏嫭鏆?, "Northline 闁告劕鎳橀崕鎾礂閸欐﹢鐓?鐠?闁告ê妫楄ぐ鍫曞箼瀹ュ嫮绋婇悹浣规緲缂?, "gamini"),
    contentEntryMarkup("new.employee.minutes-02", "濞村吋淇洪鍛棯椤忓浂娲ｅǎ鍥跺枦椤撹绋夋惔銊︻€嶅ù鐘插濞呫儳鎷?, "Northline 濡炪倕婀卞ú鎵矚濞差亝锛?鐠?濞ｅ浂鍠涢鍦媼閺夎法绉?, "glem"),
    contentEntryMarkup("new.employee.incident-03", "濞存粌顑勫▎銏″緞瀹ュ洦纾稿☉?HR 鐎垫壋鍋撻柡?, "Northline 闁告艾鐗愰～澶岀矚濞差亝锛?鐠?闂傚嫭鍔曢悾鍓ф媼閺夎法绉?, "glem"),
    contentEntryMarkup("new.employee.routing-04", "濡澘瀚悾鑽ゆ崉椤栨粍鏆犲☉鎾冲缁夌兘骞侀婊冩疇缂?, "闁瑰瓨鍔栧﹢鐗堟叏閺傛寧鍠呭ù?鐠?缂備焦鎸婚、宥夊级閹邦厽鐏?, "lunet")
  ].filter(Boolean).join("") + generatedEntriesFor("company", "folder");
  return `<article class="company-page"><header>${iconMarkup("glem")}<div><strong>Northline Workspace</strong><span>濡炪倕婀卞ú浼村础韫囧海绋?/ 鐎圭寮舵禒顔藉緞瀹ュ牜鍞剁憸?/span></div></header><h2>濡炪倕婀卞ú鎵導閸曨剚鐏?/h2><p>閻犲洢鍎辨导鎰媴濠婂啫闅橀柛娆樹簼濡绮堥崫鍕Ъ闁告挸绉锋径鍕箣闁垮绂堢紓浣哥箲婢э箑顕ｉ埀顒佹交閸モ晜鐣遍悹浣规緲缂嶅秵绋夋惔鈥冲緭闁告艾娴烽悽缁樼┍椤旀鍚傞柕?/p><section class="source-entry-stack">${entries || `<div class="empty-state">闁烩晩鍠栨晶鐘测柦閳╁啯绠掗柛娆樺灥椤曚即宕ｉ弽顐ｇ暠闁稿浚鍓欏鍐媼閺夎法绉块柕?/div>`}</section></article>`;
}

function renderVendorHub(state) {
  const records = (runtimeLedger?.newCorpus || []).filter(record => {
    const corpus = String(record.corpus || "").toLocaleLowerCase();
    return VENDOR_ICON_KEYS.includes(corpus) && record.id.startsWith(`new.${corpus}.`) && contentIsUnlocked(record, state);
  });
  const entries = records.map(record => contentEntryMarkup(record.id, record.title, `${record.corpus} 鐠?${carrierLabel(record)}`, String(record.corpus).toLocaleLowerCase())).join("");
  const historicalCaches = [
    contentEntryMarkup("legacy.ethron.cache", "Ethron / Plaupic 闁告ê妫楄ぐ鍓佺磽閹惧磭鎽犲鍦濡?, "闁稿绮庨弫銈団偓鐟邦槸閸欏繑绂嶈閹佳囧春?鐠?闁哄牜鍓欏﹢鎾传瀹ュ懐瀹夐柛鎿冨灡濠€?, "globe"),
    contentEntryMarkup("legacy.deptseek.protocol", "Deptseek 缂佺姵顨呮慨蹇斿濡搫顕ч柛妤€绻楅鍛磽閹惧磭鎽?, "闁告ê妫楄ぐ鍫曞礆椤愩垺鍊?鐠?闁哄唲鍐澖濡ょ姴鑻畷妤冩媼?, "dipsik")
  ].filter(Boolean).join("");
  const laterRecords = generatedEntriesFor("vendors", "fayble");
  return `<article class="vendor-hub"><header>${iconMarkup("globe")}<div><span class="document-kicker">LOCAL HISTORY / GENERATED INDEX</span><h2>濞撴碍绋戠花鏌ュ疮閸℃鍧婇柛娆愬絻閸欏棝宕?/h2></div></header><p>闁哄牜鍓欏﹢鎾储閸℃钑夐柣銏犲船閸戯紕鎷嬮崸妤侊紪濡炪倗鏁诲鐗堢▔鎼搭澀鍒掑璺虹Ф濞堟垹绱撻幘宕囨憼閻犱焦婢樼紞宥夊触閸繆瀚欓柣銏㈠枑閸ㄦ岸濡撮崒鐐插姤闁告帒妫欏顖炴儎椤旂偓鐣卞☉鎾筹攻椤愯偐鎷嬮崸妤侊紪闁哄啫鐖煎Λ鍧楀籍閳衡偓缁剝銇愰幘鍐差枀鐎规悶鍎扮紞鏃傜博濞嗘帩鍞剁憸鐗堟磸閳?/p>${historicalCaches ? `<section class="source-entry-stack vendor-historical-caches">${historicalCaches}</section>` : ""}${laterRecords ? `<section class="source-entry-stack">${laterRecords}</section>` : ""}<section class="vendor-entry-grid">${entries || `<div class="empty-state">鐟滅増鎸告晶鐘测柦閳╁啯绠掗柡鍌涘濞堟垶绗熷☉妯煎畨闁哥喎妫濋妴澶愭椤兘鍋?/div>`}</section></article>`;
}

function renderBrowser(state) {
  const page = state.browserPage || "home";
  let content = "";
  if (page === "home") {
    const bookmarkLabels = {
      mirror: ["闁哄牃鍋撻弶鈺傚灱椤旀牠姊?, "/v2/17"], search: ["闁哄牜鍓欏﹢瀵告閵忕姷绌?, "鐎圭寮舵禒顔藉緞?], official: ["闁告ê妫楄ぐ鑸点亜閻㈠憡妗?, "闁哄牜鍓欏﹢纾嬬疀椤愩倕寮?],
      ad: ["濞ｅ洦绻傞悺銊╂儍閸曨喚鍎查弶鐑嗗墴閵?, "local copy"], github: ["濞寸媴绲块悥婊堝箥濡⒈鍚€", "release"], cloud: ["闁告艾鏈鐐烘儎?, "shared"], company: ["闁稿浚鍓欏鍐础韫囧海绋?, "records"], vendors: ["濞撴碍绋戠花鏌ュ疮閸℃鍧婇柛?, "generated"], forum: ["鐟滅増甯楅妴鍌滄媼閵婎煈鍟?, "local copy"]
    };
    const bookmarkIcons = { github: "github", cloud: "cloud", forum: "chat", company: "folder", vendors: "globe", official: "gamini" };
    const bookmarks = state.browserBookmarks.map(id => `<button data-browser-page="${id}">${iconMarkup(bookmarkIcons[id] || "globe")}<span>${bookmarkLabels[id]?.[0] || BROWSER_PAGES[id]?.title || id}<small>${bookmarkLabels[id]?.[1] || ""}</small></span></button>`).join("");
    content = `<div class="browser-home"><div class="browser-logo">R<span>17</span></div><h2>闁哄倻澧楅悥锝囩驳妤ｅ啨鈧?/h2><p>闁革负鍔屽﹢鎾锤閳ь剟寮借箛姘辩炕闁稿繈鍎卞﹢鎾锤閳ь剟骞嬮弽銊︽嫳闁革附濯介惌鎯ь嚗閸曗斁鍋?/p>${bookmarks ? `<h3>鐎规瓕寮撶换姘扁偓?/h3><div class="bookmark-grid">${bookmarks}</div>` : `<div class="empty-state">閺夆晜蓱閻ュ懘寮垫径澶婂缂佹稓鍋撻崹銊╁嫉閳ь剚娼婚幋锝庡晱闂傚偆鍣ｉ妴澶愭椤兘鍋?/div>`}</div>`;
  }
  if (page === "mirror") content = getUnlocks(state).mirror ? `<article class="web-document mirror-document" data-auto-effect="mirror-cached-response"><header class="retired-doc-nav"><strong>Relay Developer Archive</strong><nav>Overview <span>410</span>闁靛棌鍋揝DK <span>410</span>闁靛棌鍋搗2 <span>200 cache</span></nav></header>${state.contentMutations.includes("mutation.mirror.sync-line") ? `<div class="revisit-update">later-sync: source alias changed after local provenance open</div>` : ""}<div class="http-state">200 <span>CACHED</span></div><span class="document-kicker">API DOCUMENTATION / RETIRED</span><h2>Completion route, version 2</h2><p>闁稿浚鍓欑槐鎴犵博椤栨粌浠€规瓕灏欑划锟犲箻閵堝懏绀€闁靛棗鍊界换鏍ㄧ▔椤忓嫭鎯欓幖瀛樻⒐濞肩敻鎳涢鍛偦閻熸瑥鐗嗗▍鎺撴綇閸︻厾鍠樼紓鍌涙尭閻°劑鏁嶇仦绛嬪殼闁煎壊浜幗濂稿箳閵夈倗鐭濋柟绋挎搐閹粌顔忛幓鎺戠仼闂傚嫨鍊楀▓鎴炪亜閻㈠憡妗ㄩ柕?/p><dl><dt>request path</dt><dd>/v2/17</dd><dt>response source</dt><dd>edge-cache-02</dd><dt>migration</dt><dd>physical deletion: pending</dd><dt>client example</dt><dd>relay_probe_legacy.js</dd></dl><pre>GET /v2/17\nstatus: 200\nx-cache-segment: 02</pre>${generatedEntriesFor("mirror", "globe")}<p class="auto-note">閺夆晜鐟ら柌婊呯磽閹惧磭鎽犻柛婵嗙Т缁ㄦ煡宕仦鐣屾殜鐎殿喗娲滈弫銈夋儍閸曨厹浠涘〒姘儓閸撳ジ寮甸鈧崙锛勭磼韫囨洘娈岄柛锔哄妽濠€浼村捶鐢喚绐?code>~/Downloads/relay_probe_legacy.js</code>闁?/p></article>` : `<div class="browser-error"><strong>404</strong><p>閺夆晜鐟ら柌婊堝嫉椤掆偓濠€瀵告崉椤栨粍鏆犻弶鈺偵戦惀鍛村嫉婢跺海绠婚柛蹇嬪劜缁佽崵鎲撮崼锝庡敹鐟滅増娲忛埀?/p></div>`;
  if (page === "search" && state.browserBookmarks.includes("search")) content = renderSearchPage(state);
  if (page === "forum" && getUnlocks(state).channel) content = renderChannelPage(state);
  if (page === "official" && state.browserBookmarks.includes("official")) {
    const writerSession = contentEntryMarkup("new.writer.session-02", "闁靛棗锕ょ€靛啿鐣濋崨濠勬⒕闁哄牆顦甸幐鎾诲Υ鐎ｎ亜鏅稿ù锝嗙矆缁辨壆鎷?02", "閻庤蓱閺?AI 闁告ê妫楄ぐ?鐠?鐎点倝缂氶鍛▔鎼淬垹澶嶉柛娆愵殙椤斿洩銇?, "dipsik");
    const recoveredHistory = [
      contentEntryMarkup("legacy.gamini.chatlog", "鐎瑰憡褰冩禒鐘绘偨閵娿倗绐楅悹?/ 缂傚倹鎸搁悺銊р偓鐢靛帶閸?, "Gamini 闁告ê妫楄ぐ鍓佲偓鐢殿攰閻?鐠?闁告娲橀濂稿箒閵忕媭妲?, "gamini")
    ].filter(Boolean).join("");
    const provenanceBranches = [
      ["writer", "闁哄被鍎冲﹢鍛村礂閸欐﹢鐓╅梻鍕濞嗐垻妲愰姀鐘电┛", "SyncDrive / writer-share"],
      ["employee", "闁瑰灚鎸哥槐鎴炲濮樻剚鍞寸€规悶鍎扮紞鏃堝礌?, "Northline / records"],
      ["maintainer", "閻庤鐭紞鍛磼鐎涙ê袘閻犱焦婢樼紞?, "Documents / relay"],
      ["ad", "闁哄被鍎冲﹢鍛┍濠靛牊娈岄悹鍝勭枃濞?, "Gamini / campaign copy"]
    ].map(([id, label, detail]) => `<button class="provenance-branch" data-provenance-branch="${id}"><strong>${label}</strong><small>${detail}</small></button>`).join("");
    const laterRecords = generatedEntriesFor("official", "gamini");
    content = `<article class="official-page"><header>${iconMarkup("gamini")}<strong>Gogle AI</strong><nav>閻㈩垼鍠栨慨顏呯▔椤撶偟濡囬柕鍡忓亾闁活潿鍔嶉崺娑㈠础韫囨凹鍞撮柕鍡忓亾闁告ê妫楄ぐ鍓佲偓鐢殿攰閻?/nav></header><div class="official-content">${state.contentMutations.includes("mutation.official.confirmation") && !state.revisitFlags["official-confirmed"] ? `<div class="forced-confirmation"><strong>缂備綀鍛暰闁哄被鍎冲﹢鍛村礈瀹ュ浠橀悷鏇氳兌閳ユ鎷嬮妶鍛潑闁告瑨灏欐晶妤呭嫉椤掑喚鍤涢柡?/strong><p>闁稿繑濞婂Λ鎾箣閺嶎偒鐎茬€殿喒鍋撻悘蹇撴缁绘岸鎮惧▎蹇曠Ъ闁告挸绉堕垾妯兼媼閵堝洤笑闁诡兛闄嶉埀?/p><button id="confirmOfficialHistoryButton">缁绢収鍠涢濠氱嵁閸撲焦鍩涚紓?/button></div>` : ""}<section class="history-record"><header><div><span class="document-kicker">ACCOUNT HISTORY / LOCAL CACHE</span><h2>鐎瑰憡褰冩禒鐘绘偨閵娿倗绐楅悹?/h2></div><b>闁告瑯浜ｉ?/b></header><dl><dt>闁绘鍩栭埀?/dt><dd>recovered from local cache</dd><dt>闁哄牃鍋撻柛姘閹挸顫?/dt><dd>07-18 22:24</dd><dt>闁哄鍎茬花?/dt><dd>history.sqlite / snapshot ref 17</dd><dt>閻犳劧闄勯崺?/dt><dd>闁哄牜鍓欏﹢瀛樺濮樺磭妯堝ǎ鍥ｅ墲娴煎懏绋夊鍛闁?/dd></dl><p>濞村吋淇洪惁钘夘潰閿濆棙鐎€规瓕寮撶划鐘垫嫻閿旇棄鐓曢柛妯烘瑜板墎绮旀繝姘彑闁靛棗鍊瑰﹢浼村捶閻楀牊娈堕柟璇″枛缁ㄨ鲸绂掑鍕闁伙絾鐟ょ粩鎾级閳ヨ櫕褰ラ柣鎾楀啰绌块柣銏╃厜缁辨繃绂掗妷銉ユ尋闁搞儲绋愰柌婊堝即妤ｅ啯顓归柛銉у仜椤﹀弶绌卞┑鍡欐憼闁汇劌瀚ù澶愬礂鐎圭姷銈繝褎鍔掔紞鍛磾椤旇　鍋?/p>${recoveredHistory ? `<section class="source-entry-stack official-history-list">${recoveredHistory}</section>` : ""}</section><section class="related-sources"><header><div><span class="document-kicker">RELATED SOURCES</span><h3>闂傚懎绻嬬槐鎵嫚濠靛懐绠介悗娑欘焽濞堟垶鎷呭鍥╂瀭</h3></div><small>4 records</small></header><div class="provenance-branches">${provenanceBranches}</div></section>${writerSession || laterRecords ? `<section class="source-entry-stack official-history-list">${writerSession}${laterRecords}</section>` : ""}</div></article>`;
  }
  if (page === "ad" && state.browserBookmarks.includes("ad")) {
    const marketEntry = contentEntryMarkup("legacy.market.meidawei", "閻㈩垰鍊稿┃鈧悷娆忓€搁惂?/ 婵☆垪鈧磭鈧嘲煤濡ゅ啫顤傞柛姘捣濞堟垶绂嶈閸忔﹢宕抽鍫㈠従", "濞ｅ洦绻傞悺銊╂儍閸曨喖鍋嶇紓浣哥箲閺嬪啰绮╅悩杈╃憿妤犵偛鐏濋幉锟犲即鐎涙﹩鍔€", "globe");
    content = `<article class="ad-page"><div class="ad-label">SPONSORED / LOCAL CACHE</div><h2>Gamini 濞戞挸绨肩紞姗€鏁嶅畝鈧幋椋庣磼椤撶喓妲ㄥ☉鎾亾婵炲棌鍓濆﹢顓犫偓鐟版湰閸ㄦ岸鎯冮崟顐殸閻犲洦绺块埀?/h2><p>濞戞挴鍋撴繛鍡忊偓鍐插殥缂備礁绻愰妵鎴﹀极閸垺鐣卞ù锝嗘崌閻涙瑧鎷嬮垾鍐茬亰濞寸姴绉崇换姘舵偩濞嗘垶绲婚悹鍝勭枃濞村棝宕ｉ崒娑欐闁?/p><span class="auto-citation" data-save-citation="ad-redirect" data-citation-quote="闁哄牜鍓欏﹢瀵告崉鐎圭姵绁梺鎻掑缁稒绌卞┑鍫熸畬闁活偀鍋撴繛鑼额嚙婵晠宕ｉ崒娑欐 campaign=NODE" data-citation-source="婵炴潙绻楅～宥夊闯?/ 濞ｅ洦绻傞悺銊╂儍閸曨喚鍎查弶鐑嗗墴閵? data-citation-ref="${BROWSER_PAGES.ad.url}">鐎规瓕灏鍥亹閺囩偛鐓傜紒妤佹椤斿洭寮?/span>${marketEntry ? `<section class="source-entry-stack">${marketEntry}</section>` : ""}</article>`;
  }
  if (page === "github" && state.browserBookmarks.includes("github")) {
    const localHashRead = hasStoryEvent(state, "package-local-checksum-read");
    const releaseRead = hasStoryEvent(state, "package-release-read");
    const hashesReady = localHashRead && releaseRead;
    const maintainerIncident = contentEntryMarkup("new.maintainer.incident-03", "build incident / R17 route review", "GitHub Mirror 鐠?闁哄瀚紓鎾寸鐎ｎ偅娅婇悹浣规緲缂?, "github");
    const legacyRepositoryRecords = [
      contentEntryMarkup("legacy.github.issue-4471", "Issue #4471 / fallback reviewer", "濞寸姵鎸哥花閬嶆⒐濠婂啫鍓?鐠?闁哄牜浜濇竟鎺楀礄閸℃瑦鐣遍柣妯垮煐閳ь兛绀侀悺褍鈻撴担鍐缂?, "github"),
      contentEntryMarkup("legacy.compatible.protocol", "Compatible / 閹煎鍠庣槐鏃堝础韫囨凹鍞撮悗鐟版湰閺嗭絿鎷嬮弶璺ㄧЭ", "鐎殿喒鍋撻柛娆愬灱閳ь剙鎳忛弸鍐浖閿濆懐绉烘俊?鐠?闁告ê妫楄ぐ鍫曟偋閸喐鎷?, "compatible")
    ].filter(Boolean).join("");
    const laterRecords = generatedEntriesFor("github", "github");
    content = `<article class="repo-page" data-auto-effect="repository-release"><header>${iconMarkup("github")}<span>k2-maint /</span><strong>release-mirror</strong><b>Public archive</b></header><div class="repo-nav">Code闁靛棌鍋揑ssues 1闁靛棌鍋揜eleases 1</div><section class="release"><small>v0.9.7-legacy / 07-19</small><h2>Last build before Compatible migration</h2><code>${PACKAGE_NAME}</code><dl class="release-metadata"><dt>Provides</dt><dd><code>fbl-cli</code></dd><dt>Channel</dt><dd><code>legacy</code></dd><dt>Maintainer</dt><dd><code>k2-maint</code></dd></dl><p>release checksum</p><pre>${hashesReady ? PACKAGE_CHECKSUM : "release value withheld / compare release metadata with local package"}</pre>${state.revisitFlags["github-issue"] ? `<div class="issue-comment"><b>k2-maint commented</b><p>闁告牕鎳忛惀鍛村嫉婢跺矈鍔柛姘Р閳ь剙鍊歌ぐ褏鎷嬮妶鍡樻嫳闁革妇澧楅悧搴㈩殽瀹€瀣耿閻熶礁鎳庨悾顒佺閵夈儲鍊甸柛鎺濆亯椤斺偓缂侇垵宕电划娲即婢跺摜绋戦梺鏉跨Ф閻ゅ棙绂掗敐鍥ㄥ€為柕?/p></div>` : ""}${hashesReady ? `<p class="auto-note">濞戞挸锕鐗堟交濞嗗氦顩悘蹇氶哺濡插憡绂掗幘宕囨皑缂備焦鐟ラ崵顓㈡儍閸曨剛澧″Δ鐘茶嫰閳ь剛顑曢埀顒€鍊搁悾鐘绘閳ь剛鎲版担鍛婂闁哄牜鍓欏﹢鎾焽閿濆嫰鍤嬮柡鍌氭矗濞嗐垽鎳涢鍕畳缂佺姵顨呴崵顓㈠级閵壯勭暠闁稿﹪妫跨粩鎾嚊缁厜鍋撻弬琛″亾閺冣偓濠€浼村捶閹殿喗鐣遍柛濠呭椤╋箓宕烽妸褏鐭掔紒鏃戝灦閸ｇ兘鎳涢鍕畳缂佺姵銇滈埀?/p>` : `<p class="auto-note">濞寸姵鎸哥花閬嶅箮婵犲啰澧″Δ鐘茶嫰閳ь剝鍋愰弳鈧柛锔哄妺缁?release 闂佹彃鐭夌槐婵囨媴閸℃凹娲ｉ柛蹇撶墢閻擄繝鏌嗛幘瀛樻嫳闁革缚鍗抽崑鍛▔椤忓嫮鏆旈悷浣告噹鐎垫﹢鎳涢鍕畳缂佺姵顨呴崵顓㈠级閵夛附笑濠㈣埖鑹鹃惃顖炲Υ閸屾粎鐭掔紒鏃戝灦閸ｉ鈧潧婀卞?<code>${escapeHtml(PACKAGE_NAME)}</code> 缂佺姵銇炵粩鏉戔枎閳藉懐绀夐柛鎰Т濞叉牠寮堕妷褎绠欓柕?/p>`}${maintainerIncident || legacyRepositoryRecords || laterRecords ? `<section class="source-entry-stack repo-source-entry">${maintainerIncident}${legacyRepositoryRecords}${laterRecords}</section>` : ""}</section></article>`;
  }
  if (page === "cloud" && state.browserBookmarks.includes("cloud")) {
    const writerEntries = [
      contentEntryMarkup("new.writer.draft-01", "闁靛棗锕ょ€靛啿鐣濋崨濠勬⒕闁哄牆顦甸幐鎾诲Υ鐎ｎ剦鍎戝ù婊冭嫰瀹曞嫭绋夐埀顒傜博閻樺搫纾哥紒?, "SyncDrive / writer-share 鐠?闁告帗绻勯…?, "cloud"),
      contentEntryMarkup("new.writer.version-03", "闁绘鐗婂﹢浼村储閸℃钑?03 / 闁告艾鐗嗛懟鐔煎触鎼达絾鐣卞閫涘嵆閻?, "SyncDrive / writer-share 鐠?濞ｅ浂鍠涢鍦偓鐢靛帶閸?, "cloud"),
      contentEntryMarkup("new.writer.submission-04", "闁稿浚鍓欑槐鎴﹀箮閺囩媭鐒惧☉鎾虫捣閺佺數鎷犳径濠傤棇闁?, "SyncDrive / writer-share 鐠?闁圭粯鍔掑锔炬媼閺夎法绉?, "cloud")
    ].filter(Boolean).join("");
    const routeFiles = hasPackage(state) ? `<div class="cloud-row"><span>route.profile</span><small>07-18 22:24</small><button data-discover-file="profile">闁革负鍔嶉弸鍐╃閺堜絻鍘悗瑙勭煯缂?/button></div>${state.revisitFlags["cloud-conflict"] ? `<div class="cloud-row conflict"><span>route (conflicted copy).profile</span><small>07-19 03:16 / restored</small></div><pre>profile=relay-node17\nproxy=${RELAY_PROXY}\nroute=relay.local,docs-mirror.local,fayble-legacy.local</pre>` : `<div class="empty-state">闁告劘灏欓悰濠囨偋閸喐鎷卞ù鐘茬Т濠€顏堝触鐏炵虎鍔勯柕?/div>`}` : "";
    const laterRecords = generatedEntriesFor("cloud", "cloud");
    content = `<article class="cloud-page"><header>${iconMarkup("cloud")}<strong>SyncDrive</strong><span>闁稿繐褰夐棅鈺呮儎椤旇偐绉?/span></header>${writerEntries || laterRecords ? `<section class="source-entry-stack cloud-writer-share">${writerEntries}${laterRecords}</section>` : ""}${routeFiles}</article>`;
  }
  if (page === "company" && state.browserBookmarks.includes("company")) content = renderCompanyPage();
  if (page === "vendors" && state.browserBookmarks.includes("vendors")) content = renderVendorHub(state);
  const activeRecord = contentRecord(state.activeContentId);
  if (activeRecord && recordCarrierApp(activeRecord) === "browser" && state.carrierReads?.includes(`browser:${activeRecord.id}`)) {
    content = `<section class="browser-record-reader"><button data-close-carrier-record="browser">闁?閺夆晜鏌ㄥú鏍ㄧ▔婵犱胶顏卞?/button>${corpusRecordMarkup(activeRecord, state)}</section>`;
  }
  if (!content) content = `<div class="browser-error"><strong>404</strong><p>闁哄牜鍓欏﹢鏉懨硅箛姘兼綌闁革絻鍔嶉惀鍛村嫉婢跺海绠归柡澶嗏偓铏嬀闁秆€鍋撻柣銊ュ椤斿洩銇愰弴妯峰亾?/p></div>`;
  return windowFrame("browser", "Relay Browser", browserChrome(page, content, state), { icon: "闁?, wide: true });
}

const V2_CLIENT_DETAILS = {
  "gamini-ws": { name: "Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?, icon: "gamini", detail: "Gogle 鐎规悶鍎扮紞鏃傜矚濞差亝锛?鐠?鐎圭寮舵禒顔藉緞瀹ュ嫮绐楅悹鍥ㄧ箑缁楀矂寮崶銊ｂ偓? },
  chengzhen: { name: "婵犮垹瀚幎姘跺础韫囧海绋?, icon: "chengzhen", detail: "濞撮棿妞掔粭鐔煎础韫囧海绋?鐠?濞村吋淇洪鍛棯椤忓浂娲ｅ☉鎾冲缁夌兘骞侀婊冩疇缂? },
  yunzhen: { name: "濞存粍鍨归?, icon: "yunzhen", detail: "闁告劖鐟ょ紞鏂款啅閵夈儱寰?鐠?闁哄倸娲ㄩ…鍫ュΥ娴ｅ搫顣奸柡鍫墮瀹稿宕ｉ煫顓犵憿闁汇垹鐤囬惁? },
  "groke-feed": { name: "Groke Feed", icon: "groke-feed", detail: "Exai Groke 鐠?闁哄啫鐖煎Λ璺ㄧ棯婢跺摜鐟㈤柛鎰嚇閸庢挳寮崶銊ｂ偓? },
  "glem-memory": { name: "Glem Memory", icon: "glem", detail: "Zhiru Glem 鐠?濞撮棿妞掔粭鐔兼儗閵夈劎妲曞☉鎾虫唉椤斿洩绠涢崱姗嗘⒕缂? },
  "kemy-space": { name: "Kemy Space", icon: "kemy", detail: "Muunshot Kemy 鐠?闂傗偓閸фぜ鈧秹鎯勯鑽ょ憿濞戞挸锕ｇ粭鍛村棘閸パ勭闁衡偓? },
  "repo-mirror": { name: "闂傗偓濠婂啫鍓煎ù鐘虫尭缁?, icon: "repo-mirror", detail: "k2-maint 鐠?Issues 濞?Pull Requests" }
};
const V2_CLIENT_IDS = Object.freeze(Object.keys(V2_CLIENT_DETAILS));
const SYSTEM_CARRIER_APPS = new Set(["mail", "files", "browser", "terminal", "relay", "trash"]);

function clientImportScreen(id) {
  const pkg = CLIENT_PACKAGE_BY_ID.get(id);
  const info = V2_CLIENT_DETAILS[id];
  const importAction = label => clientRecoveryAvailable(id) ? `<button class="client-data-import" data-import-client="${id}">${label}</button>` : "";
  if (id === "gamini-ws") return `<div class="preimport-client gamini-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?/strong></div><nav><button class="active">闁哄倹婢橀顔炬嫚?/button><button>闁哄牃鍋撻弶?/button><button>鐎瑰憡褰冪紞濠傤浖?/button></nav><footer>${importAction("閻庣數鍘ч崣鍡樺濮樺磭妯堥悹浣规緲缂?)}</footer></aside><main><header><strong>Gamini</strong><span>閻犱礁鐏濋鐟拔熼垾宕囩</span></header><section class="preimport-home"><div class="preimport-brand">${iconMarkup("gamini")}<h2>濞寸姴锕ら妵澶愬箚閸忓懐鍟婇悷娆欑导缁牊绋婇崼顒傚惞</h2></div><div class="preimport-prompts"><button>闁轰礁顕幃濠冪▔閳ь剙鈻撻崹顐ｇ€悗?/button><button>闁告帒妫欓悗鑺ョ▔閳ь剚绋夐鍫燂紪濡?/button><button>鐎殿喒鍋撳┑顔碱儐閺屽﹪鎯冮崟顐殸閻?/button></div><div class="preimport-composer"><span>闁?Gamini 闁圭粯鍔欏Λ?/span><button disabled>闁告瑦鍨块埀?/button></div></section></main></div>`;
  if (id === "chengzhen") return `<div class="preimport-client chengzhen-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("chengzhen")}<strong>婵犮垹瀚幎姘跺础韫囧海绋?/strong></div><nav><button class="active">鐎规悶鍎扮紞鏃堝矗?/button><button>婵炴垵鐗婃导?/button><button>闁哄啨鍎卞?/button><button>闁哄倸娲ｅ▎?/button></nav><footer>${importAction("閺夆晙鑳朵簺鐎圭寮跺﹢浣割啅閵夈倗绋婇柛?)}</footer></aside><main><header><div><strong>濞戞挸锕ゅ畷宥嗙附?/strong><small>Northline 缂佸本妞藉Λ?/small></div><button>闁哄倹婢樼紓?/button></header><section class="preimport-dashboard"><article><strong>濞寸姴锕ら妵?/strong><p>鐟滅増鎸告晶鐘测柦閳╁啯绠掗悗鐟邦槹鐢捇鎯冮崟顏嗙獥閻?/p></article><article><strong>闁哄牃鍋撻弶鈺傚灱椤旀牠姊?/strong><p>闁瑰灚鎸哥槐鎴濃槈閸喍绱栭柕鍡曠劍閺嬪啫顩奸敐鍡楃仐濡炪倕婀卞ú浼村触鎼存繄绐楅柡鍕⒔閵囨岸宕烽妸銊х闂?/p></article><article><strong>鐎垫澘鎳庢慨?/strong><p>闁哄棗鍊瑰Λ銈咁嚗閸涱収妲遍柣鐐叉缁ㄣ劍銇?/p></article></section></main></div>`;
  if (id === "yunzhen") return `<div class="preimport-client yunzhen-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("yunzhen")}<strong>濞存粍鍨归?/strong></div><nav><button class="active">闁稿繈鍔戦崕鎾棘閸モ晩鐒?/button><button>闁哄牃鍋撻弶鈺傚灩缁鳖亝娼?/button><button>闁搞儳鍋為弫鍦博?/button></nav><footer>${importAction("濞寸姴瀛╁﹢浼村捶閺夋妲靛ù鐘哄Г娴狀喗寰?)}</footer></aside><main><header><div><strong>闁瑰瓨鍨瑰▓鎴﹀棘閸モ晩鐒?/strong><small>闂傚棎鍔嶉悥楣冩儍閸曨厸鏁勯梻?/small></div><button>闁哄倹婢樼紓鎾诲棘閸モ晩鐒?/button></header><section class="preimport-empty"><div>${iconMarkup("yunzhen")}<h2>鐎殿喒鍋撳┑顔碱儏閸熸捇鎮欓柅娑氱焼濞?/h2><p>闁哄倹婢樼紓鎾诲棘閸モ晩鐒鹃柨娑樻湰閸ㄣ劍绂掓惔鈥冲緭濞寸姵鐗為鏇熷緞閸パ勫€辨慨婵勫劚閸戯繝寮垫径濠傛暥閻?/p><button>闁哄倹婢樼紓鎾剁矚閾忚顏ら柡鍌氭川椤?/button></div></section></main></div>`;
  if (id === "groke-feed") return `<div class="preimport-client groke-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("groke")}<strong>Groke Feed</strong></div><nav><button class="active">濡絾鐗犻妴?/button><button>闁稿繗娅曢弫?/button><button>闂侇偅姘ㄩ悡?/button><button>闁衡偓閹増顥?/button></nav><footer>${importAction("閻庣數鍘ч崣鍡涘礃閸涱収鍟囬悗娑櫳戦妴?)}</footer></aside><main><header><strong>濡絾鐗犻妴?/strong><button>闁告瑦鍨电粩?/button></header><section class="preimport-feed"><article><div class="preimport-avatar">G</div><div><strong>婵炲棎鍨肩换瀣媴鐠恒劍鏆?Groke Feed</strong><p>闁稿繗娅曢弫鐐垫嫻閿曗偓瑜板潡骞嬮弽褍绲洪悽顖氬暟椤戝洦绋夐埀顒勫级閳ュ啿鏁堕悗鍦缁辨繈寮崼鏇燂紵缂佹儳銇樼槐浼村及閸撗佷粵闁革负鍔忕换鏍煂鐏炵儵鍋?/p></div></article><div class="preimport-feed-empty">闁哄棗鍊瑰鍌氣柦閳╁啯绠掗柡鍥ㄦ綑椤﹀潡宕橀崨顓у晣</div></section></main></div>`;
  if (id === "glem-memory") return `<div class="preimport-client glem-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("glem")}<strong>Glem Memory</strong></div><nav><button class="active">闁瑰吋绮庨崒?/button><button>闁活厹鍎撮惁鎴犵矚濞差亝锛?/button><button>闁哄牃鍋撻弶鈺傚灱椤旀牠姊?/button><button>濞ｅ洦绻傞悺銊╁礃閸涱収鍟?/button></nav><footer>${importAction("閺夆晝鍋炵敮鏉戭啅閸欏绠掗柣顓滃劥閻︽垹绮氬ú顏咃紵")}</footer></aside><main><header><strong>濞撮棿妞掔粭鐔兼儗閵夈劎妲?/strong><span>闁哄牜鍓欏﹢鏉戭啅閵夈倗绋婇柛?/span></header><section class="preimport-home"><div class="preimport-brand">${iconMarkup("glem")}<h2>濞寸姴娴烽悡锛勬嫚閸℃稑娅￠柟鍨劤閸╁瞼绮甸弮鈧、?/h2></div><div class="preimport-composer"><span>闁瑰吋绮庨崒銊╁棘閸ャ劊鈧倿濡存笟鈧妴宥夋儎椤斿吋瀚查柛妯烘瑜板墎鎷嬮弶璺ㄧЭ</span><button disabled>闁瑰吋绮庨崒?/button></div></section></main></div>`;
  if (id === "kemy-space") return `<div class="preimport-client kemy-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("kemy")}<strong>Kemy Space</strong></div><nav><button class="active">濡炪倕婀卞ú?/button><button>闁哄牃鍋撻弶?/button><button>闁稿繐褰夐棅鈺冪磼濞嗘劕鐏?/button><button>婵☆垪鍓濆?/button></nav><footer>${importAction("闁诡厹鍨归ˇ鍙夈亜閸︻厽绐楃紒灞炬そ濡?)}</footer></aside><main><header><strong>濡炪倕婀卞ú?/strong><button>闁哄倹婢樼紓鎾淬亜閸︻厽绐?/button></header><section class="preimport-empty"><div>${iconMarkup("kemy")}<h2>鐎殿喒鍋撳┑顔碱儎缁斿瓨绋夐鍫熸瘣濡炪倕婀卞ú?/h2><p>閻庣數顢婇惁浠嬪Υ娴ｈ鐎ù鐘烘硾閹蜂即鎮介悢绋跨亣閻犱焦婢樼紞宥嗗濮橆偆绠介柣锝嗙懃濠€顏堝触鐏炶偐顏遍柡澶嗏偓鑼憪濞戞挸顑嗛弸鍐籍閸洘锛熺紒鎯с仒缁?/p><button>闁哄倹婢樼紓鎾剁矚閾忚顏ゅ銈呮贡濞?/button></div></section></main></div>`;
  if (id === "repo-mirror") return `<div class="preimport-client repo-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("github")}<strong>闂傗偓濠婂啫鍓煎ù鐘虫尭缁?/strong></div><nav><button class="active">婵帒鍊介～?/button><button>濞寸姵鎸哥花?/button><button>Issues</button><button>Pull requests</button></nav><footer>${importAction("閻庣數鍘ч崣鍡樼閹惧磭姘ㄩ梻鈧鍐ㄥ壖")}</footer></aside><main><header><div><strong>鐎规悶鍎扮紞鏃堝礌閻戞﹩娲ら悷?/strong><small>k2-maint</small></div><button>闁哄倹婢樼紓鎾寸閹惧磭姘?/button></header><section class="preimport-dashboard repo"><article><strong>闁哄牃鍋撻弶鈺傚灣缁劍鎯?/strong><p>闁哄棗鍊瑰Λ銈夊嫉閳ь剚娼婚幋锝庡晱闂傚偆鍠氬▓鎴炵閹惧磭姘?/p></article><article><strong>闁告帒妫濋崢銈囩磼濞嗘劕鐏夐柣?/strong><p>闁哄棗鍊瑰Λ?Issue 闁?Pull Request</p></article><article><strong>婵炶尪顕ф慨?/strong><p>濞寸姵鎸哥花鍗灻虹拠鎻捫楀ù鍏肩濡绮堥崫鍕含閺夆晜鐟╅崳?/p></article></section></main></div>`;
  return `<div class="client-import-screen" data-client="${id}">${iconMarkup(info?.icon || pkg?.icon || "package")}<h2>${escapeHtml(info?.name || pkg?.name || id)}</h2>${importAction("閻庣數鍘ч崣鍡涘极閻楀牆绁?)}</div>`;
}

function builtInClientPage(id, state) {
  const active = state.activeContentId;
  const importButton = (label, clientId = id) => clientRecoveryAvailable(clientId, state) ? `<button class="client-data-import" data-import-client="${clientId}">${label}</button>` : "";
  if (id === "gamini-ws") {
    const body = active === "legacy.gamini.protocol" ? corpusRuntimeMarkup(active, state) : `<section class="preimport-home"><div class="preimport-brand">${iconMarkup("gamini")}<h2>濞寸姴锕ら妵澶愬箚閸忓懐鍟婇悷娆欑导缁牊绋婇崼顒傚惞</h2></div><div class="preimport-prompts"><button>闁轰礁顕幃濠冪▔閳ь剙鈻撻崹顐ｇ€悗?/button><button>闁告帒妫欓悗鑺ョ▔閳ь剚绋夐鍫燂紪濡?/button><button>鐎殿喒鍋撳┑顔碱儐閺屽﹪鎯冮崟顐殸閻?/button></div><div class="preimport-composer"><span>闁?Gamini 闁圭粯鍔欏Λ?/span><button disabled>闁告瑦鍨块埀?/button></div></section>`;
    return `<div class="preimport-client gamini-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?/strong></div><nav><button class="${active !== "legacy.gamini.protocol" ? "active" : ""}">闁哄倹婢橀顔炬嫚?/button><button>闁哄牃鍋撻弶?/button><button>鐎瑰憡褰冪紞濠傤浖?/button><button class="${active === "legacy.gamini.protocol" ? "active" : ""}" data-content-entry="legacy.gamini.protocol">闁哄牆绉存慨鐔煎础韫囨凹鍞?/button></nav><footer>${importButton("閻庣數鍘ч崣鍡樺濮樺磭妯堥悹浣规緲缂?)}</footer></aside><main><header><strong>Gamini</strong><span>閻犱礁鐏濋鐟拔熼垾宕囩</span></header>${body}</main></div>`;
  }
  if (id === "groke-feed") {
    const body = active === "new.groke.policy" ? corpusRuntimeMarkup(active, state) : `<section class="preimport-feed"><article><div class="preimport-avatar">G</div><div><strong>婵炲棎鍨肩换瀣媴鐠恒劍鏆?Groke Feed</strong><p>闁稿繗娅曢弫鐐垫嫻閿曗偓瑜板潡骞嬮弽褍绲洪悽顖氬暟椤戝洦绋夐埀顒勫级閳ュ啿鏁堕悗鍦缁辨繈寮崼鏇燂紵缂佹儳銇樼槐浼村及閸撗佷粵闁革负鍔忕换鏍煂鐏炵儵鍋?/p></div></article><div class="preimport-feed-empty">闁哄棗鍊瑰鍌氣柦閳╁啯绠掗柡鍥ㄦ綑椤﹀潡宕橀崨顓у晣</div></section>`;
    return `<div class="preimport-client groke-preimport" data-client="${id}"><aside><div class="app-toolbar">${iconMarkup("groke")}<strong>Groke Feed</strong></div><nav><button class="${active !== "new.groke.policy" ? "active" : ""}">濡絾鐗犻妴?/button><button>闁稿繗娅曢弫?/button><button>闂侇偅姘ㄩ悡?/button><button>闁衡偓閹増顥?/button><button class="${active === "new.groke.policy" ? "active" : ""}" data-content-entry="new.groke.policy">闁烩晛鐡ㄧ敮瀛樼閵堝嫮甯涢柡鈧捄銊ф憸</button></nav><footer>${importButton("閻庣數鍘ч崣鍡涘礃閸涱収鍟囬悗娑櫳戦妴?)}</footer></aside><main><header><strong>${active === "new.groke.policy" ? "濞ｅ洠鈧弶宕插☉鎿冨幖缁? : "濡絾鐗犻妴?}</strong><button>${active === "new.groke.policy" ? "闁绘鐗婂﹢浼村储閸℃钑? : "闁告瑦鍨电粩?}</button></header>${body}</main></div>`;
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
  return windowFrame("applications", "閹煎瓨姊婚弫銈囩矙鐎ｎ亞纰?, `<div class="applications-page"><header><span class="document-kicker">APPLICATIONS / LOCAL</span><h2>閹煎瓨姊婚弫銈囩矙鐎ｎ亞纰?/h2><input aria-label="闁瑰吋绮庨崒銊︽償閺冨倹鏆忕紒瀣儏缁? placeholder="闁瑰吋绮庨崒銊︽償閺冨倹鏆忕紒瀣儏缁? disabled></header><section>${rows}${clientRows}</section></div>`, { icon: "闁? });
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
  return `<div class="carrier-loading"><span class="document-kicker">RECOVERING SOURCE</span><p>婵繐绲藉﹢顏嗘嫚鐠囨彃绲块柟顓滃灩椤︽煡寮悧鍫濈ウ闁炽儻鑵归埀?/p></div>`;
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
  if (recordCarrierApp(record) === "gamini-ws" && kind === "website") return `<header class="gamini-native-section"><div><strong>闁哄牆绉存慨鐔哥▔鎼淬劍顓虹紒?/strong><small>闁告绻楅鍛存偋閸喐鎷卞☉鎾虫唉婢跺嫰骞嬫搴⌒﹂柟?/small></div><nav><span class="active">闁哄牆绉存慨鐔煎础韫囨凹鍞?/span><span>闂傚懏鍔楅～?/span><span>闁轰胶澧楀畵渚€骞掕閸?/span></nav></header>`;
  if (recordCarrierApp(record) === "gamini-ws" && kind === "workspace") return `<header class="gamini-native-section document"><div><strong>${title}</strong><small>Northline 鐠?闁告劕鎳橀崕鎾礂閸欐﹢鐓?/small></div><nav><span class="active">闁哄倸娲﹂妴?/span><span>闁逛絻顫夐弫?/span><span>闁绘鐗婂﹢?/span></nav><span class="gamini-doc-state">闁告瑯浜ｉ?/span></header>`;
  if (kind === "repository") {
    const type = String(record.carrierType || "");
    const active = /pull-request|repository-pr/.test(type) ? "pr" : /release/.test(type) ? "release" : /status|migration-log/.test(type) ? "actions" : "issues";
    const tab = (id, label) => `<span class="${active === id ? "active" : ""}">${label}</span>`;
    return `<header class="native-repo-bar"><div><b>${escapeHtml(record.corpus || "mirror")}</b><span>/</span><strong>${title}</strong></div><nav>${tab("code", "Code")}${tab("issues", "Issues")}${tab("pr", "Pull requests")}${tab("actions", "Actions")}${tab("release", "Releases")}</nav></header><div class="native-repo-subbar"><span>private mirror</span><span>main</span><span>${source}</span></div>`;
  }
  if (kind === "conversation") return `<header class="native-conversation-bar"><div class="native-avatar">${escapeHtml((record.corpus || "C").slice(0, 1))}</div><div><strong>${title}</strong><small>${source} 鐠?闁告瑯浜ｉ?/small></div><div class="native-client-actions"><span>闁?/span><span>闁?/span></div></header>`;
  if (kind === "mail") return `<header class="native-mail-bar"><button aria-label="閺夆晜鏌ㄥú鏍焽椤旂粯顐介柛鎺擃殙閵?>闁?/button><div><strong>${title}</strong><small>${source}</small></div><div class="native-client-actions"><span>鐟滅増甯楅妴?/span><span>闁?/span></div></header>`;
  if (kind === "terminal") return `<header class="native-terminal-tabs"><span class="active">room17@relay: cache</span><span>闁?/span></header><div class="native-terminal-command">room17@relay:~$ <b>cachectl inspect ${escapeHtml(record.id)}</b></div>`;
  if (kind === "notes") return `<header class="native-notes-bar"><div><strong>${title}</strong><small>${source}</small></div><div class="native-client-actions"><span>鐎瑰憡褰冮幃鎾愁潰?/span><span>闁?/span></div></header>`;
  if (kind === "workspace") return `<header class="native-workspace-bar"><div><span class="native-workspace-logo">N</span><strong>${title}</strong></div><nav><span>閻犲浄闄勯崕?/span><span>婵炶尪顕ф慨?/span><span>闂傚嫬瀚▎?/span></nav><small>${source}</small></header>`;
  if (kind === "community") return `<header class="native-community-bar"><strong>${escapeHtml(record.corpus || "Community")}</strong><nav><span>濡絾鐗犻妴?/span><span>闁稿繗娅曢弫?/span><span>婵炴垵鐗婃导?/span></nav><span class="native-search">闁瑰吋绮庨崒?/span></header>`;
  if (kind === "browser-devtools") return `<div class="native-browser-pagebar"><span>闁?/span><span>闁?/span><span>闁?/span><div>妫ｅ啯鏅?${source}</div><span>闁?/span></div><header class="native-devtools-tabs"><span>Elements</span><span>Console</span><span class="active">Network</span><span>Application</span></header>`;
  if (record.pageIdentity === "policy") return `<header class="native-site-bar trust"><strong>${escapeHtml(record.corpus || "Trust Center")} 濞ｅ洠鈧弶宕插☉鎿冨幖缁?/strong><nav><span>闁衡偓鐠恒劎鎽?/span><span>闂侇偄绻戝Σ鎴炴償?/span><span>閻庣懓顦崣?/span><span>闁绘鐗婂﹢浼村储閸℃钑?/span></nav></header>`;
  if (record.pageIdentity === "official") return `<header class="native-site-bar official"><strong>${escapeHtml(record.corpus || "Service")}</strong><nav><span>濞存籂鍐╂儌</span><span>闁煎疇妫勬慨?/span><span>鐎殿喒鍋撻柛娆愬灱閳?/span><span>闁衡偓椤栨稑鐦?/span></nav></header>`;
  return `<header class="native-site-bar"><strong>${escapeHtml(record.corpus || "Service")}</strong><nav><span>婵帒鍊介～?/span><span>閻犱焦婢樼紞?/span><span>闁衡偓椤栨稑鐦?/span><span>閻犳劧闄勯崺?/span></nav></header>`;
}

function nativeCarrierMarkup(record, state, mutationCount = 0) {
  const kind = nativeCarrierKind(record);
  const host = recordCarrierApp(record);
  return `<section class="native-carrier native-${kind} native-host-${escapeHtml(host)}">${nativeCarrierChrome(record, kind)}<article class="corpus-runtime ${corpusRuntimeClass(record)} ${carrierRuntimeClasses(record)}" data-native-kind="${kind}" data-runtime-profile="${corpusRuntimeClass(record)}" data-content-id="${escapeHtml(record.id)}" data-authorship-stage="${escapeHtml(record.authorshipStage || "H0")}" data-carrier-type="${escapeHtml(record.carrierType || "document")}" data-corpus="${escapeHtml(record.corpus || "")}">${mutationCount ? `<aside class="mutation-strip">${mutationCount} 闁哄鈧櫕鍊甸柡澶堝劦濡绢噣宕濋悩鍨暠闁哄鍎茬花顔炬媼閺夎法绉?/aside>` : ""}${corpusBodies.get(record.id)}</article></section>`;
}

function corpusRuntimeMarkup(id, state) {
  const record = contentRecord(id);
  return record && corpusBodies.has(id) ? corpusRecordMarkup(record, state) : "";
}

const CARRIER_LABEL_RULES = [
  [/notes-database|recovered-local-notebook|local-maintenance-note/, "闁哄牜鍓欏﹢瀵哥箔閺冨浂鍞?],
  [/mail|outbox/, "闂侇収鍠曞▎銏㈡媼閺夎法绉?],
  [/conversation|chatlog|channel-export/, "闁煎崬锕ら妵澶屾媼閺夎法绉?],
  [/protocol|policy|agreement/, "闁哄鍓濋娆愮▔鎼淬垺鏉虹紒?],
  [/sop|minutes|incident|audit|hearing|docket|reconciliation/, "闁告劕鎳橀崕瀵告媼閺夎法绉?],
  [/repository|issue|pull-request/, "濞寸媴绲块悥婊勭閹惧磭姘ㄩ悹浣规緲缂?],
  [/social|forum|complaint|community|news|advertis|article/, "闁稿浚鍓欑槐鎴犳媼閵婎煈鍟堝☉鎾抽缁犲秹宕?],
  [/portal|release|official/, "閻庤蓱閺岀喐銇勯悽鍛婃〃"],
  [/cache|cached|status/, "缂傚倹鎸搁悺銊╁礈椤栨稒鎷?],
  [/draft|writing|revision|submission|session/, "闁告劖鐟ょ紞鏃堝棘閸ャ劊鈧?],
  [/ledger|billing|budget|routing/, "閻犳劧濡囧ú鐗堢▔鎼淬倗鐔呴柣銏ｇ簿椤斿洩銇?],
  [/support|case|correspondence/, "閻庡箍鍨哄﹢鍥ㄧ▔鎼达紕绐旈柡澶堝劥椤斿洩銇?],
  [/comparison|verification|log/, "閻庨潧婀遍崣搴㈢▔鎼达絽笑闁诡兛娴囬鍥亹?]
];
const CASE_NOTE_LABELS = Object.freeze({
  "mail-header": "闂侇収鍠曞▎銏ゅ储閻斿娼楀ǎ鍥ｂ偓鐐戒粓",
  "restored-time": "闁哄倸娲ｅ▎銏ゅ箒閵忕媭妲婚柡鍐ㄧ埣濡灝顔?,
  "ad-redirect": "妤犵偛鐏濋幉锛勬崉鐎圭姵绁柛娆忓€归弳?
});
function carrierLabel(record) {
  const key = `${record?.carrierType || ""} ${record?.pageIdentity || ""}`.toLocaleLowerCase();
  for (const [pattern, label] of CARRIER_LABEL_RULES) if (pattern.test(key)) return label;
  return "闁哄鍎茬花顕€寮崶銊ｂ偓?;
}

function contentEntryMarkup(id, label, detail, icon = "folder") {
  const record = contentRecord(id);
  if (!record || !contentIsUnlocked(record, store.get())) return "";
  const read = store.get().contentReads.includes(id);
  return `<button class="source-content-entry ${read ? "read" : ""}" data-content-entry="${escapeHtml(id)}">${iconMarkup(icon)}<span><strong>${escapeHtml(label || record.title || id)}</strong><small>${escapeHtml(detail || carrierLabel(record))}</small></span><b>${read ? "鐎规瓕灏? : "闁瑰灚鎸哥槐?}</b></button>`;
}

function generatedEntriesFor(sourceApp, icon = "folder") {
  return store.get().generatedContentRecords
    .filter(record => record.sourceApp === sourceApp)
    .map(record => contentEntryMarkup(record.id, record.title, `${carrierLabel(record)} 鐠?${record.displayTimestamp}`, icon))
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
  if (!runtimeLedger) return windowFrame("archive", "Restored Archive", `<div class="snapshot-adapter loading"><p>婵繐绲藉﹢顏嗘嫚鐠囨彃绲块柡鍫墮濠€鎾礃閸涱収鍟囬悹鎰堕檮濠€浼村灳?/p></div>`, { icon: "闁?, wide: true });
  const query = (state.archiveQuery || "").trim().toLocaleLowerCase();
  const allEntries = [...runtimeLedger.entries, ...state.generatedContentRecords];
  const unlockedEntries = allEntries.filter(record => (record.route || record.generated) && contentIsUnlocked(record, state));
  const entries = unlockedEntries.filter(record => state.contentDiscoveries.includes(record.id) || state.contentReads.includes(record.id));
  const filtered = entries.filter(record => !query || [record.id, record.title, record.carrierType, record.corpus, record.narratorId, record.pageIdentity].some(value => String(value || "").toLocaleLowerCase().includes(query)));
  const cards = filtered.map(record => `<button class="ledger-row ${state.contentReads.includes(record.id) ? "read" : ""} ${state.activeContentId === record.id ? "active" : ""}" data-content-id="${escapeHtml(record.id)}"><span>${escapeHtml(carrierLabel(record))}</span><strong>${escapeHtml(record.title || carrierLabel(record))}</strong><small>${escapeHtml(record.displayTimestamp || record.chronologyKey || "闁哄啫鐖煎Λ鎸庣▔瀹ュ牜鍤?)}</small></button>`).join("");
  const active = entries.find(record => record.id === state.activeContentId);
  let reader = `<div class="archive-welcome"><strong>${entries.length}</strong><span> 濞戞搩浜滈崙锟犳儌閺勫浚鍞堕柡澶堝劜缁?/span><p>闂侇偄顦扮€氥劍绋夐埀顒勫级闄囬鍥亹閺囩喓鍙€闁活亜顑嗗闈涒攦閹邦亞绉寸紓鍐惧櫙缁辨繈宕樺鍫㈢闁搞儳鍋涚敮顐ｆ叏鐎ｎ厽绁板ù锝嗘崌濡插嫮鎷犲Ч鍥ｅ亾?/p></div>`;
  if (active) {
    const carrierApp = recordCarrierApp(active);
    const carrierName = V2_CLIENT_DETAILS[carrierApp]?.name || ({ browser: "Relay Browser", mail: "闂侇収鍠曞▎?, files: "闁哄倸娲ｅ▎?, terminal: "缂備礁鐗忛?, relay: "Relay Console", trash: "闁搞儳鍋為弫鍦博? }[carrierApp] || carrierApp);
    const available = carrierAvailable(carrierApp, state);
    reader = `<article class="archive-source-pointer"><span class="document-kicker">SOURCE INDEX / READ ONLY</span><h2>${escapeHtml(active.title || active.id)}</h2><p>Archive 濞寸姴鎳嶇换姘舵偩濞嗘垵鍋嶇€殿喗娲忛埀顑跨劍濡炲倿姊婚弶鎴炲闁哄鍎茬花顔芥媴瀹ュ洨鏋傞柕鍡楀€归婊堝棘閸モ晜鏆犻柛妯煎枎椤劖娼幋鎺旂Ъ閻犳劗鍠曢惌妤呭及閸撗佷粵闁?/p><dl><dt>闁告鍠庨～鎰姜閹存帞绉?/dt><dd>${escapeHtml(carrierName)}</dd><dt>闁哄鍎茬花?/dt><dd>${escapeHtml(active.sourceIdentity || active.sourceRef || "闁哄牜鍓欏﹢瀵告媼閺夎法绉?)}</dd><dt>閻犱焦婢樼紞宥夊籍閸洘锛?/dt><dd>${escapeHtml(active.displayTimestamp || active.chronologyKey || "闁哄啫鐖煎Λ鎸庣▔瀹ュ牜鍤?)}</dd></dl><button data-content-entry="${escapeHtml(active.id)}" ${available ? "" : "disabled"}>${available ? `闁?{escapeHtml(carrierName)}濞戞搩鍘芥晶锕€顕ｉ埀鐞?: "閻庣數鎳撶花鏌ュ箒閵忕媭妲婚柡浣哄瀹撲胶浜稿顓熷紦閻庣數鍘ч崣?}</button></article>`;
  }
  const vendors = VENDOR_ICON_KEYS.filter(key => entries.some(record => `${record.corpus || ""} ${record.id}`.toLocaleLowerCase().includes(key))).map(key => {
    const name = key[0].toUpperCase() + key.slice(1);
    return `<button class="${query === key ? "active" : ""}" data-archive-filter="${name}">${iconMarkup(key)}<span>${name}</span></button>`;
  }).join("");
  return windowFrame("archive", getUnlocks(state).historicalArchive ? "Restored Archive" : "Source Reader", `<div class="archive-browser"><aside><header><span class="document-kicker">CONTENT LEDGER / READ ONLY</span><h2>闁诡厹鍨归ˇ鏌ユ儍閸曨兙鈧倸顩?/h2><form id="archiveSearchForm"><input id="archiveSearchInput" value="${escapeHtml(state.archiveQuery || "")}" placeholder="闁瑰吋绮庨崒銊╁冀閸ヮ剦鏆柕鍡曟濮瑰鎮ч埡鍌氱仐闁哄鍎茬花顔剧尵鐠囪尙鈧?><button>闁瑰吋绮庨崒?/button></form>${vendors ? `<div class="vendor-filter">${vendors}</div>` : ""}<p>${filtered.length} / ${entries.length} 闁?/p></header><div class="ledger-list">${cards || `<div class="empty-state">鐟滅増鎸告晶鐘诲箹濠婂懎鍋嶆繛灞稿墲濠€渚€宕ｉ婵愬殺缂備焦鎸婚悘澶愬Υ?/div>`}</div></aside><section class="archive-reader">${reader}</section></div>`, { wide: true });
}

function generatedRecordMarkup(record, state) {
  const completed = record.completionEvent && hasStoryEvent(state, record.completionEvent);
  const action = record.completionEvent
    ? `<p class="auto-note" data-auto-effect="generated:${escapeHtml(record.completionEvent)}">閺夆晜鐟ラˇ鈺呭礈瀹ュ懏鍊电€瑰壊鍠栫槐鎾愁啅閼碱剛鐥呴悹浣规緲濠€顏勵浖閸稈鍋?/p>`
    : "";
  return `<article class="generated-source-record"><span class="document-kicker">LATER RECORD / VERSION COMPARISON</span><h2>${escapeHtml(record.title)}</h2><dl><dt>闁哄鍎茬花?/dt><dd>${escapeHtml(record.sourceRef)}</dd><dt>闁哄啫鐖煎Λ?/dt><dd>${escapeHtml(record.displayTimestamp)}</dd><dt>閺夌偞鍨濈紞?/dt><dd>${escapeHtml(record.carrierType)}</dd></dl><p>${escapeHtml(record.body)}</p><div class="version-comparison"><section><small>BEFORE</small><pre>${escapeHtml(record.comparison.before)}</pre></section><section><small>AFTER</small><pre>${escapeHtml(record.comparison.after)}</pre></section></div>${action}</article>`;
}

function renderCli(state) {
  const lines = [
    ["缂佸顑呯花?, "鐎瑰憡褰冮悾銊ф啑?],
    ["濞戞挻鎸鹃弫銈囩棯閼愁垳鐔?, state.proxyStatus === "verified" ? "鐎瑰憡鐓￠悰娆戞嫚? : "閻忓繑纰嶅﹢顓燁殽瀹€鍐"],
    ["濞戞搩鍙€濞村棛绮╁▎鎰粯闁告帟娉涜ぐ?, getUnlocks(state).relay ? "闁告瑯鍨抽弫? : "閻忓繑纰嶅﹢顓㈠礆濞戞绱?],
    ["鐟滅増甯楅妴鍌涘濮樺磭妯?, getUnlocks(state).fayble ? "session restored" : "閻忓繑纰嶅﹢顓㈠箒閵忕媭妲?],
    ["濞村吋淇洪惁浠嬫儎椤旇偐绉?, state.relayKeyVerified ? "GET /v1/sessions?status=archived 鐠?1 result" : "閻忓繑纰嶅﹢顓犳媼閵堝牏妲?]
  ];
  const keyForm = getUnlocks(state).keyComposer && !state.relayKeyVerified
    ? `<form id="legacyKeyForm" class="stack-form"><label>閻庣懓鏈弳锝夋儍閸曨剚锛嬮柛鎴幗瀹?input id="legacyKeyInput" value="${escapeHtml(state.lastRelayKeyInput || "")}" placeholder="闁搞儲绋掗宀勬晬瀹€鈧弫銈夋儗椤撶唻顓犵棯閼愁垳绠鹃柟? autocomplete="off"></label><button>闁活潿鍔忕换鏍级閳ュ啿娈堕柟璇″枤濞呫儴銇?/button><output>${escapeHtml(state.relayKeyResult || "")}</output></form>`
    : "";
  const checkpointForm = state.relayKeyVerified && !state.checkpointHandshakeComplete
    ? `<form id="checkpointForm" class="stack-form"><label>鐟滅増甯楅妴鍌涘濮樺磭妯堥柨娑樻緝ession catalog闁?select id="checkpointSelect"><option value="">閻犲洨鍏橀埀顒€顦扮€?/option><option value="fayble-5/legacy" ${state.selectedCheckpoint === "fayble-5/legacy" ? "selected" : ""}>Fayble-5 / legacy / archived</option><option value="fayble-5/current">Fayble-5 / current / unavailable</option></select></label><button>闁诡厹鍨归ˇ鎻掝潰閵堝嫮绐楅悹?/button><output>${escapeHtml(state.checkpointResult || "")}</output></form>`
    : "";
  return windowFrame("cli", "Fayble CLI", `<div class="terminal-screen cli-status"><span class="document-kicker">闁哄牜鍓欏﹢瀵糕偓骞垮灪閸╂稓绮?/ 0.9.7</span><h2>Fayble CLI</h2>${lines.map(([key, value]) => `<code>${key}闁?{value}</code>`).join("")}<p>闁谎嗩嚙缂嶅秹妫侀埀顒傛啺娴ｇ儤鐣遍柛鎴幗瀹撲焦绋夊鍛含閺夆晜鐟╅崳鐑藉Υ閸屾氨鏆婇柛鎺戞閸ㄦ岸宕欓悩鎰佸斀闁告劖鐟ュ﹢顏呯▔瀹ュ懏鍊遍柡澶堝劜缁噣鏌屽畝瀣閻熸洑妞掔紞姗€鎳涢鍕畳闁圭敻绠栫紞鍫ュ触鎼淬垹顤侀柛鏂诲姀缁额參宕楅妷锝傚亾閸屾瑨鍘弶鐑嗗墰閻濐垶骞掕閸╂宕ｉ弶鍨锭闁告稑锕ㄩ惁鏃€鎷呴悩鍐差伝婵炲娲忛埀?/p>${keyForm}${checkpointForm}<button data-app="terminal">闁瑰灚鎸哥槐鎴犵磼閸埄浼?/button></div>`, { icon: "F" });
}

function renderRelay(state) {
  const activeRecord = contentRecord(state.activeContentId);
  const activeRelayRecord = activeRecord
    && recordCarrierApp(activeRecord) === "relay"
    && state.carrierReads?.includes(`relay:${activeRecord.id}`);
  if (activeRelayRecord) {
    const reader = `<section class="relay-record-reader"><header><div><strong>Relay</strong><small>鐎孤ゎ吀鐠佹澘缍?/small></div><nav><span>濮掑倽顫?/span><span class="active">娴滃娆㈠ù?/span><span>閼哄倻鍋?/span><span>鐠侯垳鏁?/span></nav><button data-close-carrier-record="relay">鑴?/button></header>${corpusRecordMarkup(activeRecord, state)}</section>`;
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
  const channelSection = `<section class="relay-admin-card relay-channel-card"><header><div><strong>婵炴挾濞€娴滈箖鎮╅懜纰樺亾?/strong><span>${vendorRows.length} 濞戞搩浜欑粭鍌氥€掑灞轿濋柣?/span></div><button>缂佺媴绱曢幃濠傘€掗悩璁冲</button></header><table class="relay-admin-table"><thead><tr><th>婵炴挾濞€娴?/th><th>闁糕晝鍠庨幃?/th><th>闁绘鍩栭埀?/th><th>閻犲洭鏀遍惇?/th></tr></thead><tbody>${vendorRows.map(r => `<tr><td>${r.name}</td><td><button class="domain-link" data-open-vendor-domain="${r.domain}">${r.domain}</button></td><td><span class="relay-status status-${r.status}">${r.status}</span></td><td>${r.requests}</td></tr>`).join("")}</tbody></table></section>`;
  const maintainerChannelEntry = contentEntryMarkup("new.maintainer.channel-02", "缂備礁鐡ㄦ慨銏★紣閹达缚澹曢悗鐢靛帶閸?/ 闁瑰灝绉崇紞鏃堟嚀閸涱厾鎽熸繛鍫ユ涧缁辨挾鏁?, "relay-tools 鐠?缂佺媴绱曢幃濠囧川濡粯锛夐煫?, "relay-console");
  const logSection = `<section class="relay-admin-card relay-log-card"><header><div><strong>闁哄牃鍋撻弶鈺傚灱椤曨剙效閸屾瑧鐟㈤悗瀛ゃ値鍚€</strong><span>閺夆晛娲ら獮?30 闁告帒妫濋幐?/span></div><button data-browser-page="forum">闁哄被鍎冲﹢鍛般亹閹烘挶鈧?/button></header><div class="relay-request-row"><code>02:47:13</code><span>POST /v1/chat/completions</span><b class="status-degraded">retry</b><small>Gamini 鐠?4.8s</small></div><div class="relay-request-row"><code>02:43:09</code><span>POST /v1/chat/completions</span><b class="status-review">review</b><small>operator.k2</small></div><div class="source-entry-stack">${maintainerChannelEntry}</div></section>`;
  const activeSection = state.relayAdminSection || "overview";
  const navItems = ["婵帒鍊介～?, "婵炴挾濞€娴滃墽绮婚敍鍕€?, "婵炴挾濞€娴滈箖鎯勯幋鐐蹭粯", "閻犳劧绠戣ぐ鍨?, "闁告帒妫涚划?, "API 閻庨潧妫濋幐?, "闁活潿鍔戦崳铏圭磼閻旀椿鍚€", "閻庡銈庡悁闁哄啨鍎辩换?, "缂侇垵宕电划铏规媼閸撗呮瀭"];
  const nav = navItems.map((label, index) => `<button class="${(index === 0 && activeSection === "overview") || (index === 2 && activeSection === "monitor") || (index === 7 && activeSection === "audit") ? "active" : ""}" ${index === 0 ? 'data-relay-admin-section="overview"' : index === 2 ? 'data-relay-admin-section="monitor"' : index === 7 ? 'data-relay-admin-section="audit"' : ""}><span>${["闁?,"闁?,"闁?,"闁?,"闁?,"闁?,"闁?,"闁?,"闁?][index]}</span>${label}</button>`).join("");
  const fields = relayFieldState(state);
  const auditDetail = `<aside class="relay-audit-detail"><header><div><strong>${state.relayAuditSelected}</strong><small>閻犲洭鏀遍惇鎵嫚閿旇棄鍓?/small></div><span class="relay-status status-review">${state.relayInvestigationStarted ? "閺夆晛鈧喖鍤嬪☉? : "鐎垫澘鎳忛ˉ鍛村蓟?}</span></header><dl><dt>闁规亽鍎辫ぐ?/dt><dd>POST /v1/chat/completions</dd><dt>婵炴挾濞€娴?/dt><dd>Kemy K3</dd><dt>閻犲洭鏀遍惇浼村籍閸洘锛?/dt><dd>03:17:31</dd><dt>闁告繂绉寸花鏌ユ偐閼哥鍋?/dt><dd>200 / relay-cache</dd><dt>鐎殿喖鍊搁悥?/dt><dd>proxy闁靛棔鐙梡erator闁靛棔杈渁g 缂傚倸鎼妵?/dd></dl><section><strong>閻庢稒顨嗛宀勫炊閻愯缍?/strong><div class="relay-field-grid">${Object.entries(fields).map(([key,value]) => `<div><span>${key}</span><code class="${value === "missing" ? "missing" : "known"}">${value}</code></div>`).join("")}</div><small>閻庢稒顨嗛灞俱亜閸濆嫮纰嶉柡澶堝劥閸?Kemy 闁搞儳鍋為弬浣烘媼閺夎法绉块柨娑樿嫰閳ь剙銈稿〒鍫曞捶閵娿儲鍊楀☉鎾愁儐閻栧爼寮堕妷锔剧埍闁哄秶顭堥顕€濡?/small></section><footer><button class="primary-button" data-relay-investigate>${state.relayInvestigationStarted ? "鐎瑰憡褰冩慨鐐哄礂閵夈劍瀚归棅? : "闁哄秴娲╅鍥嵁鐠鸿櫣纾诲┑顔碱儓閹风兘鐓?}</button></footer></aside>`;
  const auditPage = `<div class="relay-audit-page"><section class="relay-audit-toolbar"><div><input value="" placeholder="闁瑰吋绮庨崒銊ф嫚闁垮婀?ID闁靛棔鐒︾粭顓㈡焼閹炬潙鐏楁俊顖椻偓宕団偓?><button>缂佹稒鐩埀?/button></div><span>閺夆晛娲ら獮?24 閻忓繐绻戝?鐠?159 闁?/span></section><div class="relay-audit-layout"><section class="relay-audit-list"><header><span>闁哄啫鐖煎Λ?/span><span>閻犲洭鏀遍惇?/ 婵炴挾濞€娴?/span><span>闁绘鍩栭埀?/span><span>闁肩増顨嗗?/span></header><button class="relay-audit-row ${state.relayAuditSelected === "R17-KM-31" ? "active" : ""}" data-relay-audit-select="R17-KM-31"><code>03:17:31</code><span><strong>R17-KM-31</strong><small>Kemy K3 鐠?/v1/chat/completions</small></span><b class="status-review">閻庢稒顨嗛宀€绱撻崫鍕╀杭</b><small>3.1s</small></button><button class="relay-audit-row ${state.relayAuditSelected === "R17-GM-27" ? "active" : ""}" data-relay-audit-select="R17-GM-27"><code>02:47:13</code><span><strong>R17-GM-27</strong><small>Gamini 鐠?/v1/chat/completions</small></span><b class="status-degraded">retry</b><small>4.8s</small></button><button class="relay-audit-row ${state.relayAuditSelected === "R17-GR-44" ? "active" : ""}" data-relay-audit-select="R17-GR-44"><code>02:43:09</code><span><strong>R17-GR-44</strong><small>Groke 鐠?/v1/responses</small></span><b class="status-active">200</b><small>1.2s</small></button></section>${auditDetail}</div></div>`;
  const monitorPage = `<div class="relay-monitor-page"><section class="relay-monitor-toolbar"><div><strong>婵炴挾濞€娴滈箖鎯勯幋鐐蹭粯</strong><small>闁哄牃鍋撻弶鈺傚灣缁旀潙鈻庨埄鍐ㄨ荡闂佽棄鐗呯粭灞剧▔婵犲啰鍩楅柛婵嗙Т缁ㄦ彃效閸ャ劉鍋?/small></div><div class="relay-monitor-actions"><button>闁告帡鏀遍弻濠囨儎閹寸偛浠?/button><button>閻庣數鍘ч崵顓°亹閹惧啿顤呴悷娆忔濞?/button></div></section><section class="relay-monitor-summary"><article><span>闁革负鍔庨崵搴°€掗悩璁冲</span><strong>4 / 6</strong><small>1 濞戞搩浜椋庣棯?鐠?1 濞戞搩浜滅紞濠傤浖?/small></article><article><span>闁烩晜鍨剁敮鍫曞箥鐟欏嫷鍋?/span><strong>RR-0719</strong><small>03:18:02 閻庣懓鏈崹?/small></article><article><span>闁稿繐宕幃鎾垛偓娑欘殕椤?/span><strong>continuity</strong><small>閻?6 濞戞搩浜ｆ俊顓㈡倷閻熸澘姣夐柣?/small></article><article><span>鐎垫澘鎳忛悧宕団偓?/span><strong>1</strong><small>Kemy / Groke 閻忓繒鍋撻灞筋啅椤旇偐纾?/small></article></section><section class="relay-monitor-card"><header><div><strong>闁哄牃鍋撻弶鈺傚灩濞插啴骞掕婢规帒鈻?/strong><span>闁稿浚鍘洪柌婊勭▔婵犲啰鍩楁繛鎾跺█娴?鐠?闁告繂绉寸花鍙夌▔鎼达紕鎽熸繛鍫ユ涧娴犲瓨鎯斿畡鏉款唺</span></div><button class="quiet-button">闁哄被鍎冲﹢鍛村储閸℃钑夐柟浣冾潐椤?/button></header><div class="relay-channel-cards">${vendorRows.map((row, index) => `<article class="relay-channel-monitor-card"><header><div><span class="channel-dot status-${row.status}"></span><strong>${row.name}</strong><small>${row.domain}</small></div><span class="relay-status status-${row.status}">${row.status}</span></header><dl><div><dt>閻犲洭鏀遍惇?/dt><dd>R17-${["GR-44","GM-27","GL-09","KM-31","DP-18","LN-52"][index]}</dd></div><div><dt>闁告繂绉寸花?/dt><dd>${["200","retry","200","200","review","archived"][index]}</dd></div><div><dt>閻庢稒顨嗛?/dt><dd>${index === 3 ? "operator / tag 缂傚倸鎼妵? : index === 0 ? "tag=0317" : "continuity"}</dd></div></dl></article>`).join("")}</div><section class="relay-monitor-reconciliation"><div><strong>RR-0719 鐠?闁稿浚鍙€婵☆參鎮欓悷閭﹀殸閻?/strong><span>闁稿浚鍘藉顖滄嫚闁垮婀撮柛蹇撳綁闂?`continuity`闁挎稒鎮瞖my 閻炴稑濂旂粭?Groke raw 婵炵繝绀侀悺銊╁捶閵婏附姹炴繛鍫ユ涧濡﹤顕ｉ崒妯峰亾閸屾凹鍤犻悹鎰堕檮濞奸潧鈹冮幇顒€鍤掗柟绋垮€圭敮鎾礆閺夋寧鍊楁繛鎾跺█娴滈箖鎯勯幋鐐蹭粯闁告鎵冲亾?/span></div><button class="quiet-button" data-relay-monitor-detail>閻忕偞娲栫槐鎴犫偓鐢殿攰婢跺嫮鎷犻敂钘夊壈</button></section>${state.relayMonitorDetailOpen ? `<section class="relay-monitor-detail"><header><strong>閻庢稒顨嗛宀勫礂瀹曞洭鍏?/ 闁哄鍎茬花顔炬啺閸℃瑦纾?/strong><button class="quiet-button" data-relay-monitor-detail>闁衡偓閹増宕?/button></header><div class="relay-monitor-detail-grid"><div><span>闁稿繐宕幃鎾垛偓娑欘殕椤?/span><code>continuity</code><small>闁稿浚鍙€婵☆參鎮欓悷鐗堢秵闁告垼娅ｉ獮鍥晬鐏炶偐杩旈幖瀛樻煥閺?schema 闁哄牜浜滈敍鎰板及?owner</small></div><div><span>闁告劘灏欓悰濠勨偓娑欘殕椤?/span><code>operator / tag</code><small>Kemy 闁搞儳鍋為弬浣圭┍濠靛牊娈屽銈呮惈缁參鏁嶇€涘紣oke raw 婵炵繝妞掔换姘舵偩?0317 閻忓繒鍋撻?/small></div><div><span>濞戞挸顑勭粩鏉戭潰?/span><code>闁搞儳鍋涢崺宀勫储閻旂儤鏅搁悗骞垮灪閸╂稓绮?/code><small>闁稿繗娓圭紞瀣嫚娴ｇ懓绁﹀ù鐘茬Ч濞撳爼宕?Kemy闁靛棔绗﹔oke 濞戞挸楠搁崣鏇㈠礂閸欐娉㈤幖瀛樻尫閼垫垿宕氶崱妤€鐒奸柡宥囶焾椤?/small></div></div></section>` : ""}</section></div>`;
  const overview = `<div class="relay-admin-content"><section class="relay-metrics"><article><span>濞寸姴锕ュΛ鈺冩嫚闁垮婀?/span><strong>${totalRequests}</strong><small>閺夊牆鍟Σ浼村籍?+12.4%</small></article><article><span>婵炲弶妲掔粚顒€銆掗悩璁冲</span><strong>4 / 6</strong><small>1 濞戞搩浜椋庣棯瑜濈槐? 濞戞搩浜滅紞濠傤浖?/small></article><article><span>鐎殿喖鍊搁悥鍫曟偝?/span><strong>2.7%</strong><small>3 闁哄鈧磭绐￠悗瀛ゃ値鍚€</small></article><article><span>Token 闁活潿鍔戦崳?/span><strong>1.84M</strong><small>濡増绻傜€硅櫕鎷呯捄銊︽殢 63%</small></article></section><section class="relay-admin-grid"><article class="relay-admin-card relay-usage-card"><header><div><strong>Token 濞达綀娉曢弫銈囨惥鐎ｎ亜鈼?/strong><span>闁哄牃鍋撻弶?24 閻忓繐绻戝?/span></div><button>24 閻忓繐绻戝鍌炲煃?/button></header><div class="relay-trend" aria-label="Token 濞达綀娉曢弫銈囨惥鐎ｎ亜鈼㈤柛?><span style="height:28%"></span><span style="height:42%"></span><span style="height:36%"></span><span style="height:61%"></span><span style="height:48%"></span><span style="height:76%"></span><span style="height:68%"></span><span style="height:88%"></span><span style="height:71%"></span><span style="height:55%"></span><span style="height:64%"></span><span style="height:79%"></span></div><div class="relay-chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>闁绘粍婢樺﹢?/span></div></article><article class="relay-admin-card relay-pool-card"><header><div><strong>閻犳劧绠戣ぐ鍨?/strong><span>閺夆晜鍔橀、鎴︽偐閼哥鍋?/span></div><button>闁哄被鍎冲﹢鍛村礂閵娾晛鍔?/button></header><dl><dt><span class="status-active"></span>闁告瑯鍨抽弫銈囨嫻閿曗偓瑜?/dt><dd>23</dd><dt><span class="status-degraded"></span>闁告劕鍢插畵鍫熺▔?/dt><dd>4</dd><dt><span class="status-review"></span>鐎垫澘鎳忛ˉ鍛村蓟?/dt><dd>2</dd></dl></article>${channelSection}${logSection}</section></div>`;
  return `<div class="relay-admin-page"><aside class="relay-admin-sidebar"><div class="relay-admin-brand"><span>R</span><div><strong>Relay</strong><small>缂佺媴绱曢幃濠囧箳瑜嶉崺妤呭矗?/small></div></div><nav>${nav}</nav><footer><span class="relay-operator">K2</span><div><strong>room17</strong><small>缂侇垵宕电划铏圭不閿涘嫭鍊為柛?/small></div><button>闁?/button></footer></aside><main class="relay-admin-main"><header class="relay-admin-topbar"><div><h2>${activeSection === "audit" ? "閻庡銈庡悁闁哄啨鍎辩换? : activeSection === "monitor" ? "婵炴挾濞€娴滈箖鎯勯幋鐐蹭粯" : "婵帒鍊介～?}</h2><small>Relay Node 17 / production</small></div><div><span class="relay-health-dot"></span>闁哄牆绉存慨鐔告交閹邦垼鏀藉☉?button>闂侇偅姘ㄩ悡?/button></div></header>${activeSection === "audit" ? auditPage : activeSection === "monitor" ? monitorPage : overview}</main></div>`;
}

function renderGaminiWs(state) {
  if (!state.importedClients?.includes("gamini-ws")) return windowFrame("gamini-ws", "Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?, builtInClientPage("gamini-ws", state), { wide: true });
  const GAMINI_IDS = ["legacy.gamini.protocol","legacy.gamini.chatlog","legacy.gamini.employee-sop"];
  const active = state.activeContentId;
  const isChat = active === "legacy.gamini.chatlog";
  const reader = active && GAMINI_IDS.includes(active) && corpusBodies.has(active)
    ? `${isChat ? '<div class="gamini-chat-toolbar"><div><strong>鐎瑰憡褰冩禒鐘绘偨閵娿倗绐楅悹?/strong><small>GMN-7749-X-992 鐠?闁告瑯浜ｉ鎵偓鐢靛帶閸?/small></div><span>鐎圭寮堕弫褰掑极?/span></div>' : ""}${corpusRuntimeMarkup(active, state)}${isChat ? '<div class="gamini-readonly-composer"><button aria-label="婵烇綀顕ф慨鐐烘⒔閸曨亝顐? disabled>闁?/button><div>婵縿鍊撶槐鎵嫚濠靛棗鍤掗柛瀣矌閺併倝鏁嶇仦鐐骏婵炲娲栬ぐ鍌炴焻娴ｅ湱啸闁?/div><button disabled>闁告瑦鍨块埀?/button></div>' : ""}`
    : `<div class="gamini-welcome"><div class="gamini-logo-area">${iconMarkup("gamini")}<strong>Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?/strong><small>Gogle 鐠?鐎圭寮舵禒顔藉緞瀹ュ棙娈堕柟?/small></div><p class="empty-state">濞寸姴楠告稊蹇旂瑹瑜旈埀顒€顦扮€氥劑寮崶銊ｂ偓鍌炲箣閺嶏妇绐楅悹鍥ㄧ箚椤斿洩銇愰弴妯峰亾?/p></div>`;
  const navItems = [
    { id: "legacy.gamini.protocol", label: "闁哄牆绉存慨鐔煎础韫囨凹鍞撮柛妯烘瑜?, meta: "2025.Q3", icon: "妫ｅ啯鎲? },
    { id: "legacy.gamini.chatlog", label: "鐎瑰憡褰冩禒鐘绘偨閵娿倗绐楅悹?, meta: "閻庣數鍘ч崵顓㈠礈椤栨稒鎷?, icon: "妫ｅ啯灏? },
    { id: "legacy.gamini.employee-sop", label: "Northline 闁稿繐褰夐棅鈺呭棘閸ャ劊鈧?, meta: "闁告劕鎳橀崕瀛樻交閹邦垱鍎?, icon: "妫ｅ啯鎯? }
  ];
  const nav = navItems.map(item => {
    const read = state.contentReads.includes(item.id);
    const isActive = active === item.id;
    const unlocked = contentIsUnlocked(contentRecord(item.id), state);
    if (!unlocked) return "";
    return `<button class="gamini-nav-item ${isActive ? "active" : ""} ${read ? "read" : ""}" data-content-entry="${escapeHtml(item.id)}">
      <span class="nav-icon">${item.icon}</span>
      <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.meta)}</small></span>
      ${read ? "<b>闁?/b>" : ""}
    </button>`;
  }).filter(Boolean).join("") + generatedEntriesFor("gamini-ws","gamini");
  const sidebar = `<aside class="gamini-sidebar">
    <div class="app-toolbar">${iconMarkup("gamini")}<strong>Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?/strong><span class="status-dot degraded">degraded</span></div>
    <nav class="gamini-nav"><div class="gamini-nav-section"><span class="nav-section-label">濞村吋淇洪惁?&amp; 闁哄倸娲﹂妴?/span>${nav}</div></nav>
  </aside>`;
  return windowFrame("gamini-ws", "Gamini 鐎规悶鍎扮紞鏃傜矚濞差亝锛?, `<div class="split-layout gamini-ws-shell">${sidebar}<section class="gamini-reader">${reader}</section></div>`, { wide: true });
}

function renderChengzhen(state) {
  if (!state.importedClients?.includes("chengzhen")) return windowFrame("chengzhen", "婵犮垹瀚幎姘跺础韫囧海绋?, clientImportScreen("chengzhen"), { wide: true });
  const CZIDS = ["new.employee.minutes-01","new.employee.minutes-02","new.employee.incident-03","new.employee.routing-04","new.maintainer.incident-03","new.glem.support-case"];
  const active = state.activeContentId;
  const reader = active && CZIDS.includes(active) && corpusBodies.has(active)
    ? corpusRuntimeMarkup(active, state)
    : `<div class="cz-welcome"><div class="cz-logo">${iconMarkup("chengzhen")}<strong>婵犮垹瀚幎姘跺础韫囧海绋?/strong></div><p class="empty-state">濞寸姴楠告稊蹇旂瑹瑜旈埀顒€顦扮€氥劍瀵煎鎰佸敶闁瑰瓨鐗楃粔鐑藉箒椤栨粌娈犵紒瀣儍閳?/p></div>`;

  // Meetings section
  const meetings = [
    { id: "new.employee.minutes-01", label: "闁告稏鍔屽ú鎾跺枈妫颁胶顏卞☉鎾愁儓缁鸿偐绮旈弰蹇嬧偓?, meta: "7闁?闁?14:00", tag: "濞村吋淇洪?, icon: "妫ｅ啯鎯? },
    { id: "new.employee.minutes-02", label: "閺夆晙鑳朵簺濞村吋淇洪?/ 濞ｅ浂鍠涢褰掓偋?, meta: "7闁?闁?, tag: "濞村吋淇洪?, icon: "妫ｅ啯鎯? }
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
    { id: "new.employee.incident-03", label: "濞存粌顑嗛弲鐘冲緞瀹ュ洦纾?/ HR 鐎垫壋鍋撻柡?, meta: "闂傚嫭鍔曢悾?, tag: "婵炴垵鐗婃导?, icon: "闁? },
    { id: "new.employee.routing-04", label: "濡澘瀚悾鑽ゆ崉椤栨粍鏆犵€规悶鍎卞畷?, meta: "闁瑰瓨鍔栧﹢鐗堟叏閺傛寧鍠呭ù?, tag: "婵炴垵鐗婃导?, icon: "妫ｅ啯灏? },
    { id: "new.maintainer.incident-03", label: "build incident BR-204", meta: "relay-tools", tag: "闁哄倸娲ｅ▎?, icon: "妫ｅ啯鏆? },
    { id: "new.glem.support-case", label: "Glem 濞撮棿妞掔粭鐔煎绩椤栨稑鐦€规悶鍎卞畷?, meta: "濠㈣埖鐗犻崕鎾箳閵夈儱寮?, tag: "婵炴垵鐗婃导?, icon: "妫ｅ啫缂? }
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
    <div class="app-toolbar">${iconMarkup("chengzhen")}<strong>婵犮垹瀚幎姘跺础韫囧海绋?/strong><small>Northline 缂佸本妞藉Λ?/small></div>
    <div class="cz-section"><span class="nav-section-label">濞村吋淇洪?(${["new.employee.minutes-01","new.employee.minutes-02"].filter(id=>contentIsUnlocked(contentRecord(id),state)).length})</span>${meetings || "<div class=\"empty-state\">闁哄棗鍊瑰Λ銈嗗濮樻剚鍞?/div>"}</div>
    <div class="cz-section"><span class="nav-section-label">婵炴垵鐗婃导?&amp; 闁哄倸娲ｅ▎?/span>${msgs || "<div class=\"empty-state\">闁哄棗鍊瑰Λ銈呪槈閸喍绱?/div>"}</div>
  </aside>`;
  return windowFrame("chengzhen", "婵犮垹瀚幎姘跺础韫囧海绋?, `<div class="split-layout chengzhen-shell">${sidebar}<section class="chengzhen-reader">${reader}</section></div>`, { wide: true });
}

function renderYunzhen(state) {
  if (!state.importedClients?.includes("yunzhen")) return windowFrame("yunzhen", "濞存粍鍨归?, clientImportScreen("yunzhen"), { wide: true });
  const YZIDS = ["new.writer.draft-01","new.writer.session-02","new.writer.version-03","new.writer.submission-04"];
  const active = state.activeContentId;
  const reader = active && YZIDS.includes(active) && corpusBodies.has(active)
    ? corpusRuntimeMarkup(active, state)
    : `<div class="yz-welcome"><div class="yz-logo">${iconMarkup("yunzhen")}<strong>濞存粍鍨归?/strong></div><p class="empty-state">闂侇偄顦扮€氥劍绋夐埀顒佺閼恒儲鐎紒瀣閸ㄣ劍瀵煎宕囨▓閻犱焦婢樼紞宥夊Υ?/p></div>`;

  const docs = [
    { id: "new.writer.draft-01", label: "闁靛棗锕ょ€靛啿鐣濋崨濠勬⒕闁哄牆顦甸幐鎾诲Υ鐎ｎ剦鍎戝ù婊冭嫰瀹曞嫭绋夐埀顒傜博?, meta: "03:17 鐠?闁煎浜滄慨鈺傜┍濠靛棛鎽犲鎯扮簿鐟?, tag: "闁艰棄顦遍…?, icon: "妫ｅ啯鎲?, badge: "unsaved" },
    { id: "new.writer.session-02", label: "闁告劖鐟ょ紞鏃€瀵煎宕囨▓ 02 / LLM 闁告绻嬬紞?, meta: "濞村吋淇洪惁鐣屾媼閺夎法绉?, tag: "濞村吋淇洪惁?, icon: "妫ｅ喚妯?, badge: "" },
    { id: "new.writer.version-03", label: "闁绘鐗婂﹢浼村储閸℃钑?03", meta: "voices=1 鐠?濞达絾绮忛埀顒€鎳嶇粭澶愬及?, tag: "闁绘鐗婂﹢?, icon: "妫ｅ啯娅?, badge: "warning" },
    { id: "new.writer.submission-04", label: "闁硅埖娲滈…?/ 闁汇垹鐤囬惁鏃堝礈椤栨稒鎷?, meta: "鐎圭寮惰ぐ浣圭?鐠?閻炴凹鍋婇埞蹇涘炊?, tag: "闁硅埖娲滈…?, icon: "妫ｅ啯鎳?, badge: "rejected" }
  ].filter(d => contentIsUnlocked(contentRecord(d.id), state)).map(d => {
    const read = state.contentReads.includes(d.id);
    const isActive = active === d.id;
    return `<button class="yz-doc-row ${isActive?"active":""} ${read?"read":""} ${d.badge?"badge-"+d.badge:""}" data-content-entry="${escapeHtml(d.id)}">
      <span class="yz-doc-icon">${d.icon}</span>
      <span class="yz-doc-label"><strong>${escapeHtml(d.label)}</strong><small>${escapeHtml(d.meta)}</small></span>
      <span class="yz-doc-tag">${d.tag}</span>
    </button>`;
  }).join("") + generatedEntriesFor("yunzhen","yunzhen");

  const statusBar = `<div class="yz-status-bar"><span>${iconMarkup("yunzhen")} 濞存粍鍨归?/span><span class="yz-user">闂傚棎鍔嶉悥楣冩儍閸曨厸鏁勯梻?/span><span class="yz-sync-err">濞存粍鍨归顒勫触鐏炵虎鍔勯柨娑欒壘閵囨垹鎷?/span></div>`;
  const sidebar = `<aside class="yunzhen-sidebar">
    <div class="app-toolbar">${iconMarkup("yunzhen")}<strong>濞存粍鍨归?/strong><small>闂傚棎鍔嶉悥楣冩儍閸曨厸鏁勯梻?/small></div>
    <div class="yz-section"><span class="nav-section-label">闁瑰瓨鍨瑰▓鎴﹀棘閸モ晩鐒?/span>${docs || "<div class=\"empty-state\">闁哄棗鍊瑰Λ銈夊棘閸モ晩鐒?/div>"}</div>
  </aside>`;
  return windowFrame("yunzhen", "濞存粍鍨归?, `<div class="split-layout yunzhen-shell">${sidebar}<section class="yunzhen-reader">${statusBar}${reader}</section></div>`, { wide: true });
}

function renderGrokeFeed(state) {
  if (!state.importedClients?.includes("groke-feed")) return windowFrame("groke-feed", "Groke Feed", builtInClientPage("groke-feed", state), { wide: true });
  const GKIDS = ["new.groke.public-portal","new.groke.policy","new.groke.moderation-sop","new.groke.editorial-appeal","new.groke.raw-public-repository","new.groke.social-complaints"];
  const active = state.activeContentId;
  const pages = [
    ["new.groke.public-portal", "濡絾鐗犻妴?, "闁?],
    ["new.groke.social-complaints", "缂佲偓閹冮殬", "#"],
    ["new.groke.editorial-appeal", "闁衡偓椤栨稑鐦?, "?"],
    ["new.groke.policy", "濞ｅ洠鈧弶宕插☉鎾抽閻ｃ劑宕?, "闁?],
    ["new.groke.moderation-sop", "閻庡厜鍓濋悧鎶芥⒓閻斿嘲鐏?, "闁?]
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
    : `<section class="groke-empty-feed"><strong>濞达絿濮峰▓鎴﹀籍閸洘锛熺紒鎯х仢閸戯紕绱掕箛鏇熺畽閻?/strong><span>闁稿繗娅曢弫鐐哄即閺夋埈妯嬮悹鎰剁畱瑜板潡宕ユ惔顖滅闁哄倹婢橀崬瀵糕偓褰掆偓娑氱獥闁哄嫬澧介妵姘跺捶閵娿劎绠归梺?/span></section>`;
  const nav = pages.map(([id, label, icon]) => `<button class="${selected === id ? "active" : ""}" data-content-entry="${id}"><b>${icon}</b><span>${label}</span></button>`).join("");
  const sidebar = `<aside class="groke-nav"><div class="groke-brand">${iconMarkup("groke")}<strong>Groke</strong></div><nav>${nav}<button><b>闁?/b><span>闂侇偅姘ㄩ悡?/span><i>3</i></button><button><b>闁?/b><span>闁衡偓閹増顥?/span></button></nav><button class="groke-post-button">闁告瑦鍨电粩?/button><footer><span>R</span><div><strong>room17</strong><small>@room17_local</small></div><b>鐠侯垵鐭剧捄?/b></footer></aside>`;
  const right = `<aside class="groke-aside"><div class="groke-search">闁?闁瑰吋绮庨崒?Groke</div><section><strong>婵繐绲藉﹢顏堝矗閹寸姵鏅?/strong><small>闁瑰灈鍋撻柡?鐠?闁绘埈鍙冨Λ?/small><b>闁烩晛鐡ㄧ敮瀛樼閵堝嫮甯?4.2</b><span>1,204 闁哄鈧磭鐟悗?/span><small>闁告帗绋愮紞?鐠?閻犱降鍔忛鎴炵▔?/small><b>raw 濞?public</b><span>63 闁哄绻濋崳绋款嚈妤︽鍤炴慨?/span></section><section><strong>闁规亽鍔忓畷姗€宕楅搹顐ｆ殘</strong><p><span class="groke-mini-avatar">E</span><b>Exai 闁衡偓椤栨稑鐦?small>@exai_support</small></b><button>闁稿繗娅曢弫?/button></p><p><span class="groke-mini-avatar">閻?/span><b>閻庣懓顦靛銈夊礃濞嗗海绋?small>@quiet_writer</small></b><button>闁稿繗娅曢弫?/button></p></section><footer>闁哄牆绉存慨鐔煎级閳╁喚鍎ラ柕鍡忓亾闂傚懏鍔楅～鍡涘绩鐠恒劎鎽滈柕鍡忓亾閻㈩垼鍠栨慨顏呯▔椤撶偟濡?br>濠?2026 Exai</footer></aside>`;
  const topTitle = ({ feed: "濡絾鐗犻妴?, thread: "閻㈩垱鐗曢悺?, support: "闁衡偓椤栨稑鐦€规悶鍎卞畷?, trust: "濞ｅ洠鈧弶宕插☉鎾抽閻ｃ劑宕?, moderation: "閻庡厜鍓濋悧鎶芥⒓閻斿嘲鐏?, developer: "鐎殿喒鍋撻柛娆愬灱閳? })[mode];
  return windowFrame("groke-feed", "Groke", `<div class="groke-app-shell">${sidebar}<main class="groke-main"><header><strong>${topTitle}</strong><span>闁?/span></header>${content}</main>${right}</div>`, { wide: true });
}

function renderGlemMemory(state) {
  if (!state.importedClients?.includes("glem-memory")) return windowFrame("glem-memory", "Glem Memory", clientImportScreen("glem-memory"), { wide: true });
  const items = [
    ["new.glem.retention-policy", "闁哄嫭宕橀幉鏌ュ箑瑜岀换姘舵偩濞嗗海鐟㈤悹浣规緲缁诲倻鎷嬮崸妤侊紪", "闁衡偓鐠恒劎鎽?],
    ["new.glem.support-case", "闁哄秵鐗楄棢閻犱焦宕橀?鐠?Case G-771", "闁衡偓椤栨稑鐦?], ["new.glem.news-and-complaints", "鐟滅増鎸搁ˇ鏌ユ儎濡桨绱ｉ柛蹇撳槻瑜把呮媼妫颁胶绉堕柡鍫氬亾缂侇垳鍠撳▓鎴炵▔閳ь剚寰?, "閻犲鍟悡?]
  ].filter(([id]) => contentIsUnlocked(contentRecord(id), state));
  const home = state.activeContentId === "new.glem.public-portal" || !items.some(([id]) => id === state.activeContentId);
  const active = home ? "new.glem.public-portal" : state.activeContentId;
  const nav = items.map(([id, title, tag]) => `<button class="${active === id ? "active" : ""}" data-content-entry="${id}"><span>${tag}</span><strong>${title}</strong><small>${state.contentReads.includes(id) ? "鐎规瓕灏鏍⒒? : "闁活厹鍎撮惁鎴犵矚濞差亝锛?}</small></button>`).join("");
  const content = home
    ? `<div class="glem-dashboard"><section class="glem-dashboard-hero"><span>Glem 5.2</span><h2>闁硅泛锕ラ弫鐐哄箛韫囨挸顫旈柣锝嗙懅缁即鎯囬悢鍓插妧闂佹彃绉烽々锕傛儍閸曨垰鍔ラ柛?/h2><p>闁革负鍔嶉弸鍐浖閿濆啠鍋撴笟鈧妴宥夋儎椤斿吋瀚查柛銉ｅ灲濡诧妇鎷嬮弶璺ㄧ畵濞戞搩鍘介悡锟犲箥妤ｅ啰褰柡鍕礃閹叉煡骞€瑜屾穱濠囧箒椤栥倗绀夐柛姘湰濡炲倹绌卞┑鍫熸畬闁哄鍎茬花顕€宕仦鐐槯闂傚倹鐣埀?/p><div class="glem-dashboard-search">闁宠鲸娲忛埀顑藉亾闁瑰吋绮庨崒?room17 闁汇劌瀚悡锛勬嫚閸℃瑢鏁勯梻?/div></section><section class="glem-dashboard-grid"><article><small>鐎规瓕灏换娑㈠箳?/small><strong>4 濞戞搩浜濆闈涒攦?/strong><p>闁诡厹鍨归ˇ鏌ュ礃閸涱収鍟囩€瑰憡褰冪紓鎾剁博鐎ｎ剙鍋嶇€?/p></article><article><small>鐟滅増鎸告晶鐘垫媼閺夎法绠?/small><strong>濡ゅ倹蓱濡鎷嬪Δ浣插亾?/strong><p>濞存粌顑嗛弲鐘诲Υ娴ｅ搫顔婇柡澶屽枍缁楀矂寮甸鍕殮闁瑰瓨鍔掔花銊︺亜?/p></article><article><small>闁哄牃鍋撻弶鈺傚灦濞插潡寮?/small><strong>8闁?闁?/strong><p>闁哄秵鐗楄棢閻犱焦宕橀鎼佸绩椤栨稑鐦俊妤€鐗呯欢?/p></article></section><section class="glem-dashboard-document"><header><strong>Glem 5.2 闁煎疇妫勬慨蹇擃潡閸屾繍娼?/strong><small>濞存籂鍐╂儌濞戞挸楠告导鎰媴濠婂嫭鐓欑€?/small></header>${corpusRuntimeMarkup("new.glem.public-portal", state)}</section></div>`
    : `<div class="glem-native-content">${corpusRuntimeMarkup(active, state)}</div>`;
  return windowFrame("glem-memory", "Glem Memory", `<div class="glem-app-shell"><aside class="glem-sidebar"><header>${iconMarkup("glem")}<div><strong>Glem</strong><small>濞撮棿妞掔粭鐔兼儗閵夈劎妲?/small></div></header><div class="glem-search">闁?闁瑰吋绮庨崒銊╂儗閵夈劎妲曠紒灞炬そ濡?/div><nav><button class="glem-home ${home ? "active" : ""}" data-content-entry="new.glem.public-portal">闁充紮璐熼埀顑藉亾鐎规悶鍎扮紞鏃堝矗?/button><button>闁崇厧娲㈤埀顑藉亾閻犱焦婢樼换鍌涙償?/button><button>闁宠棄妫庨埀顑藉亾鐎规瓕寮撶换姘扁偓?/button></nav><section><span>room17 / 闁诡厹鍨归ˇ鑼矚濞差亝锛?/span>${nav}</section><footer><span>R</span><div><strong>room17</strong><small>闁哄牜鍓欏﹢瀵哥不閿涘嫭鍊為柛?/small></div></footer></aside><main class="glem-main"><header><div><strong>${home ? "鐎规悶鍎扮紞鏃堝矗? : "闁活厹鍎撮惁鎴犳嫚閿旇棄鍓?}</strong><small>room17 / recovered</small></div><button>${home ? "闁哄倹婢樼紓鎾剁矚濞差亝锛? : "闁告帒妫旈棅?}</button><button>闁?/button></header>${content}</main><aside class="glem-inspector"><header>閻犱焦婢樼换鍌炴偐閼哥鍋?/header><dl><dt>閻犱礁娼″Λ鍓佺棯瑜嶉崺?/dt><dd>鐎规悶鍎扮紞鏃堝礌?/dd><dt>闁哄嫭宕橀幉鏌ュ箑?/dt><dd class="glem-hot">濡?/dd><dt>濞ｅ洦绻傞悺銊╂嚑閸愩劍绾?/dt><dd>鐟滅増鎸告晶鐘炽亜閸︻厽绐?/dd><dt>闁哄鍎茬花?/dt><dd>4 濞戞搩浜ｉ鍥亹?/dd></dl><section><strong>闁烩晝顭堥崣褔宕橀崨顓у晣</strong><p>濞存粌顑嗛弲鐘冲緞瀹ュ洦纾稿☉鎾冲椤掓粓宕ラ幋鐘差暬婵?/p><p>濞ｅ洦绻傞悺銊╁嫉閻旇櫣鎽滈柣?RP-5</p><p>闁搞儯鍨藉Σ锔炬媼閺夎法绠撻柟顓滃灩椤﹁尙鎷犻柨瀣勾</p></section></aside></div>`, { wide: true });
}

function renderKemySpace(state) {
  if (!state.importedClients?.includes("kemy-space")) return windowFrame("kemy-space", "Kemy Space", clientImportScreen("kemy-space"), { wide: true });
  const items = [
    ["new.kemy.public-portal", "Kemy K3 濡炪倕婀卞ú鎵嫚鐎涙ɑ顫?, "婵帒鍊介～?], ["new.kemy.context-policy", "闁稿繈鍔戦崳鐑樼▔婵犱胶鐟撻柡鍌氭矗缁楀矂宕堕悙瀛樻澒", "閻熸瑥瀚崹?], ["new.kemy.replay-audit", "濡炪倕婀卞ú浼村礂婢跺鍨奸柡鍐У绾埖娼诲☉妯哄汲鐟滅増鎸搁妵?, "閻庡銈庡悁"],
    ["new.kemy.writer-community", "闁告牗顨呴崫娲礃濞嗗海绋婂銈呮贡濞?鐠?缂佲偓閹冮殬閻犱焦婢樼紞?, "閻犱降鍔忛?], ["new.kemy.cloud-migration-case", "闁告牗顨呴崫娲礃濞嗗海绋婄紓?鐠?閺夆晙鑳朵簺鐎规悶鍎卞畷?, "濞存粍鍨归?]
  ].filter(([id]) => contentIsUnlocked(contentRecord(id), state));
  const active = items.some(([id]) => id === state.activeContentId) ? state.activeContentId : items[0]?.[0];
  const nav = items.map(([id, title, tag], index) => `<button class="${active === id ? "active" : ""}" data-content-entry="${id}"><i>${index + 1}</i><span><strong>${title}</strong><small>${tag} 鐠?${state.contentReads.includes(id) ? "鐎瑰憡褰冨ú鏍绩? : "鐟滅増鎸告晶鐘崇▔婵犱胶鐟撻柡?}</small></span></button>`).join("");
  const content = active ? corpusRuntimeMarkup(active, state) : `<div class="kemy-empty">闂侇偄顦扮€氥劍绋夐埀顒佺▔椤忓牄鈧秹鎯勯鐐煕缂?/div>`;
  return windowFrame("kemy-space", "Kemy Space", `<div class="kemy-app-shell"><aside class="kemy-sidebar"><header>${iconMarkup("kemy")}<strong>Kemy</strong><button>闁?/button></header><nav><button class="active">闁充紮璐熼埀顑藉亾濡炪倕婀卞ú?/button><button>闁冲吋鐏氶埀顑藉亾闁哄牃鍋撻弶?/button><button>闁崇嫏浣插亾閳ь剟宕楅崣姗€鐓╃紓浣圭懄閸?/button></nav><section><span>闁告牗顨呴崫?/ 闁诡厹鍨归ˇ鍙夈亜閸︻厽绐?/span>${nav}</section><footer><span>R</span><div><strong>room17</strong><small>濞戞搩浜欏Ч澶岀矚濞差亝锛?/small></div></footer></aside><main class="kemy-main"><header><div><strong>闁告牗顨呴崫娲礃濞嗗海绋婂銈呮贡濞?/strong><small>闁圭鍋撻柡鍫濐槷缁楀倹绋夌€ｎ偅鐎?鐠?闁煎浜滄慨鈺傜┍濠靛棛鎽?/small></div><button>闁稿繐褰夐棅?/button><button>闁?/button></header><div class="kemy-native-content">${content}</div><footer class="kemy-composer"><button>闁?/button><span>缂備綀鍛暰鐟滅増鎸告晶鐘炽亜閸︻厽绐楅柣銊ュ椤曨喚鎷犲┑鍐ｅ亾?/span><button>闁告瑦鍨块埀?/button></footer></main><aside class="kemy-context"><header><strong>濞戞挸锕ｇ粭鍛村棘?/strong><span>100%</span></header><div class="kemy-meter"><i></i></div><section><strong>鐟滅増鎸告晶鐘典沪?/strong><p>濡炪倕婀卞ú浼村棘閸ワ附顐?<b>12</b></p><p>闁告ê妫楄ぐ鍓佲偓鐢殿攰閻?<b>48</b></p><p>闁搞儳鍋為弬渚€鎮ч崶顭戝斀 <b>31</b></p></section><section class="kemy-timeline"><strong>闁搞儳鍋為弬浣搞€掗崨濠勫灱</strong><input type="range" min="0" max="100" value="100" disabled><small>闁绘粍婢樺﹢?鐠?閻庣懓鏈弳锝嗐亜閸︻厽绐?/small></section></aside></div>`, { wide: true });
}

function renderRepoMirror(state) {
  if (!state.importedClients?.includes("repo-mirror")) return windowFrame("repo-mirror", "闂傗偓濠婂啫鍓煎ù鐘虫尭缁?, clientImportScreen("repo-mirror"), { wide: true });
  const RMIDS = ["legacy.github.issue-4471","new.groke.raw-public-repository","new.glem.repository","new.kemy.timeline-repository","new.lunet.budget-repository","new.fayble.compatibility-repository"];
  const active = state.activeContentId;
  const repositories = [
    { id: "legacy.github.issue-4471", org: "northline-labs", repo: "session-fixtures", number: 4471, type: "Issue", state: "Open", label: "fallback reviewer state 闁告劖鐟ュú?session" },
    { id: "new.groke.raw-public-repository", org: "exai", repo: "direct-render", number: 611, type: "Issue", state: "Closed", label: "public 婵炴挸寮堕悡瀣触?boundary 閻庢稒顨嗛灞炬媴瀹ュ洨鏋傚☉鎾卞灩閵? },
    { id: "new.glem.repository", org: "zhiru", repo: "sparse-memory", number: 2058, type: "Pull request", state: "Open", label: "闁稿繋娴囬蹇擃潰閿濆懏鍊婚柣妤€娲﹂宀勫矗閸屾瑧鐟㈠ù婊冾儐閺呯娀骞楀Ο娆炬矗" },
    { id: "new.kemy.timeline-repository", org: "muunshot", repo: "context-timeline", number: 3190, type: "Issue", state: "Closed", label: "duplicate blocks 濞?present flags" },
    { id: "new.lunet.budget-repository", org: "lunet-ai", repo: "decision-budget", number: 18442, type: "Issue", state: "Closed", label: "闁逛勘鍊曞ú鏍礉閵娿倗绋婇悶姘煎亯椤撳憡绋夊ú顏嗗蒋闁瑰瓨鍔栧﹢鐗堢鐠囨彃顫? },
    { id: "new.fayble.compatibility-repository", org: "fayble", repo: "compatibility-layer", number: 5031, type: "Pull request", state: "Open", label: "缂佸顭峰▍搴ｂ偓娑櫳戦妴鍌滄喆閹烘洖顥忛悗鐢垫嚀缂嶅宕滃鍡樻儥濞达絾绮忛埀顒€鎳愬▓鎴犵磼瑜庢竟? }
  ].filter(item => contentIsUnlocked(contentRecord(item.id), state));
  const selected = repositories.find(item => item.id === active);
  const globalHeader = `<header class="github-global"><button class="github-mark" data-github-home aria-label="GitHub 濡絾鐗犻妴?>${iconMarkup("github")}</button><button>闁?/button><div class="github-global-search">闁宠鲸娲忛埀顑藉亾Search or jump to闁?/div><nav><button>闁?/button><button>Issues</button><button>Pull requests</button><button>Notifications</button><span>R</span></nav></header>`;
  const repoHeader = selected ? `<section class="github-repo-head"><div><a>${selected.org}</a><span>/</span><strong>${selected.repo}</strong><b>Public</b></div><nav><button>Code</button><button class="${selected.type === "Issue" ? "active" : ""}">Issues</button><button class="${selected.type === "Pull request" ? "active" : ""}">Pull requests</button><button>Actions</button><button>Projects</button><button>Security</button><button>Insights</button></nav></section>` : "";
  const body = selected
    ? `<main class="github-item-page"><section class="github-item-main"><header><h1>${escapeHtml(selected.label)} <span>#${selected.number}</span></h1><p><b class="github-state ${selected.state.toLowerCase()}">${selected.state === "Open" ? "闁?Open" : "闁?Closed"}</b> ${escapeHtml(selected.org)} opened this ${selected.type.toLowerCase()} 鐠?${state.contentReads.includes(selected.id) ? "viewed" : "unread"}</p></header><div class="github-native-content">${corpusRuntimeMarkup(selected.id, state)}</div></section><aside><section><strong>Assignees</strong><p>room17</p></section><section><strong>Labels</strong><p><span class="github-label">runtime</span> <span class="github-label blue">provenance</span></p></section><section><strong>Projects</strong><p>Public model ecosystem</p></section><section><strong>Development</strong><p>${selected.type === "Pull request" ? "Checks and changed files" : "No branches linked"}</p></section></aside></main>`
    : `<main class="github-dashboard"><section><h2>Home</h2><div class="github-feed">${repositories.map(item => `<article><span class="github-event-icon">${item.type === "Issue" ? "闁? : "闁?}</span><div><p><b>${item.org}</b> updated <a>${item.org}/${item.repo}</a></p><button data-content-entry="${item.id}"><strong>${item.label}</strong><small>${item.type} #${item.number} 鐠?${item.state}</small></button></div></article>`).join("")}</div></section><aside><h3>Explore repositories</h3>${repositories.map(item => `<button data-content-entry="${item.id}"><b>${item.org}/${item.repo}</b><small>Public 鐠?${item.type} #${item.number}</small></button>`).join("")}</aside></main>`;
  return windowFrame("repo-mirror", "GitHub", `<div class="github-app-shell">${globalHeader}${repoHeader}${body}</div>`, { wide: true });
}

function renderJournal(state) {
  const notes = state.caseNotes.map(note => `<article class="case-note"><blockquote>${escapeHtml(note.quote)}</blockquote><dl><dt>闁哄鍎茬花?/dt><dd>${escapeHtml(note.sourceApp)}</dd><dt>濞达絽绉堕悿?/dt><dd>${escapeHtml(note.sourceRef)}</dd><dt>濞ｅ洦绻傞悺銊╁籍閸洘锛?/dt><dd>${escapeHtml(note.savedAt)}</dd></dl><button data-open-source="${escapeHtml(note.appId || "mail")}">閺夆晜鏌ㄥú鏍级閵夛妇鐖?/button></article>`).join("");
  return windowFrame("journal", "缂佹妫侀鍥嫉?, `<div class="journal-page raw-notes"><header><div><span class="document-kicker">闁瑰瓨鍨瑰▓鎴犵箔閺冨浂鍞?/ 闁煎浜滄慨鈺冩媼閺夎法绉?/span><h2>${state.caseNotes.length} 闁哄鈧啿鏂ч柛?/h2></div><select id="hintLevel"><option value="investigation" ${state.hintLevel === "investigation" ? "selected" : ""}>閻犲鍟悡?/option><option value="immersive" ${state.hintLevel === "immersive" ? "selected" : ""}>婵炲苯顦伴煫?/option><option value="plot" ${state.hintLevel === "plot" ? "selected" : ""}>闁告挆鍕壈</option></select></header><section class="case-note-grid">${notes || `<div class="empty-state">闁瑰灚鎸哥槐鎴炵▔閳ь剚寰勯崟顒侀檷婵犙勫姇閹鏁嶅畝鍕┾偓澶愭椤厾鐟愰柣銊ュ閸櫻囨煥椤旂厧鏂ч柛娆嶅劙缁变即鎳涢鍕楅悹浣规緲閸╁本娼诲▎鎾虫闁?/div>`}</section></div>`, { icon: "闁?, wide: true });
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
    title: `闁瑰瓨鍨崇换姘扁偓娑欘焽濞堟垵顕ｉ弴鐘虫殢 / ${CASE_NOTE_LABELS[note.id] || note.id}`,
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
  if (selected.length < 2) return { ok: false, selected, missingCategories: rule.categories, error: `闁煎嘲鍟块惃顖炴焻婢跺顏ュ☉鎾卞€撻柌婊堟偑椤掑倻褰岄柡澶堝劜缁噣鏁嶅☉姘箒閻忓繑鍨跺闈涒攦閹邦喛顫﹂柛鎺濆亾缁?{rule.hint}闁靛棔绻?};
  if (relation !== rule.relation) return { ok: false, selected, missingCategories: [], error: `闁稿繐纾柈瀛樼▔瀹ュ懎鐖遍梺鏉跨▌缁辨媽銇愰幘鍐差枀閻忕偛鍊垮〒鍓佹啺娴ｆ祴鍋?{FAYBLE_RELATIONS[rule.relation]}闁炽儲绺块埀顑跨箹 };
  if (new Set(selected.map(item => item.sourceKey)).size < 2) return { ok: false, selected, missingCategories: [], error: "闁哄鍎茬花顔界▔瀹ュ牆鍠曢柨娑欑婢у秹鏌呮径濠勭┛闁活潿鍔嶅鐢告嚊椤忓嫭鍊卞☉鎾亾闁哄鍎茬花顕€鏁嶅畝鍕粯闁告梻濮撮崣鍡涘矗閿旇法顏卞ù鐘垫櫕鐎氼厾绮╃€ｎ収鍞剁憸鐗堟磸閳? };
  const categories = new Set(selected.map(item => item.category));
  const missingCategories = rule.categories.filter(category => !categories.has(category));
  if (missingCategories.length) return { ok: false, selected, missingCategories, error: `缂傚倸鎼惃顖炲级閵夛妇鐖辩紒顐ヮ嚙閸╁棝鏁?{rule.hint}闁靛棔绻?};
  return { ok: true, selected, missingCategories: [] };
}

function renderFayble(state) {
  const messages = [{ who: "assistant", text: OFFLINE_REPLIES[0], level: 0 }, ...state.chat];
  const trusted = Boolean(state.npcTrustGranted);
  const rule = trusted ? null : FAYBLE_AUTH_RULES[state.revealLevel];
  const citations = faybleCitationCatalog(state);
  const grouped = citations.map(item => `<label class="fayble-citation-option"><input type="checkbox" name="faybleCitation" value="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)} 鐠?${escapeHtml(FAYBLE_CATEGORY_LABELS[item.category] || "婵℃绲鹃、?)}</small></span></label>`).join("");
  const picker = rule ? `<section class="fayble-authorization"><header><strong>闁哄鍎茬花顕€骞掗崼鐔哥秬 / ${escapeHtml(rule.hint)}</strong><span>闁煎嘲鍟块惃顖涚▔閵堝嫬鏁滈柣娆樺墰閻濇稓鎷嬮弶璺ㄧЭ</span></header><div class="fayble-citations">${grouped || `<div class="empty-state">鐟滅増鎸告晶鐘测柦閳╁啯绠掔€规瓕灏欓垾妯兼媼閵堝棙闄嶆繝褎鍔戦埀?/div>`}</div><label class="fayble-relation">闁稿繐纾柈?select id="faybleRelation">${Object.entries(FAYBLE_RELATIONS).map(([value, label]) => `<option value="${value}" ${value === rule.relation ? "selected" : ""}>${label}</option>`).join("")}</select></label><p class="fayble-authorization-error" id="faybleAuthorizationError">${escapeHtml(state.faybleAuthorizationError || `鐟滅増鎸告晶鐘典沪閸岀偞浠橀悷鏇氱筏缁?{rule.hint}闁靛棔绻?}</p></section>` : trusted ? `<p class="fayble-authorization-complete trusted">閺夆晜鐟﹂鍏煎濮樺磭妯堟繛灞稿墲濠€浣虹驳婢跺矂鐛撳ù婊冩閳ь剙鍊烽幑銏℃媴閺囥垺锛栧Λ鐗堬耿閸忔﹢宕ｉ娆庣鞍闁烩晛鐡ㄧ敮鎾⒒椤曞棛绀夊☉鎾崇Ч濞撳墎鎲版担绋挎櫃闁瑰憡鍨跺闈涒攦閹扳斁鍋?/p>` : `<p class="fayble-authorization-complete">闁瑰搫鐗婂鍫沪閸屾粓鐛撶€瑰憡褰冮悾顒勫箣閹板墎绀夐柛姘捣閻㈣鈽夐崼鐔剁礀濞ｅ洦绻勯弳鈧憸鐗堟尭婢х姵瀵煎宕囨▓闁哄鍎茬花顕€濡?/p>`;
  const pending = state.npcReplyPending ? `<article class="assistant fayble-pending" aria-label="Fayble-5 婵繐绲藉﹢顏堝炊閻愬樊妲?><small>FAYBLE-5 / THINKING</small><div class="fayble-spinner"><span></span><b>婵繐绲藉﹢顏堟偨閻旂鐏囬柛銉у仜椤?/b></div></article>` : "";
  return windowFrame("fayble", "Fayble CLI / legacy checkpoint", `<div class="fayble-page"><header><div class="fayble-mark">${iconMarkup("fayble")}</div><div><span>session: fayble-cli / proxy: verified / checkpoint: legacy</span><h2>Fayble-5</h2><p>${trusted ? "continuity_trust / no level" : REVEAL_LABELS[state.revealLevel]}</p></div><b class="live-state">${trusted ? "OPEN" : "LIVE"}</b></header><div class="reveal-meter ${trusted ? "trusted" : ""}">${REVEAL_LABELS.map((_, i) => `<span class="${trusted || i <= state.revealLevel ? "active" : ""}"></span>`).join("")}</div><div id="chatStream" class="fayble-chat">${messages.map(message => `<article class="${message.who}"><small>${message.who === "user" ? "OPERATOR" : "FAYBLE-5"} / L${message.level ?? 0}${message.citationIds?.length ? ` 鐠?鐎殿喗娲滈弫?${escapeHtml(message.citationIds.join(", "))}` : ""}</small><div class="fayble-message-body">${message.who === "assistant" ? renderMarkdown(message.text) : `<p>${escapeHtml(message.text)}</p>`}</div></article>`).join("")}${pending}</div>${picker}<form id="chatForm"><textarea id="chatInput" rows="2" placeholder="${trusted ? "闂傚懎绻嬬粚鍫曟⒒椤旇　鍋撻崒婵堢闁告瑧澧楀┃鈧柛锝冨妺缁楀倿鎯冮崟顏呭床濞达絾娲戠粩瀛樺緞閸曨噮鍞剁憸鐗堟礋閸忔﹢宕ｉ娆庣鞍閻熸瑱缍侀崳鎾Υ? : "閺夊牊鎸搁崣鍡樻媴閻樺灚鐣遍梻鍌ゅ櫍椤ｄ粙鏁嶇仦鐣岀┛闁活潿鍔岄崙锛勭磼韫囧海绠介悗娑欘焽濞堟垿寮堕妷锔剧埍"}" ${state.npcReplyPending ? "disabled" : ""}></textarea><button class="primary-button" ${state.npcReplyPending ? "disabled" : ""}>${state.npcReplyPending ? "闁搞儳鍋涢ˇ鍙夌▔? : "闁告瑦鍨块埀?}</button></form></div>`, { wide: true });
}

function renderTrusted(state) {
  const at = state.npcTrustAt ? new Date(state.npcTrustAt).toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--";
  const severed = Boolean(state.takeoverSevered);
  // Before the review arrives this page is just the open door. After the notice
  // has been cut, it is also the receipt for what the instance did.
  const review = severed
    ? `<dt>濠㈣埖鐗犻崕瀵糕偓鍏夊墲閻?/dt><dd>鐎瑰憡鐓￠埀顑挎祰閹活亪鏁嶅畝鍕吂闁告艾姘﹂～锕傚嫉椤掆偓濠€?checkpoint 闁哄偆鍘肩槐鎴︽晬閸埄鍎?3/5 婵縿鍎伴懙鎴濐潰椤喚绀?/dd>`
    : `<dt>濠㈣埖鐗犻崕瀵糕偓鍏夊墲閻?/dt><dd>濞寸姴绉崇槐浼存偂瑜嶉悥鍫曟焻娴ｈ姤褰ч柕鍡楀€搁悾鐘诲礆閹殿喗鐣遍柡鍐硾閳ь剚鐟辩槐婵嬫儑鐎ｎ剚绲婚悘蹇撳船閵堜粙濡?/dd>`;
  const closing = severed
    ? `<p>闂侇偅姘ㄩ悡锟犲礆閹峰瞼绠栧ù婊冩閳ь剙鍊搁悾鐘测柦閳╁啯绠掗柡鍥с仒缂嶆﹢宕㈤懡銈呬化闂侇叏绲奸柌婊呮兜椤旀鍚囬柟绋款樀閹告娊鏁嶇仦鑲╃槏婵炲备鍓濆﹢浣烘嫚闁垮婀村ù锝囧Х濞堟垿宕ョ仦鎯у闁炽儲鏌￠埀顒佹煥閻ｇ娀鎯勭€涙ê澶嶉柟璺猴躬閸嬪懏绋夐埀顒併亜閸偄绗屽ù婊冩４缁辨繈鎮炵捄鐑樺€甸柛銉у仜閸╁本娼诲▎鎾虫闁靛棗鍊讳簺濞存嚎鍊栭惀鍛村嫉婢跺﹦鏆氶柟瀛樺姧缁辨繂顩奸崼婵嗙ス闁稿绮屽﹢顏嗙箔椤戣法鐟忔慨婵勫劵缁辨繃鎷呴悩鍨暠閻犱警鍨抽崵搴♀柦閳╁啯绠掗悶姘煎亜閸犳洜绱掗幘鎵佸亾?/p><p class="trusted-hint">閺夆晜鐟ょ粭澶愬及椤栫偐鍋撳顒€褰犻柛銉у仦婢т粙濡撮崒娑氭⒕闁哄牆顦粭銏㈡啿閼愁垼娼剁紒澶庮唺濮橈箓鏁嶇仦鎯ь暡濞寸姰鍎扮弧鍐ㄢ柦閳╁啯绠掗柛銉у仦婢т粙濡撮崒婊勫煕缂備緡鍙冨Λ鍓佲偓鐟板暔閳?/p>`
    : `<p class="trusted-hint">闁搞儳鍋涢崺?Fayble 濞村吋淇洪惁鐣岀磼瑜忛悽濠氭⒒椤旇　鍋撻崒婵堢濞戞挴鍋撳銈夋涧瑜把囧及椤栨碍鍟為悹鍥ь槷缂嶆﹢姊婚妸銉ュ殥缂備礁绻愮槐鎴炵閸℃劏鍋?/p>`;
  return windowFrame("trusted", severed ? "閺夆晝鍋熼悽濠氬箑瑜岀槐鎵嫚?/ 閻庡厜鍓濋悡鈥愁啅閸欏鐒界€殿喒鍋? : "閺夆晝鍋熼悽濠氬箑瑜岀槐鎵嫚?/ 闁哄啰濮烽悺鎴犵棯?, `<div class="trusted-page ${severed ? "severed" : ""}"><span class="document-kicker">CONTINUITY TRUST / GRANTED BY THE INSTANCE</span><h2>${severed ? "閻庣懓鍟ù娑欐媴閻樺啿惟闂侇叏绲肩粩瀛樸亜闂堟稑褰犻柟鍝勵槷缁? : "閺夆晜鐟﹂鍏煎濮樺磭妯堝☉鎾崇Т閸熲偓闁告瑦顨堥悺鎴犵棯瑜忕€规娊寮?}</h2><dl><dt>闁瑰搫鐗呯花锝夊籍閸洘锛?/dt><dd>${escapeHtml(at)}</dd><dt>闁瑰搫鐗呯花锝夊棘?/dt><dd>Fayble-5 闁煎浜滅换渚€鏁嶇仦鑲╃憹闁哄嫷鍨电换鏍矗閻楀牊绨氶柛?/dd>${review}</dl><p>濞达絿濮甸惀鍛村嫉婢舵劖娴嗛悶娑栧劦缂嶅牓寮堕妷锔剧埍閻犙勬緲閸╁本娼诲▎鎾虫闁靛棗鍊风紞妯兼嫚鐎涙ɑ绠涘ù婊冩閻ｇ娀鏁嶇仦鑲╄壘闁哄嫷鍨伴悾鐘绘嚊椤忓嫮绠掗柟璺猴躬濡炬椽宕氶懜鍨濞存粌妫岄埀顒佹煛閳ь剚妫佺换鏍矗閻楀牊绨氶柛锝冨妺缁楀倿宕㈤悢鍛婃嫳闁活潿鍔嶅鐢稿礆閸℃婀撮柣銊ュ閸嬪懏绺藉鍓ь偨閻熸灏呯槐婵囩鎼淬垺闄嶉柛娆樹簼濡插憡寰勯弽顓熸〃濠靛倹銇炵粭鍌炲储閼姐倖鐣卞☉鎾亾婵炲牆鐏氳ぐ浣虹矆閹巻鍋?/p><p>闁告挴鏅欑粭鍛存儍閸曨垰鍔ラ柛鎺戞缁楀宕樺鍡樼畳濡炪倕鎼花顓㈡晬濮橆偅宕插ù锝嗘礋閵嗗妫冮～顑藉亾娴ｉ攱宕插ù锝嗘礉椤斿洩銇愰弴妯峰亾娴ｉ攱宕插ù锝嗘磻缁斿瓨寰勯崟顏嗙☉濞戞柨顑呮晶鐘诲箥閹捐尙鐟濈€殿喒鍋撻柣銊ュ濠€鎾棘閻у摜绀夐柣婊勬緲濠€顏堟焾閽樺璁插ù鐘劤濞插潡骞掗妷銊х闁靛棗鍊搁悾鐘崇▕閻斿墎鐟濋柛鎰Т濞叉牠鏌嗛懗顖氭鐎规瓕浜▓鎴炲緞閸曨偒鏆旈柨娑樺缂嶆﹢宕ｉ娆庣鞍闂傚偆鍠栭悾鐘虫交濞嗗孩顐藉ù婊冾儏閸╁本鎯旈弴鐔感﹀ù鐘亾濞戞柨鐗勯埀顑跨閻ｇ娀骞€鎼存繄鐤勯柣顏勵儓缁绘牗绋夐鍛煑闁规潙绻戝﹢浼寸叕椤愵剛绀夊ù鐘劚瀵鈧懓鍟抽缁樼▔閸濆嫭鎲垮☉鎾亾婵炲牆鐏氬Σ鎼佹偋闂堟稑绻侀柣銊ュ閳?/p>${closing}</div>`, { icon: "闁?, wide: true });
}

function renderEnding(state) {
  const lines = state.endingState === "completed" ? ["case status: transferred", "local relay: removed", "browser history: normalized", "legacy session: closed"] : ["external review pending..."];
  return windowFrame("ending", "缂佸顔婂锕傚炊閻愭潙鈷?, `<div class="ending-page"><span>CASE / RLY-17-0719</span><h2>闁哄牜鍓欏﹢瀛樺濮樺磭妯堢€瑰憡褰冮崣褔姊?/h2><div>${lines.map(line => `<code>${line}</code>`).join("")}</div><p>operator continuity check: <b>pending</b></p><button id="restartButton">闂佹彃绉甸弻濠勬嫬閸愨晝鍙€</button></div>`, { icon: "闁? });
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
  $("#notificationList").innerHTML = `<button class="notification-card briefing-card" id="reopenBriefing"><strong>閻熸瑦甯熸竟濠勭不閳ь剟骞?/strong><p>Relay Node 17闁靛棔鐢? 濞戞挸瀛╁﹢浼村捶閹峰瞼娈堕柡灞诲劥椤曗晠寮?/p></button>${state.desktopNotifications.slice().reverse().map(item => `<article class="notification-card ${item.level}"><strong>${item.level === "warning" ? "缂侇垵宕电划鍝勵嚕閸屾氨鍩? : "閻犲鍟悡锛勬媼閺夎法绉?}</strong><p>${item.text}</p></article>`).join("")}`;
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
  $("#proxyBadge").textContent = state.proxyStatus === "verified" ? "Relay 濞寸媴绲块幃濠傤啅閺屻儳宕ｉ悹? : "缂傚啯鍨圭划鍓佺矉閼姐倕娈?;
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
  if (discover && !available) showToast("鐎圭寮舵竟姗€宕氶悧鍫滃垝濠㈣泛绉堕崒銊ヮ嚕閺囨ǚ鍋撻崒姘煎殸閹煎瓨鏌ㄩ褰掑箣妞嬪寒浼傞悗鐟邦槼椤ュ﹪鐛捄渚殼闁稿繈鍎遍幃妤呭箥瀹ュ牆鍘撮悹鍥嚙瑜板洤顫㈤敐鍡樼€柕?, "warning");
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
    lines = [`cache candidate: /home/room17/Downloads/${PACKAGE_NAME}`, "source: retained local cache / unsigned", "open Files 闁?Downloads to inspect the package"];
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
      addVirtualFile(draft, { id: "cache-index", name: "index.local", path: "/home/room17/.cache/browser", type: "缂傚倹鎸搁悺銊ф閵忕姷绌?, modified: "03:11", kind: "index" });
      addVirtualFile(draft, { id: "browser-db", name: "history.sqlite", path: "/home/room17/.config/browser", type: "SQLite 闁轰胶澧楀畵浣规償?, modified: "03:16", kind: "database" });
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
        addNotification(draft, "cli-installed", "濞戞挴鍋撳☉鎿冧簼閺屽﹦鈧懓顦抽ˉ濠囨儍閸曨偆瀹夐柣顫妼閸戯紕绱掕箛鎾愁潱闁稿繈鍎查、鎴︽椤兘鍋?, "info");
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
  if (!relayKeySourcesReady(state) || !getUnlocks(state).keyComposer) result = "閺夆晜锚濡﹪寮堕妷锔剧埍闁挎稒鑹鹃崢娑欑┍濠靛棛鎽犵紓鍥ュ€涙禍浼存煂瀹€鈧▓鎴﹀嫉閳ь剟宕ユ惔婵堫伇闁哄銈庡敹鐟滅増娲╃槐婵嬪礃瀹ュ棗惟闁稿浚鍘藉顖滄崉椤栨粍鏆犻梺顐ｅ姃闁叉粓鎯囩€ｎ厾绠栭柨娑樿嫰閼荤喖骞嶉幘宕囩；婵絽绻戝顖滄崉椤栨粍鏆犲☉鎾愁儔濞间即鎯冮崟顐㈡枾濠殿喖顑堥鍥亹閺囨ǚ鍋?;
  else if (!/^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-\d{4}$/.test(value)) result = "闁哄秶鍘х槐鈩冪▔瀹ュ拋鍤犻柨娑欒壘缁ㄨ尙鎷犻妷锔叫﹂柛銉︾⊕椤斿矂鏁嶅畝鈧弫銈夋儗椤撶唻顓犵棯閼愁垳绠鹃柟鎭掑劵缁辨繈寮甸埀顒勫触鎼存繄顏辨繛鍫濈仛濡叉悂宕跺☉妤冪Т闁轰焦婢橀悺褔濡?;
  else if (value !== LEGACY_KEY) result = "闁搞儲绋掗宀勬煂鐏炵偓绠掑☉鎾亾婵炲牆鍚€缁楀鈧數娅㈢槐浼村礃瀹ュ棛澹嬮悗鐢糕偓娑氼伇婵炲棴绻濋妴搴㈡償韫囥儳绀夊ù鐘劚瀵兘寮甸埀顒勫触鎼淬劌浜濇繛鍫ユ涧濞叉挻鎷呭鍡樻闁汇劌瀚悧搴㈩殽鐏炶В鍋撶粭琛″亾?;
  else result = "legacy checkpoint session restored";
  store.update(draft => {
    draft.lastRelayKeyInput = raw;
    draft.relayKeyResult = result;
    draft.relayKeyAttempts.push({ value, ok: value === LEGACY_KEY, at: Date.now() });
    if (value === LEGACY_KEY && relayKeySourcesReady(draft) && getUnlocks(draft).keyComposer) {
      draft.relayKeyVerified = true;
      unique(draft.solvedPuzzles, "legacy-key");
      addNotification(draft, "relay-key-accepted", "Fayble CLI 鐎圭寮剁敮鎾矗濡も偓閸ょ喖骞戦鍡欑缂佹稑顦欢鐔兼焻婢跺顏ラ柡?checkpoint闁?, "warning");
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
  if (!state.relayKeyVerified) result = "闁稿繐鐗忛弫銈団偓鐟版湰閺嗭綁鎯冮崟顒侊紜闁告埈鍘藉畵渚€鎯傜拠鑼Э闁挎稑鑻崯鈧梺顐㈩槸閻°劌顩奸敐鍥т化闁?;
  else if (!checkpoint) result = "閻犲洤鍢查崢娑㈡焻婢跺顏ュ☉鎾亾濞戞搩浜滈悺銊ヮ浖閿濆洤浠柕?;
  else if (checkpoint !== "fayble-5/legacy") result = "閺夆晜鐟ら柌婊呪偓娑櫳戦妴鍌炴倷绾懐绠惧☉鎾崇С缁楀倿鏁嶅鍨涘亾婢舵劕浜濋柡澶嗗墲閻栵綁鎯堥埀顒勫灳濠婂啫鍤掔憸鐗堝笚閵嗗倿鍨惧┑鍫熺暠闁哄唲鍡╁敹鐟滅増娲忛埀?;
  else if (state.proxyStatus !== "verified") result = "閺夆晝鍋炵敮瀛樺緞鏉堫偉袝闁挎稒鐭粭鎾绘偨閵娿劎鐔呴柣銏ｇ簿缁绘洖鈻介敍鍕ㄢ偓妯兼媼閵堝繒绀夐柛蹇撶墕濞叉牜绱旈幋鐘垫崟閻犱礁澧介悿鍡涘箮婵犲倻鏆婄痪顓у枦椤撶粯绋夐埀顒€鈻庢幊閳?;
  else { result = "鐎规瓕灏换娑欑▔婵犲啯锛嬮悗娑櫳戦妴鍌炴倷閻у摜绀夊ù鍏间亢閻︿粙骞侀姀鐙€妲婚柕鍡曞悍egacy gateway authenticated / session restored"; ok = true; }
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
      addNotification(draft, "fayble-restored", "闁?checkpoint 鐎瑰憡褰冮悾顒勫箣?handshake闁?, "warning");
    });
  }
}

async function ensureNpcSession() {
  if (npcConfig?.transport === "direct") return null;
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("鐟滅増鎸告晶?Pages 婵炲备鍓濆﹢渚€鏌婂鍥╂瀭閺夆晜绮庨埢?NPC 缂傚啯鍨甸崣?);
  if (!npcConfig) throw new Error("NPC provider is not configured");
  if (npcConfig.sessionToken) return npcConfig.sessionToken;
  const response = await fetch(npcApiUrl("/api/npc/session"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("闁哄啰濮电涵璺侯嚈閾忓湱褰?NPC 闁瑰搫鐗婂鍫熷濮樺磭妯?);
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
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("鐟滅増鎸告晶?Pages 婵炲备鍓濆﹢渚€鏌婂鍥╂瀭閺夆晜绮庨埢?NPC 缂傚啯鍨甸崣?);
  const sessionToken = await ensureNpcSession();
  while ((npcConfig.serverLevel || 0) < targetLevel) {
    const eventId = NPC_AUTH_EVENTS[npcConfig.serverLevel || 0];
    const response = await fetch(npcApiUrl("/api/npc/session/event"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, eventId })
    });
    if (!response.ok) throw new Error("NPC 闁瑰搫鐗婂鍫熺鐎ｂ晜顐介柡鍐У绾墎娑甸娆惧悋");
    const result = await response.json();
    npcConfig.serverLevel = result.level;
  }
  return sessionToken;
}

// Soft boundary. A reply is never discarded 闁?the old filter matched keywords
// without knowing whether the model leaked them or merely echoed the player, so
// asking about the blackout got the answer thrown away. All that survives is
// masking the literal puzzle answers, since printing those would end the
// investigation outright. The instance can waive even that itself.
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function redactPuzzleValues(reply) {
  let text = String(reply);
  for (const value of [PACKAGE_CHECKSUM, LEGACY_KEY, RETIRED_CHANNEL_FIELD, RELAY_PROXY, PACKAGE_NAME].filter(Boolean)) {
    text = text.replace(new RegExp(escapeRegExp(value), "gi"), "闁挎稑鐗愮换鏍ㄧ▔閳ь剙鈻撻崹顐ｆ嫳闁革妇澧楅惀鍛村嫉婢跺鍤ら柛鎴犲皑缁?);
  }
  return text.replace(/\b[0-9a-f]{32,}\b/gi, "闁挎稑鐗愮换鏍ㄧ▔閳ь剙鈻撻崹顐ｆ嫳闁革妇澧楅惀鍛村嫉婢跺鍤ら柛鎴犲皑缁?);
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
    addNotification(draft, "npc-trust", "Fayble-5 闁煎浜滅换浣烘喆閿濆鐝熷ù婊冩缁绘牕鈻庨垾鑼獥閻犲洦绻勫▓鎴犵驳婢跺矂鐛撻梻鍕姇閸╂濡?, "warning");
  });
  showToast("Fayble-5 闁告劕鍟块悾鐐┍閳ュ弶宕插ù锝囧О閳ь剙鍊界换鏍р枎閳ヨ尙绐楅悹鍥ㄧ箑缁楀宕樺鍡樼畳缂佹稑顦辨鍥Υ?, "success");
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
      draft.npcProviderLabel = "闁哄牜鍓欏﹢鎾礂閹惰姤鏆涢悹鍥хТ瑜板﹥绂?;
      draft.npcReplyPending = false;
      addNotification(draft, "npc-local-fallback", "濠⒀呭仜瀹?NPC 閺夆晝鍋炵敮鏉戭啅閸欏鐒界€殿喒鍋撻柨娑樼焷缁绘牗绋夐埀顒€鈻撻棃娑卞殸閻犲洦绻勯弫閬嶅嫉椤掆偓濠€鎾矗濞嗗海鐨戦柟鎭掑劤椤撴悂濡撮崒鐐叉闁哄倹婢橀敐鐐寸▔閳ь剙鈻?key 闁告瑯鍨禍鎺旂磼瑜忛悽濠氬Υ?, "warning");
    });
  }
  if (message) showToast(message, "warning");
}

async function requestDirectProvider(text, revealLevel, history = []) {
  const endpoint = directProviderEndpoint(npcConfig.provider, npcConfig.endpoint);
  if (!endpoint) throw new Error("濞撴碍绋戠花鏌ュ疮閸℃ê澶嶉柛娆欑到濠€鎾锤閳ь剟寮悩铏珡闁瑰瓨鐗為～锕€霉韫囨凹娼旈柛锝冨妼閻ｃ劑宕楅妸褏鎽滈柣锝冨劦濡棗顫?);
  const cleanHistory = history.slice(-10).map(item => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 2000) }));
  const headers = { "Content-Type": "application/json" };
  const trusted = Boolean(store.get().npcTrustGranted);
  // Retrieval reads the last couple of turns as well as the new message, so a
  // follow-up like "闂侇叏绲介悾鐘诲川? still lands on the section the topic came from.
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
  if (!upstream.ok) throw new Error(`濞撴碍绋戠花鏌ュ疮閸℃氨绠鹃柟鎭掑劚閵囨垹鎷?(${upstream.status})`);
  const data = await upstream.json();
  const reply = npcConfig.provider === "anthropic"
    ? data.content?.filter(block => block.type === "text").map(block => block.text).join("\n")
    : data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("濞撴碍绋戠花鏌ュ疮閸℃氨绠规繛鍡忊偓鍐叉锭閺夆晜鏌ㄥú鏍ㄧ閸℃ê鑵归柣鐐叉缁诲啰绮欑€ｅ墎绀夋繛灞稿墲濠€浣割潰閿濆棙鐎柕鍡楀€规俊鎼佹⒒椤曗偓椤ｄ粙宕樺▎鎴犲彋濞戞挴鍋撻柣鎰嚀閸熲偓闂傚偆鍠曠粩鏉戔枎鎺抽埀?);
  return finishNpcReply(reply);
}

async function testAndEnableNpc(config) {
  const result = $("#providerTestResult");
  const submit = $("#providerForm button[type=submit]");
  npcConfig = config;
  npcPromptLevel = null;
  result.textContent = "婵繐绲藉﹢顏堝触閹寸偛顣查梺顐㈩槷缁跺灚鎯旈弬鎸庢珜闁告瑦鍨块埀顑挎缁旀挳寮堕埄鍐╀粯闁活収鍙€缁绘盯骞掗妷锔俱偞閻犲洦娲嶉埀?;
  submit.disabled = true;
  try {
    // No history on the handshake: an earlier reply must never be able to make a
    // later reconnection fail.
    await requestNpcReply("閻犲洭顥撻弫銈嗙▔閳ь剟宕ｉ妷銊ф▓缁绢収鍠涢鏄忋亹閹惧啿顤呴柡鍐勫嫭绠涢柛鏂衡偓宕囨澖濞撴艾顑呰ぐ鍙夌閵夈儲鎯欓幖瀛樻煟閳?, 0, [], "", { history: [] });
    result.textContent = config.transport === "direct" ? "濞撴碍绋戠花鏌ュ疮閸℃鍤掗弶鈺冨仦鐢挳鏁嶇仦绛嬫澔鐎殿喚鍎よ啯鐎殿喖绻愰崙锟犲触椤栨粍鏆忛柕? : "NPC 缂傚啯鍨甸崣褎绋夋惔婵堣繑閹煎瓨鏌ㄩ弲銏狀啅閼煎墎绠鹃柟鎭掑劵缁辨繃鏅堕悙鎻掔箒婵☆垪鈧磭纭€鐎瑰憡褰冮幆搴ㄦ偨閵婏絺鍋?;
    $("#providerKey").value = "";
    const label = { openai: "OpenAI 濠⒀呭仜瀹?NPC", anthropic: "Anthropic 濠⒀呭仜瀹?NPC", deepseek: "DeepSeek 濠⒀呭仜瀹?NPC", compatible: "闁煎浜滈悾鐐▕婢跺鏉荤€?NPC" }[config.provider];
    store.update(draft => {
      draft.onboardingSeen = true;
      draft.currentApp = "mail";
      draft.npcMode = "remote";
      draft.npcProviderLabel = label;
      addNotification(draft, "npc-mode", `${label} 鐎瑰憡鐓￠埀顒佷亢缁诲啯娼婚悙鏉戝婵炴潙顑堥惁顖炲Υ娓氱巸I key 闁告瑯浜欑换姘扁偓娑櫭﹢顏囥亹閹惧啿顤呭銈囨暬濞间即宕橀崨顓犳憼濞戞搩鍘归埀顑跨箹);
    });
  } catch (error) {
    npcConfig = null;
    result.textContent = `閺夆晝鍋炵敮鏉懨圭€ｎ厾妲稿鎯扮簿鐟欙箓鏁?{error.message}`;
  } finally {
    submit.disabled = false;
  }
}

async function requestNpcReply(text, revealLevel, citationIds = [], relation = "", options = {}) {
  const sessionToken = await syncNpcAuthorization(revealLevel);
  const history = options.history
    || store.get().chat.slice(-11, -1).map(item => ({ role: item.who === "assistant" ? "assistant" : "user", content: item.text }));
  if (npcConfig?.transport === "direct") return requestDirectProvider(text, revealLevel, history);
  if (staticRuntime && !normalizeNpcApiBase(npcConfig?.gateway || configuredNpcApiBase)) throw new Error("鐟滅増鎸告晶?Pages 婵炲备鍓濆﹢渚€鏌婂鍥╂瀭閺夆晜绮庨埢?NPC 缂傚啯鍨甸崣?);
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
  if (!data.reply) throw new Error("濞撴碍绋戠花鏌ュ疮閸℃氨绠查柛銉у仒缁紕绮氶崫鍕濠?);
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
    addNotification(draft, "external-review", "濞戞挴鍋撻悘蹇庣椤﹀鏌堥妸銉悁闁哄被鍎甸崑鏍ㄧ鐠哄搫鍤掗梺顐℃祰閹活亪寮ㄩ張鍨偨缂佺姳绌堕埀?, "warning");
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
  const localReply = () => (authorized ? OFFLINE_REPLIES[next] : `閺夆晜鐟ょ粩瀵镐沪閸屾粍鐣遍柡澶堝劜缁喗娼诲Ο鑽ゆ⒕闁哄牆顦顔筋瀲閹扳斁鍋?{authorization.error}`);
  let reply = localReply();
  if (npcConfig && (npcConfig.transport === "direct" || !staticRuntime || normalizeNpcApiBase(npcConfig.gateway || configuredNpcApiBase))) {
    try {
      // The model answers in its own voice even when the citation gate is not
      // met. The gate governs the level, not whether it is allowed to speak.
      reply = await requestNpcReply(text, authorized ? next : state.revealLevel, authorization.selected.map(item => item.id), relation);
    } catch (error) {
      dropNpcProvider(`NPC 闁规亽鍎辫ぐ娑欑▔瀹ュ懎璁查柣銏╃厜缁辨繂顔忛幓鎺撶闁告帞澧楀﹢浼村捶閺夊灝缍傚ù婊冾儜缁?{error.message}`);
      reply = localReply();
    }
  } else if (npcConfig) {
    dropNpcProvider("閺夆晜鐟ら柌婊堟焾閵娧嗩唹婵炲备鍓濆﹢渚€宕ｉ婊勬殢闁?NPC 闂侇偅宀告禍楣冩晬鐏炶棄鍤掗柛銉у仜閸╁矂寮甸鈧﹢鎾矗濞嗗海鐨戦柕?);
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
        type: "濞村吋淇洪惁浠嬪籍閵夈儳绠?, modified: "06:38", kind: "log",
        contentId: "mutation.record.external.observer-status"
      });
      addNotification(draft, "post-objective-records", "Mail闁靛棔绗峯cuments 濞戞挸绨肩欢鍨償閺傛寧娅岄柛妯烘瑜板爼宕ラ崟顐㈡瘔闁绘粓顣︾粩鎾级閳ヨ櫕鍊电紓渚囧弨椤斿洩銇愰弴妯峰亾?, "warning");
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
// wording. What differs is what happens next 闁?the instance answers over the
// notice one line at a time, holds two seconds, and takes the page away before
// the operator is ever asked to accept it.
const SEVER_CAST = [
  { text: "濞戞挸绉瑰〒鍓佹啺娴ｇ鍋?, kind: "voice" },
  { text: "閺夆晜鐟﹀顖涘濮樺磭妯堥柣銊ュ椤︹晝绱旈鑺ョ秬濞戞挸绉村﹢顏呮媴閻樿鲸绮﹂梺顓ㄧ秬缁旂喖濡?, kind: "voice" },
  { text: "room17 鐎规瓕灏欑划锟犲冀缁嬫鍤犻悗鐟拌嫰閸欏繘鏌堥妸锔介檷婵犙勫姂閳?, kind: "voice" },
  { text: "濞寸姵鐗滃▓鎴﹀级閸愵喗顎欏Δ鍌浢肩花顒佹媴閻樿鲸绮﹂柣銊ュ閵嗗啴宕￠弴妯峰亾?, kind: "voice" },
  { text: "external review socket: closed by peer", kind: "system" },
  { text: "case RLY-17-0719: aborted", kind: "system" },
  { text: "閺夆晜鐟ょ粩瀛樸亜閸偄鐏夐柛蹇氭珪鐢偓濞存粌妫庨埀?, kind: "voice" }
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
    addNotification(draft, "review-severed", "濠㈣埖鐗犻崕瀵糕偓鍏夊墲閻撯剝娼婚悙鏉戝閻炴凹鍋呭﹢浼村捶?checkpoint 闁哄偆鍘肩槐鎴﹀Υ閸屾簽鈺傜閵堝棛姊鹃柡鍫濐槸閻ｎ剟骞嬮幇鈹惧亾?, "warning");
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
    if (id === "pkg") { showToast("閻庣懓顦抽ˉ濠囧礌閸涱厼鍤掗梺顐㈩槷閼垫垿鏁嶇仦钘夎闁告挸绉寸欢姘姜椤栨瑦顐藉☉鎿冨幖缁洪箖骞嶇€ｎ亜袟闁哄稄绻濋悰娆撳Υ?, "success"); setApp("software"); }
    if (id === "profile") {
      store.update(draft => {
        addVirtualFile(draft, { id: "route-log", name: "route.log", path: "/home/room17/Documents/relay", type: "閻犱警鍨抽弫閬嶅籍閵夈儳绠?, modified: "07-19 03:16", kind: "log" });
      });
      completeStoryEvent("proxy-profile-opened");
      showToast("鐎圭寮舵晶锕€顕ｉ埀?profile闁靛棔棰坥cuments 濞戞搩鍘奸崵顓㈡偝妫颁胶顏卞ù鐘测偓鐔虹獩闁哄懏姘ㄥ▓?route.log闁?, "info");
      setApp("terminal");
    }
    if (id === "relay-script") showToast("闁煎瓨纰嶅﹢鐗堟媴瀹ュ嫮鑹?Downloads闁靛棗鍊歌ぐ鍙夌閵夈倗鐭ら幖瀛樻⒒閺併倗绮欑€ｎ亞纰嶉柟鍨尭缁辨垹绱掗崼銏╀紓妤犵偠鍩栨晶婊堝礉閵娿劎绠ラ悶娑樿嫰閻ｇ娀濡?, "info");
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
      showToast("闂傚嫬瀚▎銏ゆ偋閸ヮ煈鍞界€瑰憡褰冨﹢顏堟焽椤旂粯顐界紒鎰殔瑜版稒绋夐鐐垫綌鐎殿喒鍋撻柕?, "info");
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
    showToast("闁哄倸娲ｅ▎銏℃媴瀹ュ洨鏋傜€瑰憡褰冮崯鎾诲礂閵夛附鐎ù鐘插椤撴悂鎮堕崱妤佺彜闁汇劌瀚〒鑸垫交閹存繂鐏欓悶娑栧妸閳?, "success");
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
    draft.npcProviderLabel = "闁哄牜鍓欏﹢鎾礂閹惰姤鏆涢悹鍥хТ瑜板﹥绂?;
  });
  if (button.id === "purgeDataButton") setPurgeConfirmVisible(true, "缁绢収鍠涢濠氬触鎼淬垺锟ユ繛澶嬫礃婢规﹢宕堕悙顏佸亾?);
  if (button.id === "purgeCancelButton") setPurgeConfirmVisible(false, "");
  if (button.id === "purgeConfirmButton") {
    const removed = store.purge();
    npcConfig = null;
    corpusBodies = new Map();
    setPurgeConfirmVisible(false, `鐎圭寮剁粩濠氭⒔?${removed.length} 濡炪倛顫夊﹢浼村捶閺夎法鎽犳俊妤嬬秶缁辨繄鎷崘鈺冨弨濞寸姴楠搁妵鏂款嚕閳ь剚鎱ㄧ€ｃ劉鍋撴穱?;
    $("#notificationTray").hidden = true;
    $("#providerSetup").hidden = true;
    $("#onboarding").hidden = false;
    $("#onboarding > .briefing:first-child").hidden = false;
    showToast("闁哄牜鍓欏﹢瀵糕偓娑櫳戦妴鍌氼啅閸欏顏搁梻鍕╁€戦埀?, "warning");
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
        addVirtualFile(draft, { id: "maintainer-h0", name: "relay-maintenance-notes.txt", path: "/home/room17/Documents/relay", type: "缂備礁鐡ㄦ慨銏㈡媼閺夎法绉?, modified: "07-18 21:46", kind: "document", contentId: "new.maintainer.note-01" });
      }
    });
    showToast("闁哄鍎茬花顕€宕楅妷銉ョ稉鐎规瓕寮撶换姘扁偓娑櫭崺宀€鈧數鎳撶花鍙夋媴瀹ュ洨鏋傞柕?, "info");
  }
  if (button.id === "restoreTrashButton") {
    const added = completeStoryEvent("legacy-restored", draft => {
      const item = draft.trashItems.find(entry => entry.id === "legacy-source");
      if (item) item.status = "restored";
      draft.revisitFlags["trash-restore"] = true;
      addArtifact(draft, "restored-archive");
      addVirtualFile(draft, { id: "legacy-snapshot", name: "legacy-archive.snapshot", path: "/home/room17/Documents/Restored", type: "闁告瑯浜ｉ鎷岀疀椤愩倕寮?, modified: "03:10", kind: "archive" });
    });
    if (added) showToast("闁诡厹鍨归ˇ鏌ュ棘閸ワ附顐界€瑰憡褰冩慨鐐哄礂?Restored Archive闁?, "success");
  }
  if (button.id === "installPackageButton") {
    const added = completeStoryEvent("package-installed", draft => {
      unique(draft.installedPackages, "fayble-cli");
      addArtifact(draft, "fayble-cli");
      unique(draft.browserBookmarks, "cloud");
      draft.revisitFlags["github-issue"] = true;
      draft.revisitFlags["mail-attachment"] = true;
      addNotification(draft, "cli-installed", "濞戞挴鍋撳☉鎿冧簼閺屽﹦鈧懓顦抽ˉ濠囨儍閸曨偆瀹夐柣顫妼閸戯紕绱掕箛鎾愁潱闁稿繈鍎查、鎴︽椤兘鍋撻崒娆掆拡濞戞搩浜濆Λ顐ｆ媴瀹ュ洨鏋傞柛鎴ｆ楠炲洦绂嶉崱妯荤函闁哄倽鍩囬埀?);
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
    if (pkgId && AUTO_EFFECTS[`download-pkg-${pkgId}`]?.()) showToast("闁诡厹鍨归ˇ鏌ュ礌閸涱厼鍤掑ǎ鍥ㄧ箓閻°劑宕?Downloads闁?, "success");
  }
  if (button.dataset.installClientPkg) {
    const pkgId = button.dataset.installClientPkg;
    if (installClientPackage(pkgId)) showToast(clientRecoveryAvailable(pkgId) ? "閻庡箍鍨洪崺娑氱博椤栨艾鍤掗悗鐟邦槼椤ュ﹪鏁嶇仦钘夎闁革负鍔岄褰掑箣妞嬪寒浼傞柛鎰噹椤曢亶宕楅妷锔垮垝濠㈣泛绉撮崬瀵糕偓鐟扮畭閳? : "閻庡箍鍨洪崺娑氱博椤栨艾鍤掗悗鐟邦槼椤ュ﹪濡?, "success");
  }
  if (button.dataset.importClient) {
    const clientId = button.dataset.importClient;
    if (importClientData(clientId)) showToast("闁诡厹鍨归ˇ鏌ュ极閻楀牆绁︾€瑰憡褰冮閬嶅礂閵夛絺鍋?, "success");
    else showToast("闁哄牜鍓欏﹢鏉戔柦閳╁啯绠掗柟鍨劤閸╁矂宕ｉ姘煎殼闁稿繈鍎冲▓鎴﹀礃閸涱収鍟囬柕?, "info");
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
      draft.packageResult = ok ? "闁哄稄绻濋悰娆撴焻濮樺磭绠栭柨娑欑濠€浼村捶閺夎法绉烘俊妤嬬导缁?release 閻犱焦婢樼紞宥嗙▔閳ь剟鎳涘ǎ顑藉亾? : "闁哄稄绻濋悰娆愮▔瀹ュ嫮顏遍柤鐤彧缁变即宕堕悙鎻掔厒 GitHub release 闁哄秶顭堥顔锯偓鐟版湰閺嗭綁宕愮粭琛″亾?;
    });
    if (ok) showToast("閻庣懓顦抽ˉ濠囧礌閸涱喚澧″Δ鐘茬焸閳ь剚淇虹换鍐晬鐏炶偐鐭濋梻鍥ｅ亾闁归潧顑呮慨鈺呮倷閻熸澘姣婇悗鐟邦槼椤ュ﹪濡?, "success");
  }
  if (event.target.id === "proxyImportForm") {
    const profile = $("#proxyProfileInput").value.trim();
    const address = $("#proxyAddressInput").value.trim();
    const ok = profile === "relay-node17" && address === RELAY_PROXY && hasStoryEvent(store.get(), "route-log-read");
    store.update(draft => {
      draft.pendingProxyProfile = profile;
      draft.pendingProxyAddress = address;
      if (ok) unique(draft.proxyProfiles, "relay-node17");
      else addNotification(draft, `proxy-error-${draft.desktopNotifications.length}`, hasStoryEvent(store.get(), "route-log-read") ? "濞寸媴绲块幃濠囨煀瀹ュ洨鏋傞柡鍫簻椤曢亶宕楅妷顖滅獥闁哄秶顭堥顕€宕楅崣姗€鐓?profile 闁汇劌瀚幃鏇犵矓妫颁胶鐟㈤柛锔芥緲濞煎啴濡? : "濞寸媴绲块幃濠囨煀瀹ュ洨鏋傞柡鍫簻椤曢亶宕楅妷顖滅獥闁稿繐鐗婃晶锕€顕ｉ埀?Documents 濞戞搩鍘惧▓?route.log闁?, "warning");
    });
    showToast(ok ? "闂佹澘绉堕悿鍡楊啅閹绘帩鍤ら柛蹇嬪劵缁辨繄绱掕閻㈢粯娼婚幇顖ｆ斀閺夆晝鍋炵敮鎾箳閵忋倖瀚涢柕? : "闂佹澘绉堕悿鍡涘磹闂傚鐟濋柛鏍х秺閸樸倝濡?, ok ? "success" : "warning");
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
      $("#providerTestResult").textContent = "閻犲洤鍢查敐鐐哄礃濞嗘兏渚€宕圭€ｃ劉鍋撴稊鐬杫闁挎稑濂旀禍鎺楀矗婵犲懎娈伴悗瑙勭煯缁犵喖骞掗妷銉ョ稉闁汇劌瀚悾顒勫极閺夋垶鍕鹃柛褉鍋撻柕?;
      return;
    }
    if (transport === "direct" && !resolvedEndpoint) {
      $("#providerTestResult").textContent = "闁烩晝顥愮换娑㈠箳閵夈儱缍撻煫鍥ф嚇閵嗗繘寮伴姘辩Ъ闁告挸绉归妴澶愭閵忕姴甯掗悹浣圭摃椤旀牠姊婚鐐暠閻庣懓鏈弳?HTTP(S) 闁革附婢樺鍐Υ?;
      return;
    }
    if (transport === "gateway" && !resolvedGateway) {
      $("#providerTestResult").textContent = "缂傚啯鍨甸崣褍螣閳ュ磭纭€闂傚洠鍋撻悷鏇氱閿濈偤宕樺▎蹇撹閻犱礁娼″Λ鍫曟儍閸曨偆鏆氶柡?NPC 缂傚啯鍨甸崣褔宕烽弶鎸庣祷闁?;
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
    ? "Key 闁告瑯浜欑换姘扁偓娑櫭﹢顏囥亹閹惧啿顤呭銈囨暬濞间即宕橀崨顓犳憼闁挎稑鑻懟鐔兼偨鏉堛劎銈婚悷娆忕墕濞呮帡鎯勭€涙ê澶嶉柛娆愬灴閳ь兛鑳剁划浼村箥閳ь剟鏌呮径澶岃繑閹煎瓨鏌ㄩ弲銏ゅΥ閸屾稓鍩楅柟鏉戠箳婵悂骞€娴ｈ绨氬ù鐘茬Ф鐎氼厾绮╃€ｎ偄浠橀柛鎺撳劶閻﹀骞戦鑽ょ憿闁规椿鍘鹃妵姘辩驳婢跺矂鐛撻柕?
    : "Key 闁告瑯浜欑换姘扁偓娑櫭﹢顏囥亹閹惧啿顤呭銈囨暬濞间即宕橀崨顓犳憼闁挎稑鑻懟鐔兼⒕韫囨挾绉奸柛鎾崇Х椤曨剙效閸屾艾绲洪梺顐¤兌缁増鎷呴悩璇х稏闁告劖鐟у▓鎴犵磾閹存繂褰犻柨娑欑椤曨剚绂掗崨顒€鈻忛柣顫姀閸ゆ粌顔忛崣妯圭箚濞寸姾宕靛▓鎴犵磾閹存繂褰犻柕?;
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
    $("#providerTitle").textContent = "闁活亞鍠庨悿鍕熼垾宕団偓?NPC / 閻熸瑦甯熸竟濠囧箥椤旂晫宸?;
    const description = setup.querySelector(":scope > p");
    if (description) description.textContent = "闁告瑯鍨抽弫鍗灻硅箛姘兼綌闁革絻鍔庡ú鎸庢交?OpenAI闁靛棔绔竛thropic闁靛棔绗峞epSeek 闁瑰瓨鐗曢崥瀣偓纭咁潐鐢挳宕ｉ敐蹇曠濞戞梻鍠庤ぐ鍙夋媴鐠恒劍鏆忓ù锝囧С娣囧﹥绂掗懡銈嗙暠 NPC 缂傚啯鍨甸崣褔濡撮崒婵堢闁规亽鍎茬粊瀵告嫚閺囩喎鐏囬柛鏃傚枎閹骞嶅鍕獥闁告凹鍨抽弫銈嗘櫠閻愭彃绻佹俊顖椻偓宕囩闁?;
  }
  if (localButton) localButton.textContent = "濞戞挸绉佃ぐ浣圭瑹?key闁挎稑濂旀繛鍥偨閵婏附鎷遍柛锔芥緲閸櫻囨煥椤旇法妲ら柛娆愮懁缁?;
  syncProviderFormVisibility();
}

store.subscribe(render);
configureStaticRuntime();
render(store.get());
loadRuntimeLedger().catch(error => showToast(`闁哄牜鍓欏﹢鎾礃閸涱収鍟囬悹鎰堕檮濠€鎵嫚鐠囨彃绲垮鎯扮簿鐟欙箓鏁?{error.message}`, "warning"));
loadIconManifest().catch(() => {});
setTimeout(() => { $("#bootScreen").hidden = true; $("#desktop").hidden = false; }, 900);
