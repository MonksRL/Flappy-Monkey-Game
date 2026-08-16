"""Build the compact, distributable Control Panel item-icon atlas."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "github-server-upload" / "cheat-control-catalog.json"
OUTPUT = Path(__file__).resolve().parent / "assets"
TILE = 72
PADDING = 7


def slug(value: object) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()))


def existing(*parts: str) -> Path | None:
    path = ROOT.joinpath(*parts)
    return path if path.is_file() else None


def source_for(item: dict) -> Path | None:
    category = str(item.get("category") or "")
    item_id = str(item.get("itemId") or "")
    label = str(item.get("label") or "")
    direct: list[Path | None] = []

    if category == "skins":
        direct += [existing(item_id)]
    elif category == "banners":
        direct += [
            existing("assets", "banners", "skins", f"{item_id}.png"),
            existing("assets", "banners", f"banner-{item_id}.png"),
        ]
    elif category == "auras":
        direct += [existing("assets", "auras", f"aura-{item_id}.png"), existing("assets", "auras", f"aura-{item_id}-v2.png")]
    elif category == "world_emotes":
        direct += [existing("assets", "emotes", f"emote-{item_id}.png")]
    elif category == "message_emojis":
        direct += [existing(f"{label} Emoji.png"), existing(f"{label}.png")]
    elif category == "trails":
        direct += [existing("assets", "cosmetic-icons", f"trail-{item_id}.png")]
    elif category == "explosions":
        direct += [
            existing("assets", "cosmetic-icons", f"vfx-{item_id}.png"),
            existing("index-reward-vfx.png") if item_id == "index-infinity" else None,
        ]
    elif category == "pipe_skins":
        direct += [existing("assets", "cosmetic-icons", f"pipe-{item_id}.png")]
    elif category == "themes":
        direct += [
            existing("assets", "cosmetic-icons", f"theme-{item_id}.png"),
            existing("assets", "event-vault", f"{item_id}.png"),
            existing("index-reward-theme.png") if item_id == "index-archive" else None,
        ]
    elif category == "title_styles":
        direct += [existing("assets", "cosmetic-icons", f"title-style-{item_id}.png")]
    elif category == "event_cosmetics":
        direct += [existing("assets", "event-vault", f"{item_id}.png")]
    elif category == "duel_items":
        prefix = "sword" if item.get("type") == "duel_sword" else "finisher"
        direct += [existing("assets", "duel", f"{prefix}-{item_id}.png")]
    elif category == "powerups":
        names = {
            "extraLifeTokens": "powerup-extra-life.png",
            "coinDoublerTickets": "powerup-banana-doubler.png",
            "scoreBoosterTickets": "powerup-score-booster.png",
            "xpBoostTokens": "powerup-xp-boost.png",
            "crateLuckBoostTokens": "powerup-crate-luck.png",
            "reviveTokens": "powerup-revive.png",
        }
        direct += [existing(names.get(item_id, ""))]
    elif category == "titles":
        # Most titles are paired with one specific monkey skin. Reusing that
        # real skin artwork gives every title a recognizable game icon instead
        # of an initials-only placeholder.
        html = (ROOT / "index.html").read_text(encoding="utf-8", errors="ignore")
        escaped = re.escape(item_id)
        linked = re.search(
            rf"\{{(?=[^{{}}]*\blinkedTitle\s*:\s*['\"]{escaped}['\"])(?=[^{{}}]*\bfile\s*:\s*['\"]([^'\"]+)['\"])[^{{}}]*\}}",
            html,
            flags=re.IGNORECASE,
        )
        special_titles = {
            "Flappy Monkey Developer": "Developer Monkey.png",
            "Gold Pot": "Pot O' Gold Monkey.png",
            "Season Climber": "bananascoutmonkey.png",
            "Banana VIP": "bananacommandermonkey.png",
        }
        direct += [
            existing(linked.group(1)) if linked else None,
            existing(special_titles.get(item_id, "")),
        ]
    elif category == "currencies":
        currency_icons = {
            "banana_coins": ("powerup-banana-doubler.png",),
            "xp": ("powerup-xp-boost.png",),
            "duel_coins": ("assets", "duel", "duel-coins.png"),
            "duel_xp": ("assets", "duel", "duel-xp.png"),
        }
        parts = currency_icons.get(str(item.get("type") or ""))
        direct += [existing(*parts) if parts else None]
    elif category == "crate_tickets":
        direct += [existing(f"crate-{item_id}.png")]

    for candidate in direct:
        if candidate:
            return candidate

    # Exact stem matches are safe as a final lookup. Partial matches are
    # intentionally forbidden so similarly named skins/events cannot collide.
    exact = {slug(item_id), slug(label)} - {""}
    for candidate in list(ROOT.glob("*")) + list((ROOT / "assets").rglob("*")):
        if candidate.is_file() and candidate.suffix.lower() in {".png", ".gif", ".webp", ".jpg", ".jpeg"} and slug(candidate.stem) in exact:
            return candidate
    return None


PALETTES = {
    "skins": ("#6f36d9", "#20d6b5"), "banners": ("#b33771", "#ffb142"),
    "titles": ("#7047eb", "#ffe56b"), "badges": ("#165fbb", "#63e6ff"),
    "themes": ("#263ee0", "#ca59ff"), "trails": ("#1a8e7c", "#6effc7"),
    "auras": ("#7727ad", "#ff66d9"), "world_emotes": ("#d05a23", "#ffd45c"),
    "message_emojis": ("#4755d9", "#7cf0ff"), "pipe_skins": ("#1c8271", "#ffd34e"),
    "currencies": ("#b56a00", "#fff06a"), "powerups": ("#126d99", "#60fff4"),
    "crate_tickets": ("#8c3a16", "#ffbe5c"), "duel_items": ("#9a182a", "#ffbb55"),
    "event_cosmetics": ("#9c235d", "#ff6577"), "explosions": ("#9f241c", "#ffb348"),
    "title_styles": ("#4235a8", "#ff62da"),
}

MARKS = {
    "skins": "M", "banners": "BN", "titles": "T", "badges": "BD", "themes": "TH",
    "trails": "TR", "auras": "AU", "world_emotes": "EM", "message_emojis": "☺",
    "pipe_skins": "P", "currencies": "$", "powerups": "⚡", "crate_tickets": "C",
    "duel_items": "⚔", "event_cosmetics": "EV", "explosions": "FX", "title_styles": "TS",
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    name = "seguisb.ttf" if bold else "segoeui.ttf"
    try:
        return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)
    except OSError:
        return ImageFont.load_default()


def fallback_tile(item: dict) -> Image.Image:
    category = str(item.get("category") or "")
    start, end = PALETTES.get(category, ("#352270", "#59d9bf"))
    start_rgb = tuple(int(start[index:index + 2], 16) for index in (1, 3, 5))
    end_rgb = tuple(int(end[index:index + 2], 16) for index in (1, 3, 5))
    tile = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
    layer = Image.new("RGBA", (TILE * 3, TILE * 3), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for y in range(TILE * 3):
        amount = y / max(1, TILE * 3 - 1)
        color = tuple(round(start_rgb[i] * (1 - amount) + end_rgb[i] * amount) for i in range(3)) + (255,)
        draw.line((0, y, TILE * 3, y), fill=color, width=1)
    draw.rounded_rectangle((3, 3, TILE * 3 - 4, TILE * 3 - 4), radius=20 * 3, outline=(255, 255, 255, 105), width=2 * 3)
    label_words = [word for word in re.findall(r"[A-Za-z0-9]+", str(item.get("label") or "")) if word]
    mark = MARKS.get(category) or "◆"
    if category in {"titles", "badges"} and label_words:
        mark = "".join(word[0] for word in label_words[:2]).upper()
    mark_font = font(21 * 3 if len(mark) == 1 else 16 * 3, True)
    bounds = draw.textbbox((0, 0), mark, font=mark_font)
    x = (TILE * 3 - (bounds[2] - bounds[0])) / 2
    y = (TILE * 3 - (bounds[3] - bounds[1])) / 2 - bounds[1] - 3
    draw.text((x + 2, y + 3), mark, font=mark_font, fill=(0, 0, 0, 80))
    draw.text((x, y), mark, font=mark_font, fill=(255, 255, 255, 245))
    return layer.resize((TILE, TILE), Image.Resampling.LANCZOS)


def real_tile(path: Path, item: dict) -> Image.Image:
    try:
        with Image.open(path) as opened:
            image = opened.convert("RGBA")
    except (OSError, ValueError):
        return fallback_tile(item)
    image.thumbnail((TILE - PADDING * 2, TILE - PADDING * 2), Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
    alpha = Image.new("L", (TILE, TILE), 0)
    alpha.paste(image.getchannel("A"), ((TILE - image.width) // 2, (TILE - image.height) // 2 + 2))
    blurred = alpha.filter(ImageFilter.GaussianBlur(4))
    shadow.paste((0, 0, 0, 150), (0, 0, TILE, TILE), blurred)
    shadow.alpha_composite(image, ((TILE - image.width) // 2, (TILE - image.height) // 2))
    return shadow


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    items = list(catalog.get("items") or [])
    columns = math.ceil(math.sqrt(len(items)))
    rows = math.ceil(len(items) / columns)
    atlas = Image.new("RGBA", (columns * TILE, rows * TILE), (0, 0, 0, 0))
    mapping: dict[str, list[int]] = {}
    real_count = 0
    for index, item in enumerate(items):
        path = source_for(item)
        tile = real_tile(path, item) if path else fallback_tile(item)
        real_count += int(path is not None)
        x, y = (index % columns) * TILE, (index // columns) * TILE
        atlas.alpha_composite(tile, (x, y))
        mapping[f"{item.get('type', '')}:{item.get('itemId', '')}"] = [x, y, TILE, TILE]
    if len(mapping) != len(items):
        raise RuntimeError(
            f"Catalog has {len(items)} rows but only {len(mapping)} unique icon keys; "
            "duplicate type/item IDs must be fixed before packaging."
        )
    OUTPUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUTPUT / "control-panel-icon-atlas.png", optimize=True)
    (OUTPUT / "control-panel-icon-atlas.json").write_text(json.dumps(mapping, separators=(",", ":")), encoding="utf-8")
    print(f"Built {len(items)} icons ({real_count} exact game assets, {len(items) - real_count} designed fallbacks).")


if __name__ == "__main__":
    main()
