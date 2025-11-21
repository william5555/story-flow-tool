// === 資料模型 ===
let project = {
  id: "project-1",
  title: "未命名故事",
  themes: [],
  nodes: [],
  links: []
};

const STORAGE_KEY = "storyFlowProject_v1";

// 目前右側詳細面板狀態
let currentDetail = { type: null, id: null };

// 節點選取狀態（支援多選）
const selectedNodeIds = new Set();

// 拖曳節點狀態（支援群組拖曳）
const dragState = {
  nodeId: null,        // 起始拖曳的節點
  selectedIds: [],     // 本次一起移動的節點 id 清單
  startMouseX: 0,
  startMouseY: 0,
  startPositions: {}   // { nodeId: { x, y } }
};

// 畫布拖曳狀態（pan）
const panState = {
  active: false,
  startMouseX: 0,
  startMouseY: 0,
  startScrollLeft: 0,
  startScrollTop: 0
};

// 框選狀態
const selectionState = {
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  element: null        // DOM：框選的那個半透明方框
};

// === 工具函式 ===
function generateId(prefix) {
  return (
    prefix +
    "-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).substring(2, 7)
  );
}

function findNodeById(id) {
  return project.nodes.find(n => n.id === id) || null;
}

function findThemeById(id) {
  return project.themes.find(t => t.id === id) || null;
}

function getNodeTitle(id) {
  const node = findNodeById(id);
  return node ? node.title || "(未命名節點)" : "(已刪除)";
}

// === 建立資料物件 ===
function createNode(type, options = {}) {
  const id = generateId(type);
  const title = type === "main" ? "新主線" : "新分支";

  const node = {
    id,
    type, // "main" | "branch"
    title,
    items: [],
    position: {
      x: options.x != null ? options.x : 200,
      y: options.y != null ? options.y : 150
    }
  };

  project.nodes.push(node);

  // 若有指定來源節點，建立連線 （母節點 -> 子節點）
  if (options.fromNodeId) {
    project.links.push({
      id: generateId("link"),
      from: options.fromNodeId,
      to: id
    });
  }

  // 新增節點時：只選這個
  selectedNodeIds.clear();
  selectedNodeIds.add(id);

  renderAll();
  openNodeDetail(id);
  autoSave();
  return node;
}

function createTheme() {
  const id = generateId("theme");
  const theme = {
    id,
    title: "新主題",
    items: []
  };
  project.themes.push(theme);
  renderAll();
  openThemeDetail(id);
  autoSave();
  return theme;
}

// === 刪除：節點 & 主題（同步清除連線 / 選取） ===
function deleteNode(nodeId) {
  project.nodes = project.nodes.filter(n => n.id !== nodeId);
  project.links = project.links.filter(l => l.from !== nodeId && l.to !== nodeId);
  selectedNodeIds.delete(nodeId);

  if (currentDetail.type === "node" && currentDetail.id === nodeId) {
    closeDetailPanel();
  }

  renderAll();
  autoSave();
}

function deleteTheme(themeId) {
  project.themes = project.themes.filter(t => t.id !== themeId);

  if (currentDetail.type === "theme" && currentDetail.id === themeId) {
    closeDetailPanel();
  }

  renderAll();
  autoSave();
}

// === 儲存相關 ===
function autoSave() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (e) {
    console.warn("無法儲存到 localStorage：", e);
  }
}

function handleSaveClick() {
  autoSave();
  alert("已儲存到瀏覽器 localStorage。");
}

function handleLoadClick() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    alert("尚未有儲存的資料。");
    return;
  }
  try {
    const data = JSON.parse(raw);
    project = data;
    selectedNodeIds.clear();
    renderAll();
    alert("已從 localStorage 載入。");
  } catch (e) {
    alert("載入失敗：JSON 格式錯誤。");
  }
}

function handleExportClick() {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (project.title || "story-flow") + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

function handleImportClick() {
  const fileInput = document.getElementById("fileInput");
  fileInput.value = "";
  fileInput.click();
}

function handleFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      project = data;
      selectedNodeIds.clear();
      renderAll();
      alert("匯入完成。");
    } catch (err) {
      alert("匯入失敗：JSON 格式錯誤。");
    }
  };
  reader.readAsText(file, "utf-8");
}

