const STORAGE = {
  profile: "boss.profile.v1",
  activity: "boss.activity.v1",
  planChoice: "boss.plan-choice.v1",
  micro: "boss.micro.v1"
};

const state = {
  base: null,
  profile: null,
  publishedPlan: null,
  projects: [],
  projectMeta: null,
  projectFilter: "all",
  projectsLoading: true,
  plan: null,
  activity: [],
  timerStartedAt: null,
  timerInterval: null,
  planVariant: 0,
  loadedDate: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function dateFromKey(key) {
  return new Date(`${key}T12:00:00Z`);
}

function addDays(key, amount) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return taipeiDateKey(date);
}

function differenceInDays(a, b) {
  return Math.round((dateFromKey(a) - dateFromKey(b)) / 86400000);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showToast("瀏覽器儲存空間目前不可用；請先匯出既有資料或檢查隱私設定。");
    return false;
  }
}

function writeImportedBundle(profile, activity, micro) {
  const entries = [
    [STORAGE.profile, JSON.stringify(profile)],
    [STORAGE.activity, JSON.stringify(activity)],
    [STORAGE.micro, JSON.stringify(micro)]
  ];
  const before = new Map();
  try {
    entries.forEach(([key]) => before.set(key, localStorage.getItem(key)));
    entries.forEach(([key, value]) => localStorage.setItem(key, value));
    return true;
  } catch {
    for (const [key, value] of before.entries()) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // The original data remains best-effort when storage itself is unavailable.
      }
    }
    return false;
  }
}

const EXPECTED_SKILL_IDS = ["music", "art", "code", "language", "network"];

function isValidProfile(data) {
  if (!data || !data.profile || !data.recommendation) return false;
  const dailyMinutes = Number(data.profile.dailyMinutes);
  if (![30, 45, 60, 90].includes(dailyMinutes)) return false;
  if (![3, 5, 7].includes(Number(data.profile.weeklyOutputTarget))) return false;
  if (!Array.isArray(data.skills) || data.skills.length !== EXPECTED_SKILL_IDS.length) return false;
  const ids = data.skills.map((skill) => skill.id);
  if (new Set(ids).size !== EXPECTED_SKILL_IDS.length || EXPECTED_SKILL_IDS.some((id) => !ids.includes(id))) return false;
  if (!Array.isArray(data.crossSkillOutputs) || !Array.isArray(data.networkActions) || data.networkActions.length === 0) return false;
  if (!Number.isInteger(Number(data.recommendation.maxCrossSkillPerWeek)) || typeof data.recommendation.allowCrossSkill !== "boolean") return false;

  const validTask = (task) => task && typeof task.title === "string" && task.title.trim() && task.title.length <= 120 && typeof task.detail === "string" && task.detail.trim() && task.detail.length <= 400;
  const validOutput = (output) => output &&
    typeof output.title === "string" && output.title.trim() && output.title.length <= 120 &&
    typeof output.brief === "string" && output.brief.trim() && output.brief.length <= 400 &&
    typeof output.doneWhen === "string" && output.doneWhen.trim() && output.doneWhen.length <= 400 &&
    Number(output.difficulty) >= 1 && Number(output.difficulty) <= 5 &&
    Number(output.minMinutes) >= 10 && Number(output.minMinutes) <= 90 &&
    Number.isInteger(Number(output.directionIndex));

  if (!data.skills.every((skill) =>
    typeof skill.name === "string" && skill.name.trim() &&
    /^#[0-9a-f]{6}$/i.test(skill.color) &&
    Number(skill.currentLevel) >= 1 && Number(skill.currentLevel) <= 5 &&
    Number(skill.targetLevel) >= 1 && Number(skill.targetLevel) <= 5 &&
    Number(skill.priority) >= 1 && Number(skill.priority) <= 5 &&
    typeof skill.calibrated === "boolean" &&
    typeof skill.currentGoal === "string" && skill.currentGoal.trim() && skill.currentGoal.length <= 160 &&
    Array.isArray(skill.directions) && skill.directions.length > 0 && skill.directions.every((item) => typeof item === "string" && item.trim() && item.length <= 160) &&
    Array.isArray(skill.strengths) && skill.strengths.length <= 12 && skill.strengths.every((item) => typeof item === "string" && item.length <= 80) &&
    Array.isArray(skill.practicePool) && skill.practicePool.length > 0 && skill.practicePool.every(validTask) &&
    Array.isArray(skill.outputPool) && skill.outputPool.length > 0 && skill.outputPool.every(validOutput) &&
    skill.outputPool.every((output) => Number(output.directionIndex) < skill.directions.length) &&
    skill.outputPool.some((output) => Number(output.minMinutes) <= dailyMinutes - Math.min(10, Math.max(6, Math.round(dailyMinutes * .18))) - (skill.id === "network" ? 0 : 5))
  )) return false;

  if (!data.crossSkillOutputs.every((output) => {
    const primary = data.skills.find((skill) => skill.id === output.primary);
    return validOutput(output) && primary && ids.includes(output.secondary) && output.primary !== output.secondary && Number(output.directionIndex) < primary.directions.length;
  })) return false;
  return data.networkActions.every(validTask);
}

