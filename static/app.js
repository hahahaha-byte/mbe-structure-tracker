const state = {
  wafers: [],
  current: null,
  selectedItemId: null,
  insertTargetItemId: null,
  copiedItemId: null,
  undoHistory: new Map(),
  collapsedItemIds: new Set(),
  shortcuts: [],
  saveTimers: new Map(),
  waferSaveTimer: null,
  rowAnimations: new Map(),
  rowAnimationTimer: null
};

const DEFAULT_SHORTCUTS = [
  { layer_name: "", material: "GaAs", thickness_nm: "", periods: "", single_period_thickness_nm: "", doping: "", doping_type: "", growth_temp: "", is_quantum_dot: 0, notes: "" },
  { layer_name: "", material: "AlGaAs", thickness_nm: "", periods: "", single_period_thickness_nm: "", doping: "", doping_type: "", growth_temp: "", is_quantum_dot: 0, notes: "" },
  { layer_name: "接触层", material: "GaAs contact layer", thickness_nm: "200", periods: "", single_period_thickness_nm: "", doping: "1E19", doping_type: "N", growth_temp: "", is_quantum_dot: 0, notes: "" },
  { layer_name: "波导层", material: "GaAs Waveguide layer", thickness_nm: "150", periods: "", single_period_thickness_nm: "", doping: "", doping_type: "", growth_temp: "", is_quantum_dot: 0, notes: "" },
  { layer_name: "", material: "", thickness_nm: "", periods: "", single_period_thickness_nm: "", doping: "Be-doping 10hole/dot", doping_type: "P", growth_temp: "", is_quantum_dot: 0, notes: "" },
  { layer_name: "", material: "", thickness_nm: "", periods: "", single_period_thickness_nm: "", doping: "Si-doping", doping_type: "N", growth_temp: "", is_quantum_dot: 0, notes: "" }
];

const STACK_VIEW_HEIGHT = 470;
const STACK_VIEW_THICKNESS_NM = 4000;
const STACK_MIN_LAYER_HEIGHT = 44;
const STACK_MIN_REPEAT_HEIGHT = 48;
const STACK_MIN_QD_HEIGHT = 32;
const STACK_REPEAT_HEADER_HEIGHT = 38;
const STACK_REPEAT_CHILD_PADDING_TOP = 6;
const STACK_REPEAT_CHILD_PADDING_BOTTOM = 7;
const STACK_REPEAT_CHILD_GAP = 4;

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  loadShortcuts();
  bindEvents();
  renderShortcuts();
  updateUndoButton();
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
  els.undoDeleteBtn = document.getElementById("undoDeleteBtn");
  els.jsonImportInput = document.getElementById("jsonImportInput");
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
  document.getElementById("importJsonBtn").addEventListener("click", () => els.jsonImportInput.click());
  els.jsonImportInput.addEventListener("change", importJsonFiles);
  document.getElementById("addShortcutBtn").addEventListener("click", addShortcut);
  els.searchInput.addEventListener("input", debounce(() => loadWafers(), 180));

  document.querySelector(".toolbar").addEventListener("click", handleToolbarClick);
  els.waferList.addEventListener("click", handleWaferListClick);
  els.layerTableBody.addEventListener("pointerdown", rememberTableTarget);
  els.layerTableBody.addEventListener("focusin", rememberTableTarget);
  els.layerTableBody.addEventListener("click", handleTableClick);
  els.layerTableBody.addEventListener("input", handleItemInput);
  els.layerTableBody.addEventListener("change", handleItemInput);
  els.shortcutList.addEventListener("input", handleShortcutInput);
  els.shortcutList.addEventListener("change", handleShortcutInput);
  els.shortcutList.addEventListener("click", handleShortcutClick);

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
    let payload = {};
    try {
      payload = await response.json();
      message = payload.error || message;
    } catch {
      // Keep response status text.
    }
    const error = new Error(message);
    error.status = response.status;
    error.code = payload.code || "";
    error.payload = payload;
    throw error;
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
    state.selectedItemId = null;
    state.insertTargetItemId = null;
    renderCurrent();
  }
}

async function loadWafer(id) {
  const payload = await api(`/api/wafers/${id}`);
  state.current = payload.wafer;
  if (!state.current.items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = state.current.items[0]?.id || null;
  }
  state.insertTargetItemId = state.selectedItemId;
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
  updateUndoButton();
}

function renderItems() {
  if (!state.current) {
    els.layerTableBody.innerHTML = "";
    return;
  }
  const map = childMap();
  const rows = flattenItems(null, 0, map);
  if (!rows.length) {
    els.layerTableBody.innerHTML = `
      <tr>
        <td colspan="12" class="wafer-meta">暂无层结构</td>
      </tr>
    `;
    return;
  }
  els.layerTableBody.innerHTML = rows.map(({ item, depth }) => renderItemRow(item, depth, map)).join("");
  scheduleRowAnimationClear();
}

function renderItemRow(item, depth, map) {
  const selected = item.id === state.selectedItemId ? "selected" : "";
  const children = map.get(item.id) || [];
  const repeat = isRepeatItem(item, map);
  const child = depth > 0 ? "child-row" : "";
  const expanded = isExpanded(item);
  const computed = computeItem(item, map);
  const periodThickness = children.length ? sumThickness(children, map) : numberValue(item.single_period_thickness_nm);
  const hasNestedRows = children.length > 0;
  const materialDisabled = repeat && hasNestedRows;
  const dopingDisabled = repeat && hasNestedRows;
  const qdDisabled = repeat && hasNestedRows;
  const rowLabel = repeat ? "重复层" : depth > 0 ? "子层" : "层";
  const rowClass = repeat ? "repeat-row" : child;
  const depthClass = depth > 0 ? "nested-row" : "root-row";
  const animationClass = rowAnimationClass(item);
  const levelOffset = depth * 32;
  const railOffset = Math.max(0, levelOffset - 16);
  const materialCell = materialDisabled
    ? lockedCell("展开子层，在子层里填写具体材料", "展开子层填写")
    : `<input data-field="material" value="${escapeAttr(item.material)}" />`;
  const thicknessCell = repeat
    ? lockedCell("重复层厚度由周期和子层自动计算", `自动 ${formatNumber(computed.thickness)}`)
    : `<input data-field="thickness_nm" class="${item.is_quantum_dot ? "qd-growth-input" : ""}" value="${escapeAttr(blankNumber(item.thickness_nm))}" placeholder="${item.is_quantum_dot ? "如 2.3ML" : "nm"}" />`;
  const singlePeriodCell = hasNestedRows
    ? lockedCell("单周期厚度由子层自动相加", `自动 ${formatNumber(periodThickness)}`)
    : repeat
      ? `<input data-field="single_period_thickness_nm" value="${escapeAttr(blankNumber(item.single_period_thickness_nm))}" />`
      : lockedCell("先在“周期”里填大于 1 的数字，再填写单周期厚度", "先填周期");
  const dopingCell = dopingDisabled
    ? lockedCell("展开子层，在具体子层里填写掺杂", "展开子层填写")
    : `<input data-field="doping" value="${escapeAttr(item.doping)}" />`;
  const dopingTypeCell = dopingDisabled
    ? lockedCell("展开子层，在具体子层里选择 N/P", "-")
    : dopingTypeSelect(item.doping_type);
  return `
    <tr class="${selected} ${rowClass} ${child} ${depthClass} ${animationClass}" data-id="${item.id}" data-depth="${depth}" style="--level-offset:${levelOffset}px; --rail-offset:${railOffset}px">
      <td class="action-cell">
        <div class="row-actions tree-actions">
          <button data-action="select-row" title="选择">•</button>
          <button data-action="toggle-expand" title="${expanded ? "收起" : "展开"}" ${repeat ? "" : "disabled"}>${repeat ? (expanded ? "▾" : "▸") : "·"}</button>
          <button data-action="move-up" title="上移">↑</button>
          <button data-action="move-down" title="下移">↓</button>
          <button data-action="add-inner-row" title="添加子层" ${repeat ? "" : "disabled"}>+</button>
          <button data-action="save-shortcut" title="加入快捷项">☆</button>
          <button data-action="delete-item" title="删除">×</button>
        </div>
      </td>
      <td class="status-cell"><span class="type-badge ${repeat ? "repeat" : depth > 0 ? "inner" : ""}">${rowLabel}</span></td>
      <td class="layer-name-cell">
        <div class="indent-cell">
          <input data-field="layer_name" value="${escapeAttr(item.layer_name)}" />
        </div>
      </td>
      <td>${materialCell}</td>
      <td>${thicknessCell}</td>
      <td><input data-field="periods" value="${escapeAttr(blankNumber(item.periods))}" /></td>
      <td>${singlePeriodCell}</td>
      <td>${dopingCell}</td>
      <td class="doping-type-cell">${dopingTypeCell}</td>
      <td><input data-field="growth_temp" value="${escapeAttr(item.growth_temp)}" /></td>
      <td class="checkbox-cell"><input data-field="is_quantum_dot" type="checkbox" ${item.is_quantum_dot ? "checked" : ""} ${qdDisabled ? "disabled" : ""} /></td>
      <td><input data-field="notes" value="${escapeAttr(item.notes)}" /></td>
    </tr>
  `;
}

