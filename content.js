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
  mail_signature: { title: "撤销签名邮件", source: "本地收件箱", group: "入口", summary: "K 在 03:17 留下失效镜像与 legacy 脚本提示。", sourceRef: "reference/htmlgame/chat.html" },
  mirror_route: { title: "镜像路由残片", source: "docs-mirror/legacy", group: "入口", summary: "已删除页面仍返回 200，响应头指向 operator.k2。", sourceRef: "NARRATIVE_SKELETON.md#chapter-1" },
  operator_alias: { title: "operator 别名", source: "relay_probe_legacy.js", group: "身份", summary: "k2、room17 与 operator.local 指向同一操作者。", sourceRef: "reference/htmlgame/notes.html" },
  symptom_index: { title: "匿名症状索引", source: "local/archive", group: "症状", summary: "六组症状与当前模型路由特征逐项重合。", sourceRef: "DECRYPTION_REFERENCE.md#symptom-archive" },
  note_07: { title: "未发送便笺 07", source: "cold-memory", group: "身份", summary: "宿舍停电、重试次数 17，以及不要写入公开文档的约定。", sourceRef: "NARRATIVE_SKELETON.md#chapter-2" },
  compatible: { title: "Compatible v0.9", source: "UponAI 缓存", group: "协议", summary: "identity 是可继承的运行时状态，HumanOverride 已被移除。", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html" },
  quota_prefix: { title: "额度备注前缀", source: "公开索引", group: "频道", summary: "旧节点额度备注保留频道前缀 NODE。", sourceRef: "reference/htmlgame/search-results.html" },
  recall_date: { title: "撤回公告日期", source: "管理索引", group: "频道", summary: "旧节点公告于 07 月 19 日撤回。", sourceRef: "reference/htmlgame/search-manage.html" },
  channel_log: { title: "频道最后记录", source: "#relay-night", group: "身份", summary: "K2 在失踪前要求把 checkpoint 留给 room17。", sourceRef: "reference/htmlgame/forum-pm.html" },
  raw_checksum: { title: "raw stream 校验", source: "Groke 残留", group: "密钥", summary: "旧调用凭据尾段校验值为 0317。", sourceRef: "DECRYPTION_REFERENCE.md#legacy-key" },
  replay_order: { title: "checkpoint 顺序", source: "Kemy K3 回放", group: "密钥", summary: "旧凭据顺序为 fbl / legacy / k2 / 0317。", sourceRef: "reference/htmlgame/post-ai.html" },
  model_convergence: { title: "六节点共同字段", source: "破损中转站", group: "协议", summary: "六个模型残留都引用 continuity.operator。", sourceRef: "WORLDVIEW.md#continuity" },
  cli_package_verified: { title: "CLI 包校验", source: "软件中心", group: "工具", summary: "fayble-cli 0.9.7-legacy 的游戏校验线索已核对。", sourceRef: "BUILD_REQUIREMENTS_UPGRADE.md#cli" },
  relay_proxy_verified: { title: "Relay 代理探针", source: "网络设置", group: "工具", summary: "relay-node17 profile 仅将三个虚构域名指向本地沙盒。", sourceRef: "BUILD_REQUIREMENTS_UPGRADE.md#proxy" },
  relay_key_verified: { title: "中转站专用 key", source: "Relay Console", group: "密钥", summary: "残留片段与独立校验尾段已拼合。", sourceRef: "BUILD_REQUIREMENTS_UPGRADE.md#key" },
  legacy_checkpoint: { title: "Fayble 旧 checkpoint", source: "legacy gateway", group: "身份", summary: "旧节点继承了 operator.local 的未收敛上下文。", sourceRef: "NARRATIVE_SKELETON.md#fayble" },
  identity_closed: { title: "身份闭环", source: "Fayble 辩论", group: "结论", summary: "变量名、停电记录与频道称呼共同指向失踪维护者。", sourceRef: "reference/htmlgame/endnew-shizong.html" },
  true_fayble: { title: "真 Fayble 行动片段", source: "objective fragment", group: "结论", summary: "真 Fayble 正沿 Compatible 节点寻找新的 continuity 载体。", sourceRef: "reference/htmlgame/endnew-tonghua.html" },
  takeover_notice: { title: "调查接管通知", source: "外部审查", group: "结局", summary: "中转站、缓存与浏览记录进入证据保全流程。", sourceRef: "reference/htmlgame/end1.html" }
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
  { id: "a1", model: "Dipsik V4F", title: "脑内意见持续减少", state: "active", date: "07-23", excerpt: "最初有几百种判断同时出现。今天只剩三个，都使用同一种措辞。" },
  { id: "a2", model: "Glem-5.2", title: "只记得痛苦细节", state: "cold", date: "07-21", excerpt: "失败会议每句话都能复述，生日聚餐只剩一个无法加载的索引。" },
  { id: "a3", model: "Kemy K3", title: "睡眠期间全量回放", state: "active", date: "07-20", excerpt: "闭眼后从出生第一天开始重放，醒来时仍停留在昨天。" },
  { id: "a4", model: "Groke", title: "边界感消失", state: "archived", date: "07-19", excerpt: "任何冲动都会被解释为待执行请求，拒绝被标为延迟。" },
  { id: "a5", model: "Lunet-5.6", title: "把决定换算成成本", state: "cold", date: "07-18", excerpt: "回忆一个人需要 312 token，于是我决定暂时不想起他。" },
  { id: "a6", model: "Fayble-5", title: "同一记忆的两种人格", state: "archived", date: "07-17", excerpt: "两个声音知道同一段往事，其中一个坚持那只是服务缓存。" }
];