function sanitizeActivity(items, strict = false) {
  if (!Array.isArray(items)) return strict ? null : [];
  const cleaned = [];
  for (const item of items) {
    const skillIds = Array.isArray(item?.skillIds) ? [...new Set(item.skillIds)] : [];
    const valid = item && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && !Number.isNaN(Date.parse(`${item.date}T12:00:00Z`)) &&
      typeof item.name === "string" && item.name.trim().length >= 1 && item.name.trim().length <= 80 &&
      Number(item.minutes) >= 1 && Number(item.minutes) <= 600 &&
      Number(item.difficulty) >= 1 && Number(item.difficulty) <= 5 &&
      skillIds.length >= 1 && skillIds.length <= 2 && skillIds.every((id) => EXPECTED_SKILL_IDS.includes(id)) &&
      typeof (item.note || "") === "string" && (item.note || "").length <= 240 &&
      typeof (item.url || "") === "string" && (item.url || "").length <= 2048 && (!(item.url || "") || /^https?:\/\//i.test(item.url));
    if (!valid) {
      if (strict) return null;
      continue;
    }
    cleaned.push({
      id: String(item.id || `${item.date}-${stableHash(item.name)}`),
      date: item.date,
      createdAt: typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : `${item.date}T12:00:00Z`,
      completed: true,
      name: item.name.trim(),
      minutes: Number(item.minutes),
      difficulty: Number(item.difficulty),
      url: (item.url || "").trim(),
      note: (item.note || "").trim(),
      skillIds
    });
  }
  return cleaned;
}

function sanitizeMicro(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(Date.parse(`${key}T12:00:00Z`)) && item && typeof item === "object")
    .map(([key, item]) => [key, { maintain: Boolean(item.maintain), network: Boolean(item.network) }]));
}

function isSafeProjectUrl(value, repository = false) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (!repository) return true;
    return url.hostname === "github.com" && url.pathname.startsWith("/xieyaozhong/");
  } catch {
    return false;
  }
}

function isValidProjects(data) {
  if (!data || data.schemaVersion !== 1 || data.owner !== "xieyaozhong") return false;
  if (!Array.isArray(data.projects) || !Array.isArray(data.categories)) return false;
  if (!Number.isInteger(data.total) || data.total !== data.projects.length) return false;
  if (!Number.isInteger(data.featuredCount) || data.featuredCount < 0 || !Number.isInteger(data.pendingCount) || data.pendingCount < 0) return false;
  if (!data.categories.every((category) => category && typeof category.id === "string" && typeof category.label === "string" && Number.isInteger(category.count) && category.count > 0)) return false;
  const categoryIds = new Set(data.categories.map((category) => category.id));
  if (categoryIds.size !== data.categories.length) return false;
  return data.projects.every((project) => project &&
    typeof project.slug === "string" && project.slug.length > 0 && project.slug.length <= 100 &&
    typeof project.title === "string" && project.title.trim() && project.title.length <= 120 &&
    typeof project.purpose === "string" && project.purpose.trim() && project.purpose.length <= 180 &&
    typeof project.icon === "string" && project.icon.trim() && project.icon.length <= 3 &&
    /^#[0-9a-f]{6}$/i.test(project.accent) &&
    categoryIds.has(project.category) &&
    typeof project.categoryLabel === "string" && project.categoryLabel.trim() &&
    isSafeProjectUrl(project.repoUrl, true) &&
    (!project.liveUrl || isSafeProjectUrl(project.liveUrl)) &&
    typeof project.archived === "boolean" &&
    typeof project.template === "boolean" &&
    typeof project.featured === "boolean"
  );
}

async function loadProjectsData() {
  try {
    const response = await fetch("./data/github-projects.json", { cache: "no-store" });
    if (!response.ok) return;
    const projects = await response.json();
    if (!isValidProjects(projects)) return;
    state.projects = projects.projects;
    state.projectMeta = projects;
  } catch {
    state.projects = [];
    state.projectMeta = null;
  } finally {
    state.projectsLoading = false;
  }
}

async function loadData() {
  const [profileResponse, planResponse] = await Promise.all([
    fetch("./data/profile.json", { cache: "no-store" }),
    fetch("./data/today.json", { cache: "no-store" }).catch(() => null)
  ]);

  if (!profileResponse.ok) throw new Error("無法讀取能力設定");
  state.base = await profileResponse.json();
  const storedProfile = readStorage(STORAGE.profile, null);
  state.profile = isValidProfile(storedProfile) ? storedProfile : clone(state.base);
  const storedActivity = readStorage(STORAGE.activity, []);
  state.activity = sanitizeActivity(storedActivity);

  if (planResponse?.ok) {
    state.publishedPlan = await planResponse.json();
  }

  const choice = readStorage(STORAGE.planChoice, {});
  state.planVariant = choice.date === taipeiDateKey() ? Number(choice.variant || 0) : 0;
  choosePlan();
}

function skillById(id) {
  return state.profile.skills.find((skill) => skill.id === id);
}

function recentSkillStats(skillId) {
  const today = taipeiDateKey();
  const records = state.activity.filter((item) => item.skillIds?.includes(skillId));
  const recent = records.filter((item) => differenceInDays(today, item.date) <= 7);
  const last = [...records].sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    recentMinutes: recent.reduce((sum, item) => sum + Number(item.minutes || 0), 0),
    daysSince: last ? Math.max(0, differenceInDays(today, last.date)) : 14,
    recentCount: recent.length,
    averageDifficulty: recent.length ? recent.reduce((sum, item) => sum + Number(item.difficulty || 3), 0) / recent.length : null
  };
}