function lockedCell(message, text) {
  return `<span class="locked-cell" data-lock-message="${escapeAttr(message)}" title="${escapeAttr(message)}">${escapeHtml(text)}</span>`;
}

function dopingTypeSelect(value, attrs = "") {
  const current = normalizeDopingType(value);
  return `
    <select data-field="doping_type" ${attrs}>
      <option value="" ${current ? "" : "selected"}>-</option>
      <option value="N" ${current === "N" ? "selected" : ""}>N</option>
      <option value="P" ${current === "P" ? "selected" : ""}>P</option>
    </select>
  `;
}

function shortcutDopingTypeSelect(value, index) {
  const current = normalizeDopingType(value);
  return `
    <select data-shortcut-index="${index}" data-shortcut-field="doping_type">
      <option value="" ${current ? "" : "selected"}>-</option>
      <option value="N" ${current === "N" ? "selected" : ""}>N</option>
      <option value="P" ${current === "P" ? "selected" : ""}>P</option>
    </select>
  `;
}

function queueRowAnimation(itemId, kind = "insert") {
  if (!itemId) return;
  state.rowAnimations.set(Number(itemId), kind);
}

function queueMoveAnimation(itemId, direction) {
  const partner = swapPartnerItem(itemId, direction);
  if (!partner) return;
  if (direction === "up") {
    queueRowAnimation(itemId, "swap-from-below");
    queueRowAnimation(partner.id, "swap-from-above");
  } else {
    queueRowAnimation(itemId, "swap-from-above");
    queueRowAnimation(partner.id, "swap-from-below");
  }
}

function rowAnimationClass(item) {
  const kind = state.rowAnimations.get(item.id);
  if (!kind) return "";
  return `row-animate row-animate-${kind}`;
}

function scheduleRowAnimationClear() {
  if (!state.rowAnimations.size) return;
  clearTimeout(state.rowAnimationTimer);
  state.rowAnimationTimer = setTimeout(() => {
    state.rowAnimations.clear();
    els.layerTableBody
      .querySelectorAll(".row-animate")
      .forEach((row) => {
        Array.from(row.classList)
          .filter((className) => className.startsWith("row-animate"))
          .forEach((className) => row.classList.remove(className));
      });
  }, 920);
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
    if (action === "add-layer") await addLayer();
    if (action === "add-inner-layer") await addInnerLayer();
    if (action === "undo-delete") await undoLastStep();
    if (action === "copy-item") copySelectedItem();
    if (action === "paste-item") await pasteItem();
    if (action === "duplicate-wafer") await duplicateCurrentWafer();
    if (action === "open-export") await openExportDialog();
  } catch (error) {
    showError(error);
  }
}

