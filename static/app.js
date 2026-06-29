const state = {
  wafers: [],
  current: null,
  selectedItemId: null,
  insertTargetItemId: null,
  copiedItemId: null,
  undoHistory: new Map(),
  collapsedItemIds: new Set(),
  waferSelection: new Set(),
  shortcuts: [],
  saveTimers: new Map(),
  waferSaveTimer: null,
  rowAnimations: new Map(),
  rowAnimationTimer: null,
  pendingExpandToggles: new Set(),
  activeItemSection: "source",
  waferType: "formal"
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
const STACK_REPEAT_HEADER_HEIGHT = 50;
const STACK_REPEAT_CHILD_PADDING_TOP = 6;
const STACK_REPEAT_CHILD_PADDING_BOTTOM = 7;
const STACK_REPEAT_CHILD_GAP = 4;
const TEST_WAFER_FIELDS = [
  "as_beam_ratio",
  "qd_islanding_time",
  "qd_deposition",
  "reconstruction_temp",
  "qd_growth_temp_offset",
  "qd_growth_temp",
  "growth_rate",
  "qd_density",
  "qd_volume",
  "qd_volume_cv",
  "qd_height",
  "pl_peak_nm",
  "pl_fwhm_nm",
  "pl_intensity"
];
const MACHINE_WAFER_FIELDS = [
  "machine_record_type",
  "standby_vacuum",
  "as_pressure_fill_vacuum",
  "as_bulk_temp"
];
const DEFAULT_SECTION = "source";
const AS_PRESSURE_SECTION = "as_pressure";
const MACHINE_RECORD_TYPES = {
  open_chamber: "开腔",
  speed_test: "测速"
};
const STANDARD_TABLE_HEADERS = [
  ["", "actions-col"],
  ["状态"],
  ["层名"],
  ["材料"],
  ["厚度 nm / QD ML"],
  ["周期"],
  ["单周期 nm"],
  ["掺杂浓度"],
  ["N/P"],
  ["生长温度"],
  ["QD"],
  ["备注"]
];
const SOURCE_TABLE_HEADERS = [
  ["", "actions-col"],
  ["源炉"],
  ["束流 Torr"],
  ["温度"],
  ["备注"]
];
const SOURCE_SPEED_TEST_TABLE_HEADERS = [
  ["", "actions-col"],
  ["源炉"],
  ["束流 Torr"],
  ["温度"],
  ["测速"],
  ["备注"]
];
const AS_PRESSURE_TABLE_HEADERS = [
  ["", "actions-col"],
  ["As 压名称"],
  ["生长材料"],
  ["束流 Torr"],
  ["Value"],
  ["生长速率 um/h"],
  ["备注"]
];

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  loadShortcuts();
  bindEvents();
  renderWaferTypeTabs();
  renderShortcuts();
  updateUndoButton();
  await loadWafers();
}

function bindElements() {
  els.appShell = document.querySelector(".app-shell");
  els.searchInput = document.getElementById("searchInput");
  els.waferTypeTabs = document.getElementById("waferTypeTabs");
  els.waferList = document.getElementById("waferList");
  els.codeFieldLabel = document.getElementById("codeFieldLabel");
  els.machineRecordTypeToggle = document.getElementById("machineRecordTypeToggle");
  els.sampleHolderField = document.getElementById("sampleHolderField");
  els.testWaferFields = document.getElementById("testWaferFields");
  els.machineFields = document.getElementById("machineFields");
  els.primaryTableSection = document.getElementById("primaryTableSection");
  els.layerTableBody = document.getElementById("layerTableBody");
  els.layerTableHead = document.getElementById("layerTableHead");
  els.primaryTableTitle = document.getElementById("primaryTableTitle");
  els.asPressureSection = document.getElementById("asPressureSection");
  els.asPressureTableBody = document.getElementById("asPressureTableBody");
  els.asPressureTableHead = document.getElementById("asPressureTableHead");
  els.stackVisual = document.getElementById("stackVisual");
  els.inspector = document.querySelector(".inspector");
  els.statsContent = document.getElementById("statsContent");
  els.totalThickness = document.getElementById("totalThickness");
  els.statusText = document.getElementById("statusText");
  els.toolbar = document.querySelector(".toolbar");
  els.shortcutsSection = document.querySelector(".shortcuts");
  els.shortcutList = document.getElementById("shortcutList");
  els.undoDeleteBtn = document.getElementById("undoDeleteBtn");
  els.addLayerBtn = document.querySelector("[data-action='add-layer']");
  els.addInnerLayerBtn = document.querySelector("[data-action='add-inner-layer']");
  els.addAsPressureBtn = document.getElementById("addAsPressureBtn");
  els.deleteSelectedWafersBtn = document.getElementById("deleteSelectedWafersBtn");
  els.jsonImportInput = document.getElementById("jsonImportInput");
  els.waferFields = {
    wafer_code: document.getElementById("waferCode"),
    size: document.getElementById("waferSize"),
    structure_name: document.getElementById("structureName"),
    growth_date: document.getElementById("growthDate"),
    notes: document.getElementById("waferNotes"),
    sample_holder_code: document.getElementById("sampleHolderCode"),
    as_beam_ratio: document.getElementById("asBeamRatio"),
    qd_islanding_time: document.getElementById("qdIslandingTime"),
    qd_deposition: document.getElementById("qdDeposition"),
    reconstruction_temp: document.getElementById("reconstructionTemp"),
    qd_growth_temp_offset: document.getElementById("qdGrowthTempOffset"),
    qd_growth_temp: document.getElementById("qdGrowthTemp"),
    growth_rate: document.getElementById("growthRate"),
    qd_density: document.getElementById("qdDensity"),
    qd_volume: document.getElementById("qdVolume"),
    qd_volume_cv: document.getElementById("qdVolumeCv"),
    qd_height: document.getElementById("qdHeight"),
    pl_peak_nm: document.getElementById("plPeakNm"),
    pl_fwhm_nm: document.getElementById("plFwhmNm"),
    pl_intensity: document.getElementById("plIntensity"),
    standby_vacuum: document.getElementById("standbyVacuum"),
    as_pressure_fill_vacuum: document.getElementById("asPressureFillVacuum"),
    as_bulk_temp: document.getElementById("asBulkTemp")
  };
}

function bindEvents() {
  document.getElementById("newWaferBtn").addEventListener("click", createNewWafer);
  els.waferTypeTabs.addEventListener("click", handleWaferTypeClick);
  els.machineRecordTypeToggle.addEventListener("click", handleMachineRecordTypeClick);
  document.getElementById("importJsonBtn").addEventListener("click", () => els.jsonImportInput.click());
  document.getElementById("backupExportBtn").addEventListener("click", exportGlobalBackup);
  els.deleteSelectedWafersBtn.addEventListener("click", () => deleteSelectedWafers().catch(showError));
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
  els.asPressureTableBody.addEventListener("pointerdown", rememberTableTarget);
  els.asPressureTableBody.addEventListener("focusin", rememberTableTarget);
  els.asPressureTableBody.addEventListener("click", handleTableClick);
  els.asPressureTableBody.addEventListener("input", handleItemInput);
  els.asPressureTableBody.addEventListener("change", handleItemInput);
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
  const payload = await api(`/api/wafers?search=${search}&type=${encodeURIComponent(state.waferType)}`);
  state.wafers = payload.wafers;
  pruneWaferSelection();
  renderWaferList();
  const preferredId = selectId || state.current?.id || null;
  const idToLoad = state.wafers.some((wafer) => wafer.id === preferredId) ? preferredId : state.wafers[0]?.id;
  if (idToLoad) {
    await loadWafer(idToLoad);
  } else {
    state.current = null;
    state.selectedItemId = null;
    state.insertTargetItemId = null;
    renderCurrent();
  }
}

function handleWaferTypeClick(event) {
  const button = event.target.closest("[data-wafer-type]");
  if (!button) return;
  const nextType = normalizeWaferType(button.dataset.waferType);
  if (nextType === state.waferType) return;
  state.waferType = nextType;
  state.current = null;
  state.selectedItemId = null;
  state.insertTargetItemId = null;
  state.activeItemSection = DEFAULT_SECTION;
  state.waferSelection.clear();
  renderWaferTypeTabs();
  loadWafers().catch(showError);
}

function renderWaferTypeTabs() {
  els.waferTypeTabs.querySelectorAll("[data-wafer-type]").forEach((button) => {
    button.classList.toggle("active", normalizeWaferType(button.dataset.waferType) === state.waferType);
  });
  if (state.waferType === "machine") {
    els.searchInput.placeholder = "搜索日期 / MBE 参数";
  } else {
    els.searchInput.placeholder = state.waferType === "test" ? "搜索测试片 / 参数" : "搜索片号 / 结构";
  }
}

