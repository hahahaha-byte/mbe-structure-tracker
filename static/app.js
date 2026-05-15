const state = {
  wafers: [],
  current: null,
  selectedItemId: null,
  copiedItemId: null,
  shortcuts: [],
  saveTimers: new Map(),
  waferSaveTimer: null
};

const DEFAULT_SHORTCUTS = [
  { key: "Alt+1", layer_name: "缓冲层", material: "GaAs buffer layer", thickness_nm: "500", doping: "2E18" },
  { key: "Alt+2", layer_name: "限制层", material: "AlGaAs cladding layer", thickness_nm: "1800", doping: "2E18" },
  { key: "Alt+3", layer_name: "波导层", material: "GaAs Waveguide layer", thickness_nm: "150", doping: "" },
  { key: "Alt+4", layer_name: "有源区", material: "QD active layer", thickness_nm: "", doping: "Be-doping 10hole/dot" },
  { key: "Alt+5", layer_name: "接触层", material: "GaAs contact layer", thickness_nm: "200", doping: "1E19" }
];

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  loadShortcuts();
  bindEvents();
  renderShortcuts();
  await loadWafers();
}

function bindElements() {
  els.searchInput = document.getElementById("searchInput");
  els.waferList = document.getElementById("waferList");
  els.layerTableBody = document.getElementById("layerTableBody");
  els.stackVisual = document.getElementById("stackVisual");
  els.statsContent = document.getElementById("statsContent");
  els.totalThickness = document.getElementById("totalThickness");
  els.statusText = document.getElementById("statusText");
  els.shortcutList = document.getElementById("shortcutList");
  els.waferFields = {
    wafer_code: document.getElementById("waferCode"),
    size: document.getElementById("waferSize"),
    structure_name: document.getElementById("structureName"),
    growth_date: document.getElementById("growthDate"),
    notes: document.getElementById("waferNotes")
  };
}

function bindEvents() {
  document.getElementById("newWaferBtn").addEventListener("click", createNewWafer);
  document.getElementById("importExcelBtn").addEventListener("click", importExcel);
  document.getElementById("resetShortcutsBtn").addEventListener("click", resetShortcuts);
  els.searchInput.addEventListener("input", debounce(() => loadWafers(), 180));

  document.querySelector(".toolbar").addEventListener("click", handleToolbarClick);
  els.waferList.addEventListener("click", handleWaferListClick);
  els.layerTableBody.addEventListener("click", handleTableClick);
  els.layerTableBody.addEventListener("input", handleItemInput);
  els.layerTableBody.addEventListener("change", handleItemInput);
  els.shortcutList.addEventListener("input", handleShortcutInput);
  document.addEventListener("keydown", handleShortcutKey);

  Object.values(els.waferFields).forEach((input) => {
    input.addEventListener("input", handleWaferInput);
  });
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // Keep response status text.
    }
    throw new Error(message);
  }
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function loadWafers(selectId = null) {
  const search = encodeURIComponent(els.searchInput.value.trim());
  const payload = await api(`/api/wafers?search=${search}`);
  state.wafers = payload.wafers;
  renderWaferList();
  const idToLoad = selectId || state.current?.id || state.wafers[0]?.id;
  if (idToLoad) {
    await loadWafer(idToLoad);
  } else {
    state.current = null;
    renderCurrent();
  }
}

async function loadWafer(id) {
  const payload = await api(`/api/wafers/${id}`);
  state.current = payload.wafer;
  if (!state.current.items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = state.current.items[0]?.id || null;
  }
  renderCurrent();
  renderWaferList();
}

function renderWaferList() {
  if (!state.wafers.length) {
    els.waferList.innerHTML = `<div class="wafer-meta">暂无数据</div>`;
    return;
  }
  els.waferList.innerHTML = state.wafers
    .map((wafer) => {
      const active = wafer.id === state.current?.id ? "active" : "";
      return `
        <button class="wafer-item ${active}" data-wafer-id="${wafer.id}">
          <span class="wafer-code">${escapeHtml(wafer.wafer_code)}</span>
          <span class="wafer-meta">${escapeHtml(wafer.structure_name || "未命名结构")}</span>
          <span class="wafer-meta">${escapeHtml(wafer.size || "")} · ${wafer.item_count || 0} 层 · ${wafer.doped_item_count || 0} 掺杂</span>
        </button>
      `;
    })
    .join("");
}

function renderCurrent() {
  const wafer = state.current;
  Object.entries(els.waferFields).forEach(([field, input]) => {
    input.value = wafer?.[field] || "";
    input.disabled = !wafer;
  });
  renderItems();
  renderInspector();
}

