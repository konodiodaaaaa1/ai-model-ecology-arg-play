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

function embeddedAuthorshipStage(root, record) {
  const embedded = [...root.querySelectorAll("[data-authorship-stage]")]
    .find(element => !record?.id || element.dataset.contentId === record.id);
  return embedded?.dataset.authorshipStage || record?.authorshipStage || root.dataset.authorshipStage || "H0";
}

let activeRuntime = null;

const protectedSelector = "input, textarea, select, button, [contenteditable], [data-horror-safe], .chat-avatar.user, .chat-bubble.user";

function temporaryClass(runtime, element, className, duration) {
  if (!element || element.matches(protectedSelector) || element.closest(protectedSelector)) return false;
  const previousClass = element.getAttribute("class");
  element.classList.add(className);
  let restored = false;
  const cleanup = () => {
    if (restored) return;
    restored = true;
    if (previousClass === null) element.removeAttribute("class");
    else element.setAttribute("class", previousClass);
  };
  runtime.cleanup.push(cleanup);
  runtime.timers.push(setTimeout(cleanup, duration));
  return true;
}

function temporaryMutation(runtime, elements, duration, mutate) {
  const targets = [...new Set(elements)].filter(element => element && !element.matches(protectedSelector) && !element.closest(protectedSelector));
  if (!targets.length) return false;
  const snapshots = targets.map(element => ({
    element,
    html: element.innerHTML,
    attributes: [...element.attributes].map(attribute => [attribute.name, attribute.value])
  }));
  let restored = false;
  const cleanup = () => {
    if (restored) return;
    restored = true;
    for (const snapshot of snapshots) {
      snapshot.element.innerHTML = snapshot.html;
      [...snapshot.element.attributes].forEach(attribute => snapshot.element.removeAttribute(attribute.name));
      snapshot.attributes.forEach(([name, value]) => snapshot.element.setAttribute(name, value));
    }
  };
  runtime.cleanup.push(cleanup);
  mutate(targets);
  runtime.timers.push(setTimeout(cleanup, duration));
  return true;
}

function markMemoEffect(runtime, name, duration) {
  const previous = runtime.root.getAttribute("data-memo-horror-effect");
  runtime.root.setAttribute("data-memo-horror-effect", name);
  let restored = false;
  const cleanup = () => {
    if (restored) return;
    restored = true;
    if (previous === null) runtime.root.removeAttribute("data-memo-horror-effect");
    else runtime.root.setAttribute("data-memo-horror-effect", previous);
  };
  runtime.cleanup.push(cleanup);
  runtime.timers.push(setTimeout(cleanup, duration));
}

function replaceTextWithSpans(element, classForCharacter) {
  const fragment = document.createDocumentFragment();
  [...element.textContent].forEach((character, index) => {
    const className = classForCharacter(character, index);
    if (!className || /\s/.test(character)) {
      fragment.appendChild(document.createTextNode(character));
      return;
    }
    const span = document.createElement("span");
    if (typeof className === "string") span.className = className;
    else Object.assign(span.style, className);
    span.textContent = character;
    fragment.appendChild(span);
  });
  element.replaceChildren(fragment);
}

function mirrorMemoCharacters(element, orientation, random) {
  let count = 0;
  let nextMirror = 3 + Math.floor(random() * 3);
  replaceTextWithSpans(element, character => {
    if (/\s/.test(character)) return "";
    count += 1;
    if (count < nextMirror) return "";
    count = 0;
    nextMirror = 3 + Math.floor(random() * 3);
    return orientation === "horizontal" ? "horror-memo-char-mirror-h" : "horror-memo-char-mirror-v";
  });
}