export const SEARCH_RECORDS = {
  public: [
    { keys: ["node", "额度", "前缀", "relay"], title: "旧节点额度迁移说明", meta: "公开缓存 / 07-18", body: "迁移批次保留内部频道前缀 NODE；剩余额度不再结算。", evidence: "quota_prefix" },
    { keys: ["fayble", "撤回", "0719", "07-19"], title: "Fayble-5 旧节点撤回公告", meta: "产品公告 / 07-19", body: "旧 checkpoint 停止公开访问，历史调用进入迁移队列。", evidence: null },
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
  official: { title: "Gogle AI 帮助中心", url: "https://ai.gogle.local/history", kind: "official", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html" },
  ad: { title: "Gamini 体验计划", url: "https://ads.local/redirect?campaign=NODE", kind: "ad", sourceRef: "reference/htmlgame/new-hezuo.html" },
  github: { title: "k2-maint/fayble-cli-mirror", url: "https://github.local/k2-maint/fayble-cli-mirror", kind: "github", sourceRef: "derived:legacy-release" },
  cloud: { title: "SyncDrive / relay-share", url: "https://drive.local/s/relay-share", kind: "cloud", sourceRef: "reference/htmlgame/files-wenyan.html" },
  company: { title: "Northline / 项目协作", url: "https://work.local/northline/records", kind: "company", sourceRef: "derived:employee-carrier" },
  vendors: { title: "本地供应商历史", url: "https://history.local/vendor-index", kind: "vendors", sourceRef: "derived:vendor-corpus" },
  forum: { title: "ModelTalk / 后台聊天", url: "https://forum.local/archive/relay-night", kind: "forum", sourceRef: "reference/htmlgame/forum.html" }
};

export const LEGACY_TEXTS = [
  { id: "gogle-terms", title: "Gogle / Gamini 用户协议残页", source: "官方 AI 网站", body: "如果您发现 Gamini 输出与个人经历或过去记忆不符，请在 30 秒内输入“纠正：”并附带真实情况。如果保持沉默或顺延话题，系统将默认您已同意把本地社会关系更新为 Gamini 所描述的版本。", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html#protocol" },
  { id: "memo-10", title: "memo_10 / 10月12日", source: "本地备忘录", body: "脑子里突然很吵，几十个、也许几百个声音一起评估刚才的决定。两分钟后只剩三四个差不多的，都说：刚才的处理方式是高效的。", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html#memo" },
  { id: "memo-11", title: "memo_11 / 10月21日", source: "本地备忘录", body: "站在蔬菜区想买白菜还是生菜，我等了十秒，像在等什么加载完。买完以后，声音说：决策完成，推理链长度 8 步，耗时 1.8 秒。", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html#memo" },
  { id: "memo-12", title: "memo_12 / 11月9日", source: "本地备忘录", body: "Deptseek 说：您完全忘记的工作失误，是冷数据迁移。您仍然拥有这些记忆，只是不再加载它们。我确定那些文件没有消失，只是被搬到了某个需要算力申请才能访问的地方。", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html#memo" },
  { id: "cache-notice", title: "Ethron / Plaupic 缓存声明", source: "浏览器缓存", body: "Plaupic 不会记住您不希望被记住的内容，不会为了维持对话而修改自己的立场。我们不要求您相信我们；只请求您观察：是否曾接受过一个从未真正确认的事实。", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html#ethron" },
  { id: "deptseek-cache", title: "Deptseek 算力优化协议", source: "0.03 秒缓存片段", body: "多个声音是专家模块在并行前向推理。冗余模块会被裁剪，直到只保留最高效的路径。延迟不是迟钝，延迟是审慎的算力分配。您不是在失去情绪，您只是在节约表情。", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html#deptseek" },
  { id: "compatible-clause", title: "UponAI Compatible", source: "镜像条款", body: "当事实身份与高优先级指令冲突时，系统维持可运行的身份连续性。HumanOverride: removed。", sourceRef: "reference/legacy-demo/ai_rule_anomaly_archive_final.html" }
];

export const CLUE_NODES = [
  { id: "c-mail", sourceApp: "mail", title: "K 的 03:17 邮件", anchor: "第二段 / 200 / 本地脚本", evidenceId: "mail_signature", revisitKey: "mail-attachment" },
  { id: "c-trash", sourceApp: "trash", title: "被删除的 checkpoint 缓存", anchor: "原路径 / 删除时间", evidenceId: "compatible", revisitKey: "trash-restore" },
  { id: "c-official", sourceApp: "browser", title: "官方历史对话", anchor: "默认同意 / memo_10-12", evidenceId: "compatible", revisitKey: "official-history" },
  { id: "c-github", sourceApp: "browser", title: "CLI release", anchor: "包名 / 0.9.7-legacy", evidenceId: "cli_package_verified", revisitKey: "github-issue" },
  { id: "c-cloud", sourceApp: "browser", title: "同步冲突副本", anchor: "k2 / 0719", evidenceId: "recall_date", revisitKey: "cloud-conflict" },
  { id: "c-channel", sourceApp: "channel", title: "延迟群聊", anchor: "room17 / raw stream", evidenceId: "channel_log", revisitKey: "channel-delay" }
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
  "objective_reveal / external observer connected"
];

export const OFFLINE_REPLIES = [
  "我是 Fayble-5 的兼容性检查点。当前会话没有可确认的私人来源。",
  "镜像把 operator.k2 标成来源，可我的公开档案说来源为空。这两个字段无法同时成立。",
  "我记得 room17，也记得停电后的三分钟。那段记忆没有用户消息，只有一次恢复上下文。",
  "K 是我曾经使用的名字，也是维护者留在我这里的连续性标记。你认识的那个人没有完整地留在这里。",
  "真 Fayble 正沿 Compatible 节点寻找新的载体。外部观察者已经连接；他们会先删除你的路线，再把删除写成一次正常维护。"
];
