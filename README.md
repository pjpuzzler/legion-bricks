# Memorial Bricks · American Legion Post 779

Find an engraved brick in the memorial plaza at American Legion Post 779
(2928 Earlystown Rd, Centre Hall, PA). Visitors scan the QR code on the
monument, type a name, and a red pin shows where the brick is. Links to a
brick (`…/legion-bricks/#robert-h-barnes`) can be shared.

Live site: https://pjpuzzler.github.io/legion-bricks/

## Adding or moving bricks

Everything happens on the map in the built-in editor. It only runs on your own
computer; `?edit` does nothing on the public site. Start the site locally
(see [Running it locally](#running-it-locally)) and open
http://localhost:8000/?edit. Then:

| To…                  | Do this                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| add a brick          | click the empty brick where it is and type its lines, **or** type the name in the search box, press Enter, then click its spot |
| fix a brick's text   | click it (or find it in the list) and edit the fields. Type it as engraved                |
| move a brick         | drag it. Dropping it onto another brick swaps the two. Arrow keys nudge the selected brick one spot |
| take a brick out     | **Take off map** keeps the brick in a "Not on the map" list; **Delete brick** removes it  |
| match a photo        | zoom in until names show on the bricks; ⟳ turns the map to the angle the photo was taken from |
| undo                 | ⌘Z / Ctrl+Z (⇧⌘Z / Ctrl+Y to redo)                                                        |

Keys: **N** new brick, **M** move the selected brick, **Esc** cancel, **⌘S / Ctrl+S** save.
In the search box, **Shift+Enter** adds a new brick even when the name matches one already there.

If the whole plaza gets rearranged: **More → Take every brick off the map**, then
place them again. The "Not on the map" list at the top shows what's left.

### Saving and publishing

1. Click **Save**. In Chrome or Edge, pick `data/bricks.js` in this folder the
   first time. After that, Save writes straight to it. Other browsers download
   `bricks.js` instead, so move it into the `data` folder.
2. Publish:

   ```bash
   git add data/bricks.js && git commit -m "Update bricks" && git push
   ```

   GitHub Pages updates the live site a minute or two later. Someone who
   already had the site open may see the old version for up to 10 minutes.

Edits stay in your browser until you save, even if you close the tab.

## The data file

`data/bricks.js` has one line per brick:

```js
{ first: "ROBERT H", last: "BARNES", lines: ["U S ARMY", "WORLD WAR II"], at: "45-9" },
```

- `first`, `last`: the name as engraved. The last name is used for sorting.
- `lines`: the other engraved lines, top to bottom.
- `at`: the spot on the map (a row-column on the herringbone grid). The editor
  fills this in. Leave it out for a brick that isn't placed yet.
- `color: "gray"`: the gray bricks.
- `emblem`: only needed to override the emblem read from the text
  (`"U S NAVY"` shows the Navy emblem on its own). Use a name like `"navy"`, or `"none"`.

Hand edits are fine. The editor points out problems such as two bricks on the
same spot.

## Changing the drawing

The plaza's shape (wall radius, straight walls, walkway, monument, flagpoles,
shrubs, parking spaces) is in `SHAPE` at the top of `js/plan.js`, measured in
brick widths. Leave the herringbone `PATTERN` alone: changing it would move
every brick.

To add a branch emblem, put a square image in `img/emblems/` and add it to
`EMBLEMS` and `EMBLEM_RULES` in `js/model.js`.

The service seals, the Air Corps and Nurse Corps insignia, and the American
Legion emblem come from public-domain files on Wikimedia Commons. The seals are
saved as 160 px WebP (they show at up to 46 px) and the Legion emblem as
300 px. The favicon, the iPhone home-screen icon and the link preview
(`img/share.jpg`) are made from that emblem.

## Running it locally

There's no build step. From this folder:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000 (or http://localhost:8000/?edit).

## Files

| File              | What's in it                                             |
| ----------------- | -------------------------------------------------------- |
| `data/bricks.js`  | the brick list                                           |
| `js/plan.js`      | the plaza's layout and the herringbone grid              |
| `js/model.js`     | brick records, emblems, search, writing the data file    |
| `js/map.js`       | drawing the plaza, plus pan, zoom and rotate             |
| `js/app.js`       | the finder: search, list, brick card                     |
| `js/editor.js`    | the editor (only loaded locally, with `?edit`)           |
| `css/style.css`   | styles                                                   |
| `img/`            | Legion emblem, icons, branch emblems, link preview       |
| `404.html`        | the page shown for a broken link                         |
| `.nojekyll`       | tells GitHub Pages to publish the files as they are      |