// === 視圖切換 ===
function switchView(targetId) {
  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("active", view.id === targetId);
  });

  document.querySelectorAll(".mode-button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.target === targetId);
  });

  if (targetId === "view-flow") {
    setTimeout(renderFlow, 0);
  }
}

// === 節點點擊邏輯（含 Shift 多選） ===
function handleNodeClick(nodeId, evt) {
  if (evt.shiftKey) {
    // Shift + 點擊：加入/移出多選群組
    if (selectedNodeIds.has(nodeId)) {
      selectedNodeIds.delete(nodeId);
    } else {
      selectedNodeIds.add(nodeId);
    }
  } else {
    // 一般點擊：只選這一個
    selectedNodeIds.clear();
    selectedNodeIds.add(nodeId);
  }

  openNodeDetail(nodeId);
  renderFlow(); // 更新選取樣式
}

// === 流程圖渲染 ===
function renderFlow() {
  const nodesLayer = document.getElementById("flowNodesLayer");
  const svg = document.getElementById("flowLinksOverlay");
  nodesLayer.innerHTML = "";
  svg.innerHTML = "";

  // 定義箭頭樣式
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrowhead");
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("refX", "10");
  marker.setAttribute("refY", "3.5");
  marker.setAttribute("orient", "auto");
  const markerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  markerPath.setAttribute("d", "M0,0 L10,3.5 L0,7 Z");
  markerPath.setAttribute("fill", "#9fb3c8");
  marker.appendChild(markerPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // 節點
  project.nodes.forEach(node => {
    const btn = document.createElement("button");

    const classes = [
      "flow-node",
      node.type === "main" ? "node-main" : "node-branch"
    ];
    if (selectedNodeIds.has(node.id)) {
      classes.push("is-selected");
    }
    btn.className = classes.join(" ");

    btn.textContent = node.title || "(未命名節點)";
    btn.dataset.id = node.id;

    const x = node.position?.x ?? 200;
    const y = node.position?.y ?? 150;
    btn.style.left = x + "px";
    btn.style.top = y + "px";

    // 點擊：選取 / 多選
    btn.addEventListener("click", evt => {
      evt.stopPropagation();
      handleNodeClick(node.id, evt);
    });

    // 拖曳節點（群組拖曳）
    btn.addEventListener("mousedown", evt => {
      if (evt.button !== 0) return; // 左鍵
      evt.stopPropagation();

      // 若目前沒選它、且沒按 Shift，則只選它
      if (!evt.shiftKey && !selectedNodeIds.has(node.id)) {
        selectedNodeIds.clear();
        selectedNodeIds.add(node.id);
        renderFlow();
      }

      // 本次移動的群組：目前選到的全部；若空集合，就只移動自己
      const groupIds =
        selectedNodeIds.size > 0 ? Array.from(selectedNodeIds) : [node.id];

      dragState.nodeId = node.id;
      dragState.selectedIds = groupIds;
      dragState.startMouseX = evt.clientX;
      dragState.startMouseY = evt.clientY;
      dragState.startPositions = {};

      groupIds.forEach(id => {
        const n = findNodeById(id);
        if (!n) return;
        dragState.startPositions[id] = {
          x: n.position?.x ?? 200,
          y: n.position?.y ?? 150
        };
      });

      document.body.classList.add("dragging-node");
    });

    nodesLayer.appendChild(btn);
  });

  // 連線：支援多前置、多分支
  project.links.forEach(link => {
    const fromNode = findNodeById(link.from);
    const toNode = findNodeById(link.to);
    if (!fromNode || !toNode) return;

    const x1 = (fromNode.position?.x ?? 0) + 70;
    const y1 = (fromNode.position?.y ?? 0) + 20;
    const x2 = (toNode.position?.x ?? 0) + 70;
    const y2 = (toNode.position?.y ?? 0) + 20;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "line");
    path.setAttribute("x1", x1);
    path.setAttribute("y1", y1);
    path.setAttribute("x2", x2);
    path.setAttribute("y2", y2);
    path.setAttribute("stroke", "#9fb3c8");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("marker-end", "url(#arrowhead)");
    svg.appendChild(path);
  });
}

