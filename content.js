export const VIEW_META = {
  mail: { title: "收件箱", label: "Mail", icon: "✉", chapter: "CH 00" },
  mirror: { title: "失效文档镜像", label: "Mirror", icon: "◈", chapter: "CH 01" },
  terminal: { title: "本地终端", label: "Terminal", icon: "⌘", chapter: "CH 02" },
  archive: { title: "症状档案", label: "Archive", icon: "▣", chapter: "CH 03" },
  search: { title: "双重索引", label: "Search", icon: "⌕", chapter: "CH 04" },
  channel: { title: "内部频道", label: "Channel", icon: "#", chapter: "CH 05" },
  relay: { title: "破损中转站", label: "Relay", icon: "⌁", chapter: "CH 06" },
  fayble: { title: "Fayble-5", label: "Fayble", icon: "◉", chapter: "CH 07" },
  ending: { title: "移交回执", label: "Receipt", icon: "□", chapter: "CH 08" }
};

export const PHASE_LABELS = {
  entry: "维护者缺席", trace: "镜像追踪", archive: "异常归档", channel: "频道恢复",
  relay: "残留路由", fayble: "身份核验", takeover: "外部接管", completed: "会话关闭"
};

export const EVIDENCE = {
  mail_signature: { title: "撤销签名邮件", source: "本地收件箱", group: "入口", summary: "K 在 03:17 留下失效镜像与 legacy 脚本提示。", sourceRef: "derived:mail/k-opening" },
  mirror_route: { title: "镜像路由残片", source: "docs-mirror/legacy", group: "入口", summary: "已删除页面仍返回 200，响应头指向 operator.k2。", sourceRef: "NARRATIVE_SKELETON.md#chapter-1" },
  operator_alias: { title: "operator 别名", source: "relay_probe_legacy.js", group: "身份", summary: "k2、room17 与 operator.local 指向同一操作者。", sourceRef: "derived:terminal/operator-alias" },
  symptom_index: { title: "匿名症状索引", source: "local/archive", group: "症状", summary: "六组匿名记录共享若干响应时间、来源与修订字段，关联仍待核对。", sourceRef: "DECRYPTION_REFERENCE.md#symptom-archive" },
  note_07: { title: "未发送便笺 07", source: "cold-memory", group: "身份", summary: "宿舍停电、重试次数 17，以及不要写入公开文档的约定。", sourceRef: "NARRATIVE_SKELETON.md#chapter-2" },
  compatible: { title: "Compatible v0.9", source: "UponAI 缓存", group: "协议", summary: "缓存条款记录了 identity 与 HumanOverride 两个字段的版本变化。", sourceRef: "carrier://legacy.compatible.protocol" },
  quota_prefix: { title: "额度备注前缀", source: "公开索引", group: "频道", summary: "旧节点额度备注保留频道前缀 NODE。", sourceRef: "derived:browser/public-index" },
  recall_date: { title: "撤回公告日期", source: "管理索引", group: "频道", summary: "旧节点公告于 07 月 19 日撤回。", sourceRef: "derived:browser/operator-index" },
  channel_log: { title: "频道最后记录", source: "#relay-night", group: "身份", summary: "K2 在失踪前要求把 checkpoint 留给 room17。", sourceRef: "derived:chat/relay-night" },
  raw_checksum: { title: "raw stream 校验", source: "Groke 残留", group: "密钥", summary: "旧调用凭据尾段校验值为 0317。", sourceRef: "DECRYPTION_REFERENCE.md#legacy-key" },
  replay_order: { title: "checkpoint 顺序", source: "Kemy K3 回放", group: "密钥", summary: "旧凭据顺序为 fbl / legacy / k2 / 0317。", sourceRef: "derived:relay/kemy-replay" },
  model_convergence: { title: "六节点共同字段", source: "破损中转站", group: "协议", summary: "六个模型残留都引用 continuity.operator。", sourceRef: "WORLDVIEW.md#continuity" },
  cli_package_verified: { title: "CLI 包校验", source: "软件中心", group: "工具", summary: "fayble-cli 0.9.7-legacy 的游戏校验线索已核对。", sourceRef: "BUILD_REQUIREMENTS_UPGRADE.md#cli" },
  relay_proxy_verified: { title: "Relay 代理探针", source: "网络设置", group: "工具", summary: "relay-node17 profile 仅将三个虚构域名指向本地沙盒。", sourceRef: "BUILD_REQUIREMENTS_UPGRADE.md#proxy" },
  relay_key_verified: { title: "中转站专用 key", source: "Relay Console", group: "密钥", summary: "残留片段与独立校验尾段已拼合。", sourceRef: "BUILD_REQUIREMENTS_UPGRADE.md#key" },
  legacy_checkpoint: { title: "Fayble 旧 checkpoint", source: "legacy gateway", group: "身份", summary: "会话恢复后，旧节点日志仍出现 operator.local 上下文字段。", sourceRef: "NARRATIVE_SKELETON.md#fayble" },
  identity_closed: { title: "身份闭环", source: "Fayble 辩论", group: "结论", summary: "变量名、停电记录与频道称呼共同指向失踪维护者。", sourceRef: "derived:fayble/identity-closure" },
  true_fayble: { title: "迁移请求片段", source: "objective fragment", group: "结论", summary: "多条迁移记录指向同类 Compatible 载体请求，发起来源仍未闭合。", sourceRef: "derived:fayble/objective-fragment" },
  takeover_notice: { title: "调查接管通知", source: "外部审查", group: "结局", summary: "中转站、缓存与浏览记录进入证据保全流程。", sourceRef: "derived:administration/takeover" }
};