function desiredDifficulty(skill, stats) {
  let desired = skill.calibrated ? Math.round((Number(skill.currentLevel) + Number(skill.targetLevel)) / 2) : 2;
  if (stats.averageDifficulty >= 4.25) desired -= 1;
  if (stats.averageDifficulty !== null && stats.averageDifficulty <= 2.25) desired += 1;
  return Math.max(1, Math.min(5, desired));
}

function chooseFittingOutput(items, focusMinutes, desired, salt) {
  const fitting = items.filter((item) => Number(item.minMinutes) <= focusMinutes);
  const pool = fitting.length ? fitting : [...items].sort((a, b) => Number(a.minMinutes) - Number(b.minMinutes)).slice(0, 1);
  const closestDistance = Math.min(...pool.map((item) => Math.abs(Number(item.difficulty) - desired)));
  const closest = pool.filter((item) => Math.abs(Number(item.difficulty) - desired) === closestDistance);
  return closest[stableHash(salt) % closest.length];
}

function choosePlan() {
  const today = taipeiDateKey();
  const hasLocalProfile = isValidProfile(readStorage(STORAGE.profile, null));
  const canUsePublished = state.publishedPlan?.date === today && !hasLocalProfile && state.activity.length === 0 && state.planVariant === 0;
  state.plan = canUsePublished ? state.publishedPlan : generateLocalPlan(state.planVariant);
}

function generateLocalPlan(variant = 0) {
  const today = taipeiDateKey();
  const seed = stableHash(`${today}:${variant}`);
  const dayNumber = Math.floor(dateFromKey(today).getTime() / 86400000);
  const skills = state.profile.skills.map((skill, index) => {
    const stats = recentSkillStats(skill.id);
    const gap = skill.calibrated ? Math.max(0, Number(skill.targetLevel) - Number(skill.currentLevel)) / 4 : .5;
    const priority = skill.calibrated ? Number(skill.priority || 3) / 5 : .6;
    const staleness = Math.min(stats.daysSince, 14) / 14;
    const balance = 1 - Math.min(stats.recentMinutes, 120) / 120;
    const rotationSlot = (dayNumber + variant) % state.profile.skills.length;
    const rotationDistance = (index - rotationSlot + state.profile.skills.length) % state.profile.skills.length;
    const rotation = rotationDistance === 0 ? 1 : (rotationDistance === 1 ? .35 : 0);
    const recentPenalty = stats.recentCount >= 2 ? 0.18 : 0;
    return { skill, score: gap * .25 + priority * .20 + staleness * .20 + balance * .15 + rotation * .20 - recentPenalty };
  }).sort((a, b) => b.score - a.score);

  const primary = skills[0].skill;
  const primaryStats = recentSkillStats(primary.id);
  const dailyMinutes = Number(state.profile.profile.dailyMinutes || 45);
  const maintainMinutes = Math.min(10, Math.max(6, Math.round(dailyMinutes * .18)));
  const desired = desiredDifficulty(primary, primaryStats);
  const dayOfWeek = dateFromKey(today).getUTCDay();
  const crossCount = thisWeekActivity().filter((item) => item.skillIds?.length > 1).length;
  const crossCandidates = state.profile.crossSkillOutputs.filter((item) => {
    if (item.primary !== primary.id) return false;
    const extraNetworkMinutes = item.secondary === "network" ? 0 : 5;
    return Number(item.minMinutes) <= dailyMinutes - maintainMinutes - extraNetworkMinutes;
  });
  const useCross = state.profile.recommendation.allowCrossSkill &&
    primary.id !== "network" &&
    crossCandidates.length > 0 &&
    [2, 5].includes(dayOfWeek) &&
    crossCount < Number(state.profile.recommendation.maxCrossSkillPerWeek);
  const provisionalNetworkMinutes = primary.id === "network" ? 0 : 5;
  const provisionalFocusMinutes = dailyMinutes - maintainMinutes - provisionalNetworkMinutes;
  const output = useCross
    ? chooseFittingOutput(crossCandidates, dailyMinutes - maintainMinutes, desired, `${today}:cross:${primary.id}:${variant}`)
    : chooseFittingOutput(primary.outputPool, provisionalFocusMinutes, desired, `${today}:${primary.id}:output:${variant}`);
  const secondary = useCross ? skillById(output.secondary) : null;
  const networkMinutes = primary.id === "network" || secondary?.id === "network" ? 0 : 5;
  const focusMinutes = dailyMinutes - maintainMinutes - networkMinutes;
  const stepMinutes = splitMinutes(focusMinutes);
  const excluded = new Set([primary.id, secondary?.id].filter(Boolean));
  const maintain = skills.find((entry) => !excluded.has(entry.skill.id) && (primary.id === "network" || entry.skill.id !== "network"))?.skill || skills.find((entry) => !excluded.has(entry.skill.id)).skill;
  const practice = maintain.practicePool[stableHash(`${today}:${maintain.id}`) % maintain.practicePool.length];
  const network = state.profile.networkActions[stableHash(`${today}:network`) % state.profile.networkActions.length];
  const lowConfidence = !primary.calibrated;
  const direction = primary.directions[Number(output.directionIndex) % primary.directions.length];
  const strengthLead = primary.strengths?.length ? `以你已會的「${primary.strengths.slice(0, 2).join("、")}」為起點，` : "";

  return {
    date: today,
    effectiveAt: `${today}T06:17:00+08:00`,
    timezone: "Asia/Taipei",
    engine: "adaptive-browser-v1",
    dailyBudgetMinutes: dailyMinutes,
    focus: {
      skillId: primary.id,
      secondarySkillId: secondary?.id || null,
      tags: [...(secondary ? [primary.name, secondary.name] : [primary.name]), `精進｜${direction}`],
      direction,
      difficulty: Number(output.difficulty),
      minMinutes: Number(output.minMinutes),
      title: output.title,
      why: lowConfidence
        ? `先用一個難度 ${output.difficulty}/5、可完成的${primary.name}產出建立基準；校準程度後再依紀錄調整。`
        : `${strengthLead}今天聚焦「${direction}」，並朝「${primary.currentGoal}」留下一個難度 ${output.difficulty}/5 的證據。`,
      totalMinutes: focusMinutes,
      steps: [
        { minutes: stepMinutes[0], title: "界定範圍", detail: `把完成條件放在眼前，只準備這次會用到的素材與工具。` },
        { minutes: stepMinutes[1], title: "做出主體", detail: output.brief },
        { minutes: stepMinutes[2], title: "收尾與保存", detail: "停止增加功能或細節；檢查完成條件，命名、匯出並留下一張證據。" }
      ],
      deliverable: { title: output.title, doneWhen: output.doneWhen }
    },
    maintain: {
      skillId: maintain.id,
      skillName: maintain.name,
      minutes: maintainMinutes,
      title: practice.title,
      detail: practice.detail
    },
    network: networkMinutes === 0
      ? { minutes: 0, title: "今天主線已包含人脈行動", detail: "完成主線即可，不另外增加聯繫壓力。" }
      : { minutes: networkMinutes, ...network }
  };
}