// === 主線／分支清單 ===
function renderNodesList() {
  const container = document.getElementById("nodesList");
  container.innerHTML = "";

  if (project.nodes.length === 0) {
    const p = document.createElement("p");
    p.className = "subtle-text";
    p.textContent =
      "尚未建立任何主線或分支。請使用上方「＋ 主線／＋ 分支」新增。";
    container.appendChild(p);
    return;
  }

  project.nodes.forEach(node => {
    const card = document.createElement("div");
    card.className = "card";

    const header = document.createElement("div");
    header.className = "card-header";

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = node.title || "(未命名節點)";

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const badge = document.createElement("span");
    badge.className =
      "badge " + (node.type === "main" ? "badge-main" : "badge-branch");
    badge.textContent = node.type === "main" ? "主線" : "分支";

    meta.appendChild(badge);

    header.appendChild(title);
    header.appendChild(meta);

    const snippet = document.createElement("div");
    snippet.className = "subtle-text";
    snippet.textContent = `項目數：${node.items.length}`;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "編輯內容";
    btnEdit.addEventListener("click", () => openNodeDetail(node.id));

    const btnFocusFlow = document.createElement("button");
    btnFocusFlow.textContent = "在流程圖中查看";
    btnFocusFlow.addEventListener("click", () => {
      switchView("view-flow");
      setTimeout(() => openNodeDetail(node.id), 0);
    });

    const btnDelete = document.createElement("button");
    btnDelete.textContent = "刪除";
    btnDelete.addEventListener("click", () => {
      if (
        confirm(
          "確定要刪除此節點嗎？與此節點相關的所有連線也會一併移除。"
        )
      ) {
        deleteNode(node.id);
      }
    });

    actions.appendChild(btnEdit);
    actions.appendChild(btnFocusFlow);
    actions.appendChild(btnDelete);

    card.appendChild(header);
    card.appendChild(snippet);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

// === 主題清單 ===
function renderThemesList() {
  const container = document.getElementById("themesList");
  container.innerHTML = "";

  if (project.themes.length === 0) {
    const p = document.createElement("p");
    p.className = "subtle-text";
    p.textContent =
      "尚未建立任何主題卡片。請使用上方「＋ 主題」新增。";
    container.appendChild(p);
    return;
  }

  project.themes.forEach(theme => {
    const card = document.createElement("div");
    card.className = "card";

    const header = document.createElement("div");
    header.className = "card-header";

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = theme.title || "(未命名主題)";

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const badge = document.createElement("span");
    badge.className = "badge badge-theme";
    badge.textContent = "主題";
    meta.appendChild(badge);

    header.appendChild(title);
    header.appendChild(meta);

    const snippet = document.createElement("div");
    snippet.className = "subtle-text";
    snippet.textContent = `項目數：${theme.items.length}`;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "編輯內容";
    btnEdit.addEventListener("click", () => openThemeDetail(theme.id));

    const btnDelete = document.createElement("button");
    btnDelete.textContent = "刪除";
    btnDelete.addEventListener("click", () => {
      if (confirm("確定要刪除此主題卡片嗎？")) {
        deleteTheme(theme.id);
      }
    });

    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);

    card.appendChild(header);
    card.appendChild(snippet);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

// === 詳細面板：開啟／關閉 ===
function openNodeDetail(nodeId) {
  currentDetail = { type: "node", id: nodeId };
  const detailPanel = document.getElementById("detailPanel");
  detailPanel.classList.remove("hidden");
  document.getElementById("detailTitle").textContent = "節點內容";
  renderDetailContent();
  switchView("view-flow");
}

function openThemeDetail(themeId) {
  currentDetail = { type: "theme", id: themeId };
  const detailPanel = document.getElementById("detailPanel");
  detailPanel.classList.remove("hidden");
  document.getElementById("detailTitle").textContent = "主題內容";
  renderDetailContent();
}

function closeDetailPanel() {
  const detailPanel = document.getElementById("detailPanel");
  detailPanel.classList.add("hidden");
  currentDetail = { type: null, id: null };
}

// === 詳細面板內容 ===
function renderDetailContent() {
  const container = document.getElementById("detailContent");
  container.innerHTML = "";

  if (!currentDetail.type || !currentDetail.id) {
    const p = document.createElement("p");
    p.className = "subtle-text";
    p.textContent = "請從流程圖或清單中選擇一個節點／主題。";
    container.appendChild(p);
    return;
  }

  if (currentDetail.type === "node") {
    const node = findNodeById(currentDetail.id);
    if (!node) {
      container.textContent = "找不到節點。";
      return;
    }

    const fgTitle = document.createElement("div");
    fgTitle.className = "field-group";
    const labelTitle = document.createElement("label");
    labelTitle.textContent = "節點名稱（顯示於流程圖）：";
    const inputTitle = document.createElement("input");
    inputTitle.type = "text";
    inputTitle.value = node.title || "";
    inputTitle.dataset.field = "node-title";
    fgTitle.appendChild(labelTitle);
    fgTitle.appendChild(inputTitle);

    const typeRow = document.createElement("div");
    typeRow.className = "field-group";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "節點類型：";
    const typeInfo = document.createElement("div");
    typeInfo.className = "subtle-text";
    typeInfo.textContent = node.type === "main" ? "主線" : "分支";
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeInfo);

    container.appendChild(fgTitle);
    container.appendChild(typeRow);

    // 若為「分支」節點：提供「前一個節點（可多選）」設定
    if (node.type === "branch") {
      const fgParents = document.createElement("div");
      fgParents.className = "field-group";
      const labelParents = document.createElement("label");
      labelParents.textContent = "此分支的前一個節點（可多選）：";

      const selectParents = document.createElement("select");
      selectParents.multiple = true;
      selectParents.size = 4;
      selectParents.dataset.field = "branch-parents";

      const parentIds = project.links
        .filter(l => l.to === node.id)
        .map(l => l.from);

      project.nodes
        .filter(n => n.id !== node.id)
        .forEach(n => {
          const opt = document.createElement("option");
          opt.value = n.id;
          opt.textContent = getNodeTitle(n.id);
          if (parentIds.includes(n.id)) {
            opt.selected = true;
          }
          selectParents.appendChild(opt);
        });

      fgParents.appendChild(labelParents);
      fgParents.appendChild(selectParents);
      container.appendChild(fgParents);
    }

    const childActions = document.createElement("div");
    childActions.className = "card-actions";
    const btnAddMainChild = document.createElement("button");
    btnAddMainChild.textContent = "新增下一個主線";
    btnAddMainChild.dataset.action = "add-child-main";
    const btnAddBranchChild = document.createElement("button");
    btnAddBranchChild.textContent = "新增下一個分支";
    btnAddBranchChild.dataset.action = "add-child-branch";
    childActions.appendChild(btnAddMainChild);
    childActions.appendChild(btnAddBranchChild);

    const itemsTitle = document.createElement("div");
    itemsTitle.className = "items-section-title";
    itemsTitle.textContent = "項目與描述：";

    const itemsContainer = document.createElement("div");
    itemsContainer.id = "detailItemsContainer";

    node.items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "item-row";

      const header = document.createElement("div");
      header.className = "item-row-header";

      const inputLabel = document.createElement("input");
      inputLabel.type = "text";
      inputLabel.placeholder = "項目標題";
      inputLabel.value = item.label || "";
      inputLabel.dataset.field = "node-item-label";
      inputLabel.dataset.index = index;

      const btnDelete = document.createElement("button");
      btnDelete.textContent = "刪除此項";
      btnDelete.dataset.action = "delete-item";
      btnDelete.dataset.index = index;

      header.appendChild(inputLabel);
      header.appendChild(btnDelete);

      const textarea = document.createElement("textarea");
      textarea.placeholder = "這個項目的描述內容...";
      textarea.value = item.description || "";
      textarea.dataset.field = "node-item-desc";
      textarea.dataset.index = index;

      row.appendChild(header);
      row.appendChild(textarea);

      itemsContainer.appendChild(row);
    });

    const btnAddItem = document.createElement("button");
    btnAddItem.textContent = "＋ 新增項目";
    btnAddItem.dataset.action = "add-item";

    const fgLinks = document.createElement("div");
    fgLinks.className = "field-group";
    const linksLabel = document.createElement("label");
    linksLabel.textContent = "連線摘要：";

    const prevNodes = project.links
      .filter(l => l.to === node.id)
      .map(l => getNodeTitle(l.from));

    const nextNodes = project.links
      .filter(l => l.from === node.id)
      .map(l => getNodeTitle(l.to));

    const summary = document.createElement("div");
    summary.className = "link-summary";
    summary.innerHTML =
      "前置節點：" +
      (prevNodes.length ? prevNodes.join("，") : "（無）") +
      "<br>後續節點：" +
      (nextNodes.length ? nextNodes.join("，") : "（無）");

    const fgAddPrev = document.createElement("div");
    fgAddPrev.className = "field-group";
    const labelAddPrev = document.createElement("label");
    labelAddPrev.textContent = "將其他節點連到此節點（新增前置連線）：";

    const rowAddPrev = document.createElement("div");
    rowAddPrev.style.display = "flex";
    rowAddPrev.style.gap = "0.25rem";

    const selectPrev = document.createElement("select");
    selectPrev.dataset.field = "add-prev-select";
    const optPlaceholder = document.createElement("option");
    optPlaceholder.value = "";
    optPlaceholder.textContent = "選擇一個節點…";
    selectPrev.appendChild(optPlaceholder);

    project.nodes
      .filter(n => n.id !== node.id)
      .forEach(n => {
        const opt = document.createElement("option");
        opt.value = n.id;
        opt.textContent = getNodeTitle(n.id);
        selectPrev.appendChild(opt);
      });

    const btnAddPrev = document.createElement("button");
    btnAddPrev.textContent = "新增前置";
    btnAddPrev.dataset.action = "add-prev-link";

    rowAddPrev.appendChild(selectPrev);
    rowAddPrev.appendChild(btnAddPrev);
    fgAddPrev.appendChild(labelAddPrev);
    fgAddPrev.appendChild(rowAddPrev);

    fgLinks.appendChild(linksLabel);
    fgLinks.appendChild(summary);

    const dangerRow = document.createElement("div");
    dangerRow.className = "card-actions";
    const btnDeleteNode = document.createElement("button");
    btnDeleteNode.textContent = "刪除此節點";
    btnDeleteNode.dataset.action = "delete-node";
    dangerRow.appendChild(btnDeleteNode);

    container.appendChild(childActions);
    container.appendChild(itemsTitle);
    container.appendChild(itemsContainer);
    container.appendChild(btnAddItem);
    container.appendChild(fgLinks);
    container.appendChild(fgAddPrev);
    container.appendChild(dangerRow);

  } else if (currentDetail.type === "theme") {
    const theme = findThemeById(currentDetail.id);
    if (!theme) {
      container.textContent = "找不到主題。";
      return;
    }

    const fgTitle = document.createElement("div");
    fgTitle.className = "field-group";
    const labelTitle = document.createElement("label");
    labelTitle.textContent = "主題名稱：";
    const inputTitle = document.createElement("input");
    inputTitle.type = "text";
    inputTitle.value = theme.title || "";
    inputTitle.dataset.field = "theme-title";
    fgTitle.appendChild(labelTitle);
    fgTitle.appendChild(inputTitle);

    const itemsTitle = document.createElement("div");
    itemsTitle.className = "items-section-title";
    itemsTitle.textContent = "主題項目：";

    const itemsContainer = document.createElement("div");
    itemsContainer.id = "detailItemsContainer";

    theme.items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "item-row";

      const header = document.createElement("div");
      header.className = "item-row-header";

      const inputLabel = document.createElement("input");
      inputLabel.type = "text";
      inputLabel.placeholder = "項目標題";
      inputLabel.value = item.label || "";
      inputLabel.dataset.field = "theme-item-label";
      inputLabel.dataset.index = index;

      const btnDelete = document.createElement("button");
      btnDelete.textContent = "刪除此項";
      btnDelete.dataset.action = "delete-item";
      btnDelete.dataset.index = index;

      header.appendChild(inputLabel);
      header.appendChild(btnDelete);

      const textarea = document.createElement("textarea");
      textarea.placeholder = "這個項目的描述內容...";
      textarea.value = item.description || "";
      textarea.dataset.field = "theme-item-desc";
      textarea.dataset.index = index;

      row.appendChild(header);
      row.appendChild(textarea);

      itemsContainer.appendChild(row);
    });

    const btnAddItem = document.createElement("button");
    btnAddItem.textContent = "＋ 新增項目";
    btnAddItem.dataset.action = "add-item";

    const dangerRow = document.createElement("div");
    dangerRow.className = "card-actions";
    const btnDeleteTheme = document.createElement("button");
    btnDeleteTheme.textContent = "刪除此主題";
    btnDeleteTheme.dataset.action = "delete-theme";
    dangerRow.appendChild(btnDeleteTheme);

    container.appendChild(fgTitle);
    container.appendChild(itemsTitle);
    container.appendChild(itemsContainer);
    container.appendChild(btnAddItem);
    container.appendChild(dangerRow);
  }

  // 自動 focus 標題欄位
  setTimeout(() => {
    const titleInput =
      container.querySelector('input[data-field="node-title"]') ||
      container.querySelector('input[data-field="theme-title"]');
    if (titleInput) {
      titleInput.focus();
      titleInput.select();
    }
  }, 0);
}