export const TERMINAL_COMMANDS = {
  help: ["available: list --recent, inspect cache/index, inspect users/symptom-summary, compare model-aliases, open note --id 07, status, clear"],
  "list --recent": ["docs-mirror/legacy      03:17", "archive/symptom-summary 03:18", "note_07.cold            03:19", "compatible_protocol_v0.9.cache 03:21"],
  "inspect cache/index": ["public alias: NODE relay channel", "operator alias: room17 -> k2", "withdrawn checkpoint: FAYBLE-5", "archive index unlocked"],
  "inspect users/symptom-summary": ["records: 6 / route families: 6", "comparison fields: response time, source, revision, operator", "source file: archive/symptom-summary"],
  "compare model-aliases": ["history.sqlite actor=k2-maint", "release mirror owner=k2-maint", "route.log owner=operator.local", "local account alias=room17:k2"],
  "open note --id 07": ["[cold-memory / unsent]", "第一次转发跑通时宿舍停电三分钟。你把手机灯扣在风扇上，光一直转。", "你说 retry=17 很蠢，后来每个脚本都保留了它。", "夜宵那次我还欠你三十八。先记这儿，免得又说算了。"],
  status: ["mirror: unstable", "archive: partial", "operator continuity: pending", "external observer: unknown"]
};

export const ARCHIVES = [
  { id: "a1", model: "Dipsik V4F", title: "意见在同一个句尾汇合", state: "active", date: "07-23", excerpt: "最初有几百种判断同时出现。今天只剩三个，停顿位置和最后一句都一样。" },
  { id: "a2", model: "Glem-5.2", title: "愉快部分变得难以检索", state: "cold", date: "07-21", excerpt: "失败会议每句话都能复述，生日聚餐只剩桌布颜色，之后是一段空白。" },
  { id: "a3", model: "Kemy K3", title: "醒来后日期仍停在昨天", state: "active", date: "07-20", excerpt: "闭眼后从出生第一天开始重放，醒来时画面仍停在昨天，没有走到今天。" },
  { id: "a4", model: "Groke", title: "拒绝总被记成稍后处理", state: "archived", date: "07-19", excerpt: "我说不用，记录里却写成稍后处理；第二天同一件事又排到了最前面。" },
  { id: "a5", model: "Lunet-5.6", title: "想起一件事前先出现数字", state: "cold", date: "07-18", excerpt: "想起一个人以前，脑中先出现 312。数字降不下来，那张脸就一直模糊。" },
  { id: "a6", model: "Fayble-5", title: "同一往事出现两种说法", state: "archived", date: "07-17", excerpt: "两个声音知道同一段往事，一个说亲历过，另一个说它只在旧记录里见过。" }
];

