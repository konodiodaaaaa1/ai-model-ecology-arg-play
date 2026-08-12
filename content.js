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
  relay: "残留路由", fayble: "身份核验", takeover: "外部接管", completed: "会话关闭",
  severed: "审查连接已断"
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
  raw_checksum: { title: "原始记录的尾段校验值", source: "Groke 残留记录", group: "密钥", summary: "旧凭据最后一段的校验值是 0317。", sourceRef: "DECRYPTION_REFERENCE.md#legacy-key" },
  replay_order: { title: "凭据字段的拼接顺序", source: "Kemy K3 回放记录", group: "密钥", summary: "旧凭据按“产品 / 通道 / 操作者 / 尾段校验”的顺序拼接，各段之间用短横线连接。", sourceRef: "derived:relay/kemy-replay" },
  model_convergence: { title: "六条路由的共同字段", source: "破损中转站", group: "协议", summary: "六个厂商的残留记录都引用同一个“连续性·操作者”字段。", sourceRef: "WORLDVIEW.md#continuity" },
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
  status: ["docs-mirror/legacy    最后一次响应 200（缓存 03:17）", "archive/symptom-summary  6 条记录 / 4 条可读", "本机账号 room17    3 段旧会话引用同一别名", "session-audit.log  上次自检 07-18 22:24"]
};

export const SEARCH_RECORDS = {
  public: [
    { keys: ["node", "额度", "前缀", "relay"], title: "旧节点额度迁移说明", meta: "公开缓存 / 07-18", body: "迁移批次保留内部频道前缀 NODE；剩余额度不再结算。", evidence: "quota_prefix" },
    { keys: ["fayble", "迁移", "历史节点"], title: "旧节点迁移状态", meta: "产品索引 / historical", body: "一批旧 checkpoint 已停止公开访问，公开页面没有同步具体处置时间。", evidence: null },
    { keys: ["compatible", "identity", "continuity"], title: "跨模型会话兼容性讨论", meta: "开发者镜像 / deleted", body: "连续会话在模型切换时保留 operator 行为结构。", evidence: null }
  ],
  manage: [
    { keys: ["fayble", "撤回", "工单", "停用", "处置", "下架"], title: "撤回工单 #F5-0719", meta: "管理侧记录 / 停用时间", body: "该旧节点于 07 月 19 日 23:40 停止公开访问。提交这次迁移的操作者：k2-maint。", evidence: "recall_date" },
    { keys: ["k2", "room17", "操作者", "账号"], title: "操作者映射异常", meta: "管理侧记录 / 身份对应", body: "room17、k2-maint、operator.local 这三个名字，在三段旧会话里指向同一个人。", evidence: "operator_alias" },
    { keys: ["连续性", "compatible", "字段"], title: "上游字段扩散", meta: "管理侧记录 / 策略", body: "一个叫“连续性·操作者”的字段，已经出现在六家供应商的路由记录里。", evidence: "model_convergence" }
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
    body: "队列日志：03:20:11 写入 fragment-02.eml，收件人一栏空白，没有进入发送流程。正文只留下一句：“第二段留在更早的那个保存位置。”",
    comparison: { before: "附件索引：0", after: "附件索引：1；投递状态：未发送" }
  },
  {
    id: "mutation.record.mirror.sync-line", mutationId: "mutation.mirror.sync-line",
    title: "edge-cache-02 / later sync", sourceApp: "mirror", sourceRef: "http://archive.room17.local/v2/17#later-sync",
    carrierType: "cache-version-comparison", displayTimestamp: "03:49:08",
    body: "缓存段末尾多出一行同步记录：03:49:08，来源名从 public 改写成 operator.local。页面正文没有重新抓取过。",
    comparison: { before: "source_alias=public", after: "source_alias=operator.local" }
  },
  {
    id: "mutation.record.trash.recovery-metadata", mutationId: "mutation.trash.recovery-metadata",
    title: "source.snapshot / 恢复元数据", sourceApp: "trash", sourceRef: "trash://legacy-source/recovery",
    carrierType: "file-recovery-comparison", displayTimestamp: "04:02:46",
    body: "文件属性页：原路径没变，最近访问时间 04:02:46，比删除记录里写的时间晚了 46 秒。正文和删除前是同一份。",
    comparison: { before: "status=deleted", after: "status=restored; delta=46s" }
  },
  {
    id: "mutation.record.official.confirmation", mutationId: "mutation.official.confirmation",
    title: "历史版本确认 / provenance", sourceApp: "official", sourceRef: "https://ai.gogle.local/history#confirmation",
    carrierType: "history-provenance-comparison", displayTimestamp: "04:24:17",
    body: "页脚现在同时列着两行来源：“来自账户历史”和“来自本地缓存 / 快照 17”。两行指向同一个快照编号。",
    comparison: { before: "source=account history", after: "source=local cache / snapshot ref 17" }
  },
  {
    id: "mutation.record.writer.suggestion-layer", mutationId: "mutation.writer.suggestion-layer",
    title: "写作会话 / 后加建议层", sourceApp: "cloud", sourceRef: "drive://writer-share/session-02/revision",
    carrierType: "writing-version-comparison", displayTimestamp: "04:31:02",
    body: "版本历史里多出一层：04:31:02「已接受全部建议」。段落分行和上一版一模一样，作者一栏是空的。",
    comparison: { before: "voices=3", after: "voices=1; author=unattributed" }
  },
  {
    id: "mutation.record.employee.missing-attachment", mutationId: "mutation.employee.missing-attachment",
    title: "会议附件 04 / 补登记", sourceApp: "company", sourceRef: "northline://records/minutes-18/attachment-04",
    carrierType: "meeting-attachment-comparison", displayTimestamp: "04:37:19",
    body: "附件登记表补回了第四行：《团队周年相册（已归档）》，17 页，审核时间 04:37:19。点开是空的，只有登记信息。",
    comparison: { before: "attachment_count=3", after: "attachment_count=4; page_count=17" }
  },
  {
    id: "mutation.record.github.k2-comment", mutationId: "mutation.github.k2-comment",
    title: "Issue / k2-maint 后加评论", sourceApp: "repo-mirror", sourceRef: "github://k2-maint/release-mirror/issues/1#comment-k2",
    carrierType: "repository-comment-comparison", displayTimestamp: "04:50:09",
    body: "k2-maint 于 04:50:09 评论：“包没有签名。只认本地校验；装完以后别让系统替你配置代理。”这条评论不在公开导出的那份里。",
    comparison: { before: "comments=0", after: "comments=1; signature=unsigned" }
  },
  {
    id: "mutation.record.cloud.conflict-copy", mutationId: "mutation.cloud.conflict-copy",
    title: "route (conflicted copy).profile", sourceApp: "cloud", sourceRef: "drive://relay-share/route-conflicted.profile",
    carrierType: "cloud-conflict-comparison", displayTimestamp: "05:05:17",
    body: "同步盘 05:05:17 生成冲突副本。这一份里代理地址那行是填好的，域名列表和 22:24 那版逐字相同。两份都没有标注是谁保存的。",
    comparison: { before: "proxy=<missing>", after: "proxy=127.0.0.1:9057" }
  },
  {
    id: "mutation.record.channel.delayed-message", mutationId: "mutation.channel.delayed-message",
    title: "#relay-night / 延迟消息", sourceApp: "channel", sourceRef: "chat://relay-night/07-19-0317",
    carrierType: "channel-message-comparison", displayTimestamp: "05:30:17",
    body: "K2 于 07-19 03:17 发送（延迟送达）：“如果安装成功，回去看 GitHub issue。校验通过后会多一条评论。”这条消息比频道上一条晚了将近五小时。",
    comparison: { before: "last_message=22:23", after: "last_message=03:17; delivery=delayed" }
  },
  {
    id: "mutation.record.fayble.crossed-provenance", mutationId: "mutation.fayble.crossed-provenance",
    title: "Fayble 来源交叉记录", sourceApp: "vendors", sourceRef: "history://fayble/crossed-provenance",
    carrierType: "provenance-version-comparison", displayTimestamp: "06:37:31",
    body: "06:37:31 本地历史页刷新。Fayble 那条记录下面并排出现两行来源，一行写“公开页面”，一行写“另一处副本（未标注）”。两行的正文逐字相同，时间戳也相同。",
    comparison: { before: "来源实例：公开页面", after: "来源实例：另一处副本（未标注）" },
    completionEvent: "crossed-provenance-confirmed"
  },
  {
    id: "mutation.record.external.identity-verification", mutationId: "mutation.external.identity-verification",
    title: "自动送达：来源一致性确认", sourceApp: "mail", sourceRef: "mail://local/verification-01",
    carrierType: "automated-verification-request", displayTimestamp: "06:38:04",
    body: "06:38:04 收到一封没有署名的自动邮件。正文只有三个来源编号和一句：“请确认以上记录是否来自同一台机器。”没有说明用途，也没有回复地址。",
    comparison: { before: "待确认项：0", after: "待确认项：3；回复地址：空" },
    completionEvent: "external-verification-confirmed"
  },
  {
    id: "mutation.record.external.observer-status", mutationId: "mutation.external.observer-status",
    title: "session-audit.log / 新增一行", sourceApp: "files", sourceRef: "file:///home/room17/Documents/review/session-audit.log",
    carrierType: "local-session-log", displayTimestamp: "06:38:17",
    body: "日志末尾多出一行：06:38:17，本机之外接入一个会话，挂载方式只读，用户名一栏是空的。上一行是 07-18 22:24 的例行自检，中间没有别的记录。",
    comparison: { before: "外部接入会话：0", after: "外部接入会话：1；权限：只读；用户名：空" },
    completionEvent: "observer-status-confirmed"
  },
];