// === 詳細面板事件（委派） ===
function setupDetailEvents() {
  const content = document.getElementById("detailContent");

  // input：標題、項目文字
  content.addEventListener("input", evt => {
    const field = evt.target.dataset.field;
    if (!field) return;

    if (currentDetail.type === "node") {
      const node = findNodeById(currentDetail.id);
      if (!node) return;

      if (field === "node-title") {
        node.title = evt.target.value;
        renderFlow();
        renderNodesList();
        autoSave();
      } else if (field === "node-item-label" || field === "node-item-desc") {
        const index = Number(evt.target.dataset.index);
        if (!node.items[index]) return;
        if (field === "node-item-label") {
          node.items[index].label = evt.target.value;
        } else {
          node.items[index].description = evt.target.value;
        }
        autoSave();
      }

    } else if (currentDetail.type === "theme") {
      const theme = findThemeById(currentDetail.id);
      if (!theme) return;

      if (field === "theme-title") {
        theme.title = evt.target.value;
        renderThemesList();
        autoSave();
      } else if (field === "theme-item-label" || field === "theme-item-desc") {
        const index = Number(evt.target.dataset.index);
        if (!theme.items[index]) return;
        if (field === "theme-item-label") {
          theme.items[index].label = evt.target.value;
        } else {
          theme.items[index].description = evt.target.value;
        }
        autoSave();
      }
    }
  });

  // change：分支的「前一個節點（可多選）」控制
  content.addEventListener("change", evt => {
    const field = evt.target.dataset.field;
    if (!field) return;

    if (currentDetail.type === "node" && field === "branch-parents") {
      const node = findNodeById(currentDetail.id);
      if (!node) return;

      const selectedParentIds = Array.from(evt.target.selectedOptions).map(
        opt => opt.value
      );

      // 移除所有指向此節點但不在選取清單中的前置連線
      project.links = project.links.filter(link => {
        if (link.to !== node.id) return true;
        return selectedParentIds.includes(link.from);
      });

      // 為每個選取的前置節點建立連線（若尚未存在）
      selectedParentIds.forEach(parentId => {
        const exists = project.links.some(
          l => l.from === parentId && l.to === node.id
        );
        if (!exists) {
          project.links.push({
            id: generateId("link"),
            from: parentId,
            to: node.id
          });
        }
      });

      renderFlow();
      renderDetailContent();
      autoSave();
    }
  });

  // click：新增項目、刪除項目、建立子節點、手動新增前置等
  content.addEventListener("click", evt => {
    const action = evt.target.dataset.action;
    if (!action) return;

    if (currentDetail.type === "node") {
      const node = findNodeById(currentDetail.id);
      if (!node) return;

      if (action === "add-item") {
        node.items.push({ label: "", description: "" });
        renderDetailContent();
        autoSave();
      } else if (action === "delete-item") {
        const index = Number(evt.target.dataset.index);
        node.items.splice(index, 1);
        renderDetailContent();
        autoSave();
      } else if (action === "add-child-main") {
        createNode("main", {
          fromNodeId: node.id,
          x: (node.position?.x ?? 200) + 200,
          y: node.position?.y ?? 150
        });
      } else if (action === "add-child-branch") {
        createNode("branch", {
          fromNodeId: node.id,
          x: (node.position?.x ?? 200) + 200,
          y: node.position?.y ?? 150
        });
      } else if (action === "add-prev-link") {
        const select = content.querySelector(
          'select[data-field="add-prev-select"]'
        );
        if (select && select.value) {
          const fromId = select.value;
          const exists = project.links.some(
            l => l.from === fromId && l.to === node.id
          );
          if (!exists) {
            project.links.push({
              id: generateId("link"),
              from: fromId,
              to: node.id
            });
            renderFlow();
            renderDetailContent();
            autoSave();
          }
        }
      } else if (action === "delete-node") {
        if (
          confirm(
            "確定要刪除此節點嗎？與此節點相關的所有連線也會一併移除。"
          )
        ) {
          deleteNode(node.id);
        }
      }

    } else if (currentDetail.type === "theme") {
      const theme = findThemeById(currentDetail.id);
      if (!theme) return;

      if (action === "add-item") {
        theme.items.push({ label: "", description: "" });
        renderDetailContent();
        autoSave();
      } else if (action === "delete-item") {
        const index = Number(evt.target.dataset.index);
        theme.items.splice(index, 1);
        renderDetailContent();
        autoSave();
      } else if (action === "delete-theme") {
        if (confirm("確定要刪除此主題卡片嗎？")) {
          deleteTheme(theme.id);
        }
      }
    }
  });
}