function renderMachineRecordTypeToggle(value) {
  const current = normalizeMachineRecordType(value);
  els.machineRecordTypeToggle.querySelectorAll("[data-machine-record-type]").forEach((button) => {
    button.classList.toggle("active", normalizeMachineRecordType(button.dataset.machineRecordType) === current);
  });
}

async function handleMachineRecordTypeClick(event) {
  const button = event.target.closest("[data-machine-record-type]");
  if (!button || !state.current || !isMachineRecord()) return;
  const requested = normalizeMachineRecordType(button.dataset.machineRecordType);
  if (!requested) return;
  const waferId = state.current.id;
  const current = normalizeMachineRecordType(state.current.machine_record_type);
  const next = current === requested ? "" : requested;
  state.current.machine_record_type = next;
  state.current.wafer_code = codeWithMachineRecordSuffix(state.current.wafer_code || currentShortDateCode(), next);
  els.waferFields.wafer_code.value = state.current.wafer_code;
  clearTimeout(state.waferSaveTimer);
  try {
    await saveCurrentWafer(waferId);
    showStatus(next ? `已标记为${machineRecordTypeLabel(next)}` : "已切回日常记录");
    await loadWafers(waferId);
  } catch (error) {
    showError(error);
    if (isDuplicateWaferError(error)) {
      await loadWafer(waferId);
    }
  }
}

async function loadWafer(id) {
  const payload = await api(`/api/wafers/${id}`);
  state.current = payload.wafer;
  if (!state.current.items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = state.current.items[0]?.id || null;
  }
  state.insertTargetItemId = state.selectedItemId;
  state.activeItemSection = itemSection(state.current.items.find((item) => item.id === state.selectedItemId)) || DEFAULT_SECTION;
  renderCurrent();
  renderWaferList();
}

function renderWaferList() {
  if (!state.wafers.length) {
    els.waferList.innerHTML = `<div class="wafer-meta">暂无数据</div>`;
    updateWaferDeleteButton();
    return;
  }
  els.waferList.innerHTML = state.wafers
    .map((wafer) => {
      const active = wafer.id === state.current?.id ? "active" : "";
      const checked = state.waferSelection.has(wafer.id) ? "checked" : "";
      return `
        <div class="wafer-item ${active} ${normalizeWaferType(wafer.wafer_type) === "test" ? "test-wafer" : ""} ${normalizeWaferType(wafer.wafer_type) === "machine" ? "machine-wafer" : ""}">
          <label class="wafer-select" title="选择批量删除">
            <input type="checkbox" data-wafer-select="${wafer.id}" ${checked} />
          </label>
          <button class="wafer-main" data-wafer-id="${wafer.id}">
            <span class="wafer-code">${escapeHtml(wafer.wafer_code)}</span>
            <span class="wafer-meta">${escapeHtml(wafer.structure_name || defaultRecordName(wafer))}</span>
            <span class="wafer-meta">${escapeHtml(waferCardMeta(wafer))}</span>
          </button>
          <button class="wafer-delete" data-wafer-delete="${wafer.id}" title="删除整片">×</button>
        </div>
      `;
    })
    .join("");
  updateWaferDeleteButton();
}

function waferCardMeta(wafer) {
  const type = normalizeWaferType(wafer.wafer_type);
  if (type === "machine") {
    const fields = [
      ["类型", machineRecordTypeLabel(wafer.machine_record_type)],
      ["待机", wafer.standby_vacuum],
      ["As充盈", wafer.as_pressure_fill_vacuum],
      ["As bulk", wafer.as_bulk_temp]
    ]
      .filter(([, value]) => String(value || "").trim() && value !== "日常")
      .map(([label, value]) => `${label} ${value}`);
    return fields.length ? fields.join(" · ") : "MBE 参数";
  }
  if (type !== "test") {
    return `${wafer.size || ""} · ${wafer.item_count || 0} 层 · ${wafer.doped_item_count || 0} 掺杂`;
  }
  const fields = [
    ["As比", wafer.as_beam_ratio],
    ["成岛", wafer.qd_islanding_time],
    ["淀积", wafer.qd_deposition],
    ["密度", wafer.qd_density],
    ["速率", computedGrowthRate(wafer.qd_islanding_time)]
  ]
    .filter(([, value]) => String(value || "").trim())
    .map(([label, value]) => `${label} ${value}`);
  return fields.length ? fields.slice(0, 3).join(" · ") : `${wafer.size || ""} · 测试片`;
}

function defaultRecordName(wafer) {
  const type = normalizeWaferType(wafer.wafer_type);
  if (type === "machine") return "MBE 参数记录";
  if (type === "test") return "测试片记录";
  return "未命名结构";
}

function renderCurrent() {
  const wafer = state.current;
  const waferType = normalizeWaferType(wafer?.wafer_type || state.waferType);
  const testWafer = waferType === "test";
  const machineRecord = waferType === "machine";
  const machineRecordType = normalizeMachineRecordType(wafer?.machine_record_type);
  const openChamberRecord = machineRecord && machineRecordType === "open_chamber";
  const speedTestRecord = machineRecord && machineRecordType === "speed_test";
  if (wafer) {
    wafer.growth_rate = computedGrowthRate(wafer.qd_islanding_time);
    wafer.qd_growth_temp = computedQdGrowthTemp(
      wafer.reconstruction_temp,
      wafer.qd_growth_temp_offset,
      wafer.qd_growth_temp
    );
  }
  els.codeFieldLabel.textContent = machineRecord ? "日期编号" : "片号";
  els.appShell.classList.toggle("machine-mode", machineRecord);
  els.appShell.classList.toggle("machine-open-mode", openChamberRecord);
  els.appShell.classList.toggle("machine-speed-mode", speedTestRecord);
  els.inspector.hidden = machineRecord;
  els.machineRecordTypeToggle.hidden = !machineRecord || !wafer;
  renderMachineRecordTypeToggle(machineRecordType);
  ["size", "structure_name", "growth_date", "sample_holder_code"].forEach((field) => {
    const label = els.waferFields[field]?.closest?.("label");
    if (label) label.hidden = machineRecord;
  });
  els.sampleHolderField.hidden = machineRecord;
  els.testWaferFields.hidden = !testWafer;
  els.machineFields.hidden = !machineRecord || openChamberRecord;
  els.primaryTableSection.hidden = openChamberRecord;
  els.asPressureSection.hidden = !machineRecord || openChamberRecord;
  els.toolbar.hidden = openChamberRecord;
  els.shortcutsSection.hidden = machineRecord;
  els.addLayerBtn.textContent = machineRecord ? "+ 源炉" : "+ 层";
  els.addInnerLayerBtn.textContent = machineRecord ? "+ 子项" : "+ 子层";
  els.addAsPressureBtn.hidden = !machineRecord || openChamberRecord;
  els.primaryTableTitle.textContent = machineRecord
    ? (speedTestRecord ? "源炉束流 / 温度 / 测速" : "源炉束流 / 温度")
    : "层结构";
  renderTableHeads(machineRecord, speedTestRecord);
  Object.entries(els.waferFields).forEach(([field, input]) => {
    input.value = wafer?.[field] || "";
    input.disabled = !wafer;
    if (field === "growth_rate") {
      input.readOnly = true;
    }
    if (field === "qd_growth_temp") {
      input.readOnly = Boolean(wafer && hasComputedQdGrowthTemp(wafer));
    }
  });
  renderItems();
  if (machineRecord) {
    clearInspector();
  } else {
    renderInspector();
  }
  updateUndoButton();
}

function renderItems() {
  if (!state.current) {
    els.layerTableBody.innerHTML = "";
    els.asPressureTableBody.innerHTML = "";
    return;
  }
  if (isMachineRecord()) {
    renderMachineItems();
    return;
  }
  const map = childMap();
  const rows = flattenItems(null, 0, map, DEFAULT_SECTION);
  if (!rows.length) {
    els.layerTableBody.innerHTML = `
      <tr>
        <td colspan="12" class="wafer-meta">暂无层结构</td>
      </tr>
    `;
    return;
  }
  els.layerTableBody.innerHTML = rows.map(({ item, depth }) => renderItemRow(item, depth, map)).join("");
  els.asPressureTableBody.innerHTML = "";
  scheduleRowAnimationClear();
}

