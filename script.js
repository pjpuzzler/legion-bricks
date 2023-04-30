window.onload = () => {
    drawBricksCanvas();
};

function drawBricksCanvas() {
    const canvas = document.getElementById("bricks-canvas");
    const ctx = canvas.getContext("2d");

    const brickHeight = 4,
        brickWidth = 8;

    canvas.height = (brickHeight * n) / 2;
    canvas.width = brickHeight * m * 2;

    const brickColor = "#FFA500",
        wallColor = "#000000",
        brickHighlightColor = "#9EFF00",
        brickOutlineColor = "#000000";

    ctx.translate(0.5, -brickHeight + 0.5);

    function drawBrick(i, j, x, y, color, vertical) {
        ctx.beginPath();
        if (vertical) ctx.rect(x, y, brickHeight, brickWidth);
        else ctx.rect(x, y, brickWidth, brickHeight);
        ctx.fillStyle =
            `${i}-${j}` === TEST
                ? brickHighlightColor
                : `${i}-${j}` in BRICKS
                ? "red"
                : color;
        ctx.strokeStyle = brickOutlineColor;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
    }

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
            let x = j * brickWidth,
                y = i * brickHeight;

            let color;

            if (
                (Math.pow(x - canvas.width / 2, 2) +
                    Math.pow(y - canvas.height / 2 - brickHeight * 23, 2) >
                    Math.pow(510, 2) &&
                    y <= canvas.height - brickHeight * 21) ||
                ((x < brickHeight * 39 ||
                    x > canvas.width - brickHeight * 39) &&
                    y > canvas.height - brickHeight * 21 &&
                    y < canvas.height - brickHeight * 15)
            )
                color = wallColor;
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

function updateSearch(searchStr) {
    searchStr = searchStr.trim().toLowerCase();
    BRICKS.forEach((row, i) => {
        row.forEach((brick, j) => {
            let td = document.getElementById(`brick-${i}-${j}`);
            if (
                searchStr &&
                (`${brick.fname} ${brick.lname}`
                    .toLowerCase()
                    .startsWith(searchStr) ||
                    brick.lname.toLowerCase().startsWith(searchStr))
            ) {
                td.style.borderColor = "yellow";
                td.style.scale = 1.5;
            } else {
                td.style.borderColor = "initial";
                td.style.scale = "initial";
            }
        });
    });
}