// === 框選：更新方框 DOM ===
function updateSelectionRect() {
  if (!selectionState.element) return;
  const x1 = selectionState.startX;
  const y1 = selectionState.startY;
  const x2 = selectionState.currentX;
  const y2 = selectionState.currentY;

  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  selectionState.element.style.left = left + "px";
  selectionState.element.style.top = top + "px";
  selectionState.element.style.width = width + "px";
  selectionState.element.style.height = height + "px";
}

// === 框選：依照方框更新 selectedNodeIds ===
function updateSelectionByRect() {
  const x1 = selectionState.startX;
  const y1 = selectionState.startY;
  const x2 = selectionState.currentX;
  const y2 = selectionState.currentY;

  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);

  selectedNodeIds.clear();

  const nodeEls = document.querySelectorAll(".flow-node");
  nodeEls.forEach(el => {
    const id = el.dataset.id;
    const nodeLeft = parseFloat(el.style.left) || 0;
    const nodeTop = parseFloat(el.style.top) || 0;
    const nodeWidth = el.offsetWidth;
    const nodeHeight = el.offsetHeight;
    const nodeRight = nodeLeft + nodeWidth;
    const nodeBottom = nodeTop + nodeHeight;

    // 判斷兩個矩形是否相交
    const intersect =
      nodeRight >= left &&
      nodeLeft <= right &&
      nodeBottom >= top &&
      nodeTop <= bottom;

    if (intersect) {
      selectedNodeIds.add(id);
    }
  });

  renderFlow();
}

