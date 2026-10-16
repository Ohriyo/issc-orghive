"""Tile check-responsive screenshots (and optionally a design/ PNG) into one image to review.

    python .claude/skills/orghive-responsive/scripts/contact-sheet.py <out-dir> <route-file-stem> \
        [--design design/college-cea.png] [--full]

<route-file-stem> is the screenshot name without the width, e.g. "colleges_cea" or "home".
Writes <out-dir>/<stem>-sheet.png. Needs Pillow (pip install pillow).
"""

import argparse
import glob
import os
import re

from PIL import Image, ImageDraw

HEIGHT = 520


def tile(path: str, label: str, crop_ratio: float | None) -> Image.Image:
    im = Image.open(path).convert("RGB")
    if crop_ratio:  # Full-page shots: keep the top part so tiles stay readable.
        im = im.crop((0, 0, im.width, min(im.height, int(im.width * crop_ratio))))
    im = im.resize((max(1, int(im.width * HEIGHT / im.height)), HEIGHT))
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, 8 * len(label) + 8, 18), fill="black")
    draw.text((4, 3), label, fill="yellow")
    return im


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("stem")
    parser.add_argument("--design")
    parser.add_argument("--full", action="store_true", help="use the full-page screenshots")
    args = parser.parse_args()

    suffix = "-full.png" if args.full else ".png"
    shots = []
    for path in glob.glob(os.path.join(args.out, "shots", f"{args.stem}-*{suffix}")):
        match = re.search(rf"{re.escape(args.stem)}-(\d+){re.escape(suffix)}$", path)
        if match and (args.full or not path.endswith("-full.png")):
            shots.append((int(match.group(1)), path))
    if not shots:
        raise SystemExit(f"No screenshots for '{args.stem}' in {args.out}/shots")

    tiles = []
    if args.design:
        tiles.append(tile(args.design, f"DESIGN {os.path.basename(args.design)}", None))
    for width, path in sorted(shots):
        tiles.append(tile(path, f"{width}px", 1.8 if args.full else None))

    sheet = Image.new("RGB", (sum(t.width for t in tiles) + 8 * (len(tiles) - 1), HEIGHT), "magenta")
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0))
        x += t.width + 8
    target = os.path.join(args.out, f"{args.stem}-sheet.png")
    sheet.save(target)
    print(target)


if __name__ == "__main__":
    main()