async function handleTableClick(event) {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const id = Number(row.dataset.id);
  const actionButton = event.target.closest("button[data-action]");
  const locked = event.target.closest("[data-lock-message]");
  if (event.target.closest("input, textarea, select")) {
    markSelectedRow(id);
    return;
  }
  if (locked) {
    selectItem(id);
    showStatus(locked.dataset.lockMessage);
    return;
  }
  if (!actionButton) {
    selectItem(id);
    return;
  }
  const action = actionButton.dataset.action;
  try {
    if (action === "select-row") selectItem(id);
    if (action === "toggle-expand") {
      toggleExpanded(id);
      renderItems();
    }
    if (action === "add-inner-row") {
      selectItem(id);
      await addInnerLayer();
    }
    if (action === "save-shortcut") {
      markSelectedRow(id);
      saveItemAsShortcut(id);
    }
    if (action === "move-up" || action === "move-down") {
      const direction = action === "move-up" ? "up" : "down";
      const partner = swapPartnerItem(id, direction);
      await api(`/api/items/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ direction })
      });
      state.selectedItemId = id;
      state.insertTargetItemId = id;
      if (partner) queueMoveAnimation(id, direction);
      await loadWafer(state.current.id);
    }
    if (action === "delete-item") {
      await deleteSelectedItem(id);
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
  const map = childMap();
  const wasRepeat = isRepeatItem(item, map);
  const field = input.dataset.field;
  const value = input.type === "checkbox" ? (input.checked ? 1 : 0) : input.value;
  item[field] = field === "doping_type" ? normalizeDopingType(value) : value;
  if (field === "is_quantum_dot") {
    if (item.is_quantum_dot && ["", "0", "0.0"].includes(String(item.thickness_nm ?? "").trim())) {
      item.thickness_nm = "";
    }
    if (!item.is_quantum_dot && !isNumericText(item.thickness_nm)) {
      item.thickness_nm = "";
    }
  }
  normalizeRepeatState(item, map);
  state.selectedItemId = id;
  scheduleItemSave(item);
  renderInspector();
  if ((field === "periods" && wasRepeat !== isRepeatItem(item, map)) || field === "is_quantum_dot") {
    renderItems();
  }
}

function handleWaferInput(event) {
  if (!state.current) return;
  const field = event.target.dataset.waferField;
  const waferId = state.current.id;
  state.current[field] = event.target.value;
  clearTimeout(state.waferSaveTimer);
  state.waferSaveTimer = setTimeout(async () => {
    try {
      await api(`/api/wafers/${waferId}`, {
        method: "PUT",
        body: JSON.stringify(pickWaferFields(state.current))
      });
      showStatus("已保存");
      await loadWafers(waferId);
    } catch (error) {
      showError(error);
      if (field === "wafer_code" && isDuplicateWaferError(error)) {
        await loadWafer(waferId);
      }
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
          body: JSON.stringify(itemPayload(item))
        });
        showStatus("已保存");
      } catch (error) {
        showError(error);
      }
    }, 260)
  );
}

async function createNewWafer() {
  try {
    const wafer_code = prompt("片号", await nextWaferCode());
    if (!wafer_code) return;
    const payload = await api("/api/wafers", {
      method: "POST",
      body: JSON.stringify({ wafer_code, size: "3英寸", structure_name: "" })
    });
    state.selectedItemId = null;
    state.insertTargetItemId = null;
    await loadWafers(payload.wafer.id);
  } catch (error) {
    showError(error);
  }
}

async function addLayer() {
  const target = insertionTargetItem() || firstVisibleItem();
  const reference = insertionReference(target);
  const payload = await api(`/api/wafers/${state.current.id}/items`, {
    method: "POST",
    body: JSON.stringify({
      item_type: "layer",
      ...reference.payload,
      layer_name: "新层",
      material: "",
      thickness_nm: 0
    })
  });
  state.selectedItemId = payload.item.id;
  state.insertTargetItemId = payload.item.id;
  await ensureItemBefore(payload.item.id, target?.id || null);
  queueRowAnimation(payload.item.id, "insert");
  await loadWafer(state.current.id);
}

async function addInnerLayer() {
  const selected = insertionTargetItem();
  const map = childMap();
  let parent = selected && isRepeatItem(selected, map) ? selected : null;
  let beforeTarget = null;
  if (!parent && selected?.parent_id) {
    const maybeParent = state.current.items.find((item) => item.id === selected.parent_id);
    if (maybeParent && isRepeatItem(maybeParent, map)) {
      parent = maybeParent;
      beforeTarget = selected;
    }
  }
  if (!parent && selected && numberValue(selected.periods) > 1) {
    selected.item_type = "repeat";
    selected.material = "";
    selected.doping = "";
    selected.doping_type = "";
    selected.thickness_nm = null;
    scheduleItemSave(selected);
    parent = selected;
  }
  if (!parent) {
    showStatus("先选一层并填写周期 > 1");
    return;
  }
  parent.material = "";
  parent.doping = "";
  parent.doping_type = "";
  parent.thickness_nm = null;
  parent.single_period_thickness_nm = null;
  parent.is_quantum_dot = 0;
  scheduleItemSave(parent);
  state.collapsedItemIds.delete(parent.id);
  if (!beforeTarget) {
    beforeTarget = (map.get(parent.id) || [])[0] || null;
  }
  const reference = insertionReference(beforeTarget, parent.id);
  const payload = await api(`/api/wafers/${state.current.id}/items`, {
    method: "POST",
    body: JSON.stringify({
      ...reference.payload,
      item_type: "layer",
      layer_name: "子层",
      material: "",
      thickness_nm: 0
    })
  });
  state.selectedItemId = payload.item.id;
  state.insertTargetItemId = payload.item.id;
  await ensureItemBefore(payload.item.id, beforeTarget?.id || null);
  queueRowAnimation(payload.item.id, "insert");
  await loadWafer(state.current.id);
}

async function deleteSelectedItem(id) {
  const payload = await api(`/api/items/${id}`, { method: "DELETE" });
  if (payload.deleted) {
    pushUndoStep({
      type: "delete",
      waferId: state.current.id,
      tree: payload.deleted,
      label: payload.deleted.layer_name || payload.deleted.material || "层"
    });
  }
  state.selectedItemId = null;
  state.insertTargetItemId = null;
  updateUndoButton();
  await loadWafer(state.current.id);
  showStatus("已删除，可撤回上一步");
}

async function undoLastStep() {
  const stack = currentUndoStack();
  const step = stack.pop();
  if (!step || !state.current || step.waferId !== state.current.id) {
    updateUndoButton();
    return;
  }
  if (step.type !== "delete") {
    updateUndoButton();
    return;
  }
  const payload = await api(`/api/wafers/${state.current.id}/restore`, {
    method: "POST",
    body: JSON.stringify({ tree: step.tree })
  });
  state.selectedItemId = payload.item.id;
  state.insertTargetItemId = payload.item.id;
  remapPendingUndoParents(payload.id_map || {});
  updateUndoButton();
  queueRowAnimation(payload.item.id, "insert");
  await loadWafer(state.current.id);
  showStatus(stack.length ? `已撤回，还可撤回 ${stack.length} 步` : "已撤回");
}

function updateUndoButton() {
  if (!els.undoDeleteBtn) return;
  const stack = currentUndoStack(false);
  const step = stack[stack.length - 1];
  const active = Boolean(state.current && step);
  els.undoDeleteBtn.disabled = !active;
  els.undoDeleteBtn.textContent = active ? `撤回上一步（${stack.length}）：${step.label}` : "撤回上一步";
}

function currentUndoStack(create = true) {
  if (!state.current) return [];
  const waferId = state.current.id;
  if (!state.undoHistory.has(waferId) && create) {
    state.undoHistory.set(waferId, []);
  }
  return state.undoHistory.get(waferId) || [];
}

function pushUndoStep(step) {
  const stack = currentUndoStack();
  stack.push(step);
  if (stack.length > 50) stack.shift();
}

function remapPendingUndoParents(idMap) {
  const entries = Object.entries(idMap);
  if (!entries.length) return;
  const stack = currentUndoStack(false);
  stack.forEach((step) => {
    if (step.tree) remapTreeParentIds(step.tree, entries);
  });
}

function remapTreeParentIds(tree, entries) {
  entries.forEach(([oldId, newId]) => {
    if (String(tree.parent_id) === String(oldId)) {
      tree.parent_id = Number(newId);
    }
  });
  (tree.children || []).forEach((child) => remapTreeParentIds(child, entries));
}

function copySelectedItem() {
  const item = insertionTargetItem();
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
  const target = insertionTargetItem() || firstVisibleItem();
  const reference = insertionReference(target);
  const payload = await api(`/api/wafers/${state.current.id}/paste`, {
    method: "POST",
    body: JSON.stringify({
      source_item_id: state.copiedItemId,
      ...reference.payload
    })
  });
  state.selectedItemId = payload.item.id;
  state.insertTargetItemId = payload.item.id;
  await ensureItemBefore(payload.item.id, target?.id || null);
  queueRowAnimation(payload.item.id, "insert");
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

async function importJsonFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  showStatus("JSON 导入中");
  try {
    const parsedFiles = await Promise.all(files.map(readJsonImportFile));
    const resolved = await resolveImportConflicts(parsedFiles);
    if (!resolved.files.length) {
      showStatus("已取消导入");
      return;
    }
    const payload = await api("/api/import/json", {
      method: "POST",
      body: JSON.stringify({ files: resolved.files, conflict_strategy: "overwrite" })
    });
    const errorText = payload.errors?.length ? `，失败 ${payload.errors.length} 个` : "";
    const skipText = payload.skipped?.length || resolved.skipped ? `，跳过 ${(payload.skipped?.length || 0) + resolved.skipped} 个` : "";
    showStatus(`已导入 ${payload.imported.length} 个${skipText}${errorText}`);
    await loadWafers(state.current?.id || null);
  } catch (error) {
    showError(error);
  } finally {
    event.target.value = "";
  }
}

function readJsonImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve({ name: file.name, payload: JSON.parse(reader.result) });
      } catch (error) {
        reject(new Error(`${file.name} 不是有效 JSON`));
      }
    };
    reader.onerror = () => reject(new Error(`${file.name} 读取失败`));
    reader.readAsText(file);
  });
}

async function resolveImportConflicts(files) {
  const existingPayload = await api("/api/export/json");
  const usedCodes = new Set((existingPayload.wafers || []).map((wafer) => String(wafer.wafer_code || "").trim()).filter(Boolean));
  const plannedCodes = new Set(usedCodes);
  const resolvedFiles = [];
  let skipped = 0;
  let applyAllAction = "";
  for (const file of files) {
    const wafers = extractImportWafers(file.payload);
    const resolvedWafers = [];
    for (const wafer of wafers) {
      const code = String(wafer.wafer_code || "").trim();
      if (!code) {
        resolvedWafers.push(wafer);
        continue;
      }
      const duplicate = plannedCodes.has(code);
      if (!duplicate) {
        plannedCodes.add(code);
        resolvedWafers.push(wafer);
        continue;
      }
      const decision = applyAllAction ? { action: applyAllAction, applyAll: true } : await askImportConflictDecision(code);
      if (!decision) {
        skipped += 1;
        continue;
      }
      if (decision.applyAll) applyAllAction = decision.action;
      if (decision.action === "skip") {
        skipped += 1;
        continue;
      }
      const copy = { ...wafer };
      if (decision.action === "rename") {
        copy.wafer_code = uniqueWaferCodeForImport(code, plannedCodes);
      }
      plannedCodes.add(copy.wafer_code);
      resolvedWafers.push(copy);
    }
    if (resolvedWafers.length) {
      resolvedFiles.push({ name: file.name, payload: { wafers: resolvedWafers } });
    }
  }
  return { files: resolvedFiles, skipped };
}

function extractImportWafers(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.wafers)) return payload.wafers;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function uniqueWaferCodeForImport(code, usedCodes) {
  let candidate = `${code}-2`;
  let index = 2;
  while (usedCodes.has(candidate)) {
    index += 1;
    candidate = `${code}-${index}`;
  }
  return candidate;
}

async function loadAllExportWafers() {
  const payload = await api("/api/export/json");
  return payload.wafers || [];
}

async function openExportDialog() {
  const wafers = await loadAllExportWafers();
  if (!wafers.length) {
    showStatus("没有可导出的外延片");
    return;
  }
  const currentId = state.current?.id;
  const current = wafers.find((wafer) => wafer.id === currentId) || wafers[0];
  const html = `
    <div class="modal-backdrop">
      <div class="modal-panel export-panel">
        <div class="modal-title">
          <h2>导出</h2>
          <button data-modal-close title="关闭">×</button>
        </div>
        <label class="modal-field">
          <span>导出格式</span>
          <select id="exportFormat">
            <option value="json">JSON 数据</option>
            <option value="csv">CSV 表格</option>
            <option value="image">结构图图片 / 多页 PDF</option>
          </select>
        </label>
        <div class="modal-field">
          <span>导出范围</span>
          <div class="choice-row">
            <label><input name="exportScope" type="radio" value="current" checked /> 当前片：${escapeHtml(current.wafer_code)}</label>
            <label><input name="exportScope" type="radio" value="selected" /> 选择片号</label>
          </div>
        </div>
        <div class="export-select-list" id="exportSelectList">
          <div class="export-list-actions">
            <button type="button" data-export-select="all">全选</button>
            <button type="button" data-export-select="none">全不选</button>
          </div>
          ${wafers.map((wafer) => `
            <label class="export-wafer-option">
              <input type="checkbox" value="${wafer.id}" ${wafer.id === current.id ? "checked" : ""} />
              <span>${escapeHtml(wafer.wafer_code)}</span>
              <small>${escapeHtml(wafer.structure_name || "未命名结构")}</small>
            </label>
          `).join("")}
        </div>
        <div class="modal-actions">
          <button data-modal-close>取消</button>
          <button class="primary" id="confirmExportBtn">确认导出</button>
        </div>
      </div>
    </div>
  `;
  const modal = showModal(html);
  const scopeInputs = modal.querySelectorAll("input[name='exportScope']");
  const list = modal.querySelector("#exportSelectList");
  const syncScope = () => {
    list.classList.toggle("active", modal.querySelector("input[name='exportScope']:checked")?.value === "selected");
  };
  scopeInputs.forEach((input) => input.addEventListener("change", syncScope));
  syncScope();
  modal.querySelector("[data-export-select='all']").addEventListener("click", () => {
    modal.querySelectorAll(".export-wafer-option input").forEach((input) => { input.checked = true; });
  });
  modal.querySelector("[data-export-select='none']").addEventListener("click", () => {
    modal.querySelectorAll(".export-wafer-option input").forEach((input) => { input.checked = false; });
  });
  modal.querySelector("#confirmExportBtn").addEventListener("click", async () => {
    try {
      const format = modal.querySelector("#exportFormat").value;
      const scope = modal.querySelector("input[name='exportScope']:checked").value;
      const selected = scope === "current"
        ? [current]
        : wafers.filter((wafer) => modal.querySelector(`.export-wafer-option input[value="${wafer.id}"]`)?.checked);
      if (!selected.length) {
        showStatus("请选择至少一片");
        return;
      }
      closeModal(modal);
      await runExport(format, selected);
    } catch (error) {
      showError(error);
    }
  });
}

async function runExport(format, wafers) {
  if (format === "json") {
    downloadBlob(JSON.stringify({ wafers }, null, 2), "mbe-wafers.json", "application/json;charset=utf-8");
    showStatus(`已导出 ${wafers.length} 片 JSON`);
    return;
  }
  if (format === "csv") {
    downloadBlob(csvForWafers(wafers), "mbe-structure.csv", "text/csv;charset=utf-8");
    showStatus(`已导出 ${wafers.length} 片 CSV`);
    return;
  }
  if (wafers.length === 1) {
    await downloadWaferPng(wafers[0]);
    showStatus("当前片图片已导出");
    return;
  }
  await downloadWafersPdf(wafers);
  showStatus(`已导出 ${wafers.length} 片结构图 PDF`);
}

function askImportConflictDecision(waferCode) {
  return new Promise((resolve) => {
    const modal = showModal(`
      <div class="modal-backdrop">
        <div class="modal-panel">
          <div class="modal-title">
            <h2>片号重复</h2>
            <button data-modal-close title="关闭">×</button>
          </div>
          <p class="modal-copy">导入文件里有片号 <strong>${escapeHtml(waferCode)}</strong>，本地已经存在。</p>
          <div class="choice-grid">
            <label><input name="importConflictAction" type="radio" value="overwrite" checked /> 覆盖本地这片</label>
            <label><input name="importConflictAction" type="radio" value="rename" /> 自动重命名为唯一片号</label>
            <label><input name="importConflictAction" type="radio" value="skip" /> 跳过这片</label>
          </div>
          <label class="modal-check">
            <input id="applyImportConflictAll" type="checkbox" />
            后续重复片号都这样处理
          </label>
          <div class="modal-actions">
            <button data-modal-close>取消这片</button>
            <button class="primary" id="confirmImportConflictBtn">继续导入</button>
          </div>
        </div>
      </div>
    `, () => resolve(null));
    modal.querySelector("#confirmImportConflictBtn").addEventListener("click", () => {
      const action = modal.querySelector("input[name='importConflictAction']:checked").value;
      const applyAll = modal.querySelector("#applyImportConflictAll").checked;
      closeModal(modal);
      resolve({ action, applyAll });
    });
  });
}

function csvForWafers(wafers) {
  const rows = [[
    "wafer_code",
    "size",
    "structure_name",
    "path",
    "type",
    "layer_name",
    "material",
    "thickness_nm",
    "periods",
    "single_period_thickness_nm",
    "doping",
    "doping_type",
    "growth_temp",
    "is_quantum_dot",
    "notes"
  ]];
  wafers.forEach((wafer) => {
    const map = childMapForItems(wafer.items || []);
    writeCsvItemRows(rows, wafer, map, null, "");
  });
  return `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

function writeCsvItemRows(rows, wafer, map, parentId, prefix) {
  (map.get(parentId) || []).forEach((item, index) => {
    const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    rows.push([
      wafer.wafer_code,
      wafer.size,
      wafer.structure_name,
      path,
      item.item_type,
      item.layer_name,
      item.material,
      blankNumber(item.thickness_nm),
      blankNumber(item.periods),
      blankNumber(item.single_period_thickness_nm),
      item.doping,
      item.doping_type,
      item.growth_temp,
      item.is_quantum_dot,
      item.notes
    ]);
    writeCsvItemRows(rows, wafer, map, item.id, path);
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function downloadWafersPdf(wafers) {
  showStatus(`正在生成 ${wafers.length} 页 PDF`);
  const pages = [];
  for (const wafer of wafers) {
    const canvas = renderWaferPngCanvas(wafer);
    const jpeg = await canvasToJpegBytes(canvas);
    pages.push({ wafer, jpeg, width: canvas.width, height: canvas.height });
  }
  const pdf = buildImagePdf(pages);
  downloadBlob(pdf, "mbe-structure-images.pdf", "application/pdf");
}

async function canvasToJpegBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("PDF 图片生成失败");
  return new Uint8Array(await blob.arrayBuffer());
}

function buildImagePdf(pages) {
  const encoder = new TextEncoder();
  const objects = [];
  const kids = [];
  const addObject = (chunks) => {
    objects.push(chunks);
    return objects.length;
  };
  addObject([]);
  addObject([]);
  pages.forEach((page, index) => {
    const pageWidth = 595;
    const pageHeight = Math.max(300, Math.round((page.height / page.width) * pageWidth));
    const imageName = `Im${index + 1}`;
    const imageObj = addObject([
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      "\nendstream"
    ]);
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ\n`;
    const contentBytes = encoder.encode(content);
    const contentObj = addObject([
      `<< /Length ${contentBytes.length} >>\nstream\n`,
      contentBytes,
      "endstream"
    ]);
    const pageObj = addObject([
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`
    ]);
    kids.push(`${pageObj} 0 R`);
  });
  objects[0] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  objects[1] = [`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`];

  const chunks = [encoder.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets[index + 1] = length;
    const header = encoder.encode(`${index + 1} 0 obj\n`);
    chunks.push(header);
    length += header.length;
    object.forEach((chunk) => {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      chunks.push(bytes);
      length += bytes.length;
    });
    const footer = encoder.encode("\nendobj\n");
    chunks.push(footer);
    length += footer.length;
  });
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(encoder.encode(xref));
  return new Blob(chunks, { type: "application/pdf" });
}

function showModal(html, onClose = null) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  const modal = wrapper.firstElementChild;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(modal);
      if (onClose) onClose();
    });
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal(modal);
      if (onClose) onClose();
    }
  });
  return modal;
}

