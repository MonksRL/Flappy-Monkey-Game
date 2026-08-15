"""Generate a distinct, themed icon for every skin-linked player banner.

The generated art deliberately uses the matching skin sprite rather than a generic
monkey.  Menu backgrounds are used as soft environmental backdrops when present,
then deterministic particles and framing are added so every banner owns a real
asset instead of pointing at the raw skin PNG.
"""

from __future__ import annotations

import colorsys
import hashlib
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
OUTPUT = ROOT / "assets" / "banners" / "skins"
SIZE = 320


def slug(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


def prop(block: str, name: str) -> str:
    match = re.search(rf'\b{name}\s*:\s*"((?:\\.|[^"\\])*)"', block, re.S)
    if not match:
        match = re.search(rf"\b{name}\s*:\s*'((?:\\.|[^'\\])*)'", block, re.S)
    if not match:
        return ""
    return match.group(1).replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\").strip()


def parse_skin_catalog() -> list[dict[str, str]]:
    source = INDEX.read_text(encoding="utf-8")
    start = source.index("const monkeySkins = [")
    end = source.index("\n        ];", start)
    catalog = source[start:end]
    blocks = re.split(r"(?=\{\s*name\s*:)", catalog)
    skins: list[dict[str, str]] = []
    for block in blocks:
        name = prop(block, "name")
        file_name = prop(block, "file")
        if not name or not file_name:
            continue
        rarity = prop(block, "rarity").lower()
        unlock_type = prop(block, "unlockType")
        excluded = (
            rarity in {"sockmonkey", "developer", "icon"}
            or name in {"MonksRL", "Giuze", "Lizzy Monkey", "ChillPenguin91"}
            or any(re.search(rf"\b{flag}\s*:\s*true", block) for flag in ("developerOnly", "ownerOnly", "adminOnly", "grantOnly"))
            or unlock_type == "developerGrant"
        )
        if not excluded:
            skins.append(
                {
                    "name": name,
                    "file": file_name,
                    "menu_bg": prop(block, "menuBg"),
                    "rarity": rarity or "common",
                }
            )
    return skins


def palette(name: str) -> tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]:
    seed = int.from_bytes(hashlib.sha256(name.encode("utf-8")).digest()[:8], "big")
    hue = (seed % 360) / 360.0
    c1 = colorsys.hsv_to_rgb(hue, 0.78, 0.19)
    c2 = colorsys.hsv_to_rgb((hue + 0.10) % 1.0, 0.70, 0.46)
    accent = colorsys.hsv_to_rgb((hue + 0.31) % 1.0, 0.58, 1.0)
    convert = lambda rgb: tuple(round(channel * 255) for channel in rgb)
    return convert(c1), convert(c2), convert(accent)


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    source = image.convert("RGBA")
    scale = max(size[0] / source.width, size[1] / source.height)
    resized = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def gradient(first: tuple[int, int, int], second: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE))
    pixels = image.load()
    for y in range(SIZE):
        t = y / max(1, SIZE - 1)
        for x in range(SIZE):
            diagonal = min(1.0, max(0.0, t * 0.72 + (x / SIZE) * 0.28))
            pixels[x, y] = tuple(round(first[i] * (1 - diagonal) + second[i] * diagonal) for i in range(3)) + (255,)
    return image


def make_icon(skin: dict[str, str]) -> Path | None:
    sprite_path = ROOT / skin["file"]
    if not sprite_path.exists():
        return None

    first, second, accent = palette(skin["name"])
    canvas = gradient(first, second)

    background_path = ROOT / skin["menu_bg"] if skin["menu_bg"] else None
    if background_path and background_path.exists():
        background = cover(Image.open(background_path), (SIZE, SIZE))
        background = ImageEnhance.Color(background).enhance(1.12).filter(ImageFilter.GaussianBlur(2.2))
        background.putalpha(150)
        canvas.alpha_composite(background)

    # Soft radial glow behind the exact matching skin.
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    for radius in range(118, 18, -4):
        alpha = round(2 + (118 - radius) * 0.42)
        glow_draw.ellipse((SIZE // 2 - radius, 172 - radius, SIZE // 2 + radius, 172 + radius), fill=(*accent, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(11))
    canvas.alpha_composite(glow)

    seed = int.from_bytes(hashlib.sha256((skin["name"] + "-particles").encode("utf-8")).digest()[:8], "big")
    details = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(details)
    for index in range(34):
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        x = 18 + seed % (SIZE - 36)
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        y = 18 + seed % (SIZE - 36)
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        radius = 1 + seed % 5
        alpha = 80 + seed % 130
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*accent, alpha))
    draw.rounded_rectangle((10, 10, SIZE - 10, SIZE - 10), radius=38, outline=(*accent, 210), width=5)
    draw.rounded_rectangle((20, 20, SIZE - 20, SIZE - 20), radius=30, outline=(255, 255, 255, 55), width=2)
    canvas.alpha_composite(details)

    sprite = Image.open(sprite_path).convert("RGBA")
    bounds = sprite.getbbox()
    if bounds:
        sprite = sprite.crop(bounds)
    max_width, max_height = 205, 218
    scale = min(max_width / sprite.width, max_height / sprite.height, 1.65)
    sprite = sprite.resize((max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))), Image.Resampling.LANCZOS)

    shadow = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
    shadow.putalpha(sprite.getchannel("A"))
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    shadow_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    x = (SIZE - sprite.width) // 2
    y = max(38, SIZE - sprite.height - 28)
    shadow_layer.alpha_composite(shadow, (x + 7, y + 10))
    canvas.alpha_composite(shadow_layer)
    canvas.alpha_composite(sprite, (x, y))

    OUTPUT.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT / f"skin-{slug(skin['name'])}.png"
    canvas.save(destination, optimize=True)
    return destination


def main() -> None:
    skins = parse_skin_catalog()
    generated = [path for skin in skins if (path := make_icon(skin))]
    print(f"Generated {len(generated)} of {len(skins)} eligible skin banner icons in {OUTPUT}")


if __name__ == "__main__":
    main()