function renderMachineItems() {
  const map = childMap();
  const sourceRows = flattenItems(null, 0, map, DEFAULT_SECTION);
  const asRows = flattenItems(null, 0, map, AS_PRESSURE_SECTION);
  const sourceColspan = isMachineSpeedTestRecord() ? 6 : 5;
  els.layerTableBody.innerHTML = sourceRows.length
    ? sourceRows.map(({ item, depth }) => renderMachineItemRow(item, depth, map, DEFAULT_SECTION)).join("")
    : `<tr><td colspan="${sourceColspan}" class="wafer-meta">暂无源炉参数</td></tr>`;
  els.asPressureTableBody.innerHTML = asRows.length
    ? asRows.map(({ item, depth }) => renderMachineItemRow(item, depth, map, AS_PRESSURE_SECTION)).join("")
    : `<tr><td colspan="7" class="wafer-meta">暂无 As 压参数</td></tr>`;
  scheduleRowAnimationClear();
}

function renderTableHeads(machineRecord, speedTestRecord = false) {
  const sourceHeaders = speedTestRecord ? SOURCE_SPEED_TEST_TABLE_HEADERS : SOURCE_TABLE_HEADERS;
  renderTableHead(els.layerTableHead, machineRecord ? sourceHeaders : STANDARD_TABLE_HEADERS);
  renderTableHead(els.asPressureTableHead, AS_PRESSURE_TABLE_HEADERS);
}

