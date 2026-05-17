const STORAGE_KEY = "wolfkill-judge-assistant-v1";

const ROLES = [
  { id: "wolf", name: "狼人", camp: "wolf", mark: "狼", color: "#d66358", night: true, desc: "夜晚共同刀人" },
  { id: "wolf_king", name: "狼王", camp: "wolf", mark: "王", color: "#c05a4f", night: true, desc: "随狼人行动，可记录带人状态" },
  { id: "white_wolf", name: "白狼王", camp: "wolf", mark: "白", color: "#e48073", night: true, desc: "随狼人行动，白天可记录自爆带人" },
  { id: "wolf_beauty", name: "狼美人", camp: "wolf", mark: "美", color: "#bf6a9f", night: true, desc: "夜晚魅惑一名玩家" },
  { id: "seer", name: "预言家", camp: "god", mark: "验", color: "#6c9ee8", night: true, desc: "每晚查验一名玩家" },
  { id: "witch", name: "女巫", camp: "god", mark: "药", color: "#64b587", night: true, desc: "解药、毒药各一次" },
  { id: "guard", name: "守卫", camp: "god", mark: "守", color: "#a886d9", night: true, desc: "不能连续两晚守同一人" },
  { id: "hunter", name: "猎人", camp: "god", mark: "枪", color: "#d7a84f", night: true, desc: "夜晚确认是否可开枪" },
  { id: "idiot", name: "白痴", camp: "god", mark: "痴", color: "#ddc06f", night: false, desc: "被放逐可翻牌免死，失去投票" },
  { id: "knight", name: "骑士", camp: "god", mark: "骑", color: "#80c0d9", night: false, desc: "白天决斗查狼，状态记录" },
  { id: "dreamer", name: "摄梦人", camp: "god", mark: "梦", color: "#9b95e8", night: true, desc: "夜晚摄梦一名玩家" },
  { id: "cupid", name: "丘比特", camp: "god", mark: "丘", color: "#e3a2b8", night: true, desc: "首夜连接情侣" },
  { id: "villager", name: "平民", camp: "villager", mark: "民", color: "#c8c1b3", night: false, desc: "无夜晚技能" }
];

const PRESETS = {
  basic9: { playerCount: 9, counts: { wolf: 3, seer: 1, witch: 1, hunter: 1, villager: 3 } },
  guard10: { playerCount: 10, counts: { wolf: 3, seer: 1, witch: 1, guard: 1, hunter: 1, villager: 3 } },
  standard12: { playerCount: 12, counts: { wolf: 3, wolf_king: 1, seer: 1, witch: 1, guard: 1, hunter: 1, villager: 4 } }
};

const ROLE_BY_ID = Object.fromEntries(ROLES.map((role) => [role.id, role]));

const EXIT_METHODS = {
  wolf: "被刀死",
  poison: "被毒死",
  vote: "被投死",
  shoot: "被枪带",
  wolf_king: "狼王带走",
  self_boom: "狼人自爆",
  conflict: "守救冲突",
  other: "其他"
};

const defaultState = () => ({
  playerCount: 10,
  roleCounts: { wolf: 3, seer: 1, witch: 1, guard: 1, hunter: 1, villager: 3 },
  players: Array.from({ length: 10 }, (_, index) => makePlayer(index)),
  round: 1,
  phase: "night",
  currentStage: 0,
  customScripts: {},
  logs: [],
  exitDraftPlayerId: "",
  roleSkills: {
    witch: {
      healAvailable: true,
      poisonAvailable: true
    }
  },
  rules: {
    witchSelfRescue: "first_night_only",
    guardConflict: "target_dies"
  },
  night: blankNight(),
  lastDeaths: [],
  lastDeathText: "尚未结算"
});

let state = loadState();
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);

function makePlayer(index) {
  return {
    id: `p${index + 1}`,
    seat: index + 1,
    name: `${index + 1}号`,
    roleId: "",
    alive: true,
    death: null,
    skills: {}
  };
}

function blankNight() {
  return {
    wolfKillTargetId: "",
    seerInspectTargetId: "",
    witchHealTargetId: "",
    witchPoisonTargetId: "",
    guardProtectTargetId: "",
    wolfBeautyTargetId: "",
    dreamerTargetId: "",
    cupidFirstTargetId: "",
    cupidSecondTargetId: ""
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.players)) return defaultState();
    return normalizeState(saved);
  } catch {
    return defaultState();
  }
}

