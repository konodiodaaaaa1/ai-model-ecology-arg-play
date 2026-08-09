const STORAGE_KEY = "ai-model-ecology-arg-state-v3";
const LEGACY_STORAGE_KEYS = ["ai-model-ecology-arg-state-v2", "ai-model-ecology-arg-state-v1"];
const CHANNEL_NAME = "ai-model-ecology-arg-sync";
const OWNED_KEY_PREFIX = "ai-model-ecology-arg-";

function ownedKeys(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(OWNED_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

export function purgeLocalData() {
  const removed = [];
  for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      if (!storage) continue;
      for (const key of ownedKeys(storage)) {
        storage.removeItem(key);
        removed.push(key);
      }
    } catch (_) {
      // Storage may be blocked by browser settings; nothing else to remove.
    }
  }
  return removed;
}

export const DEFAULT_STATE = Object.freeze({
  version: 3,
  phase: "entry",
  currentView: "desktop",
  currentApp: "mail",
  onboardingSeen: false,
  npcMode: "local",
  npcProviderLabel: "本地关键词叙事",
  openedViews: [],
  readEvidence: [],
  unlockedArtifacts: [],
  solvedPuzzles: [],
  handledEvents: [],
  unlockedViews: {
    mail: true,
    mirror: false,
    terminal: false,
    archive: false,
    search: false,
    channel: false,
    relay: false,
    fayble: false,
    ending: false
  },
  terminalHistory: [
    { kind: "system", text: "Room17 local workstation" },
    { kind: "muted", text: "type help to list ordinary shell commands" }
  ],
  storyClock: {
    time: "03:17",
    milestone: "briefing-complete",
    completed: { "briefing-complete": "03:17" }
  },
  discoveredRoutes: [],
  browserBookmarks: [],
  desktopArtifacts: [],
  caseNotes: [],
  contentDiscoveries: [],
  contentReads: [],
  contentMutations: [],
  generatedContentRecords: [],
  activeContentId: null,
  archiveQuery: "",
  modelStages: {},
  channelRead: false,
  relayComplete: false,
  searchQueries: [],
  inviteSources: {},
  chat: [],
  faybleAuthorizationError: "",
  faybleCitationAttempts: [],
  revealState: "locked",
  revealLevel: 0,
  npcTrustGranted: false,
  npcTrustAt: null,
  objectiveFragments: [],
  governmentMailAvailable: false,
  activeMail: "entry",
  endingState: "inactive",
  takeoverStage: "idle",
  completedAt: null,
  virtualFiles: [],
  activeFilePlace: "home",
  trashItems: [],
  browserTabs: [],
  browserHistory: [],
  installedPackages: [],
  packageChecks: [],
  proxyProfiles: [],
  activeProxyProfile: null,
  proxyStatus: "offline",
  proxyProbeLog: [],
  cliSessions: [],
  relayKeyAttempts: [],
  relayKeyVerified: false,
  selectedCheckpoint: "",
  checkpointHandshakeComplete: false,
  desktopNotifications: [],
  windowState: {},
  sourceVisits: {},
  revisitFlags: {},
  hintLevel: "investigation",
  journalMode: "investigation",
  legacyLedgerCursor: 0,
  migratedFrom: null,
  lastUpdated: 0
});

export const STORY_MILESTONES = Object.freeze([
  { id: "briefing-complete", time: "03:17", event: null },
  { id: "mail-source-inspected", time: "03:20", event: "mail-source-inspected" },
  { id: "route-visited", time: "03:24", event: "route-visited" },
  { id: "cached-response-saved", time: "03:28", event: "cached-response-saved" },
  { id: "local-script-run", time: "03:31", event: "local-script-run" },
  { id: "cache-index-opened", time: "03:35", event: "cache-index-opened" },
  { id: "historical-entry-opened", time: "03:41", event: "historical-entry-opened" },
  { id: "first-provenance-followed", time: "03:49", event: "first-provenance-followed" },
  { id: "legacy-restored", time: "04:02", event: "legacy-restored" },
  { id: "two-carriers-read", time: "04:12", event: "two-carriers-read" },
  { id: "vendor-alias-confirmed", time: "04:24", event: "vendor-alias-confirmed" },
  { id: "repository-recovered", time: "04:36", event: "repository-recovered" },
  { id: "package-verified", time: "04:50", event: "package-verified" },
  { id: "proxy-profile-opened", time: "04:58", event: "proxy-profile-opened" },
  { id: "route-log-read", time: "05:02", event: "route-log-read" },
  { id: "proxy-reconstructed", time: "05:05", event: "proxy-reconstructed" },
  { id: "invite-confirmed", time: "05:17", event: "invite-confirmed" },
  { id: "relay-console-created", time: "05:30", event: "relay-console-created" },
  { id: "node-residues-read", time: "05:48", event: "node-residues-read" },
  { id: "key-rules-recovered", time: "06:05", event: "key-rules-recovered" },
  { id: "checkpoint-handshake", time: "06:20", event: "checkpoint-handshake" },
  { id: "fayble-evidence-authorized", time: "06:37", event: "fayble-evidence-authorized" },
  { id: "identity-closure", time: "06:52", event: "identity-closure" },
  { id: "takeover-acknowledged", time: "07:00", event: "takeover-acknowledged" }
]);

