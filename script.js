window.onload = () => {
  populatePicker();
  initDebugMode();
  updateCanvas();
};

window.onresize = updateCanvas;

const DEBUG_STORAGE_KEY = "legion-bricks-debug-drafts";

const EMBLEM_OPTIONS = [
  { id: 1, label: "Army" },
  { id: 2, label: "Navy" },
  { id: 3, label: "Air Force" },
  { id: 4, label: "Marine Corps" },
  { id: 5, label: "Coast Guard" },
  { id: 6, label: "Army Air Corps" },
  { id: 7, label: "AAC & Air Force" },
  { id: 8, label: "Army Nurse Corps" },
];

let DEBUG_DRAFTS = [],
  drawnBrickAreas = [];

let highlightX = null,
  highlightY = null,
  highlightVertical = null;

function populatePicker() {
  const elPicker = document.getElementById("picker");

  elPicker.innerHTML = "<option selected></option>";

  for (const brick of BRICKS)
    elPicker.add(new Option(brick.getString(), brick.coords));
}

function updateCanvas() {
  drawBricksCanvas();
  updateCircle();
}

function updateCircle() {
  const elPicker = document.getElementById("picker"),
    elCircle = document.getElementById("circle"),
    elPickerInfo = document.getElementById("picker-info");

  if (elPicker.value !== "") {
    const elBricksCanvas = document.getElementById("bricks-canvas");
    if (highlightVertical) {
      elCircle.style.left = `${
        elBricksCanvas.offsetLeft + highlightX + 0.5 + brickHeight / 2
      }px`;
      elCircle.style.top = `${elBricksCanvas.offsetTop + highlightY + 0.5}px`;
    } else {
      elCircle.style.left = `${
        elBricksCanvas.offsetLeft + highlightX + 0.5 + brickWidth / 2
      }px`;
      elCircle.style.top = `${
        elBricksCanvas.offsetTop + highlightY + 0.5 - brickHeight / 2
      }px`;
    }

    const brick = BRICKS[elPicker.selectedIndex - 1];

    const elPickerName = document.getElementById("picker-name"),
      elPickerBranchImg = document.getElementById("picker-branch-img"),
      elPickerBranchImg2 = document.getElementById("picker-branch-img2");

    elPickerName.innerHTML = `${brick.fname} ${brick.lname}<br/>${brick.conflict}`;
    if (brick.branchIds.length > 0) {
      elPickerBranchImg.style.display = "initial";
      elPickerBranchImg.src = `./emblems/${brick.branchIds[0]}.png`;
    } else {
      elPickerBranchImg.style.display = "none";
    }

    if (brick.branchIds.length > 1) {
      elPickerBranchImg2.style.display = "initial";
      elPickerBranchImg2.src = `./emblems/${brick.branchIds[1]}.png`;
    } else elPickerBranchImg2.style.display = "none";

    elCircle.style.display = "initial";
    elPickerInfo.style.display = "initial";
  } else {
    elCircle.style.display = "none";
    elPickerInfo.style.display = "none";
  }
}

function drawBricksCanvas() {
  const highlightedCoords = document.getElementById("picker").value;

  const canvas = document.getElementById("bricks-canvas");
  const ctx = canvas.getContext("2d");

  canvas.height = (brickHeight * n) / 2;
  canvas.width = brickHeight * m * 2;
  drawnBrickAreas = [];

  ctx.translate(0.5, -brickHeight + 0.5);

  function drawBrick(i, j, x, y, color, vertical) {
    const coords = `${i}-${j}`;
    const width = vertical ? brickHeight : brickWidth,
      height = vertical ? brickWidth : brickHeight;

    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.fillStyle =
      coords === highlightedCoords
        ? brickHighlightColor
        : getBrickFillColor(coords, color);
    ctx.strokeStyle = brickOutlineColor;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    if (coords === highlightedCoords) {
      highlightX = x;
      highlightY = y;
      highlightVertical = vertical;
    }

    drawnBrickAreas.push({
      coords,
      x: x + 0.5,
      y: y - brickHeight + 0.5,
      width,
      height,
    });
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let x = j * brickWidth,
        y = i * brickHeight;

      let color;

      if (
        (Math.abs(
          Math.pow(x - canvas.width / 2, 2) +
            Math.pow(y - canvas.height / 2 - brickHeight * 25, 2) -
            Math.pow(260, 2),
        ) < 2100 &&
          y <= canvas.height - brickHeight * 21) ||
        ((x < brickHeight * 39 || x > canvas.width - brickHeight * 41) &&
          y > canvas.height - brickHeight * 17 &&
          y < canvas.height - brickHeight * 14) ||
        (((x < brickHeight * 39 && x > brickHeight * 6) ||
          (x > canvas.width - brickHeight * 41 &&
            x < canvas.width - brickHeight * 6)) &&
          y > canvas.height - brickHeight * 21 &&
          y < canvas.height - brickHeight * 18) ||
        (((x < brickHeight * 41 && x > brickHeight * 7) ||
          (x > canvas.width - brickHeight * 41 &&
            x < canvas.width - brickHeight * 7)) &&
          y > canvas.height - brickHeight * 21 &&
          y < canvas.height - brickHeight * 14) ||
        (x < brickHeight * 78 &&
          x > brickHeight * 70 &&
          y < brickHeight * 44 &&
          y > brickHeight * 39) ||
        (y > brickHeight * 65 &&
          (x < brickHeight * 2 || x > canvas.width - brickHeight * 3)) ||
        y > brickHeight * 78
      )
        color = edgeColor;
      else if (
        (Math.pow(x - canvas.width / 2, 2) +
          Math.pow(y - canvas.height / 2 - brickHeight * 24, 2) >
          Math.pow(260, 2) &&
          y <= canvas.height - brickHeight * 21) ||
        ((x < brickHeight * 39 || x > canvas.width - brickHeight * 41) &&
          y > canvas.height - brickHeight * 21 &&
          y < canvas.height - brickHeight * 14)
      )
        continue;
      else color = brickColor;

      if (i % 4 == 0) {
        if (j % 2 === 0) drawBrick(i, j, x, y, color, false);
        else drawBrick(i, j, x + brickWidth / 2, y, color, true);
      } else if (i % 4 == 1) {
        if (j % 2 === 0) drawBrick(i, j, x, y, color, true);
        else drawBrick(i, j, x - brickWidth / 2, y, color, false);
      } else if (i % 4 == 2) {
        if (j % 2 === 0) drawBrick(i, j, x + brickWidth / 2, y, color, true);
        else drawBrick(i, j, x, y, color, false);
      } else {
        if (j % 2 === 0) drawBrick(i, j, x - brickWidth / 2, y, color, false);
        else drawBrick(i, j, x, y, color, true);
      }
    }
  }
}