function normalizeState(saved) {
  const base = defaultState();
  const next = { ...base, ...saved };
  next.rules = { ...base.rules, ...(saved.rules || {}) };
  next.night = { ...blankNight(), ...(saved.night || {}) };
  next.roleCounts = { ...base.roleCounts, ...(saved.roleCounts || {}) };
  ROLES.forEach((role) => {
    if (typeof next.roleCounts[role.id] !== "number") next.roleCounts[role.id] = 0;
  });
  next.phase = saved.phase || "night";
  next.customScripts = saved.customScripts || {};
  next.logs = Array.isArray(saved.logs) ? saved.logs : [];
  next.exitDraftPlayerId = "";
  next.roleSkills = {
    ...base.roleSkills,
    ...(saved.roleSkills || {}),
    witch: {
      ...base.roleSkills.witch,
      ...((saved.roleSkills || {}).witch || {})
    }
  };
  next.players = saved.players.map((player, index) => ({
    ...makePlayer(index),
    ...player,
    seat: index + 1,
    skills: normalizeSkills(player.roleId, player.skills || {})
  }));
  next.playerCount = next.players.length;
  return next;
}

function normalizeSkills(roleId, skills = {}) {
  if (roleId === "witch") {
    return {
      healAvailable: skills.healAvailable !== false,
      poisonAvailable: skills.poisonAvailable !== false
    };
  }
  if (roleId === "guard") {
    return { lastProtectedPlayerId: skills.lastProtectedPlayerId || "" };
  }
  if (roleId === "hunter" || roleId === "wolf_king" || roleId === "white_wolf") {
    return { canShoot: skills.canShoot !== false };
  }
  if (roleId === "idiot") {
    return { revealed: skills.revealed === true };
  }
  return {};
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function roleCountTotal() {
  return ROLES.reduce((sum, role) => sum + (state.roleCounts[role.id] || 0), 0);
}

function alivePlayers() {
  return state.players.filter((player) => player.alive);
}

function roleExists(roleIds) {
  return state.players.some((player) => player.alive && roleIds.includes(player.roleId))
    || roleIds.some((roleId) => (state.roleCounts[roleId] || 0) > 0);
}

function getPlayer(playerId) {
  return state.players.find((player) => player.id === playerId);
}

function playerLabel(playerId) {
  const player = getPlayer(playerId);
  if (!player) return "未选择";
  return player.name === `${player.seat}号` ? `${player.seat}号` : `${player.seat}号 ${player.name}`;
}

function getRoleName(roleId) {
  return ROLE_BY_ID[roleId]?.name || "未登记";
}

function isWolfRole(roleId) {
  return ROLE_BY_ID[roleId]?.camp === "wolf";
}

function campHint(player) {
  if (!player.roleId) return "";
  return isWolfRole(player.roleId) ? "狼" : "好";
}

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === tabId);
  });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1900);
}

function setPlayerCount(nextCount) {
  const count = Math.max(4, Math.min(18, Number(nextCount) || 4));
  const players = [...state.players];
  while (players.length < count) players.push(makePlayer(players.length));
  if (players.length > count) players.length = count;
  state.players = players.map((player, index) => ({ ...player, seat: index + 1, id: `p${index + 1}` }));
  state.playerCount = count;
  saveAndRender();
}

function applyPreset(presetId) {
  const preset = PRESETS[presetId];
  if (!preset) return;
  state.roleCounts = {};
  ROLES.forEach((role) => {
    state.roleCounts[role.id] = preset.counts[role.id] || 0;
  });
  setPlayerCount(preset.playerCount);
  showToast("已套用常用板子");
}

function setRoleCount(roleId, delta) {
  const current = state.roleCounts[roleId] || 0;
  state.roleCounts[roleId] = Math.max(0, current + delta);
  saveAndRender();
}

function changePlayerRole(playerId, roleId) {
  const player = getPlayer(playerId);
  if (!player) return;
  player.roleId = roleId;
  player.skills = normalizeSkills(roleId, {});
  saveAndRender();
}

function toggleWolfRole(playerId) {
  const player = getPlayer(playerId);
  if (!player) return;
  player.roleId = isWolfRole(player.roleId) ? "" : "wolf";
  player.skills = normalizeSkills(player.roleId, {});
  saveAndRender();
}

function renamePlayers() {
  const names = prompt("输入玩家名称，用逗号或空格分隔。留空会使用默认座位号。", state.players.map((player) => player.name).join(" "));
  if (names === null) return;
  const list = names.trim().split(/[\s,，]+/).filter(Boolean);
  state.players.forEach((player, index) => {
    player.name = list[index] || `${index + 1}号`;
  });
  saveAndRender();
}