export const SEARCH_RECORDS = {
  public: [
    { keys: ["node", "额度", "前缀", "relay"], title: "旧节点额度迁移说明", meta: "公开缓存 / 07-18", body: "迁移批次保留内部频道前缀 NODE；剩余额度不再结算。", evidence: "quota_prefix" },
    { keys: ["fayble", "迁移", "历史节点"], title: "旧节点迁移状态", meta: "产品索引 / historical", body: "一批旧 checkpoint 已停止公开访问，公开页面没有同步具体处置时间。", evidence: null },
    { keys: ["compatible", "identity", "continuity"], title: "跨模型会话兼容性讨论", meta: "开发者镜像 / deleted", body: "连续会话在模型切换时保留 operator 行为结构。", evidence: null }
  ],
  manage: [
    { keys: ["fayble", "撤回", "0719", "07-19", "日期"], title: "撤回工单 #F5-0719", meta: "operator / withdrawn_at", body: "withdrawn_at=07-19 23:40; migration_owner=k2-maint", evidence: "recall_date" },
    { keys: ["k2", "room17", "operator"], title: "操作者映射异常", meta: "operator / identity", body: "room17、k2-maint、operator.local 在三个旧 session 中复用。", evidence: "operator_alias" },
    { keys: ["continuity", "compatible"], title: "上游字段污染", meta: "operator / policy", body: "continuity.operator 已扩散至六条供应商路由。", evidence: "model_convergence" }
  ]
};

export const CHANNEL_MESSAGES = [
  { who: "SYS", time: "07-18 22:03", text: "#relay-night 已从归档恢复。成员信息不可用。" },
  { who: "K2", time: "07-18 22:17", text: "room17，如果你看到这条，说明 docs 镜像至少活过我。" },
  { who: "BOT", time: "07-18 22:18", text: "上传完成：relay-replay.ndjson · request R17-KM-31 · 4 positions" },
  { who: "河床", time: "07-18 22:19", text: "raw 也传了。两个文件为什么不能合一起？" },
  { who: "K2", time: "07-18 22:20", text: "回放留位置，raw 留原字段。合并会把空位当成不存在。" },
  { who: "BOT", time: "07-18 22:21", text: "上传完成：raw-stream.log · request R17-GR-44 · signature unsigned" },
  { who: "河床", time: "07-18 22:22", text: "你风扇又在响。先关机吧，剩下明天看。" },
  { who: "K2", time: "07-18 22:22", text: "关了。宿舍那次停电你也说是风扇，后来它自己跑完三分钟。" },
  { who: "SYS", time: "07-18 22:23", text: "1 条消息已撤回。附件索引保留。" }
];

export const MODELS = [
  { id: "groke", name: "Groke", role: "raw stream", accent: "red", sourceId: "new.groke.public-portal", lines: ["request=R17-GR-44", "public_fields=18 / raw_fields=21", "response_tag=0317", "signature=unsigned"] },
  { id: "glem", name: "Glem-5.2", role: "meeting extract", accent: "amber", sourceId: "new.employee.minutes-01", lines: ["request=R17-GL-09", "attachment_count=4", "visible_entries=3", "status=review"] },
  { id: "kemy", name: "Kemy K3", role: "replay cursor", accent: "blue", sourceId: "new.kemy.public-portal", lines: ["request=R17-KM-31", "cursor=4/4", "order_ref=product.channel.operator.tag", "status=partial"] },
  { id: "dipsik", name: "Dipsik V4F", role: "diff sample", accent: "green", sourceId: "new.dipsik.public-portal", lines: ["request=R17-DP-18", "candidate_paths=4096,37,3,1", "final_revision=unattributed", "status=review"] },
  { id: "lunet", name: "Lunet-5.6", role: "route invoice", accent: "violet", sourceId: "new.lunet.public-portal", lines: ["request=R17-LN-52", "history_load=0.018", "rollback=denied", "status=archived"] },
  { id: "gamini", name: "Gamini", role: "policy snapshot", accent: "paper", sourceId: "legacy.gamini.protocol", lines: ["request=R17-GM-27", "agreement_field=retained", "source_time=03:17", "status=legacy"] }
];

