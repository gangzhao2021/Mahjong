"""
Placeholder app icons: a mahjong tile (five of Dots) on green felt.
Drawn with shapes only (no fonts). Replace with designed artwork before release;
rerun with `python scripts/generate-icons.py` (needs Pillow).
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'assets'
FELT = (31, 107, 71, 255)
TILE = (251, 247, 236, 255)
EDGE = (207, 198, 173, 255)
RED = (179, 38, 30, 255)
GREEN = (30, 122, 60, 255)
BLUE = (29, 79, 154, 255)
SS = 4  # supersampling for smooth edges


def tile(size: int, color=None, shadow=True) -> Image.Image:
    """A tile filling `size` px (with its own aspect ratio), drawn at SS× and downsampled."""
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = int(s * 0.62)
    h = int(w * 1.36)
    x0, y0 = (s - w) // 2, (s - h) // 2
    r = int(w * 0.12)
    if shadow and color is None:
        d.rounded_rectangle((x0 + s * 0.015, y0 + s * 0.03, x0 + w + s * 0.015, y0 + h + s * 0.03), r, fill=(0, 0, 0, 70))
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), r, fill=color or EDGE)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h - int(h * 0.05)), r, fill=color or TILE)
    # Five of Dots: four corners and the centre.
    cx, cy = x0 + w / 2, y0 + (h - h * 0.05) / 2
    dx, dy, rad = w * 0.24, h * 0.24, w * 0.15
    dots = [(cx - dx, cy - dy, BLUE), (cx + dx, cy - dy, GREEN), (cx - dx, cy + dy, GREEN), (cx + dx, cy + dy, BLUE), (cx, cy, RED)]
    for x, y, c in dots:
        fill = (0, 0, 0, 0) if color else c
        d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=fill)
        if not color:
            inner = rad * 0.45
            d.ellipse((x - inner, y - inner, x + inner, y + inner), fill=TILE)
    return img.resize((size, size), Image.LANCZOS)


def on_felt(size: int, scale: float = 1.0) -> Image.Image:
    bg = Image.new('RGBA', (size, size), FELT)
    t = tile(int(size * scale))
    bg.alpha_composite(t, ((size - t.width) // 2, (size - t.height) // 2))
    return bg


on_felt(1024).convert('RGB').save(OUT / 'icon.png')
tile(1024).save(OUT / 'splash-icon.png')
# Android adaptive icon: the system crops to a circle / squircle inside the middle ~66%.
def centered(img: Image.Image, size: int) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


centered(tile(340), 512).save(OUT / 'android-icon-foreground.png')
Image.new('RGBA', (512, 512), FELT).save(OUT / 'android-icon-background.png')
centered(tile(340, color=(255, 255, 255, 255), shadow=False), 512).save(OUT / 'android-icon-monochrome.png')
on_felt(48).save(OUT / 'favicon.png')
print(f'Icons written to {OUT}')