function shuffleRoles() {
  const pool = [];
  ROLES.forEach((role) => {
    for (let index = 0; index < (state.roleCounts[role.id] || 0); index += 1) {
      pool.push(role.id);
    }
  });
  if (pool.length !== state.players.length) {
    showToast("身份数量要先等于玩家人数");
    return;
  }
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[target]] = [pool[target], pool[index]];
  }
  state.players.forEach((player, index) => {
    player.roleId = pool[index];
    player.skills = normalizeSkills(player.roleId, {});
    player.alive = true;
    player.death = null;
  });
  state.round = 1;
  state.phase = "night";
  state.currentStage = 0;
  state.night = blankNight();
  state.lastDeaths = [];
  state.lastDeathText = "尚未结算";
  state.logs = [];
  state.roleSkills = defaultState().roleSkills;
  saveAndRender();
  showToast("身份已随机分配");
}

function buildStages() {
  const stages = [
    makeStage("start", "天黑请闭眼", "天黑请闭眼。所有玩家确认闭眼，法官准备进入夜晚流程。")
  ];
  if (roleExists(["wolf", "wolf_king", "white_wolf", "wolf_beauty"])) {
    stages.push(makeStage("wolf", "狼人请睁眼", "狼人请出现。狼人阵营，请选择今晚要击杀的对象。选择完成后，狼人请闭眼。"));
  }
  if (roleExists(["seer"])) {
    stages.push(makeStage("seer", "预言家请睁眼", "预言家请出现。请选择要查验的对象，法官以手势告知阵营。预言家请闭眼。"));
  }
  if (roleExists(["witch"])) {
    stages.push(makeStage("witch", "女巫请睁眼", witchLine()));
  }
  if (roleExists(["guard"])) {
    stages.push(makeStage("guard", "守卫请睁眼", "守卫请出现。请选择今晚要守护的玩家，注意不能连续两晚守护同一人。守卫请闭眼。"));
  }
  if (roleExists(["wolf_beauty"])) {
    stages.push(makeStage("wolf_beauty", "狼美人请睁眼", "狼美人请出现。请选择今晚魅惑的玩家。狼美人请闭眼。"));
  }
  if (roleExists(["dreamer"])) {
    stages.push(makeStage("dreamer", "摄梦人请睁眼", "摄梦人请出现。请选择今晚摄梦的玩家。摄梦人请闭眼。"));
  }
  if (roleExists(["cupid"]) && state.round === 1) {
    stages.push(makeStage("cupid", "丘比特请睁眼", "丘比特请出现。请选择两名玩家成为情侣。丘比特请闭眼。"));
  }
  if (roleExists(["hunter"])) {
    stages.push(makeStage("hunter", "猎人请睁眼", hunterLine()));
  }
  stages.push(
    makeStage("settle", "结算夜晚", previewSettleLine()),
    makeStage("dawn", "天亮", "天亮了。法官公布昨夜出局信息，然后进入警长、发言或放逐流程。")
  );
  return stages;
}

function makeStage(id, title, line) {
  return { id, title, line: state.customScripts[id] || line };
}

function witchLine() {
  const witch = state.players.find((player) => player.roleId === "witch");
  const victim = state.night.wolfKillTargetId ? playerLabel(state.night.wolfKillTargetId) : "无人";
  const healText = !witch || witch.skills?.healAvailable ? "你有解药" : "你已经没有解药";
  const poisonText = !witch || witch.skills?.poisonAvailable ? "你有毒药" : "你已经没有毒药";
  return `女巫请出现。昨晚被杀的是 ${victim}。${healText}，${poisonText}。请选择是否使用药。女巫请闭眼。`;
}

function hunterLine() {
  const hunters = state.players.filter((player) => player.roleId === "hunter");
  if (!hunters.length) return "猎人请出现。法官告知你的开枪状态。猎人请闭眼。";
  const status = hunters.map((hunter) => `${hunter.seat}号${hunter.skills.canShoot ? "可以开枪" : "不能开枪"}`).join("，");
  return `猎人请出现。你的开枪状态为：${status}。猎人请闭眼。`;
}

function previewSettleLine() {
  const deaths = calculateDeaths().map(playerLabel);
  return deaths.length ? `天亮前预估出局：${deaths.join("、")}。` : "天亮前预估：昨夜平安夜。";
}

function calculateDeaths() {
  return calculateDeathEvents().map((event) => event.playerId);
}

function calculateDeathEvents() {
  const deaths = new Map();
  const kill = state.night.wolfKillTargetId;
  const heal = state.night.witchHealTargetId;
  const poison = state.night.witchPoisonTargetId;
  const guard = state.night.guardProtectTargetId;

  if (kill) {
    const healed = heal === kill;
    const guarded = guard === kill;
    if (healed && guarded) {
      if (state.rules.guardConflict === "target_dies") deaths.set(kill, "conflict");
    } else if (!healed && !guarded) {
      deaths.set(kill, "wolf");
    }
  }
  if (poison) deaths.set(poison, "poison");
  return [...deaths.entries()]
    .filter(([playerId]) => getPlayer(playerId)?.alive)
    .map(([playerId, method]) => ({ playerId, method }));
}