export const storyEventId = id => `story:${id}`;
export const hasStoryEvent = (state, id) => state.handledEvents.includes(storyEventId(id));
export const hasMilestone = (state, id) => hasStoryEvent(state, id) || Boolean(state.storyClock?.completed?.[id]);
const hasArtifact = (state, id) => state.unlockedArtifacts.includes(id) || state.desktopArtifacts.includes(id);

export function getUnlocks(state) {
  return {
    mailSource: true,
    mirror: true,
    scriptDownload: hasMilestone(state, "cached-response-saved"),
    terminalTrace: hasMilestone(state, "local-script-run"),
    trashRecovery: hasMilestone(state, "cache-index-opened"),
    historicalArchive: hasMilestone(state, "legacy-restored"),
    caseNotes: hasArtifact(state, "case-notes"),
    packageTools: hasMilestone(state, "repository-recovered"),
    packageInstall: hasMilestone(state, "package-verified"),
    proxyTools: hasMilestone(state, "proxy-profile-opened"),
    channel: hasMilestone(state, "invite-confirmed"),
    relay: hasArtifact(state, "relay-console"),
    keyComposer: hasMilestone(state, "key-rules-recovered"),
    fayble: hasArtifact(state, "fayble-session"),
    receipt: hasArtifact(state, "transfer-receipt"),
    trustedSession: hasArtifact(state, "trusted-session")
  };
}

export function advanceStoryClock(draft, eventId) {
  const milestone = STORY_MILESTONES.find(item => item.event === eventId || item.id === eventId);
  if (!milestone) return false;
  draft.storyClock ||= { time: "03:17", milestone: "briefing-complete", completed: { "briefing-complete": "03:17" } };
  draft.storyClock.completed ||= {};
  if (draft.storyClock.completed[milestone.id]) return false;
  draft.storyClock.completed[milestone.id] = milestone.time;
  const currentIndex = STORY_MILESTONES.findIndex(item => item.id === draft.storyClock.milestone);
  const nextIndex = STORY_MILESTONES.findIndex(item => item.id === milestone.id);
  if (nextIndex >= currentIndex) {
    draft.storyClock.milestone = milestone.id;
    draft.storyClock.time = milestone.time;
  }
  return true;
}

const clone = value => JSON.parse(JSON.stringify(value));

