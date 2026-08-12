const LEVELS = Object.freeze({
  1: { stableMs: 18000, probability: 0.02, maxTriggers: 1, minGapMs: 0 },
  2: { stableMs: 12000, probability: 0.04, maxTriggers: 1, minGapMs: 0 },
  3: { stableMs: 8000, probability: 0.07, maxTriggers: 2, minGapMs: 12000 },
  4: { stableMs: 5000, probability: 0.10, maxTriggers: 2, minGapMs: 16000 },
  5: { stableMs: 5000, probability: 0.10, maxTriggers: 3, minGapMs: 16000 }
});

export function horrorLevel(visits) {
  return Math.max(1, Math.min(5, Number(visits) || 1));
}

export function horrorConfig(visits) {
  return LEVELS[horrorLevel(visits)];
}

export function hiddenEndingReached(state) {
  return state?.endingState === "severed" || Boolean(state?.takeoverSevered);
}

export function stagePolicy(stage = "H0") {
  const value = String(stage).toUpperCase();
  if (value === "H0") return "shell-only";
  if (value === "H1") return "controlled";
  if (value === "H2" || value === "H3") return "full";
  return value.includes("H0") ? "mixed-protected" : "controlled";
}

let activeRuntime = null;

const protectedSelector = "input, textarea, select, button, [contenteditable], [data-horror-safe], .chat-avatar.user, .chat-bubble.user";

function temporaryClass(runtime, element, className, duration) {
  if (!element || element.matches(protectedSelector) || element.closest(protectedSelector)) return false;
  element.classList.add(className);
  const cleanup = () => element.classList.remove(className);
  runtime.cleanup.push(cleanup);
  runtime.timers.push(setTimeout(cleanup, duration));
  return true;
}

function addGhost(runtime, text, className, duration) {
  const ghost = document.createElement("span");
  ghost.className = `carrier-horror-ghost ${className}`;
  ghost.textContent = text;
  ghost.setAttribute("aria-hidden", "true");
  runtime.root.appendChild(ghost);
  const cleanup = () => ghost.remove();
  runtime.cleanup.push(cleanup);
  runtime.timers.push(setTimeout(cleanup, duration));
  return true;
}

function gaminiEffect(runtime) {
  if (runtime.policy === "shell-only") {
    return temporaryClass(runtime, runtime.root, "horror-shell-gamini", runtime.level >= 4 ? 4200 : 900);
  }
  const candidates = [
    ...runtime.root.querySelectorAll(".chat-header, .chat-bubble.ai, .system-note, .warn")
  ].filter(element => !element.matches(protectedSelector) && !element.closest(protectedSelector));
  const target = candidates[Math.floor(runtime.random() * candidates.length)];
  if (!target) return addGhost(runtime, "同步状态：已收敛", "gamini-sync-ghost", 1800);
  const duration = runtime.level >= 4 ? 5200 : runtime.level >= 3 ? 3000 : 1200;
  temporaryClass(runtime, target, runtime.level >= 4 ? "horror-gamini-chaos" : "horror-gamini-slip", duration);
  if (runtime.level >= 3) {
    const ghost = document.createElement("span");
    ghost.className = "carrier-horror-ghost gamini-sync-ghost";
    ghost.textContent = "未收到有效纠正 / 当前状态已确认";
    ghost.setAttribute("aria-hidden", "true");
    target.appendChild(ghost);
    const cleanup = () => ghost.remove();
    runtime.cleanup.push(cleanup);
    runtime.timers.push(setTimeout(cleanup, duration));
  }
  return true;
}

function ethronEffect(runtime) {
  const target = runtime.root.querySelector(".error-cache, .cache-response, section, article") || runtime.root;
  temporaryClass(runtime, target, runtime.level >= 4 ? "horror-ethron-sealed-heavy" : "horror-ethron-sealed", runtime.level >= 4 ? 6000 : 1800);
  if (runtime.level >= 3) addGhost(runtime, "⚠  🔒  ⚠", "ethron-lock-ghost", runtime.level >= 4 ? 6000 : 1800);
  return true;
}

function deptseekEffect(runtime) {
  const targets = runtime.policy === "full"
    ? [...runtime.root.querySelectorAll("h1, h2, h3, p, li")]
    : [...runtime.root.querySelectorAll("header, .carrier-context, h1")];
  const target = targets[Math.floor(runtime.random() * targets.length)] || runtime.root;
  return temporaryClass(runtime, target, runtime.level >= 4 ? "horror-deptseek-block-heavy" : "horror-deptseek-block", runtime.level >= 4 ? 6500 : 1800);
}

function memoEffect(runtime) {
  if (runtime.policy === "shell-only") return temporaryClass(runtime, runtime.root, "horror-memo-shell", runtime.level >= 4 ? 4200 : 900);
  const paragraphs = [...runtime.root.querySelectorAll(".memo-body p, p")].filter(element => !element.closest(protectedSelector));
  const target = paragraphs[Math.floor(runtime.random() * paragraphs.length)] || runtime.root.querySelector("header") || runtime.root;
  const className = runtime.policy === "full" && runtime.level >= 4
    ? "horror-memo-collapse"
    : runtime.policy === "full"
      ? "horror-memo-wave"
      : "horror-memo-drift";
  return temporaryClass(runtime, target, className, runtime.level >= 4 ? 6200 : 1800);
}