function renderAll() {
  renderSummary();
  renderRoleBank();
  renderPlayerSetup();
  renderNight();
  renderBoard();
  renderLogs();
  renderExitModal();
  bindStaticValues();
}

function renderSummary() {
  $("#playerCountText").textContent = `${state.players.length} 人`;
  $("#roleCountText").textContent = `${roleCountTotal()} 身份`;
  $("#roundText").textContent = state.phase === "day" ? `第 ${state.round} 天` : `第 ${state.round} 夜`;
  $("#startNightButton").textContent = state.phase === "day" ? `进入第 ${state.round + 1} 夜` : `开始第 ${state.round} 夜`;
  $("#playerCountInput").value = state.players.length;
  const balanced = roleCountTotal() === state.players.length;
  $("#roleBalanceText").textContent = balanced ? "身份数已匹配" : `还差 ${state.players.length - roleCountTotal()} 个身份`;
  $("#roleBalanceText").style.color = balanced ? "var(--green)" : "var(--gold)";
}

function renderRoleBank() {
  $("#roleBank").innerHTML = ROLES.map((role) => `
    <div class="role-row">
      <div class="role-title">
        <span class="role-mark" style="--role-color:${role.color}">${role.mark}</span>
        <div class="role-meta">
          <strong>${role.name}</strong>
          <span>${role.desc}</span>
        </div>
      </div>
      <div class="counter" aria-label="${role.name}数量">
        <button type="button" data-role-count="${role.id}" data-delta="-1">−</button>
        <span>${state.roleCounts[role.id] || 0}</span>
        <button type="button" data-role-count="${role.id}" data-delta="1">+</button>
      </div>
    </div>
  `).join("");
}

function renderPlayerSetup() {
  const options = [`<option value="">未登记</option>`].concat(
    ROLES.map((role) => `<option value="${role.id}">${role.name}</option>`)
  ).join("");
  $("#playerSetupList").innerHTML = state.players.map((player) => `
    <div class="player-row">
      <div class="player-main">
        <span class="seat-badge">${player.seat}</span>
        <div class="player-name">
          <strong>${player.name}</strong>
          <span>${player.alive ? "存活" : "已出局"}</span>
        </div>
      </div>
      <select data-player-role="${player.id}" aria-label="${player.name}身份">
        ${options}
      </select>
    </div>
  `).join("");
  state.players.forEach((player) => {
    const select = document.querySelector(`[data-player-role="${player.id}"]`);
    if (select) select.value = player.roleId;
  });
}

function renderNight() {
  const stages = buildStages();
  state.currentStage = Math.max(0, Math.min(state.currentStage, stages.length - 1));
  const stage = stages[state.currentStage];
  $("#currentRoundHint").textContent = `第 ${state.round} 夜 · ${state.currentStage + 1}/${stages.length}`;
  $("#currentStageTitle").textContent = stage.title;
  $("#currentStageLine").textContent = stage.line;
  $("#nextStageButton").textContent = state.currentStage === stages.length - 1 ? "天亮结算" : "下一步";
  $("#scriptList").innerHTML = stages.map((item, index) => `
    <article class="script-item ${index === state.currentStage ? "is-current" : ""}">
      <span class="script-index">${index + 1}</span>
      <div class="script-copy">
        <strong>${item.title}</strong>
        <p>${item.line}</p>
      </div>
    </article>
  `).join("");
  renderNightAction(stage.id);
}

function renderNightAction(stageId) {
  const panel = $("#nightActionPanel");
  if (stageId === "wolf") {
    panel.innerHTML = `
      ${wolfMarker()}
      ${targetPicker("狼人刀人", "选择今晚被杀目标", "wolfKillTargetId", alivePlayers())}
    `;
    return;
  }
  if (stageId === "seer") {
    const inspected = getPlayer(state.night.seerInspectTargetId);
    panel.innerHTML = targetPicker("预言家查验", inspected ? `${playerLabel(inspected.id)}：${getRoleName(inspected.roleId)}` : "选择查验对象", "seerInspectTargetId", alivePlayers());
    return;
  }
  if (stageId === "witch") {
    renderWitchAction(panel);
    return;
  }
  if (stageId === "guard") {
    const guard = state.players.find((player) => player.roleId === "guard");
    const blockedId = guard?.skills?.lastProtectedPlayerId || "";
    const candidates = alivePlayers().map((player) => ({ ...player, disabled: player.id === blockedId }));
    panel.innerHTML = targetPicker("守卫守护", blockedId ? `上晚守护：${playerLabel(blockedId)}` : "选择今晚守护对象", "guardProtectTargetId", candidates);
    return;
  }
  if (stageId === "wolf_beauty") {
    panel.innerHTML = targetPicker("狼美人魅惑", "选择今晚魅惑对象", "wolfBeautyTargetId", alivePlayers());
    return;
  }
  if (stageId === "dreamer") {
    panel.innerHTML = targetPicker("摄梦人摄梦", "选择今晚摄梦对象", "dreamerTargetId", alivePlayers());
    return;
  }
  if (stageId === "cupid") {
    panel.innerHTML = `
      ${targetPicker("丘比特情侣 1", "选择第一名情侣", "cupidFirstTargetId", alivePlayers())}
      ${targetPicker("丘比特情侣 2", "选择第二名情侣", "cupidSecondTargetId", alivePlayers())}
    `;
    return;
  }
  if (stageId === "hunter") {
    const hunters = state.players.filter((player) => player.roleId === "hunter");
    panel.innerHTML = `
      <h3>猎人状态</h3>
      <p class="script-line">记录猎人当前是否可以开枪。被女巫毒出局时通常不能开枪。</p>
      <div class="target-grid">
        ${hunters.map((hunter) => `<button class="mini-button ${hunter.skills.canShoot ? "is-selected" : ""}" type="button" data-toggle-shoot="${hunter.id}">${hunter.seat}号 ${hunter.skills.canShoot ? "可开枪" : "不可开枪"}</button>`).join("") || `<span class="muted">本局没有猎人。</span>`}
      </div>
    `;
    return;
  }
  panel.innerHTML = "";
}