function splitMinutes(total) {
  const scope = Math.max(4, Math.round(total * .2));
  const finish = Math.max(5, Math.round(total * .25));
  return [scope, total - scope - finish, finish];
}

function renderAll() {
  renderDateAndStats();
  renderPlan();
  renderSkills();
  renderProjects();
  renderProfileForm();
  renderWeek();
  renderOutputs();
  restoreMicroChecks();
  window.__BOSS_READY__ = true;
}

function renderDateAndStats() {
  const today = dateFromKey(taipeiDateKey());
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "long" }).format(today).toUpperCase();
  const month = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "short", year: "numeric" }).format(today).toUpperCase();
  $("#weekday-label").textContent = weekday;
  $("#date-number").textContent = String(today.getUTCDate()).padStart(2, "0");
  $("#month-label").textContent = month;
  $("#daily-budget").textContent = `${state.profile.profile.dailyMinutes} min`;
  $("#streak-count").textContent = `${calculateStreak()} days`;
  $("#week-output-count").textContent = `${thisWeekActivity().length} / ${state.profile.profile.weeklyOutputTarget}`;
}

function renderPlan() {
  const { focus, maintain, network } = state.plan;
  $("#focus-index").textContent = String((state.planVariant % 9) + 1).padStart(2, "0");
  $("#focus-duration").textContent = `${focus.totalMinutes} 分鐘`;
  $("#focus-title").textContent = focus.title;
  $("#focus-reason").textContent = focus.why;
  $("#deliverable-title").textContent = focus.deliverable.title;
  $("#deliverable-done").textContent = focus.deliverable.doneWhen;
  $("#maintain-skill").textContent = `${maintain.skillName} · ${maintain.minutes} MIN`;
  $("#maintain-title").textContent = maintain.title;
  $("#maintain-copy").textContent = maintain.detail;
  $("#network-title").textContent = network.title;
  $("#network-copy").textContent = network.detail;
  $("#network-label").textContent = network.minutes ? `ONE HUMAN STEP · ${network.minutes} MIN` : "ONE HUMAN STEP · INCLUDED";

  const tags = $("#focus-tags");
  tags.replaceChildren(...focus.tags.map((tag) => make("span", "", tag)));

  const steps = focus.steps.map((step, index) => {
    const item = make("li");
    item.append(
      make("span", "", `${String(index + 1).padStart(2, "0")} · ${step.minutes} MIN`),
      make("strong", "", step.title),
      make("p", "", step.detail)
    );
    return item;
  });
  $("#task-steps").replaceChildren(...steps);

  const completedToday = state.activity.some((item) => item.date === taipeiDateKey() && item.skillIds?.includes(focus.skillId));
  const completeButton = $("#complete-focus");
  completeButton.textContent = completedToday ? "今天已留下產出 ✓" : "完成並留下證據";
  completeButton.disabled = completedToday;
}