function renderItems() {
  if (!state.current) {
    els.layerTableBody.innerHTML = "";
    return;
  }
  const rows = flattenItems();
  if (!rows.length) {
    els.layerTableBody.innerHTML = `
      <tr>
        <td colspan="11" class="wafer-meta">暂无层结构</td>
      </tr>
    `;
    return;
  }
  els.layerTableBody.innerHTML = rows.map(({ item, depth }) => renderItemRow(item, depth)).join("");
}

function renderItemRow(item, depth) {
  const selected = item.id === state.selectedItemId ? "selected" : "";
  const repeat = item.item_type === "repeat";
  const child = depth > 0 ? "child-row" : "";
  const computed = computeItem(item, childMap());
  return `
    <tr class="${selected} ${repeat ? "repeat-row" : ""} ${child}" data-id="${item.id}">
      <td>
        <div class="row-actions">
          <button data-action="select-row" title="选择">•</button>
          <button data-action="move-up" title="上移">↑</button>
          <button data-action="move-down" title="下移">↓</button>
          <button data-action="delete-item" title="删除">×</button>
        </div>
      </td>
      <td><span class="type-badge ${repeat ? "repeat" : ""}">${repeat ? "重复" : "层"}</span></td>
      <td>
        <div class="indent-cell" style="--indent:${9 + depth * 18}px">
          <input data-field="layer_name" value="${escapeAttr(item.layer_name)}" />
        </div>
      </td>
      <td><input data-field="material" value="${escapeAttr(item.material)}" /></td>
      <td>
        <input data-field="thickness_nm" value="${repeat ? formatNumber(computed.thickness) : escapeAttr(blankNumber(item.thickness_nm))}" ${repeat ? "disabled" : ""} />
      </td>
      <td><input data-field="periods" value="${escapeAttr(blankNumber(item.periods))}" ${repeat ? "" : "disabled"} /></td>
      <td><input data-field="single_period_thickness_nm" value="${escapeAttr(blankNumber(item.single_period_thickness_nm))}" ${repeat ? "" : "disabled"} /></td>
      <td><input data-field="doping" value="${escapeAttr(item.doping)}" /></td>
      <td><input data-field="growth_temp" value="${escapeAttr(item.growth_temp)}" /></td>
      <td class="checkbox-cell"><input data-field="is_quantum_dot" type="checkbox" ${item.is_quantum_dot ? "checked" : ""} /></td>
      <td><input data-field="notes" value="${escapeAttr(item.notes)}" /></td>
    </tr>
  `;
}

function handleWaferListClick(event) {
  const button = event.target.closest("[data-wafer-id]");
  if (!button) return;
  loadWafer(Number(button.dataset.waferId)).catch(showError);
}

async function handleToolbarClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.current) return;
  const action = button.dataset.action;
  try {
    if (action === "add-layer") await addItem("layer");
    if (action === "add-repeat") await addItem("repeat");
    if (action === "add-child") await addChildLayer();
    if (action === "copy-item") copySelectedItem();
    if (action === "paste-item") await pasteItem();
    if (action === "duplicate-wafer") await duplicateCurrentWafer();
    if (action === "export-json") downloadExport("json");
    if (action === "export-csv") downloadExport("csv");
  } catch (error) {
    showError(error);
  }
}