function renderWitchAction(panel) {
  const witch = state.players.find((player) => player.roleId === "witch");
  const witchSkills = witch?.skills || state.roleSkills.witch;
  const victimId = state.night.wolfKillTargetId;
  const healAvailable = witchSkills.healAvailable !== false;
  const poisonAvailable = witchSkills.poisonAvailable !== false;
  const canHeal = healAvailable && victimId && canWitchHealSelf(witch, victimId);
  const canPoison = poisonAvailable;
  panel.innerHTML = `
    <h3>女巫用药</h3>
    <p class="script-line">昨晚被杀：${victimId ? playerLabel(victimId) : "无人"}${victimId ? roleBadgeText(getPlayer(victimId)) : ""}。解药和毒药各一次，使用后会在天亮结算时消耗。</p>
    <div class="target-grid">
      <button class="mini-button ${state.night.witchHealTargetId ? "is-selected" : ""}" type="button" data-witch-heal="${victimId}" ${canHeal ? "" : "disabled"}>${state.night.witchHealTargetId ? "取消解药" : "使用解药"}</button>
      <button class="mini-button" type="button" data-clear-poison>不使用毒药</button>
    </div>
    ${canPoison ? targetPicker("选择毒药目标", "点选后会记录为毒杀", "witchPoisonTargetId", alivePlayers()) : `<p class="script-line">毒药已用完。</p>`}
  `;
}

function canWitchHealSelf(witch, victimId) {
  if (!witch) return true;
  if (witch.id !== victimId) return true;
  if (state.rules.witchSelfRescue === "always") return true;
  if (state.rules.witchSelfRescue === "never") return false;
  return state.round === 1;
}

function wolfMarker() {
  return `
    <h3>快速标狼</h3>
    <p class="script-line">狼人睁眼时点一下座位，法官提示板会把他记为狼人。</p>
    <div class="target-grid wolf-marker-grid">
      ${alivePlayers().map((player) => `
        <button
          class="mini-button ${isWolfRole(player.roleId) ? "is-wolf" : ""}"
          type="button"
          data-toggle-wolf="${player.id}"
        >${playerLabel(player.id)}${isWolfRole(player.roleId) ? " · 狼" : ""}</button>
      `).join("")}
    </div>
  `;
}

function roleBadgeText(player) {
  const hint = campHint(player);
  return hint ? `（${hint}，${getRoleName(player.roleId)}）` : "";
}

function targetPicker(title, hint, field, players) {
  return `
    <h3>${title}</h3>
    <p class="script-line">${hint}</p>
    <div class="target-grid">
      ${players.map((player) => `
        <button
          class="mini-button ${state.night[field] === player.id ? "is-selected" : ""}"
          type="button"
          data-night-field="${field}"
          data-target="${player.id}"
          ${player.disabled ? "disabled" : ""}
        >${playerLabel(player.id)}</button>
      `).join("") || `<span class="muted">暂无可选玩家。</span>`}
    </div>
  `;
}