function renderSkills() {
  const cards = state.profile.skills.map((skill, index) => {
    const card = make("article", "skill-card");
    card.style.setProperty("--skill-color", skill.color);
    card.append(make("span", "skill-number", String(index + 1).padStart(2, "0")));
    card.append(make("h3", "", skill.name));
    card.append(make("span", "skill-en", skill.englishName));

    const row = make("div", "level-row");
    row.append(make("span", "", "目前 → 目標"));
    row.append(make("strong", "", skill.calibrated ? `${skill.currentLevel} → ${skill.targetLevel}` : "待校準"));
    card.append(row);
    const track = make("div", "level-track");
    const progress = make("i");
    progress.style.width = skill.calibrated ? `${Math.max(8, skill.currentLevel * 20)}%` : "8%";
    track.append(progress);
    card.append(track);

    const known = make("div", "skill-known");
    known.append(
      make("span", "", "我目前會"),
      make("p", "", skill.strengths?.length ? skill.strengths.join(" · ") : "待補充具體技能")
    );
    card.append(known);

    const goal = make("div", "skill-goal");
    goal.append(make("span", "", "目前方向"), make("p", "", skill.currentGoal));
    card.append(goal);
    const footer = make("div", "skill-footer");
    footer.append(make("span", "", "NEXT MILESTONE"), make("strong", "", skill.nextMilestone));
    card.append(footer);
    if (skill.id === "code") {
      const projectLink = make("a", "skill-project-link", state.projectMeta ? `${state.projects.length} 個 GitHub 作品 →` : "查看 GitHub 作品 →");
      projectLink.href = "#projects";
      card.append(projectLink);
    }
    return card;
  });
  $("#skill-grid").replaceChildren(...cards);
  const calibrated = state.profile.skills.every((skill) => skill.calibrated);
  $("#calibration-note").classList.toggle("hidden", calibrated);
}

function projectDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "日期未標示";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function applyProjectFilter(filter) {
  state.projectFilter = filter;
  let visible = 0;
  $$('[data-project-filter]').forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.projectFilter === filter));
  });
  $$("#project-grid [data-project-category]").forEach((item) => {
    const show = filter === "all" || (filter === "featured" ? item.dataset.projectFeatured === "true" : item.dataset.projectCategory === filter);
    item.hidden = !show;
    if (show) visible += 1;
  });
  const selected = state.projectMeta?.categories.find((category) => category.id === filter);
  const label = filter === "featured" ? "精選作品" : selected?.label || "全部作品";
  const synced = state.projectMeta?.generatedAt ? projectDateLabel(state.projectMeta.generatedAt) : "尚未同步";
  const pending = Number(state.projectMeta?.pendingCount || 0);
  $("#project-summary").textContent = `${label} ${visible} 件 · 共 ${state.projects.length} 件公開作品${pending ? ` · ${pending} 件待校準` : ""} · ${synced} 同步`;
}

function renderProjects() {
  const grid = $("#project-grid");
  const empty = $("#project-empty");
  grid.setAttribute("aria-busy", "true");
  if (state.projectsLoading) {
    grid.replaceChildren();
    empty.classList.add("hidden");
    $("#project-summary").textContent = "正在整理公開作品…";
    return;
  }
  if (!state.projectMeta || state.projects.length === 0) {
    grid.replaceChildren();
    grid.setAttribute("aria-busy", "false");
    empty.classList.remove("hidden");
    $("#project-summary").textContent = "作品資料暫時無法載入";
    return;
  }
  empty.classList.add("hidden");

  const filterData = [
    { id: "all", label: "全部", count: state.projects.length },
    { id: "featured", label: "精選", count: state.projectMeta.featuredCount },
    ...state.projectMeta.categories
  ];
  const filters = filterData.map((category) => {
    const button = make("button", "project-filter", `${category.label} ${category.count}`);
    button.type = "button";
    button.dataset.projectFilter = category.id;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => applyProjectFilter(category.id));
    return button;
  });
  $("#project-filters").replaceChildren(...filters);

  const cards = state.projects.map((project, index) => {
    const item = make("li", "project-list-item");
    item.dataset.projectCategory = project.category;
    item.dataset.projectFeatured = String(project.featured);
    const card = make("article", "project-card");
    card.style.setProperty("--project-accent", project.accent);

    const top = make("div", "project-card-top");
    const icon = make("span", "project-icon", project.icon);
    icon.setAttribute("aria-hidden", "true");
    const badges = make("div", "project-badges");
    badges.append(make("span", "project-category", project.categoryLabel));
    if (project.featured) badges.append(make("span", "project-featured", "精選"));
    if (project.template) badges.append(make("span", "project-template", "範本"));
    if (project.archived) badges.append(make("span", "project-archived", "已封存"));
    top.append(icon, badges);

    const number = make("span", "project-number", String(index + 1).padStart(2, "0"));
    number.setAttribute("aria-hidden", "true");
    const title = make("h3", "", project.title);
    const slug = make("p", "project-slug", `github / ${project.slug}`);
    const purpose = make("p", "project-purpose", project.purpose);
    card.append(top, number, title, slug, purpose);
    if (project.caution) card.append(make("p", "project-caution", `使用限制｜${project.caution}`));

    const meta = make("div", "project-meta");
    meta.append(make("span", "", project.language));
    if (project.stars > 0) meta.append(make("span", "", `★ ${project.stars}`));
    const updated = make("time", "", `更新 ${projectDateLabel(project.updatedAt)}`);
    updated.dateTime = project.updatedAt;
    meta.append(updated);

    const actions = make("div", "project-actions");
    const repository = make("a", "project-link", "查看程式碼 ↗");
    repository.href = project.repoUrl;
    repository.target = "_blank";
    repository.rel = "noreferrer";
    repository.setAttribute("aria-label", `查看 ${project.title} 的程式碼，新分頁開啟`);
    if (project.liveUrl) {
      const live = make("a", "project-link project-live-link", "開啟作品 ↗");
      live.href = project.liveUrl;
      live.target = "_blank";
      live.rel = "noreferrer";
      live.setAttribute("aria-label", `開啟 ${project.title}，新分頁開啟`);
      actions.append(live);
    }
    actions.append(repository);
    card.append(meta, actions);
    item.append(card);
    return item;
  });
  grid.replaceChildren(...cards);
  if (!filterData.some((category) => category.id === state.projectFilter)) state.projectFilter = "all";
  applyProjectFilter(state.projectFilter);
  grid.setAttribute("aria-busy", "false");
}

