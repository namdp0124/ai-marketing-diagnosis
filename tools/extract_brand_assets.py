"""Extract approved PDF vector paths; never redraw or recolor the character.

Requires the bundled pypdf, Pillow, numpy and Poppler pdftoppm. The source stays
untouched. Two background renders recover alpha while preserving white gloss.
"""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, RectangleObject

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
args = parser.parse_args()
original = args.source.read_bytes()
reader = PdfReader(args.source)
page = reader.pages[0]
content = page.get_contents().get_data().decode("latin1")

# Exact front-view artwork groups from YE_G_master_turnaround_v3, page 1.
# Exclude the body and its seam; keep the head, face, cheeks and original orb.
head_start = content.index("0.988 0.973 0.922 rg\nq 1 0 0 1 593.2018 575.5128 cm")
head_end = content.index("1 j 1 J \nq 1 0 0 1 379.45 251.3155 cm", head_start)
orb_start = content.index("0.835 0.945 0.949 rg\nq 1 0 0 1 466.4636 851.4193 cm")
orb_end = content.index("0.988 0.973 0.922 rg\nq 1 0 0 1 1581.2622 455.5598 cm", orb_start)
head = content[head_start:head_end]
orb = content[orb_start:orb_end]
output = Path(__file__).resolve().parents[1] / "assets" / "brand"

with tempfile.TemporaryDirectory(prefix="ye-g-vectors-") as temporary:
    temporary = Path(temporary)
    for name, artwork, bounds in (
        ("ye-g-face-transparent.png", head + orb, (194, 420, 608, 930)),
        ("ye-g-orb.png", orb, (324, 775, 478, 928)),
    ):
        renders = []
        for background in (255, 0):
            writer = PdfWriter()
            target = writer.add_page(page)
            target.mediabox = RectangleObject(bounds)
            target.cropbox = RectangleObject(bounds)
            stream = DecodedStreamObject()
            backdrop = "" if background == 255 else "q 0 0 0 rg 0 0 1920 1080 re f Q\n"
            stream.set_data((backdrop + "q /GS0 gs 0 0 0 RG 10 w\n" + artwork + "Q\n").encode("latin1"))
            target[NameObject("/Contents")] = writer._add_object(stream)
            scratch = temporary / f"{name}-{background}"
            with scratch.with_suffix(".pdf").open("wb") as handle:
                writer.write(handle)
            subprocess.run(["pdftoppm", "-png", "-singlefile", "-cropbox", "-r", "144",
                            str(scratch.with_suffix(".pdf")), str(scratch)], check=True)
            renders.append(np.asarray(Image.open(str(scratch) + ".png").convert("RGB"), dtype=float))

        white, black = renders
        alpha = np.clip(255 - np.median(white - black, axis=2), 0, 255)
        rgb = np.clip(black * 255 / np.maximum(alpha[..., None], 1), 0, 255)
        rgba = np.dstack((rgb, alpha)).round().astype("uint8")
        image = Image.fromarray(rgba)
        bounds = image.getchannel("A").getbbox()
        assert bounds, "No original artwork found"
        padding = 8
        image = image.crop((max(0, bounds[0] - padding), max(0, bounds[1] - padding),
                            min(image.width, bounds[2] + padding), min(image.height, bounds[3] + padding)))
        image.save(output / name, optimize=True)
        assert image.getpixel((0, 0))[3] == 0
        print(name, image.size, (output / name).stat().st_size, "bytes, RGBA")

assert args.source.read_bytes() == original, "Source PDF must remain unchanged"
print("Original PDF preserved; SHA256:", hashlib.sha256(original).hexdigest())