function renderBoard() {
  $("#finishNightButton").textContent = state.phase === "night" ? "天亮结算" : "已结算";
  $("#deathSummaryText").textContent = state.lastDeathText || "尚未结算";
  $("#winSummaryText").textContent = getWinText();
  $("#boardGrid").innerHTML = state.players.map((player) => {
    const role = ROLE_BY_ID[player.roleId] || { name: "未登记", color: "#aeb7c2" };
    return `
      <article class="player-card ${player.alive ? "" : "is-dead"}">
        <div class="card-top">
          <div class="player-main">
            <span class="seat-badge">${player.seat}</span>
            <div class="player-name">
              <strong>${player.name}</strong>
              <span>${role.camp ? campName(role.camp) : "身份未登记"}</span>
            </div>
          </div>
          <span class="role-pill" style="--role-color:${role.color}">${role.name}</span>
        </div>
        <div class="ability-row">
          <span class="state-pill ${player.alive ? "" : "is-dead"}">${player.alive ? "存活" : "出局"}</span>
          <button class="ghost-button" type="button" data-${player.alive ? "mark-exit" : "restore-alive"}="${player.id}">${player.alive ? "标记出局" : "恢复存活"}</button>
        </div>
        ${player.death ? `<p class="death-note">${formatDeath(player.death)}</p>` : ""}
        ${abilityHtml(player)}
      </article>
    `;
  }).join("");
}

function formatDeath(death) {
  return `第 ${death.round}${death.phase === "day" ? "天" : "夜"} · ${EXIT_METHODS[death.method] || "其他"}`;
}

function campName(camp) {
  if (camp === "wolf") return "狼人阵营";
  if (camp === "god") return "神职";
  return "平民";
}

function abilityHtml(player) {
  if (player.roleId === "witch") {
    return `
      <div class="ability-list">
        <button class="ability-chip ${player.skills.healAvailable ? "is-on" : ""}" type="button" data-toggle-skill="${player.id}" data-skill="healAvailable">解药${player.skills.healAvailable ? "未用" : "已用"}</button>
        <button class="ability-chip ${player.skills.poisonAvailable ? "is-on" : ""}" type="button" data-toggle-skill="${player.id}" data-skill="poisonAvailable">毒药${player.skills.poisonAvailable ? "未用" : "已用"}</button>
      </div>
    `;
  }
  if (player.roleId === "guard") {
    return `<p class="muted">上次守护：${player.skills.lastProtectedPlayerId ? playerLabel(player.skills.lastProtectedPlayerId) : "未记录"}</p>`;
  }
  if (player.roleId === "hunter" || player.roleId === "wolf_king" || player.roleId === "white_wolf") {
    return `
      <div class="ability-list">
        <button class="ability-chip ${player.skills.canShoot ? "is-on" : ""}" type="button" data-toggle-skill="${player.id}" data-skill="canShoot">${player.roleId === "hunter" ? "开枪" : "带人"}${player.skills.canShoot ? "可用" : "不可用"}</button>
      </div>
    `;
  }
  if (player.roleId === "idiot") {
    return `
      <div class="ability-list">
        <button class="ability-chip ${player.skills.revealed ? "is-on" : ""}" type="button" data-toggle-skill="${player.id}" data-skill="revealed">${player.skills.revealed ? "已翻牌" : "未翻牌"}</button>
      </div>
    `;
  }
  return "";
}

function getWinText() {
  const alive = state.players.filter((player) => player.alive && player.roleId);
  const wolves = alive.filter((player) => ROLE_BY_ID[player.roleId]?.camp === "wolf").length;
  const gods = alive.filter((player) => ROLE_BY_ID[player.roleId]?.camp === "god").length;
  const villagers = alive.filter((player) => ROLE_BY_ID[player.roleId]?.camp === "villager").length;
  if (!alive.length) return "登记身份后，会按屠边规则自动提示。";
  if (wolves === 0) return "好人胜利：狼人已全部出局。";
  if (gods === 0 || villagers === 0) return "狼人胜利：好人一边已被屠尽。";
  return `未结束：狼 ${wolves}，神 ${gods}，民 ${villagers}。`;
}

function finishNight() {
  if (state.phase === "day") {
    showToast("当前夜晚已经结算");
    return;
  }
  const deathEvents = calculateDeathEvents();
  deathEvents.forEach(({ playerId, method }) => {
    const player = getPlayer(playerId);
    if (player) {
      player.alive = false;
      player.death = { round: state.round, phase: "night", method };
    }
    if (player?.roleId === "hunter" && state.night.witchPoisonTargetId === playerId) {
      player.skills.canShoot = false;
    }
  });

  const witch = state.players.find((player) => player.roleId === "witch");
  if (witch) {
    if (state.night.witchHealTargetId) witch.skills.healAvailable = false;
    if (state.night.witchPoisonTargetId) witch.skills.poisonAvailable = false;
  } else {
    if (state.night.witchHealTargetId) state.roleSkills.witch.healAvailable = false;
    if (state.night.witchPoisonTargetId) state.roleSkills.witch.poisonAvailable = false;
  }

  const guard = state.players.find((player) => player.roleId === "guard");
  if (guard && state.night.guardProtectTargetId) {
    guard.skills.lastProtectedPlayerId = state.night.guardProtectTargetId;
  }

  state.lastDeaths = deathEvents.map((event) => event.playerId);
  state.lastDeathText = deathEvents.length
    ? `昨夜出局：${deathEvents.map((event) => `${playerLabel(event.playerId)}（${EXIT_METHODS[event.method]}）`).join("、")}`
    : "昨夜平安夜";
  addLog(`第 ${state.round} 夜结算`, buildNightLogDetails(deathEvents), "night", state.round);
  state.phase = "day";
  state.currentStage = 0;
  state.night = blankNight();
  saveAndRender();
  switchTab("board");
  showToast("夜晚已结算");
}

