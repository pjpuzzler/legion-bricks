/*
 * app.js: the brick finder. Search, the list of names, the brick card and the
 * map. On your own computer, ?edit in the address also loads the editor.
 */
const App = (() => {
  const $ = (s) => document.querySelector(s);
  const el = {
    search: $("#search"),
    clear: $("#search-clear"),
    results: $("#results"),
    resultsHead: $("#results-head"),
    card: $("#card"),
    side: $("#side"),
    mapWrap: $("#map-wrap"),
    canvas: $("#map"),
    marker: $("#marker"),
    tooltip: $("#tooltip"),
    about: $("#about"),
    toast: $("#toast"),
  };
  // Phones, as in the stylesheet: narrower than a tablet, or turned sideways
  // (the biggest iPhones are over 900px wide sideways, but never 500px tall).
  const compact = matchMedia("(max-width: 899px), (orientation: landscape) and (max-height: 500px)");
  const sideways = matchMedia(
    "(orientation: landscape) and (max-width: 899px), (orientation: landscape) and (max-height: 500px)",
  );
  const hover = matchMedia("(hover: hover)");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const TITLE = document.title;
  // iPhones, iPads and Macs get the share icon their owners know.
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

  // The editor only runs on your own computer, never on the public site.
  const local =
    location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(location.hostname);

  const state = {
    bricks: [],
    byId: new Map(),
    bySlot: new Map(),
    bySlug: new Map(),
    query: "",
    results: [],
    closeMatches: false, // results are spelling suggestions, not exact matches
    active: -1, // result highlighted with the arrow keys
    selectedId: null,
    cardFolded: false, // phones: the card shrinks to a bar while the map is being looked around
    editor: null,
  };
  let map;

  // ---- helpers ----------------------------------------------------------

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
    return node;
  }

  function svg(tag, attrs = {}, ...children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs))
      if (k === "xml:space") node.setAttributeNS("http://www.w3.org/XML/1998/namespace", k, v);
      else node.setAttribute(k, v);
    node.append(...children.flat(Infinity));
    return node;
  }

  function icon(name) {
    const paths = {
      share: apple
        ? "M12 2.6 7.3 7.3l1.4 1.4L11 6.4V15h2V6.4l2.3 2.3 1.4-1.4ZM6 10v10.5c0 .8.7 1.5 1.5 1.5h9c.8 0 1.5-.7 1.5-1.5V10h-3v2h1v8H8v-8h1v-2Z"
        : "M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7a3 3 0 0 0 .1.8L8.4 11.2a3 3 0 1 0 0 3.6l6.7 3.4A3 3 0 1 0 18 16Z",
      close: "M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6Z",
      open: "M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6Z",
    };
    return svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "icon" }, svg("path", { d: paths[name] }));
  }

  function emblemImg(key, cls = "emblem", alt = `U.S. ${Model.EMBLEMS[key].name}`) {
    return h("img", {
      class: cls,
      src: `img/emblems/${Model.EMBLEMS[key].file}.webp`,
      alt,
      loading: "lazy",
      decoding: "async",
    });
  }

  // By the name of the fallen, a gold star (the star of a Gold Star family's
  // banner), and of the missing, the POW/MIA flag. Their meaning shows on
  // hover and to screen readers.
  function honorMark(key) {
    const { name } = Model.HONORS[key];
    let mark;
    if (key === "kia")
      mark = svg(
        "svg",
        { viewBox: "0 0 16 16", class: "honor-star", "aria-hidden": "true" },
        svg("path", {
          d: "M8 1.25L9.73 6.16L14.94 6.29L10.81 9.46L12.29 14.46L8 11.5L3.71 14.46L5.19 9.46L1.06 6.29L6.27 6.16Z",
          fill: "#e0ae2e",
          stroke: "#9a7316",
          "stroke-width": 0.9,
          "stroke-linejoin": "round",
        }),
      );
    else if (key === "mia") mark = h("span", { class: "honor-flag", "aria-hidden": "true" });
    else return null;
    return h("span", { class: `honor honor-${key}`, role: "img", "aria-label": name, title: name }, mark);
  }
  const honorMarks = (b) => Model.honorsFor(b).map(honorMark);

  let toastTimer = 0;
  function toast(message, ms = 2600) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    el.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("is-on");
      setTimeout(() => (el.toast.hidden = true), 250);
    }, ms);
  }

  // ---- data ---------------------------------------------------------------

  // Rebuilds the lookups after any change to the bricks.
  function reindex() {
    state.byId.clear();
    state.bySlot.clear();
    state.bySlug.clear();
    const slugCount = new Map();
    for (const b of [...state.bricks].sort(Model.compare)) {
      state.byId.set(b.id, b);
      b.slot = null;
      b.problem = "";
      if (b.at) {
        const slot = Plan.slots.get(b.at),
          taken = state.bySlot.get(b.at);
        if (!slot) b.problem = `"${b.at}" isn't a spot on the map`;
        else if (taken) b.problem = `on the same spot as ${Model.fullName(taken)}`;
        else {
          b.slot = slot;
          state.bySlot.set(b.at, b);
        }
      }
      const base = Model.slugify(Model.fullName(b)) || "brick",
        n = (slugCount.get(base) || 0) + 1;
      slugCount.set(base, n);
      b.slug = n === 1 ? base : `${base}-${n}`;
      state.bySlug.set(b.slug, b);
    }
    // A link made while KIA or CHPLN was part of the name still finds the brick.
    for (const b of state.bricks) {
      const old = Model.slugify(Model.engraving({ ...b, split: false, lines: [] })[0]);
      if (old && !state.bySlug.has(old)) state.bySlug.set(old, b);
    }
    if (state.selectedId != null && !state.byId.has(state.selectedId)) state.selectedId = null;
  }

  function selected() {
    return state.byId.get(state.selectedId) || null;
  }

  // Redraws everything that depends on the bricks. The editor calls this after changes.
  function refresh() {
    reindex();
    runSearch(false);
    renderCard();
    updateMap();
  }

  // ---- search and results -----------------------------------------------

  function runSearch(resetActive = true) {
    let results = Model.search(state.bricks, state.query);
    state.closeMatches = false;
    if (!results.length && state.query && !state.editor) {
      results = Model.closeMatches(state.bricks, state.query);
      state.closeMatches = results.length > 0;
    }
    if (state.editor) results = state.editor.orderResults(results);
    state.results = results;
    document.body.classList.toggle("has-query", !!state.query);
    if (resetActive) state.active = state.query ? 0 : -1;
    state.active = Math.min(state.active, results.length - 1);
    renderResults();
  }

  function setQuery(q) {
    el.search.value = q;
    state.query = q.trim();
    el.clear.hidden = !q;
    runSearch();
  }

  function renderResults() {
    const frag = document.createDocumentFragment(),
      list = state.results;
    let group = null;
    list.forEach((b, i) => {
      const heading = state.editor
        ? state.editor.groupFor(b)
        : state.query
          ? null
          : (b.last || b.first || "#").charAt(0).toUpperCase();
      if (heading && heading !== group) {
        group = heading;
        frag.append(h("li", { class: "results-group", "aria-hidden": "true" }, heading));
      }
      const emblems = Model.emblemsFor(b);
      const btn = h(
        "button",
        {
          type: "button",
          class: [
            "result",
            b.id === state.selectedId && "is-selected",
            i === state.active && "is-active",
            b.color === "gray" && "is-gray",
          ]
            .filter(Boolean)
            .join(" "),
          dataset: { id: b.id },
          id: `result-${b.id}`,
        },
        h(
          "span",
          { class: "result-mark" },
          emblems.length ? emblemImg(emblems[0], "result-emblem") : h("span", { class: "result-swatch" }),
        ),
        h(
          "span",
          { class: "result-text" },
          h(
            "span",
            { class: "result-name" },
            h("span", { class: "result-name-text" }, Model.fullName(b) || "(no name yet)"),
            honorMarks(b),
          ),
          b.lines.length ? h("span", { class: "result-meta" }, Model.plainLines(b).join(" · ")) : null,
        ),
        !b.slot ? h("span", { class: "result-badge" }, b.problem ? "Check spot" : "Not mapped") : null,
      );
      frag.append(h("li", {}, btn));
    });
    if (!list.length)
      frag.append(
        h(
          "li",
          { class: "results-empty" },
          state.editor
            ? state.editor.emptyResults(state.query)
            : `No names match “${state.query}”. Try typing just the last name.`,
        ),
      );
    el.results.replaceChildren(frag);
    el.resultsHead.textContent = state.closeMatches
      ? "No exact match. Did you mean:"
      : state.query
        ? `${list.length} ${list.length === 1 ? "brick" : "bricks"}`
        : `All ${state.bricks.length} bricks`;
    el.search.setAttribute("aria-activedescendant", state.active >= 0 ? `result-${list[state.active]?.id}` : "");
  }

  function moveActive(delta) {
    if (!state.results.length) return;
    state.active = (state.active + delta + state.results.length) % state.results.length;
    for (const node of el.results.querySelectorAll(".result.is-active")) node.classList.remove("is-active");
    const node = document.getElementById(`result-${state.results[state.active].id}`);
    node?.classList.add("is-active");
    node?.scrollIntoView({ block: "nearest" });
    el.search.setAttribute("aria-activedescendant", node ? node.id : "");
  }

  function setSearching(on) {
    sheetCancel();
    document.body.classList.toggle("is-searching", on);
    // On a phone the name list scrolls the page, so the map comes back to a
    // page at the top.
    if (!on) scrollTo(0, 0);
    layoutChanged();
  }

  // New letters in the box show the best matches, from the top of the list.
  function listToTop() {
    el.results.scrollTop = 0;
    if (compact.matches) scrollTo(0, 0);
  }

  // ---- selection ----------------------------------------------------------

  // Shows a brick. Visitors see the whole plaza with a pin on it, and the editor
  // zooms in so the brick can be worked on.
  function select(id, { fly = true, from = "list" } = {}) {
    const b = state.byId.get(id);
    if (!b) return deselect();
    state.selectedId = id;
    state.cardFolded = false;
    const url = new URL(location.href);
    url.hash = Model.fullName(b) ? b.slug : "";
    history.replaceState(null, "", url.href.replace(/#$/, ""));
    if (!state.editor) document.title = Model.fullName(b) ? `${Model.fullName(b)} · ${TITLE}` : TITLE;
    if (compact.matches && from !== "map") {
      el.search.blur();
      setSearching(false);
    }
    for (const node of el.results.querySelectorAll(".result.is-selected")) node.classList.remove("is-selected");
    document.getElementById(`result-${id}`)?.classList.add("is-selected");
    renderCard();
    updateMap();
    if (!b.slot) return;
    if (!fly) map.reveal(b.slot);
    else if (state.editor) map.focusSlot(b.slot);
    else map.fit();
  }

  function deselect() {
    if (state.selectedId == null) return;
    state.selectedId = null;
    const url = new URL(location.href);
    url.hash = "";
    history.replaceState(null, "", url.href.replace(/#$/, ""));
    if (!state.editor) document.title = TITLE;
    for (const node of el.results.querySelectorAll(".result.is-selected")) node.classList.remove("is-selected");
    renderCard();
    updateMap();
  }

  function fromHash() {
    const slug = decodeURIComponent(location.hash.slice(1));
    const b = slug && state.bySlug.get(slug);
    if (b) select(b.id, { from: "hash" });
  }

  // ---- brick card -------------------------------------------------------

  // The brick as it looks in the plaza, engraved the way the map lays it out,
  // on a 200 × 100 brick. A pale copy just below each line catches the light
  // like the lower edge of the cut.
  function replica(b) {
    const lines = Model.engraving(b),
      face = svg("svg", { viewBox: "0 0 200 100", "aria-hidden": "true" }),
      lay = () => {
        const { size, squeeze, lines: laid } = MapView.engrave(lines, b.squeeze),
          engraving = (cls, dy) =>
            svg(
              "g",
              { class: cls, "font-size": (size * 100).toFixed(2), transform: `translate(100 0) scale(${squeeze.toFixed(4)} 1)` },
              laid.map((l) =>
                svg("text", { x: (l.start * 100).toFixed(2), y: (l.baseline * 100 + dy).toFixed(2), "xml:space": "preserve" }, l.text),
              ),
            );
        face.replaceChildren(engraving("replica-light", 0.9), engraving("replica-ink", 0));
      };
    lay();
    MapView.whenFontLoads?.then(lay); // measured again with the real font
    return h(
      "div",
      { class: `replica${b.color === "gray" ? " is-gray" : ""}`, role: "img", "aria-label": lines.join(", ") },
      face,
    );
  }

  async function share(b) {
    const url = `${location.origin}${location.pathname}#${b.slug}`,
      name = Model.fullName(b);
    if (navigator.share && compact.matches) {
      try {
        await navigator.share({ title: `${name}: memorial brick`, text: `${name}'s brick at American Legion Post 779`, url });
      } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  function renderCard() {
    sheetCancel();
    const b = selected();
    document.body.classList.toggle("has-brick", !!b);
    const folded = !state.editor && !!b && compact.matches && state.cardFolded;
    el.card.classList.toggle("is-folded", folded);
    if (state.editor) {
      state.editor.renderCard(el.card, b);
      layoutChanged();
      return;
    }
    if (!b) {
      // No brick open: no card, just the map (the search box shows every name).
      el.card.hidden = true;
      el.card.replaceChildren();
      layoutChanged();
      return;
    }
    el.card.hidden = false;
    // A bar with the name, share and close, over the brick itself. On a phone
    // the card folds down to just the bar while the map is being looked
    // around. Dragging or tapping the card folds and opens it (see the fold,
    // below).
    const emblems = Model.emblemsFor(b).slice(0, 2);
    el.card.replaceChildren(
      h(
        "div",
        { class: "brick-card" },
        compact.matches
          ? h("button", {
              type: "button",
              class: "card-grab",
              "aria-label": folded ? "Show the brick" : "Make the card smaller",
              "aria-expanded": String(!folded),
            })
          : null,
        h(
          "div",
          { class: "card-bar" },
          emblems.length
            ? h("span", { class: "card-emblems" }, emblems.map((k) => emblemImg(k, "card-emblem", Model.EMBLEMS[k].name)))
            : null,
          h(
            "div",
            { class: "card-title" },
            h("p", { class: "card-name" }, Model.fullName(b) || "(no name yet)", honorMarks(b)),
            b.lines.length ? h("p", { class: "card-meta" }, Model.plainLines(b).join(" · ")) : null,
          ),
          h("button", { type: "button", class: "icon-btn", "aria-label": "Share", title: "Share", onclick: () => share(b) }, icon("share")),
          h("button", { type: "button", class: "icon-btn", "aria-label": "Close", title: "Close", onclick: deselect }, icon("close")),
        ),
        replica(b),
        b.slot ? null : h("p", { class: "card-note" }, "This brick isn't on the map yet."),
      ),
    );
    layoutChanged();
  }

  // Pans the map (only if needed) so the open brick isn't off screen or
  // under the card. With the whole plaza showing, it's already in sight.
  function keepBrickInSight() {
    const b = selected();
    if (b?.slot && !state.editor && !map.isFit) map.reveal(b.slot);
  }

  // ---- the phone card's fold ------------------------------------------------

  // Upright the card is a sheet along the bottom, and sideways it hangs from
  // the top left. A finger drags it between open and folded, and let go, it
  // settles whichever way it was flicked, or else whichever is nearer. The
  // same slide plays when its handle or bar is tapped, or the map is moved.
  const sheet = { busy: false, frame: 0, drag: null, g: null, p: 0, to: 0 };
  let lastSwipe = 0;
  const swiped = () => performance.now() - lastSwipe < 500;
  const foldedNow = () => (sheet.busy ? sheet.to === 1 : state.cardFolded);

  // The card's height open and folded, laid out both ways before anything
  // is drawn. Upright it slides down to fold, and sideways its bottom rises.
  function sheetGeometry() {
    const card = el.card,
      folded = card.classList.contains("is-folded");
    card.classList.remove("is-folded");
    const open = card.offsetHeight;
    card.classList.add("is-folded");
    const shut = card.offsetHeight;
    card.classList.toggle("is-folded", folded);
    return { open, shut, span: Math.max(1, open - shut), upright: !sideways.matches };
  }

  // Shows the card part way: 0 is open and 1 is folded.
  function sheetShow(p, g) {
    const shown = g.open - p * g.span;
    sheet.p = p;
    sheet.g = g;
    if (g.upright) el.card.style.transform = `translateY(${(p * g.span).toFixed(1)}px)`;
    else el.card.style.height = `${shown.toFixed(1)}px`;
    el.card.style.setProperty("--fold", p.toFixed(3));
    // Upright, the zoom buttons ride along on top of it.
    if (g.upright) el.mapWrap.style.setProperty("--sheet", `${Math.round(shown + 12)}px`);
  }

  // Lays the card out open (the slide keeps back whatever isn't showing yet)
  // and holds off reframing the map until it's clear where the card is going.
  function sheetStart() {
    sheetCancel(false);
    const g = sheetGeometry();
    sheet.busy = true;
    el.card.classList.remove("is-folded");
    el.card.classList.add("is-moving");
    return g;
  }

  // Stops any slide and puts the card back the way the state says.
  function sheetCancel(dropDrag = true) {
    cancelAnimationFrame(sheet.frame);
    sheet.frame = 0;
    if (dropDrag) sheet.drag = null;
    if (!sheet.busy) return;
    sheet.busy = false;
    el.card.classList.remove("is-moving");
    el.card.classList.toggle("is-folded", !state.editor && !!selected() && compact.matches && state.cardFolded);
    el.card.style.transform = el.card.style.height = "";
    el.card.style.removeProperty("--fold");
  }

  // Slides the card from `from` to open (0) or folded (1) and leaves it so.
  // The map is reframed for where it's going at the same time.
  function sheetSettle(g, from, to) {
    const folded = to === 1,
      duration = reduceMotion.matches ? 0 : 120 + 170 * Math.abs(to - from),
      start = performance.now();
    sheet.to = to;
    layoutChanged({ folded, height: folded ? g.shut : g.open });
    if (!folded) keepBrickInSight();
    const step = (now) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      sheetShow(from + (to - from) * (1 - (1 - t) ** 3), g);
      if (t < 1) {
        sheet.frame = requestAnimationFrame(step);
        return;
      }
      sheet.frame = 0;
      state.cardFolded = folded;
      renderCard();
    };
    cancelAnimationFrame(sheet.frame);
    sheet.frame = requestAnimationFrame(step);
  }

  // Folds or opens the card with the slide. Mid-slide, it turns around.
  function slideFold(on) {
    if (!compact.matches || state.editor || !selected()) return;
    const to = on ? 1 : 0;
    if (sheet.busy && !sheet.drag) {
      if (sheet.to !== to) sheetSettle(sheet.g, sheet.p, to);
      return;
    }
    if (sheet.busy || state.cardFolded === on) return;
    const g = sheetStart(),
      from = state.cardFolded ? 1 : 0;
    sheetShow(from, g);
    sheetSettle(g, from, to);
  }

  function bindCardSwipe() {
    // A tap on a phone's brick card folds or opens it: anywhere on it but
    // the brick itself and the share and close buttons, so there's no dead
    // spot around the handle or the bar. Folded, anywhere but those buttons
    // opens it.
    el.card.addEventListener("click", (e) => {
      if (!compact.matches || state.editor || !selected() || swiped()) return;
      if (e.target.closest(".card-bar button")) return;
      const folded = foldedNow(),
        brick = !folded && el.card.querySelector(".replica")?.getBoundingClientRect();
      if (brick && e.detail && e.clientY >= brick.top && e.clientY <= brick.bottom) return;
      slideFold(!folded);
    });
    el.card.addEventListener("pointerdown", (e) => {
      if (!compact.matches || state.editor || !selected() || sheet.drag) return;
      if ((e.pointerType === "mouse" && e.button !== 0) || e.target.closest(".card-bar button")) return;
      sheet.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, g: null, p: 0, from: foldedNow() ? 1 : 0, samples: [] };
    });
    el.card.addEventListener("pointermove", (e) => {
      const d = sheet.drag;
      if (!d || d.id !== e.pointerId) return;
      if (!d.g) {
        // Only once it's clearly a drag up or down.
        const dx = e.clientX - d.x,
          dy = e.clientY - d.y;
        if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return;
        try {
          el.card.setPointerCapture(e.pointerId);
        } catch {}
        if (sheet.busy) {
          // Caught mid-slide: carry on from where it is.
          cancelAnimationFrame(sheet.frame);
          d.g = sheet.g;
          d.from = sheet.p;
        } else d.g = sheetStart();
        d.y = e.clientY;
      }
      // Down folds a card along the bottom, and up folds one hanging from the top.
      const toward = (e.clientY - d.y) * (d.g.upright ? 1 : -1);
      d.p = clamp(d.from + toward / d.g.span, 0, 1);
      sheetShow(d.p, d.g);
      d.samples.push([e.timeStamp, e.clientY]);
      if (d.samples.length > 5) d.samples.shift();
    });
    const release = (e) => {
      const d = sheet.drag;
      if (!d || d.id !== e.pointerId) return;
      sheet.drag = null;
      if (!d.g) return; // a tap: the card's click folds or opens it
      lastSwipe = performance.now();
      const last = d.samples[d.samples.length - 1],
        first = d.samples[0],
        speed =
          e.type === "pointerup" && first && last
            ? ((last[1] - first[1]) / Math.max(1, last[0] - first[0])) * (d.g.upright ? 1 : -1)
            : 0,
        to = speed > 0.35 ? 1 : speed < -0.35 ? 0 : d.p > 0.5 ? 1 : 0;
      sheetSettle(d.g, d.p, to);
    };
    el.card.addEventListener("pointerup", release);
    el.card.addEventListener("pointercancel", release);
  }

  // ---- map ----------------------------------------------------------------

  function updateMap() {
    map.scene.named = state.bySlot;
    map.scene.selectedId = state.selectedId;
    map.draw();
  }

  // Frames the map in what the card leaves free. While the card slides, it's
  // told where the card is going (`plan`) rather than measuring it part way.
  function layoutChanged(plan) {
    if (!map || (sheet.busy && !plan)) return;
    // On a phone the name list covers the map, so the map stays as it was.
    // Otherwise it would slide around behind the list and back again.
    if (compact.matches && document.body.classList.contains("is-searching")) return;
    // On phones the card is a sheet along the bottom, or hangs down the left
    // side when the phone is turned sideways.
    const open = compact.matches && !el.card.hidden,
      side = open && sideways.matches,
      height = plan ? plan.height : el.card.offsetHeight,
      tucked = plan ? plan.folded : el.card.classList.contains("is-folded"),
      bottom = open && !side ? height + 12 : 0,
      left = side && !tucked ? el.card.offsetWidth + 12 : 0;
    // While the card slides, the zoom buttons follow it (see sheetShow).
    if (!plan) el.mapWrap.style.setProperty("--sheet", `${bottom}px`);
    // Sideways the zoom buttons run down the right edge. With the side panel
    // open the plaza is squeezed, so it keeps clear of them. With it folded
    // there's room, and the plaza sits in the middle of the screen.
    const controls = left && el.mapWrap.querySelector(".map-controls"),
      right = controls ? Math.round(el.mapWrap.getBoundingClientRect().right - controls.getBoundingClientRect().left) : 0;
    if (compact.matches && !sideways.matches) {
      // Upright, the map sits under the search bar (and the editor bar, if
      // open). Sideways it runs to the top, beside the panel.
      const top = el.search.closest(".search").getBoundingClientRect().bottom - el.side.getBoundingClientRect().top;
      el.mapWrap.style.top = `${Math.round(top)}px`;
    } else el.mapWrap.style.top = "";
    map.setInsets({ top: 0, right, bottom, left }, document.body.classList.contains("is-ready"));
  }

  function showTooltip(text, e) {
    if (!text || !e || !hover.matches) {
      el.tooltip.hidden = true;
      return;
    }
    const r = el.mapWrap.getBoundingClientRect();
    if (typeof text === "string") el.tooltip.textContent = text;
    else el.tooltip.replaceChildren(...text);
    el.tooltip.hidden = false;
    const x = Math.min(e.clientX - r.left + 14, r.width - el.tooltip.offsetWidth - 8),
      y = Math.min(e.clientY - r.top + 16, r.height - el.tooltip.offsetHeight - 8);
    el.tooltip.style.transform = `translate(${x}px, ${y}px)`;
  }

  const mapCallbacks = {
    onTap(hit) {
      if (state.editor?.onTap(hit)) return;
      if (document.body.classList.contains("is-searching") && compact.matches) {
        el.search.blur();
        setSearching(false);
        return;
      }
      // Tapping a named brick opens it. Stray taps leave the open brick alone.
      const b = hit.slot && state.bySlot.get(hit.slot.key);
      if (b) select(b.id, { fly: false, from: "map" });
    },
    onHover(hit, e) {
      const b = hit?.slot && state.bySlot.get(hit.slot.key);
      const editorText = state.editor?.hoverText(hit, b);
      const key = b || editorText ? hit.slot?.key || null : null;
      if (map.scene.hoverKey !== key) {
        map.scene.hoverKey = key;
        map.draw();
      }
      el.canvas.style.cursor = state.editor?.cursor(hit, b) || (b ? "pointer" : "");
      showTooltip(
        editorText ??
          (b
            ? [
                h("span", { class: "tooltip-name" }, Model.fullName(b), honorMarks(b)),
                ...Model.plainLines(b).map((l) => h("span", { class: "tooltip-line" }, l)),
              ]
            : ""),
        e,
      );
    },
    canDrag: (hit) => !!state.editor?.canDrag(hit),
    onDragStart: (hit) => state.editor?.dragStart(hit),
    onDragMove: (hit) => state.editor?.dragMove(hit),
    onDragEnd: (hit, cancelled) => state.editor?.dragEnd(hit, cancelled),
    onKey: (e) => !!state.editor?.onMapKey(e),
    // Looking around the map folds a phone's brick card out of the way.
    onUserMove: () => foldForMap(),
    // Turning the phone changes what fits, so the open brick is looked for.
    onResize: () => keepBrickInSight(),
    // "Show the whole plaza" only appears once it would do something, and
    // zoom out rests while the whole plaza is already showing.
    onZoomedOut(out) {
      $("#zoom-fit").hidden = out;
      $("#zoom-out").disabled = out;
    },
    // And zoom in rests once it's all the way in.
    onZoomedIn(max) {
      $("#zoom-in").disabled = max;
    },
  };

  // Looking around the map on a phone folds the brick card out of the way.
  function foldForMap() {
    if (!state.editor && compact.matches && selected() && !sheet.drag) slideFold(true);
  }

  // ---- about ----------------------------------------------------------------

  // Counts by branch and by war, worked out from the bricks themselves. One
  // chart shows at a time (two buttons switch between them) so the whole
  // window fits on a phone without scrolling.
  let statsTab = "branch";
  function renderStats() {
    const branches = new Map(),
      eras = new Map();
    for (const b of state.bricks) {
      for (const k of Model.emblemsFor(b)) branches.set(k, (branches.get(k) || 0) + 1);
      for (const e of Model.erasFor(b)) eras.set(e, (eras.get(e) || 0) + 1);
    }
    $("#about-text").textContent = `${state.bricks.length} engraved bricks honoring veterans and the post's charter members.`;
    const charts = [
      ["branch", "By branch", [...branches].sort((a, b) => b[1] - a[1]).map(([k, n]) => [Model.EMBLEMS[k].name, n, k])],
      ["war", "By war", Model.ERAS.filter((e) => eras.has(e)).map((e) => [e, eras.get(e)])],
    ];
    const bars = (key, entries) => {
      const max = Math.max(...entries.map(([, n]) => n), 1);
      return h(
        "ul",
        { class: "bars", id: `stats-${key}`, role: "tabpanel", "aria-labelledby": `stats-tab-${key}` },
        // A branch's row has its emblem, and its bar is in the branch's colour.
        entries.map(([label, n, branch]) =>
          h(
            "li",
            branch ? { dataset: { branch } } : {},
            h("span", { class: "bars-label" }, branch ? emblemImg(branch, "bars-emblem", "") : null, label),
            h("span", { class: "bars-track" }, h("span", { class: "bars-fill", style: `width:${(n / max) * 100}%` })),
            h("span", { class: "bars-n" }, n),
          ),
        ),
      );
    };
    const show = (key) => {
      statsTab = key;
      for (const [k] of charts) {
        $(`#stats-tab-${k}`).setAttribute("aria-selected", String(k === key));
        $(`#stats-${k}`).setAttribute("aria-hidden", String(k !== key));
      }
    };
    $("#stats").replaceChildren(
      h(
        "div",
        { class: "stats-tabs", role: "tablist", "aria-label": "Count the bricks" },
        charts.map(([k, label]) =>
          h(
            "button",
            { type: "button", class: "stats-tab", role: "tab", id: `stats-tab-${k}`, "aria-controls": `stats-${k}`, onclick: () => show(k) },
            label,
          ),
        ),
      ),
      // Both charts share one spot, so the window doesn't change size when switching.
      h("div", { class: "stats-charts" }, charts.map(([k, , entries]) => bars(k, entries))),
    );
    show(statsTab);
  }

  // ---- wiring -------------------------------------------------------------

  function bindUI() {
    // Sideways, the keyboard and Safari's bars leave only a sliver of the
    // page, so Safari scrolls the page to keep the search box in sight, and
    // later won't let it be scrolled back. So as the keyboard goes, the names
    // are put back where they were (or at the top, after typing). While it's
    // up, the list waits to go back to the top, rather than fight Safari.
    const kb = { at: 0, typed: false, byHand: false };
    const cramped = () => sideways.matches && document.activeElement === el.search;
    el.search.addEventListener("input", () => {
      kb.typed = true;
      setSearching(true);
      setQuery(el.search.value);
      if (cramped()) el.results.scrollTop = 0;
      else listToTop();
    });
    el.search.addEventListener("focus", () => {
      Object.assign(kb, { at: scrollY, typed: false, byHand: false });
      setSearching(true);
    });
    el.search.addEventListener("blur", () => {
      if (sideways.matches && !kb.byHand && document.body.classList.contains("is-searching")) scrollTo(0, kb.typed ? 0 : kb.at);
    });
    el.search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") moveActive(1);
      else if (e.key === "ArrowUp") moveActive(-1);
      else if (e.key === "Enter") {
        const i = state.active >= 0 ? state.active : state.query ? 0 : -1,
          b = i >= 0 ? state.results[i] : null;
        // In the editor, Shift+Enter always adds a new brick with the typed name.
        if (state.editor?.onSearchEnter(state.query, e.shiftKey ? null : b)) return e.preventDefault();
        if (b) select(b.id);
      } else if (e.key === "Escape") {
        if (state.query) setQuery("");
        else {
          el.search.blur();
          setSearching(false);
        }
      } else return;
      e.preventDefault();
    });
    $("#results-close").addEventListener("click", () => {
      el.search.blur();
      setSearching(false);
    });
    el.clear.addEventListener("click", () => {
      setQuery("");
      listToTop();
      el.search.focus();
    });
    // Scrolling the list puts the keyboard away, so more names show.
    el.results.addEventListener(
      "touchmove",
      () => {
        if (document.activeElement !== el.search) return;
        kb.byHand = true; // the list is theirs to scroll, so it stays put
        el.search.blur();
      },
      { passive: true },
    );
    el.results.addEventListener("click", (e) => {
      const btn = e.target.closest(".result");
      if (btn) state.editor?.onResultClick(Number(btn.dataset.id)) || select(Number(btn.dataset.id));
    });

    // With a brick open, the buttons zoom in on it. They leave the card as it
    // is, so they stay put under a finger tapping them again.
    const zoomOn = () => (!state.editor && selected()?.slot) || null;
    $("#zoom-in").addEventListener("click", () => map.zoomBy(1.7, zoomOn()));
    $("#zoom-out").addEventListener("click", () => map.zoomBy(1 / 1.7, zoomOn()));
    $("#zoom-fit").addEventListener("click", () => map.fit());
    $("#rotate").addEventListener("click", () => map.rotate());

    // Older iPhones (before iOS 15.4) can't open a <dialog> as a pop-up, so
    // there it's just shown on top of the page.
    const modal = typeof el.about.showModal === "function";
    el.about.classList.toggle("is-fallback", !modal);
    $("#about-open").addEventListener("click", () => {
      renderStats();
      if (modal) el.about.showModal();
      else el.about.setAttribute("open", "");
    });
    el.about.addEventListener("click", (e) => {
      if (e.target !== el.about && !e.target.closest("[data-close]")) return;
      if (modal) el.about.close();
      else el.about.removeAttribute("open");
    });

    window.addEventListener("hashchange", fromHash);
    compact.addEventListener("change", renderCard);
    sideways.addEventListener("change", renderCard);
    bindCardSwipe();
    stopDoubleTapZoom();
    new ResizeObserver(() => layoutChanged()).observe(el.card);
  }

  // A quick second tap in the same spot zooms the page on an iPhone. The
  // stylesheet stops that on buttons and the map, but Safari still zooms on
  // plain text and backgrounds, so the second tap is stopped there. Buttons
  // and links are left alone, so they can be tapped quickly (like the zoom
  // buttons, or a name right after a tap to stop the list scrolling).
  function stopDoubleTapZoom() {
    let start = null,
      last = null;
    document.addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches?.[0];
        start = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
      },
      { passive: true },
    );
    document.addEventListener(
      "touchend",
      (e) => {
        if (e.touches?.length || !start || !e.changedTouches?.length) return;
        const t = e.changedTouches[0],
          near = (p, r) => Math.hypot(t.clientX - p.x, t.clientY - p.y) < r;
        if (!near(start, 10)) return (last = null); // a swipe, not a tap
        const again = last && e.timeStamp - last.time < 400 && near(last, 40);
        last = again ? null : { time: e.timeStamp, x: t.clientX, y: t.clientY };
        if (again && !e.target.closest?.("input, textarea, select, canvas, button, a")) e.preventDefault();
      },
      { passive: false },
    );
  }

  function start() {
    if (typeof BRICKS === "undefined" || !Array.isArray(BRICKS)) {
      el.resultsHead.textContent = "The brick list (data/bricks.js) didn't load.";
      return;
    }
    state.bricks = BRICKS.map((r, i) => Model.fromRecord(r, i + 1));
    map = new MapView(el.canvas, mapCallbacks);
    map.marker = el.marker;
    bindUI();
    reindex();
    runSearch();
    renderCard();
    updateMap();

    if (local && new URLSearchParams(location.search).has("edit")) {
      const s = document.createElement("script");
      s.src = "js/editor.js";
      s.onload = () => Editor.start(api);
      document.body.append(s);
    }
    // Let the first frame settle before animating anything.
    requestAnimationFrame(() =>
      setTimeout(() => {
        document.body.classList.add("is-ready");
        fromHash();
      }, 250),
    );
  }

  // What the editor uses.
  const api = {
    state,
    el,
    h,
    icon,
    replica,
    toast,
    refresh,
    setQuery,
    select,
    deselect,
    renderCard,
    get map() {
      return map;
    },
  };

  start();
  return api;
})();
