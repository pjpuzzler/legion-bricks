/*
 * sky.js: the plaza as it is right now: where the sun is, the season, the
 * weather and the calendar (half-staff days, poppies, wreaths, fireworks).
 * The map draws from Sky.state(). None of it is needed to find a brick, so
 * anything that fails (say, the weather) is simply left out.
 *
 * On your own computer, ?at=2026-07-04T22:00 (plaza time) and ?weather=snow
 * (or clear, calm, windy) show the plaza at another moment.
 */
const Sky = (() => {
  // The plaza, its time zone, and which way the map's top faces: 330°,
  // north-northwest (from the parking lot to the tall flagpole).
  const LAT = 40.8361,
    LON = -77.6699,
    ZONE = "America/New_York",
    MAP_UP = 330;

  const local = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(location.hostname) || location.protocol === "file:";
  const params = new URLSearchParams(location.search);

  // Now, or (locally) the moment asked for, read as plaza time.
  function now() {
    const m = local && /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(params.get("at") || "");
    if (m) {
      const guess = Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0));
      return new Date(guess + offsetMinutes(new Date(guess)) * 60000);
    }
    return new Date();
  }

  // Minutes the plaza's clock is behind UTC at a moment (240 or 300).
  function offsetMinutes(d) {
    const p = parts(d),
      asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
    return Math.round((asUtc - d.getTime()) / -60000);
  }

  // The plaza's calendar date and clock at a moment.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  });
  function parts(d) {
    const out = {};
    for (const { type, value } of fmt.formatToParts(d)) out[type] = type === "weekday" ? value : +value;
    return out;
  }

  // Where the sun is (degrees): its height above the horizon, and its compass
  // bearing, clockwise from north. (The usual formulas, as in SunCalc.)
  function sun(d) {
    const rad = Math.PI / 180,
      days = d.getTime() / 86400000 - 10957.5,
      M = rad * (357.5291 + 0.98560028 * days),
      L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI,
      e = rad * 23.4397,
      dec = Math.asin(Math.sin(e) * Math.sin(L)),
      ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L)),
      H = rad * (280.16 + 360.9856235 * days) + rad * LON - ra,
      phi = rad * LAT,
      altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
      azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return { altitude: altitude / rad, azimuth: (azimuth / rad + 540) % 360 };
  }

  // ---- the calendar ---------------------------------------------------------

  const nthWeekday = (year, month, weekday, n) => {
    // n > 0: the nth such weekday of the month; n = -1: the last one.
    if (n > 0) {
      const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    }
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate(),
      last = new Date(Date.UTC(year, month - 1, days)).getUTCDay();
    return days - ((last - weekday + 7) % 7);
  };

  // What the day brings. Half-staff follows the flag code's fixed days (a
  // proclamation for someone's passing can't be known ahead, so isn't shown).
  function calendar(d) {
    const p = parts(d),
      { year, month: m, day } = p,
      memorial = nthWeekday(year, 5, 1, -1),
      armedForces = nthWeekday(year, 5, 6, 3),
      is = (mm, dd) => m === mm && day === dd;
    let halfStaff = "";
    if (is(5, memorial) && p.hour < 12) halfStaff = "Memorial Day";
    else if (is(5, 15) && armedForces !== 15) halfStaff = "Peace Officers Memorial Day";
    else if (is(9, 11)) halfStaff = "Patriot Day";
    else if (is(12, 7)) halfStaff = "Pearl Harbor Remembrance Day";
    return {
      halfStaff,
      // Poppies from National Poppy Day (the Friday before) through Memorial Day.
      poppies: m === 5 && day >= memorial - 3 && day <= memorial,
      // A wreath at the monument on Memorial Day and Veterans Day.
      monumentWreath: is(5, memorial) || is(11, 11),
      // Wreaths on the pillars through the Christmas season.
      wreaths: m === 12 || (m === 1 && day <= 6),
      fourth: is(7, 4),
    };
  }

  // ---- the season -------------------------------------------------------------

  // The lawn through the year: dormant in winter, fresh in spring, deep in
  // summer, going golden in the fall. [day of the year, colour]
  const LAWN = [
    [0, [166, 166, 124]],
    [60, [163, 168, 116]],
    [100, [143, 178, 88]],
    [150, [140, 172, 86]],
    [200, [148, 168, 89]],
    [245, [158, 165, 92]],
    [290, [168, 164, 104]],
    [335, [168, 164, 118]],
    [366, [166, 166, 124]],
  ];
  function lawn(d) {
    const p = parts(d),
      doy = (Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / 86400000;
    for (let i = 1; i < LAWN.length; i++)
      if (doy <= LAWN[i][0]) {
        const [d0, c0] = LAWN[i - 1],
          [d1, c1] = LAWN[i],
          t = (doy - d0) / (d1 - d0);
        return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      }
    return LAWN[0][1];
  }

  // ---- the weather ------------------------------------------------------------

  // From Open-Meteo (free, no key): snow on the ground, the wind for the
  // flags, and cloud (which softens shadows). Kept for half an hour.
  let weather = null;
  const TEST = {
    snow: { snow: true, wind: 8, windFrom: 300, cloud: 60 },
    clear: { snow: false, wind: 12, windFrom: 250, cloud: 0 },
    calm: { snow: false, wind: 1, windFrom: 0, cloud: 10 },
    windy: { snow: false, wind: 35, windFrom: 90, cloud: 30 },
  };
  function fetchWeather() {
    const test = local && TEST[params.get("weather")];
    if (test) {
      weather = test;
      return Promise.resolve(weather);
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem("sky-weather") || "null");
      if (saved && Date.now() - saved.at < 30 * 60000) {
        weather = saved.w;
        return Promise.resolve(weather);
      }
    } catch {}
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      LAT +
      "&longitude=" +
      LON +
      "&current=cloud_cover,wind_speed_10m,wind_direction_10m&hourly=snow_depth&forecast_days=1&timezone=" +
      encodeURIComponent(ZONE);
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), 6000);
    return fetch(url, ctl ? { signal: ctl.signal } : {})
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        const hour = String(j.current.time).slice(0, 13),
          i = (j.hourly?.time || []).findIndex((t) => String(t).slice(0, 13) === hour),
          depth = i >= 0 ? j.hourly.snow_depth[i] : 0;
        weather = {
          snow: depth >= 0.02,
          wind: j.current.wind_speed_10m,
          windFrom: j.current.wind_direction_10m,
          cloud: j.current.cloud_cover,
        };
        try {
          sessionStorage.setItem("sky-weather", JSON.stringify({ at: Date.now(), w: weather }));
        } catch {}
        return weather;
      })
      .catch(() => null)
      .finally(() => clearTimeout(timer));
  }

  // ---- all together -----------------------------------------------------------

  // Everything the map needs to draw the moment.
  function state(d = now()) {
    const s = sun(d),
      w = weather,
      // 1 in full day, 0 at night, in between through dusk and dawn
      light = Math.min(1, Math.max(0, (s.altitude + 7) / 11)),
      cloud = w ? w.cloud / 100 : 0.2;
    return {
      date: d,
      sun: s,
      light,
      // Warm light for the hour after sunrise and before sunset.
      golden: s.altitude > -2 && s.altitude < 8 ? 1 - Math.abs(s.altitude - 3) / 5 : 0,
      // How dark shadows are: none at night or under full cloud.
      shadow: Math.max(0, Math.min(1, (s.altitude - 2) / 10)) * (1 - 0.85 * cloud),
      lawn: lawn(d),
      snow: !!w?.snow,
      // Where the sun is, turned to the map (0° is the map's top, clockwise).
      sunOnMap: (s.azimuth - MAP_UP + 360) % 360,
      // The wind: where it blows toward (on the map, the same way), and 0
      // (calm) to 1.
      windTo: w ? (w.windFrom + 180 - MAP_UP + 720) % 360 : 90,
      breeze: w ? Math.min(1, w.wind / 20) : 0.6,
      ...calendar(d),
    };
  }

  return { now, sun, calendar, state, fetchWeather };
})();