function closeModal(modal) {
  modal.remove();
}

async function downloadWaferPng(wafer) {
  const canvas = renderWaferPngCanvas(wafer);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("图片生成失败");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeFilename(wafer.wafer_code || "wafer")}-structure.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function renderWaferPngCanvas(wafer) {
  const map = childMapForItems(wafer.items || []);
  const roots = map.get(null) || [];
  const segments = stackCanvasParts(roots, map, true, STACK_VIEW_HEIGHT);
  const stackHeight = Math.max(STACK_VIEW_HEIGHT, Math.ceil(sumCanvasHeights(segments)));
  const width = 980;
  const height = stackHeight + 150;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  drawReportHeader(ctx, wafer, width);
  drawStackParts(ctx, segments, map, 40, 110, 620, stackHeight);
  return canvas;
}

function drawReportHeader(ctx, wafer, width) {
  const stats = computeStats(childMapForItems(wafer.items || []));
  ctx.fillStyle = "#18201d";
  ctx.font = "700 26px sans-serif";
  ctx.fillText(wafer.wafer_code || "未命名片号", 40, 48);
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#68726b";
  ctx.fillText(`${wafer.structure_name || "未命名结构"} · ${wafer.size || ""}`, 40, 78);
  ctx.textAlign = "right";
  ctx.fillStyle = "#18201d";
  ctx.font = "700 20px sans-serif";
  ctx.fillText(`${formatNumber(stats.totalThickness)} nm`, width - 40, 48);
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#68726b";
  ctx.fillText(`${stats.layerCount} 层 · ${stats.repeatCount} 重复层 · ${formatNumber(stats.qdLayerCount)} QD · ${stats.dopedItems.length} 掺杂层`, width - 40, 76);
  ctx.textAlign = "left";
}