function buildNightLogDetails(deathEvents) {
  const details = [];
  if (state.night.wolfKillTargetId) details.push(`狼人刀：${playerLabel(state.night.wolfKillTargetId)}`);
  if (state.night.seerInspectTargetId) details.push(`预言家验：${playerLabel(state.night.seerInspectTargetId)} 是 ${getRoleName(getPlayer(state.night.seerInspectTargetId)?.roleId)}`);
  if (state.night.witchHealTargetId) details.push(`女巫救：${playerLabel(state.night.witchHealTargetId)}`);
  if (state.night.witchPoisonTargetId) details.push(`女巫毒：${playerLabel(state.night.witchPoisonTargetId)}`);
  if (state.night.guardProtectTargetId) details.push(`守卫守：${playerLabel(state.night.guardProtectTargetId)}`);
  if (state.night.wolfBeautyTargetId) details.push(`狼美人魅惑：${playerLabel(state.night.wolfBeautyTargetId)}`);
  if (state.night.dreamerTargetId) details.push(`摄梦人摄梦：${playerLabel(state.night.dreamerTargetId)}`);
  if (state.night.cupidFirstTargetId || state.night.cupidSecondTargetId) {
    details.push(`丘比特情侣：${[state.night.cupidFirstTargetId, state.night.cupidSecondTargetId].filter(Boolean).map(playerLabel).join("、")}`);
  }
  details.push(deathEvents.length ? `出局：${deathEvents.map((event) => `${playerLabel(event.playerId)}（${EXIT_METHODS[event.method]}）`).join("、")}` : "出局：平安夜");
  return details;
}

function addLog(title, details, phase = state.phase, round = state.round) {
  state.logs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    round,
    phase,
    title,
    details,
    time: new Date().toLocaleString("zh-CN", { hour12: false })
  });
}

function renderLogs() {
  const logList = $("#logList");
  if (!state.logs.length) {
    logList.innerHTML = `<article class="log-card"><strong>暂无日志</strong><p>夜晚结算或手动标记出局后，会自动记录在这里。</p></article>`;
    return;
  }
  logList.innerHTML = state.logs.map((entry) => `
    <article class="log-card">
      <strong>${entry.title}</strong>
      <p>第 ${entry.round}${entry.phase === "day" ? "天" : "夜"} · ${entry.time || ""}</p>
      <p>${(entry.details || []).join("<br>")}</p>
    </article>
  `).join("");
}

function renderExitModal() {
  const modal = $("#exitModal");
  const player = getPlayer(state.exitDraftPlayerId);
  modal.hidden = !player;
  modal.style.display = player ? "grid" : "none";
  if (!player) return;
  $("#exitPlayerText").textContent = `${playerLabel(player.id)}：选择出局时间和方式。`;
  $("#exitTimeSelect").innerHTML = buildExitTimeOptions();
  $("#exitTimeSelect").value = `${state.round}:${state.phase}`;
  $("#exitMethodSelect").value = state.phase === "day" ? "vote" : "wolf";
}

function buildExitTimeOptions() {
  const options = [];
  for (let round = 1; round <= state.round; round += 1) {
    options.push(`<option value="${round}:night">第 ${round} 夜</option>`);
    options.push(`<option value="${round}:day">第 ${round} 天</option>`);
  }
  return options.join("");
}

function openExitModal(playerId) {
  state.exitDraftPlayerId = playerId;
  renderExitModal();
}

function closeExitModal() {
  state.exitDraftPlayerId = "";
  renderExitModal();
}

function confirmExit() {
  const player = getPlayer(state.exitDraftPlayerId);
  if (!player) return;
  const [roundText, phase] = $("#exitTimeSelect").value.split(":");
  const method = $("#exitMethodSelect").value;
  const round = Number(roundText) || state.round;
  player.alive = false;
  player.death = { round, phase, method };
  if (player.roleId === "hunter" && method === "poison") player.skills.canShoot = false;
  addLog(`${playerLabel(player.id)} 出局`, [`方式：${EXIT_METHODS[method] || "其他"}`], phase, round);
  state.lastDeathText = `${playerLabel(player.id)} 已标记出局`;
  state.exitDraftPlayerId = "";
  saveAndRender();
  showToast("已标记出局");
}

