/*
 * model.js: brick records, text helpers and search.
 *
 * A brick in data/bricks.js looks like
 *   { first: "ROBERT H", last: "BARNES", lines: ["U S ARMY", "WORLD WAR II"], at: "45-9" }
 * In the app each brick also gets a session-only numeric `id`.
 */
const Model = (() => {
  const EMBLEMS = {
    army: { name: "Army", file: "army" },
    navy: { name: "Navy", file: "navy" },
    "air-force": { name: "Air Force", file: "air-force" },
    marines: { name: "Marine Corps", file: "marines" },
    "coast-guard": { name: "Coast Guard", file: "coast-guard" },
    "army-air-corps": { name: "Army Air Corps", file: "army-air-corps" },
    "army-nurse-corps": { name: "Army Nurse Corps", file: "army-nurse-corps" },
  };

  // Emblems are read from the engraved text. More specific phrases come first,
  // and a phrase that has already matched can't match again (so "ARMY AIR
  // CORPS" doesn't also count as "ARMY"). A null emblem just claims the words.
  const EMBLEM_RULES = [
    [/\bMERCHANT MARINES?\b/, null],
    [/\bARMY NURSE\b|\bNURSE CORPS\b/, "army-nurse-corps"],
    [/\bARMY AIR (CORPS|FORCES?)\b|\bAIR CORPS\b|\bAAC\b|\bUSAAF\b/, "army-air-corps"],
    [/\bAIR FORCE\b|\bUSAF\b/, "air-force"],
    [/\bMARINES?\b|\bU\.? ?S\.? ?M\.? ?C\b/, "marines"],
    [/\bCOAST GUARD\b|\bUSCG\b/, "coast-guard"],
    [/\bNAVY\b|\bUSN\b|\bUSNR\b/, "navy"],
    [/\bARMY\b/, "army"],
  ];

  const ERAS = [
    ["Civil War", /\bCIVIL WAR\b/],
    ["World War I", /\bW\.? ?W\.? ?(I|1)\b|\bWORLD WAR (I|1|ONE)\b(?!I)/],
    ["World War II", /\bW\.? ?W\.? ?(II|2)\b|\bWORLD WAR (II|2|TWO)\b/],
    ["Korea", /\bKOREA/],
    ["Vietnam", /\bVIETNAM|\bV-?NAM\b/],
    ["Lebanon / Grenada", /\bLEBANON\b|\bGRENADA\b/],
    ["Persian Gulf", /\bPERSIAN GULF\b|\bGULF WAR\b|\bDESERT STORM\b/],
    ["Iraq", /\bIRAQ/],
    ["Afghanistan", /\bAFGHAN|\bENDURING FREEDOM\b/],
  ];

  // Extra words so searches like "ww2" or "korea" find bricks spelled differently.
  const ALIASES = {
    "World War I": "WWI WW1 WORLD WAR ONE",
    "World War II": "WWII WW2 WORLD WAR TWO",
    Korea: "KOREA KOREAN",
    Vietnam: "VIETNAM",
    "Persian Gulf": "GULF DESERT STORM",
    Iraq: "IRAQ IRAQI",
  };

  // Text is kept exactly as typed (so "McCOOL" stays McCOOL, and a wide gap
  // on a brick stays as its spaces), just trimmed.
  const clean = (s) =>
    String(s ?? "")
      .replace(/[^\S ]/g, " ")
      .trim();

  // "U S ARMY" and "U.S. ARMY" read as "US ARMY" for matching.
  const matchText = (s) =>
    ` ${clean(s)
      .replace(/ +/g, " ")
      .toUpperCase()
      .replace(/\bU\.? ?S\.?(?= |$)/g, "US")} `;

  function emblemsFor(brick) {
    if (brick.emblem === "none") return [];
    if (brick.emblem && EMBLEMS[brick.emblem]) return [brick.emblem];
    const text = matchText(brick.lines.join(" / ")),
      claimed = [],
      found = [];
    for (const [re, key] of EMBLEM_RULES) {
      const g = new RegExp(re.source, "g");
      for (let m; (m = g.exec(text)); ) {
        const span = [m.index, m.index + m[0].length];
        if (claimed.some(([a, b]) => span[0] < b && span[1] > a)) continue;
        claimed.push(span);
        if (key) found.push([span[0], key]);
      }
    }
    return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, k]) => k))];
  }

  function erasFor(brick) {
    const text = matchText(brick.lines.join(" / "));
    return ERAS.filter(([, re]) => re.test(text)).map(([name]) => name);
  }

  const fullName = (b) => [b.first, b.last].filter(Boolean).join(" ");
  const joined = (...parts) => parts.filter(Boolean).join(" ");

  // The engraved lines, top to bottom: the name (on one line, or the first
  // name over the last), then the rest.
  // (With anything else on the name's line, like CHPLN or KIA, around it.)
  const engraving = (b) => [
    ...(b.split && b.first && b.last
      ? [joined(b.before, b.first), joined(b.last, b.after)]
      : [joined(b.before, fullName(b), b.after)]),
    ...b.lines,
  ];

  // Honors read from the engraving, shown as a badge by the name.
  const HONORS = {
    kia: { name: "Killed in action", re: /\bK\.?I\.?A\b|\bKILLED IN ACTION\b/ },
    mia: { name: "Missing in action", re: /\bM\.?I\.?A\b|\bMISSING IN ACTION\b/ },
    chaplain: { name: "Chaplain", re: /\bCHPLN\b|\bCHAPLAIN\b/ },
  };
  const honorsFor = (b) => {
    const text = [b.before, b.after, ...b.lines].join(" / ").toUpperCase();
    return Object.keys(HONORS).filter((k) => HONORS[k].re.test(text));
  };

  // The engraved lines for reading in a list: without KIA or MIA (the badge
  // says it), and one space between words.
  const plainLines = (b) =>
    b.lines
      .map((l) =>
        l
          .replace(/[,.]?\s*\b(KIA|MIA)\b\.?/g, "")
          .replace(/\s+/g, " ")
          .replace(/^[\s,.]+|[\s,]+$/g, ""),
      )
      .filter(Boolean);

  function slugify(s) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function compare(a, b) {
    const opts = { sensitivity: "base", numeric: true };
    return (
      a.last.localeCompare(b.last, "en", opts) ||
      a.first.localeCompare(b.first, "en", opts) ||
      a.lines.join(" ").localeCompare(b.lines.join(" "), "en", opts) ||
      (a.at || "").localeCompare(b.at || "", "en", opts)
    );
  }

  // Record (file format) → brick. Tolerates hand-edited data.
  function fromRecord(r, id) {
    const lines = (Array.isArray(r.lines) ? r.lines : r.lines ? [r.lines] : [])
      .map(clean)
      .filter(Boolean);
    return {
      id,
      first: clean(r.first),
      last: clean(r.last),
      before: clean(r.before),
      after: clean(r.after),
      lines,
      split: r.split === true,
      flip: r.flip === true,
      squeeze: typeof r.squeeze === "number" && r.squeeze > 0 ? r.squeeze : 0,
      at: r.at ? String(r.at).trim() : "",
      color: r.color === "gray" ? "gray" : "",
      emblem: r.emblem ? String(r.emblem).trim().toLowerCase() : "",
    };
  }

  // Brick → record, with a fixed key order and empty fields left out.
  function toRecord(b) {
    const r = { first: b.first, last: b.last };
    if (b.before) r.before = b.before;
    if (b.after) r.after = b.after;
    if (b.lines.length) r.lines = [...b.lines];
    if (b.split) r.split = true;
    if (b.flip) r.flip = true;
    if (b.squeeze) r.squeeze = b.squeeze;
    if (b.at) r.at = b.at;
    if (b.color) r.color = b.color;
    if (b.emblem) r.emblem = b.emblem;
    return r;
  }

  const FILE_HEADER = `/*
 * Memorial bricks at American Legion Post 779.
 *
 * The easy way to change this list is the built-in editor, which only runs on
 * your own computer: start the site locally, open it with ?edit on the end of
 * the address, and click Save when you're done. README.md has the details.
 *
 * Each brick:
 *   first, last  the name as engraved (the last name is used for sorting)
 *   before, after  anything else engraved on the name's line, like CHPLN
 *                before it or KIA after it
 *   lines        the other engraved lines, top to bottom
 *   split        true if the name is engraved on two lines, first name on top
 *   flip         true if the text is turned round from the usual (bricks lying
 *                across the map read from the entrance side, ones running up
 *                and down it from their right)
 *   squeeze      how narrow the engraver made the letters (1 is normal), only
 *                where it isn't what the usual layout works out
 *   at           its spot on the map as "row-col"; leave it out if not placed yet
 *   color        "gray" for the gray bricks
 *   emblem       only to override the emblem read from the text: "navy", "none"...
 */
`;

  function serialize(bricks) {
    const value = (v) =>
      Array.isArray(v) ? `[${v.map((s) => JSON.stringify(s)).join(", ")}]` : JSON.stringify(v);
    const rows = [...bricks].sort(compare).map((b) => {
      const parts = Object.entries(toRecord(b)).map(([k, v]) => `${k}: ${value(v)}`);
      return `  { ${parts.join(", ")} },`;
    });
    return `${FILE_HEADER}const BRICKS = [\n${rows.join("\n")}\n];\n`;
  }

  // cyrb53: a small, fast string hash, used to tell data versions apart.
  function hash(str) {
    let h1 = 0xdeadbeef,
      h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  const words = (s) =>
    clean(s)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);

  function searchIndex(b) {
    const eras = erasFor(b),
      extra = [
        b.before,
        b.after,
        ...honorsFor(b).map((k) => HONORS[k].name),
        ...emblemsFor(b).map((k) => EMBLEMS[k].name),
        ...eras.map((e) => ALIASES[e] || e),
      ];
    return {
      first: words(b.first),
      last: words(b.last),
      rest: words([...b.lines, ...extra].join(" ")),
    };
  }

  // Every word of the query has to start one of the brick's words.
  // Last-name hits rank above first-name hits, which rank above the rest.
  function search(bricks, query) {
    const q = words(query);
    if (!q.length) return [...bricks].sort(compare);
    const hits = [];
    for (const b of bricks) {
      const idx = (b._search ||= searchIndex(b));
      let score = 0;
      for (const t of q) {
        if (idx.last.some((w) => w.startsWith(t))) score += 3;
        else if (idx.first.some((w) => w.startsWith(t))) score += 2;
        else if (idx.rest.some((w) => w.startsWith(t))) score += 1;
        else {
          score = -1;
          break;
        }
      }
      if (score >= 0) hits.push([score, b]);
    }
    return hits.sort((a, b) => b[0] - a[0] || compare(a[1], b[1])).map(([, b]) => b);
  }

  // Edit distance between two words, for catching small spelling mistakes.
  function distance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  // Names spelled a little differently from what was typed ("BARNS" finds
  // BARNES). Used when a search finds nothing.
  function closeMatches(bricks, query, limit = 12) {
    const q = words(query).filter((t) => t.length >= 3);
    if (!q.length) return [];
    const hits = [];
    for (const b of bricks) {
      const names = [...words(b.first), ...words(b.last)];
      let total = 0;
      for (const t of q) {
        // A close whole word beats a close start of a longer word.
        const allowed = t.length >= 7 ? 2 : 1;
        let best = Infinity;
        for (const w of names) {
          const whole = distance(t, w),
            start = distance(t, w.slice(0, t.length));
          if (Math.min(whole, start) <= allowed) best = Math.min(best, whole <= allowed ? whole : start + 0.5);
        }
        if (best === Infinity) {
          total = -1;
          break;
        }
        total += best;
      }
      if (total >= 0) hits.push([total, b]);
    }
    return hits
      .sort((a, c) => a[0] - c[0] || compare(a[1], c[1]))
      .slice(0, limit)
      .map(([, b]) => b);
  }

  // Splits a typed name into first and last, keeping JR/SR/III with the last name.
  function splitName(s) {
    const parts = clean(s).split(" ").filter(Boolean);
    if (parts.length < 2) return { first: "", last: parts[0] || "" };
    let i = parts.length - 1;
    if (i > 1 && /^(JR|SR|II|III|IV)\.?$/i.test(parts[i].replace(/^,/, ""))) i--;
    return { first: parts.slice(0, i).join(" "), last: parts.slice(i).join(" ") };
  }

  return {
    EMBLEMS,
    ERAS: ERAS.map(([name]) => name),
    emblemsFor,
    erasFor,
    fullName,
    engraving,
    HONORS,
    honorsFor,
    plainLines,
    slugify,
    compare,
    fromRecord,
    toRecord,
    serialize,
    hash,
    search,
    closeMatches,
    splitName,
  };
})();