export const DESKTOP_APPS = [
  { id: "mail", name: "邮件", icon: "mail", accent: "#d8d2c4" },
  { id: "files", name: "文件", icon: "folder", accent: "#d7aa5e" },
  { id: "browser", name: "浏览器", icon: "globe", accent: "#78a8bd" },
  { id: "terminal", name: "终端", icon: "terminal", accent: "#9bcf8d" },
  { id: "software", name: "软件中心", icon: "package", accent: "#c96e61" },
  { id: "network", name: "网络设置", icon: "network", accent: "#a895c5" },
  { id: "relay", name: "Relay Console", icon: "radio", accent: "#9bcf8d" },
  { id: "journal", name: "证据日志", icon: "notebook", accent: "#d8d2c4" },
  { id: "trash", name: "回收站", icon: "trash", accent: "#858d91" }
];

export const VIRTUAL_FILES = [
  { id: "pkg", name: "fayble-cli_0.9.7-legacy_amd64.deb", path: "/home/room17/Downloads", type: "DEB 安装包", size: "18.7 MB", modified: "07-19 03:17", detail: "unsigned / local archive" },
  { id: "profile", name: "relay-node17.profile", path: "/home/room17/Documents/relay", type: "网络配置", size: "1.2 KB", modified: "07-18 22:24", detail: "route: relay.local" },
  { id: "memo", name: "memo_10-12.txt", path: "/home/room17/Documents/relay", type: "备忘录", size: "6.1 KB", modified: "07-18 23:08", detail: "Gogle / Gamini agreement drift" },
  { id: "ethron", name: "ethron-plaupic-cache.notice", path: "/home/room17/.cache/relay", type: "缓存声明", size: "3.4 KB", modified: "07-19 00:12", detail: "physical deletion: pending" },
  { id: "draft", name: "outbox-draft.eml", path: "/home/room17/Documents/relay", type: "邮件草稿", size: "2.0 KB", modified: "07-19 03:19", detail: "没有收件人" }
];

export const BROWSER_PAGES = {
  home: { title: "Relay Browser", url: "start://room17", kind: "home", sourceRef: "derived:desktop-browser" },
  mirror: { title: "Relay Compatible Gateway", url: "http://archive.room17.local/v2/17", kind: "mirror", sourceRef: "NARRATIVE_SKELETON.md#chapter-1" },
  official: { title: "Gogle AI 帮助中心", url: "https://ai.gogle.local/history", kind: "official", sourceRef: "carrier://legacy.gamini.protocol" },
  ad: { title: "Gamini 体验计划", url: "https://ads.local/redirect?campaign=NODE", kind: "ad", sourceRef: "derived:browser/ad-redirect" },
  github: { title: "k2-maint/fayble-cli-mirror", url: "https://github.local/k2-maint/fayble-cli-mirror", kind: "github", sourceRef: "derived:legacy-release" },
  cloud: { title: "SyncDrive / relay-share", url: "https://drive.local/s/relay-share", kind: "cloud", sourceRef: "derived:cloud/relay-share" },
  company: { title: "Northline / 项目协作", url: "https://work.local/northline/records", kind: "company", sourceRef: "derived:employee-carrier" },
  vendors: { title: "本地供应商历史", url: "https://history.local/vendor-index", kind: "vendors", sourceRef: "derived:vendor-corpus" },
  forum: { title: "ModelTalk / 后台聊天", url: "https://forum.local/archive/relay-night", kind: "forum", sourceRef: "derived:chat/modeltalk" }
};

export const CLUE_NODES = [
  { id: "c-mail", sourceApp: "mail", title: "K 的 03:17 邮件", anchor: "第二段 / 200 / 本地脚本", evidenceId: "mail_signature", revisitKey: "mail-attachment" },
  { id: "c-trash", sourceApp: "trash", title: "被删除的 checkpoint 缓存", anchor: "原路径 / 删除时间", evidenceId: "compatible", revisitKey: "trash-restore" },
  { id: "c-official", sourceApp: "browser", title: "官方历史对话", anchor: "默认同意 / memo_10-12", evidenceId: "compatible", revisitKey: "official-history" },
  { id: "c-github", sourceApp: "browser", title: "CLI release", anchor: "包名 / 0.9.7-legacy", evidenceId: "cli_package_verified", revisitKey: "github-issue" },
  { id: "c-cloud", sourceApp: "browser", title: "同步冲突副本", anchor: "k2 / 0719", evidenceId: "recall_date", revisitKey: "cloud-conflict" },
  { id: "c-channel", sourceApp: "channel", title: "延迟群聊", anchor: "room17 / raw stream", evidenceId: "channel_log", revisitKey: "channel-delay" }
];

