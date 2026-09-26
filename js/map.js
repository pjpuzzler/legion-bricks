/*
 * map.js: draws the plaza on a <canvas> and handles pan, zoom and rotate.
 *
 * The app describes what to show through `map.scene` and calls `map.draw()`.
 * Taps, hovers and drags come back through the callbacks passed in.
 */
const MapView = (() => {
  const C = {
    grass: "#97a95b",
    lot: "#6d7075",
    lotLine: "#f1efe8",
    concrete: "#e9e4da",
    concreteLine: "#cfc7b8",
    gravel: "#d5ccbd",
    gravelDark: "#b4a894",
    gravelLight: "#f0ebe1",
    wall: "#958a7e",
    wallTop: "#a89e92",
    wallEdge: "#6a6259",
    pillar: "#877c70",
    pillarCap: "#a29789",
    border: "#7a7772",
    pavers: ["#c39b79", "#c9a381", "#bb9273", "#c79a74", "#bf9a7e"],
    mortar: "#cdc7be", // light gray joints between the bricks
    engraved: "#dcc0a3", // a few shades lighter than the field, so they can be spotted
    gray: "#9d9e9c", // the gray bricks
    plaque: "#4b4035",
    plaqueRim: "#9a8260",
    hedge: "#4e7a3b",
    hedgeTop: "#628f49",
    hedgeEdge: "#3a5c2c",
    bench: "#cdbb9e",
    benchEdge: "#8f7f66",
    selected: "#fff8e1",
    selectedEdge: "#c81e1e", // matches the red pin
    hover: "#14243d",
    ink: "#2b1c10",
    inkGray: "#1d1d1d",
    granite: "#62666d",
    graniteEdge: "#3a3d42",
    pole: "#fbfbfb",
    poleEdge: "#55585c",
    targetOk: "rgba(22, 163, 74, 0.55)",
    targetSwap: "rgba(245, 158, 11, 0.6)",
    ghost: "rgba(236, 195, 137, 0.85)",
  };
  // The engraving is a condensed sans like Helvetica Condensed Bold. Apple
  // devices have that font and Android has Roboto Condensed. Anything else gets
  // a normal width font, so the text just comes out a little smaller.
  const FONT =
    '"HelveticaNeue-CondensedBold", "Helvetica Neue", "Roboto Condensed", sans-serif-condensed, "Arial Narrow", Helvetica, Arial, sans-serif';
  const MAX_SCALE = 110; // screen px per brick unit
  const PAN_ROOM = 16; // how far past the plaza's edges you can move once zoomed in
  const OVERSHOOT = 40; // how far (screen px) a drag can pull the map past its limits
  const MIN_TEXT_PX = 6.5;
  // Flags are part of the drawing: sized in brick units, so they scale with
  // everything else at every zoom and look the same on every screen. (They only
  // ever reach over the path and lawn, never the bricks.)
  const FLAG = 4.5; // flag height, in brick units

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const JOINT = (px) => clamp(1.4 * px, 0.06, 0.16); // grout line width, in brick units
  // Grout lines and the stand-in lettering fade in between these zooms (screen
  // px per brick unit). Zoomed out further they'd only be clutter.
  const DETAIL_FROM = 7,
    DETAIL_FULL = 12;
  const detailAt = (scale) => clamp((scale - DETAIL_FROM) / (DETAIL_FULL - DETAIL_FROM), 0, 1);
  const TEXTURE = 0.4; // how much the pavers' shades show when zoomed out

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  // Gives way less and less the further it's pushed, and never passes `max`.
  const resist = (x, max) => (max * x) / (x + 2 * max);

  function useFont(ctx, px) {
    ctx.font = `700 ${px}px ${FONT}`;
    if ("fontStretch" in ctx) ctx.fontStretch = "condensed";
  }

  // Width of a line of brick text, per 1px of font size.
  const measurer = document.createElement("canvas").getContext("2d");
  useFont(measurer, 100);
  const textWidth = (s) => Math.max(1, measurer.measureText(s).width) / 100;

  // How the lines sit on a brick, measured off the real ones: one size for
  // every line, the longest about 90% of the brick's length, capitals about a
  // fifth of its width, and the block centred. For a 2 × 1 brick, gives the
  // font size and each line's baseline, down from the top edge.
  const CAP = 0.72, // height of the capitals, per unit of font size
    PITCH = 1.1; // line spacing, per unit of font size
  function engrave(lines) {
    const n = lines.length,
      size = Math.min(1.8 / Math.max(...lines.map(textWidth)), 0.28, 0.76 / ((n - 1) * PITCH + CAP)),
      block = ((n - 1) * PITCH + CAP) * size;
    return { size, baselines: lines.map((_, i) => 0.5 - block / 2 + (CAP + i * PITCH) * size) };
  }

  function hash2(a, b) {
    let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b + 0x9e3779b9, 0x165667b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return h >>> 0;
  }

  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The flags are pictures of the real ones (img/flags-*.webp, made from the
  // official artwork): each at 5:3, like a 3 × 5 ft flag, four to a row in
  // this order. The small sheet loads with the map. The sharp one loads the
  // first time a flag is drawn big.
  const FLAG_ORDER = ["us", "pow", "army", "navy", "air-force", "marines", "coast-guard", "space-force"];
  const FLAG_RATIO = 5 / 3;
  const flagSheets = [
    { src: "img/flags-sm.webp", h: 48, gutter: 2 },
    { src: "img/flags-lg.webp", h: 300, gutter: 4 },
  ];

  function loadFlags(sheet, done) {
    if (sheet.img) return;
    sheet.img = new Image();
    sheet.img.onload = () => {
      sheet.ready = true;
      done();
    };
    sheet.img.src = sheet.src;
  }

  // A flag at screen size (x, y, w, h in CSS px; dpr for how sharp it needs
  // to be). `redraw` is called when a sharper picture arrives.
  function drawFlag(ctx, kind, x, y, w, h, dpr, redraw) {
    const [small, sharp] = flagSheets,
      big = h * dpr > small.h * 1.25;
    if (big) loadFlags(sharp, redraw);
    const sheet = big && sharp.ready ? sharp : small.ready ? small : sharp.ready ? sharp : null;
    if (sheet) {
      const k = FLAG_ORDER.indexOf(kind),
        sw = Math.round(sheet.h * FLAG_RATIO);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(sheet.img, (k % 4) * (sw + sheet.gutter), Math.floor(k / 4) * (sheet.h + sheet.gutter), sw, sheet.h, x, y, w, h);
    } else drawPlainFlag(ctx, kind, x, y, w, h);
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = Math.max(0.75, h * 0.03);
    ctx.strokeRect(x, y, w, h);
  }

  // Until the pictures load (or if they can't): each flag's field colour and
  // a simple version of its emblem, in the official colours.
  function drawPlainFlag(ctx, kind, x, y, w, h) {
    const cx = x + w / 2,
      cy = y + h / 2;
    const rect = (color, rx, ry, rw, rh) => {
      ctx.fillStyle = color;
      ctx.fillRect(rx, ry, rw, rh);
    };
    const disc = (color, r, dy = 0) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy + dy * h, r * h, 0, 2 * Math.PI);
      ctx.fill();
    };
    const blue = "#001489",
      gold = "#ffc72c",
      white = "#ffffff";
    switch (kind) {
      case "us": {
        const stripe = h / 13;
        rect(white, x, y, w, h);
        for (let i = 0; i < 13; i += 2) rect("#b31942", x, y + i * stripe, w, stripe);
        rect("#0a3161", x, y, w * 0.4, stripe * 7);
        break;
      }
      case "pow":
        rect("#000000", x, y, w, h);
        disc(white, 0.24);
        break;
      case "army":
        rect(white, x, y, w, h);
        disc(blue, 0.22, -0.1);
        rect("#c8102e", x + w * 0.3, y + h * 0.68, w * 0.4, h * 0.1);
        break;
      case "space-force": {
        const d = h * 0.3;
        rect("#000000", x, y, w, h);
        disc("#3f6eb2", 0.2, -0.06);
        ctx.fillStyle = "#e8ecef";
        ctx.beginPath();
        ctx.moveTo(cx, cy - d);
        ctx.lineTo(cx + d * 0.55, cy + d * 0.55);
        ctx.lineTo(cx, cy + d * 0.3);
        ctx.lineTo(cx - d * 0.55, cy + d * 0.55);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "air-force":
        rect(blue, x, y, w, h);
        disc(white, 0.2);
        disc("#4aa3df", 0.14);
        break;
      case "marines":
        rect("#ba0c2f", x, y, w, h);
        disc(gold, 0.2, -0.08);
        rect(white, x + w * 0.3, y + h * 0.7, w * 0.4, h * 0.09);
        break;
      case "coast-guard":
        rect(white, x, y, w, h);
        disc("#002f6c", 0.22);
        break;
      case "navy":
        rect("#00263a", x, y, w, h);
        disc(gold, 0.24, -0.06);
        disc("#bcd4e6", 0.19, -0.06);
        rect(gold, x + w * 0.32, y + h * 0.72, w * 0.36, h * 0.08);
        break;
    }
  }

  // Upper half of a ring (y ≤ cy), as seen with y pointing down.
  function halfRing(cx, cy, r1, r2) {
    const p = new Path2D();
    p.arc(cx, cy, r2, Math.PI, 2 * Math.PI);
    p.arc(cx, cy, r1, 2 * Math.PI, Math.PI, true);
    p.closePath();
    return p;
  }

  // Path2D.roundRect only arrived in iOS 16, so older iPhones draw it by hand.
  function roundedRect(path, x, y, w, h, r) {
    if (path.roundRect) return path.roundRect(x, y, w, h, r);
    path.moveTo(x + r, y);
    path.arcTo(x + w, y, x + w, y + h, r);
    path.arcTo(x + w, y + h, x, y + h, r);
    path.arcTo(x, y + h, x, y, r);
    path.arcTo(x, y, x + w, y, r);
    path.closePath();
  }

  function polygon(path, pts) {
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
  }

  function square(path, cx, cy, size, angle) {
    const c = Math.cos(angle),
      s = Math.sin(angle),
      h = size / 2;
    polygon(
      path,
      [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]),
    );
  }

  function buildStatic() {
    const S = Plan.SHAPE,
      R = Plan.R,
      { axis, arcY, straightWall: sw, entranceHalfWidth: e, monument: m } = S,
      w = Plan.walkway;
    const out = {};

    // Brick field (clip region): the D, the entrance and the walkway.
    const field = new Path2D(),
      a = Plan.angleAtY(R.field, sw.top);
    field.arc(axis, arcY, R.field, Math.PI - a, 2 * Math.PI + a);
    field.closePath();
    field.rect(axis - e, sw.top, 2 * e, sw.bottom - sw.top);
    field.rect(w.left, w.top, w.right - w.left, w.bottom - w.top);
    out.field = field;

    // The gravel bed, and the concrete path around it. At each end the path
    // widens into a square pad that runs down beside the walkway to the lot.
    out.gravel = halfRing(axis, arcY, R.wallOut, R.gravelOut);
    out.curb = halfRing(axis, arcY, R.gravelOut, R.curbOut);
    for (const p of Plan.pads) out.curb.rect(p.left, p.top, p.right - p.left, p.bottom - p.top);

    // Stones in the gravel: the ring behind the wall, and the beds beside the
    // walkway (those go down first, under the shrubs, bench and path).
    const rand = mulberry32(779);
    const stones = () => ({ dark: new Path2D(), light: new Path2D() });
    out.ringStones = stones();
    out.bedStones = stones();
    const stone = (group, x, y) => {
      const size = 0.07 + rand() * 0.13,
        path = rand() < 0.55 ? group.dark : group.light;
      path.moveTo(x + size, y);
      path.arc(x, y, size, 0, 2 * Math.PI);
    };
    const scatter = (x, y, w, h) => {
      for (let i = 0; i < w * h * 3; i++) stone(out.bedStones, x + rand() * w, y + rand() * h);
    };
    const area = (Math.PI / 2) * (R.gravelOut ** 2 - R.wallOut ** 2);
    for (let i = 0; i < area * 3; i++) {
      const t = Math.PI + rand() * Math.PI,
        r = Math.sqrt(R.wallOut ** 2 + rand() * (R.gravelOut ** 2 - R.wallOut ** 2));
      stone(out.ringStones, axis + r * Math.cos(t), arcY + r * Math.sin(t));
    }

    // Walls: the curved one and the two straight ones.
    const wallEnd = axis - R.wallOut + 1,
      wallFace = sw.top + 1,
      wallBack = sw.bottom - 1;
    out.wall = halfRing(axis, arcY, R.wallIn, R.wallOut);
    out.wall.rect(wallEnd, wallFace, axis - e - S.pillar - wallEnd, wallBack - wallFace);
    out.wall.rect(axis + e + S.pillar, wallFace, axis + R.wallOut - 1 - (axis + e + S.pillar), wallBack - wallFace);
    out.wallTop = halfRing(axis, arcY, R.wallIn + 0.9, R.wallOut - 0.9);
    out.wallTop.rect(wallEnd, wallFace + 0.9, axis - e - S.pillar - wallEnd, wallBack - wallFace - 1.8);
    out.wallTop.rect(axis + e + S.pillar, wallFace + 0.9, axis + R.wallOut - 1 - (axis + e + S.pillar), wallBack - wallFace - 1.8);

    out.pillars = new Path2D();
    out.pillarCaps = new Path2D();
    for (const p of Plan.pillars) {
      square(out.pillars, p.x, p.y, p.size, p.angle);
      square(out.pillarCaps, p.x, p.y, p.size - 1.6, p.angle);
    }

    out.border = new Path2D();
    for (const pts of Plan.borderPavers) polygon(out.border, pts);

    // Monument: the upright stone, inside its ring of gray pavers (those are
    // with the border pavers).
    out.monumentStone = new Path2D();
    out.monumentStone.rect(m.left + 1, m.top + 1, m.right - m.left - 2, m.bottom - m.top - 2);

    // Parking lot: angled spaces, with concrete wheel stops in the ones in
    // front of the memorial. Wide enough that its ends never come into view.
    const P = S.parking,
      lotTop = Plan.lotY + 1.3,
      lotLeft = axis - 260,
      lotRight = axis + 260;
    out.lotCurb = new Path2D();
    out.lotCurb.rect(lotLeft, Plan.lotY, lotRight - lotLeft, 1.3);
    out.lot = new Path2D();
    out.lot.rect(lotLeft, lotTop, lotRight - lotLeft, P.depth + 200);
    out.lotLines = new Path2D();
    out.wheelStops = new Path2D();
    // Each stripe leans down to the left. The last space with a wheel stop ends
    // at the middle of the right-hand pad, and the stripes repeat from there.
    const lean = P.lean * P.depth,
      stopY = lotTop + 2.5,
      rightPad = Plan.pads[1],
      anchor = (rightPad.left + rightPad.right) / 2;
    for (let k = Math.ceil((lotLeft + lean - anchor) / P.spacing); anchor + k * P.spacing <= lotRight; k++) {
      const top = anchor + k * P.spacing;
      out.lotLines.moveTo(top, lotTop);
      out.lotLines.lineTo(top - lean, lotTop + P.depth);
      const middle = top + P.spacing / 2 - P.lean * (stopY + 0.7 - lotTop);
      if (k >= -P.stops && k < 0) out.wheelStops.rect(middle - 9, stopY, 18, 1.4);
    }

    // Past each pad: a gravel bed with a stone bench in it, then a row of shrubs,
    // each trimmed into its own block, running off along the lot.
    out.hedges = new Path2D();
    out.hedgeTops = new Path2D();
    out.hedgeRock = new Path2D();
    out.benches = new Path2D();
    const hedgeTop = S.walkway.top + 1,
      hedgeBottom = Plan.lotY,
      depth = hedgeBottom - hedgeTop,
      rockTop = hedgeTop - 1.6,
      { length, gap } = S.shrubs;
    for (const [pad, dir] of [
      [Plan.pads[0], -1],
      [Plan.pads[1], 1],
    ]) {
      const edge = dir < 0 ? pad.left : pad.right,
        start = edge + dir * S.benchGap,
        far = start + dir * 400,
        [g0, g1] = [Math.min(edge, far), Math.max(edge, far)];
      out.hedgeRock.rect(g0, rockTop, g1 - g0, hedgeBottom - rockTop);
      scatter(Math.min(edge, start), rockTop, S.benchGap, hedgeBottom - rockTop); // by the bench
      scatter(dir < 0 ? start - 60 : start, rockTop, 60, hedgeTop - rockTop); // along the shrubs
      for (let i = 0; i * (length + gap) < 400; i++) {
        const near = start + dir * i * (length + gap),
          x = dir < 0 ? near - length : near;
        scatter(dir < 0 ? x - gap : x + length, hedgeTop, gap, depth); // between two shrubs
        roundedRect(out.hedges, x, hedgeTop, length, depth, 3.2);
        roundedRect(out.hedgeTops, x + 1.4, hedgeTop + 1.4, length - 2.8, depth - 2.8, 2.4);
      }
      // The bench runs alongside the first shrub, as long as the shrubs are deep.
      const middle = edge + (dir * S.benchGap) / 2;
      out.benches.rect(middle - 2, hedgeTop + 0.5, 4, depth - 1);
    }

    // Round plaques on top of the pillars.
    out.plaques = new Path2D();
    for (const p of Plan.pillars) {
      out.plaques.moveTo(p.x + 1.7, p.y);
      out.plaques.arc(p.x, p.y, 1.7, 0, 2 * Math.PI);
    }
    return out;
  }

  // Groups the field pavers into tiles so only visible ones get drawn.
  function buildTiles() {
    const TILE = 16,
      tiles = new Map();
    for (const p of Plan.drawable) {
      const tx = Math.floor(p.x / TILE),
        ty = Math.floor(p.y / TILE),
        k = `${tx},${ty}`;
      let t = tiles.get(k);
      if (!t) {
        t = {
          x0: tx * TILE - 1,
          y0: ty * TILE - 1,
          x1: (tx + 1) * TILE + 2,
          y1: (ty + 1) * TILE + 2,
          shades: C.pavers.map(() => new Path2D()),
          joints: new Path2D(),
        };
        tiles.set(k, t);
      }
      t.shades[hash2(p.row, p.col) % C.pavers.length].rect(p.x, p.y, p.w, p.h);
      t.joints.rect(p.x, p.y, p.w, p.h);
    }
    return [...tiles.values()];
  }

  class MapView {
    constructor(canvas, callbacks = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.cb = callbacks;
      this.view = { x: 0, y: 0, scale: 1, angle: 0 };
      this.size = { w: 0, h: 0, dpr: 1 };
      this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
      this.scene = {
        named: new Map(), // slot key → brick
        selectedId: null,
        hoverKey: null,
        movingId: null, // editor: brick being dragged
        target: null, // editor: { key, kind: "ok" | "swap" }
        ghost: null, // editor: { x, y, vertical } in world units
      };
      this.marker = null;
      this.isFit = true;
      this.pointers = new Map();
      this.press = null;
      this.pinch = null;
      this.anim = 0;
      this.frame = 0;
      this.static = buildStatic();
      this.tiles = buildTiles();
      loadFlags(flagSheets[0], () => this.draw());
      this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

      new ResizeObserver(() => this.resize()).observe(canvas);
      this.bindInput();
      this.resize();
    }

    // ---- view math ------------------------------------------------------

    worldToScreen(wx, wy, v = this.view) {
      const c = Math.cos(v.angle),
        s = Math.sin(v.angle),
        dx = wx - v.x,
        dy = wy - v.y;
      return [
        this.size.w / 2 + (dx * c - dy * s) * v.scale,
        this.size.h / 2 + (dx * s + dy * c) * v.scale,
      ];
    }

    screenToWorld(sx, sy, v = this.view) {
      const c = Math.cos(v.angle),
        s = Math.sin(v.angle),
        rx = (sx - this.size.w / 2) / v.scale,
        ry = (sy - this.size.h / 2) / v.scale;
      return [v.x + rx * c + ry * s, v.y - rx * s + ry * c];
    }

    // Moves `v` so the world point lands on the given screen point.
    placeWorldAt(v, [wx, wy], [sx, sy]) {
      const c = Math.cos(v.angle),
        s = Math.sin(v.angle),
        rx = (sx - this.size.w / 2) / v.scale,
        ry = (sy - this.size.h / 2) / v.scale;
      v.x = wx - (rx * c + ry * s);
      v.y = wy - (-rx * s + ry * c);
      return v;
    }

    // Centre of the part of the canvas not covered by panels.
    focusPoint() {
      const { w, h } = this.size,
        i = this.insets;
      return [(i.left + w - i.right) / 2, (i.top + h - i.bottom) / 2];
    }

    fitScale(angle = this.view.angle) {
      const b = Plan.frame,
        c = Math.abs(Math.cos(angle)),
        s = Math.abs(Math.sin(angle)),
        bw = b.right - b.left,
        bh = b.bottom - b.top,
        i = this.insets,
        aw = Math.max(60, this.size.w - i.left - i.right),
        ah = Math.max(60, this.size.h - i.top - i.bottom);
      return Math.min(aw / (bw * c + bh * s), ah / (bw * s + bh * c));
    }

    // The whole plaza: the frame fills the free part of the screen, centred
    // on the plaza wherever there's room to spare.
    fitView(angle = this.view.angle) {
      const v = { x: 0, y: 0, angle, scale: this.fitScale(angle) },
        f = Plan.frame,
        i = this.insets,
        c = Math.abs(Math.cos(angle)),
        s = Math.abs(Math.sin(angle)),
        seenW = Math.max(1, this.size.w - i.left - i.right) / v.scale,
        seenH = Math.max(1, this.size.h - i.top - i.bottom) / v.scale,
        halfX = (seenW * c + seenH * s) / 2,
        halfY = (seenW * s + seenH * c) / 2,
        centre = (lo, hi, half, want) => clamp(want, Math.min(hi - half, lo + half), Math.max(hi - half, lo + half)),
        [cx, cy] = Plan.centre;
      return this.clampView(
        this.placeWorldAt(v, [centre(f.left, f.right, halfX, cx), centre(f.top, f.bottom, halfY, cy)], this.focusPoint()),
      );
    }

    // The limits: you can't zoom out past the whole plaza, and the plaza can
    // only be moved as far as it overflows the screen, plus a little room that
    // grows as you zoom in. Zooming back out therefore settles it back into
    // place. While it all fits on screen it stays put, with the brick field
    // as near the middle as the flags and the lot allow. With keepScale the
    // zoom is left alone and only the position is fixed.
    clampView(v = this.view, keepScale = false) {
      const fitScale = this.fitScale(v.angle);
      if (!keepScale) v.scale = clamp(v.scale, fitScale, MAX_SCALE);
      const b = Plan.bounds,
        i = this.insets,
        c = Math.abs(Math.cos(v.angle)),
        s = Math.abs(Math.sin(v.angle)),
        seenW = Math.max(1, this.size.w - i.left - i.right) / v.scale,
        seenH = Math.max(1, this.size.h - i.top - i.bottom) / v.scale,
        room = PAN_ROOM * clamp(v.scale / fitScale - 1, 0, 1),
        limit = (value, lo, hi, half, centre) => {
          const min = lo + half - room,
            max = hi - half + room;
          return min > max ? clamp(centre, max, min) : clamp(value, min, max);
        },
        focus = this.focusPoint(),
        [x, y] = this.screenToWorld(...focus, v),
        [cx, cy] = Plan.centre;
      return this.placeWorldAt(
        v,
        [
          limit(x, b.left, b.right, (seenW * c + seenH * s) / 2, cx),
          limit(y, b.top, b.bottom, (seenW * s + seenH * c) / 2, cy),
        ],
        focus,
      );
    }

    // While a finger is down the map can be pulled a little way past its
    // limits, harder the further it goes, and settle() springs it back after.
    soften(raw) {
      const fitScale = this.fitScale(raw.angle),
        focus = this.focusPoint(),
        target = this.screenToWorld(...focus, raw),
        v = { ...raw };
      if (v.scale < fitScale) v.scale = fitScale * Math.exp(-resist(Math.log(fitScale / v.scale), 0.1));
      v.scale = Math.min(v.scale, MAX_SCALE);
      this.placeWorldAt(v, target, focus);
      const [hx, hy] = this.screenToWorld(...focus, this.clampView({ ...v }, true)),
        pull = (d) => (Math.sign(d) * resist(Math.abs(d) * v.scale, OVERSHOOT)) / v.scale;
      return this.placeWorldAt(v, [hx + pull(target[0] - hx), hy + pull(target[1] - hy)], focus);
    }

    settle() {
      const target = this.clampView({ ...this.view });
      if (Math.abs(target.scale - this.fitScale()) < 1e-6) this.isFit = true;
      const moved =
        Math.abs(target.x - this.view.x) + Math.abs(target.y - this.view.y) > 1e-3 ||
        Math.abs(target.scale - this.view.scale) > 1e-3;
      if (moved) this.animateTo(target, 260);
      return moved;
    }

    visibleWorld() {
      const { w, h } = this.size,
        pts = [
          [0, 0],
          [w, 0],
          [0, h],
          [w, h],
        ].map(([x, y]) => this.screenToWorld(x, y));
      return {
        x0: Math.min(...pts.map((p) => p[0])),
        x1: Math.max(...pts.map((p) => p[0])),
        y0: Math.min(...pts.map((p) => p[1])),
        y1: Math.max(...pts.map((p) => p[1])),
      };
    }

    hit(sx, sy) {
      const [x, y] = this.screenToWorld(sx, sy);
      return { x, y, sx, sy, slot: Plan.slotAt(x, y) };
    }

    // ---- moving the view ------------------------------------------------

    setInsets(insets, animate = true) {
      const changed = Object.keys(insets).some((k) => insets[k] !== this.insets[k]);
      if (!changed) return;
      // Mid-gesture (say the brick card folds as a pinch starts), moving the
      // map would pull it out from under the fingers. It waits for them to lift.
      if (this.pointers.size) {
        this.pendingInsets = { ...insets };
        return;
      }
      Object.assign(this.insets, insets);
      if (this.isFit) this.animateTo(this.fitView(), animate ? 250 : 0);
    }

    // Applies insets that changed during a gesture, now that it's over.
    applyPendingInsets() {
      if (!this.pendingInsets) return;
      Object.assign(this.insets, this.pendingInsets);
      this.pendingInsets = null;
    }

    stop() {
      cancelAnimationFrame(this.anim);
      this.anim = 0;
    }

    animateTo(target, duration = 600) {
      this.stop();
      this.clampView(target);
      if (this.reduceMotion.matches || duration <= 0) {
        Object.assign(this.view, target);
        this.draw();
        return;
      }
      const from = { ...this.view },
        start = performance.now();
      const step = (now) => {
        const t = ease(Math.min(1, (now - start) / duration));
        this.view.x = from.x + (target.x - from.x) * t;
        this.view.y = from.y + (target.y - from.y) * t;
        this.view.scale = Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * t);
        this.view.angle = from.angle + (target.angle - from.angle) * t;
        this.render();
        this.anim = t < 1 ? requestAnimationFrame(step) : 0;
      };
      this.anim = requestAnimationFrame(step);
    }

    fit(animate = true) {
      this.isFit = true;
      this.animateTo(this.fitView(), animate ? 500 : 0);
    }

    zoomAt(sx, sy, factor, animate = false) {
      const v = { ...this.view };
      const anchor = this.screenToWorld(sx, sy);
      v.scale = clamp(v.scale * factor, this.fitScale(), MAX_SCALE);
      this.placeWorldAt(v, anchor, [sx, sy]);
      this.isFit = Math.abs(v.scale - this.fitScale()) < 1e-6;
      if (animate) this.animateTo(v, 250);
      else {
        Object.assign(this.view, this.clampView(v));
        this.draw();
      }
    }

    // Zooms on the middle of the map, or on a brick when it's in sight, so
    // the brick stays put while everything grows around it.
    zoomBy(factor, slot = null) {
      let [x, y] = this.focusPoint();
      if (slot) {
        const [sx, sy] = this.worldToScreen(slot.x + slot.w / 2, slot.y + slot.h / 2),
          i = this.insets;
        if (sx > i.left && sx < this.size.w - i.right && sy > i.top && sy < this.size.h - i.bottom) [x, y] = [sx, sy];
      }
      this.zoomAt(x, y, factor, true);
    }

    shifted(v, dx, dy) {
      const c = Math.cos(v.angle),
        s = Math.sin(v.angle),
        rx = dx / v.scale,
        ry = dy / v.scale;
      return { ...v, x: v.x - (rx * c + ry * s), y: v.y - (-rx * s + ry * c) };
    }

    panBy(dx, dy) {
      const c = Math.cos(this.view.angle),
        s = Math.sin(this.view.angle),
        rx = dx / this.view.scale,
        ry = dy / this.view.scale;
      this.view.x -= rx * c + ry * s;
      this.view.y -= -rx * s + ry * c;
      this.isFit = false;
      this.clampView();
      this.draw();
    }

    rotate(dir = 1) {
      const quarter = Math.PI / 2,
        angle = Math.round(this.view.angle / quarter) * quarter + dir * quarter;
      if (this.isFit) {
        this.animateTo(this.fitView(angle), 450);
        return;
      }
      const v = { ...this.view, angle },
        centre = this.screenToWorld(...this.focusPoint());
      this.animateTo(this.placeWorldAt(v, centre, this.focusPoint()), 450);
    }

    // Brings a brick into view; zooms in unless `keepScale` is set.
    focusSlot(slot, { keepScale = false, animate = true } = {}) {
      const want = this.size.w < 600 ? 24 : 30,
        scale = keepScale ? this.view.scale : Math.max(this.view.scale, want),
        v = { ...this.view, scale };
      this.placeWorldAt(v, [slot.x + slot.w / 2, slot.y + slot.h / 2], this.focusPoint());
      this.isFit = false;
      this.animateTo(v, animate ? 700 : 0);
    }

    // Pans just enough to get a brick out from under the panels.
    reveal(slot) {
      const [sx, sy] = this.worldToScreen(slot.x + slot.w / 2, slot.y + slot.h / 2),
        i = this.insets,
        pad = 40;
      const inside =
        sx > i.left + pad &&
        sx < this.size.w - i.right - pad &&
        sy > i.top + pad &&
        sy < this.size.h - i.bottom - pad;
      if (!inside) this.focusSlot(slot, { keepScale: true });
    }

    // ---- drawing ------------------------------------------------------

    draw() {
      if (this.frame || this.anim) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
    }

    resize() {
      const w = this.canvas.clientWidth,
        h = this.canvas.clientHeight,
        dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!w || !h) return;
      if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return;
      const first = !this.size.w;
      this.size = { w, h, dpr };
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      // An animation aimed for the old size would land in the wrong place (say,
      // zoomed out to a phone's view on a big screen), so it's dropped.
      this.stop();
      if (first || this.isFit) Object.assign(this.view, this.fitView());
      else this.clampView();
      this.render();
      if (!first) this.cb.onResize?.();
    }

    worldTransform() {
      const { dpr } = this.size,
        { scale, angle } = this.view,
        c = Math.cos(angle) * scale * dpr,
        s = Math.sin(angle) * scale * dpr,
        [ox, oy] = this.worldToScreen(0, 0);
      this.ctx.setTransform(c, s, -s, c, ox * dpr, oy * dpr);
    }

    render() {
      const { ctx, static: S, scene } = this,
        { w, h, dpr } = this.size;
      if (!w || !h) return;
      const scale = this.view.scale,
        px = 1 / scale,
        vis = this.visibleWorld();

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = C.grass;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.worldTransform();
      ctx.lineJoin = "round";

      // Parking lot
      ctx.fillStyle = C.concrete;
      ctx.fill(S.lotCurb);
      ctx.fillStyle = C.lot;
      ctx.fill(S.lot);
      ctx.strokeStyle = C.lotLine;
      ctx.lineWidth = 0.9;
      ctx.stroke(S.lotLines);
      ctx.fillStyle = C.concrete;
      ctx.fill(S.wheelStops);
      ctx.strokeStyle = C.concreteLine;
      ctx.lineWidth = Math.max(px, 0.1);
      ctx.stroke(S.wheelStops);

      // Gravel beds beside the walkway, with the shrubs on them
      ctx.fillStyle = C.gravel;
      ctx.fill(S.hedgeRock);
      if (scale > 3) this.drawStones(S.bedStones);
      ctx.fillStyle = C.hedge;
      ctx.fill(S.hedges);
      ctx.fillStyle = C.hedgeTop;
      ctx.fill(S.hedgeTops);
      ctx.strokeStyle = C.hedgeEdge;
      ctx.lineWidth = Math.max(px, 0.15);
      ctx.stroke(S.hedges);

      // Curb and gravel rings
      ctx.fillStyle = C.concrete;
      ctx.fill(S.curb);
      ctx.fillStyle = C.gravel;
      ctx.fill(S.gravel);
      if (scale > 3) {
        ctx.save();
        ctx.clip(S.gravel); // so no stone pokes out over the path
        this.drawStones(S.ringStones);
        ctx.restore();
      }
      ctx.fillStyle = C.bench;
      ctx.fill(S.benches);
      ctx.strokeStyle = C.benchEdge;
      ctx.lineWidth = Math.max(px, 0.14);
      ctx.stroke(S.benches);

      // Brick field
      const visibleTiles = this.tiles.filter(
        (t) => t.x1 >= vis.x0 && t.x0 <= vis.x1 && t.y1 >= vis.y0 && t.y0 <= vis.y1,
      );
      const detail = detailAt(scale);
      ctx.save();
      ctx.clip(S.field);
      // Zoomed out, the pavers' shades are toned down so the field reads as one
      // surface and the lighter engraved bricks stand out.
      ctx.fillStyle = C.pavers[0];
      ctx.fill(S.field);
      ctx.globalAlpha = TEXTURE + (1 - TEXTURE) * detail;
      for (const t of visibleTiles)
        for (let i = 1; i < C.pavers.length; i++) {
          ctx.fillStyle = C.pavers[i];
          ctx.fill(t.shades[i]);
        }
      ctx.globalAlpha = 1;
      if (detail > 0) {
        ctx.globalAlpha = detail;
        ctx.strokeStyle = C.mortar;
        ctx.lineWidth = JOINT(px);
        for (const t of visibleTiles) ctx.stroke(t.joints);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // Border pavers, with the same grout as the rest
      ctx.fillStyle = C.border;
      ctx.fill(S.border);
      if (detail > 0) {
        ctx.globalAlpha = detail;
        ctx.strokeStyle = C.mortar;
        ctx.lineWidth = JOINT(px);
        ctx.stroke(S.border);
        ctx.globalAlpha = 1;
      }

      // Walls and pillars
      ctx.fillStyle = C.wall;
      ctx.fill(S.wall);
      ctx.fillStyle = C.wallTop;
      ctx.fill(S.wallTop);
      ctx.strokeStyle = C.wallEdge;
      ctx.lineWidth = Math.max(px, 0.1);
      ctx.stroke(S.wall);
      ctx.fillStyle = C.pillar;
      ctx.fill(S.pillars);
      ctx.fillStyle = C.pillarCap;
      ctx.fill(S.pillarCaps);
      ctx.stroke(S.pillars);
      ctx.fillStyle = C.plaque;
      ctx.fill(S.plaques);
      ctx.strokeStyle = C.plaqueRim;
      ctx.lineWidth = Math.max(px, 0.22);
      ctx.stroke(S.plaques);

      // Monument
      ctx.fillStyle = C.granite;
      ctx.fill(S.monumentStone);
      ctx.strokeStyle = C.graniteEdge;
      ctx.lineWidth = Math.max(px, 0.08);
      ctx.stroke(S.monumentStone);

      this.drawNamed(vis);
      this.drawEditOverlays();
      this.drawFlagpoles();
      this.drawText();
      this.placeMarker();

      const zoomedOut = scale <= this.fitScale() * 1.001;
      if (zoomedOut !== this.zoomedOut) {
        this.zoomedOut = zoomedOut;
        this.cb.onZoomedOut?.(zoomedOut);
      }
    }

    drawStones({ dark, light }) {
      const { ctx } = this;
      ctx.fillStyle = C.gravelDark;
      ctx.fill(dark);
      ctx.fillStyle = C.gravelLight;
      ctx.fill(light);
    }

    // Engraved bricks are a little lighter than the rest of the field (the gray
    // ones are gray), so it's easy to see which bricks can be tapped.
    drawNamed(vis) {
      const { ctx, scene } = this,
        px = 1 / this.view.scale;
      const inView = (p) => p.x + p.w >= vis.x0 && p.x <= vis.x1 && p.y + p.h >= vis.y0 && p.y <= vis.y1;
      const edge = (p, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
      };
      const detail = detailAt(this.view.scale);
      this.visibleNamed = [];
      for (const b of scene.named.values()) {
        const p = b.slot;
        if (!p || b.id === scene.movingId || !inView(p)) continue;
        this.visibleNamed.push(b);
        ctx.fillStyle = b.color === "gray" ? C.gray : C.engraved;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        if (detail > 0) {
          ctx.globalAlpha = detail;
          edge(p, C.mortar, JOINT(px));
          ctx.globalAlpha = 1;
        }
      }
      const hover = scene.hoverKey && Plan.slots.get(scene.hoverKey);
      if (hover) edge(hover, C.hover, 2 * px);
      const sel = this.selectedBrick();
      if (sel) {
        ctx.fillStyle = C.selected;
        ctx.fillRect(sel.slot.x, sel.slot.y, sel.slot.w, sel.slot.h);
        edge(sel.slot, C.selectedEdge, Math.max(2.5 * px, 0.14));
      }
    }

    selectedBrick() {
      const { scene } = this;
      if (scene.selectedId == null || scene.selectedId === scene.movingId) return null;
      for (const b of scene.named.values()) if (b.id === scene.selectedId) return b;
      return null;
    }

    drawEditOverlays() {
      const { ctx, scene } = this,
        px = 1 / this.view.scale;
      const t = scene.target && Plan.slots.get(scene.target.key);
      if (t) {
        ctx.fillStyle = scene.target.kind === "swap" ? C.targetSwap : C.targetOk;
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeStyle = C.hover;
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(t.x, t.y, t.w, t.h);
      }
      if (scene.ghost) {
        const g = scene.ghost,
          gw = g.vertical ? 1 : 2,
          gh = g.vertical ? 2 : 1;
        ctx.fillStyle = C.ghost;
        ctx.fillRect(g.x - gw / 2, g.y - gh / 2, gw, gh);
        ctx.strokeStyle = C.hover;
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.lineWidth = 1.5 * px;
        ctx.strokeRect(g.x - gw / 2, g.y - gh / 2, gw, gh);
        ctx.setLineDash([]);
      }
    }

    drawFlagpoles() {
      const { ctx } = this,
        { dpr } = this.size,
        scale = this.view.scale;
      // Each pole stands on a round concrete footing.
      for (const f of Plan.flagpoles) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, 1.6, 0, 2 * Math.PI);
        ctx.fillStyle = C.concrete;
        ctx.fill();
        ctx.strokeStyle = C.concreteLine;
        ctx.lineWidth = Math.max(1 / scale, 0.12);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.main ? 0.85 : 0.6, 0, 2 * Math.PI);
        ctx.fillStyle = C.pole;
        ctx.fill();
        ctx.strokeStyle = C.poleEdge;
        ctx.stroke();
      }
      // Little flags, drawn upright on screen whichever way the map is turned.
      // The tall centre pole flies the US flag with the POW/MIA flag under it.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fh = FLAG * scale; // in screen px
      for (const f of Plan.flagpoles) {
        const [x, y] = this.worldToScreen(f.x, f.y),
          height = f.main ? fh * 1.2 : fh,
          top = y - height * (f.main ? 2.5 : 2.1),
          fw = height * FLAG_RATIO,
          redraw = () => this.draw();
        ctx.strokeStyle = C.poleEdge;
        ctx.lineWidth = Math.max(1.2, 0.22 * scale);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, top);
        ctx.stroke();
        drawFlag(ctx, f.flag, x + 0.6, top, fw, height, dpr, redraw);
        if (f.main) drawFlag(ctx, "pow", x + 0.6, top + height + 1, fw * 0.85, height * 0.85, dpr, redraw);
      }
      this.worldTransform();
    }

    // Engraved names on the bricks once they're big enough to read, laid out
    // like the real ones. Until then, a faint bar stands in for each line.
    drawText() {
      const { ctx } = this,
        { dpr } = this.size,
        scale = this.view.scale,
        detail = detailAt(scale);
      if (!detail || !this.visibleNamed) return;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      for (const b of this.visibleNamed) {
        const fit = this.fitText(b),
          { size, baselines } = fit.full,
          p = b.slot,
          [sx, sy] = this.worldToScreen(p.x + p.w / 2, p.y + p.h / 2),
          angle = this.view.angle + (p.vertical ? -Math.PI / 2 : 0),
          c = Math.cos(angle),
          s = Math.sin(angle);
        // Screen px, from the middle of the brick, turned to read along it.
        ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, sx * dpr, sy * dpr);
        ctx.fillStyle = b.color === "gray" ? C.inkGray : C.ink;
        ctx.globalAlpha = b.id === this.scene.selectedId ? 1 : 0.85;
        if (size * scale >= MIN_TEXT_PX) {
          useFont(ctx, size * scale);
          fit.lines.forEach((line, i) => ctx.fillText(line, 0, (baselines[i] - 0.5) * scale));
        } else if (fit.short * scale >= MIN_TEXT_PX) {
          // Just the last name, bigger, until the whole engraving fits.
          useFont(ctx, fit.short * scale);
          ctx.fillText(fit.shortText, 0, (CAP * fit.short * scale) / 2);
        } else {
          ctx.globalAlpha = 0.3 * detail;
          const cap = CAP * size * scale,
            thick = Math.max(0.8, cap * 0.6);
          fit.lines.forEach((line, i) => {
            const w = textWidth(line) * size * scale;
            ctx.fillRect(-w / 2, (baselines[i] - 0.5) * scale - cap / 2 - thick / 2, w, thick);
          });
        }
      }
      ctx.globalAlpha = 1;
      this.worldTransform();
    }

    // A brick's engraving layout, cached per brick.
    fitText(b) {
      const lines = [[b.first, b.last].filter(Boolean).join(" "), ...b.lines],
        key = lines.join("\n");
      if (b._fit?.key === key) return b._fit;
      const shortText = b.last || b.first || "";
      b._fit = { key, lines, full: engrave(lines), short: Math.min(0.5, 1.8 / textWidth(shortText)), shortText };
      return b._fit;
    }

    placeMarker() {
      if (!this.marker) return;
      const b = this.selectedBrick();
      if (!b) {
        this.marker.hidden = true;
        return;
      }
      // The ring goes round the middle of the brick and the tip of the pin
      // stops just above its top edge, so the pin rides the brick as it grows.
      const p = b.slot,
        [x, y] = this.worldToScreen(p.x + p.w / 2, p.y + p.h / 2),
        corners = [
          [p.x, p.y],
          [p.x + p.w, p.y],
          [p.x, p.y + p.h],
          [p.x + p.w, p.y + p.h],
        ].map(([wx, wy]) => this.worldToScreen(wx, wy)),
        xs = corners.map((c) => c[0]),
        ys = corners.map((c) => c[1]),
        top = Math.min(...ys),
        size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - top);
      // Whole device pixels, so the pin doesn't shimmer as the map moves.
      const { dpr } = this.size,
        snap = (v) => Math.round(v * dpr) / dpr;
      this.marker.hidden = false;
      this.marker.style.transform = `translate(${snap(x)}px, ${snap(y)}px)`;
      this.marker.style.setProperty("--lift", `${snap(y - top)}px`);
      // Once the brick is bigger than the ring, its red outline shows where it
      // is, so the ring rests.
      this.marker.classList.toggle("is-big", size > 56);
    }

    // ---- input ----------------------------------------------------------

    bindInput() {
      const c = this.canvas;
      c.addEventListener("pointerdown", (e) => this.pointerDown(e));
      c.addEventListener("pointermove", (e) => this.pointerMove(e));
      c.addEventListener("pointerup", (e) => this.pointerUp(e, false));
      c.addEventListener("pointercancel", (e) => this.pointerUp(e, true));
      c.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse" && !this.pointers.size) this.cb.onHover?.(null, e);
      });
      c.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
      c.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const [x, y] = this.pos(e);
        this.zoomAt(x, y, e.shiftKey ? 0.5 : 2, true);
        this.cb.onUserMove?.();
      });
      c.addEventListener("keydown", (e) => this.key(e));
    }

    pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    pointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {}
      this.stop();
      const p = this.pos(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 1) {
        const hit = this.hit(...p);
        this.press = {
          id: e.pointerId,
          start: p,
          last: p,
          moved: false,
          hit,
          canDrag: !!this.cb.canDrag?.(hit),
          dragging: false,
          samples: [[performance.now(), p]],
          slop: e.pointerType === "mouse" ? 4 : 9,
        };
      } else if (this.pointers.size === 2) {
        if (this.press?.dragging) this.cb.onDragEnd?.(null, true);
        this.press = null;
        const [a, b] = [...this.pointers.values()];
        this.pinch = {
          dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1,
          mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
          view: { ...(this.raw || this.view) },
        };
        this.isFit = false;
        this.cb.onUserMove?.();
      }
    }

    pointerMove(e) {
      const p = this.pos(e);
      if (!this.pointers.has(e.pointerId)) {
        if (e.pointerType === "mouse") this.cb.onHover?.(this.hit(...p), e);
        return;
      }
      this.pointers.set(e.pointerId, p);

      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()],
          dist = Math.hypot(a[0] - b[0], a[1] - b[1]),
          mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
          v = { ...this.pinch.view };
        const anchor = this.screenToWorld(...this.pinch.mid, this.pinch.view);
        v.scale *= dist / this.pinch.dist;
        this.raw = this.placeWorldAt(v, anchor, mid);
        Object.assign(this.view, this.soften(this.raw));
        this.isFit = false;
        this.draw();
        return;
      }

      const pr = this.press;
      if (!pr || pr.id !== e.pointerId) return;
      if (!pr.moved && Math.hypot(p[0] - pr.start[0], p[1] - pr.start[1]) > pr.slop) {
        pr.moved = true;
        if (pr.canDrag) {
          pr.dragging = true;
          this.cb.onDragStart?.(pr.hit);
        } else {
          this.isFit = false; // before the callback, which may change the insets
          this.cb.onUserMove?.();
        }
      }
      if (!pr.moved) return;
      if (pr.dragging) this.cb.onDragMove?.(this.hit(...p));
      else {
        this.raw = this.shifted(this.raw || { ...this.view }, p[0] - pr.last[0], p[1] - pr.last[1]);
        Object.assign(this.view, this.soften(this.raw));
        this.isFit = false;
        this.draw();
        pr.samples.push([performance.now(), p]);
        if (pr.samples.length > 6) pr.samples.shift();
      }
      pr.last = p;
    }

    pointerUp(e, cancelled) {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.applyPendingInsets();
      if (this.pinch) {
        if (this.pointers.size < 2) {
          this.pinch = null;
          this.raw = null;
          this.settle();
        }
        return;
      }
      const pr = this.press;
      if (!pr || pr.id !== e.pointerId) return;
      this.press = null;
      this.raw = null;
      const p = this.pos(e);
      if (pr.dragging) this.cb.onDragEnd?.(cancelled ? null : this.hit(...p), cancelled);
      else if (!pr.moved && !cancelled) this.cb.onTap?.(this.hit(...p), e);
      else if (!this.settle() && !cancelled) this.fling(pr.samples);
    }

    // Keeps a pan gliding for a moment after the finger lifts.
    fling(samples) {
      if (this.reduceMotion.matches || samples.length < 2) return;
      const [t1, p1] = samples[samples.length - 1],
        [t0, p0] = samples[0],
        dt = t1 - t0;
      if (dt <= 0 || performance.now() - t1 > 80) return;
      let vx = (p1[0] - p0[0]) / dt,
        vy = (p1[1] - p0[1]) / dt,
        last = performance.now();
      if (Math.hypot(vx, vy) < 0.25) return;
      const step = (now) => {
        const d = now - last;
        last = now;
        this.panBy(vx * d, vy * d);
        this.render();
        const k = Math.exp(-d / 220);
        vx *= k;
        vy *= k;
        this.anim = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
      };
      this.anim = requestAnimationFrame(step);
    }

    wheel(e) {
      e.preventDefault();
      this.stop();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= this.size.h;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025));
      const [x, y] = this.pos(e);
      this.zoomAt(x, y, factor);
      this.cb.onUserMove?.();
    }

    key(e) {
      if (this.cb.onKey?.(e)) return;
      const step = 60;
      switch (e.key) {
        case "+":
        case "=":
          this.zoomBy(1.6);
          break;
        case "-":
        case "_":
          this.zoomBy(1 / 1.6);
          break;
        case "0":
          this.fit();
          break;
        case "r":
        case "R":
          this.rotate(e.shiftKey ? -1 : 1);
          break;
        case "ArrowLeft":
          this.panBy(step, 0);
          break;
        case "ArrowRight":
          this.panBy(-step, 0);
          break;
        case "ArrowUp":
          this.panBy(0, step);
          break;
        case "ArrowDown":
          this.panBy(0, -step);
          break;
        default:
          return;
      }
      e.preventDefault();
      if (e.key !== "0") this.cb.onUserMove?.();
    }
  }

  MapView.engrave = engrave; // the brick card lays out its text the same way
  return MapView;
})();