function stackCanvasParts(items, map, fixedScale, availableHeight) {
  return stackLayoutParts(items, map, availableHeight, fixedScale);
}

function sumCanvasHeights(parts) {
  return stackLayoutHeight(parts);
}

function stackLayoutParts(items, map, availableHeight = STACK_VIEW_HEIGHT, fixedScale = false) {
  const parts = stackRenderableParts(items, map);
  const visibleParts = parts.filter((part) => part.item);
  const totalThickness = visibleParts.reduce((sum, part) => sum + computeItem(part.item, map).thickness, 0);
  return parts.map((part) => {
    if (part.qdMarker) return { ...part, height: STACK_MIN_QD_HEIGHT };
    const item = part.item;
    const computed = computeItem(item, map);
    const repeat = isRepeatItem(item, map);
    const baseHeight = fixedScale
      ? visualFixedScaleHeight(computed.thickness, repeat, false)
      : visualSegmentHeight(computed.thickness, totalThickness, availableHeight, repeat, false);
    const childItems = repeat ? map.get(item.id) || [] : [];
    let childParts = [];
    let height = baseHeight;
    if (childItems.length) {
      const childArea = Math.max(
        STACK_MIN_LAYER_HEIGHT,
        baseHeight - STACK_REPEAT_HEADER_HEIGHT - STACK_REPEAT_CHILD_PADDING_TOP - STACK_REPEAT_CHILD_PADDING_BOTTOM
      );
      childParts = stackLayoutParts(childItems, map, childArea, false);
      height = Math.max(baseHeight, repeatHeightForChildren(childParts));
    }
    return { ...part, computed, height, childParts };
  });
}

function stackRenderableParts(items, map) {
  const parts = [];
  items.forEach((item, index) => {
    if (!isRepeatItem(item, map) && isQuantumDot(item)) {
      const previous = lastStackSegment(parts);
      if (previous) {
        previous.qdMarkers.push(item);
      } else {
        parts.push({ qdMarker: item });
      }
      return;
    }
    parts.push({ item, index, qdMarkers: [] });
  });
  return parts;
}

function repeatHeightForChildren(childParts) {
  return STACK_REPEAT_HEADER_HEIGHT
    + STACK_REPEAT_CHILD_PADDING_TOP
    + stackLayoutHeight(childParts, STACK_REPEAT_CHILD_GAP)
    + STACK_REPEAT_CHILD_PADDING_BOTTOM;
}

function stackLayoutHeight(parts, gap = 0) {
  if (!parts.length) return 0;
  return parts.reduce((sum, part) => sum + part.height, 0) + gap * (parts.length - 1);
}

function drawStackParts(ctx, parts, map, x, y, width, stackHeight, gap = 0) {
  ctx.save();
  roundedRect(ctx, x, y, width, stackHeight, 10);
  ctx.clip();
  ctx.fillStyle = "#f9faf8";
  ctx.fillRect(x, y, width, stackHeight);
  let cursor = y;
  parts.forEach((part) => {
    if (part.qdMarker) {
      drawQdMarkerSegment(ctx, part.qdMarker, x, cursor, width, part.height);
    } else {
      drawCanvasSegment(ctx, part, map, x, cursor, width, part.height);
    }
    cursor += part.height + gap;
  });
  ctx.restore();
  ctx.strokeStyle = "#d9ded6";
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, width, stackHeight, 10);
  ctx.stroke();
}

function drawCanvasSegment(ctx, part, map, x, y, width, height) {
  const item = part.item;
  const repeat = isRepeatItem(item, map);
  const childParts = part.childParts || [];
  ctx.fillStyle = materialColor(item.material || item.layer_name || String(part.index));
  ctx.fillRect(x, y, width, height);
  if (repeat) drawRepeatPattern(ctx, x, y, width, height);
  ctx.strokeStyle = "rgba(24,32,29,0.16)";
  ctx.strokeRect(x, y, width, height);
  if (part.qdMarkers.length) drawQdDotsCanvas(ctx, x + 12, y + height - 17, width - 24, part.qdMarkers);
  drawSegmentText(ctx, item.layer_name || item.material || "未命名层", stackMeta(item, part.computed, map, part.qdMarkers), x, y, width, height);
  if (hasDoping(item)) drawDopedBadge(ctx, x + width - 30, y + height / 2);
  if (repeat && childParts.length) {
    const childHeight = stackLayoutHeight(childParts, STACK_REPEAT_CHILD_GAP);
    drawStackParts(
      ctx,
      childParts,
      map,
      x + 28,
      y + STACK_REPEAT_HEADER_HEIGHT + STACK_REPEAT_CHILD_PADDING_TOP,
      width - 46,
      childHeight,
      STACK_REPEAT_CHILD_GAP
    );
  }
}

function drawQdMarkerSegment(ctx, item, x, y, width, height) {
  ctx.fillStyle = materialColor(item.material || item.layer_name || "QD");
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(191,77,111,0.35)";
  ctx.strokeRect(x, y, width, height);
  drawQdDotsCanvas(ctx, x + 12, y + Math.max(6, height - 16), width - 24, [item]);
  drawSegmentText(ctx, item.layer_name || item.material || "QD", stackMeta(item, { thickness: 0 }, new Map()), x, y, width, height);
}

function drawSegmentText(ctx, name, meta, x, y, width, height) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 8, y + 2, width - 56, height - 4);
  ctx.clip();
  ctx.fillStyle = "#121714";
  ctx.font = "700 16px sans-serif";
  ctx.fillText(name, x + 14, y + Math.min(24, Math.max(18, height / 2)));
  if (height >= 42) {
    ctx.fillStyle = "rgba(24,32,29,0.72)";
    ctx.font = "14px sans-serif";
    ctx.fillText(meta, x + 14, y + Math.min(46, Math.max(34, height / 2 + 18)));
  }
  ctx.restore();
}

