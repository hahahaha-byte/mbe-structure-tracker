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
  { label: "GaAs", layer_name: "", material: "GaAs", thickness_nm: "", doping: "" },
  { label: "AlGaAs", layer_name: "", material: "AlGaAs", thickness_nm: "", doping: "" },
  { label: "接触层", layer_name: "接触层", material: "GaAs contact layer", thickness_nm: "200", doping: "1E19" },
  { label: "波导", layer_name: "波导层", material: "GaAs Waveguide layer", thickness_nm: "150", doping: "" },
  { label: "Be", layer_name: "", material: "", thickness_nm: "", doping: "Be-doping 10hole/dot" },
  { label: "Si", layer_name: "", material: "", thickness_nm: "", doping: "Si-doping" }
];

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
        <td colspan="11" class="wafer-meta">暂无层结构</td>
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
  const rowLabel = repeat ? "重复层" : depth > 0 ? "内部层" : "层";
  const rowClass = repeat ? "repeat-row" : child;
  const depthClass = depth > 0 ? "nested-row" : "root-row";
  const animationClass = rowAnimationClass(item);
  const levelOffset = depth * 32;
  const railOffset = Math.max(0, levelOffset - 16);
  const materialCell = materialDisabled
    ? lockedCell("展开内部层，在内部层里填写具体材料", "展开内部层填写")
    : `<input data-field="material" value="${escapeAttr(item.material)}" />`;
  const thicknessCell = repeat
    ? lockedCell("重复层厚度由周期和内部层自动计算", `自动 ${formatNumber(computed.thickness)}`)
    : `<input data-field="thickness_nm" class="${item.is_quantum_dot ? "qd-growth-input" : ""}" value="${escapeAttr(blankNumber(item.thickness_nm))}" placeholder="${item.is_quantum_dot ? "如 2.3ML" : "nm"}" />`;
  const singlePeriodCell = hasNestedRows
    ? lockedCell("单周期厚度由内部层自动相加", `自动 ${formatNumber(periodThickness)}`)
    : repeat
      ? `<input data-field="single_period_thickness_nm" value="${escapeAttr(blankNumber(item.single_period_thickness_nm))}" />`
      : lockedCell("先在“周期”里填大于 1 的数字，再填写单周期厚度", "先填周期");
  const dopingCell = dopingDisabled
    ? lockedCell("展开内部层，在具体内部层里填写掺杂", "展开内部层填写")
    : `<input data-field="doping" value="${escapeAttr(item.doping)}" />`;
  return `
    <tr class="${selected} ${rowClass} ${child} ${depthClass} ${animationClass}" data-id="${item.id}" data-depth="${depth}" style="--level-offset:${levelOffset}px; --rail-offset:${railOffset}px">
      <td class="action-cell">
        <div class="row-actions tree-actions">
          <button data-action="select-row" title="选择">•</button>
          <button data-action="toggle-expand" title="${expanded ? "收起" : "展开"}" ${repeat ? "" : "disabled"}>${repeat ? (expanded ? "▾" : "▸") : "·"}</button>
          <button data-action="move-up" title="上移">↑</button>
          <button data-action="move-down" title="下移">↓</button>
          <button data-action="add-inner-row" title="添加内部层" ${repeat ? "" : "disabled"}>+</button>
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
      <td><input data-field="growth_temp" value="${escapeAttr(item.growth_temp)}" /></td>
      <td class="checkbox-cell"><input data-field="is_quantum_dot" type="checkbox" ${item.is_quantum_dot ? "checked" : ""} ${qdDisabled ? "disabled" : ""} /></td>
      <td><input data-field="notes" value="${escapeAttr(item.notes)}" /></td>
    </tr>
  `;
}