function initDebugMode() {
  if (!DEBUG_MODE) return;

  document.body.classList.add("debug-mode");
  DEBUG_DRAFTS = loadDebugDrafts();
  populateEmblemDropdown();
  updateDebugOutput();

  const canvas = document.getElementById("bricks-canvas"),
    tooltip = document.getElementById("debug-tooltip"),
    saveButton = document.getElementById("debug-save"),
    deleteButton = document.getElementById("debug-delete"),
    copyButton = document.getElementById("debug-copy"),
    form = document.getElementById("debug-form");

  canvas.addEventListener("mousemove", (event) =>
    showDebugTooltip(event, tooltip),
  );
  canvas.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
  canvas.addEventListener("click", (event) => {
    const area = getBrickAreaAtEvent(event);
    if (area) openDebugEditor(area.coords);
  });

  saveButton.addEventListener("click", saveDebugDraft);
  deleteButton.addEventListener("click", deleteDebugDraft);
  copyButton.addEventListener("click", copyDebugOutput);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
      event.preventDefault();
      saveDebugDraft();
    }

    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      event.target.tagName === "TEXTAREA"
    ) {
      event.preventDefault();
      saveDebugDraft();
    }
  });
}

function populateEmblemDropdown() {
  const emblemContainer = document.getElementById("debug-branch-ids");

  emblemContainer.innerHTML = "";
  for (const option of EMBLEM_OPTIONS)
    addEmblemCheckbox(option.id, option.label);
}

function addEmblemCheckbox(id, label) {
  const wrapper = document.createElement("label"),
    checkbox = document.createElement("input"),
    text = document.createTextNode(label);

  wrapper.className = "debug-emblem-option";
  checkbox.type = "checkbox";
  checkbox.value = id;
  wrapper.append(checkbox, text);
  document.getElementById("debug-branch-ids").append(wrapper);
}

function loadDebugDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(DEBUG_STORAGE_KEY) || "[]");
    return Array.isArray(drafts) ? drafts.map(normalizeDebugDraft) : [];
  } catch {
    return [];
  }
}

function normalizeDebugDraft(draft) {
  return {
    fname: draft.fname || "",
    lname: draft.lname || "",
    branch: draft.branch || "",
    branchIds: Array.isArray(draft.branchIds) ? draft.branchIds : [],
    conflict: draft.conflict || "",
    coords: draft.coords,
    color: draft.color || "orange",
  };
}

function saveDebugDrafts() {
  localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(DEBUG_DRAFTS));
}

function getBrickByCoords(coords) {
  return BRICKS.find((brick) => brick.coords === coords);
}

function getDraftByCoords(coords) {
  return DEBUG_DRAFTS.find((brick) => brick.coords === coords);
}

function getBrickFillColor(coords, fallbackColor) {
  const draft = getDraftByCoords(coords);
  if (draft) {
    return draft.color === "gray"
      ? brickDebugGrayDraftColor
      : brickDebugDraftColor;
  }

  const brick = getBrickByCoords(coords);
  if (brick?.color === "gray") return brickGrayColor;
  if (brick) return brickColor2;

  return fallbackColor;
}