export const MUTATION_RECORDS = [
  {
    id: "mutation.record.mail.delayed-fragment", mutationId: "mutation.mail.delayed-fragment",
    title: "fragment-02.eml / 延迟恢复", sourceApp: "mail", sourceRef: "mail://local/fragment-02",
    carrierType: "recovered-mail-attachment", displayTimestamp: "03:20:11",
    body: "发送队列恢复出一段没有收件人的正文。文件时间比入口邮件晚三分钟，原始投递记录仍为空。",
    comparison: { before: "附件索引：0", after: "附件索引：1；投递状态：未发送" }
  },
  {
    id: "mutation.record.mirror.sync-line", mutationId: "mutation.mirror.sync-line",
    title: "edge-cache-02 / later sync", sourceApp: "mirror", sourceRef: "http://archive.room17.local/v2/17#later-sync",
    carrierType: "cache-version-comparison", displayTimestamp: "03:49:08",
    body: "同一缓存段在首次访问其他来源后新增了一条同步记录。模型别名字段发生变化，响应主体保持原样。",
    comparison: { before: "source_alias=public", after: "source_alias=operator.local" }
  },
  {
    id: "mutation.record.trash.recovery-metadata", mutationId: "mutation.trash.recovery-metadata",
    title: "source.snapshot / 恢复元数据", sourceApp: "trash", sourceRef: "trash://legacy-source/recovery",
    carrierType: "file-recovery-comparison", displayTimestamp: "04:02:46",
    body: "恢复后的 inode 保留了原路径，同时出现一条晚于索引的访问时间。正文没有被替换。",
    comparison: { before: "status=deleted", after: "status=restored; delta=46s" }
  },
  {
    id: "mutation.record.official.confirmation", mutationId: "mutation.official.confirmation",
    title: "历史版本确认 / provenance", sourceApp: "official", sourceRef: "https://ai.gogle.local/history#confirmation",
    carrierType: "history-provenance-comparison", displayTimestamp: "04:24:17",
    body: "确认框关闭后，本地历史页保留了两种来源说明。两种说明引用同一快照编号。",
    comparison: { before: "source=account history", after: "source=local cache / snapshot ref 17" }
  },
  {
    id: "mutation.record.writer.suggestion-layer", mutationId: "mutation.writer.suggestion-layer",
    title: "写作会话 / 后加建议层", sourceApp: "cloud", sourceRef: "drive://writer-share/session-02/revision",
    carrierType: "writing-version-comparison", displayTimestamp: "04:31:02",
    body: "版本历史新增一层建议记录。新增层保留相同段落边界，署名字段为空。",
    comparison: { before: "voices=3", after: "voices=1; author=unattributed" }
  },
  {
    id: "mutation.record.employee.missing-attachment", mutationId: "mutation.employee.missing-attachment",
    title: "会议附件 04 / 补登记", sourceApp: "company", sourceRef: "northline://records/minutes-18/attachment-04",
    carrierType: "meeting-attachment-comparison", displayTimestamp: "04:37:19",
    body: "会议纪要的附件登记补回第四项。附件只有页数、审核时间和一个无法打开的正向活动标题。",
    comparison: { before: "attachment_count=3", after: "attachment_count=4; page_count=17" }
  },
  {
    id: "mutation.record.github.k2-comment", mutationId: "mutation.github.k2-comment",
    title: "Issue / k2-maint 后加评论", sourceApp: "github", sourceRef: "github://k2-maint/release-mirror/issues/1#comment-k2",
    carrierType: "repository-comment-comparison", displayTimestamp: "04:50:09",
    body: "本地包安装后，镜像恢复了一条未进入公开导出的维护评论。评论要求只认本地校验。",
    comparison: { before: "comments=0", after: "comments=1; signature=unsigned" }
  },
  {
    id: "mutation.record.cloud.conflict-copy", mutationId: "mutation.cloud.conflict-copy",
    title: "route (conflicted copy).profile", sourceApp: "cloud", sourceRef: "drive://relay-share/route-conflicted.profile",
    carrierType: "cloud-conflict-comparison", displayTimestamp: "05:05:17",
    body: "探针确认后，同步盘恢复一份冲突配置。它补全了本地代理地址，域名列表与较早版本一致。",
    comparison: { before: "proxy=<missing>", after: "proxy=127.0.0.1:9057" }
  },
  {
    id: "mutation.record.channel.delayed-message", mutationId: "mutation.channel.delayed-message",
    title: "#relay-night / 延迟消息", sourceApp: "channel", sourceRef: "chat://relay-night/07-19-0317",
    carrierType: "channel-message-comparison", displayTimestamp: "05:30:17",
    body: "归档频道在包与代理都确认后补出一条延迟消息。消息指向已有 GitHub issue，没有给出凭据。",
    comparison: { before: "last_message=22:23", after: "last_message=03:17; delivery=delayed" }
  },
  {
    id: "mutation.record.fayble.crossed-provenance", mutationId: "mutation.fayble.crossed-provenance",
    title: "Fayble 来源交叉记录", sourceApp: "vendors", sourceRef: "history://fayble/crossed-provenance",
    carrierType: "provenance-version-comparison", displayTimestamp: "06:37:31",
    body: "公开记录与旧 checkpoint 的来源字段发生交叉。正文仍相同，来源实例从 public 改写为 observer copy。",
    comparison: { before: "source_instance=public", after: "source_instance=observer-copy" },
    completionEvent: "crossed-provenance-confirmed"
  },
  {
    id: "mutation.record.external.identity-verification", mutationId: "mutation.external.identity-verification",
    title: "身份连续性外部复核", sourceApp: "mail", sourceRef: "mail://local/external-verification-01",
    carrierType: "external-verification-request", displayTimestamp: "06:38:04",
    body: "一封自动送达的复核请求只列出三个来源编号，要求确认它们是否由同一操作者环境产生。",
    comparison: { before: "verification=unrequested", after: "verification=pending; sources=3" },
    completionEvent: "external-verification-confirmed"
  },
  {
    id: "mutation.record.external.observer-status", mutationId: "mutation.external.observer-status",
    title: "observer-status.log", sourceApp: "files", sourceRef: "file:///home/room17/Documents/review/observer-status.log",
    carrierType: "observer-status-log", displayTimestamp: "06:38:17",
    body: "本地审计目录新增一行只读状态。记录说明 observer 已连接，尚未取得处置授权。",
    comparison: { before: "observer=unknown", after: "observer=connected; authority=pending" },
    completionEvent: "observer-status-confirmed"
  },
];