// === 畫布拖曳（pan） + 節點拖曳 + 框選 ===
function setupPanEvents() {
  const viewport = document.getElementById("flowViewport");
  const canvas = document.getElementById("flowCanvas");

  viewport.addEventListener("mousedown", evt => {
    // 若點在節點上則不處理（節點自己的 mousedown 會處理）
    if (evt.target.closest(".flow-node")) return;
    if (evt.button !== 0) return; // 只處理左鍵

    // 按住 Shift + 左鍵：進入框選模式
    if (evt.shiftKey) {
      const rect = canvas.getBoundingClientRect();
      selectionState.active = true;
      selectionState.startX = evt.clientX - rect.left;
      selectionState.startY = evt.clientY - rect.top;
      selectionState.currentX = selectionState.startX;
      selectionState.currentY = selectionState.startY;

      if (!selectionState.element) {
        const el = document.createElement("div");
        el.id = "selectionRect";
        el.style.position = "absolute";
        el.style.border = "1px dashed rgba(148, 163, 184, 0.9)";
        el.style.background = "rgba(56, 189, 248, 0.16)";
        el.style.pointerEvents = "none";
        el.style.borderRadius = "4px";
        el.style.zIndex = "10";
        canvas.appendChild(el);
        selectionState.element = el;
      } else {
        selectionState.element.style.display = "block";
      }

      updateSelectionRect();
      return; // 不啟動 pan
    }

    // 一般左鍵：畫布拖曳
    panState.active = true;
    panState.startMouseX = evt.clientX;
    panState.startMouseY = evt.clientY;
    panState.startScrollLeft = viewport.scrollLeft;
    panState.startScrollTop = viewport.scrollTop;
  });

  window.addEventListener("mousemove", evt => {
    // 框選進行中
    if (selectionState.active) {
      const rect = canvas.getBoundingClientRect();
      selectionState.currentX = evt.clientX - rect.left;
      selectionState.currentY = evt.clientY - rect.top;
      updateSelectionRect();
      updateSelectionByRect();
      return;
    }

    // 節點群組拖曳
    if (dragState.nodeId) {
      const dx = evt.clientX - dragState.startMouseX;
      const dy = evt.clientY - dragState.startMouseY;

      dragState.selectedIds.forEach(id => {
        const node = findNodeById(id);
        if (!node) return;
        const startPos = dragState.startPositions[id];
        if (!startPos) return;
        node.position.x = startPos.x + dx;
        node.position.y = startPos.y + dy;
      });

      renderFlow();
      return;
    }

    // 畫布拖曳
    if (panState.active) {
      const dx = evt.clientX - panState.startMouseX;
      const dy = evt.clientY - panState.startMouseY;
      viewport.scrollLeft = panState.startScrollLeft - dx;
      viewport.scrollTop = panState.startScrollTop - dy;
    }
  });

  window.addEventListener("mouseup", () => {
    // 結束節點拖曳
    if (dragState.nodeId) {
      dragState.nodeId = null;
      dragState.selectedIds = [];
      dragState.startPositions = {};
      document.body.classList.remove("dragging-node");
      autoSave();
    }

    // 結束框選
    if (selectionState.active) {
      selectionState.active = false;
      if (selectionState.element) {
        selectionState.element.style.display = "none";
      }
    }

    panState.active = false;
  });

  // 初始捲動到畫布中間
  setTimeout(() => {
    viewport.scrollLeft = (canvas.offsetWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (canvas.offsetHeight - viewport.clientHeight) / 2;
  }, 50);
}

// === 整體渲染 ===
function renderAll() {
  renderFlow();
  renderNodesList();
  renderThemesList();
  if (currentDetail.type) {
    renderDetailContent();
  }
}

// === 初始化 ===
function init() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      project = JSON.parse(raw);
    } catch (e) {
      console.warn("localStorage JSON 解析失敗，使用預設空專案。");
    }
  }

  document.querySelectorAll(".mode-button").forEach(btn => {
    btn.addEventListener("click", () => {
      switchView(btn.dataset.target);
    });
  });

  document.getElementById("btnAddMainNode").addEventListener("click", () => {
    createNode("main");
  });

  document.getElementById("btnAddBranchNode").addEventListener("click", () => {
    createNode("branch");
  });

  document.getElementById("btnAddTheme").addEventListener("click", () => {
    createTheme();
  });

  document.getElementById("btnSave").addEventListener("click", handleSaveClick);
  document.getElementById("btnLoad").addEventListener("click", handleLoadClick);
  document.getElementById("btnExport").addEventListener("click", handleExportClick);
  document.getElementById("btnImport").addEventListener("click", handleImportClick);
  document.getElementById("fileInput").addEventListener("change", handleFileChange);

  document
    .getElementById("btnCloseDetail")
    .addEventListener("click", () => {
      closeDetailPanel();
      switchView("view-flow");
    });

  setupDetailEvents();
  setupPanEvents();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