function renderTableHead(target, headers) {
  target.innerHTML = headers
    .map(([label, className]) => `<th class="${className || ""}">${escapeHtml(label)}</th>`)
    .join("");
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
    <tr class="${selected} ${rowClass} ${child} ${depthClass} ${animationClass}" data-id="${item.id}" data-section="${escapeAttr(itemSection(item))}" data-depth="${depth}" style="--level-offset:${levelOffset}px; --rail-offset:${railOffset}px">
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

function renderMachineItemRow(item, depth, map, section) {
  const selected = item.id === state.selectedItemId ? "selected" : "";
  const repeat = isRepeatItem(item, map);
  const child = depth > 0 ? "child-row" : "";
  const rowClass = repeat ? "repeat-row" : child;
  const depthClass = depth > 0 ? "nested-row" : "root-row";
  const animationClass = rowAnimationClass(item);
  const speedTestRecord = isMachineSpeedTestRecord();
  const levelOffset = depth * 32;
  const railOffset = Math.max(0, levelOffset - 16);
  const actionCell = `
    <td class="action-cell">
      <div class="row-actions tree-actions">
        <button data-action="select-row" title="选择">•</button>
        <button data-action="move-up" title="上移">↑</button>
        <button data-action="move-down" title="下移">↓</button>
        <button data-action="add-inner-row" title="添加子项">+</button>
        <button data-action="save-shortcut" title="加入快捷项">☆</button>
        <button data-action="delete-item" title="删除">×</button>
      </div>
    </td>
  `;
  if (section === AS_PRESSURE_SECTION) {
    return `
      <tr class="${selected} ${rowClass} ${child} ${depthClass} ${animationClass}" data-id="${item.id}" data-section="${AS_PRESSURE_SECTION}" data-depth="${depth}" style="--level-offset:${levelOffset}px; --rail-offset:${railOffset}px">
        ${actionCell}
        <td class="layer-name-cell"><div class="indent-cell"><input data-field="layer_name" value="${escapeAttr(item.layer_name)}" placeholder="如 GaAs As压" /></div></td>
        <td><input data-field="material" value="${escapeAttr(item.material)}" placeholder="生长材料" /></td>
        <td><input data-field="thickness_nm" value="${escapeAttr(blankNumber(item.thickness_nm))}" placeholder="如 3e-6" /></td>
        <td><input data-field="doping" value="${escapeAttr(item.doping)}" placeholder="Value" /></td>
        <td><input data-field="growth_temp" value="${escapeAttr(item.growth_temp)}" placeholder="um/h" /></td>
        <td><input data-field="notes" value="${escapeAttr(item.notes)}" /></td>
      </tr>
    `;
  }
  return `
    <tr class="${selected} ${rowClass} ${child} ${depthClass} ${animationClass}" data-id="${item.id}" data-section="${DEFAULT_SECTION}" data-depth="${depth}" style="--level-offset:${levelOffset}px; --rail-offset:${railOffset}px">
      ${actionCell}
      <td class="layer-name-cell"><div class="indent-cell"><input data-field="layer_name" value="${escapeAttr(item.layer_name)}" placeholder="源炉" /></div></td>
      <td><input data-field="thickness_nm" value="${escapeAttr(blankNumber(item.thickness_nm))}" placeholder="如 2e-7" /></td>
      <td><input data-field="growth_temp" value="${escapeAttr(item.growth_temp)}" placeholder="温度" /></td>
      ${speedTestRecord ? `<td><input data-field="doping" value="${escapeAttr(item.doping)}" placeholder="测速" /></td>` : ""}
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

function queueExpandAnimation(itemId, rows, expanding) {
  queueRowAnimation(itemId, expanding ? "expand-parent" : "collapse-parent");
  rows.forEach(({ item }) => queueRowAnimation(item.id, expanding ? "expand-child" : "collapse-child"));
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
  const selector = event.target.closest("[data-wafer-select]");
  if (selector) {
    const waferId = Number(selector.dataset.waferSelect);
    if (selector.checked) {
      state.waferSelection.add(waferId);
    } else {
      state.waferSelection.delete(waferId);
    }
    updateWaferDeleteButton();
    return;
  }
  const deleteButton = event.target.closest("[data-wafer-delete]");
  if (deleteButton) {
    const wafer = waferById(Number(deleteButton.dataset.waferDelete));
    if (wafer) deleteWafersWithConfirmation([wafer]).catch(showError);
    return;
  }
  const button = event.target.closest("[data-wafer-id]");
  if (!button) return;
  loadWafer(Number(button.dataset.waferId)).catch(showError);
}

function waferById(id) {
  return state.wafers.find((wafer) => wafer.id === id) || null;
}

function pruneWaferSelection() {
  const visibleIds = new Set(state.wafers.map((wafer) => wafer.id));
  Array.from(state.waferSelection).forEach((id) => {
    if (!visibleIds.has(id)) state.waferSelection.delete(id);
  });
}

function updateWaferDeleteButton() {
  const count = state.waferSelection.size;
  els.deleteSelectedWafersBtn.disabled = count === 0;
  els.deleteSelectedWafersBtn.textContent = count ? `删除选中 ${count}` : "删除选中";
}

async function deleteSelectedWafers() {
  const wafers = Array.from(state.waferSelection)
    .map((id) => waferById(id))
    .filter(Boolean);
  await deleteWafersWithConfirmation(wafers);
}

async function deleteWafersWithConfirmation(wafers) {
  if (!wafers.length) return;
  const confirmed = await confirmWaferDeletion(wafers);
  if (!confirmed) return;
  await deleteWafers(wafers);
}

function confirmWaferDeletion(wafers) {
  return new Promise((resolve) => {
    const isBatch = wafers.length > 1;
    const title = isBatch ? "批量删除外延片" : "删除外延片";
    const list = wafers
      .slice(0, 8)
      .map((wafer) => `<li>${escapeHtml(wafer.wafer_code)}</li>`)
      .join("");
    const more = wafers.length > 8 ? `<li>另外 ${wafers.length - 8} 片</li>` : "";
    const modal = showModal(`
      <div class="modal-backdrop">
        <div class="modal-panel">
          <div class="modal-title">
            <h2>${title}</h2>
            <button data-modal-close title="关闭">×</button>
          </div>
          <p class="modal-copy">确认删除 ${isBatch ? `${wafers.length} 片外延片` : `片号 <strong>${escapeHtml(wafers[0].wafer_code)}</strong>`}？删除后这片的层结构也会一起删除。</p>
          ${isBatch ? `<ul class="modal-delete-list">${list}${more}</ul>` : ""}
          <div class="modal-actions">
            <button data-modal-close>取消</button>
            <button class="danger-btn" id="confirmWaferDeleteBtn">${isBatch ? "确认批量删除" : "确认删除"}</button>
          </div>
        </div>
      </div>
    `, () => resolve(false));
    modal.querySelector("#confirmWaferDeleteBtn").addEventListener("click", () => {
      closeModal(modal);
      resolve(true);
    });
  });
}

async function deleteWafers(wafers) {
  const deletedIds = new Set(wafers.map((wafer) => wafer.id));
  for (const wafer of wafers) {
    await api(`/api/wafers/${wafer.id}`, { method: "DELETE" });
  }
  deletedIds.forEach((id) => state.waferSelection.delete(id));
  if (state.current && deletedIds.has(state.current.id)) {
    state.current = null;
    state.selectedItemId = null;
    state.insertTargetItemId = null;
  }
  showStatus(`已删除 ${wafers.length} 片外延片`);
  await loadWafers();
}

async function handleToolbarClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.current) return;
  const action = button.dataset.action;
  try {
    if (action === "add-layer") await addLayer();
    if (action === "add-as-pressure") await addLayer(AS_PRESSURE_SECTION);
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
  state.activeItemSection = normalizeItemSection(row.dataset.section);
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
      await toggleExpandedAnimated(id);
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
  if (field === "qd_islanding_time") {
    state.current.growth_rate = computedGrowthRate(event.target.value);
    if (els.waferFields.growth_rate) {
      els.waferFields.growth_rate.value = state.current.growth_rate;
    }
  }
  if (field === "reconstruction_temp" || field === "qd_growth_temp_offset") {
    state.current.qd_growth_temp = computedQdGrowthTemp(
      state.current.reconstruction_temp,
      state.current.qd_growth_temp_offset,
      state.current.qd_growth_temp
    );
    if (els.waferFields.qd_growth_temp) {
      els.waferFields.qd_growth_temp.value = state.current.qd_growth_temp;
      els.waferFields.qd_growth_temp.readOnly = hasComputedQdGrowthTemp(state.current);
    }
  }
  clearTimeout(state.waferSaveTimer);
  state.waferSaveTimer = setTimeout(async () => {
    try {
      await saveCurrentWafer(waferId);
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

async function saveCurrentWafer(waferId) {
  return api(`/api/wafers/${waferId}`, {
    method: "PUT",
    body: JSON.stringify(pickWaferFields(state.current))
  });
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
    const machine = state.waferType === "machine";
    const wafer_code = prompt(machine ? "日期编号" : "片号", await nextRecordCode());
    if (!wafer_code) return;
    const payload = await api("/api/wafers", {
      method: "POST",
      body: JSON.stringify({
        wafer_code,
        wafer_type: state.waferType,
        size: machine ? "" : "3英寸",
        structure_name: machine ? "MBE 参数" : state.waferType === "test" ? "测试片" : ""
      })
    });
    state.selectedItemId = null;
    state.insertTargetItemId = null;
    await loadWafers(payload.wafer.id);
  } catch (error) {
    showError(error);
  }
}

async function addLayer(section = state.activeItemSection || DEFAULT_SECTION) {
  section = normalizeItemSection(section);
  state.activeItemSection = section;
  const target = insertionTargetItem();
  const sameSectionTarget = target && itemSection(target) === section ? target : null;
  const visibleTarget = sameSectionTarget || firstVisibleItem();
  const reference = insertionReference(sameSectionTarget);
  const machine = isMachineRecord();
  const defaults = machine
    ? machineItemDefaults(section)
    : { layer_name: "新层", material: "", thickness_nm: 0 };
  const payload = await api(`/api/wafers/${state.current.id}/items`, {
    method: "POST",
    body: JSON.stringify({
      item_type: "layer",
      section,
      ...reference.payload,
      ...defaults
    })
  });
  state.selectedItemId = payload.item.id;
  state.insertTargetItemId = payload.item.id;
  await ensureItemBefore(payload.item.id, visibleTarget?.id || null);
  queueRowAnimation(payload.item.id, "insert");
  await loadWafer(state.current.id);
}

async function addInnerLayer() {
  const selected = insertionTargetItem();
  const map = childMap();
  const machine = isMachineRecord();
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
  if (!parent && selected && machine) {
    selected.item_type = "repeat";
    selected.periods = selected.periods || 1;
    selected.doping_type = "";
    selected.thickness_nm = null;
    selected.single_period_thickness_nm = null;
    selected.is_quantum_dot = 0;
    scheduleItemSave(selected);
    parent = selected;
  }
  if (!parent) {
    showStatus("先选一层并填写周期 > 1");
    return;
  }
  const section = itemSection(parent);
  const inherited = machineItemDefaults(section, true, parent);
  state.activeItemSection = section;
  if (machine) {
    parent.doping_type = "";
    parent.is_quantum_dot = 0;
  } else {
    parent.material = "";
    parent.doping = "";
    parent.doping_type = "";
    parent.thickness_nm = null;
    parent.single_period_thickness_nm = null;
    parent.is_quantum_dot = 0;
  }
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
      section,
      ...(machine ? inherited : { layer_name: "子层", material: "", thickness_nm: 0 })
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
  const copied = state.current?.items.find((item) => item.id === state.copiedItemId);
  if (isMachineRecord() && copied) {
    state.activeItemSection = itemSection(copied);
  }
  const rawTarget = insertionTargetItem();
  const target = rawTarget && (!isMachineRecord() || !copied || itemSection(rawTarget) === itemSection(copied))
    ? rawTarget
    : firstVisibleItem();
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

async function exportGlobalBackup() {
  try {
    showStatus("正在生成全局备份");
    const wafers = await loadAllExportWafers();
    if (!wafers.length) {
      showStatus("没有可备份的数据");
      return;
    }
    const dateCode = currentShortDateCode();
    const folder = `备份${dateCode}/`;
    const formalWafers = wafers.filter((wafer) => normalizeWaferType(wafer.wafer_type) === "formal");
    const entries = [
      { name: `${folder}全部数据.json`, data: utf8Bytes(JSON.stringify({ wafers }, null, 2)) },
      { name: `${folder}全部记录.csv`, data: utf8Bytes(csvForWafers(wafers)) },
      { name: `${folder}全部记录.xlsx`, data: buildAllRecordsXlsx(wafers) },
      { name: `${folder}正式片概要.xlsx`, data: buildFormalSummaryXlsx(formalWafers) }
    ];
    if (formalWafers.length) {
      const pdfBlob = await buildWafersPdfBlob(formalWafers);
      entries.push({ name: `${folder}正式片结构图.pdf`, data: new Uint8Array(await pdfBlob.arrayBuffer()) });
    } else {
      entries.push({ name: `${folder}正式片结构图-无正式片.txt`, data: utf8Bytes("当前没有正式片记录。") });
    }
    const zip = buildZip(entries);
    downloadBlob(zip, `备份${dateCode}.zip`, "application/zip");
    showStatus(`已生成全局备份：${wafers.length} 条记录`);
  } catch (error) {
    showError(error);
  }
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
    "wafer_type",
    "machine_record_type",
    "size",
    "structure_name",
    "growth_date",
    "sample_holder_code",
    "notes",
    "as_beam_ratio",
    "qd_islanding_time_s",
    "qd_deposition_islanding_time_multiple",
    "reconstruction_temp_c",
    "qd_growth_temp_offset_c",
    "qd_growth_temp_c",
    "growth_rate_ml_per_s",
    "qd_density_cm-2",
    "qd_volume_median_nm3",
    "qd_height_nm",
    "qd_volume_cv",
    "pl_peak_nm",
    "pl_fwhm_nm",
    "pl_intensity",
    "standby_vacuum",
    "as_pressure_fill_vacuum",
    "as_bulk_temp",
    "path",
    "type",
    "section",
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
    if ((map.get(null) || []).length) {
      writeCsvItemRows(rows, wafer, map, null, "");
    } else {
      rows.push([...waferCsvPrefix(wafer), "", "wafer", "", "", "", "", "", "", "", "", "", "", ""]);
    }
  });
  return `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

function writeCsvItemRows(rows, wafer, map, parentId, prefix) {
  (map.get(parentId) || []).forEach((item, index) => {
    const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    rows.push([
      ...waferCsvPrefix(wafer),
      path,
      item.item_type,
      itemSection(item),
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

function waferCsvPrefix(wafer) {
  return [
    wafer.wafer_code,
    normalizeWaferType(wafer.wafer_type),
    normalizeMachineRecordType(wafer.machine_record_type),
    wafer.size,
    wafer.structure_name,
    wafer.growth_date,
    wafer.sample_holder_code,
    wafer.notes,
    wafer.as_beam_ratio,
    wafer.qd_islanding_time,
    wafer.qd_deposition,
    wafer.reconstruction_temp,
    wafer.qd_growth_temp_offset,
    computedQdGrowthTemp(wafer.reconstruction_temp, wafer.qd_growth_temp_offset, wafer.qd_growth_temp),
    computedGrowthRate(wafer.qd_islanding_time),
    wafer.qd_density,
    wafer.qd_volume,
    wafer.qd_height,
    wafer.qd_volume_cv,
    wafer.pl_peak_nm,
    wafer.pl_fwhm_nm,
    wafer.pl_intensity,
    wafer.standby_vacuum,
    wafer.as_pressure_fill_vacuum,
    wafer.as_bulk_temp
  ];
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildAllRecordsXlsx(wafers) {
  const allRows = [
    [
      "编号", "类型", "MBE记录类型", "尺寸", "结构名称", "日期", "样品托编号", "备注",
      "As 压束流比", "QD 成岛时间(s)", "生长速率(ML/S)", "QD 淀积量", "再构温度(°C)",
      "QD 生长相对温度(°C)", "QD 生长实际温度(°C)", "QD 密度(cm-2)", "QD 体积中位数(nm3)",
      "QD 高度(nm)", "QD 体积CV", "PL峰位(nm)", "FWHM(nm)", "PL强度",
      "待机真空度", "As压充盈真空度", "As bulk温度"
    ],
    ...wafers.map((wafer) => [
      wafer.wafer_code, normalizeWaferType(wafer.wafer_type), machineRecordTypeLabel(wafer.machine_record_type), wafer.size, wafer.structure_name, wafer.growth_date,
      wafer.sample_holder_code, wafer.notes, wafer.as_beam_ratio, wafer.qd_islanding_time,
      computedGrowthRate(wafer.qd_islanding_time), wafer.qd_deposition, wafer.reconstruction_temp,
      wafer.qd_growth_temp_offset, computedQdGrowthTemp(wafer.reconstruction_temp, wafer.qd_growth_temp_offset, wafer.qd_growth_temp),
      wafer.qd_density, wafer.qd_volume, wafer.qd_height, wafer.qd_volume_cv, wafer.pl_peak_nm, wafer.pl_fwhm_nm,
      wafer.pl_intensity, wafer.standby_vacuum, wafer.as_pressure_fill_vacuum, wafer.as_bulk_temp
    ])
  ];
  const itemRows = [[
    "编号", "类型", "路径", "区块", "行类型", "层名/源炉/As压", "材料/生长材料", "厚度/束流",
    "周期/组", "单周期", "掺杂/Value/测速", "N/P", "温度/生长速率", "QD", "备注"
  ]];
  wafers.forEach((wafer) => {
    const map = childMapForItems(wafer.items || []);
    writeXlsxItemRows(itemRows, wafer, map, null, "");
  });
  return xlsxBytes([
    ["记录", allRows],
    ["层与参数", itemRows],
    ["MBE源炉", machineRows(wafers, DEFAULT_SECTION)],
    ["As压", machineRows(wafers, AS_PRESSURE_SECTION)]
  ]);
}

function writeXlsxItemRows(rows, wafer, map, parentId, prefix) {
  (map.get(parentId) || []).forEach((item, index) => {
    const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    rows.push([
      wafer.wafer_code,
      normalizeWaferType(wafer.wafer_type),
      path,
      itemSection(item),
      item.item_type,
      item.layer_name,
      item.material,
      blankNumber(item.thickness_nm),
      blankNumber(item.periods),
      blankNumber(item.single_period_thickness_nm),
      item.doping,
      item.doping_type,
      item.growth_temp,
      item.is_quantum_dot ? "是" : "",
      item.notes
    ]);
    writeXlsxItemRows(rows, wafer, map, item.id, path);
  });
}

function machineRows(wafers, section) {
  const header = section === AS_PRESSURE_SECTION
    ? ["日期编号", "路径", "As压名称", "生长材料", "束流(Torr)", "Value", "生长速率(um/h)", "备注"]
    : ["日期编号", "路径", "源炉", "束流(Torr)", "温度", "测速", "备注"];
  const rows = [header];
  wafers
    .filter((wafer) => normalizeWaferType(wafer.wafer_type) === "machine")
    .forEach((wafer) => {
      const map = childMapForItems(wafer.items || []);
      appendMachineRows(rows, wafer, map, null, "", section);
    });
  return rows;
}

function appendMachineRows(rows, wafer, map, parentId, prefix, section) {
  (map.get(parentId) || [])
    .filter((item) => parentId !== null || itemSection(item) === section)
    .forEach((item, index) => {
      const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      if (section === AS_PRESSURE_SECTION) {
        rows.push([wafer.wafer_code, path, item.layer_name, item.material, blankNumber(item.thickness_nm), item.doping, item.growth_temp, item.notes]);
      } else {
        rows.push([wafer.wafer_code, path, item.layer_name, blankNumber(item.thickness_nm), item.growth_temp, item.doping, item.notes]);
      }
      appendMachineRows(rows, wafer, map, item.id, path, section);
    });
}

function buildFormalSummaryXlsx(wafers) {
  const rows = [[
    "片号", "结构名称", "尺寸", "日期", "样品托编号", "总厚度(nm)", "量子点层数",
    "有源区掺杂方式", "有源区掺杂详情", "盖层厚度(nm)", "备注"
  ]];
  wafers.forEach((wafer) => {
    const map = childMapForItems(wafer.items || []);
    const stats = computeStatsForItems(wafer.items || []);
    rows.push([
      wafer.wafer_code,
      wafer.structure_name,
      wafer.size,
      wafer.growth_date,
      wafer.sample_holder_code,
      formatNumber(stats.totalThickness),
      formatNumber(stats.qdLayerCount),
      activeDopingMethod(stats.activeRegionDopedItems),
      stats.activeRegionDopedItems.map(dopingDetailText).join("；"),
      formatNumber(capThicknessAboveWaveguide(wafer.items || [], map)),
      wafer.notes
    ]);
  });
  return xlsxBytes([["正式片概要", rows]]);
}

function computeStatsForItems(items) {
  return computeStats(childMapForItems(items));
}

function activeDopingMethod(details) {
  const text = details.map((detail) => `${detail.doping || ""} ${detail.doping_type || ""}`).join(" ").toLowerCase();
  const hasBe = /be|p\b/.test(text);
  const hasSi = /si|n\b/.test(text);
  if (hasBe && hasSi) return "codoping";
  if (hasBe) return "Be";
  if (hasSi) return "Si";
  return details.length ? "其他" : "";
}

function capThicknessAboveWaveguide(items, map) {
  const leaves = flattenAllLeaves(items, map);
  const waveguideIndex = leaves.findIndex((item) => /波导|waveguide/i.test(`${item.layer_name || ""} ${item.material || ""}`));
  if (waveguideIndex <= 0) return 0;
  return leaves.slice(0, waveguideIndex).reduce((sum, item) => sum + (isQuantumDot(item) ? 0 : numberValue(item.thickness_nm)), 0);
}

function flattenAllLeaves(items, map) {
  const rows = [];
  (items || []).forEach((item) => {
    const children = map.get(item.id) || [];
    if (children.length) {
      rows.push(...flattenAllLeaves(children, map));
    } else {
      rows.push(item);
    }
  });
  return rows;
}

function xlsxBytes(sheets) {
  const files = [];
  files.push(["[Content_Types].xml", contentTypesXml(sheets.length)]);
  files.push(["_rels/.rels", rootRelsXml()]);
  files.push(["xl/workbook.xml", workbookXml(sheets)]);
  files.push(["xl/_rels/workbook.xml.rels", workbookRelsXml(sheets.length)]);
  sheets.forEach(([name, rows], index) => {
    files.push([`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(rows)]);
  });
  return zipBytes(files.map(([name, text]) => ({ name, data: utf8Bytes(text) })));
}

function contentTypesXml(count) {
  const sheets = Array.from({ length: count }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets}</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function workbookXml(sheets) {
  const sheetXml = sheets.map(([name], index) => `<sheet name="${xmlEscape(safeSheetName(name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml}</sheets></workbook>`;
}

function workbookRelsXml(count) {
  const rels = Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function worksheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function columnName(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function safeSheetName(name) {
  return String(name || "Sheet").replace(/[:\\/?*\[\]]/g, "").slice(0, 31) || "Sheet";
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function utf8Bytes(text) {
  return new TextEncoder().encode(String(text ?? ""));
}

function buildZip(entries) {
  return new Blob([zipBytes(entries)], { type: "application/zip" });
}

function zipBytes(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : utf8Bytes(entry.data);
    const crc = crc32(data);
    const sizes = data.length;
    const { time, date } = dosDateTime(new Date());
    const local = concatBytes(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(sizes), u32(sizes), u16(nameBytes.length), u16(0), nameBytes, data
    );
    localParts.push(local);
    const central = concatBytes(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(sizes), u32(sizes), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes
    );
    centralParts.push(central);
    offset += local.length;
  });
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = concatBytes(
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralSize), u32(centralOffset), u16(0)
  );
  return concatBytes(...localParts, ...centralParts, end);
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value & 0xffff, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  return bytes;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

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
  const pdf = await buildWafersPdfBlob(wafers);
  downloadBlob(pdf, "mbe-structure-images.pdf", "application/pdf");
}

async function buildWafersPdfBlob(wafers) {
  const pages = [];
  for (const wafer of wafers) {
    const canvas = renderWaferPngCanvas(wafer);
    const jpeg = await canvasToJpegBytes(canvas);
    pages.push({ wafer, jpeg, width: canvas.width, height: canvas.height });
  }
  return buildImagePdf(pages);
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
  const width = 1180;
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
  drawWaferSidePanel(ctx, wafer, map, 700, 110, 430, stackHeight);
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

function drawWaferSidePanel(ctx, wafer, map, x, y, width, height) {
  const stats = computeStatsForItems(wafer.items || []);
  ctx.save();
  roundedRect(ctx, x, y, width, height, 10);
  ctx.fillStyle = "#f7faf6";
  ctx.fill();
  ctx.strokeStyle = "#d9ded6";
  ctx.stroke();
  ctx.fillStyle = "#18201d";
  ctx.font = "700 18px sans-serif";
  ctx.fillText("附加信息", x + 18, y + 30);
  const rows = [
    ["样品托", wafer.sample_holder_code],
    ["日期", wafer.growth_date],
    ["备注", wafer.notes],
    ["QD层数", formatNumber(stats.qdLayerCount)],
    ["有源区掺杂", activeDopingMethod(stats.activeRegionDopedItems)],
    ["盖层厚度", `${formatNumber(capThicknessAboveWaveguide(wafer.items || [], map))} nm`],
    ["As压束流比", wafer.as_beam_ratio],
    ["QD成岛时间", wafer.qd_islanding_time],
    ["生长速率", computedGrowthRate(wafer.qd_islanding_time) ? `${computedGrowthRate(wafer.qd_islanding_time)} ML/S` : ""],
    ["QD淀积量", wafer.qd_deposition],
    ["再构温度", wafer.reconstruction_temp],
    ["QD生长温度", computedQdGrowthTemp(wafer.reconstruction_temp, wafer.qd_growth_temp_offset, wafer.qd_growth_temp)],
    ["QD密度", wafer.qd_density],
    ["QD体积中位数", wafer.qd_volume],
    ["QD高度", wafer.qd_height],
    ["PL峰位", wafer.pl_peak_nm],
    ["FWHM", wafer.pl_fwhm_nm],
    ["PL强度", wafer.pl_intensity]
  ].filter(([, value]) => String(value || "").trim());
  let cursor = y + 58;
  rows.forEach(([label, value]) => {
    if (cursor > y + height - 24) return;
    ctx.fillStyle = "#68726b";
    ctx.font = "12px sans-serif";
    ctx.fillText(label, x + 18, cursor);
    ctx.fillStyle = "#18201d";
    ctx.font = "700 13px sans-serif";
    wrapCanvasText(ctx, String(value), x + 118, cursor, width - 140, 16, 2);
    cursor += 36;
  });
  ctx.restore();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const chars = Array.from(text);
  let line = "";
  let lines = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const test = line + chars[index];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = chars[index];
      if (lines >= maxLines) return;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
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
  const doped = hasDoping(item);
  const qdLane = part.qdMarkers.length ? qdLaneRect(x, y, width, height, doped, part.qdMarkers) : null;
  const reserveRight = qdLane ? width - (qdLane.x - x) + 8 : doped ? 48 : 24;
  drawSegmentText(ctx, item.layer_name || item.material || "未命名层", stackMeta(item, part.computed, map, part.qdMarkers), x, y, width, height, reserveRight);
  if (qdLane) drawQdLaneCanvas(ctx, qdLane.x, qdLane.y, qdLane.width, qdLane.height, part.qdMarkers);
  if (doped) drawDopedBadge(ctx, x + width - 30, y + height / 2);
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
  const qdLane = qdLaneRect(x, y, width, height, false, [item]);
  drawSegmentText(ctx, item.layer_name || item.material || "QD", stackMeta(item, { thickness: 0 }, new Map()), x, y, width, height, width - (qdLane.x - x) + 8);
  drawQdLaneCanvas(ctx, qdLane.x, qdLane.y, qdLane.width, qdLane.height, [item]);
}

function drawSegmentText(ctx, name, meta, x, y, width, height, reserveRight = 48) {
  ctx.save();
  ctx.beginPath();
  const textWidth = Math.max(32, width - reserveRight - 14);
  ctx.rect(x + 8, y + 2, textWidth, height - 4);
  ctx.clip();
  ctx.fillStyle = "#121714";
  ctx.font = "700 16px sans-serif";
  ctx.fillText(name, x + 14, y + Math.min(24, Math.max(18, height / 2)), textWidth - 6);
  if (height >= 42) {
    ctx.fillStyle = "rgba(24,32,29,0.72)";
    ctx.font = "14px sans-serif";
    ctx.fillText(meta, x + 14, y + Math.min(46, Math.max(34, height / 2 + 18)), textWidth - 6);
  }
  ctx.restore();
}

function qdLaneRect(x, y, width, height, doped = false, qdItems = []) {
  const hasQdDoping = qdItems.some(hasDoping);
  const laneWidth = hasQdDoping ? Math.min(260, Math.max(126, width * 0.38)) : Math.min(150, Math.max(72, width * 0.24));
  const rightReserve = doped ? 42 : 10;
  const laneHeight = hasQdDoping ? 18 : 13;
  const bottomGap = Math.max(4, Math.min(7, height * 0.12));
  return {
    x: x + width - laneWidth - rightReserve,
    y: y + Math.max(3, height - laneHeight - bottomGap),
    width: laneWidth,
    height: laneHeight
  };
}

function drawQdLaneCanvas(ctx, x, y, width, height, items) {
  const tag = qdDopingTag(items, true);
  ctx.save();
  roundedRect(ctx, x, y, width, height, Math.min(12, height / 2));
  ctx.fillStyle = tag ? "rgba(255,240,247,0.92)" : "rgba(255,247,250,0.78)";
  ctx.fill();
  ctx.strokeStyle = tag ? "rgba(191,77,111,0.5)" : "rgba(191,77,111,0.16)";
  ctx.stroke();
  roundedRect(ctx, x, y, width, height, Math.min(12, height / 2));
  ctx.clip();
  let dotsX = x + 6;
  let dotsWidth = width - 12;
  if (tag) {
    ctx.font = "700 10px sans-serif";
    const tagWidth = Math.min(width - 36, Math.max(44, ctx.measureText(tag).width + 16));
    const fittedTag = fitCanvasText(ctx, tag, tagWidth - 10);
    roundedRect(ctx, x + 3, y + 3, tagWidth, height - 6, 7);
    ctx.fillStyle = "#8f2f51";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fittedTag, x + 3 + tagWidth / 2, y + height / 2 + 0.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    dotsX = x + tagWidth + 10;
    dotsWidth = Math.max(24, width - tagWidth - 14);
  }
  drawQdDotsCanvas(ctx, dotsX, y + height / 2 - 5, dotsWidth, items);
  ctx.restore();
}

function drawQdDotsCanvas(ctx, x, y, width, items) {
  ctx.fillStyle = "rgba(191,77,111,0.92)";
  const count = Math.max(3, Math.min(42, Math.floor(width / 16)));
  for (let index = 0; index < count; index += 1) {
    ctx.beginPath();
    ctx.arc(x + 8 + index * 15, y + 5, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fitCanvasText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && ctx.measureText(`${fitted}...`).width > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}...`;
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
  const item = state.current?.items.find((candidate) => candidate.id === id);
  if (item) state.activeItemSection = itemSection(item);
  renderItems();
}

function markSelectedRow(id) {
  state.selectedItemId = id;
  state.insertTargetItemId = id;
  const item = state.current?.items.find((candidate) => candidate.id === id);
  if (item) state.activeItemSection = itemSection(item);
  document.querySelectorAll("tbody tr[data-id]").forEach((row) => {
    row.classList.toggle("selected", Number(row.dataset.id) === id);
  });
}

function rememberTableTarget(event) {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  state.activeItemSection = normalizeItemSection(row.dataset.section);
  markSelectedRow(Number(row.dataset.id));
}

function selectedItem() {
  if (!state.current || !state.selectedItemId) return null;
  return state.current.items.find((item) => item.id === state.selectedItemId) || null;
}

function insertionTargetItem() {
  if (!state.current) return null;
  const activeRow = document.activeElement?.closest?.("tr[data-id]");
  if (activeRow) state.activeItemSection = normalizeItemSection(activeRow.dataset.section);
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
  return flattenItems(null, 0, childMap(), state.activeItemSection)[0]?.item || null;
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

function flattenItems(parentId = null, depth = 0, map = childMap(), section = null) {
  const rows = [];
  (map.get(parentId) || [])
    .filter((item) => parentId !== null || !section || itemSection(item) === section)
    .forEach((item) => {
    rows.push({ item, depth });
    if (isRepeatItem(item, map) && (isMachineRecord() || isExpanded(item))) {
      rows.push(...flattenItems(item.id, depth + 1, map, section));
    }
  });
  return rows;
}

function isRepeatItem(item, map = childMap()) {
  return item.item_type === "repeat" || numberValue(item.periods) > 1 || (map.get(item.id) || []).length > 0;
}

function isExpanded(item) {
  if (isMachineRecord()) return true;
  return !state.collapsedItemIds.has(item.id);
}

function toggleExpanded(id) {
  if (state.collapsedItemIds.has(id)) {
    state.collapsedItemIds.delete(id);
  } else {
    state.collapsedItemIds.add(id);
  }
}

async function toggleExpandedAnimated(id) {
  if (state.pendingExpandToggles.has(id)) return;
  const map = childMap();
  const item = state.current?.items.find((candidate) => candidate.id === id);
  if (!item || !isRepeatItem(item, map)) return;
  state.pendingExpandToggles.add(id);
  try {
    const expanded = isExpanded(item);
    const rows = flattenItems(id, 1, map);
    if (expanded) {
      queueExpandAnimation(id, rows, false);
      renderItems();
      await delay(240);
      state.collapsedItemIds.add(id);
      renderItems();
    } else {
      state.collapsedItemIds.delete(id);
      const expandedRows = flattenItems(id, 1, map);
      queueExpandAnimation(id, expandedRows, true);
      renderItems();
    }
  } finally {
    state.pendingExpandToggles.delete(id);
  }
}

function normalizeRepeatState(item, map = childMap()) {
  if (isMachineRecord()) {
    item.item_type = isRepeatItem(item, map) ? "repeat" : "layer";
    return;
  }
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
    clearInspector();
    return;
  }
  if (isMachineRecord()) {
    clearInspector();
    return;
  }
  const map = childMap();
  const stats = computeStats(map);
  els.totalThickness.textContent = `${formatNumber(stats.totalThickness)} nm`;
  renderStack(map);
  renderStats(stats);
}

function clearInspector() {
  els.stackVisual.innerHTML = `<div class="stack-empty">暂无结构</div>`;
  els.statsContent.innerHTML = "";
  els.totalThickness.textContent = "0 nm";
}

function renderMachineInspector() {
  const map = childMap();
  const sourceRoots = (map.get(null) || []).filter((item) => itemSection(item) === DEFAULT_SECTION);
  const asRoots = (map.get(null) || []).filter((item) => itemSection(item) === AS_PRESSURE_SECTION);
  const sourceRows = sourceRoots.map((item) => machineSummaryRow(item, map, DEFAULT_SECTION)).join("");
  const asRows = asRoots.map((item) => machineSummaryRow(item, map, AS_PRESSURE_SECTION)).join("");
  els.totalThickness.textContent = `${sourceRoots.length} 源炉 · ${asRoots.length} As压`;
  els.stackVisual.innerHTML = `
    <div class="machine-summary">
      <div class="metric-grid">
        <div class="metric"><strong>${escapeHtml(state.current.standby_vacuum || "-")}</strong><span>待机真空度</span></div>
        <div class="metric"><strong>${escapeHtml(state.current.as_pressure_fill_vacuum || "-")}</strong><span>As 压充盈</span></div>
        <div class="metric"><strong>${escapeHtml(state.current.as_bulk_temp || "-")}</strong><span>As bulk 温度</span></div>
      </div>
    </div>
  `;
  els.statsContent.innerHTML = `
    <div>
      <div class="section-title"><h2>源炉概览</h2></div>
      <div class="doping-list">${sourceRows || `<span class="wafer-meta">暂无源炉参数</span>`}</div>
    </div>
    <div>
      <div class="section-title"><h2>As 压概览</h2></div>
      <div class="doping-list">${asRows || `<span class="wafer-meta">暂无 As 压参数</span>`}</div>
    </div>
  `;
}

function machineSummaryRow(item, map, section) {
  const children = map.get(item.id) || [];
  const countText = children.length ? `，${children.length} 子项` : "";
  const main = section === AS_PRESSURE_SECTION
    ? [item.material, item.thickness_nm ? `${item.thickness_nm} Torr` : "", item.doping ? `Value ${item.doping}` : "", item.growth_temp ? `${item.growth_temp} um/h` : ""]
    : [item.material, item.thickness_nm ? `${item.thickness_nm} Torr` : "", item.growth_temp ? `${item.growth_temp} °C` : ""];
  return `
    <div class="stat-row">
      <span>${escapeHtml(item.layer_name || item.material || "未命名")}</span>
      <strong>${escapeHtml(main.filter(Boolean).join(" · ") || "-")}${escapeHtml(countText)}</strong>
    </div>
  `;
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
      <div class="segment-body">
        <div class="segment-header">
          <div class="segment-name">${escapeHtml(item.layer_name || item.material || "未命名层")}</div>
          <div class="segment-meta">${escapeHtml(stackMeta(item, computed, map, part.qdMarkers))}</div>
        </div>
        ${qdCap ? renderQdDots(part.qdMarkers) : ""}
      </div>
      ${hasChildren ? `<div class="repeat-children">${childHtml}</div>` : ""}
    </div>
  `;
}

function renderQdDots(items) {
  const label = items.map(qdVisualText).filter(Boolean).join(" + ");
  const dopingTag = qdDopingTag(items);
  return `
    <div class="qd-dots ${dopingTag ? "qd-doped" : ""}" title="${escapeAttr(label ? `QD ${label}` : "QD")}">
      ${dopingTag ? `<span class="qd-doping-tag">${escapeHtml(dopingTag)}</span>` : ""}
    </div>
  `;
}

function renderQdMarker(item, depth, height = STACK_MIN_QD_HEIGHT) {
  const color = materialColor(item.material || item.layer_name || "QD");
  return `
    <div class="stack-segment qd-marker compact" style="height:${height}px; min-height:${height}px; background-color:${color}; --stack-depth:${depth}">
      <div class="segment-body">
        <div class="segment-header">
          <div class="segment-name">${escapeHtml(item.layer_name || item.material || "QD")}</div>
          <div class="segment-meta">${escapeHtml(stackMeta(item, { thickness: 0 }, new Map()))}</div>
        </div>
        ${renderQdDots([item])}
      </div>
    </div>
  `;
}

function qdDopingTag(items, includeText = false) {
  const dopedItems = (items || []).filter(hasDoping);
  if (!dopedItems.length) return "";
  const types = [...new Set(dopedItems.map((item) => normalizeDopingType(item.doping_type)).filter(Boolean))];
  const typeLabel = types.length === 1 ? types[0] : types.length > 1 ? types.join("/") : "D";
  const compact = `QD-${typeLabel}`;
  if (!includeText || dopedItems.length !== 1) return compact;
  const text = String(dopedItems[0].doping || "").trim();
  return text ? `${compact} ${text}` : compact;
}

function stackMeta(item, computed, map, qdMarkers = []) {
  const material = item.material || "";
  const thickness = `${formatNumber(computed.thickness)} nm`;
  const dopingText = dopingMetaText(item);
  const dopingSuffix = dopingText ? ` · ${dopingText}` : "";
  const qdText = qdMarkers.length ? ` · QD ${qdMarkers.map(qdVisualText).filter(Boolean).join(" + ") || "标记"}` : "";
  if (isRepeatItem(item, map)) {
    const childCount = (map.get(item.id) || []).length;
    return `${item.periods || 1}x · ${childCount ? `${childCount} 子层 · ` : material ? `${material} · ` : ""}${thickness}${dopingSuffix}${qdText}`;
  }
  if (isQuantumDot(item)) {
    const growth = qdGrowthText(item);
    return `${material}${growth ? ` · ${growth}` : ""} · 不计厚度${dopingSuffix}`;
  }
  return `${material} · ${thickness}${dopingSuffix}${qdText}`;
}

function qdVisualText(item) {
  const growth = qdGrowthText(item);
  const doping = dopingMetaText(item);
  return [growth, doping].filter(Boolean).join(" · ");
}

function dopingMetaText(item) {
  if (!hasDoping(item)) return "";
  const type = normalizeDopingType(item.doping_type);
  const text = String(item.doping || "").trim();
  if (type && text) return `${type} · ${text}`;
  if (type) return `${type} 掺杂`;
  return text;
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

function normalizeWaferType(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["formal", "test", "machine"].includes(text) ? text : "formal";
}

function normalizeMachineRecordType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "开腔") return "open_chamber";
  if (text === "测速") return "speed_test";
  return Object.prototype.hasOwnProperty.call(MACHINE_RECORD_TYPES, text) ? text : "";
}

function machineRecordTypeLabel(value) {
  return MACHINE_RECORD_TYPES[normalizeMachineRecordType(value)] || "日常";
}

function isMachineSpeedTestRecord() {
  return isMachineRecord() && normalizeMachineRecordType(state.current?.machine_record_type) === "speed_test";
}

function stripMachineRecordSuffix(value) {
  return String(value || "").trim().replace(/(?:开腔|测速)$/u, "").trim();
}

function codeWithMachineRecordSuffix(value, recordType) {
  const base = stripMachineRecordSuffix(value) || currentShortDateCode();
  const suffix = MACHINE_RECORD_TYPES[normalizeMachineRecordType(recordType)] || "";
  return `${base}${suffix}`;
}

function normalizeItemSection(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === AS_PRESSURE_SECTION ? AS_PRESSURE_SECTION : DEFAULT_SECTION;
}

function itemSection(item) {
  return normalizeItemSection(item?.section);
}

function isMachineRecord(wafer = state.current) {
  return normalizeWaferType(wafer?.wafer_type) === "machine";
}

function machineItemDefaults(section, child = false, parent = null) {
  if (section === AS_PRESSURE_SECTION) {
    return {
      layer_name: child ? parent?.layer_name || "As压子项" : "As压",
      material: child ? parent?.material || "" : "",
      thickness_nm: "",
      periods: "",
      single_period_thickness_nm: "",
      doping: "",
      doping_type: "",
      growth_temp: "",
      is_quantum_dot: 0,
      notes: ""
    };
  }
  return {
    layer_name: child ? parent?.layer_name || "源炉子项" : "源炉",
    material: child ? parent?.material || "" : "",
    thickness_nm: "",
    periods: "",
    single_period_thickness_nm: "",
    doping: "",
    doping_type: "",
    growth_temp: "",
    is_quantum_dot: 0,
    notes: ""
  };
}

function computedGrowthRate(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return "";
  const seconds = Number(match[0]);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return (1.7 / seconds).toFixed(3);
}

function firstNumber(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function formatCompactNumber(value) {
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return String(Math.round(value));
  }
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function hasComputedQdGrowthTemp(wafer) {
  return firstNumber(wafer?.reconstruction_temp) !== null && firstNumber(wafer?.qd_growth_temp_offset) !== null;
}

function computedQdGrowthTemp(reconstructionTemp, offset, fallback = "") {
  const reconstruction = firstNumber(reconstructionTemp);
  const relative = firstNumber(offset);
  if (reconstruction === null || relative === null) {
    return String(fallback || "");
  }
  return formatCompactNumber(reconstruction + relative);
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
    section: normalizeItemSection(shortcut.section),
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

async function handleShortcutClick(event) {
  const button = event.target.closest("[data-shortcut-action]");
  if (!button) return;
  const index = Number(button.dataset.shortcutIndex);
  const action = button.dataset.shortcutAction;
  const shortcut = state.shortcuts[index];
  if (!shortcut) return;
  try {
    if (action === "insert") {
      await insertShortcutLayer(shortcut);
    }
    if (action === "remove") {
      const confirmed = await confirmShortcutRemoval(shortcut);
      if (!confirmed) return;
      state.shortcuts.splice(index, 1);
      saveShortcuts();
      renderShortcuts();
      showStatus("快捷项已删除");
    }
  } catch (error) {
    showError(error);
  }
}

function confirmShortcutRemoval(shortcut) {
  return new Promise((resolve) => {
    const title = shortcutTitle(shortcut);
    const childCount = shortcutChildCount(shortcut);
    const modal = showModal(`
      <div class="modal-backdrop">
        <div class="modal-panel">
          <div class="modal-title">
            <h2>删除快捷项</h2>
            <button data-modal-close title="关闭">×</button>
          </div>
          <p class="modal-copy">确认删除 <strong>${escapeHtml(title)}</strong>${childCount ? `，包含 ${childCount} 个子层` : ""}？</p>
          <div class="modal-actions">
            <button data-modal-close>取消</button>
            <button class="danger-btn" id="confirmShortcutDeleteBtn">确认删除</button>
          </div>
        </div>
      </div>
    `, () => resolve(false));
    modal.querySelector("#confirmShortcutDeleteBtn").addEventListener("click", () => {
      closeModal(modal);
      resolve(true);
    });
  });
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
  const shortcutSection = normalizeItemSection(shortcut.section || state.activeItemSection);
  state.activeItemSection = shortcutSection;
  const target = insertionTargetItem();
  const sameSectionTarget = target && itemSection(target) === shortcutSection ? target : null;
  const visibleTarget = sameSectionTarget || firstVisibleItem();
  const tree = shortcutTreeForInsert(shortcut, sameSectionTarget, shortcutSection);
  const result = await api(`/api/wafers/${state.current.id}/restore`, {
    method: "POST",
    body: JSON.stringify({ tree })
  });
  state.selectedItemId = result.item.id;
  state.insertTargetItemId = result.item.id;
  await ensureItemBefore(result.item.id, visibleTarget?.id || null);
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
    section: itemSection(item),
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

function shortcutTreeForInsert(shortcut, target, section = DEFAULT_SECTION) {
  const tree = shortcutToTree(shortcut);
  tree.section = normalizeItemSection(section);
  if (target) {
    tree.parent_id = target.parent_id ?? null;
    tree.order_index = target.order_index;
    tree.section = itemSection(target);
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
    section: normalizeItemSection(normalized.section),
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
    children: (normalized.children || []).map((child) => {
      const childTree = shortcutToTree(child);
      childTree.section = normalizeItemSection(normalized.section);
      return childTree;
    })
  };
}

function pickWaferFields(wafer) {
  const growthRate = computedGrowthRate(wafer.qd_islanding_time);
  const qdGrowthTemp = computedQdGrowthTemp(
    wafer.reconstruction_temp,
    wafer.qd_growth_temp_offset,
    wafer.qd_growth_temp
  );
  const waferType = normalizeWaferType(wafer.wafer_type);
  const machineRecordType = normalizeMachineRecordType(wafer.machine_record_type);
  const payload = {
    wafer_code: waferType === "machine"
      ? codeWithMachineRecordSuffix(wafer.wafer_code, machineRecordType)
      : wafer.wafer_code,
    size: wafer.size,
    structure_name: wafer.structure_name,
    growth_date: wafer.growth_date,
    notes: wafer.notes,
    sample_holder_code: wafer.sample_holder_code,
    wafer_type: waferType,
    machine_record_type: machineRecordType,
    growth_rate: growthRate,
    qd_growth_temp: qdGrowthTemp
  };
  TEST_WAFER_FIELDS.forEach((field) => {
    if (field !== "growth_rate" && field !== "qd_growth_temp") {
      payload[field] = wafer[field] || "";
    }
  });
  MACHINE_WAFER_FIELDS.forEach((field) => {
    if (field !== "machine_record_type") {
      payload[field] = wafer[field] || "";
    }
  });
  return payload;
}

async function nextRecordCode() {
  if (state.waferType === "machine") {
    return nextMachineRecordCode();
  }
  return nextWaferCode();
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

async function nextMachineRecordCode() {
  const prefix = currentShortDateCode();
  try {
    const payload = await api(`/api/wafers?search=${encodeURIComponent(prefix)}&type=machine`);
    return uniquePlainCode(prefix, payload.wafers || []);
  } catch (error) {
    console.warn(error);
    return uniquePlainCode(prefix, state.wafers || []);
  }
}

function currentWaferDatePrefix() {
  return `N${currentShortDateCode()}`;
}

function currentShortDateCode() {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
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

function uniquePlainCode(prefix, wafers) {
  const used = new Set((wafers || []).map((wafer) => String(wafer.wafer_code || "").trim()).filter(Boolean));
  if (!used.has(prefix)) return prefix;
  let index = 2;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
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