function normalize(candidate) {
  const next = { ...clone(DEFAULT_STATE), ...(candidate || {}) };
  next.unlockedViews = { ...DEFAULT_STATE.unlockedViews, ...(candidate?.unlockedViews || {}) };
  for (const key of ["openedViews", "readEvidence", "unlockedArtifacts", "solvedPuzzles", "handledEvents", "terminalHistory", "searchQueries", "chat", "faybleCitationAttempts", "objectiveFragments", "virtualFiles", "trashItems", "browserTabs", "browserHistory", "browserBookmarks", "discoveredRoutes", "desktopArtifacts", "caseNotes", "contentDiscoveries", "contentReads", "contentMutations", "generatedContentRecords", "installedPackages", "packageChecks", "proxyProfiles", "proxyProbeLog", "cliSessions", "relayKeyAttempts", "desktopNotifications"]) {
    next[key] = Array.isArray(next[key]) ? next[key] : clone(DEFAULT_STATE[key]);
  }
  next.modelStages = next.modelStages && typeof next.modelStages === "object" ? next.modelStages : {};
  next.windowState = next.windowState && typeof next.windowState === "object" ? next.windowState : {};
  next.sourceVisits = next.sourceVisits && typeof next.sourceVisits === "object" ? next.sourceVisits : {};
  next.revisitFlags = next.revisitFlags && typeof next.revisitFlags === "object" ? next.revisitFlags : {};
  next.inviteSources = next.inviteSources && typeof next.inviteSources === "object" ? next.inviteSources : {};
  next.storyClock = next.storyClock && typeof next.storyClock === "object" ? next.storyClock : clone(DEFAULT_STATE.storyClock);
  next.storyClock.completed = next.storyClock.completed && typeof next.storyClock.completed === "object" ? next.storyClock.completed : clone(DEFAULT_STATE.storyClock.completed);
  next.proxyProfiles = Array.isArray(next.proxyProfiles) ? next.proxyProfiles : [];
  next.activeFilePlace = ["recent", "home", "downloads", "documents", "trash"].includes(next.activeFilePlace) ? next.activeFilePlace : "home";
  next.activeProxyProfile = typeof next.activeProxyProfile === "string" ? next.activeProxyProfile : null;
  next.proxyStatus = ["offline", "probed", "verified"].includes(next.proxyStatus) ? next.proxyStatus : "offline";
  next.relayKeyVerified = Boolean(next.relayKeyVerified);
  next.npcTrustGranted = Boolean(next.npcTrustGranted);
  next.npcTrustAt = typeof next.npcTrustAt === "number" ? next.npcTrustAt : null;
  next.selectedCheckpoint = typeof next.selectedCheckpoint === "string" ? next.selectedCheckpoint : "";
  next.checkpointHandshakeComplete = Boolean(next.checkpointHandshakeComplete);
  next.takeoverStage = typeof next.takeoverStage === "string" ? next.takeoverStage : "idle";
  next.hintLevel = ["investigation", "immersive", "plot"].includes(next.hintLevel) ? next.hintLevel : "investigation";
  next.journalMode = next.journalMode || next.hintLevel;
  next.version = 3;
  return next;
}

function migrateLegacyState(candidate, key) {
  const migrated = clone(DEFAULT_STATE);
  migrated.hintLevel = ["investigation", "immersive", "plot"].includes(candidate?.hintLevel) ? candidate.hintLevel : "investigation";
  migrated.journalMode = migrated.hintLevel;
  migrated.migratedFrom = key;
  return migrated;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
    for (const key of LEGACY_STORAGE_KEYS) {
      const legacyRaw = localStorage.getItem(key);
      if (!legacyRaw) continue;
      const migrated = migrateLegacyState(JSON.parse(legacyRaw), key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(key);
      return migrated;
    }
    return clone(DEFAULT_STATE);
  } catch (error) {
    try {
      localStorage.setItem(STORAGE_KEY + "-corrupt-" + Date.now(), localStorage.getItem(STORAGE_KEY) || "");
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      // Storage may be unavailable; the in-memory state still works.
    }
    return clone(DEFAULT_STATE);
  }
}

export class GameStore {
  constructor() {
    this.state = load();
    this.listeners = new Set();
    this.channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
    this.channel?.addEventListener("message", event => this.receive(event.data));
    window.addEventListener("storage", event => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try { this.receive(JSON.parse(event.newValue)); } catch (_) { /* ignore malformed external state */ }
      }
    });
  }

  get() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(mutator, options = {}) {
    const draft = clone(this.state);
    mutator(draft);
    draft.lastUpdated = Date.now();
    this.state = normalize(draft);
    this.persist(options.broadcast !== false);
    this.emit();
    return this.state;
  }

  handleEvent(eventId, mutator) {
    if (this.state.handledEvents.includes(eventId)) return false;
    this.update(draft => {
      draft.handledEvents.push(eventId);
      mutator(draft);
    });
    return true;
  }

  reset() {
    this.state = clone(DEFAULT_STATE);
    this.state.lastUpdated = Date.now();
    purgeLocalData();
    this.channel?.postMessage(this.state);
    this.emit();
  }

  purge() {
    const removed = purgeLocalData();
    this.state = clone(DEFAULT_STATE);
    this.state.lastUpdated = Date.now();
    this.channel?.postMessage(this.state);
    this.emit();
    return removed;
  }

  addEvidence(id, mutator) {
    return this.handleEvent("evidence:" + id, draft => {
      draft.readEvidence.push(id);
      mutator?.(draft);
    });
  }

  persist(broadcast = true) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch (_) { /* in-memory fallback */ }
    if (broadcast) this.channel?.postMessage(this.state);
  }

  receive(candidate) {
    const incoming = normalize(candidate);
    if ((incoming.lastUpdated || 0) <= (this.state.lastUpdated || 0)) return;
    this.state = incoming;
    this.emit();
  }

  emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  destroy() {
    this.channel?.close();
    this.listeners.clear();
  }
}