function getBrickAreaAtEvent(event) {
  const rect = event.currentTarget.getBoundingClientRect(),
    scaleX = event.currentTarget.width / rect.width,
    scaleY = event.currentTarget.height / rect.height,
    x = (event.clientX - rect.left) * scaleX,
    y = (event.clientY - rect.top) * scaleY;

  return drawnBrickAreas.find(
    (area) =>
      x >= area.x &&
      x <= area.x + area.width &&
      y >= area.y &&
      y <= area.y + area.height,
  );
}

function showDebugTooltip(event, tooltip) {
  const area = getBrickAreaAtEvent(event);
  if (!area) {
    tooltip.style.display = "none";
    return;
  }

  const draft = getDraftByCoords(area.coords),
    brick = getBrickByCoords(area.coords),
    source = draft || brick;

  tooltip.textContent = source
    ? `${area.coords}\n${source.fname} ${source.lname}\n${source.branch}\n${source.conflict || "(no lower line)"}\n${source.color === "gray" ? "Gray brick" : "Orange brick"}${draft ? "\nDraft, not pasted yet" : ""}`
    : `${area.coords}\nEmpty brick\nClick to add text`;
  tooltip.style.left = `${event.clientX + 14}px`;
  tooltip.style.top = `${event.clientY + 14}px`;
  tooltip.style.display = "block";
}

function openDebugEditor(coords) {
  const editor = document.getElementById("debug-editor"),
    title = document.getElementById("debug-editor-title"),
    brick = getDraftByCoords(coords) || getBrickByCoords(coords);

  document.getElementById("debug-coords").value = coords;
  document.getElementById("debug-fname").value = brick?.fname || "";
  document.getElementById("debug-lname").value = brick?.lname || "";
  document.getElementById("debug-branch").value = brick?.branch || "";
  setDebugEmblemValue(brick);
  document.getElementById("debug-color").value = brick?.color || "orange";
  document.getElementById("debug-conflict").value = brick?.conflict || "";
  document.getElementById("debug-delete").disabled = !getDraftByCoords(coords);
  title.textContent = brick ? "Edit brick" : "Add brick";

  editor.showModal();
  document.getElementById("debug-fname").focus();
}

function saveDebugDraft() {
  const branchIds = getSelectedEmblemIds(),
    coords = document.getElementById("debug-coords").value,
    draft = {
      fname: cleanDebugText(document.getElementById("debug-fname").value),
      lname: cleanDebugText(document.getElementById("debug-lname").value),
      branch: cleanDebugText(document.getElementById("debug-branch").value),
      branchIds,
      conflict: cleanDebugText(document.getElementById("debug-conflict").value),
      coords,
      color: document.getElementById("debug-color").value,
    };

  const index = DEBUG_DRAFTS.findIndex((brick) => brick.coords === coords);
  if (index === -1) DEBUG_DRAFTS.push(draft);
  else DEBUG_DRAFTS[index] = draft;

  saveDebugDrafts();
  updateDebugOutput();
  updateCanvas();
  document.getElementById("debug-editor").close();
}

function deleteDebugDraft() {
  const coords = document.getElementById("debug-coords").value;
  DEBUG_DRAFTS = DEBUG_DRAFTS.filter((brick) => brick.coords !== coords);
  saveDebugDrafts();
  updateDebugOutput();
  updateCanvas();
  document.getElementById("debug-editor").close();
}

function updateDebugOutput() {
  const sortedDrafts = [...DEBUG_DRAFTS].sort((a, b) =>
      a.coords.localeCompare(b.coords, undefined, { numeric: true }),
    ),
    output = sortedDrafts.map(formatBrickCode).join("\n");

  document.getElementById("debug-output").value = output;
  document.getElementById("debug-count").textContent =
    sortedDrafts.length === 1
      ? "1 draft brick ready to paste into constants.js"
      : `${sortedDrafts.length} draft bricks ready to paste into constants.js`;
}

function setDebugEmblemValue(brick) {
  const branchIds = brick?.branchIds || [];

  for (const checkbox of document.querySelectorAll("#debug-branch-ids input"))
    checkbox.checked = branchIds.includes(Number.parseInt(checkbox.value, 10));
}

function getSelectedEmblemIds() {
  return Array.from(
    document.querySelectorAll("#debug-branch-ids input:checked"),
    (checkbox) => Number.parseInt(checkbox.value, 10),
  );
}

function formatBrickCode(brick) {
  const colorArg =
    brick.color === "gray" ? `, ${JSON.stringify(brick.color)}` : "";

  return `    new Brick(${JSON.stringify(brick.fname)}, ${JSON.stringify(brick.lname)}, ${JSON.stringify(brick.branch)}, [${brick.branchIds.join(", ")}], ${JSON.stringify(brick.conflict)}, ${JSON.stringify(brick.coords)}${colorArg}),`;
}

function cleanDebugText(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

async function copyDebugOutput() {
  const output = document.getElementById("debug-output");
  output.select();

  try {
    await navigator.clipboard.writeText(output.value);
  } catch {
    document.execCommand("copy");
  }
}