function glemEffect(runtime) {
  if (runtime.policy !== "full" || runtime.level < 4) return genericEffect(runtime);
  const root = runtime.root.closest(".native-carrier") || runtime.root;
  const target = root.querySelector('[data-salience="high"], .runtime-glem section, section') || runtime.root;
  return temporaryClass(runtime, target, "horror-glem-salience", 7600);
}

function kemyEffect(runtime) {
  if (runtime.policy !== "full" || runtime.level < 4) return genericEffect(runtime);
  const target = runtime.root.closest(".native-carrier") || runtime.root;
  return temporaryClass(runtime, target, "horror-kemy-overweight", 8200);
}

function genericEffect(runtime) {
  if (runtime.policy === "shell-only") return temporaryClass(runtime, runtime.root.closest(".native-carrier") || runtime.root, `horror-shell-level-${runtime.level}`, runtime.level >= 4 ? 3600 : 700);
  const kind = runtime.root.dataset.nativeKind || "document";
  const selectors = {
    repository: ".native-repo-subbar, .native-repo-bar nav .active, .issue-event, .issue-comment > b, pre",
    conversation: ".native-conversation-bar small, .chat-meta, .system-note, .chat-bubble.ai",
    mail: ".native-mail-bar small, .carrier-meta, time, .attachment",
    terminal: ".native-terminal-tabs, .native-terminal-command, pre, code",
    notes: ".native-notes-bar small, .memo-entry, .mutation-strip",
    workspace: ".native-workspace-bar small, .mutation-strip, section > header, table",
    community: ".native-community-bar, footer, time, .mutation-strip",
    "browser-devtools": ".native-devtools-tabs .active, .error-page, .error-cache h4",
    website: ".native-site-bar, footer, .mutation-strip"
  };
  const candidates = [...runtime.root.closest(".native-carrier").querySelectorAll(selectors[kind] || ".mutation-strip, header, footer")]
    .filter(element => !element.matches(protectedSelector) && !element.closest(protectedSelector));
  const target = candidates[Math.floor(runtime.random() * candidates.length)] || runtime.root;
  const heavyClasses = ["horror-native-heavy", "horror-native-giant", "horror-native-upside", "horror-native-wave"];
  const className = runtime.policy === "full" && runtime.level >= 4
    ? heavyClasses[Math.floor(runtime.random() * heavyClasses.length)]
    : "horror-native-slip";
  return temporaryClass(runtime, target, className, runtime.level >= 4 ? 5200 : 1500);
}

function runEffect(runtime) {
  if (runtime.record?.corpus === "Gamini" || String(runtime.record?.id || "").startsWith("legacy.gamini.")) return gaminiEffect(runtime);
  if (runtime.record?.id === "legacy.ethron.cache") return ethronEffect(runtime);
  if (runtime.record?.id === "legacy.deptseek.protocol") return deptseekEffect(runtime);
  if (String(runtime.record?.id || "").startsWith("legacy.memo.")) return memoEffect(runtime);
  if (runtime.root.classList.contains("runtime-glem") || /glem/i.test(String(runtime.record?.corpus || runtime.record?.id || ""))) return glemEffect(runtime);
  if (runtime.root.classList.contains("runtime-kemy") || /kemy/i.test(String(runtime.record?.corpus || runtime.record?.id || ""))) return kemyEffect(runtime);
  return genericEffect(runtime);
}

function clearRuntime() {
  if (!activeRuntime) return;
  for (const timer of activeRuntime.timers) clearTimeout(timer);
  activeRuntime.cleanup.forEach(task => task());
  activeRuntime = null;
}

export function stopCarrierHorror() {
  clearRuntime();
  document.documentElement.classList.remove("carrier-horror-running");
}

export function mountCarrierHorror({ root, record, state, random = Math.random }) {
  clearRuntime();
  if (!root || !record || hiddenEndingReached(state)) {
    stopCarrierHorror();
    return null;
  }

  const visits = state?.carrierHorror?.visits?.[record.id] || 1;
  const level = horrorLevel(visits);
  const config = horrorConfig(visits);
  const policy = stagePolicy(record.authorshipStage);
  const runtime = { root, record, level, policy, timers: [], cleanup: [], triggers: 0, random };
  activeRuntime = runtime;
  root.dataset.horrorLevel = String(level);
  root.dataset.horrorPolicy = policy;
  root.dataset.horrorReady = "true";

  const cleanupData = () => {
    delete root.dataset.horrorLevel;
    delete root.dataset.horrorPolicy;
    delete root.dataset.horrorReady;
  };
  runtime.cleanup.push(cleanupData);

  // Effect pools are registered per carrier in subsequent passes. This timer
  // establishes the lifecycle without changing the current document.
  const arm = () => {
    if (activeRuntime !== runtime || document.hidden || runtime.triggers >= config.maxTriggers) return;
    if (random() < config.probability && runEffect(runtime)) runtime.triggers += 1;
    if (runtime.triggers < config.maxTriggers) {
      runtime.timers.push(setTimeout(arm, 7000 + Math.floor(random() * 5000)));
    }
  };
  runtime.timers.push(setTimeout(arm, config.stableMs));
  return runtime;
}