function restoreAlive(playerId) {
  const player = getPlayer(playerId);
  if (!player) return;
  player.alive = true;
  player.death = null;
  addLog(`${playerLabel(player.id)} 恢复存活`, ["手动恢复"], state.phase, state.round);
  saveAndRender();
}

function copyScript() {
  const text = buildStages().map((stage, index) => `${index + 1}. ${stage.title}\n${stage.line}`).join("\n\n");
  navigator.clipboard?.writeText(text).then(
    () => showToast("话术已复制"),
    () => showToast("当前浏览器不允许复制")
  );
}

function editCurrentScript() {
  const stage = buildStages()[state.currentStage];
  if (!stage) return;
  const next = prompt(`修改「${stage.title}」话术`, stage.line);
  if (next === null) return;
  const text = next.trim();
  if (text) {
    state.customScripts[stage.id] = text;
  } else {
    delete state.customScripts[stage.id];
  }
  saveAndRender();
  showToast(text ? "话术已修改" : "已恢复默认话术");
}

function startNight() {
  if (state.phase === "day") {
    state.round += 1;
    state.phase = "night";
  }
  state.currentStage = 0;
  state.night = blankNight();
  saveAndRender();
  switchTab("night");
}

function bindStaticValues() {
  $("#witchSelfRescueSelect").value = state.rules.witchSelfRescue;
  $("#guardConflictSelect").value = state.rules.guardConflict;
}

function saveAndRender() {
  saveState();
  renderAll();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.matches(".tab")) switchTab(target.dataset.tab);
  if (target.dataset.stepPlayer) setPlayerCount(state.players.length + Number(target.dataset.stepPlayer));
  if (target.dataset.preset) applyPreset(target.dataset.preset);
  if (target.dataset.roleCount) setRoleCount(target.dataset.roleCount, Number(target.dataset.delta));
  if (target.id === "renamePlayersButton") renamePlayers();
  if (target.id === "shuffleRolesButton") shuffleRoles();
  if (target.id === "startNightButton") startNight();
  if (target.id === "prevStageButton") {
    state.currentStage = Math.max(0, state.currentStage - 1);
    saveAndRender();
  }
  if (target.id === "nextStageButton") {
    if (state.currentStage >= buildStages().length - 1) {
      finishNight();
    } else {
      state.currentStage = Math.min(buildStages().length - 1, state.currentStage + 1);
      saveAndRender();
    }
  }
  if (target.id === "editScriptButton") editCurrentScript();
  if (target.id === "copyScriptButton") copyScript();
  if (target.id === "finishNightButton") finishNight();
  if (target.id === "clearLogButton" && confirm("清空本局日志？")) {
    state.logs = [];
    saveAndRender();
  }
  if (target.id === "cancelExitButton") closeExitModal();
  if (target.id === "confirmExitButton") confirmExit();
  if (target.id === "resetAllButton" && confirm("确定重置本局所有数据？")) {
    state = defaultState();
    saveAndRender();
    showToast("已重置");
  }
  if (target.dataset.nightField) {
    const field = target.dataset.nightField;
    state.night[field] = state.night[field] === target.dataset.target ? "" : target.dataset.target;
    saveAndRender();
  }
  if (target.dataset.toggleWolf) toggleWolfRole(target.dataset.toggleWolf);
  if (target.dataset.witchHeal !== undefined) {
    const victimId = target.dataset.witchHeal;
    state.night.witchHealTargetId = state.night.witchHealTargetId ? "" : victimId;
    saveAndRender();
  }
  if (target.dataset.clearPoison !== undefined) {
    state.night.witchPoisonTargetId = "";
    saveAndRender();
  }
  if (target.dataset.toggleShoot) {
    const player = getPlayer(target.dataset.toggleShoot);
    if (player) player.skills.canShoot = !player.skills.canShoot;
    saveAndRender();
  }
  if (target.dataset.markExit) openExitModal(target.dataset.markExit);
  if (target.dataset.restoreAlive) restoreAlive(target.dataset.restoreAlive);
  if (target.dataset.toggleSkill) {
    const player = getPlayer(target.dataset.toggleSkill);
    if (player) player.skills[target.dataset.skill] = !player.skills[target.dataset.skill];
    saveAndRender();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "playerCountInput") setPlayerCount(target.value);
  if (target.dataset.playerRole) changePlayerRole(target.dataset.playerRole, target.value);
  if (target.id === "witchSelfRescueSelect") {
    state.rules.witchSelfRescue = target.value;
    saveAndRender();
  }
  if (target.id === "guardConflictSelect") {
    state.rules.guardConflict = target.value;
    saveAndRender();
  }
});

renderAll();
