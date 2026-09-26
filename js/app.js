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
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
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
          h("span", { class: "result-name" }, Model.fullName(b) || "(no name yet)"),
          b.lines.length ? h("span", { class: "result-meta" }, b.lines.join(" · ")) : null,
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
        ? `${list.length} ${list.length === 1 ? "name" : "names"}`
        : `All ${state.bricks.length} names`;
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
    const lines = [Model.fullName(b) || " ", ...b.lines],
      { size, baselines } = MapView.engrave(lines),
      engraving = (cls, dy) =>
        svg(
          "g",
          { class: cls, "font-size": (size * 100).toFixed(2), "text-anchor": "middle" },
          lines.map((line, i) => svg("text", { x: 100, y: (baselines[i] * 100 + dy).toFixed(2) }, line)),
        );
    return h(
      "div",
      { class: `replica${b.color === "gray" ? " is-gray" : ""}`, role: "img", "aria-label": lines.join(", ") },
      svg("svg", { viewBox: "0 0 200 100", "aria-hidden": "true" }, engraving("replica-light", 0.9), engraving("replica-ink", 0)),
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
    const b = selected();
    document.body.classList.toggle("has-brick", !!b);
    const folded = !state.editor && !!b && compact.matches && state.cardFolded,
      welcome = !state.editor && !b && compact.matches;
    el.card.classList.toggle("is-folded", folded);
    el.card.classList.toggle("is-intro", welcome);
    if (state.editor) {
      state.editor.renderCard(el.card, b);
      layoutChanged();
      return;
    }
    if (!b) {
      // Phones get the button to every name where a brick's card goes.
      el.card.hidden = !welcome;
      el.card.replaceChildren(...(welcome ? intro() : []));
      layoutChanged();
      return;
    }
    el.card.hidden = false;
    // The brick itself, with close and share beside it. On a phone the card
    // folds down to a slim bar with the name while the map is being looked
    // around, and tapping the bar brings the brick back.
    const emblems = Model.emblemsFor(b).slice(0, 2),
      toggle = () => !swiped() && fold(!state.cardFolded);
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
              onclick: toggle,
            })
          : null,
        h(
          "div",
          { class: "card-bar", onclick: (e) => compact.matches && !e.target.closest("button") && toggle() },
          emblems.length
            ? h("span", { class: "card-emblems" }, emblems.map((k) => emblemImg(k, "card-emblem", Model.EMBLEMS[k].name)))
            : null,
          h("p", { class: "card-name" }, Model.fullName(b) || "(no name yet)"),
          h("button", { type: "button", class: "icon-btn card-open", "aria-label": "Show the brick", title: "Show the brick", onclick: () => fold(false) }, icon("open")),
        ),
        replica(b),
        h(
          "div",
          { class: "card-actions" },
          h("button", { type: "button", class: "icon-btn", "aria-label": "Close", title: "Close", onclick: deselect }, icon("close")),
          h("button", { type: "button", class: "icon-btn card-share", "aria-label": "Share", title: "Share", onclick: () => share(b) }, icon("share")),
        ),
        b.slot ? null : h("p", { class: "card-note" }, "This brick isn't on the map yet."),
      ),
    );
    layoutChanged();
  }

  function fold(on) {
    if (state.cardFolded === on) return;
    state.cardFolded = on;
    renderCard();
    // Opened back up, the card covers more of the map than before.
    if (!on) keepBrickInSight();
  }

  // Pans the map (only if needed) so the open brick isn't off screen or
  // under the card. With the whole plaza showing, it's already in sight.
  function keepBrickInSight() {
    const b = selected();
    if (b?.slot && !state.editor && !map.isFit) map.reveal(b.slot);
  }

  // On an upright phone the card can also be swiped down to fold it and up to
  // open it again, like other sheets on a phone.
  let lastSwipe = 0;
  const swiped = () => performance.now() - lastSwipe < 500;
  function bindCardSwipe() {
    let start = null;
    el.card.addEventListener("pointerdown", (e) => {
      const upright = compact.matches && !sideways.matches;
      if (!upright || state.editor || !selected() || e.target.closest(".card-bar button, .card-actions")) return;
      start = { id: e.pointerId, y: e.clientY };
    });
    el.card.addEventListener("pointerup", (e) => {
      if (!start || start.id !== e.pointerId) return;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dy) < 30) return;
      lastSwipe = performance.now();
      fold(dy > 0);
    });
    el.card.addEventListener("pointercancel", () => (start = null));
  }

  function intro() {
    return [
      h(
        "button",
        {
          type: "button",
          class: "btn btn-primary btn-big",
          onclick: () => {
            setSearching(true);
            // A phone's keyboard would cover the names they asked to see.
            if (hover.matches) el.search.focus();
          },
        },
        `See all ${state.bricks.length} names`,
      ),
    ];
  }

  // ---- map ----------------------------------------------------------------

  function updateMap() {
    map.scene.named = state.bySlot;
    map.scene.selectedId = state.selectedId;
    map.draw();
  }

  function layoutChanged() {
    if (!map) return;
    // On a phone the name list covers the map, so the map stays as it was.
    // Otherwise it would slide around behind the list and back again.
    if (compact.matches && document.body.classList.contains("is-searching")) return;
    // On phones the card is a sheet along the bottom, or down the left side
    // when the phone is turned sideways. The map is framed in what's left.
    const open = compact.matches && !el.card.hidden,
      side = open && sideways.matches,
      bottom = open && !side ? el.card.offsetHeight + 12 : 0,
      tucked = el.card.classList.contains("is-folded") || el.card.classList.contains("is-intro"),
      left = side && !tucked ? el.card.offsetWidth + 12 : 0;
    el.mapWrap.style.setProperty("--sheet", `${bottom}px`);
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
    el.tooltip.textContent = text;
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
      showTooltip(editorText ?? (b ? [Model.fullName(b), ...b.lines].join("\n") : ""), e);
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
  };

  // Looking around the map on a phone folds the brick card out of the way.
  function foldForMap() {
    if (!state.editor && compact.matches && selected()) fold(true);
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
      ["branch", "By branch", [...branches].sort((a, b) => b[1] - a[1]).map(([k, n]) => [Model.EMBLEMS[k].name, n])],
      ["war", "By war", Model.ERAS.filter((e) => eras.has(e)).map((e) => [e, eras.get(e)])],
    ];
    const bars = (key, entries) => {
      const max = Math.max(...entries.map(([, n]) => n), 1);
      return h(
        "ul",
        { class: "bars", id: `stats-${key}`, role: "tabpanel", "aria-labelledby": `stats-tab-${key}` },
        entries.map(([label, n]) =>
          h(
            "li",
            {},
            h("span", { class: "bars-label" }, label),
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
    el.search.addEventListener("input", () => {
      setSearching(true);
      setQuery(el.search.value);
      listToTop();
    });
    el.search.addEventListener("focus", () => setSearching(true));
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
        if (document.activeElement === el.search) el.search.blur();
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
    new ResizeObserver(layoutChanged).observe(el.card);
  }

  // A quick second tap in the same spot zooms the page on an iPhone. The
  // stylesheet stops that on buttons and the map, but Safari still zooms on
  // plain text and backgrounds, so the second tap is stopped here. The zoom
  // buttons are left alone so they can be tapped fast.
  function stopDoubleTapZoom() {
    let start = null,
      last = null;
    document.addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches[0];
        start = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
      },
      { passive: true },
    );
    document.addEventListener(
      "touchend",
      (e) => {
        if (e.touches.length || !start) return;
        const t = e.changedTouches[0],
          near = (p, r) => Math.hypot(t.clientX - p.x, t.clientY - p.y) < r;
        if (!near(start, 10)) return (last = null); // a swipe, not a tap
        const again = last && e.timeStamp - last.time < 400 && near(last, 40);
        last = again ? null : { time: e.timeStamp, x: t.clientX, y: t.clientY };
        if (again && !e.target.closest?.("input, textarea, select, canvas, .map-btn")) e.preventDefault();
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
