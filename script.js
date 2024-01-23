window.onload = () => {
    updateCanvas();

    const elPicker = document.getElementById("picker");

    elPicker.innerHTML = "<option selected></option>";

    for (const brick of BRICKS)
        elPicker.add(new Option(brick.getString(), brick.coords));
};

window.onresize = updateCircle;

let highlightX = null,
    highlightY = null,
    highlightVertical = null;

function updateCanvas() {
    drawBricksCanvas();
    updateCircle();
}

function updateCircle() {
    const elPicker = document.getElementById("picker"),
        elCircle = document.getElementById("circle"),
        elPickerInfo = document.getElementById("picker-info");

    if (elPicker.value !== "") {
        const elBricksCanvas = document.getElementById("bricks-canvas");
        if (highlightVertical) {
            elCircle.style.left = `${
                elBricksCanvas.offsetLeft + highlightX + 0.5 + brickHeight / 2
            }px`;
            elCircle.style.top = `${
                elBricksCanvas.offsetTop + highlightY + 0.5
            }px`;
        } else {
            elCircle.style.left = `${
                elBricksCanvas.offsetLeft + highlightX + 0.5 + brickWidth / 2
            }px`;
            elCircle.style.top = `${
                elBricksCanvas.offsetTop + highlightY + 0.5 - brickHeight / 2
            }px`;
        }

        const brick = BRICKS[elPicker.selectedIndex - 1];

        const elPickerName = document.getElementById("picker-name"),
            elPickerBranchImg = document.getElementById("picker-branch-img"),
            elPickerBranchImg2 = document.getElementById("picker-branch-img2");

        elPickerName.innerHTML = `${brick.fname} ${brick.lname}<br/>${brick.conflict}`;
        elPickerBranchImg.src = `./emblems/${brick.branchIds[0]}.png`;
        if (brick.branchIds.length > 1) {
            elPickerBranchImg2.style.display = "initial";
            elPickerBranchImg2.src = `./emblems/${brick.branchIds[1]}.png`;
        } else elPickerBranchImg2.style.display = "none";

        elCircle.style.display = "initial";
        elPickerInfo.style.display = "initial";
    } else {
        elCircle.style.display = "none";
        elPickerInfo.style.display = "none";
    }
}

function drawBricksCanvas() {
    const highlightedCoords = document.getElementById("picker").value;

    const canvas = document.getElementById("bricks-canvas");
    const ctx = canvas.getContext("2d");

    canvas.height = (brickHeight * n) / 2;
    canvas.width = brickHeight * m * 2;

    ctx.translate(0.5, -brickHeight + 0.5);

    function drawBrick(i, j, x, y, color, vertical) {
        const coords = `${i}-${j}`;
        ctx.beginPath();
        if (vertical) ctx.rect(x, y, brickHeight, brickWidth);
        else ctx.rect(x, y, brickWidth, brickHeight);
        ctx.fillStyle =
            coords === highlightedCoords
                ? brickHighlightColor
                : COORDS.has(coords)
                ? brickColor2
                : color;
        ctx.strokeStyle = brickOutlineColor;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();

        if (coords === highlightedCoords) {
            highlightX = x;
            highlightY = y;
            highlightVertical = vertical;
        }
    }

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
            let x = j * brickWidth,
                y = i * brickHeight;

            let color;

            if (
                (Math.abs(
                    Math.pow(x - canvas.width / 2, 2) +
                        Math.pow(y - canvas.height / 2 - brickHeight * 25, 2) -
                        Math.pow(260, 2)
                ) < 2100 &&
                    y <= canvas.height - brickHeight * 21) ||
                ((x < brickHeight * 39 ||
                    x > canvas.width - brickHeight * 41) &&
                    y > canvas.height - brickHeight * 17 &&
                    y < canvas.height - brickHeight * 14) ||
                (((x < brickHeight * 39 && x > brickHeight * 6) ||
                    (x > canvas.width - brickHeight * 41 &&
                        x < canvas.width - brickHeight * 6)) &&
                    y > canvas.height - brickHeight * 21 &&
                    y < canvas.height - brickHeight * 18) ||
                (((x < brickHeight * 41 && x > brickHeight * 39) ||
                    (x > canvas.width - brickHeight * 41 &&
                        x < canvas.width - brickHeight * 39)) &&
                    y > canvas.height - brickHeight * 21 &&
                    y < canvas.height - brickHeight * 14) ||
                (x < brickHeight * 78 &&
                    x > brickHeight * 70 &&
                    y < brickHeight * 44 &&
                    y > brickHeight * 39) ||
                (y > brickHeight * 65 &&
                    (x < brickHeight * 2 ||
                        x > canvas.width - brickHeight * 3)) ||
                y > brickHeight * 78
            )
                color = edgeColor;
            else if (
                (Math.pow(x - canvas.width / 2, 2) +
                    Math.pow(y - canvas.height / 2 - brickHeight * 24, 2) >
                    Math.pow(260, 2) &&
                    y <= canvas.height - brickHeight * 21) ||
                ((x < brickHeight * 39 ||
                    x > canvas.width - brickHeight * 41) &&
                    y > canvas.height - brickHeight * 21 &&
                    y < canvas.height - brickHeight * 14)
            )
                continue;
            else color = brickColor;

            if (i % 4 == 0) {
                if (j % 2 === 0) drawBrick(i, j, x, y, color, false);
                else drawBrick(i, j, x + brickWidth / 2, y, color, true);
            } else if (i % 4 == 1) {
                if (j % 2 === 0) drawBrick(i, j, x, y, color, true);
                else drawBrick(i, j, x - brickWidth / 2, y, color, false);
            } else if (i % 4 == 2) {
                if (j % 2 === 0)
                    drawBrick(i, j, x + brickWidth / 2, y, color, true);
                else drawBrick(i, j, x, y, color, false);
            } else {
                if (j % 2 === 0)
                    drawBrick(i, j, x - brickWidth / 2, y, color, false);
                else drawBrick(i, j, x, y, color, true);
            }
        }
    }
}
