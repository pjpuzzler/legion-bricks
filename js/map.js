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
    lotLine: "#e8cc5a", // faded yellow, like the lot's
    road: "#8b8781", // older asphalt, lighter than the lot's
    roadYellow: "#e2b53e",
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
    granite: "#9a9ea2", // light gray granite, like the monument
    graniteEdge: "#5d6166",
    graniteFleck: "#6f7479",
    snow: "#eef1f4",
    snowGravel: "#e9ebec",
    snowEdge: "#c3cad3", // the shaded side of a snow bank
    poppy: "#c8102e",
    poppyHeart: "#2b1a14",
    wreath: "#2f5d34",
    wreathLight: "#4f7f47",
    bow: "#b3202e",
    night: "12, 20, 44",
    lampFooting: "#d9cf86", // the footing is painted yellow
    lampFootingEdge: "#a3995a",
    lampPost: "#3a3d42",
    pole: "#fbfbfb",
    poleShine: "#e9edf1", // brushed aluminum
    finial: "#d4a93a",
    poleEdge: "#8d949c",
    targetOk: "rgba(22, 163, 74, 0.55)",
    targetSwap: "rgba(245, 158, 11, 0.6)",
    ghost: "rgba(236, 195, 137, 0.85)",
  };
  // The lettering on the bricks is Liberation Sans Bold, shipped as Brick Sans
  // with the engraver's wider word spaces (fonts/, and --font-engraved in the
  // stylesheet).
  const FONT = '"Brick Sans", Arial, Helvetica, sans-serif';
  const MAX_SCALE = 110; // screen px per brick unit
  const PAN_ROOM = 16; // how far past the plaza's edges you can move once zoomed in
  const OVERSHOOT = 40; // how far (screen px) a drag can pull the map past its limits
  const ZOOM_GIVE = 0.4; // how far a pinch can push the zoom past its limits (log scale, about a third)
  // Zoom levels (screen px per brick unit) where the lettering changes, on
  // every brick at once: faint bars stand in for the lines, then each last
  // name shows, then the whole engraving.
  const NAMES_AT = 14,
    FULL_AT = 29;
  // Flags are part of the drawing: sized in brick units, so they scale with
  // everything else at every zoom and look the same on every screen. (They only
  // ever reach over the path and lawn, never the bricks.)
  const FLAG = 5.5; // flag height, in brick units
  // The poles, in heights of their flags (Plan.frame's top reaches the tall
  // one's ball).
  const MAIN_POLE = 3.4,
    SIDE_POLE = 2.4;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const JOINT = (px) => clamp(1.4 * px, 0.06, 0.16); // grout line width, in brick units
  // Grout lines and the stand-in lettering fade in between these zooms (screen
  // px per brick unit). Zoomed out further they'd only be clutter.
  const DETAIL_FROM = 7,
    DETAIL_FULL = 12;
  const detailAt = (scale) => clamp((scale - DETAIL_FROM) / (DETAIL_FULL - DETAIL_FROM), 0, 1);
  const TEXTURE = 0.4; // how much the pavers' shades show when zoomed out

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const easeOut = (t) => 1 - (1 - t) ** 3; // starts at once, for springing back
  // Gives way less and less the further it's pushed, and never passes `max`.
  const resist = (x, max) => (max * x) / (x + 2 * max);

  function useFont(ctx, px) {
    ctx.font = `700 ${px}px ${FONT}`;
  }

  // Width of a line of brick text, per 1px of font size.
  const measurer = document.createElement("canvas").getContext("2d");
  useFont(measurer, 100);
  const textWidth = (s) => Math.max(1, measurer.measureText(s).width) / 100;
  // Where a line's ink starts and ends, per 1px of font size, from where
  // it's drawn (left aligned).
  function inkSpan(s) {
    if (!s.trim()) return [0, 0];
    const m = measurer.measureText(s);
    if (m.actualBoundingBoxRight == null) return [0, m.width / 100];
    return [-m.actualBoundingBoxLeft / 100, m.actualBoundingBoxRight / 100];
  }

  // How the lines sit on a 2 × 1 brick, measured off the real ones: capitals
  // 0.1525 tall, lines 0.2375 apart, the block centred, and each line
  // centred. When the longest line would be wider than 1.82, the engraver
  // squeezed every line of that brick by the same amount to fit, but never
  // stretched short ones. A brick can say it was squeezed more (squeeze). Gives the font size, the squeeze and each line's
  // baseline (down from the top edge) and start (from the middle, before
  // squeezing).
  const CAP_EM = 0.688, // height of the capitals, per unit of font size
    LETTER = 0.1525,
    PITCH = 0.2375,
    FIT = 1.82,
    SIZE = LETTER / CAP_EM;
  function engrave(lines, squeeze) {
    const n = lines.length,
      spans = lines.map(inkSpan),
      longest = Math.max(...spans.map(([a, b]) => b - a)) * SIZE,
      top = 0.5 - ((n - 1) * PITCH + LETTER) / 2;
    return {
      size: SIZE,
      squeeze: Math.min(squeeze || 1, 1, FIT / longest),
      lines: lines.map((text, i) => ({
        text,
        baseline: top + i * PITCH + LETTER,
        start: (-(spans[i][0] + spans[i][1]) / 2) * SIZE,
        width: (spans[i][1] - spans[i][0]) * SIZE,
      })),
    };
  }

  // A last name on its own: the same size on every brick, squeezed a little
  // to fit a long one (as the engraver did), and only then made smaller.
  function lastName(text) {
    const natural = textWidth(text) * 0.5,
      squeeze = Math.max(0.72, Math.min(1, 1.8 / natural));
    return { size: Math.min(0.5, 1.8 / (textWidth(text) * squeeze)), squeeze };
  }

  // The layout depends on the font's measurements, so it's worked out again
  // once the font has loaded.
  let fontReady = 0;
  const whenFontLoads = document.fonts?.load(`700 100px ${FONT}`).then(() => {
    useFont(measurer, 100);
    fontReady++;
  });

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
  // official artwork, and for the Air Force the seal flag flown at the post):
  // each at 5:3, like a 3 × 5 ft flag, four to a row in this order. The small
  // sheet loads with the map. The sharp one loads soon after it shows (or the
  // first time a flag is drawn big), before anyone zooms in on a flag.
  const FLAG_ORDER = ["us", "pow", "army", "navy", "air-force", "marines", "coast-guard", "space-force"];
  const FLAG_RATIO = 5 / 3;
  const flagSheets = [
    { src: "img/flags-sm.webp", h: 48, gutter: 2 },
    { src: "img/flags-lg.webp", h: 300, gutter: 4 },
  ];

  // Starts a sheet loading (once), calling `done` when it's in. The promise
  // settles either way.
  function loadFlags(sheet, done) {
    if (sheet.img) return sheet.loaded;
    sheet.img = new Image();
    sheet.loaded = new Promise((resolve) => {
      sheet.img.onload = () => {
        sheet.ready = true;
        done?.();
        resolve();
      };
      sheet.img.onerror = () => resolve();
    });
    sheet.img.src = sheet.src;
    return sheet.loaded;
  }

  // A flag at screen size (x, y, w, h in CSS px; dpr for how sharp it needs
  // to be), flying from a pole at x: rippling in the wind, out to the right
  // (dir 1) or the left (-1, seen from the back, so its mirror image, as the
  // real ones look), and on a still day hanging down at the loose end.
  // `redraw` is called when a sharper picture arrives.
  function drawFlag(ctx, kind, x, y, w, h, dpr, redraw, look = { dir: 1, breeze: 0.6 }) {
    const [small, sharp] = flagSheets,
      big = h * dpr > small.h;
    if (big) loadFlags(sharp, redraw);
    const sheet = big && sharp.ready ? sharp : small.ready ? small : sharp.ready ? sharp : null,
      amp = h * (0.035 + 0.05 * look.breeze),
      droop = h * 0.55 * (1 - look.breeze) ** 2,
      wave = (t) => amp * Math.sin(t * 5.5 + 0.6) * t + droop * t * t,
      n = Math.max(8, Math.min(24, Math.round(w / 5))),
      mirror = look.dir < 0;
    ctx.save();
    ctx.translate(x, y);
    if (mirror) ctx.scale(-1, 1);
    if (sheet) {
      const k = FLAG_ORDER.indexOf(kind),
        sw = Math.round(sheet.h * FLAG_RATIO),
        sx = (k % 4) * (sw + sheet.gutter),
        sy = Math.floor(k / 4) * (sheet.h + sheet.gutter);
      ctx.imageSmoothingQuality = "high";
      for (let i = 0; i < n; i++) {
        const t0 = i / n,
          t1 = (i + 1) / n,
          shade = 0.13 * Math.cos(((t0 + t1) / 2) * 5.5 + 0.6);
        const y0 = wave(t0),
          slope = (wave(t1) - y0) / (w / n);
        ctx.save();
        ctx.transform(1, slope, 0, 1, t0 * w, y0);
        ctx.drawImage(sheet.img, sx + t0 * sw, sy, sw / n, sheet.h, 0, 0, w / n + 0.6, h);
        ctx.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
        ctx.fillRect(0, 0, w / n + 0.6, h);
        ctx.restore();
      }
    } else drawPlainFlag(ctx, kind, 0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(0, wave(0));
    for (let i = 1; i <= n; i++) ctx.lineTo((i / n) * w, wave(i / n));
    for (let i = n; i >= 0; i--) ctx.lineTo((i / n) * w, wave(i / n) + h);
    ctx.closePath();
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = Math.max(0.75, h * 0.03);
    ctx.stroke();
    ctx.restore();
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
        rect("#2143c2", x, y, w, h);
        disc(white, 0.32);
        disc("#0c2f6b", 0.24);
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

  // The same straight onto the canvas, as a new path.
  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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

  // (Always wound the same way, so where two overlap in one path they add up
  // rather than cancel out and leave a hole.)
  function polygon(path, pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i],
        [x1, y1] = pts[(i + 1) % pts.length];
      area += x0 * y1 - x1 * y0;
    }
    if (area < 0) pts = [...pts].reverse();
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
      { axis, arcY, straightWall: sw, entrance: en, monument: m } = S,
      w = Plan.walkway;
    // Everything that stands up, as plain outlines with heights, for shadows.
    const out = { raised: [] };

    // Brick field (clip region): the D, the entrance and the walkway.
    const field = new Path2D();
    polygon(field, Plan.fieldEdge);
    field.rect(en.centre - en.halfWidth, sw.top, 2 * en.halfWidth, sw.bottom - sw.top);
    field.rect(w.left, w.top, w.right - w.left, w.bottom - w.top);
    out.field = field;

    // The gravel bed, and the concrete path around it. At each end the path
    // widens into a square pad that runs down beside the walkway to the lot.
    // The pebbles between the border and the curved wall count as gravel too.
    const wallBack = sw.bottom - 1,
      { OFF } = Plan;
    out.gravel = new Path2D();
    out.gravel.arc(axis, arcY, R.gravelOut, Math.PI, 2 * Math.PI);
    for (const [x, y] of Plan.wallBack) out.gravel.lineTo(x, y);
    out.gravel.closePath();
    polygon(out.gravel, Plan.arcBand(OFF.pebbles, OFF.wall, wallBack, true));
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
    // (Scattered round the centre point, half a degree at a time, between the
    // band's two edges.)
    for (const [r1, r2] of [
      [(d) => Plan.edgeAt(d, false) + OFF.gravel, () => R.gravelOut],
      [(d) => Plan.edgeAt(d) + OFF.pebbles, (d) => Plan.edgeAt(d, false) + OFF.wall],
    ]) {
      let due = 0;
      for (let d = 0; d < 180; d += 0.5) {
        const a = r1(d + 0.25),
          b = r2(d + 0.25);
        for (due += ((Math.PI / 720) * (b * b - a * a)) * 3; due >= 1; due--) {
          const t = ((d + rand() * 0.5) * Math.PI) / 180,
            r = Math.sqrt(a * a + rand() * (b * b - a * a));
          stone(out.ringStones, axis + r * Math.cos(t), arcY - r * Math.sin(t));
        }
      }
    }

    // Walls: the curved one and the two straight ones, which run from its
    // ends to the pillars at the entrance.
    const wallFace = sw.top + 1,
      [leftGate, rightGate] = Plan.gate.map((g) => g.stone),
      straight = [
        [Plan.endPoint(wallBack, OFF.gravel, true)[0] + 1, leftGate.x0],
        [rightGate.x1, Plan.endPoint(wallBack, OFF.gravel, false)[0] - 1],
      ];
    out.wall = new Path2D();
    polygon(out.wall, Plan.arcBand(OFF.wall, OFF.gravel, wallBack));
    out.wallTop = new Path2D();
    polygon(out.wallTop, Plan.arcBand(OFF.wall + 0.9, OFF.gravel - 0.9, wallBack - 0.9));
    for (const [x0, x1] of straight) {
      out.wall.rect(x0, wallFace, x1 - x0, wallBack - wallFace);
      out.raised.push({ h: HEIGHT.wall, pts: rectPts(x0, wallFace, x1, wallBack) });
      out.wallTop.rect(x0, wallFace + 0.9, x1 - x0, wallBack - wallFace - 1.8);
    }

    const band0 = Plan.edgeAt(90, false) + Plan.OFF.wall,
      band1 = Plan.edgeAt(90, false) + Plan.OFF.gravel,
      a0 = (Math.asin((arcY - wallBack) / band1) * 180) / Math.PI;
    for (let d = a0; d < 180 - a0; d += 3) {
      const e = Math.min(180 - a0, d + 3),
        pt = (deg, r) => [axis + r * Math.cos((deg * Math.PI) / 180), arcY - r * Math.sin((deg * Math.PI) / 180)];
      out.raised.push({ h: HEIGHT.wall, pts: [pt(d, band0), pt(d, band1), pt(e, band1), pt(e, band0)] });
    }
    for (const p of Plan.pillars) {
      const c = Math.cos(p.angle),
        s = Math.sin(p.angle),
        h = p.size / 2;
      out.raised.push({
        h: HEIGHT.pillar,
        pts: [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [p.x + x * c - y * s, p.y + x * s + y * c]),
      });
    }
    out.raised.push({ h: HEIGHT.monument, pts: rectPts(m.left + 1, m.top + 1, m.right - 1, m.bottom - 1) });
    // The lamp's concrete footing stands a little above the walk.
    const L = Plan.lamp;
    out.raised.push({
      h: HEIGHT.lampFooting,
      pts: Array.from({ length: 16 }, (_, i) => [L.x + L.footing * Math.cos((i * Math.PI) / 8), L.y + L.footing * Math.sin((i * Math.PI) / 8)]),
    });

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
    out.monumentFlecks = new Path2D();
    for (let i = 0; i < 90; i++) {
      const x = m.left + 1.15 + rand() * (m.right - m.left - 2.3),
        y = m.top + 1.15 + rand() * (m.bottom - m.top - 2.3),
        r = 0.03 + rand() * 0.05;
      out.monumentFlecks.moveTo(x + r, y);
      out.monumentFlecks.arc(x, y, r, 0, 2 * Math.PI);
    }

    // The road behind the plaza: a lane each way with a turn lane between,
    // a white line along each edge, and the turn lane marked the usual way (a
    // solid yellow line along each travel lane, a dashed one inside it). Long
    // enough that its ends never come into view.
    {
      const { origin, along, across, lane, turn } = Plan.road,
        width = 2 * lane + turn,
        at = (s, d) => [origin[0] + along[0] * s + across[0] * d, origin[1] + along[1] * s + across[1] * d],
        band = (path, from, to, s0 = -600, s1 = 600) => polygon(path, [at(s0, from), at(s1, from), at(s1, to), at(s0, to)]);
      out.road = new Path2D();
      band(out.road, -2.5, width + 2.5);
      out.roadWhite = new Path2D();
      band(out.roadWhite, -0.75, 0.75);
      band(out.roadWhite, width - 0.75, width + 0.75);
      out.roadSlush = new Path2D();
      band(out.roadSlush, -2.5, 2.2);
      band(out.roadSlush, width - 2.2, width + 2.5);
      out.roadYellow = new Path2D();
      for (const [solid, dashed] of [
        [lane, lane + 2.4],
        [lane + turn, lane + turn - 2.4],
      ]) {
        band(out.roadYellow, solid - 0.6, solid + 0.6);
        for (let s0 = -600; s0 < 600; s0 += 120) band(out.roadYellow, dashed - 0.6, dashed + 0.6, s0, s0 + 30);
      }
    }

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

    // In snow, the lot is plowed: what the plow can't reach stays packed along
    // the curb (past the wheel stops), heaped higher along the shrubs.
    {
      const [left, right] = Plan.pads,
        wobble = (x) => 0.35 * Math.sin(x * 0.37) + 0.2 * Math.sin(x * 1.13 + 1.7),
        heap = (x) => {
          const out = Math.max(left.left - x, x - right.right, 0),
            t = Math.min(1, Math.max(0, (out - 2) / 8));
          return 4.6 + 3.2 * t * t * (3 - 2 * t) + wobble(x);
        },
        edge = [];
      for (let x = lotLeft; x <= lotRight; x += 2) edge.push([x, lotTop + heap(x)]);
      out.snowBank = new Path2D();
      polygon(out.snowBank, [[lotLeft, Plan.lotY], [lotRight, Plan.lotY], ...edge.reverse()]);
    }

    // Past each pad: a gravel bed with a stone bench in it, then a row of shrubs,
    // each trimmed into its own block, along the lot (six on the left, where
    // the gravel stops too, and running off on the right).
    out.hedges = new Path2D();
    out.hedgeTops = new Path2D();
    out.hedgeRock = new Path2D();
    out.benches = new Path2D();
    const hedgeTop = S.walkway.top + 1,
      hedgeBottom = Plan.lotY,
      depth = hedgeBottom - hedgeTop,
      rockTop = hedgeTop - 1.6,
      { length, gap } = S.shrubs;
    for (const [pad, dir, count] of [
      [Plan.pads[0], -1, S.shrubs.left],
      [Plan.pads[1], 1, Infinity],
    ]) {
      const edge = dir < 0 ? pad.left : pad.right,
        start = edge + dir * S.benchGap,
        run = Math.min(400, count * (length + gap)),
        far = start + dir * run,
        [g0, g1] = [Math.min(edge, far), Math.max(edge, far)];
      out.hedgeRock.rect(g0, rockTop, g1 - g0, hedgeBottom - rockTop);
      scatter(Math.min(edge, start), rockTop, S.benchGap, hedgeBottom - rockTop); // by the bench
      scatter(dir < 0 ? start - Math.min(60, run) : start, rockTop, Math.min(60, run), hedgeTop - rockTop); // along the shrubs
      for (let i = 0; i * (length + gap) < run; i++) {
        const near = start + dir * i * (length + gap),
          x = dir < 0 ? near - length : near;
        scatter(dir < 0 ? x - gap : x + length, hedgeTop, gap, depth); // between two shrubs
        roundedRect(out.hedges, x, hedgeTop, length, depth, 3.2);
        out.raised.push({ h: HEIGHT.hedge, pts: rectPts(x + 0.9, hedgeTop, x + length - 0.9, hedgeBottom) });
        roundedRect(out.hedgeTops, x + 1.4, hedgeTop + 1.4, length - 2.8, depth - 2.8, 2.4);
      }
      // The bench runs alongside the first shrub, as long as the shrubs are deep.
      const middle = edge + (dir * S.benchGap) / 2;
      out.benches.rect(middle - 2, hedgeTop + 0.5, 4, depth - 1);
      out.raised.push({ h: HEIGHT.bench, pts: rectPts(middle - 2, hedgeTop + 0.5, middle + 2, hedgeTop + depth - 0.5) });
    }

    // The plaza itself, walls and walkway included: it stays lit at night.
    out.plaza = new Path2D();
    polygon(out.plaza, [
      ...Plan.wallBack,
      [w.left - 1, arcY],
      [w.left - 1, Plan.lotY],
      [w.right + 1, Plan.lotY],
      [w.right + 1, arcY],
    ]);

    // Red poppies in the stone bed and round the flagpoles, for Memorial Day.
    out.poppies = new Path2D();
    out.poppyHearts = new Path2D();
    const poppy = (x, y) => {
      const r = 0.42 + rand() * 0.14;
      out.poppies.moveTo(x + r, y);
      out.poppies.arc(x, y, r, 0, 2 * Math.PI);
      out.poppyHearts.moveTo(x + 0.13, y);
      out.poppyHearts.arc(x, y, 0.13, 0, 2 * Math.PI);
    };
    for (let i = 0; i < 170; i++) {
      const d = rand() * 180,
        r0 = Plan.edgeAt(d, false) + OFF.gravel + 0.8,
        r1 = R.gravelOut - 0.8,
        r = r0 + rand() * (r1 - r0),
        t = (d * Math.PI) / 180;
      poppy(axis + r * Math.cos(t), arcY - r * Math.sin(t));
    }
    for (const f of Plan.flagpoles)
      for (let i = 0; i < 7; i++) {
        const t = rand() * 2 * Math.PI,
          r = 2.2 + rand() * 1.2;
        poppy(f.x + r * Math.cos(t), f.y + r * Math.sin(t));
      }

    // Round plaques on top of the pillars.
    out.plaques = new Path2D();
    for (const p of Plan.pillars) {
      out.plaques.moveTo(p.x + 1.7, p.y);
      out.plaques.arc(p.x, p.y, 1.7, 0, 2 * Math.PI);
    }
    // The tops of everything that stands up, where tall things' shadows are
    // drawn a second time, over them.
    out.tops = new Path2D();
    for (const { pts } of out.raised) polygon(out.tops, pts);
    return out;
  }

  // Heights (brick units: 1 is 4 inches) of the things that cast shadows,
  // from Street View and the aerial photo: the walls stand 2½ feet, the
  // flagpoles 20 and 35, and the lamp about 21.
  const HEIGHT = { wall: 7.5, pillar: 10, monument: 12, hedge: 9, bench: 5, pole: 60, mainPole: 105, lamp: 63, lampFooting: 5 };
  const LAMP_ARM = 3.2; // from the lamp post to the light
  // How far a shadow reaches for each unit of height: true to the sun while
  // it's high (above about 50°), then held under its height, so early and
  // late shadows don't stretch across the plaza.
  const reach = (cot) => (cot < 0.8 ? cot : 0.8 + 0.2 * Math.tanh((cot - 0.8) / 0.2));

  const rectPts = (x0, y0, x1, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];

  // The smallest convex outline round some points.
  function hull(pts) {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]),
      lower = [],
      upper = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
      lower.push(q);
    }
    for (const q of p.reverse()) {
      while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
      upper.push(q);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  // Shadows for the sun where it is, as an aerial photo shows them: each
  // raised outline swept away from the sun, each flagpole a narrowing strip
  // with its flags rippling beside it (the size they're drawn, so the two
  // match), and the lamp. Two outlines, each filled once, so where shadows
  // cross or join they never darken twice: all of them, for the ground, and
  // the poles', flags' and lamp's again, for the tops of the walls and
  // whatever else they fall across. Built again as the sun moves.
  function buildShadows(S, sky) {
    const { altitude } = sky.sun;
    if (sky.shadow <= 0.02 || altitude < 2) return null;
    const a = (sky.sunOnMap * Math.PI) / 180,
      k = reach(1 / Math.tan((altitude * Math.PI) / 180)),
      sx = -Math.sin(a) * k,
      sy = Math.cos(a) * k,
      // Where the shadow of a point z up falls.
      at = (x, y, z) => [x + sx * z, y + sy * z],
      // Across the shadows.
      nx = -Math.cos(a),
      ny = -Math.sin(a),
      all = new Path2D(),
      high = new Path2D(),
      // Something tall enough to fall across the walls.
      tall = (pts) => {
        polygon(all, pts);
        polygon(high, pts);
      };
    for (const { h, pts } of S.raised) polygon(all, hull([...pts, ...pts.map(([x, y]) => at(x, y, h))]));

    // A pole from `z0` up (0, or the top of what it stands on) to `h`, `w0`
    // wide at the foot and `w1` at the top.
    const pole = (x, y, h, w0, w1, z0 = 0) => {
      const [bx, by] = at(x, y, z0),
        [tx, ty] = at(x, y, h);
      tall([
        [bx + (nx * w0) / 2, by + (ny * w0) / 2],
        [tx + (nx * w1) / 2, ty + (ny * w1) / 2],
        [tx - (nx * w1) / 2, ty - (ny * w1) / 2],
        [bx - (nx * w0) / 2, by - (ny * w0) / 2],
      ]);
    };
    // A flag flying downwind from its pole, top edge `top` up: rippling
    // across the wind, and on a still day sagging at its loose end, as drawn.
    const wind = [Math.sin((sky.windTo * Math.PI) / 180), -Math.cos((sky.windTo * Math.PI) / 180)],
      b = sky.breeze;
    const flag = (x, y, top, hoist, fly) => {
      const n = 14,
        amp = hoist * (0.05 + 0.06 * b),
        droop = hoist * 0.55 * (1 - b) ** 2,
        upper = [],
        lower = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          ripple = amp * Math.sin(t * 5.5 + 0.6) * t,
          sag = droop * t * t,
          px = x + wind[0] * t * fly - wind[1] * ripple,
          py = y + wind[1] * t * fly + wind[0] * ripple;
        upper.push(at(px, py, top - sag));
        lower.push(at(px, py, top - sag - hoist));
      }
      // Strip by strip, so a flag seen edge-on can't fold over itself.
      for (let i = 0; i < n; i++) tall(hull([upper[i], upper[i + 1], lower[i + 1], lower[i]]));
    };
    for (const f of Plan.flagpoles) {
      const h = f.main ? HEIGHT.mainPole : HEIGHT.pole,
        hoist = f.main ? FLAG * 1.2 : FLAG,
        // At half-staff, the flag hangs halfway down.
        top = f.main && sky.halfStaff ? (h + hoist) / 2 : h - 1.5;
      pole(f.x, f.y, h, f.main ? 0.9 : 0.65, 0.05);
      flag(f.x, f.y, top, hoist, hoist * FLAG_RATIO);
      if (f.main) flag(f.x, f.y, top - hoist * 1.06, hoist * 0.85, hoist * 0.85 * FLAG_RATIO);
    }

    // The lamp post, its arm reaching toward the parking lot, and the light.
    const L = Plan.lamp,
      lh = HEIGHT.lamp;
    // (The post stands on its footing, so its shadow starts where the
    // footing's ends.)
    pole(L.x, L.y, lh, 0.9, 0.45, HEIGHT.lampFooting);
    tall(hull(rectPts(L.x - 0.22, L.y, L.x + 0.22, L.y + LAMP_ARM).map(([x, y]) => at(x, y, lh - 0.3))));
    const head = rectPts(L.x - 0.8, L.y + LAMP_ARM, L.x + 0.8, L.y + LAMP_ARM + 2.6);
    tall(hull([...head.map(([x, y]) => at(x, y, lh - 0.3)), ...head.map(([x, y]) => at(x, y, lh - 1.6))]));
    return { all, high };
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
      // The plaza as it is now: sun, season, weather and calendar, checked
      // again each minute.
      this.sky = Sky.state();
      this.shadowsIn = 0; // how far the shadows have faded in
      this.windIn = 0; // and how far the flags have caught the wind
      // The map stays hidden until the flag pictures, the lettering and the
      // weather (for the shadows and the wind) are in, or a moment has gone
      // by, then fades in whole, so nothing pops in by itself. Whatever comes
      // later eases in.
      this.shown = false;
      canvas.parentElement.style.backgroundColor = `rgb(${this.sky.lawn})`;
      const flagsIn = loadFlags(flagSheets[0]).then(() => this.draw()),
        fontIn = whenFontLoads?.then(() => this.draw()),
        weatherIn = Sky.fetchWeather().then(() => {
          this.updateSky();
          this.ease("shadowsIn");
          this.ease("windIn");
        });
      const reveal = () => {
        if (this.shown) return;
        this.shown = true;
        this.render();
        requestAnimationFrame(() => canvas.parentElement.classList.add("is-drawn"));
        // The sharp flag pictures, ready before anyone zooms in on a flag.
        setTimeout(() => loadFlags(flagSheets[1], () => this.draw()), 1500);
      };
      Promise.all([flagsIn, fontIn, weatherIn]).then(reveal);
      setTimeout(reveal, 900);
      setInterval(() => this.updateSky(), 60000);
      requestAnimationFrame(() => this.fireworks());
      this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

      new ResizeObserver(() => this.resize()).observe(canvas);
      this.bindInput();
      this.resize();
    }

    // On the Fourth of July, fireworks over the map (not with reduced
    // motion): half a minute by day, and a few minutes once it's dark. A
    // separate layer, so the map itself isn't redrawn for them.
    fireworks() {
      const sky = this.sky,
        night = sky.sun.altitude < -4,
        shown = (this.fxShown ||= new Set());
      if (this.fx || !sky.fourth || this.reduceMotion.matches || shown.has(night)) return;
      shown.add(night);
      const c = document.createElement("canvas");
      c.setAttribute("aria-hidden", "true");
      c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
      this.canvas.after(c);
      this.fx = c;
      const g = c.getContext("2d"),
        sparks = [],
        // By day, deeper colours with a shadow under each streak, to show on
        // the light ground.
        colors = night ? ["#ff5a6a", "#ffffff", "#6f9bff", "#ffd36b"] : ["#d9243a", "#ffffff", "#2d5fd6", "#f2b632"],
        stopAt = performance.now() + (night ? 3 * 60000 : 30000);
      let last = 0,
        next = 0;
      const frame = (t) => {
        if (document.hidden || t - last < 33) {
          requestAnimationFrame(frame);
          return;
        }
        const dt = last ? Math.min(0.1, (t - last) / 1000) : 0,
          dpr = Math.min(window.devicePixelRatio || 1, 2),
          W = c.clientWidth,
          H = c.clientHeight;
        last = t;
        if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
          c.width = Math.round(W * dpr);
          c.height = Math.round(H * dpr);
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        if (t > next && t < stopAt) {
          const x = W * (0.15 + 0.7 * Math.random()),
            y = H * (0.1 + 0.3 * Math.random()),
            color = colors[Math.floor(Math.random() * colors.length)];
          for (let i = 0; i < 56; i++) {
            const a = (i / 56) * 2 * Math.PI + Math.random() * 0.1,
              v = 70 + Math.random() * 80;
            sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color });
          }
          next = t + 700 + Math.random() * 1100;
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i];
          p.vy += 55 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt / 1.7;
          if (p.life <= 0) {
            sparks.splice(i, 1);
            continue;
          }
          const x0 = p.x - p.vx * 0.06,
            y0 = p.y - p.vy * 0.06;
          g.globalAlpha = Math.min(1, p.life * 1.3);
          if (!night) {
            g.strokeStyle = "rgba(20, 24, 34, 0.35)";
            g.lineWidth = 2.6;
            g.beginPath();
            g.moveTo(x0 + 2, y0 + 3);
            g.lineTo(p.x + 2, p.y + 3);
            g.stroke();
          }
          g.strokeStyle = p.color;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(p.x, p.y);
          g.stroke();
        }
        g.globalAlpha = 1;
        if (t > stopAt && !sparks.length) {
          c.remove();
          this.fx = null;
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    // Brings `shadowsIn` or `windIn` up to 1: at once while the map is still
    // hidden, or gently once it shows.
    ease(key) {
      if (!this.shown || this.reduceMotion.matches) {
        this[key] = 1;
        this.draw();
        return;
      }
      const start = performance.now();
      const step = (t) => {
        this[key] = easeOut(Math.min(1, (t - start) / 900));
        this.draw();
        if (this[key] < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    updateSky() {
      const next = Sky.state(),
        was = this.sky;
      this.sky = next;
      if (
        Math.abs(next.sun.azimuth - was.sun.azimuth) > 0.5 ||
        Math.abs(next.sun.altitude - was.sun.altitude) > 0.3 ||
        next.windTo !== was.windTo ||
        next.halfStaff !== was.halfStaff ||
        next.shadow !== was.shadow
      )
        this.shadows = undefined;
      this.draw();
      this.fireworks();
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

    // How far out the whole-plaza view is: the frame fits the free part of
    // the screen, and it zooms out a little more if need be (at most 15%) so
    // the bricks sit right in the middle, with the flags still in view above
    // them. Not on a phone turned sideways, where every bit of height counts.
    fitScale(angle = this.view.angle) {
      const f = Plan.frame,
        [cx, cy] = Plan.centre,
        c = Math.abs(Math.cos(angle)),
        s = Math.abs(Math.sin(angle)),
        i = this.insets,
        aw = Math.max(60, this.size.w - i.left - i.right),
        ah = Math.max(60, this.size.h - i.top - i.bottom),
        across = (w, h) => aw / (w * c + h * s),
        down = (w, h) => ah / (w * s + h * c),
        w = f.right - f.left,
        h = f.bottom - f.top,
        tight = Math.min(across(w, h), down(w, h));
      if (ah < 480) return tight;
      const ew = 2 * Math.max(cx - f.left, f.right - cx),
        eh = 2 * Math.max(cy - f.top, f.bottom - cy);
      return Math.max(Math.min(across(ew, eh), down(ew, eh)), tight * 0.85);
    }

    // Half of what the free part of the screen shows at `v`, across and down
    // (in world units, around its middle).
    halfSeen(v) {
      const i = this.insets,
        c = Math.abs(Math.cos(v.angle)),
        s = Math.abs(Math.sin(v.angle)),
        seenW = Math.max(1, this.size.w - i.left - i.right) / v.scale,
        seenH = Math.max(1, this.size.h - i.top - i.bottom) / v.scale;
      return [(seenW * c + seenH * s) / 2, (seenW * s + seenH * c) / 2];
    }

    // What the whole-plaza view shows: the frame, and on a screen shaped
    // differently from it the room beside or below it too, centred on the
    // plaza as far as the frame allows.
    fitRect(angle = this.view.angle) {
      const f = Plan.frame,
        [hx, hy] = this.halfSeen({ angle, scale: this.fitScale(angle) }),
        [cx, cy] = Plan.centre,
        x = clamp(cx, f.right - hx, f.left + hx),
        y = clamp(cy, f.bottom - hy, f.top + hy);
      return { left: x - hx, right: x + hx, top: y - hy, bottom: y + hy };
    }

    fitView(angle = this.view.angle) {
      const v = { x: 0, y: 0, angle, scale: this.fitScale(angle) };
      return this.clampView(this.placeWorldAt(v, Plan.centre, this.focusPoint()));
    }

    // The limits: you can't zoom out past the whole plaza, and the map can
    // only show what the whole-plaza view shows, plus a little room that
    // grows as you zoom in. All the way out it's held in the middle, so it
    // springs back there after a drag and settles there when zoomed back out.
    // Zooming in never has to move it, since what's in view only shrinks.
    // With keepScale the zoom is left alone and only the position is fixed.
    clampView(v = this.view, keepScale = false) {
      const fitScale = this.fitScale(v.angle);
      if (!keepScale) v.scale = clamp(v.scale, fitScale, MAX_SCALE);
      const room = PAN_ROOM * clamp(v.scale / fitScale - 1, 0, 1),
        b = this.fitRect(v.angle),
        [hx, hy] = this.halfSeen(v),
        // Pulled out past the whole plaza (mid-pinch), it stays in the middle.
        limit = (value, lo, hi, half) =>
          lo + half - room > hi - half + room ? (lo + hi) / 2 : clamp(value, lo + half - room, hi - half + room),
        focus = this.focusPoint(),
        [x, y] = this.screenToWorld(...focus, v);
      return this.placeWorldAt(v, [limit(x, b.left, b.right, hx), limit(y, b.top, b.bottom, hy)], focus);
    }

    // While a finger is down the map can be pulled a little way past its
    // limits, harder the further it goes, and settle() springs it back after.
    soften(raw) {
      const fitScale = this.fitScale(raw.angle),
        focus = this.focusPoint(),
        target = this.screenToWorld(...focus, raw),
        v = { ...raw };
      if (v.scale < fitScale) v.scale = fitScale * Math.exp(-resist(Math.log(fitScale / v.scale), ZOOM_GIVE));
      if (v.scale > MAX_SCALE) v.scale = MAX_SCALE * Math.exp(resist(Math.log(v.scale / MAX_SCALE), ZOOM_GIVE));
      this.placeWorldAt(v, target, focus);
      const [hx, hy] = this.screenToWorld(...focus, this.clampView({ ...v }, true)),
        pull = (d) => (Math.sign(d) * resist(Math.abs(d) * v.scale, OVERSHOOT)) / v.scale;
      return this.placeWorldAt(v, [hx + pull(target[0] - hx), hy + pull(target[1] - hy)], focus);
    }

    // The zoom soften() gives way to, worked back: so a pinch that starts
    // while the map is still springing back carries on from where it is.
    unsoften(v) {
      const fitScale = this.fitScale(v.angle),
        focus = this.focusPoint(),
        target = this.screenToWorld(...focus, v),
        give = (x) => (2 * ZOOM_GIVE * x) / (ZOOM_GIVE - Math.min(x, ZOOM_GIVE * 0.98)),
        out = { ...v };
      if (v.scale < fitScale) out.scale = fitScale * Math.exp(-give(Math.log(fitScale / v.scale)));
      if (v.scale > MAX_SCALE) out.scale = MAX_SCALE * Math.exp(give(Math.log(v.scale / MAX_SCALE)));
      return this.placeWorldAt(out, target, focus);
    }

    settle() {
      const target = this.clampView({ ...this.view });
      if (Math.abs(target.scale - this.fitScale()) < 1e-6) {
        this.isFit = true;
        if (this.pendingInsets) {
          this.fit(true, 260);
          return true;
        }
      }
      const moved =
        Math.abs(target.x - this.view.x) + Math.abs(target.y - this.view.y) > 1e-3 ||
        Math.abs(target.scale - this.view.scale) > 1e-3;
      if (moved) this.animateTo(target, 320, easeOut);
      else this.adoptInsets();
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

    // The panels over the map changed (a card opened, folded or closed). With
    // the whole plaza showing, it's reframed for them. A panel making room
    // mustn't make the map jump, though (say a card folding away as a pinch
    // starts), so then the new room is only taken on once that wouldn't move
    // the map: with no fingers down and nothing moving, or the next time the
    // whole plaza is shown.
    setInsets(insets, animate = true) {
      const keys = Object.keys(insets),
        changed = keys.some((k) => insets[k] !== this.insets[k]),
        roomier = keys.every((k) => insets[k] <= this.insets[k]);
      this.pendingInsets = null;
      if (!changed) return;
      if (this.pointers.size || (roomier && !this.isFit)) {
        this.pendingInsets = { ...insets };
        this.adoptInsets();
        return;
      }
      Object.assign(this.insets, insets);
      if (this.isFit) this.animateTo(this.fitView(), animate ? 250 : 0);
    }

    // Takes on held-back insets, if that won't move the map.
    adoptInsets() {
      if (!this.pendingInsets || this.pointers.size || this.anim) return;
      const held = { ...this.insets };
      Object.assign(this.insets, this.pendingInsets);
      const v = this.clampView({ ...this.view }),
        moved =
          Math.abs(v.x - this.view.x) + Math.abs(v.y - this.view.y) > 1e-3 || Math.abs(v.scale - this.view.scale) > 1e-3;
      if (moved) Object.assign(this.insets, held);
      else this.pendingInsets = null;
    }

    stop() {
      cancelAnimationFrame(this.anim);
      this.anim = 0;
    }

    animateTo(target, duration = 600, easing = ease) {
      this.stop();
      this.clampView(target);
      this.goal = target; // where it's heading, for a zoom that comes mid-way
      if (this.reduceMotion.matches || duration <= 0) {
        Object.assign(this.view, target);
        this.draw();
        this.adoptInsets();
        return;
      }
      const from = { ...this.view },
        start = performance.now();
      const step = (now) => {
        const t = easing(Math.min(1, (now - start) / duration));
        this.view.x = from.x + (target.x - from.x) * t;
        this.view.y = from.y + (target.y - from.y) * t;
        this.view.scale = Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * t);
        this.view.angle = from.angle + (target.angle - from.angle) * t;
        this.render();
        this.anim = t < 1 ? requestAnimationFrame(step) : 0;
        if (!this.anim) this.adoptInsets();
      };
      this.anim = requestAnimationFrame(step);
    }

    // The whole plaza, framed for the panels as they are now.
    fit(animate = true, duration = 500) {
      if (this.pendingInsets) Object.assign(this.insets, this.pendingInsets);
      this.pendingInsets = null;
      this.isFit = true;
      this.animateTo(this.fitView(), animate ? duration : 0);
    }

    // An animated zoom that comes while the last one is still going carries on
    // from where that one was heading, so two quick taps make two whole steps.
    zoomFrom(animate) {
      return animate && this.anim ? this.goal : this.view;
    }

    zoomAt(sx, sy, factor, animate = false) {
      const from = this.zoomFrom(animate),
        v = { ...from };
      const atLimit = factor < 1 ? from.scale <= this.fitScale() * 1.001 : from.scale >= MAX_SCALE * 0.999;
      if (animate && atLimit) return this.bounce(sx, sy, factor < 1 ? 0.85 : 1.15);
      const anchor = this.screenToWorld(sx, sy, from);
      v.scale = clamp(v.scale * factor, this.fitScale(), MAX_SCALE);
      this.placeWorldAt(v, anchor, [sx, sy]);
      this.isFit = Math.abs(v.scale - this.fitScale()) < 1e-6;
      if (this.isFit && this.pendingInsets) return this.fit(animate, 250);
      if (animate) this.animateTo(v, 250);
      else {
        Object.assign(this.view, this.clampView(v));
        this.draw();
      }
    }

    // Nudges the zoom a little way past its limit and lets it spring back, so
    // a button that can't go any further still answers.
    bounce(sx, sy, factor) {
      if (this.reduceMotion.matches) return;
      this.stop();
      const from = { ...this.view },
        anchor = this.screenToWorld(sx, sy, from),
        peek = this.placeWorldAt({ ...from, scale: from.scale * factor }, anchor, [sx, sy]),
        start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / 420),
          k = Math.sin(Math.PI * Math.min(1, t * 1.25)) * (1 - t);
        this.view.x = from.x + (peek.x - from.x) * k;
        this.view.y = from.y + (peek.y - from.y) * k;
        this.view.scale = from.scale * (peek.scale / from.scale) ** k;
        this.render();
        this.anim = t < 1 ? requestAnimationFrame(step) : 0;
        if (!this.anim) Object.assign(this.view, from);
      };
      this.anim = requestAnimationFrame(step);
    }

    // Zooms on the middle of the map, or on a brick when it's in sight, so
    // the brick stays put while everything grows around it.
    zoomBy(factor, slot = null) {
      let [x, y] = this.focusPoint();
      if (slot) {
        const [sx, sy] = this.worldToScreen(slot.x + slot.w / 2, slot.y + slot.h / 2, this.zoomFrom(true)),
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
      if (this.isFit && this.pendingInsets) Object.assign(this.insets, this.pendingInsets);
      if (this.isFit) this.pendingInsets = null;
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

      const sky = this.sky,
        snow = sky.snow;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = snow ? C.snow : `rgb(${sky.lawn})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.worldTransform();
      ctx.lineJoin = "round";

      // The road
      ctx.fillStyle = C.road;
      ctx.fill(S.road);
      ctx.fillStyle = C.lotLine;
      ctx.fill(S.roadWhite);
      ctx.fillStyle = C.roadYellow;
      ctx.fill(S.roadYellow);
      if (snow) {
        ctx.fillStyle = "rgba(236, 240, 244, 0.8)";
        ctx.fill(S.roadSlush);
      }

      // Parking lot (in snow, plowed and salted: paler, the lines half
      // buried, snow along the curb and on the wheel stops)
      ctx.fillStyle = C.concrete;
      ctx.fill(S.lotCurb);
      ctx.fillStyle = C.lot;
      ctx.fill(S.lot);
      if (snow) {
        ctx.fillStyle = "rgba(236, 240, 244, 0.14)";
        ctx.fill(S.lot);
        ctx.globalAlpha = 0.45;
      }
      ctx.strokeStyle = C.lotLine;
      ctx.lineWidth = 0.9;
      ctx.stroke(S.lotLines);
      ctx.globalAlpha = 1;
      if (snow) {
        ctx.fillStyle = C.snow;
        ctx.fill(S.snowBank);
        ctx.strokeStyle = C.snowEdge;
        ctx.lineWidth = Math.max(px, 0.25);
        ctx.stroke(S.snowBank);
      }
      ctx.fillStyle = snow ? C.snow : C.concrete;
      ctx.fill(S.wheelStops);
      ctx.strokeStyle = C.concreteLine;
      ctx.lineWidth = Math.max(px, 0.1);
      ctx.stroke(S.wheelStops);

      // Gravel beds beside the walkway (the shrubs on them come later). The
      // stones in the gravel fade in as the map zooms in.
      const stones = snow ? 0 : clamp((scale - 2.4) / 2, 0, 1);
      ctx.fillStyle = snow ? C.snowGravel : C.gravel;
      ctx.fill(S.hedgeRock);
      if (stones) {
        ctx.globalAlpha = stones;
        this.drawStones(S.bedStones);
        ctx.globalAlpha = 1;
      }

      // Curb and gravel rings
      ctx.fillStyle = C.concrete;
      ctx.fill(S.curb);
      ctx.fillStyle = snow ? C.snowGravel : C.gravel;
      ctx.fill(S.gravel);
      if (stones) {
        ctx.save();
        ctx.clip(S.gravel); // so no stone pokes out over the path
        ctx.globalAlpha = stones;
        this.drawStones(S.ringStones);
        ctx.restore();
      }

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

      this.drawNamed(vis);

      // Poppies in the stone bed for Memorial Day.
      if (sky.poppies && !snow) {
        ctx.fillStyle = C.poppy;
        ctx.fill(S.poppies);
        ctx.fillStyle = C.poppyHeart;
        ctx.fill(S.poppyHearts);
      }

      // Shadows, while the sun's up: first on the ground, under everything
      // that stands up.
      if (this.shadows === undefined) this.shadows = buildShadows(S, sky);
      this.drawShadows(false);

      // The shrubs on their beds, and the benches
      ctx.fillStyle = C.hedge;
      ctx.fill(S.hedges);
      ctx.fillStyle = snow ? C.snow : C.hedgeTop;
      ctx.fill(S.hedgeTops);
      ctx.strokeStyle = C.hedgeEdge;
      ctx.lineWidth = Math.max(px, 0.15);
      ctx.stroke(S.hedges);
      ctx.fillStyle = snow ? C.snow : C.bench;
      ctx.fill(S.benches);
      ctx.strokeStyle = C.benchEdge;
      ctx.lineWidth = Math.max(px, 0.14);
      ctx.stroke(S.benches);

      // Walls and pillars
      ctx.fillStyle = C.wall;
      ctx.fill(S.wall);
      ctx.fillStyle = snow ? C.snow : C.wallTop;
      ctx.fill(S.wallTop);
      ctx.strokeStyle = C.wallEdge;
      ctx.lineWidth = Math.max(px, 0.1);
      ctx.stroke(S.wall);
      ctx.fillStyle = C.pillar;
      ctx.fill(S.pillars);
      ctx.fillStyle = snow ? C.snow : C.pillarCap;
      ctx.fill(S.pillarCaps);
      ctx.stroke(S.pillars);
      ctx.fillStyle = C.plaque;
      ctx.fill(S.plaques);
      ctx.strokeStyle = C.plaqueRim;
      ctx.lineWidth = Math.max(px, 0.22);
      ctx.stroke(S.plaques);
      if (sky.wreaths) for (const p of Plan.pillars) this.drawWreath(p.x, p.y, 1.95);

      // Monument
      ctx.fillStyle = C.granite;
      ctx.fill(S.monumentStone);
      ctx.fillStyle = C.graniteFleck;
      ctx.globalAlpha = 0.55;
      ctx.fill(S.monumentFlecks);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.graniteEdge;
      ctx.lineWidth = Math.max(px, 0.08);
      ctx.stroke(S.monumentStone);
      if (sky.monumentWreath) {
        const m = Plan.SHAPE.monument;
        this.drawWreath((m.left + m.right) / 2, m.bottom - 2.3, 0.85);
      }

      // Then the poles', flags' and lamp's again, on the walls they cross.
      this.drawShadows(true);

      this.drawLight(vis);
      this.drawEditOverlays();
      this.drawFlagpoles();
      this.drawText();
      this.placeMarker();

      const zoomedOut = scale <= this.fitScale() * 1.001;
      if (zoomedOut !== this.zoomedOut) {
        this.zoomedOut = zoomedOut;
        this.cb.onZoomedOut?.(zoomedOut);
      }
      const zoomedIn = scale >= MAX_SCALE * 0.999;
      if (zoomedIn !== this.zoomedIn) {
        this.zoomedIn = zoomedIn;
        this.cb.onZoomedIn?.(zoomedIn);
      }
    }

    // Shadows from buildShadows(): all of them on the ground, under the walls
    // and everything else that stands up, or (`high`) the poles', flags' and
    // lamp's on top of those things.
    drawShadows(high) {
      const { ctx, sky } = this,
        s = this.shadows;
      if (!s || this.shadowsIn <= 0) return;
      ctx.fillStyle = `rgba(20, 24, 34, ${0.19 * sky.shadow * this.shadowsIn})`;
      if (!high) {
        ctx.fill(s.all);
        return;
      }
      ctx.save();
      ctx.clip(this.static.tops);
      ctx.fill(s.high);
      ctx.restore();
    }

    // The hour of the day: warm light near sunrise and sunset, and at night
    // everything round the plaza goes dark while the plaza stays softly lit,
    // with the lamp and the flags' lights on. The lettering is drawn after,
    // so it reads the same at any hour.
    drawLight(vis) {
      const { ctx, static: S, sky } = this,
        night = 1 - sky.light,
        L = Plan.lamp;
      if (sky.golden > 0) {
        ctx.fillStyle = `rgba(255, 170, 80, ${0.07 * sky.golden})`;
        ctx.fillRect(vis.x0, vis.y0, vis.x1 - vis.x0, vis.y1 - vis.y0);
      }
      if (night <= 0.02) return;
      const outside = new Path2D();
      outside.rect(vis.x0 - 10, vis.y0 - 10, vis.x1 - vis.x0 + 20, vis.y1 - vis.y0 + 20);
      outside.addPath(S.plaza);
      ctx.fillStyle = `rgba(${C.night}, ${0.48 * night})`;
      ctx.fill(outside, "evenodd");
      ctx.fillStyle = `rgba(${C.night}, ${0.13 * night})`;
      ctx.fill(S.plaza);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const glow = (x, y, r, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255, 214, 150, ${a})`);
        g.addColorStop(1, "rgba(255, 214, 150, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      };
      glow(L.x, L.y + 5, 18, 0.55 * night);
      for (const f of Plan.flagpoles) glow(f.x, f.y, 5, 0.5 * night);
      ctx.restore();
    }

    // A Christmas (or remembrance) wreath, from above, with a red bow.
    drawWreath(x, y, r) {
      const { ctx } = this;
      ctx.lineWidth = r * 0.45;
      ctx.strokeStyle = C.wreath;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.lineWidth = r * 0.14;
      ctx.strokeStyle = C.wreathLight;
      ctx.setLineDash([r * 0.18, r * 0.22]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.bow;
      const b = y + r,
        s = r * 0.42;
      ctx.beginPath();
      ctx.moveTo(x, b);
      ctx.lineTo(x - s, b - s * 0.6);
      ctx.lineTo(x - s, b + s * 0.6);
      ctx.closePath();
      ctx.moveTo(x, b);
      ctx.lineTo(x + s, b - s * 0.6);
      ctx.lineTo(x + s, b + s * 0.6);
      ctx.closePath();
      ctx.moveTo(x, b);
      ctx.lineTo(x - s * 0.5, b + s * 1.4);
      ctx.lineTo(x - s * 0.15, b + s * 1.4);
      ctx.closePath();
      ctx.moveTo(x, b);
      ctx.lineTo(x + s * 0.5, b + s * 1.4);
      ctx.lineTo(x + s * 0.15, b + s * 1.4);
      ctx.closePath();
      ctx.fill();
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
      // The lamp post, from above: its footing (painted yellow), the post, and
      // the arm reaching out toward the parking lot with the light on its end.
      // The arm and light are high over two engraved bricks, so they fade
      // away as the names come into view, leaving the footing.
      const L = Plan.lamp,
        armEnd = L.y + LAMP_ARM,
        overhead = 1 - clamp((scale - DETAIL_FROM) / (DETAIL_FULL - DETAIL_FROM), 0, 1);
      ctx.beginPath();
      ctx.arc(L.x, L.y, L.footing, 0, 2 * Math.PI);
      ctx.fillStyle = C.lampFooting;
      ctx.fill();
      ctx.strokeStyle = C.lampFootingEdge;
      ctx.lineWidth = Math.max(1 / scale, 0.12);
      ctx.stroke();
      if (overhead > 0) {
        ctx.globalAlpha = overhead;
        ctx.strokeStyle = C.lampPost;
        ctx.lineWidth = 0.45;
        ctx.beginPath();
        ctx.moveTo(L.x, L.y);
        ctx.lineTo(L.x, armEnd);
        ctx.stroke();
        roundedRectPath(ctx, L.x - 0.8, armEnd, 1.6, 2.6, 0.35);
        ctx.fillStyle = C.lampPost;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(L.x, L.y, 0.55, 0, 2 * Math.PI);
      ctx.fillStyle = C.lampPost;
      ctx.fill();

      // Little flags, drawn upright on screen whichever way the map is turned.
      // The tall centre pole flies the US flag with the POW/MIA flag under it.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // They fly downwind (to the right until the weather's known), and on
      // the flag code's half-staff days the centre pole's flags are lowered.
      const fh = FLAG * scale, // in screen px
        sky = this.sky,
        across = Math.sin(((sky.windTo * Math.PI) / 180) + this.view.angle),
        look = { dir: across < -0.1 ? -1 : 1, breeze: sky.breeze * this.windIn },
        // Blowing up or down the screen, the flags are seen a little edge-on.
        span = 0.8 + 0.2 * Math.abs(across);
      for (const f of Plan.flagpoles) {
        // The tall pole has room to lower both its flags to half-staff and
        // still show pole above and below them.
        const [x, y] = this.worldToScreen(f.x, f.y),
          height = f.main ? fh * 1.2 : fh,
          poleTop = y - height * (f.main ? MAIN_POLE : SIDE_POLE),
          top = f.main && sky.halfStaff ? poleTop + height * 1.1 : poleTop,
          fw = height * FLAG_RATIO * span,
          redraw = () => this.draw();
        // A satin aluminum pole: a darker edge with a bright line down it.
        const pw = Math.max(1.4, 0.26 * scale);
        ctx.strokeStyle = C.poleEdge;
        ctx.lineWidth = pw;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, poleTop);
        ctx.stroke();
        ctx.strokeStyle = C.poleShine;
        ctx.lineWidth = pw * 0.45;
        ctx.beginPath();
        ctx.moveTo(x - pw * 0.12, y);
        ctx.lineTo(x - pw * 0.12, poleTop);
        ctx.stroke();
        ctx.fillStyle = C.finial;
        ctx.beginPath();
        ctx.arc(x, poleTop - Math.max(1.2, height * 0.07), Math.max(1.3, height * 0.09), 0, 2 * Math.PI);
        ctx.fill();
        drawFlag(ctx, f.flag, x + 0.6 * look.dir, top, fw, height, dpr, redraw, look);
        if (f.main)
          drawFlag(ctx, "pow", x + 0.6 * look.dir, top + height * 1.06, fw * 0.85, height * 0.85, dpr, redraw, look);
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
      ctx.textBaseline = "alphabetic";
      const ramp = (a, b) => {
          const t = Math.min(1, Math.max(0, (scale - a) / (b - a)));
          return t * t * (3 - 2 * t);
        },
        full = ramp(FULL_AT - 3.5, FULL_AT + 0.5),
        names = ramp(NAMES_AT - 2.5, NAMES_AT + 0.5) * (1 - ramp(FULL_AT - 4, FULL_AT - 0.5)),
        bars = 1 - ramp(NAMES_AT - 3, NAMES_AT);
      for (const b of this.visibleNamed) {
        const fit = this.fitText(b),
          { size, squeeze, lines } = fit.full,
          p = b.slot,
          [sx, sy] = this.worldToScreen(p.x + p.w / 2, p.y + p.h / 2),
          angle = this.view.angle + (p.vertical ? -Math.PI / 2 : 0) + (b.flip ? Math.PI : 0),
          c = Math.cos(angle),
          s = Math.sin(angle);
        // Screen px, from the middle of the brick, turned to read along it.
        ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, sx * dpr, sy * dpr);
        ctx.fillStyle = b.color === "gray" ? C.inkGray : C.ink;
        ctx.globalAlpha = b.id === this.scene.selectedId ? 1 : 0.85;
        const strength = ctx.globalAlpha;
        // Faint bars for the lines, then the last name, then the whole
        // engraving, each fading into the next as the map zooms.
        if (bars > 0.01) {
          ctx.globalAlpha = 0.3 * detail * bars;
          const cap = LETTER * scale,
            thick = Math.max(0.8, cap * 0.6);
          for (const l of lines) {
            const w = l.width * squeeze * scale;
            ctx.fillRect(-w / 2, (l.baseline - 0.5) * scale - cap / 2 - thick / 2, w, thick);
          }
        }
        if (names > 0.01) {
          const { size: s2, squeeze: k } = fit.short;
          ctx.save();
          ctx.globalAlpha = strength * names;
          useFont(ctx, s2 * scale);
          ctx.textAlign = "center";
          ctx.transform(k, 0, 0, 1, 0, 0);
          ctx.fillText(fit.shortText, 0, (CAP_EM * s2 * scale) / 2);
          ctx.restore();
        }
        if (full > 0.01) {
          ctx.globalAlpha = strength * full;
          useFont(ctx, size * scale);
          ctx.textAlign = "left";
          ctx.transform(squeeze, 0, 0, 1, 0, 0);
          for (const l of lines) ctx.fillText(l.text, l.start * scale, (l.baseline - 0.5) * scale);
        }
      }
      ctx.globalAlpha = 1;
      this.worldTransform();
    }

    // A brick's engraving layout, cached per brick.
    fitText(b) {
      const lines = Model.engraving(b),
        key = `${lines.join("\n")}|${b.squeeze || ""}|${fontReady}`;
      if (b._fit?.key === key) return b._fit;
      const shortText = b.last || b.first || "";
      b._fit = {
        key,
        lines,
        full: engrave(lines, b.squeeze),
        short: lastName(shortText),
        shortText,
      };
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
      // Safari's trackpad pinch comes as gestures, which say when the fingers
      // lift, so the zoom can give for exactly as long as they're down.
      for (const [type, phase] of [
        ["gesturestart", "start"],
        ["gesturechange", "change"],
        ["gestureend", "end"],
      ])
        c.addEventListener(type, (e) => this.gesture(e, phase), { passive: false });
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
          view: this.raw ? { ...this.raw } : this.unsoften(this.view),
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
      this.release(e, cancelled);
      if (!this.pointers.size) this.adoptInsets();
    }

    release(e, cancelled) {
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
        if (!this.anim) this.adoptInsets();
      };
      this.anim = requestAnimationFrame(step);
    }

    // A trackpad pinch in Safari (on a phone, pinches come as pointers).
    gesture(e, phase) {
      if (this.pointers.size) return;
      e.preventDefault();
      if (phase === "start") {
        this.stop();
        clearTimeout(this.wheelTimer);
        this.wheelRaw = null;
        this.gestureFrom = { view: this.unsoften(this.view), at: this.pos(e) };
      } else if (phase === "change" && this.gestureFrom) {
        const { view, at } = this.gestureFrom,
          anchor = this.screenToWorld(...at, view),
          v = { ...view, scale: clamp(view.scale * e.scale, this.fitScale() * 0.3, MAX_SCALE * 3) };
        Object.assign(this.view, this.soften(this.placeWorldAt(v, anchor, at)));
        this.isFit = false;
        this.draw();
        this.cb.onUserMove?.();
      } else if (phase === "end" && this.gestureFrom) {
        this.gestureFrom = null;
        this.settle();
      }
    }

    wheel(e) {
      e.preventDefault();
      if (this.gestureFrom) return; // Safari sends its pinch as gestures too
      this.stop();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= this.size.h;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025));
      const [x, y] = this.pos(e),
        from = this.wheelRaw || this.unsoften(this.view),
        anchor = this.screenToWorld(x, y, from),
        fitScale = this.fitScale(),
        v = { ...from, scale: clamp(from.scale * factor, fitScale * 0.3, MAX_SCALE * 3) };
      this.wheelRaw = this.placeWorldAt(v, anchor, [x, y]);
      Object.assign(this.view, this.soften(this.wheelRaw));
      this.isFit = false;
      this.draw();
      clearTimeout(this.wheelTimer);
      // A wheel can't say when the fingers lift, so it springs back once the
      // scrolling stops. A trackpad pinch in Chrome comes as a wheel with
      // ctrl held, so fingers resting mid-pinch get a longer pause first.
      this.wheelTimer = setTimeout(
        () => {
          this.wheelRaw = null;
          this.settle();
        },
        e.ctrlKey ? 260 : 110,
      );
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
  MapView.whenFontLoads = whenFontLoads;
  return MapView;
})();