function drawQdDotsCanvas(ctx, x, y, width, items) {
  ctx.fillStyle = "rgba(191,77,111,0.92)";
  const count = Math.max(8, Math.min(42, Math.floor(width / 16)));
  for (let index = 0; index < count; index += 1) {
    ctx.beginPath();
    ctx.arc(x + 8 + index * 15, y + 5, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRepeatPattern(ctx, x, y, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(92,109,57,0.2)";
  ctx.lineWidth = 8;
  for (let offset = -height; offset < width; offset += 18) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + height);
    ctx.lineTo(x + offset + height, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#5c6d39";
  ctx.fillRect(x, y, 6, height);
  ctx.restore();
}

function drawDopedBadge(ctx, x, y) {
  ctx.fillStyle = "#f2a33a";
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3c2607";
  ctx.font = "800 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("D", x, y + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function childMapForItems(items) {
  const map = new Map();
  (items || []).forEach((item) => {
    const key = item.parent_id || null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  map.forEach((group) => group.sort((a, b) => a.order_index - b.order_index || a.id - b.id));
  return map;
}

function safeFilename(value) {
  return String(value || "wafer").replace(/[\\/:*?"<>|]+/g, "_");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectItem(id) {
  state.selectedItemId = id;
  state.insertTargetItemId = id;
  renderItems();
}

function markSelectedRow(id) {
  state.selectedItemId = id;
  state.insertTargetItemId = id;
  els.layerTableBody.querySelectorAll("tr[data-id]").forEach((row) => {
    row.classList.toggle("selected", Number(row.dataset.id) === id);
  });
}

function rememberTableTarget(event) {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  markSelectedRow(Number(row.dataset.id));
}

function selectedItem() {
  if (!state.current || !state.selectedItemId) return null;
  return state.current.items.find((item) => item.id === state.selectedItemId) || null;
}

function insertionTargetItem() {
  if (!state.current) return null;
  const activeRow = document.activeElement?.closest?.("tr[data-id]");
  const ids = [
    activeRow ? Number(activeRow.dataset.id) : null,
    state.insertTargetItemId,
    state.selectedItemId
  ];
  for (const id of ids) {
    if (!id) continue;
    const item = state.current.items.find((candidate) => candidate.id === id);
    if (item) return item;
  }
  return null;
}

function swapPartnerItem(itemId, direction) {
  if (!state.current) return null;
  const item = state.current.items.find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const siblings = childMap().get(item.parent_id || null) || [];
  const index = siblings.findIndex((candidate) => candidate.id === itemId);
  const partnerIndex = direction === "up" ? index - 1 : index + 1;
  return siblings[partnerIndex] || null;
}

function insertionReference(target, fallbackParentId = null) {
  if (!target) {
    return { targetId: null, payload: { parent_id: fallbackParentId } };
  }
  const map = childMap();
  const siblings = map.get(target.parent_id || null) || [];
  const index = siblings.findIndex((item) => item.id === target.id);
  const previous = index > 0 ? siblings[index - 1] : null;
  return {
    targetId: target.id,
    payload: {
      parent_id: target.parent_id ?? fallbackParentId,
      before_id: target.id,
      after_id: previous?.id || null
    }
  };
}

async function ensureItemBefore(itemId, targetId) {
  if (!targetId) return;
  for (let index = 0; index < 80; index += 1) {
    const payload = await api(`/api/wafers/${state.current.id}`);
    const item = payload.wafer.items.find((candidate) => candidate.id === itemId);
    const target = payload.wafer.items.find((candidate) => candidate.id === targetId);
    if (!item || !target || item.parent_id !== target.parent_id) return;
    if (Number(item.order_index) < Number(target.order_index)) return;
    await api(`/api/items/${itemId}/move`, {
      method: "POST",
      body: JSON.stringify({ direction: "up" })
    });
  }
}

function firstVisibleItem() {
  if (!state.current) return null;
  return flattenItems(null, 0, childMap())[0]?.item || null;
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
    if (isRepeatItem(item, map) && isExpanded(item)) {
      rows.push(...flattenItems(item.id, depth + 1, map));
    }
  });
  return rows;
}

function isRepeatItem(item, map = childMap()) {
  return item.item_type === "repeat" || numberValue(item.periods) > 1 || (map.get(item.id) || []).length > 0;
}

function isExpanded(item) {
  return !state.collapsedItemIds.has(item.id);
}

function toggleExpanded(id) {
  if (state.collapsedItemIds.has(id)) {
    state.collapsedItemIds.delete(id);
  } else {
    state.collapsedItemIds.add(id);
  }
}

function normalizeRepeatState(item, map = childMap()) {
  const hasChildren = (map.get(item.id) || []).length > 0;
  const periods = numberValue(item.periods);
  if (periods > 1 || hasChildren) {
    item.item_type = "repeat";
    item.thickness_nm = null;
    if (hasChildren) {
      item.material = "";
      item.doping = "";
      item.doping_type = "";
      item.single_period_thickness_nm = null;
      item.is_quantum_dot = 0;
    }
  } else {
    item.item_type = "layer";
    item.periods = "";
    item.single_period_thickness_nm = null;
  }
}

function itemPayload(item) {
  const clone = { ...item };
  delete clone.children;
  normalizeRepeatState(clone, childMap());
  return clone;
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
  renderStack(map);
  renderStats(stats);
}

function renderStack(map) {
  const roots = map.get(null) || [];
  if (!roots.length) {
    els.stackVisual.innerHTML = `<div class="stack-empty">暂无结构</div>`;
    return;
  }
  els.stackVisual.innerHTML = renderStackItems(roots, map, 0, STACK_VIEW_HEIGHT, true);
}

function renderStackItems(items, map, depth, availableHeight = STACK_VIEW_HEIGHT, fixedScale = false) {
  return renderStackLayout(stackLayoutParts(items, map, availableHeight, fixedScale), map, depth);
}

function renderStackLayout(parts, map, depth) {
  return parts
    .map((part) => {
      if (part.qdMarker) return renderQdMarker(part.qdMarker, depth, part.height);
      return renderStackSegment(part, map, depth);
    })
    .join("");
}

function lastStackSegment(parts) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].item) return parts[index];
  }
  return null;
}

function renderStackSegment(part, map, depth) {
  const item = part.item;
  const computed = part.computed;
  const repeat = isRepeatItem(item, map);
  const childParts = part.childParts || [];
  const hasChildren = repeat && childParts.length > 0;
  const qdCap = part.qdMarkers.length > 0;
  const color = materialColor(item.material || item.layer_name || String(part.index));
  const height = part.height;
  const childHtml = hasChildren ? renderStackLayout(childParts, map, depth + 1) : "";
  const classes = [
    "stack-segment",
    repeat ? "repeat" : "",
    hasChildren ? "with-children" : "",
    hasDoping(item) ? "doped" : "",
    qdCap ? "qd-cap" : "",
    height < 40 ? "compact" : "",
    computed.thickness > 0 && computed.thickness < 30 ? "thin-layer" : ""
  ].filter(Boolean).join(" ");
  return `
    <div class="${classes}" style="height:${height}px; min-height:${height}px; background-color:${color}; --stack-depth:${depth}">
      <div class="segment-header">
        <div class="segment-name">${escapeHtml(item.layer_name || item.material || "未命名层")}</div>
        <div class="segment-meta">${escapeHtml(stackMeta(item, computed, map, part.qdMarkers))}</div>
      </div>
      ${qdCap ? renderQdDots(part.qdMarkers) : ""}
      ${hasChildren ? `<div class="repeat-children">${childHtml}</div>` : ""}
    </div>
  `;
}

function renderQdDots(items) {
  const label = items.map((item) => qdGrowthText(item)).filter(Boolean).join(" + ");
  return `<div class="qd-dots" title="${escapeAttr(label ? `QD ${label}` : "QD")}"></div>`;
}

function renderQdMarker(item, depth, height = STACK_MIN_QD_HEIGHT) {
  const color = materialColor(item.material || item.layer_name || "QD");
  return `
    <div class="stack-segment qd-marker compact" style="height:${height}px; min-height:${height}px; background-color:${color}; --stack-depth:${depth}">
      <div class="qd-dots"></div>
      <div class="segment-header">
        <div class="segment-name">${escapeHtml(item.layer_name || item.material || "QD")}</div>
        <div class="segment-meta">${escapeHtml(stackMeta(item, { thickness: 0 }, new Map()))}</div>
      </div>
    </div>
  `;
}

function stackMeta(item, computed, map, qdMarkers = []) {
  const material = item.material || "";
  const thickness = `${formatNumber(computed.thickness)} nm`;
  const qdText = qdMarkers.length ? ` · QD ${qdMarkers.map(qdGrowthText).filter(Boolean).join(" + ") || "标记"}` : "";
  if (isRepeatItem(item, map)) {
    const childCount = (map.get(item.id) || []).length;
    return `${item.periods || 1}x · ${childCount ? `${childCount} 子层 · ` : material ? `${material} · ` : ""}${thickness}${qdText}`;
  }
  if (isQuantumDot(item)) {
    const growth = qdGrowthText(item);
    return `${material}${growth ? ` · ${growth}` : ""} · 不计厚度`;
  }
  return `${material} · ${thickness}${qdText}`;
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
    .map((detail) => `
      <div class="stat-row">
        <span>${escapeHtml(detail.path)}</span>
        <strong>${escapeHtml(dopingDetailText(detail))}</strong>
      </div>
    `)
    .join("");
  const qdRows = stats.qdItems
    .map((detail) => `
      <div class="stat-row">
        <span>${escapeHtml(detail.path)}</span>
        <strong>${escapeHtml(qdDetailText(detail))}</strong>
      </div>
    `)
    .join("");
  const activeRegionRows = stats.activeRegionDopedItems
    .map((detail) => `
      <div class="stat-row">
        <span>${escapeHtml(detail.path)}</span>
        <strong>${escapeHtml(dopingDetailText(detail))}</strong>
      </div>
    `)
    .join("");
  els.statsContent.innerHTML = `
    <div class="metric-grid">
      <div class="metric"><strong>${formatNumber(stats.totalThickness)}</strong><span>总厚度 nm</span></div>
      <div class="metric"><strong>${stats.layerCount}</strong><span>层</span></div>
      <div class="metric"><strong>${stats.repeatCount}</strong><span>重复层</span></div>
      <div class="metric"><strong>${stats.dopedItems.length}</strong><span>掺杂层</span></div>
      <div class="metric"><strong>${formatNumber(stats.qdLayerCount)}</strong><span>量子点层数</span></div>
      <div class="metric"><strong>${formatNumber(stats.qdDopedLayerCount)}</strong><span>QD 掺杂层数</span></div>
    </div>
    <div>
      <div class="section-title"><h2>材料厚度</h2></div>
      <div class="material-list">${materialRows || `<span class="wafer-meta">暂无厚度</span>`}</div>
    </div>
    <div>
      <div class="section-title"><h2>掺杂信息</h2></div>
      <div class="doping-list">${dopedRows || `<span class="wafer-meta">无掺杂文本</span>`}</div>
    </div>
    <div>
      <div class="section-title"><h2>量子点掺杂</h2></div>
      <div class="doping-list">${qdRows || `<span class="wafer-meta">无量子点层</span>`}</div>
    </div>
    <div>
      <div class="section-title"><h2>有源区掺杂</h2></div>
      <div class="doping-list">${activeRegionRows || `<span class="wafer-meta">无有源区掺杂文本</span>`}</div>
    </div>
  `;
}

function computeStats(map) {
  const stats = {
    totalThickness: 0,
    materialTotals: {},
    dopedItems: [],
    qdItems: [],
    qdDopedItems: [],
    activeRegionDopedItems: [],
    qdLayerCount: 0,
    qdDopedLayerCount: 0,
    layerCount: 0,
    repeatCount: 0
  };
  (map.get(null) || []).forEach((item) => {
    const result = computeItem(item, map, stats, 1, []);
    stats.totalThickness += result.thickness;
  });
  return stats;
}

function computeItem(item, map, stats = null, multiplier = 1, ancestors = []) {
  const repeat = isRepeatItem(item, map);
  const path = [...ancestors, item];
  if (stats) collectItemStats(stats, item, path, multiplier, repeat);
  if (repeat) {
    if (stats) stats.repeatCount += 1;
    const periods = numberValue(item.periods) || 1;
    const children = map.get(item.id) || [];
    if (children.length) {
      let periodThickness = 0;
      children.forEach((child) => {
        const childResult = computeItem(child, map, stats, multiplier * periods, path);
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
  const effective = isQuantumDot(item) ? 0 : visible;
  addMaterial(stats, item.material, effective * multiplier);
  return { thickness: effective };
}

function collectItemStats(stats, item, path, multiplier, repeat) {
  const detail = statDetail(item, path, multiplier);
  if (hasDoping(item)) {
    stats.dopedItems.push(detail);
    if (path.some(isActiveRegionItem)) stats.activeRegionDopedItems.push(detail);
  }
  if (!repeat && isQuantumDot(item)) {
    stats.qdLayerCount += multiplier;
    stats.qdItems.push(detail);
    if (hasDoping(item)) {
      stats.qdDopedItems.push(detail);
      stats.qdDopedLayerCount += multiplier;
    }
  }
}

function statDetail(item, path, multiplier) {
  return {
    item,
    path: path.map(itemDisplayName).join(" / "),
    occurrences: multiplier,
    doping: item.doping || "",
    doping_type: normalizeDopingType(item.doping_type),
    is_quantum_dot: isQuantumDot(item)
  };
}

function itemDisplayName(item) {
  return item.layer_name || item.material || "未命名层";
}

function dopingDetailText(detail, emptyText = "未掺杂") {
  const type = normalizeDopingType(detail.doping_type);
  const text = String(detail.doping || "").trim();
  const prefix = detail.occurrences > 1 ? `×${formatNumber(detail.occurrences)} · ` : "";
  if (type && text) return `${prefix}${type} · ${text}`;
  if (type) return `${prefix}${type} · 未填浓度`;
  if (text) return `${prefix}${text}`;
  return `${prefix}${emptyText}`;
}

function qdDetailText(detail) {
  return dopingDetailText(detail, "未掺杂");
}

function isActiveRegionItem(item) {
  return /有源区|active/i.test(`${item.layer_name || ""} ${item.material || ""}`);
}

function isQuantumDot(item) {
  return Boolean(item.is_quantum_dot) || /(^|\s)(QD|quantum dot)|量子点/i.test(`${item.layer_name} ${item.material}`);
}

function qdGrowthText(item) {
  const value = String(item.thickness_nm ?? "").trim();
  if (!value || value === "0" || value === "0.0") return "";
  return value;
}

function visualSegmentHeight(thickness, totalThickness, availableHeight, repeat = false, isQdMarker = false) {
  const value = numberValue(thickness);
  const minHeight = isQdMarker ? STACK_MIN_QD_HEIGHT : repeat ? STACK_MIN_REPEAT_HEIGHT : STACK_MIN_LAYER_HEIGHT;
  if (value <= 0 || totalThickness <= 0) return minHeight;
  return Math.max(minHeight, (value / totalThickness) * availableHeight);
}

function visualFixedScaleHeight(thickness, repeat = false, isQdMarker = false) {
  const value = numberValue(thickness);
  const minHeight = isQdMarker ? STACK_MIN_QD_HEIGHT : repeat ? STACK_MIN_REPEAT_HEIGHT : STACK_MIN_LAYER_HEIGHT;
  if (value <= 0) return minHeight;
  return Math.max(minHeight, (value / STACK_VIEW_THICKNESS_NM) * STACK_VIEW_HEIGHT);
}

function sumThickness(items, map) {
  return items.reduce((sum, item) => sum + computeItem(item, map).thickness, 0);
}

function addMaterial(stats, material, thickness) {
  if (!stats || !thickness) return;
  const key = material || "未填材料";
  stats.materialTotals[key] = (stats.materialTotals[key] || 0) + thickness;
}

function hasDoping(item) {
  const text = String(item.doping || "").trim().toLowerCase();
  const type = normalizeDopingType(item.doping_type);
  return type !== "" || (text !== "" && text !== "0" && text !== "0.0");
}

function normalizeDopingType(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/型|掺杂|参杂/g, "");
  return text === "N" || text === "P" ? text : "";
}

function loadShortcuts() {
  try {
    state.shortcuts = JSON.parse(localStorage.getItem("mbe-shortcuts") || "null") || DEFAULT_SHORTCUTS;
  } catch {
    state.shortcuts = DEFAULT_SHORTCUTS;
  }
  state.shortcuts = state.shortcuts.map(normalizeShortcut);
}

function saveShortcuts() {
  localStorage.setItem("mbe-shortcuts", JSON.stringify(state.shortcuts));
}

function normalizeShortcut(shortcut) {
  const legacyLabel = shortcut.label || shortcut.key || "";
  const layerName = shortcut.layer_name || (
    !shortcut.material && !shortcut.thickness_nm && !shortcut.doping && legacyLabel ? legacyLabel : ""
  );
  return {
    item_type: shortcut.item_type || (numberValue(shortcut.periods) > 1 && !shortcut.is_quantum_dot ? "repeat" : "layer"),
    layer_name: layerName,
    material: shortcut.material || "",
    thickness_nm: shortcut.thickness_nm || "",
    periods: shortcut.periods || "",
    single_period_thickness_nm: shortcut.single_period_thickness_nm || "",
    doping: shortcut.doping || "",
    doping_type: normalizeDopingType(shortcut.doping_type),
    growth_temp: shortcut.growth_temp || "",
    is_quantum_dot: shortcut.is_quantum_dot ? 1 : 0,
    notes: shortcut.notes || "",
    children: (shortcut.children || []).map(normalizeShortcut)
  };
}

function renderShortcuts() {
  const header = ["层名", "材料", "厚度 nm / QD ML", "周期", "单周期 nm", "掺杂浓度", "N/P", "生长温度", "QD", "备注", "操作"]
    .map((label) => `<div class="grid-label">${label}</div>`)
    .join("");
  const rows = state.shortcuts
    .map((shortcut, index) => {
      const childCount = shortcutChildCount(shortcut);
      const insertTitle = childCount ? `在选中层上方插入完整结构，含 ${childCount} 个子层` : "在选中层上方插入";
      const removeTitle = childCount ? "删除这个快捷结构" : "删除这个快捷项";
      return `
      <input data-shortcut-index="${index}" data-shortcut-field="layer_name" value="${escapeAttr(shortcut.layer_name)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="material" value="${escapeAttr(shortcut.material)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="thickness_nm" value="${escapeAttr(shortcut.thickness_nm)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="periods" value="${escapeAttr(shortcut.periods)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="single_period_thickness_nm" value="${escapeAttr(shortcut.single_period_thickness_nm)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="doping" value="${escapeAttr(shortcut.doping)}" />
      ${shortcutDopingTypeSelect(shortcut.doping_type, index)}
      <input data-shortcut-index="${index}" data-shortcut-field="growth_temp" value="${escapeAttr(shortcut.growth_temp)}" />
      <label class="shortcut-check" title="量子点层">
        <input data-shortcut-index="${index}" data-shortcut-field="is_quantum_dot" type="checkbox" ${shortcut.is_quantum_dot ? "checked" : ""} />
      </label>
      <input data-shortcut-index="${index}" data-shortcut-field="notes" value="${escapeAttr(shortcut.notes)}" />
      <div class="shortcut-actions">
        ${childCount ? `<span class="shortcut-tree-badge" title="含 ${childCount} 个子层">结构</span>` : ""}
        <button class="quick-apply" data-shortcut-action="insert" data-shortcut-index="${index}" title="${escapeAttr(insertTitle)}">+</button>
        <button data-shortcut-action="remove" data-shortcut-index="${index}" title="${escapeAttr(removeTitle)}">×</button>
      </div>
    `;
    })
    .join("");
  els.shortcutList.innerHTML = header + rows;
}

function handleShortcutInput(event) {
  const input = event.target.closest("[data-shortcut-index]");
  if (!input || !input.dataset.shortcutField) return;
  const index = Number(input.dataset.shortcutIndex);
  const field = input.dataset.shortcutField;
  const value = input.type === "checkbox" ? (input.checked ? 1 : 0) : input.value;
  state.shortcuts[index][field] = field === "doping_type" ? normalizeDopingType(value) : value;
  saveShortcuts();
}

function handleShortcutClick(event) {
  const button = event.target.closest("[data-shortcut-action]");
  if (!button) return;
  const index = Number(button.dataset.shortcutIndex);
  const action = button.dataset.shortcutAction;
  if (action === "insert") {
    insertShortcutLayer(state.shortcuts[index]).catch(showError);
  }
  if (action === "remove") {
    state.shortcuts.splice(index, 1);
    saveShortcuts();
    renderShortcuts();
  }
}

function addShortcut() {
  state.shortcuts.push(normalizeShortcut({ layer_name: "新层" }));
  saveShortcuts();
  renderShortcuts();
}

async function insertShortcutLayer(shortcut) {
  if (!state.current) {
    showStatus("先选择外延片");
    return;
  }
  const target = insertionTargetItem() || firstVisibleItem();
  const tree = shortcutTreeForInsert(shortcut, target);
  const result = await api(`/api/wafers/${state.current.id}/restore`, {
    method: "POST",
    body: JSON.stringify({ tree })
  });
  state.selectedItemId = result.item.id;
  state.insertTargetItemId = result.item.id;
  await ensureItemBefore(result.item.id, target?.id || null);
  queueRowAnimation(result.item.id, "insert");
  await loadWafer(state.current.id);
  showStatus(`${shortcutTitle(shortcut)} 已插入`);
}

function shortcutTitle(shortcut) {
  return shortcut.layer_name || shortcut.material || shortcut.doping || shortcut.growth_temp || shortcut.notes || "快捷项";
}

function shortcutChildCount(shortcut) {
  return (shortcut.children || []).reduce((count, child) => count + 1 + shortcutChildCount(child), 0);
}

function saveItemAsShortcut(itemId) {
  if (!state.current) return;
  const map = childMap();
  const item = state.current.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  const shortcut = itemToShortcut(item, map);
  state.shortcuts.push(shortcut);
  saveShortcuts();
  renderShortcuts();
  const childCount = shortcutChildCount(shortcut);
  showStatus(`${shortcutTitle(shortcut)} 已加入快捷项${childCount ? `，含 ${childCount} 个子层` : ""}`);
}

function itemToShortcut(item, map) {
  return normalizeShortcut({
    item_type: isRepeatItem(item, map) ? "repeat" : "layer",
    layer_name: item.layer_name || "",
    material: item.material || "",
    thickness_nm: blankNumber(item.thickness_nm),
    periods: blankNumber(item.periods),
    single_period_thickness_nm: blankNumber(item.single_period_thickness_nm),
    doping: item.doping || "",
    doping_type: normalizeDopingType(item.doping_type),
    growth_temp: item.growth_temp || "",
    is_quantum_dot: item.is_quantum_dot ? 1 : 0,
    notes: item.notes || "",
    children: (map.get(item.id) || []).map((child) => itemToShortcut(child, map))
  });
}

function shortcutTreeForInsert(shortcut, target) {
  const tree = shortcutToTree(shortcut);
  if (target) {
    tree.parent_id = target.parent_id ?? null;
    tree.order_index = target.order_index;
  } else {
    tree.parent_id = null;
    delete tree.order_index;
  }
  return tree;
}

function shortcutToTree(shortcut) {
  const normalized = normalizeShortcut(shortcut);
  const isQd = Boolean(normalized.is_quantum_dot);
  const periods = numberValue(normalized.periods);
  return {
    item_type: periods > 1 && !isQd ? "repeat" : normalized.item_type || "layer",
    layer_name: normalized.layer_name || "新层",
    material: normalized.material || "",
    thickness_nm: isQd ? normalized.thickness_nm : normalized.thickness_nm || 0,
    periods: normalized.periods || "",
    single_period_thickness_nm: normalized.single_period_thickness_nm || "",
    doping: normalized.doping || "",
    doping_type: normalizeDopingType(normalized.doping_type),
    growth_temp: normalized.growth_temp || "",
    is_quantum_dot: isQd ? 1 : 0,
    notes: normalized.notes || "",
    children: (normalized.children || []).map(shortcutToTree)
  };
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

async function nextWaferCode() {
  const prefix = currentWaferDatePrefix();
  try {
    const payload = await api(`/api/wafers?search=${encodeURIComponent(prefix)}`);
    return nextWaferCodeFromExisting(prefix, payload.wafers || []);
  } catch (error) {
    console.warn(error);
    return nextWaferCodeFromExisting(prefix, state.wafers || []);
  }
}

function currentWaferDatePrefix() {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `N${yy}${mm}${dd}`;
}

function nextWaferCodeFromExisting(prefix, wafers) {
  const usedIndexes = (wafers || [])
    .map((wafer) => String(wafer.wafer_code || "").trim().toUpperCase())
    .map((code) => code.match(new RegExp(`^${prefix.toUpperCase()}([A-Z]+)$`)))
    .filter(Boolean)
    .map((match) => waferLetterIndex(match[1]))
    .filter((index) => index > 0);
  const nextIndex = usedIndexes.length ? Math.max(...usedIndexes) + 1 : 1;
  return `${prefix}${waferIndexLetter(nextIndex)}`;
}

function waferLetterIndex(letters) {
  return String(letters || "")
    .toUpperCase()
    .split("")
    .reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

function waferIndexLetter(index) {
  let value = Math.max(1, Number(index) || 1);
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNumericText(value) {
  if (value === null || value === undefined || value === "") return true;
  return Number.isFinite(Number(String(value).replace(/,/g, "")));
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
  const message = error.message || String(error);
  showStatus(message);
  if (isDuplicateWaferError(error) && typeof window.alert === "function") {
    window.alert(message);
  }
}

function isDuplicateWaferError(error) {
  return error?.code === "duplicate_wafer_code";
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