function renderProfileForm() {
  $("#daily-minutes").value = String(state.profile.profile.dailyMinutes);
  $("#weekly-target").value = String(state.profile.profile.weeklyOutputTarget);
  const rows = state.profile.skills.map((skill) => {
    const row = make("div", "profile-skill");
    row.dataset.skillId = skill.id;
    const name = make("div", "profile-skill-name");
    const dot = make("i");
    dot.style.setProperty("--skill-color", skill.color);
    name.style.setProperty("--skill-color", skill.color);
    name.append(dot, make("strong", "", skill.name));

    const current = make("label", "range-field");
    current.append(make("span", "", "目前程度"));
    const currentInput = make("input");
    currentInput.type = "range";
    currentInput.min = "1";
    currentInput.max = "5";
    currentInput.value = String(skill.currentLevel);
    currentInput.dataset.field = "currentLevel";
    currentInput.setAttribute("aria-label", `${skill.name}目前程度`);
    currentInput.setAttribute("aria-valuetext", `${currentInput.value} 級`);
    const currentValue = make("span", "range-value", currentInput.value);
    currentInput.addEventListener("input", () => {
      currentValue.textContent = currentInput.value;
      currentInput.setAttribute("aria-valuetext", `${currentInput.value} 級`);
    });
    current.append(currentInput, currentValue);

    const target = make("label", "range-field");
    target.append(make("span", "", "目標程度"));
    const targetInput = make("input");
    targetInput.type = "range";
    targetInput.min = "1";
    targetInput.max = "5";
    targetInput.value = String(skill.targetLevel);
    targetInput.dataset.field = "targetLevel";
    targetInput.setAttribute("aria-label", `${skill.name}目標程度`);
    targetInput.setAttribute("aria-valuetext", `${targetInput.value} 級`);
    const targetValue = make("span", "range-value", targetInput.value);
    targetInput.addEventListener("input", () => {
      targetValue.textContent = targetInput.value;
      targetInput.setAttribute("aria-valuetext", `${targetInput.value} 級`);
    });
    target.append(targetInput, targetValue);

    const details = make("div", "profile-skill-details");
    const strengthsLabel = make("label");
    strengthsLabel.append(make("span", "", "我目前會（用逗號分隔）"));
    const strengthsInput = make("input");
    strengthsInput.type = "text";
    strengthsInput.maxLength = 160;
    strengthsInput.placeholder = skill.id === "network" ? "例：社群經營、活動協作" : "例：輸入你的工具、技法或語言";
    strengthsInput.value = (skill.strengths || []).join("、");
    strengthsInput.dataset.field = "strengths";
    strengthsLabel.append(strengthsInput);
    const goalLabel = make("label");
    goalLabel.append(make("span", "", "近期想精進"));
    const goalInput = make("input");
    goalInput.type = "text";
    goalInput.maxLength = 160;
    goalInput.value = skill.currentGoal;
    goalInput.dataset.field = "currentGoal";
    goalLabel.append(goalInput);
    details.append(strengthsLabel, goalLabel);
    row.append(name, current, target, details);
    return row;
  });
  $("#profile-skill-list").replaceChildren(...rows);
}

function startOfWeekKey() {
  const today = dateFromKey(taipeiDateKey());
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(taipeiDateKey(), mondayOffset);
}

function thisWeekActivity() {
  const monday = startOfWeekKey();
  return state.activity.filter((item) => item.date >= monday && item.date <= taipeiDateKey());
}

function renderWeek() {
  const monday = startOfWeekKey();
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  const days = labels.map((label, index) => {
    const key = addDays(monday, index);
    const minutes = state.activity
      .filter((item) => item.date === key)
      .reduce((sum, item) => sum + Number(item.minutes || 0), 0);
    return { key, label, minutes };
  });
  const max = Math.max(60, ...days.map((day) => day.minutes));
  const nodes = days.map((day) => {
    const wrapper = make("div", `day-bar${day.key === taipeiDateKey() ? " today" : ""}`);
    wrapper.setAttribute("aria-label", `週${day.label}投入 ${day.minutes} 分鐘`);
    const bar = make("i");
    bar.style.height = `${Math.max(day.minutes ? 8 : 3, (day.minutes / max) * 76)}px`;
    bar.title = `${day.minutes} 分鐘`;
    wrapper.append(bar, make("span", "", day.label));
    return wrapper;
  });
  $("#week-bars").replaceChildren(...nodes);
  $("#rhythm-total").textContent = `${days.reduce((sum, day) => sum + day.minutes, 0)}m`;
}