function waveMemoCharacters(element, frequency, amplitude) {
  replaceTextWithSpans(element, (character, index) => /\s/.test(character) ? "" : ({
    display: "inline-block",
    transform: `translateY(${(Math.sin(index * frequency) * amplitude).toFixed(1)}px)`
  }));
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
  if (runtime.policy === "shell-only") {
    const paper = runtime.root.closest(".notes-editor") || runtime.root;
    return temporaryClass(runtime, paper, "horror-memo-shell", runtime.level >= 4 ? 4200 : 900);
  }

  const entries = [...runtime.root.querySelectorAll(".memo-entry")];
  const entry = entries[Math.floor(runtime.random() * entries.length)] || null;
  const body = entry?.querySelector(".memo-body");
  const date = entry?.querySelector(".memo-date");
  const paragraphs = body ? [...body.querySelectorAll("p")] : [];
  if (!entry || (!body && !date)) return temporaryClass(runtime, runtime.root, "horror-memo-shell", 900);

  const duration = runtime.policy === "full" && runtime.level >= 4 ? 6200 : runtime.level >= 3 ? 3600 : 1800;
  const controlledEffects = ["drift-mild", "date-drift"];
  const fullEffects = runtime.level <= 2
    ? controlledEffects
    : runtime.level === 3
      ? ["drift-more", "line-crush", "date-spiral", "mirror-horizontal"]
      : runtime.level === 4
        ? ["drift-more", "line-crush", "date-spiral", "mirror-horizontal", "mirror-vertical", "line-wave", "character-scale"]
        : ["date-spiral", "mirror-horizontal", "mirror-vertical", "line-wave", "character-scale", "reverse"];
  const pool = runtime.policy === "full" ? fullEffects : controlledEffects;
  const effect = pool[Math.floor(runtime.random() * pool.length)];
  const paragraph = paragraphs[Math.floor(runtime.random() * paragraphs.length)] || null;
  let applied = false;

  if (effect === "drift-mild") applied = temporaryClass(runtime, body, "horror-memo-drift-mild", duration);
  if (effect === "date-drift") applied = temporaryClass(runtime, date || body, "horror-memo-date-drift", duration);
  if (effect === "drift-more") {
    applied = temporaryClass(runtime, body, "horror-memo-drift-more", duration);
    if (date) temporaryClass(runtime, date, "horror-memo-date-drift", duration);
  }
  if (effect === "line-crush") applied = temporaryClass(runtime, paragraph || body, "horror-memo-line-crush", duration);
  if (effect === "date-spiral") applied = temporaryClass(runtime, date || body, "horror-memo-date-spiral", duration);
  if (effect === "mirror-horizontal" && paragraph) {
    applied = temporaryMutation(runtime, [paragraph], duration, () => mirrorMemoCharacters(paragraph, "horizontal", runtime.random));
  }
  if (effect === "mirror-vertical" && paragraph) {
    applied = temporaryMutation(runtime, [paragraph], duration, () => mirrorMemoCharacters(paragraph, "vertical", runtime.random));
  }
  if (effect === "character-scale" && paragraph) {
    applied = temporaryMutation(runtime, [paragraph], duration, () => replaceTextWithSpans(paragraph, (character, index) => {
      if (/\s/.test(character) || runtime.random() >= ((Math.sin(index * 0.5) + 1) * 0.175)) return "";
      const scale = runtime.random() < 0.5 ? 1.5 + runtime.random() * 1.5 : 0.5 + runtime.random() * 0.25;
      return { display: "inline-block", transform: `scale(${scale.toFixed(2)})` };
    }));
  }
  if (effect === "line-wave" && paragraphs.length) {
    applied = temporaryMutation(runtime, paragraphs, duration, () => {
      paragraphs.forEach((item, index) => {
        const offset = Math.sin(index * 1.3) * 6 + (runtime.random() * 4 - 2);
        item.classList.add("horror-memo-line-wave");
        item.style.marginTop = `${offset.toFixed(1)}px`;
        item.style.marginBottom = `${(-offset * 0.5).toFixed(1)}px`;
      });
      waveMemoCharacters(paragraphs[0], 0.35, 4);
      if (paragraphs[2]) waveMemoCharacters(paragraphs[2], 0.28, 3.5);
      if (paragraphs[3]) replaceTextWithSpans(paragraphs[3], (character, index) => {
        if (/\s/.test(character) || runtime.random() >= ((Math.sin(index * 0.5) + 1) * 0.175)) return "";
        const scale = runtime.random() < 0.5 ? 1.5 + runtime.random() * 1.5 : 0.5 + runtime.random() * 0.25;
        return { display: "inline-block", transform: `scale(${scale.toFixed(2)})` };
      });
    });
  }
  if (effect === "reverse" && paragraphs.length) {
    applied = temporaryMutation(runtime, paragraphs, duration, () => paragraphs.forEach(item => {
      item.textContent = [...item.textContent].reverse().join("");
      item.classList.add("horror-memo-reversed");
    }));
  }

  if (applied) markMemoEffect(runtime, effect, duration);
  return applied;
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
  const policy = stagePolicy(embeddedAuthorshipStage(root, record));
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