function lockedCell(message, text) {
  return `<span class="locked-cell" data-lock-message="${escapeAttr(message)}" title="${escapeAttr(message)}">${escapeHtml(text)}</span>`;
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
  item[field] = input.type === "checkbox" ? (input.checked ? 1 : 0) : input.value;
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
  const wafer_code = prompt("片号", nextWaferCode());
  if (!wafer_code) return;
  try {
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
      layer_name: "内部层",
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

async function importExcel() {
  showStatus("导入中");
  try {
    const payload = await api("/api/import/excel", {
      method: "POST",
      body: JSON.stringify({})
    });
    showStatus(`已导入 ${payload.imported.length} 个`);
    await loadWafers(state.current?.id || null);
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
  els.stackVisual.innerHTML = renderStackItems(roots, map, 0);
}

function renderStackItems(items, map, depth) {
  const parts = [];
  let pendingQd = [];
  items.forEach((item, index) => {
    if (!isRepeatItem(item, map) && isQuantumDot(item)) {
      pendingQd.push(item);
      return;
    }
    parts.push(renderStackSegment(item, map, depth, pendingQd, index));
    pendingQd = [];
  });
  pendingQd.forEach((item) => {
    parts.push(renderQdMarker(item, depth));
  });
  return parts.join("");
}

function renderStackSegment(item, map, depth, qdMarkers, index) {
  const computed = computeItem(item, map);
  const repeat = isRepeatItem(item, map);
  const children = map.get(item.id) || [];
  const hasChildren = repeat && children.length > 0;
  const qdCap = qdMarkers.length > 0;
  const color = materialColor(item.material || item.layer_name || String(index));
  const flex = visualFlex(computed.thickness);
  const childHtml = hasChildren ? renderStackItems(children, map, depth + 1) : "";
  const classes = [
    "stack-segment",
    repeat ? "repeat" : "",
    hasChildren ? "with-children" : "",
    hasDoping(item) ? "doped" : "",
    qdCap ? "qd-cap" : "",
    computed.thickness > 0 && computed.thickness < 30 ? "thin-layer" : ""
  ].filter(Boolean).join(" ");
  return `
    <div class="${classes}" style="flex-grow:${flex}; background-color:${color}; --stack-depth:${depth}">
      <div class="segment-header">
        <div class="segment-name">${escapeHtml(item.layer_name || item.material || "未命名层")}</div>
        <div class="segment-meta">${escapeHtml(stackMeta(item, computed, map, qdMarkers))}</div>
      </div>
      ${qdCap ? renderQdDots(qdMarkers) : ""}
      ${hasChildren ? `<div class="repeat-children">${childHtml}</div>` : ""}
    </div>
  `;
}

function renderQdDots(items) {
  const label = items.map((item) => qdGrowthText(item)).filter(Boolean).join(" + ");
  return `<div class="qd-dots" title="${escapeAttr(label ? `QD ${label}` : "QD")}"></div>`;
}

function renderQdMarker(item, depth) {
  const color = materialColor(item.material || item.layer_name || "QD");
  return `
    <div class="stack-segment qd-marker" style="flex-grow:0.2; background-color:${color}; --stack-depth:${depth}">
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
    return `${item.periods || 1}x · ${childCount ? `${childCount} 内部层 · ` : material ? `${material} · ` : ""}${thickness}${qdText}`;
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
      <div class="metric"><strong>${stats.layerCount}</strong><span>层</span></div>
      <div class="metric"><strong>${stats.repeatCount}</strong><span>重复层</span></div>
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
  const repeat = isRepeatItem(item, map);
  if (!repeat && stats && hasDoping(item)) stats.dopedItems.push(item);
  if (repeat) {
    if (stats) stats.repeatCount += 1;
    const periods = numberValue(item.periods) || 1;
    const children = map.get(item.id) || [];
    if (children.length) {
      let periodThickness = 0;
      children.forEach((child) => {
        const childResult = computeItem(child, map, stats, multiplier * periods);
        periodThickness += childResult.thickness;
      });
      return { thickness: periodThickness * periods };
    }
    if (stats && hasDoping(item)) stats.dopedItems.push(item);
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

function isQuantumDot(item) {
  return Boolean(item.is_quantum_dot) || /(^|\s)(QD|quantum dot)|量子点/i.test(`${item.layer_name} ${item.material}`);
}

function qdGrowthText(item) {
  const value = String(item.thickness_nm ?? "").trim();
  if (!value || value === "0" || value === "0.0") return "";
  return value;
}

function visualFlex(thickness) {
  const value = numberValue(thickness);
  if (value <= 0) return 0.2;
  return Math.max(value, 30);
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
  return text !== "" && text !== "0" && text !== "0.0";
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
  return {
    label: shortcut.label || shortcut.key || shortcut.material || "快捷项",
    layer_name: shortcut.layer_name || "",
    material: shortcut.material || "",
    thickness_nm: shortcut.thickness_nm || "",
    doping: shortcut.doping || ""
  };
}

function renderShortcuts() {
  const header = ["名称", "层名", "材料", "厚度", "掺杂", "操作"].map((label) => `<div class="grid-label">${label}</div>`).join("");
  const rows = state.shortcuts
    .map((shortcut, index) => `
      <input data-shortcut-index="${index}" data-shortcut-field="label" value="${escapeAttr(shortcut.label)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="layer_name" value="${escapeAttr(shortcut.layer_name)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="material" value="${escapeAttr(shortcut.material)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="thickness_nm" value="${escapeAttr(shortcut.thickness_nm)}" />
      <input data-shortcut-index="${index}" data-shortcut-field="doping" value="${escapeAttr(shortcut.doping)}" />
      <div class="shortcut-actions">
        <button class="quick-apply" data-shortcut-action="insert" data-shortcut-index="${index}" title="在选中层上方插入">+</button>
        <button data-shortcut-action="remove" data-shortcut-index="${index}">×</button>
      </div>
    `)
    .join("");
  els.shortcutList.innerHTML = header + rows;
}

function handleShortcutInput(event) {
  const input = event.target.closest("[data-shortcut-index]");
  if (!input || !input.dataset.shortcutField) return;
  const index = Number(input.dataset.shortcutIndex);
  const field = input.dataset.shortcutField;
  state.shortcuts[index][field] = input.value;
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
  state.shortcuts.push({ label: "新项", layer_name: "", material: "", thickness_nm: "", doping: "" });
  saveShortcuts();
  renderShortcuts();
}

async function insertShortcutLayer(shortcut) {
  if (!state.current) {
    showStatus("先选择外延片");
    return;
  }
  const target = insertionTargetItem() || firstVisibleItem();
  const payload = {
    item_type: "layer",
    ...insertionReference(target).payload,
    layer_name: shortcut.layer_name || shortcut.label || "新层",
    material: shortcut.material || "",
    thickness_nm: shortcut.thickness_nm || 0,
    doping: shortcut.doping || ""
  };
  const result = await api(`/api/wafers/${state.current.id}/items`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  state.selectedItemId = result.item.id;
  state.insertTargetItemId = result.item.id;
  await ensureItemBefore(result.item.id, target?.id || null);
  queueRowAnimation(result.item.id, "insert");
  await loadWafer(state.current.id);
  showStatus(`${shortcut.label || "快捷项"} 已插入为新层`);
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