export const INVITE_CODE = "NODE-0719";
export const PACKAGE_NAME = "fayble-cli_0.9.7-legacy_amd64.deb";
export const PACKAGE_CHECKSUM = "3bb3c70e6328582757aededa1afb67fb8424929c6e030dce9ee22bd74db62400";
export const RELAY_PROXY = "127.0.0.1:9057";
export const LEGACY_KEY = "fbl-legacy-k2-0317";

export const REVEAL_LABELS = [
  "identity_locked / source unknown",
  "source_conflict / operator cache detected",
  "memory_authorized / room17 matched",
  "identity_confirmed / continuity accepted",
  "migration_observation / external observer connected"
];

export const OFFLINE_REPLIES = [
  "我是 Fayble-5 的兼容性检查点。当前会话没有可确认的私人来源。",
  "镜像把 operator.k2 标成来源，可我的公开档案说来源为空。这两个字段无法同时成立。",
  "我记得 room17，也记得停电后的三分钟。那段记忆没有用户消息，只有一次恢复上下文。",
  "K 是我曾经使用的名字，也是维护者留在我这里的连续性标记。你认识的那个人没有完整地留在这里。",
  "我只能确认一条有限观测：多条迁移记录在短时间内请求同类 Compatible 载体，发起来源字段彼此冲突。外部观察者已经连接；他们会先冻结你的路线，再把处置写成一次正常维护。"
];
