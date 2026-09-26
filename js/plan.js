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
    axis: 74.5, // centre line, through the monument
    arcY: 65, // centre point of the curved wall
    fieldRadius: 64, // brick field, out to the gray border row
    border: 1, // gray border pavers
    wall: 4, // stone wall
    gravel: 8, // stone bed with the lights, outside the wall
    curb: 5, // concrete ring the flagpoles stand on
    straightWall: { top: 60, bottom: 66 }, // includes a border row on each side
    entranceHalfWidth: 30, // opening between the two straight walls
    pillar: 6,
    arcPillars: [45, 90, 135], // degrees; 0° is the right end of the arc
    walkway: { left: 2.5, right: 146.5, top: 66, bottom: 79 }, // along the parking lot
    monument: { left: 70, top: 39, right: 79, bottom: 44 }, // includes its border
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
    shrubs: { length: 15, gap: 1 }, // the shrubs along the lot are trimmed into separate blocks
    // Angled parking: distance between stripes along the curb, stall depth, how
    // far each stripe leans (sideways units per unit down), and how many spaces
    // in front of the memorial have wheel stops. The last of those ends at the
    // middle of the path's square end on the right.
    parking: { spacing: 29, depth: 54, lean: 0.58, stops: 6 },
  };

  const R = { field: SHAPE.fieldRadius };
  R.wallIn = R.field + SHAPE.border;
  R.wallOut = R.wallIn + SHAPE.wall;
  R.gravelOut = R.wallOut + SHAPE.gravel;
  R.curbOut = R.gravelOut + SHAPE.curb;

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
    const { axis, arcY, straightWall: sw, entranceHalfWidth } = SHAPE,
      w = walkway;
    if (y <= sw.top + EPS && (x - axis) ** 2 + (y - arcY) ** 2 <= R.field ** 2 + EPS)
      return true;
    if (
      Math.abs(x - axis) <= entranceHalfWidth + EPS &&
      y >= sw.top - EPS &&
      y <= sw.bottom + EPS
    )
      return true;
    return (
      x >= w.left - EPS && x <= w.right + EPS && y >= w.top - EPS && y <= w.bottom + EPS
    );
  }

  function overlapsMonument(p) {
    const m = SHAPE.monument;
    return p.x < m.right && p.x + p.w > m.left && p.y < m.bottom && p.y + p.h > m.top;
  }

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
      if (!whole || overlapsMonument(p)) continue;
      slots.set(p.key, p);
      for (let x = p.x; x < p.x + p.w; x++)
        for (let y = p.y; y < p.y + p.h; y++) cells.set(`${x},${y}`, p);
    }
  }

  function slotAt(x, y) {
    return cells.get(`${Math.floor(x)},${Math.floor(y)}`) || null;
  }

  // Where on the circle (canvas angles, y down) a radius meets a given y.
  const angleAtY = (r, y) => Math.asin((y - SHAPE.arcY) / r);

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
    const { axis, arcY, straightWall: sw, entranceHalfWidth: e, pillar, monument: m } = SHAPE,
      w = walkway;
    const pavers = [];

    // Along the curved wall, down to the border row of the straight walls.
    const start = Math.PI - angleAtY(R.field, sw.top + 1),
      end = 2 * Math.PI + angleAtY(R.field, sw.top + 1),
      n = Math.round(((end - start) * (R.field + 0.5)) / 2);
    for (let i = 0; i < n; i++) {
      const a = start + ((end - start) * i) / n,
        b = start + ((end - start) * (i + 1)) / n,
        pt = (r, t) => [axis + r * Math.cos(t), arcY + r * Math.sin(t)];
      pavers.push([pt(R.field, a), pt(R.wallIn, a), pt(R.wallIn, b), pt(R.field, b)]);
    }

    // Plaza side of the straight walls.
    const inner = Math.sqrt(R.field ** 2 - (sw.top + 1 - arcY) ** 2);
    pavers.push(...run(axis - inner, sw.top, axis - e - pillar, sw.top + 1));
    pavers.push(...run(axis + e + pillar, sw.top, axis + inner, sw.top + 1));

    // Around the walkway (the entrance stays open).
    pavers.push(...run(w.left - 1, w.top - 1, axis - e, w.top));
    pavers.push(...run(axis + e, w.top - 1, w.right + 1, w.top));
    pavers.push(...run(w.left - 1, w.top, w.left, w.bottom));
    pavers.push(...run(w.right, w.top, w.right + 1, w.bottom));
    pavers.push(...run(w.left - 1, w.bottom, w.right + 1, w.bottom + 1));

    // Around the monument.
    pavers.push(...run(m.left, m.top, m.right, m.top + 1));
    pavers.push(...run(m.left, m.bottom - 1, m.right, m.bottom));
    pavers.push(...run(m.left, m.top + 1, m.left + 1, m.bottom - 1));
    pavers.push(...run(m.right - 1, m.top + 1, m.right, m.bottom - 1));

    return pavers;
  }

  function pillars() {
    const { axis, arcY, straightWall: sw, entranceHalfWidth: e, pillar } = SHAPE;
    const mid = (R.wallIn + R.wallOut) / 2,
      y = (sw.top + sw.bottom) / 2;
    const list = [
      { x: axis - mid, y, angle: 0 },
      { x: axis + mid, y, angle: 0 },
      { x: axis - e - pillar / 2, y, angle: 0 },
      { x: axis + e + pillar / 2, y, angle: 0 },
    ];
    for (const deg of SHAPE.arcPillars) {
      const t = (deg * Math.PI) / 180;
      list.push({
        x: axis + mid * Math.cos(t),
        y: arcY - mid * Math.sin(t),
        angle: Math.PI / 2 - t,
      });
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

  // The point the whole-plaza view puts in the middle of the screen when
  // there's room to spare: halfway between the middle of the bricks and the
  // middle of the plaza with its wall and path, which is what looks centred.
  const bricksMiddle = (SHAPE.arcY - R.field + walkway.bottom) / 2,
    plazaMiddle = (SHAPE.arcY - R.curbOut + walkway.bottom) / 2,
    centre = [SHAPE.axis, (bricksMiddle + plazaMiddle) / 2];

  // What the whole-plaza view shows: the walls, the walkway and the flags
  // over them, centred on the plaza. The flags fly to the right, so it
  // reaches just past the flag at 30°. The poles at the two ends are out
  // past it, and zooming in gives room to move over to them.
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
    drawable,
    slots,
    slotAt,
    angleAtY,
    borderPavers: borderPavers(),
    pillars: pillars(),
    flagpoles: flagpoles(),
  };
})();
