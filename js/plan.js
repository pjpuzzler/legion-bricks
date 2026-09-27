/*
 * plan.js: the physical layout of the memorial plaza.
 *
 * Measurements are in "brick units": 1 unit is the short side of a paver
 * (about 4 inches), so every paver is 2 × 1 units. x runs left to right and y
 * runs top to bottom, as seen walking in from the parking lot: the curved wall
 * and flagpoles are at the top, the walkway along the lot is at the bottom.
 *
 * Bricks are addressed as "row-col" on the herringbone grid (see paverAt).
 * If the drawing needs nudging to match the real memorial, SHAPE is the place
 * to do it. Changing the herringbone itself would move every brick.
 */
const Plan = (() => {
  const SHAPE = {
    // Measured off a walk-through video of the plaza (every brick and edge was
    // located on the herringbone itself), except the wall, gravel and curb
    // widths past the border, which the video didn't show.
    axis: 73.6, // centre line of the entrance, through the curved wall's centre point
    arcY: 65.4, // centre point of the curved wall
    // The gray border along the curved wall isn't quite round: it's a little
    // flatter on the left. Where the bricks stop, as [angle, distance from the
    // centre point] every 10°, a smooth curve through the edge traced off the
    // video. 0° is the right end of the arc and 90° the top.
    edge: [
      [0, 67.2], [10, 66], [20, 65.3], [30, 65.2], [40, 65.4], [50, 65.7], [60, 66], [70, 66.1], [80, 66],
      [90, 65.6], [100, 64.9], [110, 64.1], [120, 63.3], [130, 62.8], [140, 62.6], [150, 63], [160, 64.1],
      [170, 66], [180, 65.4],
    ],
    border: 1, // gray border pavers
    pebbles: 1.2, // strip of pebbles between the border and the curved wall
    wall: 3, // stone wall
    gravelRadius: 78.6, // outer edge of the stone bed with the lights, a circle round the centre point
    curb: 5, // concrete ring the flagpoles stand on
    straightWall: { top: 58.95, bottom: 64.05 }, // includes a border row on each side
    // The entrance: its centre line (a little left of the curved wall's), half
    // the opening between the pillars' border pavers, and the pillars' middle.
    entrance: { centre: 73.2, halfWidth: 30.2, pillarY: 61 },
    pillar: 6, // stone pillars
    // Pillars in the curved wall (degrees). The border steps in around the
    // front of each one, with pebbles (pillarGap wide) between it and the pillar.
    arcPillars: [52.6, 90, 127.4],
    notch: { width: 9, depth: 1.2 },
    pillarGap: 0.7,
    walkway: { left: 3.05, right: 146, top: 64.05, bottom: 78.95 }, // along the parking lot
    // The lamp post at the right end of the walkway, on a round footing set
    // in among the bricks (its middle, and the footing's radius).
    lamp: { x: 125.25, y: 70.25, footing: 1.75 },
    // The monument sits a little right of the centre line. Includes its border.
    monument: { left: 72.05, top: 37.4, right: 81.05, bottom: 42 },
    // Flagpoles around the curb (degrees; 0° is the right end of the arc, next
    // to the bench).
    flagpoles: [
      [0, "army"],
      [30, "space-force"],
      [60, "air-force"],
      [90, "us"], // the tall one, with the POW/MIA flag under the US flag
      [120, "marines"],
      [150, "coast-guard"],
      [180, "navy"],
    ],
    benchGap: 7, // gravel between each pad and the first shrub, where the bench sits
    // The shrubs along the lot are trimmed into separate blocks. On the left
    // there are six, and past them the gravel stops too and it's just grass.
    // On the right they run on.
    shrubs: { length: 15, gap: 1, left: 6 },
    // Angled parking: distance between stripes along the curb, stall depth, how
    // far each stripe leans (sideways units per unit down), and how many spaces
    // in front of the memorial have wheel stops. The last of those ends at the
    // middle of the path's square end on the right.
    parking: { spacing: 29, depth: 54, lean: 0.58, stops: 6 },
    // Earlystown Road, out past the flags, measured off an aerial photo. It
    // isn't square to the plaza: it comes a little closer on the right. In
    // line with the monument, the white line along its near edge is 95 units
    // (about 32 ft) past the top of the curb, and it drops 0.136 units toward
    // the plaza for every unit to the right. Each lane is 34 units (11 ft).
    road: { gap: 95, slope: 0.136, lane: 34 },
  };

  const R = { gravelOut: SHAPE.gravelRadius, curbOut: SHAPE.gravelRadius + SHAPE.curb };

  // How far past the border's inner edge each band along the curved wall
  // starts: the pebbles, the wall and the gravel bed behind it.
  const OFF = {
    pebbles: SHAPE.border,
    wall: SHAPE.border + SHAPE.pebbles,
    gravel: SHAPE.border + SHAPE.pebbles + SHAPE.wall,
  };

  const rad = (deg) => (deg * Math.PI) / 180;

  // Distance from the centre point to the border's inner edge, at an angle
  // in degrees (0° at the right end of the arc), smoothly through SHAPE.edge.
  function rimAt(deg) {
    const e = SHAPE.edge,
      step = e[1][0] - e[0][0],
      i = clampIndex(Math.floor((deg - e[0][0]) / step), e.length - 2),
      t = (deg - e[i][0]) / step,
      [p0, p1, p2, p3] = [i - 1, i, i + 1, i + 2].map((k) => e[clampIndex(k, e.length - 1)][1]);
    return (
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
    );
  }
  const clampIndex = (i, max) => Math.max(0, Math.min(max, i));

  // Where the border steps in around each pillar: from one angle to the
  // other, at distance r.
  const notches = SHAPE.arcPillars.map((at) => {
    const rim = rimAt(at),
      half = ((SHAPE.notch.width / 2 / rim) * 180) / Math.PI;
    return { at, from: at - half, to: at + half, r: rim - SHAPE.notch.depth };
  });

  // The border's inner edge; with notched, stepping in around the pillars.
  function edgeAt(deg, notched = true) {
    if (notched) for (const p of notches) if (deg >= p.from && deg <= p.to) return p.r;
    return rimAt(deg);
  }

  // The point at an angle and distance from the centre point.
  const at = (deg, r) => [SHAPE.axis + r * Math.cos(rad(deg)), SHAPE.arcY - r * Math.sin(rad(deg))];

  // The angle at which the line `off` past the border's inner edge comes down
  // to height y, at the right end of the arc or the left.
  function endAngle(y, off, left) {
    let deg = left ? 180 : 0;
    for (let i = 0; i < 5; i++) {
      const a = (Math.asin((SHAPE.arcY - y) / (edgeAt(deg, false) + off)) * 180) / Math.PI;
      deg = left ? 180 - a : a;
    }
    return deg;
  }

  // The line `off` past the border's inner edge, from angle a0 up to a1, as
  // points. With notched, it steps in around the pillars like the border.
  function edgeLine(off, a0, a1, notched) {
    const pts = [],
      steps = [a0, a1];
    for (let d = Math.ceil(a0); d < a1; d++) steps.push(d);
    const inside = notched ? notches.filter((p) => p.from > a0 && p.to < a1) : [];
    for (const p of inside) steps.push(p.from, p.to);
    for (const d of [...new Set(steps)].sort((a, b) => a - b)) {
      const p = inside.find((n) => n.from === d || n.to === d);
      if (!p) pts.push(at(d, edgeAt(d, notched) + off));
      else if (p.from === d) pts.push(at(d, edgeAt(d, false) + off), at(d, p.r + off));
      else pts.push(at(d, p.r + off), at(d, edgeAt(d, false) + off));
    }
    return pts;
  }

  // Outline of a band along the curved wall, `from` to `to` past the border's
  // inner edge, over the top and down to height y at both ends.
  function arcBand(from, to, y, notched = false) {
    const outer = edgeLine(to, endAngle(y, to, false), endAngle(y, to, true), false),
      inner = edgeLine(from, endAngle(y, from, false), endAngle(y, from, true), notched);
    return [...outer, ...inner.reverse()];
  }

  const walkway = SHAPE.walkway;
  const lotY = walkway.bottom + SHAPE.border; // where the parking lot starts

  // The concrete path ends in a square pad on each side of the walkway, running
  // down to the parking lot. Past each pad are a bench and a row of shrubs.
  const pads = [
    { left: SHAPE.axis - R.curbOut, right: walkway.left - SHAPE.border },
    { left: walkway.right + SHAPE.border, right: SHAPE.axis + R.curbOut },
  ].map((p) => ({ ...p, top: SHAPE.arcY, bottom: lotY }));

  const EPS = 1e-6;

  // The herringbone repeats every 4 rows and 2 columns. Rows are 1 unit tall
  // and columns 2 units wide, and each grid cell owns exactly one paver:
  // PATTERN[row % 4][col % 2] = [x offset, is the paver vertical?]
  const PATTERN = [
    [[0, false], [1, true]],
    [[0, true], [-1, false]],
    [[1, true], [0, false]],
    [[-1, false], [0, true]],
  ];

  const mod = (n, m) => ((n % m) + m) % m;

  function paverAt(row, col) {
    const [dx, vertical] = PATTERN[mod(row, 4)][mod(col, 2)];
    return {
      key: `${row}-${col}`,
      row,
      col,
      x: col * 2 + dx,
      y: row,
      w: vertical ? 1 : 2,
      h: vertical ? 2 : 1,
      vertical,
    };
  }

  function inField(x, y) {
    const { axis, arcY, straightWall: sw, entrance } = SHAPE,
      w = walkway;
    if (y <= sw.top + EPS) {
      const deg = (Math.atan2(arcY - y, x - axis) * 180) / Math.PI;
      if (Math.hypot(x - axis, y - arcY) <= edgeAt(deg) + EPS) return true;
    }
    if (
      Math.abs(x - entrance.centre) <= entrance.halfWidth + EPS &&
      y >= sw.top - EPS &&
      y <= sw.bottom + EPS
    )
      return true;
    return (
      x >= w.left - EPS && x <= w.right + EPS && y >= w.top - EPS && y <= w.bottom + EPS
    );
  }

  // The two pillars at the entrance, left and right: the stone, and the ring
  // of border pavers around it (which juts out past the wall on both sides).
  const gate = [-1, 1].map((dir) => {
    const { entrance: en, pillar, border } = SHAPE,
      inner = en.centre + dir * (en.halfWidth + border),
      outer = inner + dir * pillar,
      y = en.pillarY,
      stone = { x0: Math.min(inner, outer), x1: Math.max(inner, outer), y0: y - pillar / 2, y1: y + pillar / 2 };
    return {
      stone,
      ring: { x0: stone.x0 - border, x1: stone.x1 + border, y0: stone.y0 - border, y1: stone.y1 + border },
    };
  });

  const overlaps = (p, r) => p.x < r.x1 && p.x + p.w > r.x0 && p.y < r.y1 && p.y + p.h > r.y0;

  function overlapsMonument(p) {
    const m = SHAPE.monument;
    return overlaps(p, { x0: m.left, x1: m.right, y0: m.top, y1: m.bottom });
  }

  // Pavers the lamp's footing covers, even in part.
  const underLamp = (p) => {
    const { x, y, footing } = SHAPE.lamp,
      dx = Math.max(p.x - x, 0, x - (p.x + p.w)),
      dy = Math.max(p.y - y, 0, y - (p.y + p.h));
    return Math.hypot(dx, dy) < footing;
  };

  const drawable = []; // every paver in the field, including the cut ones at the edges
  const slots = new Map(); // key → whole paver that can hold an engraved brick
  const cells = new Map(); // "x,y" of each unit square → slot, for hit-testing

  for (let row = -2; row <= 82; row++) {
    for (let col = -2; col <= 76; col++) {
      const p = paverAt(row, col);
      const xs = [p.x, p.x + p.w / 2, p.x + p.w],
        ys = [p.y, p.y + p.h / 2, p.y + p.h];
      const touches = xs.some((x) => ys.some((y) => inField(x, y)));
      if (!touches) continue;
      drawable.push(p);

      const whole = [p.x, p.x + p.w].every((x) => [p.y, p.y + p.h].every((y) => inField(x, y)));
      if (!whole || overlapsMonument(p) || gate.some((g) => overlaps(p, g.ring)) || underLamp(p)) continue;
      slots.set(p.key, p);
      for (let x = p.x; x < p.x + p.w; x++)
        for (let y = p.y; y < p.y + p.h; y++) cells.set(`${x},${y}`, p);
    }
  }

  function slotAt(x, y) {
    return cells.get(`${Math.floor(x)},${Math.floor(y)}`) || null;
  }

  // Pavers along a straight edge: splits the rectangle into ~2-unit pieces.
  function run(x0, y0, x1, y1) {
    const horizontal = x1 - x0 >= y1 - y0,
      length = horizontal ? x1 - x0 : y1 - y0,
      n = Math.max(1, Math.round(length / 2)),
      step = length / n,
      out = [];
    for (let i = 0; i < n; i++) {
      const a = (horizontal ? x0 : y0) + i * step,
        b = a + step;
      out.push(
        horizontal
          ? [[a, y0], [b, y0], [b, y1], [a, y1]]
          : [[x0, a], [x1, a], [x1, b], [x0, b]],
      );
    }
    return out;
  }

  function borderPavers() {
    const { straightWall: sw, monument: m } = SHAPE,
      w = walkway,
      [left, right] = gate.map((g) => g.ring);
    const pavers = [];

    // Along the curved wall, down to the border row of the straight walls,
    // stepping in around the pillars: pieces about 2 units long between two
    // angles, from distance r (at each angle) out to r + 1.
    const b = SHAPE.border,
      y = sw.top + b,
      start = endAngle(y, 0, false),
      end = endAngle(y, 0, true),
      along = (a0, a1, r) => {
        const n = Math.max(1, Math.round((rad(a1 - a0) * (r(a0) + r(a1) + b)) / 4));
        for (let i = 0; i < n; i++) {
          const p = a0 + ((a1 - a0) * i) / n,
            q = a0 + ((a1 - a0) * (i + 1)) / n;
          pavers.push([at(p, r(p)), at(p, r(p) + b), at(q, r(q) + b), at(q, r(q))]);
        }
      },
      rim = (d) => edgeAt(d, false);
    let from = start;
    for (const p of notches) {
      along(from, p.from, rim);
      along(p.from, p.to, () => p.r);
      // The two sides of the step, out to the rest of the border.
      for (const [d, dir] of [
        [p.from, 1],
        [p.to, -1],
      ]) {
        const t = rad(d),
          v = [-Math.sin(t) * dir * b, -Math.cos(t) * dir * b],
          p0 = at(d, p.r + b),
          p1 = at(d, rim(d) + b);
        pavers.push([p0, p1, [p1[0] + v[0], p1[1] + v[1]], [p0[0] + v[0], p0[1] + v[1]]]);
      }
      from = p.to;
    }
    along(from, end, rim);

    // Plaza side of the straight walls, up to the rings around the pillars.
    pavers.push(...run(endPoint(sw.top + b, b, true)[0], sw.top, left.x0, sw.top + b));
    pavers.push(...run(right.x1, sw.top, endPoint(sw.top + b, b, false)[0], sw.top + b));

    // Around the walkway (the entrance stays open).
    pavers.push(...run(w.left - 1, w.top - 1, left.x0, w.top));
    pavers.push(...run(right.x1, w.top - 1, w.right + 1, w.top));
    pavers.push(...run(w.left - 1, w.top, w.left, w.bottom));
    pavers.push(...run(w.right, w.top, w.right + 1, w.bottom));
    pavers.push(...run(w.left - 1, w.bottom, w.right + 1, w.bottom + 1));

    const box = (x0, y0, x1, y1) =>
      pavers.push([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);

    // Round the pillars at the entrance, as laid: a column of pavers on end
    // down each side, and long ones between them along the front and back.
    for (const r of [left, right]) {
      pavers.push(...run(r.x0, r.y0, r.x0 + b, r.y1), ...run(r.x1 - b, r.y0, r.x1, r.y1));
      pavers.push(...run(r.x0 + b, r.y0, r.x1 - b, r.y0 + b), ...run(r.x0 + b, r.y1 - b, r.x1 - b, r.y1));
    }

    // Round the monument, as laid: four long pavers along the front and four
    // along the back. The right end is a paver on end at each corner with a
    // cut piece between, and the left end a cut piece then a paver on end.
    for (let i = 0; i < 4; i++) {
      box(m.left + 2 * i, m.top, m.left + 2 * i + 2, m.top + 1);
      box(m.left + 2 * i, m.bottom - 1, m.left + 2 * i + 2, m.bottom);
    }
    box(m.right - 1, m.top, m.right, m.top + 2);
    box(m.right - 1, m.top + 2, m.right, m.bottom - 2);
    box(m.right - 1, m.bottom - 2, m.right, m.bottom);
    box(m.left, m.top + 1, m.left + 1, m.bottom - 3);
    box(m.left, m.bottom - 3, m.left + 1, m.bottom - 1);

    return pavers;
  }

  // Where the line `off` past the border's inner edge comes down to height y,
  // at the right end of the arc or the left.
  const endPoint = (y, off, left) => {
    const d = endAngle(y, off, left);
    return at(d, edgeAt(d, false) + off);
  };

  function pillars() {
    const { straightWall: sw, pillar, border, pillarGap } = SHAPE,
      mid = OFF.wall + SHAPE.wall / 2, // the middle of the stone wall
      y = (sw.top + sw.bottom) / 2;
    const list = [
      { x: endPoint(y, mid, true)[0], y, angle: 0 },
      { x: endPoint(y, mid, false)[0], y, angle: 0 },
      ...gate.map(({ stone: s }) => ({ x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2, angle: 0 })),
    ];
    for (const p of notches) {
      const [x, py] = at(p.at, p.r + border + pillarGap + pillar / 2);
      list.push({ x, y: py, angle: Math.PI / 2 - rad(p.at) });
    }
    return list.map((p) => ({ ...p, size: pillar }));
  }

  // The poles stand right on the outer edge of the concrete path.
  function flagpoles() {
    const r = R.curbOut;
    return SHAPE.flagpoles.map(([deg, flag]) => {
      const t = (deg * Math.PI) / 180;
      return {
        x: SHAPE.axis + r * Math.cos(t),
        y: SHAPE.arcY - r * Math.sin(t),
        flag,
        main: flag === "us",
      };
    });
  }

  // The point the whole-plaza view puts in the middle of the screen, when
  // there's room: the middle of the bricks, from the top of the curved field
  // to the bottom of the walkway.
  const centre = [SHAPE.axis, (SHAPE.arcY - edgeAt(90) + walkway.bottom) / 2];

  // The road: where its near white line crosses the line through the
  // monument, the way it runs (left to right), and the way across it (away
  // from the plaza), as unit vectors.
  const road = (() => {
    const { gap, slope, lane } = SHAPE.road,
      len = Math.hypot(1, slope);
    return {
      origin: [SHAPE.axis, SHAPE.arcY - R.curbOut - gap],
      along: [1 / len, slope / len],
      across: [slope / len, -1 / len],
      lane,
    };
  })();

  // What the whole-plaza view shows, and (with a little room once zoomed in)
  // how far the map can be moved: the walls, the walkway and the flags over
  // them, centred on the plaza. The flags fly to the right, so it reaches
  // just past the flag at 30°. The poles at the two ends are a drag away.
  const reach = R.curbOut * Math.cos(Math.PI / 6) + 9, // a flag is 7.5 wide
    frame = {
      left: SHAPE.axis - reach,
      right: SHAPE.axis + reach,
      top: SHAPE.arcY - R.curbOut - 14.5, // the top of the US flag
      // A strip of the parking lot, so on a short screen (a phone turned
      // sideways) the plaza sits in the middle with the flags above it.
      bottom: lotY + 10,
    };

  return {
    SHAPE,
    R,
    walkway,
    lotY,
    pads,
    centre,
    frame,
    road,
    drawable,
    slots,
    slotAt,
    OFF,
    edgeAt,
    arcBand,
    endPoint,
    // The brick field's curved edge, from the right end of the arc to the
    // left, down to the top of the straight walls.
    fieldEdge: edgeLine(0, endAngle(SHAPE.straightWall.top, 0, false), endAngle(SHAPE.straightWall.top, 0, true), true),
    // The back of the curved wall, from the right end round to the left.
    wallBack: edgeLine(OFF.gravel, 0, 180, false),
    borderPavers: borderPavers(),
    pillars: pillars(),
    lamp: SHAPE.lamp,
    gate,
    flagpoles: flagpoles(),
  };
})();
