/*
 * editor.js: add, edit and move bricks right on the map. It only loads on your
 * own computer: in this folder run `python3 -m http.server 8000`, then open
 * http://localhost:8000/?edit.
 *
 * Edits are kept in this browser until you click Save, which writes a fresh
 * data/bricks.js. Pick that file the first time, and after that Save just works.
 * Commit and push the file to publish the changes.
 */
const Editor = (() => {
  const DRAFT_KEY = "post779-bricks-draft";

  let app, S, h;
  let loadedHash = ""; // the brick list this page loaded
  let saved = { records: [], hash: "" }; // ...or as of the last Save
  let undoStack = [],
    redoStack = [];
  let typing = null; // groups keystrokes in one field into a single undo step
  let placingId = null; // brick waiting for a click on the map
  let drag = null;
  let nextId = 1;
  let fileHandle = null;
  const ui = {};

  // ---- small helpers ----------------------------------------------------

  const name = (b) => Model.fullName(b) || "the new brick";
  const byId = (id) => S.bricks.find((b) => b.id === id);
  const selected = () => (S.selectedId == null ? null : byId(S.selectedId));
  const copy = (b) => ({ ...Model.toRecord(b), id: b.id, first: b.first, last: b.last, lines: [...b.lines] });
  const fromCopy = (r) => Model.fromRecord(r, r.id);
  const textKey = (b) => JSON.stringify([b.first, b.last, b.lines, b.split, b.color, b.emblem]);
  const tidy = (s) => s.replace(/\s+/g, " ").trim();
  // Bricks are engraved in capitals, but a typed "Mc" (as in McCOOL) is kept.
  const engraved = (s) =>
    tidy(s).replace(/\S+/g, (w) => (/^Mc./.test(w) ? "Mc" + w.slice(2).toUpperCase() : w.toUpperCase()));

  // ---- changes, undo and the saved draft --------------------------------

  function snapshot() {
    return { bricks: S.bricks.map(copy), selectedId: S.selectedId };
  }

  function restore(snap) {
    S.bricks = snap.bricks.map(fromCopy);
    S.selectedId = snap.selectedId;
    placingId = null;
    afterChange();
  }

  function change(fn, { group = null } = {}) {
    if (!group || group !== typing) {
      undoStack.push(snapshot());
      if (undoStack.length > 300) undoStack.shift();
      redoStack = [];
    }
    typing = group;
    fn();
    afterChange();
  }

  function afterChange() {
    for (const b of S.bricks) b._search = null;
    app.refresh();
    persist();
    updateToolbar();
    updateBanner();
  }

  function undo() {
    if (!undoStack.length) return app.toast("Nothing to undo");
    redoStack.push(snapshot());
    typing = null;
    restore(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return app.toast("Nothing to redo");
    undoStack.push(snapshot());
    typing = null;
    restore(redoStack.pop());
  }

  // What's changed since the last save (or since the page loaded).
  function changes() {
    const before = new Map(saved.records.map((r) => [r.id, r]));
    let added = 0,
      moved = 0,
      edited = 0,
      kept = 0;
    for (const b of S.bricks) {
      const o = before.get(b.id);
      if (!o) {
        added++;
        continue;
      }
      kept++;
      if ((o.at || "") !== b.at) moved++;
      if (textKey(fromCopy(o)) !== textKey(b)) edited++;
    }
    const removed = saved.records.length - kept;
    return { added, removed, moved, edited, total: added + removed + moved + edited };
  }

  // The draft stays until the published list catches up with it, so a save
  // that hasn't been pushed yet can't be lost by reloading.
  function persist() {
    try {
      if (Model.hash(Model.serialize(S.bricks)) === loadedHash) localStorage.removeItem(DRAFT_KEY);
      else
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ base: loadedHash, saved: saved.hash, bricks: S.bricks.map(copy) }),
        );
    } catch {}
  }

  function readDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      return d && Array.isArray(d.bricks) ? d : null;
    } catch {
      return null;
    }
  }

  // ---- saving -------------------------------------------------------------

  const idb = {
    open: () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("post779-bricks", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const req = db.transaction("kv").objectStore("kv").get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    },
  };

  async function pickFile() {
    const handle = await window.showSaveFilePicker({
      suggestedName: "bricks.js",
      startIn: fileHandle || "documents",
      types: [{ description: "Brick list", accept: { "text/javascript": [".js"] } }],
    });
    const existing = await handle
      .getFile()
      .then((f) => f.text())
      .catch(() => "");
    if (existing.trim() && !/const BRICKS\s*=/.test(existing)) {
      const ok = confirm(`“${handle.name}” doesn't look like the brick list (data/bricks.js). Overwrite it anyway?`);
      if (!ok) return null;
    }
    fileHandle = handle;
    idb.set("file", handle).catch(() => {});
    return handle;
  }

  async function savedHandle() {
    fileHandle ||= await idb.get("file").catch(() => null);
    if (!fileHandle) return null;
    const opts = { mode: "readwrite" };
    if ((await fileHandle.queryPermission(opts)) === "granted") return fileHandle;
    return (await fileHandle.requestPermission(opts)) === "granted" ? fileHandle : null;
  }

  // Chrome and Edge can write data/bricks.js directly. Other browsers download it.
  async function save({ chooseFile = false } = {}) {
    const text = Model.serialize(S.bricks);
    if (!window.showSaveFilePicker) return download(text);
    try {
      const remembered = chooseFile ? null : await savedHandle().catch(() => null);
      if (remembered && (await writeTo(remembered, text).then(() => true, () => false))) return;
      const picked = await pickFile(); // first save, or the remembered file moved
      if (picked) await writeTo(picked, text);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error(err);
      app.toast("Couldn't write the file, so it was downloaded instead.", 4200);
      download(text);
    }
  }

  async function writeTo(handle, text) {
    const out = await handle.createWritable();
    await out.write(text);
    await out.close();
    markSaved(text);
    app.toast(`Saved ${handle.name}. Commit and push it to publish.`, 4200);
  }

  function download(text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    const a = h("a", { href: url, download: "bricks.js" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markSaved(text);
    app.toast("Downloaded bricks.js. Put it in the data folder, then commit and push.", 4800);
  }

  function markSaved(text) {
    saved = { records: S.bricks.map(copy), hash: Model.hash(text) };
    persist();
    updateToolbar();
  }

  // ---- editing actions ------------------------------------------------------

  function select(id, opts = {}) {
    dropIfEmpty(id);
    if (id == null) app.deselect();
    else app.select(id, { fly: false, ...opts });
  }

  // A brick that was added but never given any text disappears again.
  function dropIfEmpty(keepId) {
    const b = selected();
    if (!b || b.id === keepId || b.first || b.last || b.lines.length) return;
    S.bricks = S.bricks.filter((o) => o !== b);
    if (placingId === b.id) placingId = null;
    S.selectedId = null;
    afterChange();
  }

  function addBrick({ at = "", first = "", last = "" } = {}) {
    dropIfEmpty();
    let b;
    change(() => {
      b = Model.fromRecord({ first, last, at }, nextId++);
      S.bricks.push(b);
      S.selectedId = b.id;
    });
    app.select(b.id, { fly: false, from: "map" });
    return b;
  }

  // Moves a brick to a spot. Whatever was there swaps into its old spot
  // (or comes off the map, if the moving brick wasn't on the map).
  function moveTo(id, key) {
    const b = byId(id),
      other = S.bySlot.get(key);
    if (!b || other === b) return;
    const from = b.slot ? b.at : "";
    change(() => {
      if (other) other.at = from;
      b.at = key;
    });
    if (other)
      app.toast(from ? `Swapped with ${name(other)}` : `${name(other)} was there and is now off the map`, 3600);
  }

  function takeOff(id) {
    const b = byId(id);
    if (!b?.at) return;
    change(() => (b.at = ""));
    app.toast(`${name(b)} is off the map. It's listed under “Not on the map”.`, 3600);
  }

  function remove(id) {
    const b = byId(id);
    if (!b || !confirm(`Delete ${name(b)}? (Undo brings it back.)`)) return;
    change(() => {
      S.bricks = S.bricks.filter((o) => o !== b);
      S.selectedId = null;
    });
    stopPlacing();
  }

  function startPlacing(id) {
    placingId = id;
    if (S.selectedId !== id) app.select(id, { fly: false, from: "map" });
    updateBanner();
    app.map.draw();
  }

  function stopPlacing() {
    if (placingId == null) return;
    placingId = null;
    updateBanner();
    app.map.scene.target = null;
    app.map.draw();
  }

  function unplaceAll() {
    const placed = S.bricks.filter((b) => b.at).length;
    if (!placed) return;
    if (!confirm(`Take all ${placed} bricks off the map? Their text stays, and you'd place each one again. Undo reverses this.`))
      return;
    change(() => S.bricks.forEach((b) => (b.at = "")));
  }

  function discard() {
    if (!changes().total || !confirm("Throw away all changes since the last save?")) return;
    change(() => {
      S.bricks = saved.records.map(fromCopy);
      S.selectedId = null;
    });
  }

  // Nearest spot in a direction, for nudging with the arrow keys.
  function neighbour(slot, [dx, dy]) {
    const cx = slot.x + slot.w / 2,
      cy = slot.y + slot.h / 2;
    let best = null,
      bestScore = Infinity;
    for (const s of Plan.slots.values()) {
      const vx = s.x + s.w / 2 - cx,
        vy = s.y + s.h / 2 - cy,
        dist = Math.hypot(vx, vy);
      if (dist < 0.4 || dist > 3) continue;
      const along = (vx * dx + vy * dy) / dist;
      if (along < 0.55) continue;
      const score = dist * (2 - along);
      if (score < bestScore) (best = s), (bestScore = score);
    }
    return best;
  }

  // ---- toolbar, banner and menu -------------------------------------------

  function buildToolbar() {
    ui.status = h("span", { class: "editbar-status" });
    ui.undo = h("button", { type: "button", class: "btn btn-sm", onclick: undo, title: "Undo (⌘Z / Ctrl+Z)" }, "Undo");
    ui.redo = h("button", { type: "button", class: "btn btn-sm", onclick: redo, title: "Redo (⇧⌘Z / Ctrl+Y)" }, "Redo");
    ui.save = h(
      "button",
      { type: "button", class: "btn btn-sm btn-primary", onclick: () => save(), title: "Save (⌘S / Ctrl+S)" },
      "Save",
    );
    ui.menu = h(
      "div",
      { class: "menu", role: "menu", hidden: true },
      menuItem("Save to a different file…", () => save({ chooseFile: true })),
      menuItem("Download bricks.js", () => download(Model.serialize(S.bricks))),
      h("hr"),
      menuItem("Take every brick off the map…", unplaceAll),
      menuItem("Throw away unsaved changes…", discard),
      h("hr"),
      h("a", { class: "menu-item", href: location.pathname, role: "menuitem" }, "Leave the editor"),
    );
    const more = h(
      "button",
      {
        type: "button",
        class: "btn btn-sm",
        "aria-haspopup": "menu",
        onclick: (e) => {
          e.stopPropagation();
          ui.menu.hidden = !ui.menu.hidden;
        },
      },
      "More",
    );
    document.addEventListener("click", (e) => {
      if (!ui.menu.hidden && !ui.menu.contains(e.target)) ui.menu.hidden = true;
    });

    const bar = h(
      "div",
      { class: "editbar" },
      h(
        "div",
        { class: "editbar-top" },
        h("span", { class: "editbar-title" }, "Editing"),
        ui.status,
        h("a", { class: "editbar-exit", href: location.pathname }, "Exit"),
      ),
      h(
        "div",
        { class: "editbar-actions" },
        ui.undo,
        ui.redo,
        h(
          "button",
          { type: "button", class: "btn btn-sm", onclick: () => newBrick(), title: "New brick (N)" },
          "+ New brick",
        ),
        h("span", { class: "editbar-gap" }),
        ui.save,
        h("span", { class: "menu-wrap" }, more, ui.menu),
      ),
    );
    app.el.side.prepend(bar);

    ui.banner = h(
      "div",
      { class: "map-banner", hidden: true, role: "status" },
      (ui.bannerText = h("span")),
      h("button", { type: "button", class: "btn btn-sm", onclick: stopPlacing }, "Cancel"),
    );
    app.el.mapWrap.append(ui.banner);
  }

  function menuItem(label, action) {
    return h(
      "button",
      {
        type: "button",
        class: "menu-item",
        role: "menuitem",
        onclick: () => {
          ui.menu.hidden = true;
          action();
        },
      },
      label,
    );
  }

  function updateToolbar() {
    const c = changes(),
      parts = [
        c.added && `${c.added} added`,
        c.edited && `${c.edited} edited`,
        c.moved && `${c.moved} moved`,
        c.removed && `${c.removed} deleted`,
      ].filter(Boolean);
    ui.status.textContent = c.total ? `Unsaved: ${parts.join(", ")}` : "Everything's saved";
    ui.status.classList.toggle("is-dirty", !!c.total);
    ui.undo.disabled = !undoStack.length;
    ui.redo.disabled = !redoStack.length;
    document.title = `${c.total ? "• " : ""}Editing · Memorial Bricks`;
  }

  function updateBanner() {
    const b = placingId != null && byId(placingId);
    ui.banner.hidden = !b;
    if (b) ui.bannerText.replaceChildren("Click the spot for ", h("strong", {}, name(b)));
  }

  // ---- the form ---------------------------------------------------------------

  function hintCard() {
    const unplaced = S.bricks.filter((b) => !b.slot).length;
    return [
      h("div", { class: "card-head" }, h("p", { class: "card-kicker" }, "Editor")),
      h(
        "ul",
        { class: "hints" },
        h("li", {}, h("strong", {}, "New brick: "), "click an empty brick on the map, or type the name in the search box and press Enter."),
        h("li", {}, h("strong", {}, "Edit: "), "click a brick with a name to change its text."),
        h("li", {}, h("strong", {}, "Move: "), "drag it. Dropping it on another brick swaps the two. Arrow keys nudge it one spot."),
        h("li", {}, h("strong", {}, "Zoom in "), "until names show on the bricks to match them up with your photos. ⟳ turns the map to match the photo."),
        h("li", {}, h("strong", {}, "Save "), "writes data/bricks.js. Until then, changes stay in this browser."),
      ),
      h(
        "p",
        { class: "hint-foot" },
        `${S.bricks.length} bricks`,
        unplaced ? ` · ${unplaced} not on the map` : "",
      ),
    ];
  }

  function field(label, input, cls = "") {
    return h("label", { class: `field ${cls}` }, h("span", { class: "field-label" }, label), input);
  }

  function buildForm(b) {
    const input = (key, value, attrs = {}) =>
      h("input", {
        type: "text",
        name: key,
        value,
        autocomplete: "off",
        autocapitalize: "characters",
        spellcheck: "false",
        ...attrs,
      });
    const f = {
      first: input("first", b.first, { placeholder: "ROBERT H" }),
      last: input("last", b.last, { placeholder: "BARNES" }),
      lines: [0, 1, 2].map((i) =>
        input(`line${i}`, b.lines[i] || "", { placeholder: ["U S ARMY", "WORLD WAR II", ""][i] }),
      ),
      emblem: h("select", { name: "emblem" }),
      color: h(
        "select",
        { name: "color" },
        h("option", { value: "" }, "Tan"),
        h("option", { value: "gray" }, "Gray"),
      ),
      split: h(
        "select",
        { name: "split" },
        h("option", { value: "" }, "On one line"),
        h("option", { value: "split" }, "On two lines"),
      ),
    };
    f.color.value = b.color;
    f.split.value = b.split ? "split" : "";

    const id = b.id;
    const onText = (key) => () =>
      change(
        () => {
          const cur = byId(id);
          if (key === "lines") cur.lines = f.lines.map((i) => engraved(i.value)).filter(Boolean);
          else cur[key] = engraved(f[key].value);
        },
        { group: `${id}:${key}` },
      );
    f.first.addEventListener("input", onText("first"));
    f.last.addEventListener("input", onText("last"));
    f.lines.forEach((i) => i.addEventListener("input", onText("lines")));
    f.emblem.addEventListener("change", () => change(() => (byId(id).emblem = f.emblem.value)));
    f.color.addEventListener("change", () => change(() => (byId(id).color = f.color.value)));
    f.split.addEventListener("change", () => change(() => (byId(id).split = f.split.value === "split")));
    for (const el of [f.first, f.last, ...f.lines])
      el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const order = [f.first, f.last, ...f.lines],
          next = order[order.indexOf(el) + 1];
        if (next) next.focus();
        else el.blur();
      });
    for (const el of [f.first, f.last, ...f.lines])
      el.addEventListener("blur", () => {
        typing = null;
        el.value = engraved(el.value);
      });

    const form = h(
      "form",
      { class: "brick-form", onsubmit: (e) => e.preventDefault() },
      h(
        "div",
        { class: "card-head" },
        h("p", { class: "card-kicker" }, "Editing brick"),
        h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => select(null) }, app.icon("close")),
      ),
      h("div", { class: "form-preview" }),
      h("div", { class: "field-row" }, field("First name(s)", f.first), field("Last name", f.last)),
      h("div", { class: "field-row" }, field("Name", f.split)),
      field("Line 2", f.lines[0]),
      field("Line 3", f.lines[1]),
      field("Line 4 (if any)", f.lines[2]),
      h("div", { class: "field-row" }, field("Emblem", f.emblem), field("Brick", f.color, "is-narrow")),
      h("div", { class: "spot" }),
      h(
        "div",
        { class: "form-foot" },
        h("span", { class: "form-tip" }, "Type it the way it's engraved."),
        h("button", { type: "button", class: "btn btn-sm btn-danger", onclick: () => remove(id) }, "Delete brick"),
      ),
    );
    form._fields = f;
    return form;
  }

  // Refreshes the parts of the form that can change without retyping.
  function updateForm(form, b) {
    const f = form._fields,
      active = document.activeElement;
    if (active !== f.first) f.first.value = b.first;
    if (active !== f.last) f.last.value = b.last;
    if (!f.lines.includes(active)) f.lines.forEach((i, n) => (i.value = b.lines[n] || ""));

    const detected = Model.emblemsFor({ ...b, emblem: "" }).map((k) => Model.EMBLEMS[k].name);
    f.emblem.replaceChildren(
      h("option", { value: "" }, `Automatic${detected.length ? ` (${detected.join(" & ")})` : " (none found)"}`),
      ...Object.entries(Model.EMBLEMS).map(([k, e]) => h("option", { value: k }, e.name)),
      h("option", { value: "none" }, "No emblem"),
    );
    f.emblem.value = b.emblem;
    f.color.value = b.color;
    f.split.value = b.split ? "split" : "";

    form.querySelector(".form-preview").replaceChildren(app.replica(b));

    const spot = form.querySelector(".spot"),
      placing = placingId === b.id;
    let text;
    if (b.slot) text = h("span", {}, "On the map at spot ", h("code", {}, b.at));
    else if (b.problem) text = h("span", { class: "spot-problem" }, `Spot ${b.at} can't be used: ${b.problem}.`);
    else text = h("span", {}, "Not on the map yet.");
    spot.replaceChildren(
      text,
      h(
        "span",
        { class: "spot-actions" },
        placing
          ? h("button", { type: "button", class: "btn btn-sm", onclick: stopPlacing }, "Cancel placing")
          : h(
              "button",
              { type: "button", class: "btn btn-sm", onclick: () => startPlacing(b.id) },
              b.slot ? "Move…" : "Place on map…",
            ),
        b.slot
          ? h("button", { type: "button", class: "btn btn-sm", onclick: () => app.map.focusSlot(b.slot) }, "Show")
          : null,
        b.at ? h("button", { type: "button", class: "btn btn-sm", onclick: () => takeOff(b.id) }, "Take off map") : null,
      ),
    );
  }

  function renderCard(container, b) {
    container.hidden = false;
    let form = container.querySelector(".brick-form");
    if (!b) {
      container.replaceChildren(...hintCard().filter(Boolean));
      return;
    }
    if (!form || Number(form.dataset.id) !== b.id) {
      form = buildForm(b);
      form.dataset.id = b.id;
      container.replaceChildren(form);
    }
    updateForm(form, b);
  }

  function newBrick() {
    const b = addBrick();
    startPlacing(b.id);
    requestAnimationFrame(() => app.el.card.querySelector('input[name="first"]')?.focus());
  }

  // ---- hooks the app calls --------------------------------------------------

  const hooks = {
    orderResults: (results) => [...results.filter((b) => !b.slot), ...results.filter((b) => b.slot)],

    groupFor(b) {
      if (!b.slot) return "Not on the map";
      return S.query ? "On the map" : (b.last || b.first || "#").charAt(0).toUpperCase();
    },

    emptyResults: (q) =>
      q ? `No brick called “${q}” yet. Press Enter to add it.` : "No bricks yet. Click a spot on the map to add one.",

    renderCard,

    onTap(hit) {
      const slot = hit.slot,
        occupant = slot && S.bySlot.get(slot.key);
      if (placingId != null) {
        if (!slot) {
          app.toast("Click one of the bricks in the plaza.");
          return true;
        }
        const id = placingId;
        stopPlacing();
        if (occupant?.id !== id) moveTo(id, slot.key);
        return true;
      }
      if (occupant) select(occupant.id, { from: "map" });
      else if (slot) {
        addBrick({ at: slot.key });
        requestAnimationFrame(() => app.el.card.querySelector('input[name="first"]')?.focus());
      } else select(null);
      return true;
    },

    hoverText(hit, b) {
      if (!hit?.slot) return placingId != null ? "Not a brick spot" : undefined;
      if (placingId != null) {
        const p = byId(placingId);
        if (b && b.id !== placingId) return `Put ${name(p)} here\n${name(b)} ${p.slot ? "swaps places" : "comes off the map"}`;
        return b ? undefined : `Put ${name(p)} here`;
      }
      return b ? undefined : `Empty spot ${hit.slot.key}\nClick to add a brick here`;
    },

    cursor(hit, b) {
      if (placingId != null) return hit?.slot ? "crosshair" : "not-allowed";
      if (b) return drag ? "grabbing" : "grab";
      return hit?.slot ? "cell" : "";
    },

    canDrag: (hit) => placingId == null && !!(hit.slot && S.bySlot.get(hit.slot.key)),

    dragStart(hit) {
      const b = S.bySlot.get(hit.slot.key);
      drag = { id: b.id, from: b.at };
      select(b.id, { from: "map" });
      app.map.scene.movingId = b.id;
      app.map.draw();
    },

    dragMove(hit) {
      if (!drag) return;
      const m = app.map,
        slot = hit.slot,
        other = slot && S.bySlot.get(slot.key);
      m.scene.target = slot ? { key: slot.key, kind: other && other.id !== drag.id ? "swap" : "ok" } : null;
      m.scene.ghost = slot ? null : { x: hit.x, y: hit.y, vertical: false };
      m.draw();
    },

    dragEnd(hit, cancelled) {
      const d = drag,
        m = app.map;
      drag = null;
      Object.assign(m.scene, { movingId: null, target: null, ghost: null });
      if (d && !cancelled && hit?.slot && hit.slot.key !== d.from) moveTo(d.id, hit.slot.key);
      else m.draw();
    },

    onMapKey(e) {
      const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      const b = selected();
      if (!dirs[e.key] || !b?.slot || e.altKey) return false;
      const a = app.map.view.angle,
        [sx, sy] = dirs[e.key],
        dir = [sx * Math.cos(a) + sy * Math.sin(a), -sx * Math.sin(a) + sy * Math.cos(a)];
      const next = neighbour(b.slot, dir);
      if (next) {
        moveTo(b.id, next.key);
        app.map.reveal(next);
      }
      e.preventDefault();
      return true;
    },

    onSearchEnter(query, active) {
      if (active) {
        hooks.onResultClick(active.id);
        return true;
      }
      if (!query) return true;
      const typed = Model.splitName(query),
        b = addBrick({ first: engraved(typed.first), last: engraved(typed.last) });
      app.setQuery("");
      startPlacing(b.id);
      app.toast("Now click where it goes on the map.");
      return true;
    },

    onResultClick(id) {
      const b = byId(id);
      if (!b) return true;
      stopPlacing();
      select(id, { fly: !!b.slot, from: "list" });
      if (!b.slot) startPlacing(id);
      return true;
    },
  };

  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey,
      key = e.key.toLowerCase(),
      typingInField = e.target.closest?.("input, textarea, select");
    if (mod && key === "s") {
      e.preventDefault();
      save();
    } else if (typingInField) {
      if (e.key === "Escape" && e.target !== app.el.search) e.target.blur();
    } else if (mod && key === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && key === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "Escape") {
      if (placingId != null) stopPlacing();
      else select(null);
    } else if (!mod && key === "n") {
      e.preventDefault();
      newBrick();
    } else if (!mod && key === "m" && selected()) {
      startPlacing(S.selectedId);
    }
  }

  // ---- start ------------------------------------------------------------------

  function start(appApi) {
    app = appApi;
    S = app.state;
    h = app.h;
    nextId = Math.max(0, ...S.bricks.map((b) => b.id)) + 1;
    loadedHash = Model.hash(Model.serialize(S.bricks));
    saved = { records: S.bricks.map(copy), hash: loadedHash };

    const draft = readDraft();
    let restored = false;
    if (draft) {
      const draftBricks = draft.bricks.map(fromCopy),
        draftHash = Model.hash(Model.serialize(draftBricks));
      const keep =
        draftHash !== loadedHash &&
        (draft.base === loadedHash ||
          confirm(
            "This browser has brick edits that aren't in the list this page loaded. Either the list changed " +
              "since you made them, or your last save hasn't been published yet.\n\n" +
              "OK: keep working on your version\nCancel: throw those edits away and use the published list",
          ));
      if (keep) {
        S.bricks = draftBricks;
        nextId = Math.max(nextId, ...draftBricks.map((b) => b.id + 1));
        if (draft.saved === draftHash) saved = { records: draftBricks.map(copy), hash: draftHash };
        restored = true;
      } else localStorage.removeItem(DRAFT_KEY);
    }

    S.editor = hooks;
    document.body.classList.add("is-editing");
    document.getElementById("rotate").hidden = false;
    buildToolbar();
    document.addEventListener("keydown", onKey);
    app.el.search.placeholder = "Find a brick, or type a new name";
    afterChange();
    if (restored) app.toast(changes().total ? "Picked up your unsaved edits." : "Picked up your saved edits (not published yet).", 3600);
  }

  return { start };
})();