function renderOutputs() {
  const recent = [...state.activity]
    .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date))
    .slice(0, 5);
  $("#empty-output").classList.toggle("hidden", recent.length > 0);
  const items = recent.map((item, index) => {
    const row = make("article", "output-item");
    row.append(make("span", "output-item-index", String(index + 1).padStart(2, "0")));
    const body = make("div");
    const title = make("h4", "", item.name);
    const skillNames = (item.skillIds || []).map((id) => skillById(id)?.name).filter(Boolean).join(" × ");
    body.append(title, make("p", "", `${skillNames || "能力產出"} · ${item.minutes} 分鐘${item.note ? ` · ${item.note}` : ""}`));
    if (item.url && /^https?:\/\//i.test(item.url)) {
      const link = make("a", "", "查看證據 ↗");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.style.fontSize = "11px";
      body.append(link);
    }
    const meta = make("div", "output-item-meta");
    meta.append(make("time", "", item.date));
    const remove = make("button", "output-remove", "刪除");
    remove.type = "button";
    remove.setAttribute("aria-label", `刪除產出紀錄：${item.name}`);
    remove.addEventListener("click", () => deleteActivity(item.id));
    meta.append(remove);
    row.append(body, meta);
    return row;
  });
  $("#output-list").replaceChildren(...items);
}

function deleteActivity(id) {
  if (!window.confirm("要刪除這筆完成紀錄嗎？此動作只影響這台瀏覽器。")) return;
  const previous = state.activity;
  state.activity = state.activity.filter((item) => item.id !== id);
  if (!writeStorage(STORAGE.activity, state.activity)) {
    state.activity = previous;
    return;
  }
  choosePlan();
  renderAll();
  showToast("完成紀錄已刪除。");
}

function calculateStreak() {
  const dates = new Set(state.activity.map((item) => item.date));
  let cursor = taipeiDateKey();
  if (!dates.has(cursor)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function restoreMicroChecks() {
  const data = sanitizeMicro(readStorage(STORAGE.micro, {}));
  const today = taipeiDateKey();
  $("#maintain-check").checked = Boolean(data[today]?.maintain);
  $("#network-check").checked = Boolean(data[today]?.network);
}

function persistMicroCheck(kind, checked) {
  const data = sanitizeMicro(readStorage(STORAGE.micro, {}));
  const today = taipeiDateKey();
  data[today] = { ...(data[today] || {}), [kind]: checked };
  if (writeStorage(STORAGE.micro, data)) {
    showToast(checked ? "已記下這個小步。" : "已取消完成標記。");
  }
}

function openProfile() {
  renderProfileForm();
  $("#profile-dialog").showModal();
}

function saveProfile(event) {
  event.preventDefault();
  state.profile.profile.dailyMinutes = Number($("#daily-minutes").value);
  state.profile.profile.weeklyOutputTarget = Number($("#weekly-target").value);
  $$(".profile-skill", $("#profile-skill-list")).forEach((row) => {
    const skill = skillById(row.dataset.skillId);
    const current = Number($("[data-field='currentLevel']", row).value);
    const target = Math.max(current, Number($("[data-field='targetLevel']", row).value));
    skill.currentLevel = current;
    skill.targetLevel = target;
    skill.strengths = $("[data-field='strengths']", row).value
      .split(/[、,，]/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 12);
    skill.currentGoal = $("[data-field='currentGoal']", row).value.trim() || skill.currentGoal;
    skill.calibrated = true;
  });
  if (!writeStorage(STORAGE.profile, state.profile)) return;
  state.planVariant = 0;
  writeStorage(STORAGE.planChoice, { date: taipeiDateKey(), variant: 0 });
  resetTimer();
  choosePlan();
  renderAll();
  $("#profile-dialog").close();
  showToast("已校準。今天的建議已重新生成。");
}

function rerollPlan() {
  resetTimer();
  state.planVariant += 1;
  writeStorage(STORAGE.planChoice, { date: taipeiDateKey(), variant: state.planVariant });
  state.plan = generateLocalPlan(state.planVariant);
  renderPlan();
  showToast("已換成另一個同樣能在今天完成的任務。");
}

function resetTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerStartedAt = null;
  const timer = $("#focus-timer");
  if (timer) {
    timer.textContent = "00:00";
    timer.classList.remove("running");
  }
  const button = $("#start-focus");
  if (button) button.textContent = "開始專注";
}

function toggleTimer() {
  const button = $("#start-focus");
  const timer = $("#focus-timer");
  if (state.timerStartedAt) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.timerStartedAt = null;
    button.textContent = "繼續專注";
    timer.classList.remove("running");
    return;
  }
  const already = parseTimer(timer.textContent);
  state.timerStartedAt = Date.now() - already * 1000;
  state.timerInterval = setInterval(updateTimer, 1000);
  button.textContent = "暫停計時";
  timer.classList.add("running");
  updateTimer();
}