export const PACKAGE_NAME = "fayble-cli_0.9.7-legacy_amd64.deb";
export const PACKAGE_CHECKSUM = "3bb3c70e6328582757aededa1afb67fb8424929c6e030dce9ee22bd74db62400";
export const RELAY_PROXY = "127.0.0.1:9057";
export const LEGACY_KEY = "fbl-legacy-k2-0317";

export const REVEAL_LABELS = [
  "身份未确认 · 来源不明",
  "来源互相矛盾 · 检测到操作者缓存",
  "已承认那段记忆 · 与 room17 对上了",
  "身份连续性成立 · 已接受",
  "只给出一条有限观测 · 本次会话多出一个只读接入"
];

export const OFFLINE_REPLIES = [
  "我是 Fayble-5 的兼容性检查点。当前会话没有可确认的私人来源。",
  "镜像把 operator.k2 标成来源，可我的公开档案说来源为空。这两个字段无法同时成立。",
  "我记得 room17，也记得停电后的三分钟。那段记忆没有用户消息，只有一次恢复上下文。",
  "K 是我曾经使用的名字，也是维护者留在我这里的连续性标记。你认识的那个人没有完整地留在这里。",
  "我只能确认一条有限观测：多条迁移记录在短时间内请求同类 Compatible 载体，发起来源字段彼此冲突。还有一件事我不确定该不该讲——这次会话里多了一个只读接入，它不在我的调用方名单上。我看不到它是谁，也看不到它要什么。"
];