async function handleTableClick(event) {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const id = Number(row.dataset.id);
  const actionButton = event.target.closest("button[data-action]");
  if (!actionButton) {
    selectItem(id);
    return;
  }
  const action = actionButton.dataset.action;
  try {
    if (action === "select-row") selectItem(id);
    if (action === "move-up" || action === "move-down") {
      await api(`/api/items/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ direction: action === "move-up" ? "up" : "down" })
      });
      await loadWafer(state.current.id);
    }
    if (action === "delete-item") {
      await api(`/api/items/${id}`, { method: "DELETE" });
      state.selectedItemId = null;
      await loadWafer(state.current.id);
    }
  } catch (error) {
    showError(error);
  }
}

function handleItemInput(event) {
  const input = event.target.closest("[data-field]");
  const row = event.target.closest("tr[data-id]");
  if (!input || !row || !state.current) return;
  const id = Number(row.dataset.id);
  const item = state.current.items.find((candidate) => candidate.id === id);
  if (!item) return;
  const field = input.dataset.field;
  item[field] = input.type === "checkbox" ? (input.checked ? 1 : 0) : input.value;
  state.selectedItemId = id;
  scheduleItemSave(item);
  renderInspector();
}

function handleWaferInput(event) {
  if (!state.current) return;
  const field = event.target.dataset.waferField;
  state.current[field] = event.target.value;
  clearTimeout(state.waferSaveTimer);
  state.waferSaveTimer = setTimeout(async () => {
    try {
      await api(`/api/wafers/${state.current.id}`, {
        method: "PUT",
        body: JSON.stringify(pickWaferFields(state.current))
      });
      showStatus("已保存");
      await loadWafers(state.current.id);
    } catch (error) {
      showError(error);
    }
  }, 350);
}

function scheduleItemSave(item) {
  clearTimeout(state.saveTimers.get(item.id));
  state.saveTimers.set(
    item.id,
    setTimeout(async () => {
      try {
        await api(`/api/items/${item.id}`, {
          method: "PUT",
          body: JSON.stringify(item)
        });
        showStatus("已保存");
      } catch (error) {
        showError(error);
      }
    }, 260)
  );
}

async function createNewWafer() {
  const wafer_code = prompt("片号", nextWaferCode());
  if (!wafer_code) return;
  try {
    const payload = await api("/api/wafers", {
      method: "POST",
      body: JSON.stringify({ wafer_code, size: "3英寸", structure_name: "" })
    });
    state.selectedItemId = null;
    await loadWafers(payload.wafer.id);
  } catch (error) {
    showError(error);
  }
}

async function addItem(itemType) {
  const selected = selectedItem();
  const body = {
    item_type: itemType,
    after_id: selected?.parent_id ? selected.id : selected?.id,
    layer_name: itemType === "repeat" ? "重复块" : "新层",
    material: "",
    thickness_nm: itemType === "layer" ? 0 : null,
    periods: itemType === "repeat" ? 1 : null,
    single_period_thickness_nm: itemType === "repeat" ? 0 : null
  };
  const payload = await api(`/api/wafers/${state.current.id}/items`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  state.selectedItemId = payload.item.id;
  await loadWafer(state.current.id);
}

async function addChildLayer() {
  const parent = selectedItem();
  if (!parent || parent.item_type !== "repeat") {
    showStatus("先选择重复块");
    return;
  }
  const payload = await api(`/api/wafers/${state.current.id}/items`, {
    method: "POST",
    body: JSON.stringify({
      parent_id: parent.id,
      item_type: "layer",
      layer_name: "子层",
      material: "",
      thickness_nm: 0
    })
  });
  state.selectedItemId = payload.item.id;
  await loadWafer(state.current.id);
}

function copySelectedItem() {
  const item = selectedItem();
  if (!item) {
    showStatus("未选择层");
    return;
  }
  state.copiedItemId = item.id;
  showStatus("已复制");
}

async function pasteItem() {
  if (!state.copiedItemId) {
    showStatus("剪贴板为空");
    return;
  }
  const selected = selectedItem();
  const body = {
    source_item_id: state.copiedItemId,
    after_id: selected?.id || null
  };
  const payload = await api(`/api/wafers/${state.current.id}/paste`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  state.selectedItemId = payload.item.id;
  await loadWafer(state.current.id);
}

async function duplicateCurrentWafer() {
  const current = state.current;
  const wafer_code = prompt("新片号", `${current.wafer_code}-copy`);
  if (!wafer_code) return;
  const payload = await api(`/api/wafers/${current.id}/duplicate`, {
    method: "POST",
    body: JSON.stringify({ wafer_code })
  });
  await loadWafers(payload.wafer.id);
}

async function importExcel() {
  showStatus("导入中");
  try {
    const payload = await api("/api/import/excel", {
      method: "POST",
      body: JSON.stringify({})
    });
    const count = payload.imported.length;
    showStatus(`已导入 ${count} 个`);
    await loadWafers(payload.imported[0]?.wafer_code ? null : state.current?.id);
  } catch (error) {
    showError(error);
  }
}

function downloadExport(kind) {
  const waferId = state.current?.id;
  if (!waferId) return;
  window.location.href = `/api/export/${kind}?wafer_id=${waferId}`;
}

function selectItem(id) {
  state.selectedItemId = id;
  renderItems();
}

function selectedItem() {
  if (!state.current || !state.selectedItemId) return null;
  return state.current.items.find((item) => item.id === state.selectedItemId) || null;
}

function childMap() {
  const map = new Map();
  (state.current?.items || []).forEach((item) => {
    const key = item.parent_id || null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  map.forEach((items) => items.sort((a, b) => a.order_index - b.order_index || a.id - b.id));
  return map;
}

function flattenItems(parentId = null, depth = 0, map = childMap()) {
  const rows = [];
  (map.get(parentId) || []).forEach((item) => {
    rows.push({ item, depth });
    rows.push(...flattenItems(item.id, depth + 1, map));
  });
  return rows;
}

function renderInspector() {
  if (!state.current) {
    els.stackVisual.innerHTML = `<div class="stack-empty">暂无结构</div>`;
    els.statsContent.innerHTML = "";
    els.totalThickness.textContent = "0 nm";
    return;
  }
  const map = childMap();
  const stats = computeStats(map);
  els.totalThickness.textContent = `${formatNumber(stats.totalThickness)} nm`;
  renderStack(map, stats);
  renderStats(stats);
}

function renderStack(map, stats) {
  const roots = map.get(null) || [];
  if (!roots.length) {
    els.stackVisual.innerHTML = `<div class="stack-empty">暂无结构</div>`;
    return;
  }
  els.stackVisual.innerHTML = roots
    .map((item, index) => {
      const computed = computeItem(item, map);
      const isRepeat = item.item_type === "repeat";
      const qdLike = item.is_quantum_dot || /(^|\s)(QD|quantum dot)|量子点/i.test(`${item.layer_name} ${item.material}`);
      const color = materialColor(item.material || item.layer_name || String(index));
      const flex = Math.max(computed.thickness, qdLike ? 0.08 : 0.02);
      const meta = stackMeta(item, computed);
      return `
        <div class="stack-segment ${isRepeat ? "repeat" : ""} ${hasDoping(item) ? "doped" : ""} ${qdLike ? "qd" : ""}"
          style="flex-grow:${flex}; background-color:${color}">
          <div class="segment-name">${escapeHtml(item.layer_name || item.material || "未命名层")}</div>
          <div class="segment-meta">${escapeHtml(meta)}</div>
        </div>
      `;
    })
    .join("");
}

function stackMeta(item, computed) {
  const material = item.material || "";
  const thickness = `${formatNumber(computed.thickness)} nm`;
  if (item.item_type === "repeat") {
    return `${material} · ${item.periods || 1}x · ${thickness}`;
  }
  if (item.is_quantum_dot) {
    return `${material} · 显示 / 不计厚度`;
  }
  return `${material} · ${thickness}`;
}

function renderStats(stats) {
  const maxMaterial = Math.max(...Object.values(stats.materialTotals), 1);
  const materialRows = Object.entries(stats.materialTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([material, value]) => `
      <div class="stat-row">
        <span>${escapeHtml(material)}</span>
        <strong>${formatNumber(value)} nm</strong>
        <span class="bar"><i style="width:${Math.max(2, (value / maxMaterial) * 100)}%"></i></span>
      </div>
    `)
    .join("");
  const dopedRows = stats.dopedItems
    .map((item) => `
      <div class="stat-row">
        <span>${escapeHtml(item.layer_name || item.material || "未命名层")}</span>
        <strong>${escapeHtml(item.doping)}</strong>
      </div>
    `)
    .join("");
  els.statsContent.innerHTML = `
    <div class="metric-grid">
      <div class="metric"><strong>${formatNumber(stats.totalThickness)}</strong><span>总厚度 nm</span></div>
      <div class="metric"><strong>${stats.layerCount}</strong><span>普通层</span></div>
      <div class="metric"><strong>${stats.repeatCount}</strong><span>重复块</span></div>
      <div class="metric"><strong>${stats.dopedItems.length}</strong><span>掺杂层</span></div>
    </div>
    <div>
      <div class="section-title"><h2>材料厚度</h2></div>
      <div class="material-list">${materialRows || `<span class="wafer-meta">暂无厚度</span>`}</div>
    </div>
    <div>
      <div class="section-title"><h2>掺杂信息</h2></div>
      <div class="doping-list">${dopedRows || `<span class="wafer-meta">无掺杂文本</span>`}</div>
    </div>
  `;
}

function computeStats(map) {
  const stats = {
    totalThickness: 0,
    materialTotals: {},
    dopedItems: [],
    layerCount: 0,
    repeatCount: 0
  };
  (map.get(null) || []).forEach((item) => {
    const result = computeItem(item, map, stats, 1);
    stats.totalThickness += result.thickness;
  });
  return stats;
}

function computeItem(item, map, stats = null, multiplier = 1) {
  if (stats && hasDoping(item)) stats.dopedItems.push(item);
  if (item.item_type === "repeat") {
    if (stats) stats.repeatCount += 1;
    const periods = Number(item.periods) || 1;
    const children = map.get(item.id) || [];
    if (children.length) {
      let periodThickness = 0;
      children.forEach((child) => {
        const childResult = computeItem(child, map, stats, multiplier * periods);
        periodThickness += childResult.thickness;
      });
      return { thickness: periodThickness * periods };
    }
    const single = numberValue(item.single_period_thickness_nm);
    const total = single * periods;
    addMaterial(stats, item.material, total * multiplier);
    return { thickness: total };
  }
  if (stats) stats.layerCount += 1;
  const visible = numberValue(item.thickness_nm);
  const effective = item.is_quantum_dot ? 0 : visible;
  addMaterial(stats, item.material, effective * multiplier);
  return { thickness: effective };
}

function addMaterial(stats, material, thickness) {
  if (!stats || !thickness) return;
  const key = material || "未填材料";
  stats.materialTotals[key] = (stats.materialTotals[key] || 0) + thickness;
}

function hasDoping(item) {
  const text = String(item.doping || "").trim().toLowerCase();
  return text !== "" && text !== "0" && text !== "0.0";
}

function loadShortcuts() {
  try {
    state.shortcuts = JSON.parse(localStorage.getItem("mbe-shortcuts") || "null") || DEFAULT_SHORTCUTS;
  } catch {
    state.shortcuts = DEFAULT_SHORTCUTS;
  }
}

function saveShortcuts() {
  localStorage.setItem("mbe-shortcuts", JSON.stringify(state.shortcuts));
}

function renderShortcuts() {
  const header = ["键", "层名", "材料", "厚度", "掺杂"].map((label) => `<div class="grid-label">${label}</div>`).join("");
  const rows = state.shortcuts
    .map((shortcut, index) => `
      <input data-shortcut-index="${index}" data-shortcut-field="key" value="${escapeAttr(shortcut.key)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="layer_name" value="${escapeAttr(shortcut.layer_name)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="material" value="${escapeAttr(shortcut.material)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="thickness_nm" value="${escapeAttr(shortcut.thickness_nm)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="doping" value="${escapeAttr(shortcut.doping)}" />
    `)
    .join("");
  els.shortcutList.innerHTML = header + rows;
}

function handleShortcutInput(event) {
  const input = event.target.closest("[data-shortcut-index]");
  if (!input) return;
  const index = Number(input.dataset.shortcutIndex);
  const field = input.dataset.shortcutField;
  state.shortcuts[index][field] = input.value;
  saveShortcuts();
}

function resetShortcuts() {
  state.shortcuts = DEFAULT_SHORTCUTS.map((shortcut) => ({ ...shortcut }));
  saveShortcuts();
  renderShortcuts();
}

function handleShortcutKey(event) {
  if (!event.altKey || event.metaKey || event.ctrlKey) return;
  const key = `Alt+${event.key.toUpperCase()}`;
  const shortcut = state.shortcuts.find((candidate) => candidate.key.toUpperCase() === key);
  if (!shortcut || !selectedItem()) return;
  event.preventDefault();
  applyShortcut(shortcut);
}

function applyShortcut(shortcut) {
  const item = selectedItem();
  if (!item) return;
  ["layer_name", "material", "thickness_nm", "doping"].forEach((field) => {
    if (shortcut[field] !== undefined) item[field] = shortcut[field];
  });
  scheduleItemSave(item);
  renderItems();
  renderInspector();
  showStatus(shortcut.key);
}

function pickWaferFields(wafer) {
  return {
    wafer_code: wafer.wafer_code,
    size: wafer.size,
    structure_name: wafer.structure_name,
    growth_date: wafer.growth_date,
    notes: wafer.notes
  };
}

function nextWaferCode() {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `N${yy}${mm}${dd}A`;
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function blankNumber(value) {
  return value === null || value === undefined ? "" : String(value);
}

function formatNumber(value) {
  const number = numberValue(value);
  if (Math.abs(number - Math.round(number)) < 0.0001) return String(Math.round(number));
  return number.toFixed(2).replace(/\.?0+$/, "");
}

function materialColor(name) {
  const palette = ["#dcebd7", "#e8dfc8", "#d8e9ed", "#ead9d1", "#dfe3c9", "#e7dce3", "#d7e2d6"];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function showStatus(message) {
  els.statusText.textContent = message;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => {
    els.statusText.textContent = "";
  }, 2200);
}

function showError(error) {
  console.error(error);
  showStatus(error.message || String(error));
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