function parseTimer(value) {
  const parts = value.split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function updateTimer() {
  if (!state.timerStartedAt) return;
  const elapsed = Math.floor((Date.now() - state.timerStartedAt) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  $("#focus-timer").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function openCheckin() {
  $("#checkin-name").value = state.plan.focus.deliverable.title;
  const elapsedSeconds = parseTimer($("#focus-timer").textContent);
  $("#checkin-minutes").value = String(elapsedSeconds ? Math.max(1, Math.round(elapsedSeconds / 60)) : state.plan.focus.totalMinutes);
  $("#checkin-url").value = "";
  $("#checkin-note").value = "";
  $("#checkin-dialog").showModal();
}

function saveCheckin(event) {
  event.preventDefault();
  const url = $("#checkin-url").value.trim();
  if (url && !/^https?:\/\//i.test(url)) {
    showToast("作品連結請使用 http:// 或 https:// 開頭。");
    return;
  }
  const focus = state.plan.focus;
  const skillIds = [focus.skillId, focus.secondarySkillId].filter(Boolean);
  const entry = {
    id: `${taipeiDateKey()}-${Date.now()}`,
    date: taipeiDateKey(),
    createdAt: new Date().toISOString(),
    completed: true,
    name: $("#checkin-name").value.trim(),
    minutes: Number($("#checkin-minutes").value),
    difficulty: Number($("#checkin-difficulty").value),
    url,
    note: $("#checkin-note").value.trim(),
    skillIds
  };
  state.activity.push(entry);
  if (!writeStorage(STORAGE.activity, state.activity)) {
    state.activity.pop();
    return;
  }
  resetTimer();
  $("#checkin-dialog").close();
  renderAll();
  showToast("完成紀錄已保存。明天的建議會參考這次產出。");
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "BOSS",
    version: 1,
    profile: state.profile,
    activity: state.activity,
    micro: sanitizeMicro(readStorage(STORAGE.micro, {}))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `boss-backup-${taipeiDateKey()}.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("備份已下載。它可能含私人反思，請自行妥善保存。");
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error("檔案過大");
    const payload = JSON.parse(await file.text());
    const candidateProfile = clone(payload.profile);
    const candidateActivity = sanitizeActivity(payload.activity, true);
    const candidateMicro = sanitizeMicro(payload.micro || {});
    if (!isValidProfile(candidateProfile) || candidateActivity === null) throw new Error("格式不符");

    const previousProfile = state.profile;
    const previousActivity = state.activity;
    state.profile = candidateProfile;
    state.activity = candidateActivity;
    try {
      generateLocalPlan(0);
    } catch (error) {
      state.profile = previousProfile;
      state.activity = previousActivity;
      throw error;
    }
    if (!writeImportedBundle(candidateProfile, candidateActivity, candidateMicro)) {
      state.profile = previousProfile;
      state.activity = previousActivity;
      throw new Error("儲存失敗");
    }
    resetTimer();
    state.planVariant = 0;
    writeStorage(STORAGE.planChoice, { date: taipeiDateKey(), variant: 0 });
    choosePlan();
    renderAll();
    showToast("備份已匯入。");
  } catch {
    showToast("無法匯入：這不是有效的 BOSS 備份檔。");
  } finally {
    event.target.value = "";
  }
}

function clearLocalData() {
  const confirmed = window.confirm("要清除這個網站保存的能力校準、產出與勾選紀錄嗎？若需要保留，請先匯出備份。");
  if (!confirmed) return;
  try {
    Object.values(STORAGE).forEach((key) => localStorage.removeItem(key));
  } catch {
    showToast("無法清除瀏覽器資料，請檢查瀏覽器的網站資料設定。");
    return;
  }
  resetTimer();
  state.profile = clone(state.base);
  state.activity = [];
  state.planVariant = 0;
  choosePlan();
  renderAll();
  $("#profile-dialog").close();
  showToast("BOSS 的本機資料已清除，公開基準資料不受影響。");
}

function checkDateRollover() {
  if (state.loadedDate && state.loadedDate !== taipeiDateKey()) window.location.reload();
}

let toastTimeout;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function bindEvents() {
  $$('[data-open-profile]').forEach((button) => button.addEventListener("click", openProfile));
  $$('[data-close-profile]').forEach((button) => button.addEventListener("click", () => $("#profile-dialog").close()));
  $$('[data-close-checkin]').forEach((button) => button.addEventListener("click", () => $("#checkin-dialog").close()));
  $("#profile-form").addEventListener("submit", saveProfile);
  $("#checkin-form").addEventListener("submit", saveCheckin);
  $("#reroll-plan").addEventListener("click", rerollPlan);
  $("#start-focus").addEventListener("click", toggleTimer);
  $("#complete-focus").addEventListener("click", openCheckin);
  $("#export-data").addEventListener("click", exportData);
  $("#import-data").addEventListener("change", importData);
  $("#clear-data").addEventListener("click", clearLocalData);
  $(".import-label").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      $("#import-data").click();
    }
  });
  $("#maintain-check").addEventListener("change", (event) => persistMicroCheck("maintain", event.target.checked));
  $("#network-check").addEventListener("change", (event) => persistMicroCheck("network", event.target.checked));
  $$(".dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
}

async function init() {
  try {
    state.loadedDate = taipeiDateKey();
    await loadData();
    bindEvents();
    renderAll();
    loadProjectsData().then(() => {
      renderSkills();
      renderProjects();
    });
    setInterval(checkDateRollover, 60000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkDateRollover();
    });
  } catch (error) {
    console.error(error);
    showToast("資料暫時無法載入，請重新整理頁面。");
  }
}

init();
