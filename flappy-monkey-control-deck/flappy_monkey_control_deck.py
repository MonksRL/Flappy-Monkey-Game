"""Flappy Monkey Control Panel.

This desktop client intentionally contains no Discord client secret, bot token,
or authorization signing secret.  Discord membership, roles, access codes, and
every game mutation are verified by the Flappy Monkey multiplayer server.
"""

from __future__ import annotations

import base64
import ctypes
from ctypes import wintypes
import io
import json
import math
import os
from pathlib import Path
import queue
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import tkinter as tk
from tkinter import colorchooser, filedialog, messagebox, ttk
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

try:
    from PIL import Image, ImageDraw, ImageOps, ImageTk
except ImportError:  # The app remains usable; remote avatars use initials.
    Image = ImageDraw = ImageOps = ImageTk = None


APP_NAME = "Flappy Monkey Control Panel"
APP_VERSION = "1.9.1"
DEFAULT_SERVER = "https://flappy-monkey-server.onrender.com"
DEFAULT_INVITE = "https://discord.gg/HCmAVTNtNe"
ALLOWED_ROLES = (
    "Flappy Monkey Developer",
    "Flappy Monkey Admin",
    "Flappy Monkey Exploiter",
)

THEMES = {
    "banana_coast": {
        "name": "Banana Coast",
        "short": "Banana Coast",
        "scene": "coast",
        "bg": "#110817", "bg2": "#1b0c20", "sidebar": "#150918",
        "panel": "#2a1227", "panel2": "#38182f", "panel3": "#52213b",
        "stroke": "#6b3047", "stroke2": "#b45b5c", "text": "#fff8ea",
        "muted": "#d3b8b4", "faint": "#8f6c73", "purple": "#d94f2b",
        "purple2": "#ff9a4a", "teal": "#67e8c7", "yellow": "#ffe16b",
        "red": "#ff667b", "green": "#61e99d", "grid": "#32152e",
        "orb1": "#6b183d", "orb2": "#6f3614", "ribbon": "#d64932",
    },
    "cosmic_grape": {
        "name": "Cosmic Grape",
        "short": "Cosmic Grape",
        "scene": "cosmic",
        "bg": "#0b0318", "bg2": "#160725", "sidebar": "#10051e",
        "panel": "#24103b", "panel2": "#321552", "panel3": "#472072",
        "stroke": "#613587", "stroke2": "#a267ca", "text": "#fff8ff",
        "muted": "#ccb9da", "faint": "#8d729d", "purple": "#7438ba",
        "purple2": "#d286ff", "teal": "#61e5cd", "yellow": "#fff06d",
        "red": "#ff6885", "green": "#62eca0", "grid": "#2a1245",
        "orb1": "#6321a4", "orb2": "#0a6a62", "ribbon": "#9c47dd",
    },
    "neon_jungle": {
        "name": "Neon Jungle",
        "short": "Neon Jungle",
        "scene": "jungle",
        "bg": "#04110d", "bg2": "#071b14", "sidebar": "#06150f",
        "panel": "#0d2a1e", "panel2": "#123a29", "panel3": "#195039",
        "stroke": "#246b4b", "stroke2": "#3ca875", "text": "#f1fff7",
        "muted": "#a5ceb8", "faint": "#628a72", "purple": "#20a96f",
        "purple2": "#58ed9d", "teal": "#42f1d1", "yellow": "#f5e66b",
        "red": "#ff6c78", "green": "#5ef0a0", "grid": "#0d3022",
        "orb1": "#11552e", "orb2": "#086054", "ribbon": "#28b66f",
    },
    "sunset_arcade": {
        "name": "Sunset Arcade",
        "short": "Sunset Arcade",
        "scene": "sunset",
        "bg": "#130713", "bg2": "#210b1d", "sidebar": "#190817",
        "panel": "#32112b", "panel2": "#47173a", "panel3": "#61204c",
        "stroke": "#83345e", "stroke2": "#c65d88", "text": "#fff5fb",
        "muted": "#ddb2cd", "faint": "#96677f", "purple": "#e03d86",
        "purple2": "#ff82bd", "teal": "#5de8df", "yellow": "#ffd36b",
        "red": "#ff5d72", "green": "#63e99e", "grid": "#37112d",
        "orb1": "#7d194f", "orb2": "#7b3518", "ribbon": "#df3b87",
    },
}
DEFAULT_THEME = "cosmic_grape"
COLORS = dict(THEMES[DEFAULT_THEME])


def resource_root() -> Path:
    """Return the repository root or PyInstaller's unpacked resource root."""
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        return Path(bundled)
    return Path(__file__).resolve().parent.parent


def resource_path(*parts: str) -> Path:
    return resource_root().joinpath(*parts)


def activate_theme(theme_id: str) -> str:
    selected = theme_id if theme_id in THEMES else DEFAULT_THEME
    COLORS.clear()
    COLORS.update(THEMES[selected])
    return selected


def blend_color(first: str, second: str, amount: float) -> str:
    amount = max(0.0, min(1.0, amount))
    first_rgb = tuple(int(first[index:index + 2], 16) for index in (1, 3, 5))
    second_rgb = tuple(int(second[index:index + 2], 16) for index in (1, 3, 5))
    mixed = tuple(round(a + (b - a) * amount) for a, b in zip(first_rgb, second_rgb))
    return "#" + "".join(f"{channel:02x}" for channel in mixed)


def humanize(value: str) -> str:
    words = re.sub(r"[-_]+", " ", str(value or "")).strip().split()
    return " ".join(word.upper() if word.lower() in {"xp", "rgb", "pvp"} else word.capitalize() for word in words)


def slugify(value: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()))


def app_data_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home())
    directory = base / "FlappyMonkeyControlDeck"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


class AppConfig:
    def __init__(self) -> None:
        self.path = app_data_dir() / "config.json"
        self.data = {
            "server_url": DEFAULT_SERVER,
            "invite_url": DEFAULT_INVITE,
            "target_user_id": "",
            "accent": COLORS["purple"],
            "profile_banner": "",
            "theme": DEFAULT_THEME,
            "theme_selected": False,
        }
        try:
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                self.data.update({key: value for key, value in loaded.items() if key in self.data})
        except (OSError, ValueError):
            pass

    def save(self) -> None:
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        temporary.replace(self.path)


class SecureTokenStore:
    """Uses Windows DPAPI so the bearer token is encrypted for this user."""

    class DataBlob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def __init__(self) -> None:
        self.path = app_data_dir() / "session.bin"

    @staticmethod
    def _blob(data: bytes) -> tuple["SecureTokenStore.DataBlob", ctypes.Array]:
        buffer = ctypes.create_string_buffer(data)
        return SecureTokenStore.DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char))), buffer

    def save(self, token: str) -> None:
        if os.name != "nt":
            self.path.write_bytes(base64.b64encode(token.encode("utf-8")))
            return
        source, source_buffer = self._blob(token.encode("utf-8"))
        output = self.DataBlob()
        result = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(source), "Flappy Monkey Control Panel", None, None, None, 0, ctypes.byref(output)
        )
        del source_buffer
        if not result:
            raise ctypes.WinError()
        try:
            self.path.write_bytes(ctypes.string_at(output.pbData, output.cbData))
        finally:
            ctypes.windll.kernel32.LocalFree(output.pbData)

    def load(self) -> str:
        try:
            encrypted = self.path.read_bytes()
        except OSError:
            return ""
        if os.name != "nt":
            try:
                return base64.b64decode(encrypted).decode("utf-8")
            except (ValueError, UnicodeError):
                return ""
        source, source_buffer = self._blob(encrypted)
        output = self.DataBlob()
        description = wintypes.LPWSTR()
        result = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(source), ctypes.byref(description), None, None, None, 0, ctypes.byref(output)
        )
        del source_buffer
        if not result:
            return ""
        try:
            return ctypes.string_at(output.pbData, output.cbData).decode("utf-8")
        finally:
            ctypes.windll.kernel32.LocalFree(output.pbData)
            if description:
                ctypes.windll.kernel32.LocalFree(description)

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


class ApiError(RuntimeError):
    def __init__(self, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.status = status


class ControlDeckApi:
    def __init__(self, base_url: str, token: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, payload: dict | None = None, authenticated: bool = True) -> dict:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "User-Agent": f"FlappyMonkeyControlDeck/{APP_VERSION}",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        if authenticated and self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(f"{self.base_url}{path}", data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8")).get("error", "")
            except (ValueError, UnicodeError):
                detail = ""
            raise ApiError(detail or f"Server returned HTTP {error.code}.", error.code) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            reason = getattr(error, "reason", error)
            raise ApiError(f"Could not reach the Flappy Monkey server: {reason}") from error


class AnimatedBackdrop(tk.Canvas):
    def __init__(self, master: tk.Misc) -> None:
        super().__init__(master, bg=COLORS["bg"], highlightthickness=0)
        self.motion = 0.0
        self.particles = [
            {
                "x": random.random(),
                "y": random.random(),
                "r": random.choice((1, 1, 1, 2, 2, 3)),
                "speed": random.uniform(.00007, .00030),
                "drift": random.uniform(5.0, 15.0),
                "phase": random.random() * math.tau,
            }
            for _ in range(42)
        ]
        self.comet_progress = random.random()
        self.bind("<Configure>", lambda _event: self.redraw())
        self.after(64, self.tick)

    def tick(self) -> None:
        self.motion = (self.motion + .018) % math.tau
        self.comet_progress += .0035
        if self.comet_progress > 1.35:
            self.comet_progress = -.25
        for particle in self.particles:
            particle["y"] += particle["speed"]
            particle["phase"] += .018
            if particle["y"] > 1.03:
                particle["y"] = -.03
                particle["x"] = random.random()
        self.redraw()
        self.after(64, self.tick)

    def _glow_orb(self, x: float, y: float, radius: float, palette: tuple[str, ...]) -> None:
        layers = len(palette)
        for index, color in enumerate(palette):
            scale = 1.0 - (index / (layers + 1)) * .72
            layer_radius = radius * scale
            self.create_oval(
                x - layer_radius,
                y - layer_radius,
                x + layer_radius,
                y + layer_radius,
                fill=color,
                outline="",
                tags=("backdrop_art",),
            )

    def redraw(self) -> None:
        # Only replace the animated artwork.  The Control Panel UI is embedded in
        # this canvas as a window item, so deleting every canvas item also
        # deleted the complete interface on the first animation frame.
        self.delete("backdrop_art")
        width, height = max(1, self.winfo_width()), max(1, self.winfo_height())

        gradient = tuple(blend_color(COLORS["bg"], COLORS["bg2"], amount) for amount in (.0, .22, .48, .72, .45, .12))
        band_height = max(1, math.ceil(height / len(gradient)))
        for index, color in enumerate(gradient):
            self.create_rectangle(
                0,
                index * band_height,
                width,
                min(height, (index + 1) * band_height + 1),
                fill=color,
                outline="",
                tags=("backdrop_art",),
            )

        pulse = math.sin(self.motion) * 22
        self._glow_orb(
            -20 + pulse,
            height * .18,
            330,
            tuple(blend_color(COLORS["bg"], COLORS["orb1"], amount) for amount in (.20, .40, .66, 1.0)),
        )
        self._glow_orb(
            width + 35 - pulse,
            height * .86,
            390,
            tuple(blend_color(COLORS["bg"], COLORS["orb2"], amount) for amount in (.20, .40, .66, 1.0)),
        )
        scene = str(COLORS.get("scene") or "cosmic")
        if scene == "cosmic":
            horizon = height * .64
            for index in range(-8, 9):
                x = width * .5 + index * width * .075
                self.create_line(width * .5, horizon, x, height, fill=COLORS["grid"], width=1, tags=("backdrop_art",))
            for row in range(6):
                progress = row / 6
                y = horizon + (progress ** 1.75) * (height - horizon)
                self.create_line(0, y, width, y, fill=COLORS["grid"], width=1, tags=("backdrop_art",))
            ribbon_points: list[float] = []
            for step in range(9):
                x = -80 + step * (width + 160) / 8
                y = height * .24 + math.sin(self.motion + step * .78) * 30 + step * 3
                ribbon_points.extend((x, y))
            self.create_line(*ribbon_points, fill=blend_color(COLORS["bg"], COLORS["ribbon"], .32), width=20, smooth=True, splinesteps=24, tags=("backdrop_art",))
            self.create_line(*ribbon_points, fill=COLORS["ribbon"], width=2, smooth=True, splinesteps=24, tags=("backdrop_art",))
            orbit_x = width * .79 + math.cos(self.motion * .55) * 8
            orbit_y = height * .25 + math.sin(self.motion * .55) * 7
            self.create_oval(orbit_x - 145, orbit_y - 48, orbit_x + 145, orbit_y + 48, outline=blend_color(COLORS["bg"], COLORS["stroke2"], .55), width=1, tags=("backdrop_art",))
            self.create_oval(orbit_x - 104, orbit_y - 104, orbit_x + 104, orbit_y + 104, outline=blend_color(COLORS["bg"], COLORS["teal"], .35), width=1, tags=("backdrop_art",))
        elif scene == "coast":
            horizon = height * .58
            self.create_oval(width * .72 - 74, horizon - 220, width * .72 + 74, horizon - 72, fill=blend_color(COLORS["yellow"], COLORS["purple2"], .18), outline="", tags=("backdrop_art",))
            for wave in range(8):
                wave_points: list[float] = []
                for step in range(13):
                    x = -30 + step * (width + 60) / 12
                    y = horizon + wave * 24 + math.sin(self.motion * 1.4 + step * .72 + wave * .55) * (7 + wave)
                    wave_points.extend((x, y))
                self.create_line(*wave_points, fill=blend_color(COLORS["grid"], COLORS["teal"], wave / 12), width=2, smooth=True, splinesteps=20, tags=("backdrop_art",))
            for index in range(7):
                banana_x = ((index * 217 + self.motion * 31) % (width + 120)) - 60
                banana_y = 90 + (index % 3) * 95 + math.sin(self.motion + index) * 18
                self.create_arc(banana_x - 22, banana_y - 12, banana_x + 22, banana_y + 25, start=205, extent=138, style="arc", outline=COLORS["yellow"], width=5, tags=("backdrop_art",))
                self.create_arc(banana_x - 14, banana_y - 7, banana_x + 15, banana_y + 17, start=205, extent=134, style="arc", outline=blend_color(COLORS["yellow"], COLORS["purple2"], .45), width=2, tags=("backdrop_art",))
        elif scene == "jungle":
            for side in (0, 1):
                base_x = 18 if side == 0 else width - 18
                vine_points: list[float] = []
                for step in range(9):
                    direction = 1 if side == 0 else -1
                    vine_points.extend((base_x + direction * (28 + math.sin(self.motion + step) * 19), -20 + step * (height + 40) / 8))
                self.create_line(*vine_points, fill=COLORS["purple2"], width=5, smooth=True, splinesteps=24, tags=("backdrop_art",))
                for step in range(1, 8):
                    direction = 1 if side == 0 else -1
                    leaf_x = base_x + direction * (40 + math.sin(self.motion + step) * 20)
                    leaf_y = step * height / 8
                    self.create_oval(leaf_x - 18, leaf_y - 8, leaf_x + 18, leaf_y + 8, fill=blend_color(COLORS["panel2"], COLORS["teal"], .52), outline=COLORS["teal"], width=1, tags=("backdrop_art",))
            for ring in range(4):
                radius = 90 + ring * 48 + math.sin(self.motion + ring) * 8
                self.create_oval(width * .5 - radius, height * .52 - radius, width * .5 + radius, height * .52 + radius, outline=blend_color(COLORS["bg"], COLORS["green"], .24 + ring * .08), width=2, tags=("backdrop_art",))
        else:  # Sunset Arcade
            sun_x, sun_y = width * .76, height * .32
            for ring in range(5, 0, -1):
                radius = 46 + ring * 22 + math.sin(self.motion + ring) * 3
                self.create_oval(sun_x - radius, sun_y - radius, sun_x + radius, sun_y + radius, fill=blend_color(COLORS["bg"], COLORS["yellow"], .12 * ring), outline="", tags=("backdrop_art",))
            for stripe in range(12):
                y = height * .58 + stripe * 18 + math.sin(self.motion * 1.2 + stripe) * 3
                self.create_line(0, y, width, y, fill=blend_color(COLORS["grid"], COLORS["purple2"], stripe / 20), width=2, tags=("backdrop_art",))
            for cloud in range(5):
                cx = ((cloud * 310 + self.motion * 34) % (width + 260)) - 130
                cy = 120 + (cloud % 3) * 105
                cloud_color = blend_color(COLORS["bg"], COLORS["panel3"], .72)
                self.create_oval(cx - 62, cy - 16, cx + 62, cy + 20, fill=cloud_color, outline="", tags=("backdrop_art",))
                self.create_oval(cx - 36, cy - 32, cx + 18, cy + 15, fill=cloud_color, outline="", tags=("backdrop_art",))

        # The embedded Tk frame itself cannot be transparent.  This rounded
        # underlay matches the frame's corner color and extends beyond it, so
        # no rectangular frame pixels can show through at the four corners.
        _rounded_rectangle(
            self,
            16,
            16,
            width - 16,
            height - 16,
            25,
            fill=COLORS["bg"],
            outline=blend_color(COLORS["stroke"], COLORS["purple2"], .28),
            width=1,
            tags=("backdrop_art",),
        )

        for particle in self.particles:
            x = particle["x"] * width + math.sin(particle["phase"]) * particle["drift"]
            y = particle["y"] * height
            radius = particle["r"]
            color = COLORS["teal"] if radius == 3 else COLORS["purple2"] if radius == 2 else COLORS["faint"]
            self.create_oval(
                x - radius,
                y - radius,
                x + radius,
                y + radius,
                fill=color,
                outline="",
                tags=("backdrop_art",),
            )

        if scene == "cosmic":
            comet_x = self.comet_progress * (width + 280) - 140
            comet_y = height * .13 + self.comet_progress * height * .28
            self.create_line(comet_x - 95, comet_y - 45, comet_x, comet_y, fill=blend_color(COLORS["bg"], COLORS["stroke2"], .6), width=2, tags=("backdrop_art",))
            self.create_line(comet_x - 42, comet_y - 20, comet_x, comet_y, fill=COLORS["teal"], width=2, tags=("backdrop_art",))
            self.create_oval(comet_x - 3, comet_y - 3, comet_x + 3, comet_y + 3, fill="#eafffa", outline="", tags=("backdrop_art",))
        self.tag_lower("backdrop_art")


def _rounded_rectangle(canvas: tk.Canvas, x1: float, y1: float, x2: float, y2: float, radius: float, **kwargs) -> int:
    radius = max(2, min(radius, (x2 - x1) / 2, (y2 - y1) / 2))
    points: list[float] = []
    # Explicit arc samples render consistently across the Windows Tk builds.
    # The former smoothed duplicate-point polygon could collapse into a sharp
    # 90-degree corner on some versions of Tk.
    for center_x, center_y, start_angle in (
        (x2 - radius, y1 + radius, -90),
        (x2 - radius, y2 - radius, 0),
        (x1 + radius, y2 - radius, 90),
        (x1 + radius, y1 + radius, 180),
    ):
        for step in range(7):
            angle = math.radians(start_angle + step * 15)
            points.extend((center_x + math.cos(angle) * radius, center_y + math.sin(angle) * radius))
    return canvas.create_polygon(points, smooth=False, joinstyle=tk.ROUND, **kwargs)


class ModernButton(tk.Canvas):
    """A rounded, animated Canvas button with keyboard support."""

    def __init__(
        self,
        master: tk.Misc,
        text: str,
        command=None,
        accent: bool = False,
        danger: bool = False,
        width: int = 0,
        align: str = "center",
        enabled: bool = True,
    ) -> None:
        try:
            surface = str(getattr(master, "surface_color", master.cget("bg")))
        except tk.TclError:
            surface = COLORS["panel"]
        requested_width = width * 9 + 36 if width else max(106, len(text) * 8 + 36)
        super().__init__(
            master,
            width=requested_width,
            height=44,
            bg=surface,
            highlightthickness=0,
            bd=0,
            cursor="hand2",
            takefocus=1,
        )
        self.button_text = text
        self.command = command
        self.align = align
        self.variant = "danger" if danger else "accent" if accent else "neutral"
        self.enabled = bool(enabled)
        self.hovered = False
        self.hover_progress = 0.0
        self.pressed = False
        self.focused = False
        self._hover_after_id = None
        self._art_photo = None
        self.bind("<Configure>", lambda _event: self._draw())
        self.bind("<Enter>", self._enter)
        self.bind("<Leave>", self._leave)
        self.bind("<ButtonPress-1>", self._press)
        self.bind("<ButtonRelease-1>", self._release)
        self.bind("<FocusIn>", self._focus_in)
        self.bind("<FocusOut>", self._focus_out)
        self.bind("<Return>", self._keyboard_activate)
        self.bind("<space>", self._keyboard_activate)
        self.after_idle(self._draw)

    def _palette(self) -> tuple[str, str, str, str]:
        if not self.enabled:
            disabled = blend_color(COLORS["panel2"], COLORS["bg"], .5)
            return disabled, disabled, blend_color(COLORS["stroke"], COLORS["bg"], .38), blend_color(disabled, "#000000", .42)
        if self.variant == "accent":
            return (
                COLORS["purple"],
                blend_color(COLORS["purple"], "#ffffff", .18),
                COLORS["purple2"],
                blend_color(COLORS["purple"], "#000000", .48),
            )
        if self.variant == "danger":
            return (
                blend_color(COLORS["red"], COLORS["bg"], .68),
                blend_color(COLORS["red"], COLORS["bg"], .48),
                COLORS["red"],
                blend_color(COLORS["red"], "#000000", .72),
            )
        return (
            COLORS["panel2"],
            COLORS["panel3"],
            COLORS["stroke2"],
            blend_color(COLORS["panel2"], "#000000", .48),
        )

    def _draw(self) -> None:
        self.delete("button_art")
        width = max(20, self.winfo_width())
        height = max(20, self.winfo_height())
        base, hover, border, shadow = self._palette()
        body = blend_color(base, hover, self.hover_progress)
        if self.pressed:
            body = shadow
        y_offset = 2 if self.pressed else 0
        if Image is not None and ImageTk is not None:
            scale = 4
            art = Image.new("RGBA", (width * scale, height * scale), (0, 0, 0, 0))
            draw = ImageDraw.Draw(art)
            if self.hover_progress > .02:
                glow = blend_color(str(self.cget("bg")), border, min(.72, self.hover_progress * .62))
                draw.rounded_rectangle((1 * scale, 1 * scale, (width - 2) * scale, (height - 2) * scale), radius=14 * scale, outline=glow, width=2 * scale)
            draw.rounded_rectangle((3 * scale, 5 * scale, (width - 3) * scale, (height - 1) * scale), radius=12 * scale, fill=shadow)
            draw.rounded_rectangle(
                (2 * scale, (2 + y_offset) * scale, (width - 3) * scale, (height - 4 + y_offset) * scale),
                radius=12 * scale,
                fill=body,
                outline=COLORS["teal"] if self.focused else border,
                width=(2 if self.focused else 1) * scale,
            )
            art = art.resize((width, height), Image.Resampling.LANCZOS)
            self._art_photo = ImageTk.PhotoImage(art)
            self.create_image(0, 0, image=self._art_photo, anchor="nw", tags=("button_art",))
        else:
            _rounded_rectangle(self, 3, 5, width - 3, height - 1, 12, fill=shadow, outline="", tags=("button_art",))
            _rounded_rectangle(self, 2, 2 + y_offset, width - 3, height - 4 + y_offset, 12, fill=body, outline=COLORS["teal"] if self.focused else border, width=2 if self.focused else 1, tags=("button_art",))
        self.create_text(
            18 if self.align == "left" else width / 2,
            (height - 2) / 2 + y_offset,
            text=self.button_text,
            fill=COLORS["text"] if self.enabled else COLORS["faint"],
            font=("Segoe UI", 10, "bold"),
            anchor="w" if self.align == "left" else "center",
            tags=("button_art",),
        )

    def set_selected(self, selected: bool) -> None:
        self.variant = "accent" if selected else "neutral"
        self._draw()

    def set_text(self, text: str) -> None:
        self.button_text = str(text)
        self._draw()

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = bool(enabled)
        self.configure(cursor="hand2" if self.enabled else "arrow")
        self._draw()

    def _enter(self, _event=None) -> None:
        if not self.enabled:
            return
        self.hovered = True
        self._animate_hover()

    def _leave(self, _event=None) -> None:
        self.hovered = False
        self.pressed = False
        self._animate_hover()

    def _animate_hover(self) -> None:
        # The callback that scheduled this animation has now fired.  Clearing
        # the id first avoids trying to cancel the currently executing Tcl
        # callback, which could leave hover animation stuck on some Tk builds.
        self._hover_after_id = None
        target = 1.0 if self.hovered else 0.0
        difference = target - self.hover_progress
        if abs(difference) < .02:
            self.hover_progress = target
            self._draw()
            self._hover_after_id = None
            return
        self.hover_progress += difference * .28
        self._draw()
        self._hover_after_id = self.after(16, self._animate_hover)

    def _press(self, _event=None) -> None:
        if not self.enabled:
            return
        self.focus_set()
        self.pressed = True
        self._draw()

    def _release(self, event=None) -> None:
        was_pressed = self.pressed
        self.pressed = False
        self._draw()
        if self.enabled and was_pressed and event is not None and 0 <= event.x <= self.winfo_width() and 0 <= event.y <= self.winfo_height() and callable(self.command):
            self.command()

    def _focus_in(self, _event=None) -> None:
        self.focused = True
        self._draw()

    def _focus_out(self, _event=None) -> None:
        self.focused = False
        self._draw()

    def _keyboard_activate(self, _event=None) -> str:
        if self.enabled and callable(self.command):
            self.command()
        return "break"


class RoundedPanel(tk.Frame):
    """Rounded card surface that can contain regular Tk widgets."""

    def __init__(
        self,
        master: tk.Misc,
        surface: str | None = None,
        border: str | None = None,
        radius: int = 18,
    ) -> None:
        try:
            parent_color = str(getattr(master, "surface_color", master.cget("bg")))
        except tk.TclError:
            parent_color = COLORS["bg2"]
        super().__init__(master, bg=parent_color, bd=0, highlightthickness=0)
        self.surface_color = surface or COLORS["panel"]
        self.border_color = border or COLORS["stroke"]
        self.radius = radius
        self.surface_canvas = tk.Canvas(self, bg=parent_color, highlightthickness=0, bd=0)
        self.surface_canvas.place(relx=0, rely=0, relwidth=1, relheight=1)
        # The canvas is created before any card content, so Tk naturally keeps
        # later child widgets above it. Canvas.lower() expects an item id (not a
        # widget stacking request) and can crash construction on standard Tk.
        self.bind("<Configure>", self._redraw_surface)

    def _redraw_surface(self, _event=None) -> None:
        self.surface_canvas.delete("surface")
        width = max(4, self.winfo_width())
        height = max(4, self.winfo_height())
        _rounded_rectangle(
            self.surface_canvas,
            1,
            1,
            width - 2,
            height - 2,
            self.radius,
            fill=self.surface_color,
            outline=self.border_color,
            width=1,
            tags=("surface",),
        )


class ModernEntry(tk.Canvas):
    """Rounded text input with an animated focus border."""

    def __init__(self, master: tk.Misc, variable: tk.StringVar | None = None, show: str = "") -> None:
        try:
            surface = str(getattr(master, "surface_color", master.cget("bg")))
        except tk.TclError:
            surface = COLORS["panel"]
        super().__init__(master, width=270, height=50, bg=surface, highlightthickness=0, bd=0, cursor="xterm")
        self.focused = False
        self.body_color = blend_color(COLORS["bg"], COLORS["panel"], .32)
        self.entry = tk.Entry(
            self,
            textvariable=variable,
            show=show,
            bg=self.body_color,
            fg=COLORS["text"],
            insertbackground=COLORS["yellow"],
            disabledbackground=blend_color(COLORS["bg"], COLORS["panel"], .18),
            disabledforeground=COLORS["faint"],
            relief="flat",
            bd=0,
            highlightthickness=0,
            font=("Segoe UI", 11),
        )
        self.entry_window = self.create_window(16, 25, anchor="w", window=self.entry, height=30)
        self.bind("<Configure>", self._layout)
        self.bind("<Button-1>", lambda _event: self.entry.focus_set())
        self.entry.bind("<FocusIn>", self._focus_in)
        self.entry.bind("<FocusOut>", self._focus_out)
        self.after_idle(self._layout)

    def _layout(self, _event=None) -> None:
        width = max(40, self.winfo_width())
        height = max(34, self.winfo_height())
        self.delete("entry_surface")
        _rounded_rectangle(
            self,
            1,
            1,
            width - 2,
            height - 2,
            13,
            fill=self.body_color,
            outline=COLORS["purple2"] if self.focused else COLORS["stroke2"],
            width=2 if self.focused else 1,
            tags=("entry_surface",),
        )
        self.tag_lower("entry_surface")
        self.coords(self.entry_window, 16, height / 2)
        self.itemconfigure(self.entry_window, width=max(20, width - 32), height=max(22, height - 18))

    def _focus_in(self, _event=None) -> None:
        self.focused = True
        self._layout()

    def _focus_out(self, _event=None) -> None:
        self.focused = False
        self._layout()

    def set_character_width(self, characters: int) -> None:
        self.configure(width=max(90, characters * 9 + 34))

    def focus_set(self) -> None:
        self.entry.focus_set()


class ToggleSwitch(tk.Canvas):
    """Rounded on/off control that replaces the native square checkbox."""

    def __init__(self, master: tk.Misc, variable: tk.BooleanVar, command=None) -> None:
        try:
            surface = str(getattr(master, "surface_color", master.cget("bg")))
        except tk.TclError:
            surface = COLORS["panel"]
        super().__init__(master, width=72, height=38, bg=surface, highlightthickness=0, bd=0, cursor="hand2")
        self.variable = variable
        self.command = command
        self.hovered = False
        self._art_photo = None
        self.bind("<Button-1>", self._toggle)
        self.bind("<Enter>", lambda _event: self._set_hover(True))
        self.bind("<Leave>", lambda _event: self._set_hover(False))
        self.variable.trace_add("write", lambda *_args: self._draw())
        self.bind("<Configure>", lambda _event: self._draw())
        self.after_idle(self._draw)

    def _toggle(self, _event=None) -> None:
        self.variable.set(not bool(self.variable.get()))
        if callable(self.command):
            self.command()

    def _set_hover(self, hovered: bool) -> None:
        self.hovered = hovered
        self._draw()

    def _draw(self) -> None:
        self.delete("all")
        enabled = bool(self.variable.get())
        track = COLORS["green"] if enabled else blend_color(COLORS["panel3"], COLORS["stroke2"], .15 if self.hovered else 0)
        border = blend_color(track, COLORS["text"], .18 if enabled else .05)
        knob_x = 54 if enabled else 18
        if Image is not None and ImageTk is not None:
            scale = 4
            art = Image.new("RGBA", (72 * scale, 38 * scale), (0, 0, 0, 0))
            draw = ImageDraw.Draw(art)
            draw.rounded_rectangle((3 * scale, 5 * scale, 69 * scale, 33 * scale), radius=14 * scale, fill=track, outline=border, width=(2 if self.hovered else 1) * scale)
            draw.ellipse(((knob_x - 11) * scale, 8 * scale, (knob_x + 11) * scale, 30 * scale), fill=COLORS["text"], outline=COLORS["teal"] if self.hovered else COLORS["stroke2"], width=2 * scale)
            art = art.resize((72, 38), Image.Resampling.LANCZOS)
            self._art_photo = ImageTk.PhotoImage(art)
            self.create_image(0, 0, image=self._art_photo, anchor="nw")
        else:
            _rounded_rectangle(self, 3, 5, 69, 33, 14, fill=track, outline=border, width=1)
            self.create_oval(knob_x - 11, 8, knob_x + 11, 30, fill=COLORS["text"], outline=COLORS["stroke2"], width=1)


class ModernSlider(tk.Canvas):
    """Theme-aware pill slider with click and drag interaction."""

    def __init__(self, master: tk.Misc, variable: tk.DoubleVar, minimum: float, maximum: float, step: float, command=None) -> None:
        try:
            surface = str(getattr(master, "surface_color", master.cget("bg")))
        except tk.TclError:
            surface = COLORS["panel"]
        super().__init__(master, width=250, height=42, bg=surface, highlightthickness=0, bd=0, cursor="hand2")
        self.variable = variable
        self.minimum = float(minimum)
        self.maximum = float(maximum)
        self.step = max(.0001, float(step))
        self.command = command
        self.hovered = False
        self._art_photo = None
        self.variable.trace_add("write", lambda *_args: self._draw())
        self.bind("<Configure>", lambda _event: self._draw())
        self.bind("<Button-1>", self._set_from_event)
        self.bind("<B1-Motion>", self._set_from_event)
        self.bind("<ButtonRelease-1>", lambda _event: self.command() if callable(self.command) else None)
        self.bind("<Enter>", lambda _event: self._set_hover(True))
        self.bind("<Leave>", lambda _event: self._set_hover(False))
        self.after_idle(self._draw)

    def _set_from_event(self, event: tk.Event) -> None:
        width = max(50, self.winfo_width())
        ratio = max(0.0, min(1.0, (event.x - 14) / max(1, width - 28)))
        raw = self.minimum + ratio * (self.maximum - self.minimum)
        value = round((raw - self.minimum) / self.step) * self.step + self.minimum
        self.variable.set(round(max(self.minimum, min(self.maximum, value)), 6))

    def _set_hover(self, hovered: bool) -> None:
        self.hovered = hovered
        self._draw()

    def _draw(self) -> None:
        self.delete("all")
        width = max(50, self.winfo_width())
        value = max(self.minimum, min(self.maximum, float(self.variable.get())))
        ratio = 0.0 if self.maximum == self.minimum else (value - self.minimum) / (self.maximum - self.minimum)
        start, end, center = 14, width - 14, 21
        knob_x = start + ratio * (end - start)
        if Image is not None and ImageTk is not None:
            scale = 4
            art = Image.new("RGBA", (width * scale, 42 * scale), (0, 0, 0, 0))
            draw = ImageDraw.Draw(art)
            draw.rounded_rectangle((start * scale, (center - 5) * scale, end * scale, (center + 5) * scale), radius=5 * scale, fill=blend_color(COLORS["bg"], COLORS["panel"], .25), outline=COLORS["stroke2"] if self.hovered else COLORS["stroke"], width=(2 if self.hovered else 1) * scale)
            if knob_x > start + 1:
                draw.rounded_rectangle((start * scale, (center - 5) * scale, knob_x * scale, (center + 5) * scale), radius=5 * scale, fill=COLORS["purple2"])
            draw.ellipse(((knob_x - 10) * scale, (center - 10) * scale, (knob_x + 10) * scale, (center + 10) * scale), fill=COLORS["text"], outline=COLORS["teal"], width=2 * scale)
            art = art.resize((width, 42), Image.Resampling.LANCZOS)
            self._art_photo = ImageTk.PhotoImage(art)
            self.create_image(0, 0, image=self._art_photo, anchor="nw")
        else:
            _rounded_rectangle(self, start, center - 5, end, center + 5, 5, fill=blend_color(COLORS["bg"], COLORS["panel"], .25), outline=COLORS["stroke"], width=1)
            if knob_x > start + 1:
                _rounded_rectangle(self, start, center - 5, knob_x, center + 5, 5, fill=COLORS["purple2"], outline="")
            self.create_oval(knob_x - 10, center - 10, knob_x + 10, center + 10, fill=COLORS["text"], outline=COLORS["teal"], width=2)


class RoundedDropdown(tk.Canvas):
    """Fully themed dropdown; avoids the native Windows combobox popup."""

    def __init__(self, master: tk.Misc, variable: tk.StringVar, values: list[str], command=None, width: int = 190) -> None:
        try:
            surface = str(getattr(master, "surface_color", master.cget("bg")))
        except tk.TclError:
            surface = COLORS["panel"]
        super().__init__(master, width=width, height=50, bg=surface, highlightthickness=0, bd=0, cursor="hand2", takefocus=1)
        self.variable = variable
        self.values = list(values)
        self.command = command
        self.hovered = False
        self.popup: tk.Toplevel | None = None
        self._focus_before_popup: tk.Misc | None = None
        self.bind("<Button-1>", lambda _event: self.toggle())
        self.bind("<Return>", lambda _event: self.toggle())
        self.bind("<space>", lambda _event: self.toggle())
        self.bind("<Enter>", lambda _event: self._hover(True))
        self.bind("<Leave>", lambda _event: self._hover(False))
        self.bind("<Configure>", lambda _event: self._draw())
        self.variable.trace_add("write", lambda *_args: self._draw())
        self.after_idle(self._draw)

    def _hover(self, value: bool) -> None:
        self.hovered = value
        self._draw()

    def _draw(self) -> None:
        self.delete("all")
        width = max(80, self.winfo_width())
        height = max(38, self.winfo_height())
        body = blend_color(COLORS["bg"], COLORS["panel"], .34)
        border = COLORS["purple2"] if self.hovered or self.popup else COLORS["stroke2"]
        _rounded_rectangle(self, 1, 1, width - 2, height - 2, 13, fill=body, outline=border, width=2 if self.hovered or self.popup else 1)
        self.create_text(15, height / 2, text=self.variable.get(), fill=COLORS["text"], font=("Segoe UI", 10, "bold"), anchor="w")
        x = width - 18
        self.create_line(x - 5, height / 2 - 2, x, height / 2 + 3, x + 5, height / 2 - 2, fill=COLORS["yellow"], width=2, smooth=True)

    def toggle(self) -> None:
        if self.popup and self.popup.winfo_exists():
            self.close()
        else:
            self.open()

    def open(self) -> None:
        self.close()
        owner = self.winfo_toplevel()
        try:
            self._focus_before_popup = owner.focus_get()
        except tk.TclError:
            self._focus_before_popup = None
        popup = tk.Toplevel(self)
        self.popup = popup
        popup.overrideredirect(True)
        popup.configure(bg=COLORS["bg"])
        popup.transient(self.winfo_toplevel())
        x = self.winfo_rootx()
        y = self.winfo_rooty() + self.winfo_height() + 3
        menu_height = min(520, max(44, len(self.values) * 30 + 12))
        # Keep the list inside the actual app window rather than merely inside
        # the desktop. Otherwise a list near the bottom can cover the status
        # bar or appear detached from its control while the page scrolls.
        screen_bottom = min(self.winfo_screenheight() - 12, owner.winfo_rooty() + owner.winfo_height() - 12)
        if y + menu_height > screen_bottom:
            y = max(8, self.winfo_rooty() - menu_height - 3)
        popup.geometry(f"{max(190, self.winfo_width())}x{menu_height}+{x}+{y}")
        # Overrideredirect popups can otherwise open behind the main window on
        # Windows, making the control appear to do nothing.  Keep it above the
        # owner long enough for the click and selection, then release topmost.
        try:
            popup.attributes("-topmost", True)
        except tk.TclError:
            pass
        panel = RoundedPanel(popup, surface=COLORS["panel"], border=COLORS["purple2"], radius=14)
        panel.pack(fill="both", expand=True)
        body = tk.Frame(panel, bg=COLORS["panel"])
        body.pack(fill="both", expand=True, padx=6, pady=6)
        for value in self.values:
            selected = value == self.variable.get()
            row = tk.Label(body, text=("◆  " if selected else "    ") + value, fg=COLORS["yellow"] if selected else COLORS["text"], bg=COLORS["panel3"] if selected else COLORS["panel"], font=("Segoe UI", 9, "bold" if selected else "normal"), anchor="w", padx=9, pady=5, cursor="hand2")
            row.pack(fill="x")
            row.bind("<Enter>", lambda _event, widget=row: widget.configure(bg=COLORS["panel3"]))
            row.bind("<Leave>", lambda _event, widget=row, active=selected: widget.configure(bg=COLORS["panel3"] if active else COLORS["panel"]))
            row.bind("<Button-1>", lambda _event, choice=value: self.select(choice))
        popup.bind("<Escape>", lambda _event: self.close())
        def close_if_focus_left(_event=None) -> None:
            def check() -> None:
                if not popup.winfo_exists():
                    return
                focused = popup.focus_get()
                if focused is None or focused.winfo_toplevel() is not popup:
                    self.close()
            popup.after(25, check)
        popup.bind("<FocusOut>", close_if_focus_left, add=True)
        popup.lift()
        # focus_force() can strand Windows keyboard focus on a destroyed
        # borderless Toplevel. A normal focus request is sufficient for Escape
        # handling and lets us reliably restore the exact prior text field.
        try:
            popup.focus_set()
        except tk.TclError:
            pass
        owner._fm_open_dropdown = self
        popup.after(180, lambda: popup.attributes("-topmost", False) if popup.winfo_exists() else None)
        self._draw()

    def select(self, value: str) -> None:
        self.variable.set(value)
        self.close()
        if callable(self.command):
            self.command()

    def close(self) -> None:
        if self.popup and self.popup.winfo_exists():
            self.popup.destroy()
        owner = self.winfo_toplevel()
        if getattr(owner, "_fm_open_dropdown", None) is self:
            owner._fm_open_dropdown = None
        self.popup = None
        self._draw()
        previous_focus = self._focus_before_popup
        self._focus_before_popup = None
        if previous_focus is not None:
            def restore_previous_focus() -> None:
                try:
                    if previous_focus.winfo_exists():
                        previous_focus.focus_set()
                except tk.TclError:
                    pass
            owner.after_idle(restore_previous_focus)


class RoundedScrollbar(tk.Canvas):
    """Minimal rounded scrollbar with no native arrow buttons or white rails."""

    def __init__(self, master: tk.Misc, command=None, background: str = COLORS["bg2"]) -> None:
        super().__init__(master, width=15, bg=background, highlightthickness=0, bd=0, cursor="hand2")
        self.command = command
        self.first = 0.0
        self.last = 1.0
        self.drag_offset = 0.0
        self.hovered = False
        self.bind("<Configure>", lambda _event: self._draw())
        self.bind("<Button-1>", self._press)
        self.bind("<B1-Motion>", self._drag)
        self.bind("<Enter>", lambda _event: self._hover(True))
        self.bind("<Leave>", lambda _event: self._hover(False))

    def set(self, first, last) -> None:
        self.first, self.last = float(first), float(last)
        self._draw()

    def _metrics(self) -> tuple[float, float, float]:
        height = max(40, self.winfo_height())
        track = height - 8
        thumb = max(34.0, track * max(.03, self.last - self.first))
        top = 4 + (track - thumb) * self.first / max(.0001, 1.0 - (self.last - self.first))
        return top, top + thumb, track

    def _draw(self) -> None:
        self.delete("all")
        height = max(40, self.winfo_height())
        self.create_line(7, 7, 7, height - 7, fill=blend_color(COLORS["bg"], COLORS["panel"], .3), width=7, capstyle=tk.ROUND)
        if self.last - self.first < .999:
            top, bottom, _track = self._metrics()
            self.create_line(7, top, 7, bottom, fill=COLORS["purple2"] if self.hovered else COLORS["stroke2"], width=7, capstyle=tk.ROUND)

    def _hover(self, value: bool) -> None:
        self.hovered = value
        self._draw()

    def _press(self, event: tk.Event) -> None:
        top, bottom, _track = self._metrics()
        if top <= event.y <= bottom:
            self.drag_offset = event.y - top
        else:
            self.drag_offset = (bottom - top) / 2
            self._move_to(event.y)

    def _drag(self, event: tk.Event) -> None:
        self._move_to(event.y)

    def _move_to(self, y: float) -> None:
        if not callable(self.command):
            return
        top, bottom, track = self._metrics()
        thumb = bottom - top
        fraction = max(0.0, min(1.0, (y - self.drag_offset - 4) / max(1.0, track - thumb)))
        self.command("moveto", fraction)


def flat_button(
    master: tk.Misc,
    text: str,
    command=None,
    accent: bool = False,
    danger: bool = False,
    width: int = 0,
    align: str = "center",
    enabled: bool = True,
) -> ModernButton:
    return ModernButton(master, text, command=command, accent=accent, danger=danger, width=width, align=align, enabled=enabled)


def entry_widget(master: tk.Misc, variable: tk.StringVar | None = None, show: str = "") -> ModernEntry:
    return ModernEntry(master, variable=variable, show=show)


class ScrollFrame(tk.Frame):
    def __init__(self, master: tk.Misc, background: str = COLORS["bg2"]) -> None:
        super().__init__(master, bg=background)
        self.canvas = tk.Canvas(self, bg=background, highlightthickness=0)
        scrollbar = RoundedScrollbar(self, command=self.canvas.yview, background=background)
        self.content = tk.Frame(self.canvas, bg=background)
        self.window = self.canvas.create_window((0, 0), window=self.content, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)
        self.content.bind("<Configure>", lambda _event: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda event: self.canvas.itemconfigure(self.window, width=event.width))
        # Install one wheel router for the entire window.  The previous
        # enter/leave approach lost its binding whenever the pointer moved from
        # the page canvas onto a child label, card, button, or profile image.
        # Routing by pointer coordinates keeps every page scrollable without
        # accumulating stale global handlers when pages are rebuilt.
        owner = self.winfo_toplevel()
        if not hasattr(owner, "_fm_scroll_frames"):
            owner._fm_scroll_frames = []
        owner._fm_scroll_frames.append(self)
        if not getattr(owner, "_fm_scroll_wheel_bound", False):
            owner.bind_all("<MouseWheel>", lambda event, root=owner: ScrollFrame._route_wheel(root, event))
            owner._fm_scroll_wheel_bound = True
        self.bind("<Destroy>", self._destroyed, add=True)
        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def _destroyed(self, event: tk.Event) -> None:
        if event.widget is self:
            owner = self.winfo_toplevel()
            frames = getattr(owner, "_fm_scroll_frames", [])
            owner._fm_scroll_frames = [frame for frame in frames if frame is not self and frame.winfo_exists()]

    @staticmethod
    def _route_wheel(owner: tk.Misc, event: tk.Event) -> str | None:
        open_dropdown = getattr(owner, "_fm_open_dropdown", None)
        try:
            if open_dropdown is not None and open_dropdown.winfo_exists():
                open_dropdown.close()
        except tk.TclError:
            owner._fm_open_dropdown = None
        frames = []
        for frame in list(getattr(owner, "_fm_scroll_frames", [])):
            try:
                if not frame.winfo_exists() or not frame.winfo_ismapped():
                    continue
                frames.append(frame)
            except tk.TclError:
                continue
        if not frames:
            return None

        # First follow the actual widget ancestry. This is reliable over labels,
        # entries, custom buttons, images, and every other child in the page.
        selected = None
        widget = getattr(event, "widget", None)
        while widget is not None:
            selected = next((frame for frame in frames if widget is frame), None)
            if selected is not None:
                break
            try:
                widget = widget.master
            except (AttributeError, tk.TclError):
                widget = None

        # The Unlocks search/filter header is intentionally outside its results
        # canvas. When the wheel is used there, scroll the only visible page
        # scroller instead of doing nothing.
        frame = selected or frames[-1]
        frame._wheel(event)
        return "break"

    def _wheel(self, event: tk.Event) -> None:
        if not self.winfo_ismapped() or not event.delta:
            return
        # High-resolution wheels and touchpads often report 15/30/60 instead
        # of 120. int(delta / 120) rounded those events to zero, which made the
        # wheel appear to work only sometimes.
        units = max(1, int(round(abs(float(event.delta)) / 120.0)))
        self.canvas.yview_scroll(-units if event.delta > 0 else units, "units")


class ControlDeckApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.config_store = AppConfig()
        saved_theme = str(self.config_store.data.get("theme") or DEFAULT_THEME)
        self.theme_id = activate_theme(saved_theme if self.config_store.data.get("theme_selected") else DEFAULT_THEME)
        self.title(f"{APP_NAME} · {APP_VERSION}")
        self.geometry("1320x820")
        self.minsize(1080, 680)
        self.configure(bg=COLORS["bg"])
        self.ui_style = ttk.Style(self)
        try:
            self.ui_style.theme_use("clam")
        except tk.TclError:
            pass
        self._configure_widget_styles()
        try:
            icon_path = resource_path("monkey-192.png")
            self._window_icon = tk.PhotoImage(file=str(icon_path))
            self.iconphoto(True, self._window_icon)
        except tk.TclError:
            pass

        self.token_store = SecureTokenStore()
        self.api = ControlDeckApi(str(self.config_store.data["server_url"]), self.token_store.load())
        self.executor = ThreadPoolExecutor(max_workers=5, thread_name_prefix="fm-control-deck")
        self.ui_queue: queue.Queue = queue.Queue()
        self.profile: dict = {}
        self.catalog: dict = {"items": [], "categories": [], "cheats": []}
        self.account: dict = {}
        self.device: dict = {}
        self.current_page = "dashboard"
        self.page_frames: dict[str, tk.Frame] = {}
        self.nav_buttons: dict[str, ModernButton] = {}
        self.live_variables: dict[str, tk.Variable] = {}
        self.image_refs: list = []
        self.target_var = tk.StringVar(value=str(self.config_store.data["target_user_id"]))
        self.status_var = tk.StringVar(value="Starting secure access check…")
        self.search_var = tk.StringVar()
        self.category_var = tk.StringVar(value="All Items")
        self.reset_progress_var = tk.StringVar()
        self.category_label_to_id: dict[str, str] = {"All Items": "all"}
        self._poll_after_id = None
        self._access_poll_after_id = None
        self._search_after_id = None
        self._live_save_after_id = None
        self._search_trace_id = self.search_var.trace_add("write", lambda *_args: self.schedule_item_render())
        self._item_visible_limit = 18
        self._last_item_filter = None
        self._item_photo_cache: dict[tuple[str, tuple[int, int]], object] = {}
        self._remote_image_cache: dict[tuple[str, tuple[int, int], bool], object] = {}
        self._status_is_error = False
        self._restore_attempts = 0
        self._restore_after_id = None
        self._account_poll_inflight = False
        self.dashboard_stat_vars: dict[str, tuple[tk.StringVar, tk.StringVar]] = {}
        self.asset_index = self._build_asset_index()
        self._icon_atlas_image, self._icon_atlas_map = self._load_icon_atlas()

        self.backdrop = AnimatedBackdrop(self)
        self.backdrop.place(relx=0, rely=0, relwidth=1, relheight=1)
        self.shell = RoundedPanel(self.backdrop, surface=COLORS["bg2"], border=COLORS["stroke2"], radius=24)
        self.backdrop_window = self.backdrop.create_window(36, 36, anchor="nw", window=self.shell, tags=("interface",))
        self.backdrop.bind("<Configure>", self._resize_shell, add=True)
        self.after(50, self._drain_ui_queue)
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.show_loading_screen()
        self.after(150, self.restore_session)

    def _configure_widget_styles(self) -> None:
        entry_surface = blend_color(COLORS["bg"], COLORS["panel"], .32)
        self.ui_style.configure(
            "Control.TCombobox",
            fieldbackground=entry_surface,
            background=COLORS["panel3"],
            foreground=COLORS["text"],
            arrowcolor=COLORS["yellow"],
            bordercolor=COLORS["stroke2"],
            lightcolor=COLORS["stroke2"],
            darkcolor=COLORS["stroke2"],
            padding=10,
        )
        self.ui_style.map(
            "Control.TCombobox",
            fieldbackground=[("readonly", entry_surface)],
            foreground=[("readonly", COLORS["text"])],
            bordercolor=[("focus", COLORS["purple2"]), ("active", COLORS["purple2"])],
        )
        self.ui_style.configure(
            "Vertical.TScrollbar",
            background=COLORS["panel3"],
            troughcolor=COLORS["bg2"],
            bordercolor=COLORS["bg2"],
            arrowcolor=COLORS["yellow"],
        )

    def set_theme(self, theme_id: str) -> None:
        if theme_id not in THEMES:
            return
        previous = dict(COLORS)
        self.theme_id = activate_theme(theme_id)
        self.config_store.data["theme"] = self.theme_id
        self.config_store.data["theme_selected"] = True
        self.config_store.save()
        self._configure_widget_styles()
        self._retheme_existing(self, previous)
        self.backdrop.redraw()
        if hasattr(self, "profile_hero_canvas") and self.profile_hero_canvas.winfo_exists():
            self.render_profile_hero(self.profile_hero_canvas)

    def _retheme_existing(self, widget: tk.Misc, previous: dict) -> None:
        color_map = {str(value).lower(): COLORS.get(key, value) for key, value in previous.items() if isinstance(value, str) and value.startswith("#")}

        def mapped(value):
            return color_map.get(str(value).lower(), value)

        for option in ("background", "foreground", "activebackground", "activeforeground", "disabledbackground", "disabledforeground", "highlightbackground", "highlightcolor", "insertbackground", "selectbackground", "selectforeground", "troughcolor"):
            try:
                current = widget.cget(option)
                replacement = mapped(current)
                if replacement != current:
                    widget.configure(**{option: replacement})
            except (tk.TclError, TypeError):
                pass
        if isinstance(widget, RoundedPanel):
            widget.surface_color = mapped(widget.surface_color)
            widget.border_color = mapped(widget.border_color)
            widget._redraw_surface()
        if isinstance(widget, ModernEntry):
            widget.body_color = mapped(widget.body_color)
            widget.entry.configure(bg=widget.body_color)
            widget._layout()
        if isinstance(widget, ModernButton):
            choice_id = getattr(widget, "theme_choice_id", "")
            if choice_id:
                widget.set_selected(choice_id == self.theme_id)
            if getattr(widget, "theme_menu_toggle", False):
                widget.set_text(f"Theme · {THEMES[self.theme_id]['name']}  ▾")
            widget._draw()
        if hasattr(widget, "theme_current_label"):
            try:
                widget.configure(text=THEMES[self.theme_id]["name"])
            except tk.TclError:
                pass
        if isinstance(widget, (ToggleSwitch, ModernSlider, RoundedDropdown, RoundedScrollbar)):
            widget._draw()
        for child in widget.winfo_children():
            self._retheme_existing(child, previous)

    def build_theme_selector(self, master: tk.Misc, compact: bool = False) -> RoundedPanel:
        selector = RoundedPanel(master, surface=COLORS["panel"], border=COLORS["stroke"], radius=16)
        heading = tk.Frame(selector, bg=COLORS["panel"])
        heading.pack(fill="x", padx=14, pady=(12, 8))
        current_label = tk.Label(
            heading,
            text="ANIMATED THEME",
            fg=COLORS["teal"],
            bg=COLORS["panel"],
            font=("Segoe UI", 8, "bold"),
        )
        current_label.pack(side="left")
        theme_name_label = tk.Label(
            heading,
            text=str(THEMES[self.theme_id]["name"]),
            fg=COLORS["yellow"],
            bg=COLORS["panel"],
            font=("Segoe UI", 8, "bold"),
        )
        theme_name_label.theme_current_label = True
        theme_name_label.pack(side="right")
        choices = tk.Frame(selector, bg=COLORS["panel"])
        choices.pack(fill="x", padx=10, pady=(0, 10))
        for index, (theme_id, theme) in enumerate(THEMES.items()):
            button = flat_button(
                choices,
                str(theme["name"]),
                lambda selected=theme_id: self.set_theme(selected),
                accent=theme_id == self.theme_id,
            )
            button.theme_choice_id = theme_id
            button.grid(row=index // (4 if compact else 2), column=index % (4 if compact else 2), sticky="ew", padx=4, pady=4)
        columns = 4 if compact else 2
        for column in range(columns):
            choices.grid_columnconfigure(column, weight=1)
        return selector

    def build_theme_menu(self, master: tk.Misc) -> tk.Frame:
        """Compact floating theme picker used before Discord is connected."""
        try:
            parent_color = str(getattr(master, "surface_color", master.cget("bg")))
        except tk.TclError:
            parent_color = COLORS["bg2"]
        holder = tk.Frame(master, bg=parent_color, bd=0, highlightthickness=0)
        panel = RoundedPanel(holder, surface=COLORS["panel"], border=COLORS["stroke2"], radius=16)
        panel.pack(fill="both", expand=True)
        options = tk.Frame(panel, bg=COLORS["panel"])
        expanded = {"value": False}

        def toggle_menu() -> None:
            expanded["value"] = not expanded["value"]
            if expanded["value"]:
                options.pack(fill="x", padx=6, pady=(0, 7))
            else:
                options.pack_forget()
            holder.lift()

        current_name = str(THEMES[self.theme_id]["name"])
        toggle_button = flat_button(
            panel,
            f"Theme · {current_name}  ▾",
            toggle_menu,
            accent=True,
            width=24,
            align="left",
        )
        toggle_button.theme_menu_toggle = True
        toggle_button.pack(fill="x", padx=6, pady=6)
        for theme_id, theme in THEMES.items():
            choice_button = flat_button(
                options,
                str(theme["name"]),
                lambda selected=theme_id: self.set_theme(selected),
                accent=theme_id == self.theme_id,
                align="left",
            )
            choice_button.theme_choice_id = theme_id
            choice_button.pack(fill="x", pady=2)
        return holder

    def _resize_shell(self, event: tk.Event) -> None:
        margin = 36
        self.backdrop.coords(self.backdrop_window, margin, margin)
        self.backdrop.itemconfigure(
            self.backdrop_window,
            width=max(700, event.width - margin * 2),
            height=max(540, event.height - margin * 2),
        )
        self.backdrop.tag_raise("interface")

    def run_async(self, function, success=None, failure=None) -> None:
        future = self.executor.submit(function)

        def completed(result_future) -> None:
            try:
                result = result_future.result()
                self.ui_queue.put((success, result, None))
            except Exception as error:  # surfaced on the Tk thread
                self.ui_queue.put((failure, None, error))

        future.add_done_callback(completed)

    def _drain_ui_queue(self) -> None:
        try:
            while True:
                callback, result, error = self.ui_queue.get_nowait()
                if callback:
                    callback(error if error is not None else result)
                elif error:
                    self.show_status(str(error), error=True)
        except queue.Empty:
            pass
        self.after(50, self._drain_ui_queue)

    def clear_shell(self) -> None:
        for child in self.shell.winfo_children():
            # RoundedPanel's canvas is the shell's rounded surface. Destroying
            # it made every screen fall back to a sharp rectangular frame.
            if child is not self.shell.surface_canvas:
                child.destroy()
        self.shell._redraw_surface()
        self.image_refs.clear()

    def show_loading_screen(self) -> None:
        self.clear_shell()
        frame = tk.Frame(self.shell, bg=COLORS["bg2"])
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        card = RoundedPanel(frame, surface=COLORS["panel"], border=COLORS["stroke2"], radius=28)
        card.place(relx=.5, rely=.5, anchor="center", width=620, height=360)
        inner = tk.Frame(card, bg=COLORS["panel"])
        inner.pack(fill="both", expand=True, padx=44, pady=34)

        brand_row = tk.Frame(inner, bg=COLORS["panel"])
        brand_row.pack(fill="x")
        logo = tk.Label(brand_row, text="FM", fg=COLORS["yellow"], bg=COLORS["panel2"], width=5, height=3, font=("Segoe UI", 12, "bold"), bd=0)
        logo.pack(side="left", padx=(0, 16))
        self.load_local_avatar(resource_path("Default Monkey.png"), logo, (72, 72))
        copy = tk.Frame(brand_row, bg=COLORS["panel"])
        copy.pack(side="left", fill="x", expand=True)
        tk.Label(copy, text="FLAPPY MONKEY · SECURE STAFF TOOLS", fg=COLORS["teal"], bg=COLORS["panel"], font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(copy, text="Control Panel", fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 28, "bold")).pack(anchor="w", pady=(2, 0))

        tk.Label(inner, text="Connecting your saved Discord session to the live game server.", fg=COLORS["muted"], bg=COLORS["panel"], font=("Segoe UI", 10), anchor="w").pack(fill="x", pady=(22, 12))
        progress = tk.Canvas(inner, height=16, bg=COLORS["panel"], highlightthickness=0, bd=0)
        progress.pack(fill="x")
        status_row = tk.Frame(inner, bg=COLORS["panel"])
        status_row.pack(fill="x", pady=(13, 0))
        tk.Label(status_row, text="●", fg=COLORS["green"], bg=COLORS["panel"], font=("Segoe UI", 10, "bold")).pack(side="left")
        tk.Label(status_row, textvariable=self.status_var, fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 10, "bold"), anchor="w").pack(side="left", padx=(8, 0), fill="x", expand=True)
        tk.Label(inner, text="Encrypted session · live role verification · self-only account access", fg=COLORS["faint"], bg=COLORS["panel"], font=("Segoe UI", 8), anchor="w").pack(fill="x", pady=(10, 0))
        self.loading_action_row = tk.Frame(inner, bg=COLORS["panel"])
        flat_button(self.loading_action_row, "Retry Now", self.retry_saved_session, accent=True).pack(side="left", padx=(0, 7))
        flat_button(self.loading_action_row, "Sign In Again", self.forget_saved_session).pack(side="left")

        animation = {"position": 0.0}
        def animate_loading() -> None:
            if not progress.winfo_exists():
                return
            width = max(120, progress.winfo_width())
            progress.delete("all")
            _rounded_rectangle(progress, 0, 3, width - 1, 13, 5, fill=blend_color(COLORS["bg"], COLORS["panel"], .35), outline=COLORS["stroke"])
            animation["position"] = (animation["position"] + .022) % 1.0
            segment = max(90, width * .23)
            left = animation["position"] * (width + segment) - segment
            _rounded_rectangle(progress, max(1, left), 3, min(width - 2, left + segment), 13, 5, fill=COLORS["purple2"], outline="")
            self.after(24, animate_loading)
        self.after_idle(animate_loading)

    def restore_session(self) -> None:
        self._restore_after_id = None
        if not self.api.token:
            self.show_auth_screen()
            return

        def load() -> tuple[dict, dict]:
            # A normal check uses the server's gateway/cache and avoids turning
            # every app launch into a fresh Discord REST authorization request.
            profile = self.api.request("GET", "/cheat-api/me")
            catalog = self.api.request("GET", "/cheat-api/catalog")
            return profile, catalog

        def success(result) -> None:
            profile_response, self.catalog = result
            self._restore_attempts = 0
            self.accept_renewed_token(profile_response)
            self.profile = profile_response.get("profile", {})
            self.build_main_ui()
            self.load_account()

        def failure(error) -> None:
            if isinstance(error, ApiError) and error.status in (401, 403):
                self.token_store.clear()
                self.api.token = ""
                self.show_auth_screen(str(error))
                return
            # Keep the encrypted session during Render wake-ups, short network
            # outages, and Discord 5xx/429 responses. Losing a connection is not
            # the same thing as logging out.
            self._restore_attempts += 1
            delay = min(10_000, 1_800 + self._restore_attempts * 700)
            self.status_var.set(f"Saved session found · server connection retry {self._restore_attempts}…")
            if hasattr(self, "loading_action_row") and self.loading_action_row.winfo_exists() and not self.loading_action_row.winfo_ismapped():
                self.loading_action_row.pack(fill="x", pady=(16, 0))
            self._restore_after_id = self.after(delay, self.restore_session)

        self.run_async(load, success, failure)

    def retry_saved_session(self) -> None:
        if self._restore_after_id:
            try:
                self.after_cancel(self._restore_after_id)
            except tk.TclError:
                pass
            self._restore_after_id = None
        self.status_var.set("Retrying your saved session now…")
        self.restore_session()

    def forget_saved_session(self) -> None:
        if self._restore_after_id:
            try:
                self.after_cancel(self._restore_after_id)
            except tk.TclError:
                pass
            self._restore_after_id = None
        self.token_store.clear()
        self.api.token = ""
        self._restore_attempts = 0
        self.show_auth_screen()

    def show_auth_screen(self, error_message: str = "") -> None:
        if self._access_poll_after_id:
            try:
                self.after_cancel(self._access_poll_after_id)
            except tk.TclError:
                pass
            self._access_poll_after_id = None
        self.clear_shell()
        self.device = {}
        self.auth_theme_menu = self.build_theme_menu(self.shell)
        self.auth_theme_menu.place(x=18, y=16, width=252)
        container = tk.Frame(self.shell, bg=COLORS["bg2"])
        container.pack(fill="both", expand=True, padx=42, pady=(78, 30))
        left = tk.Frame(container, bg=COLORS["bg2"])
        left.pack(side="left", fill="both", expand=True, padx=(12, 30))
        card = RoundedPanel(container, surface=COLORS["panel"], border=COLORS["stroke2"], radius=24)
        card.pack(side="right", fill="both", expand=True, padx=(14, 8))

        brand_intro = tk.Frame(left, bg=COLORS["bg2"])
        brand_intro.pack(fill="x", pady=(16, 8))
        brand_mark = tk.Label(
            brand_intro,
            text="FM",
            fg=COLORS["yellow"],
            bg=COLORS["panel2"],
            width=5,
            height=3,
            font=("Segoe UI", 12, "bold"),
        )
        brand_mark.pack(side="left", padx=(0, 14))
        brand_copy = tk.Frame(brand_intro, bg=COLORS["bg2"])
        brand_copy.pack(side="left", fill="x", expand=True)
        tk.Label(brand_copy, text="FLAPPY MONKEY · STAFF ACCESS", fg=COLORS["teal"], bg=COLORS["bg2"], font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(brand_copy, text="Control Panel", justify="left", fg=COLORS["text"], bg=COLORS["bg2"], font=("Segoe UI", 32, "bold")).pack(anchor="w")
        self.load_local_avatar(resource_path("Default Monkey.png"), brand_mark, (72, 72))
        tk.Label(
            left,
            text="A Discord-verified command center for Flappy Monkey staff. Membership and role access are checked live every time you use it.",
            justify="left", fg=COLORS["muted"], bg=COLORS["bg2"], font=("Segoe UI", 11), wraplength=440,
        ).pack(anchor="w", pady=(12, 18))
        for index, role in enumerate(ALLOWED_ROLES):
            row = RoundedPanel(left, surface=COLORS["panel2"], border=blend_color(COLORS["stroke"], COLORS["purple2"], .25), radius=13)
            row.pack(fill="x", pady=4)
            tk.Label(row, text="◆", fg=COLORS["yellow"], bg=COLORS["panel2"], font=("Segoe UI", 9, "bold"), width=3).pack(side="left", padx=(10, 3), pady=11)
            tk.Label(row, text=role, fg=COLORS["text"], bg=COLORS["panel2"], font=("Segoe UI", 10, "bold")).pack(side="left", pady=11)

        inner = tk.Frame(card, bg=COLORS["panel"])
        inner.pack(fill="both", expand=True, padx=28, pady=24)
        tk.Label(inner, text="SECURE DISCORD SIGN-IN", fg=COLORS["yellow"], bg=COLORS["panel"], font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(inner, text="Authorize this device", fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 24, "bold")).pack(anchor="w", pady=(3, 4))
        tk.Label(inner, text="Open Discord, approve your account, and return with the private one-time code.", fg=COLORS["muted"], bg=COLORS["panel"], justify="left", wraplength=520, font=("Segoe UI", 10)).pack(anchor="w", pady=(0, 12))
        button_row = tk.Frame(inner, bg=COLORS["panel"])
        button_row.pack(fill="x", pady=(2, 16))
        flat_button(button_row, "Connect Discord", self.begin_authorization, accent=True).pack(side="left", fill="x", expand=True, padx=(0, 5))
        flat_button(button_row, "Join Server", lambda: webbrowser.open(str(self.config_store.data.get("invite_url") or DEFAULT_INVITE))).pack(side="left", fill="x", expand=True, padx=5)
        flat_button(button_row, "Switch Account", self.restart_authorization).pack(side="left", fill="x", expand=True, padx=(5, 0))

        self.auth_match_var = tk.StringVar(value="Waiting for browser…")
        match_surface = blend_color(COLORS["bg"], COLORS["panel"], .28)
        match = RoundedPanel(inner, surface=match_surface, border=COLORS["stroke"], radius=16)
        match.pack(fill="x", pady=(0, 16))
        match_inner = tk.Frame(match, bg=match_surface)
        match_inner.pack(fill="x", padx=16, pady=13)
        tk.Label(match_inner, text="BROWSER SAFETY NUMBER", fg=COLORS["teal"], bg=match_surface, font=("Segoe UI", 8, "bold")).pack(anchor="w")
        tk.Label(match_inner, textvariable=self.auth_match_var, fg=COLORS["yellow"], bg=match_surface, font=("Consolas", 20, "bold"), anchor="w", wraplength=470).pack(fill="x", pady=(2, 2))
        tk.Label(match_inner, text="Compare this number with the browser before approving. Do not paste it below.", fg=COLORS["muted"], bg=match_surface, font=("Segoe UI", 9), anchor="w", justify="left", wraplength=500).pack(fill="x")

        tk.Label(inner, text="PRIVATE AUTHORIZATION CODE", fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 11, "bold")).pack(anchor="w")
        tk.Label(inner, text="Paste the separate FMAC code shown after Discord approves you.", fg=COLORS["muted"], bg=COLORS["panel"], font=("Segoe UI", 9)).pack(anchor="w", pady=(3, 7))
        self.auth_code_var = tk.StringVar()
        code_entry = entry_widget(inner, self.auth_code_var)
        code_entry.pack(fill="x", pady=(0, 9))
        flat_button(inner, "Continue", self.exchange_authorization, accent=True).pack(fill="x")
        self.auth_status_var = tk.StringVar(value="Only current server members with an approved role can continue.")
        self.auth_status_label = tk.Label(inner, textvariable=self.auth_status_var, fg=COLORS["muted"], bg=COLORS["panel"], justify="left", wraplength=500, font=("Segoe UI", 10))
        self.auth_status_label.pack(anchor="w", pady=(12, 0))
        if error_message:
            self.auth_status_var.set(error_message)
            self.auth_status_label.configure(fg=COLORS["red"])

    def begin_authorization(self) -> None:
        existing_url = str(self.device.get("authorizationUrl") or "")
        if existing_url:
            self.auth_status_var.set("Authorization is already active. Reopening the same Discord request without creating another one…")
            self.auth_status_label.configure(fg=COLORS["muted"])
            webbrowser.open(existing_url)
            if not self._poll_after_id:
                self.poll_device_status()
            return
        if self._poll_after_id:
            try:
                self.after_cancel(self._poll_after_id)
            except tk.TclError:
                pass
            self._poll_after_id = None
        self.device = {}
        self.auth_status_var.set("Creating a secure one-time authorization request…")
        self.auth_status_label.configure(fg=COLORS["muted"])

        def task() -> dict:
            return self.api.request("POST", "/cheat-auth/device", {}, authenticated=False)

        def success(result: dict) -> None:
            self.device = result
            self.auth_match_var.set(str(result.get("userCode", "------")))
            invite = result.get("inviteUrl")
            if invite:
                self.config_store.data["invite_url"] = invite
                self.config_store.save()
            self.auth_status_var.set("Browser opened. Confirm Discord shows your account, then compare the matching code.")
            webbrowser.open(str(result.get("authorizationUrl", "")))
            self.poll_device_status()

        self.run_async(task, success, self.auth_failed)

    def restart_authorization(self) -> None:
        if self._poll_after_id:
            try:
                self.after_cancel(self._poll_after_id)
            except tk.TclError:
                pass
            self._poll_after_id = None
        self.device = {}
        self.begin_authorization()

    def poll_device_status(self) -> None:
        if not self.device.get("deviceCode"):
            return
        code = urllib.parse.quote(str(self.device["deviceCode"]))

        def task() -> dict:
            return self.api.request("GET", f"/cheat-auth/device/status?device_code={code}", authenticated=False)

        def success(result: dict) -> None:
            status = result.get("status")
            if status == "code_ready":
                self.auth_status_var.set(f"Discord approved {result.get('displayName', '')} · {result.get('mainRole', '')}. Paste the private code and continue.")
                self.auth_status_label.configure(fg=COLORS["green"])
                return
            if status in ("denied", "error"):
                self.auth_status_var.set(result.get("message") or "Discord access was denied.")
                self.auth_status_label.configure(fg=COLORS["red"])
                self.device = {}
                return
            self._poll_after_id = self.after(1800, self.poll_device_status)

        def failure(_error) -> None:
            self._poll_after_id = self.after(2500, self.poll_device_status)

        self.run_async(task, success, failure)

    def exchange_authorization(self) -> None:
        authorization_code = self.auth_code_var.get().strip()
        if not self.device or not authorization_code:
            self.auth_failed(ApiError("Start Discord authorization and paste the private code first."))
            return
        self.auth_status_var.set("Re-checking live server membership and approved roles…")

        def task() -> tuple[dict, dict]:
            result = self.api.request("POST", "/cheat-auth/exchange", {
                "deviceCode": self.device.get("deviceCode"),
                "deviceSecret": self.device.get("deviceSecret"),
                "authorizationCode": authorization_code,
            }, authenticated=False)
            self.api.token = str(result.get("accessToken", ""))
            catalog = self.api.request("GET", "/cheat-api/catalog")
            return result, catalog

        def success(results) -> None:
            result, self.catalog = results
            self.profile = result.get("profile", {})
            self.token_store.save(self.api.token)
            self.build_main_ui()
            self.load_account()

        self.run_async(task, success, self.auth_failed)

    def auth_failed(self, error) -> None:
        if hasattr(self, "auth_status_var"):
            self.device = {}
            self.auth_status_var.set(str(error))
            self.auth_status_label.configure(fg=COLORS["red"])
        else:
            self.show_status(str(error), error=True)

    def build_main_ui(self, initial_page: str | None = None) -> None:
        desired_page = initial_page or self.current_page or "dashboard"
        self.clear_shell()
        self.nav_buttons = {}
        workspace = tk.Frame(self.shell, bg=COLORS["bg2"])
        workspace.pack(fill="both", expand=True, padx=12, pady=12)
        sidebar = RoundedPanel(workspace, surface=COLORS["sidebar"], border=COLORS["stroke"], radius=20)
        sidebar.configure(width=245)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)
        main = tk.Frame(workspace, bg=COLORS["bg2"])
        main.pack(side="right", fill="both", expand=True)

        brand = tk.Frame(sidebar, bg=COLORS["sidebar"])
        brand.pack(fill="x", padx=20, pady=(24, 26))
        tk.Label(brand, text="FLAPPY MONKEY", fg=COLORS["yellow"], bg=COLORS["sidebar"], font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(brand, text="CONTROL PANEL", fg=COLORS["text"], bg=COLORS["sidebar"], font=("Segoe UI", 18, "bold")).pack(anchor="w")

        nav_items = [
            ("dashboard", "◈   Dashboard"), ("unlocks", "◇   Unlocks & Items"),
            ("live", "⚡   Live Controls"), ("progress", "↗   Progress & Currency"),
            ("profile", "◎   Discord Profile"), ("settings", "⚙   Settings"),
        ]
        for page, label in nav_items:
            button = flat_button(
                sidebar,
                label,
                command=lambda selected=page: self.show_page(selected),
                align="left",
            )
            button.pack(fill="x", padx=10, pady=2)
            self.nav_buttons[page] = button

        profile_card = RoundedPanel(sidebar, surface=COLORS["panel"], border=self.profile_accent(), radius=16)
        self.sidebar_profile_card = profile_card
        profile_card.pack(side="bottom", fill="x", padx=14, pady=16)
        self.sidebar_avatar = tk.Label(profile_card, text=self.initials(), width=4, height=2, fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 11, "bold"), bd=0, highlightthickness=0)
        self.sidebar_avatar.pack(side="left", padx=10, pady=11)
        profile_text = tk.Frame(profile_card, bg=COLORS["panel"])
        # Preserve a clear inset around the rounded foreground border. Without
        # the right inset this expanding frame painted over the card's right
        # edge, leaving the custom accent outline visibly incomplete.
        profile_text.pack(side="left", fill="x", expand=True, padx=(0, 10), pady=10)
        tk.Label(profile_text, text=self.profile_name(), fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 10, "bold"), anchor="w").pack(fill="x")
        self.sidebar_role_label = tk.Label(profile_text, text=self.main_role_name(), fg=COLORS["teal"], bg=COLORS["panel"], font=("Segoe UI", 8, "bold"), anchor="w", wraplength=145)
        self.sidebar_role_label.pack(fill="x")
        profile_card.bind("<Button-1>", lambda _event: self.show_page("profile"))

        header = tk.Frame(main, bg=COLORS["bg2"])
        header.pack(fill="x", padx=24, pady=(20, 10))
        title_wrap = tk.Frame(header, bg=COLORS["bg2"])
        title_wrap.pack(side="left")
        self.page_kicker = tk.Label(title_wrap, text="AUTHORIZED CONTROL", fg=COLORS["teal"], bg=COLORS["bg2"], font=("Segoe UI", 8, "bold"))
        self.page_kicker.pack(anchor="w")
        self.page_title = tk.Label(title_wrap, text="Dashboard", fg=COLORS["text"], bg=COLORS["bg2"], font=("Segoe UI", 23, "bold"))
        self.page_title.pack(anchor="w")

        identity = RoundedPanel(header, surface=COLORS["panel"], border=COLORS["stroke"], radius=15)
        identity.pack(side="right")
        tk.Label(identity, text="MY GAME ACCOUNT", fg=COLORS["teal"], bg=COLORS["panel"], font=("Segoe UI", 8, "bold")).pack(side="left", padx=(14, 8))
        account_info = self.account.get("account", {}) if self.account else {}
        identity_text = str(account_info.get("username") or "Loading…")
        if account_info.get("id"):
            identity_text += f"  ·  {str(account_info.get('id'))[:12]}…"
        self.account_identity_label = tk.Label(identity, text=identity_text, fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 9, "bold"), anchor="w")
        self.account_identity_label.pack(side="left", padx=(0, 8))
        flat_button(identity, "Refresh", self.load_account, accent=True, width=9).pack(side="left", padx=(2, 6), pady=5)

        status_surface = RoundedPanel(main, surface=COLORS["panel"], border=COLORS["stroke"], radius=13)
        status_surface.pack(side="bottom", fill="x", padx=24, pady=(7, 18))
        self.status_bar = tk.Label(status_surface, textvariable=self.status_var, fg=COLORS["muted"], bg=COLORS["panel"], anchor="w", padx=14, pady=8, font=("Segoe UI", 9))
        self.status_bar.pack(fill="x", padx=2, pady=2)
        self.page_host = tk.Frame(main, bg=COLORS["bg2"])
        self.page_host.pack(fill="both", expand=True, padx=24, pady=(0, 0))
        self.load_remote_avatar(self.profile.get("avatarUrl", ""), self.sidebar_avatar, (44, 44), round_image=True)
        self.show_page(desired_page if desired_page in {"dashboard", "unlocks", "live", "progress", "profile", "settings"} else "dashboard")
        self.show_status("Discord access confirmed. This Control Panel can modify only your linked Flappy Monkey account.", success=True)
        self.schedule_access_check()

    def initials(self) -> str:
        value = self.profile_name().strip()
        return "".join(part[0].upper() for part in value.split()[:2]) or "FM"

    def profile_name(self) -> str:
        return str(self.profile.get("displayName") or self.profile.get("username") or "Discord User")

    def main_role_name(self) -> str:
        return str((self.profile.get("mainRole") or {}).get("name") or "Approved Role")

    def profile_accent(self) -> str:
        value = str(self.config_store.data.get("accent") or COLORS["purple2"])
        return value if re.fullmatch(r"#[0-9a-fA-F]{6}", value) else COLORS["purple2"]

    def has_discord_role(self, role_name: str) -> bool:
        return any(str(role.get("name") or "") == str(role_name or "") for role in self.profile.get("roles", []))

    def item_accessible(self, item: dict) -> bool:
        required_role = str(item.get("requiredRole") or "")
        return not required_role or self.has_discord_role(required_role)

    def show_page(self, page: str) -> None:
        self.current_page = page
        titles = {
            "dashboard":"Dashboard", "unlocks":"Unlocks & Items", "live":"Live Controls",
            "progress":"Progress & Currency", "profile":"Discord Profile", "settings":"Settings",
        }
        self.page_title.configure(text=titles.get(page, page.title()))
        for key, button in self.nav_buttons.items():
            button.set_selected(key == page)
        for child in self.page_host.winfo_children():
            child.destroy()
        builders = {
            "dashboard":self.build_dashboard, "unlocks":self.build_unlocks, "live":self.build_live,
            "progress":self.build_progress, "profile":self.build_profile, "settings":self.build_settings,
        }
        builders[page]()

    def card(self, master: tk.Misc, title: str = "", description: str = "") -> tk.Frame:
        frame = RoundedPanel(master, surface=COLORS["panel"], border=COLORS["stroke"], radius=18)
        if title:
            tk.Label(frame, text=title, fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 13, "bold"), anchor="w").pack(fill="x", padx=18, pady=(15, 2))
        if description:
            tk.Label(frame, text=description, fg=COLORS["muted"], bg=COLORS["panel"], font=("Segoe UI", 9), anchor="w", justify="left", wraplength=620).pack(fill="x", padx=18, pady=(2, 12))
        return frame

    def build_dashboard(self) -> None:
        page = ScrollFrame(self.page_host)
        page.pack(fill="both", expand=True)
        hero = self.card(page.content)
        hero.pack(fill="x", pady=(0, 14))
        hero_inner = tk.Frame(hero, bg=COLORS["panel"])
        hero_inner.pack(fill="x", padx=22, pady=22)
        tk.Label(hero_inner, text="SECURE DEVELOPER WORKSPACE", fg=COLORS["teal"], bg=COLORS["panel"], font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(hero_inner, text=f"Welcome back, {self.profile_name()}.", fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 24, "bold")).pack(anchor="w", pady=(4, 6))
        tk.Label(hero_inner, text="Every change is server-validated and can affect only your linked Flappy Monkey account. Public ranked live controls remain blocked.", fg=COLORS["muted"], bg=COLORS["panel"], font=("Segoe UI", 10), wraplength=820, justify="left").pack(anchor="w")

        stats = tk.Frame(page.content, bg=COLORS["bg2"])
        stats.pack(fill="x", pady=(0, 14))
        values = self.account_card_values()
        self.dashboard_stat_vars = {}
        for column, (kicker, value, detail) in enumerate(values):
            frame = self.card(stats)
            frame.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 5, 0 if column == 3 else 5))
            tk.Label(frame, text=kicker, fg=COLORS["teal"], bg=COLORS["panel"], font=("Segoe UI", 8, "bold")).pack(anchor="w", padx=14, pady=(13, 2))
            value_var, detail_var = tk.StringVar(value=str(value)), tk.StringVar(value=str(detail))
            self.dashboard_stat_vars[kicker] = (value_var, detail_var)
            tk.Label(frame, textvariable=value_var, fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 14, "bold"), wraplength=190).pack(anchor="w", padx=14)
            tk.Label(frame, textvariable=detail_var, fg=COLORS["muted"], bg=COLORS["panel"], font=("Segoe UI", 8), wraplength=190, justify="left").pack(anchor="w", padx=14, pady=(2, 13))
            stats.grid_columnconfigure(column, weight=1)

        actions = self.card(page.content, "Quick Actions", "Common collection and runtime actions for your linked account.")
        actions.pack(fill="x", pady=(0, 14))
        buttons = tk.Frame(actions, bg=COLORS["panel"])
        buttons.pack(fill="x", padx=18, pady=(0, 18))
        flat_button(buttons, "Unlock All Skins", lambda: self.batch_unlock("skins"), accent=True).pack(side="left", padx=(0, 8))
        flat_button(buttons, "Unlock All Titles", lambda: self.batch_unlock("titles")).pack(side="left", padx=8)
        flat_button(buttons, "Complete Collection", lambda: self.batch_unlock("all"), danger=True).pack(side="left", padx=8)
        flat_button(buttons, "Open Live Controls", lambda: self.show_page("live")).pack(side="left", padx=8)

        danger_surface = blend_color(COLORS["red"], COLORS["panel"], .86)
        reset_card = RoundedPanel(page.content, surface=danger_surface, border=COLORS["red"], radius=18)
        reset_card.pack(fill="x", pady=(0, 24))
        reset_copy = tk.Frame(reset_card, bg=danger_surface)
        reset_copy.pack(fill="x", padx=20, pady=(17, 8))
        tk.Label(reset_copy, text="Reset Game Progress", fg=COLORS["text"], bg=danger_surface, font=("Segoe UI", 14, "bold"), anchor="w").pack(fill="x")
        tk.Label(
            reset_copy,
            text="Uses the same full reset as the game. Skins, titles, XP, ranks, badges, currencies, unlocks, gifts, and cloud progress are permanently wiped.",
            fg=COLORS["muted"], bg=danger_surface, font=("Segoe UI", 9), anchor="w", justify="left", wraplength=850,
        ).pack(fill="x", pady=(5, 0))
        confirmation = tk.Frame(reset_card, bg=danger_surface)
        confirmation.pack(fill="x", padx=20, pady=(4, 18))
        tk.Label(confirmation, text="TYPE RESET TO ENABLE", fg=COLORS["red"], bg=danger_surface, font=("Segoe UI", 8, "bold")).pack(anchor="w", pady=(0, 4))
        action_line = tk.Frame(confirmation, bg=danger_surface)
        action_line.pack(fill="x")
        reset_entry = entry_widget(action_line, self.reset_progress_var)
        reset_entry.pack(side="left", fill="x", expand=True, padx=(0, 12))
        reset_button = flat_button(action_line, "Reset Game Progress", self.reset_game_progress, danger=True, width=22)
        reset_button.pack(side="right")

    def account_card_values(self) -> list[tuple[str, str, str]]:
        account = self.account.get("account", {}) if self.account else {}
        owned = self.account.get("owned", {}) if self.account else {}
        total = int(owned.get("totalPermanent", 0) or 0)
        collection_detail = f"{int(owned.get('titles', 0) or 0):,} titles · {int(owned.get('badges', 0) or 0):,} badges"
        if total:
            collection_detail += f" · {total:,} total"
        return [
            ("MY ACCOUNT", str(account.get("username", "Loading…")), str(account.get("id", "Automatically linked through Discord"))),
            ("LEVEL", str(account.get("level", "—")), f"{int(account.get('totalXP', 0) or 0):,} total XP"),
            ("COLLECTION", f"{int(owned.get('skins', 0) or 0):,} skins", collection_detail),
            ("GAME STATUS", "Online" if self.account.get("online") else "Offline", "Live now" if self.account.get("online") else "Changes still save while offline"),
        ]

    def refresh_account_widgets(self) -> None:
        values = {kicker: (value, detail) for kicker, value, detail in self.account_card_values()}
        for kicker, variables in self.dashboard_stat_vars.items():
            if kicker in values:
                variables[0].set(str(values[kicker][0]))
                variables[1].set(str(values[kicker][1]))
        account = self.account.get("account", {}) if self.account else {}
        identity_text = str(account.get("username") or account.get("id") or "Linked account")
        if account.get("id"):
            identity_text += f"  ·  {str(account.get('id'))[:12]}…"
        label = getattr(self, "account_identity_label", None)
        if isinstance(label, tk.Label) and label.winfo_exists():
            label.configure(text=identity_text, fg=COLORS["text"])

    def build_unlocks(self) -> None:
        controls = RoundedPanel(self.page_host, surface=COLORS["panel"], border=COLORS["stroke"], radius=18)
        controls.pack(fill="x", pady=(0, 10))
        controls_inner = tk.Frame(controls, bg=COLORS["panel"])
        controls_inner.pack(fill="x", padx=12, pady=10)
        search_wrap = tk.Frame(controls_inner, bg=COLORS["panel"])
        search_wrap.pack(side="left", fill="x", expand=True, padx=(0, 8))
        tk.Label(search_wrap, text="SEARCH COLLECTION", fg=COLORS["teal"], bg=COLORS["panel"], font=("Segoe UI", 8, "bold")).pack(anchor="w", padx=3)
        search = entry_widget(search_wrap, self.search_var)
        search.pack(fill="x", pady=(3, 0))
        self.search_entry = search.entry
        filter_wrap = tk.Frame(controls_inner, bg=COLORS["panel"])
        filter_wrap.pack(side="left", padx=8)
        tk.Label(filter_wrap, text="FILTER", fg=COLORS["teal"], bg=COLORS["panel"], font=("Segoe UI", 8, "bold")).pack(anchor="w", padx=3)
        categories = self.catalog.get("categories", [])
        self.category_label_to_id = {"All Items": "all", **{str(entry.get("label") or humanize(entry.get("id", ""))): str(entry.get("id", "")) for entry in categories}}
        if self.category_var.get() not in self.category_label_to_id:
            self.category_var.set("All Items")
        combo = RoundedDropdown(filter_wrap, self.category_var, list(self.category_label_to_id), command=lambda: self.after_idle(lambda: self.render_item_results(reset=True)), width=190)
        combo.pack(pady=(3, 0))
        flat_button(controls_inner, "Unlock Filter", self.unlock_selected_category).pack(side="left", padx=8, pady=(17, 0))
        flat_button(controls_inner, "Unlock Everything", lambda: self.batch_unlock("all"), danger=True).pack(side="left", padx=(8, 0), pady=(17, 0))
        self.item_scroll = ScrollFrame(self.page_host)
        self.item_scroll.pack(fill="both", expand=True)
        self.render_item_results(reset=True)

    def schedule_item_render(self) -> None:
        if self._search_after_id:
            try:
                self.after_cancel(self._search_after_id)
            except tk.TclError:
                pass
        # Debounce the relatively expensive card/image rebuild. StringVar
        # tracing also catches paste, cut, IME, and accessibility input that a
        # KeyRelease-only binding missed.
        self._search_after_id = self.after(300, lambda: self.render_item_results(reset=True))

    def render_item_results(self, reset: bool = False) -> None:
        if not hasattr(self, "item_scroll"):
            return
        self._search_after_id = None
        search_had_focus = getattr(self, "search_entry", None) is self.focus_get()
        search_cursor = None
        if search_had_focus:
            try:
                search_cursor = self.search_entry.index(tk.INSERT)
            except tk.TclError:
                search_cursor = None
        for child in self.item_scroll.content.winfo_children():
            child.destroy()
        query = self.search_var.get().strip().lower()
        category = self.category_label_to_id.get(self.category_var.get(), "all")
        filter_key = (query, category)
        filter_changed = reset or filter_key != self._last_item_filter
        if filter_changed:
            # Searching stays responsive by painting fewer image-heavy rows at
            # once; the full unfiltered browser keeps the larger first page.
            self._item_visible_limit = 12 if query else 18
        self._last_item_filter = filter_key
        items = [item for item in self.catalog.get("items", []) if (category == "all" or item.get("category") == category)]
        if query:
            items = [item for item in items if query in str(item.get("label", "")).lower() or query in str(item.get("itemId", "")).lower() or query in str(item.get("type", "")).lower()]
        visible = items[:self._item_visible_limit]
        summary_surface = blend_color(COLORS["bg2"], COLORS["panel"], .26)
        summary = RoundedPanel(self.item_scroll.content, surface=summary_surface, border=COLORS["stroke"], radius=12)
        summary.pack(fill="x", padx=(4, 8), pady=(2, 8))
        tk.Label(summary, text=f"{len(items):,} result{'s' if len(items) != 1 else ''}  ·  showing {len(visible):,}", fg=COLORS["muted"], bg=summary_surface, font=("Segoe UI", 9, "bold"), anchor="w").pack(fill="x", padx=12, pady=7)
        for item in visible:
            accessible = self.item_accessible(item)
            row_surface = COLORS["panel"] if accessible else blend_color(COLORS["panel"], COLORS["bg"], .46)
            row_border = COLORS["stroke"] if accessible else blend_color(COLORS["stroke"], COLORS["bg"], .48)
            row = RoundedPanel(self.item_scroll.content, surface=row_surface, border=row_border, radius=14)
            row.pack(fill="x", padx=(4, 8), pady=5)
            icon = tk.Label(row, text=self.item_fallback_icon(item), fg=COLORS["yellow"] if accessible else COLORS["faint"], bg=COLORS["panel3"] if accessible else row_surface, font=("Segoe UI Symbol", 16, "bold"), width=3, height=2, bd=0, highlightthickness=0)
            icon.pack(side="left", padx=10, pady=8)
            self.load_item_icon(item, icon, (48, 48))
            text = tk.Frame(row, bg=row_surface)
            text.pack(side="left", fill="x", expand=True, pady=9)
            tk.Label(text, text=str(item.get("label", "Unknown Item")), fg=COLORS["text"] if accessible else COLORS["faint"], bg=row_surface, font=("Segoe UI", 10, "bold"), anchor="w").pack(fill="x")
            category_name = next((str(entry.get("label")) for entry in self.catalog.get("categories", []) if entry.get("id") == item.get("category")), humanize(item.get("category", "Item")))
            details = f"{category_name}  ·  {humanize(item.get('type', 'item'))}"
            if item.get("rarity") and item.get("rarity") != "unknown":
                details += f"  ·  {humanize(item.get('rarity'))}"
            if not accessible:
                details += f"  ·  Requires {item.get('requiredRole')}"
            tk.Label(text, text=details, fg=COLORS["muted"] if accessible else COLORS["faint"], bg=row_surface, font=("Segoe UI", 8), anchor="w").pack(fill="x")
            amount_var = tk.StringVar(value="1")
            if item.get("quantity"):
                amount = entry_widget(row, amount_var)
                amount.set_character_width(9)
                amount.pack(side="left", padx=6)
            flat_button(row, "＋ Give", lambda selected=item, variable=amount_var: self.change_item(selected, variable, "grant"), accent=True, enabled=accessible).pack(side="left", padx=5, pady=10)
            flat_button(row, "− Remove", lambda selected=item, variable=amount_var: self.change_item(selected, variable, "remove"), enabled=accessible).pack(side="left", padx=(5, 10), pady=10)
        if len(visible) < len(items):
            more = tk.Frame(self.item_scroll.content, bg=COLORS["bg2"])
            more.pack(fill="x", padx=(4, 8), pady=(10, 18))
            flat_button(more, f"Load More  ·  {len(items) - len(visible):,} remaining", self.load_more_items, accent=True).pack(anchor="center")
        if filter_changed:
            # A shorter filter used to retain the previous long list's canvas
            # offset, leaving a large blank block above the first result.
            self.item_scroll.canvas.yview_moveto(0)
            self.after_idle(lambda canvas=self.item_scroll.canvas: canvas.winfo_exists() and canvas.yview_moveto(0))
        if search_had_focus and getattr(self, "search_entry", None) is not None:
            def restore_search_focus() -> None:
                try:
                    if self.search_entry.winfo_exists():
                        self.search_entry.focus_set()
                        if search_cursor is not None:
                            self.search_entry.icursor(search_cursor)
                except tk.TclError:
                    pass
            self.after_idle(restore_search_focus)

    def load_more_items(self) -> None:
        self._item_visible_limit += 24
        self.render_item_results()

    def build_live(self) -> None:
        page = ScrollFrame(self.page_host)
        page.pack(fill="both", expand=True)
        warning = self.card(page.content, "Safe Live Controls", "These controls apply only to your linked account in supported solo, practice, and private gameplay. Public ranked modes ignore them.")
        warning.pack(fill="x", pady=(0, 12))
        self.live_variables = {}
        current = (self.account.get("live") or {}).get("values", {}) if self.account else {}
        for cheat in self.catalog.get("cheats", []):
            row = self.card(page.content)
            row.pack(fill="x", pady=4)
            details = tk.Frame(row, bg=COLORS["panel"])
            details.pack(side="left", fill="x", expand=True, padx=16, pady=13)
            tk.Label(details, text=cheat.get("name", "Control"), fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 11, "bold"), anchor="w").pack(fill="x")
            tk.Label(details, text=cheat.get("description", ""), fg=COLORS["muted"], bg=COLORS["panel"], font=("Segoe UI", 9), anchor="w", wraplength=650, justify="left").pack(fill="x")
            cheat_id = str(cheat.get("id"))
            if cheat.get("kind") == "toggle":
                variable = tk.BooleanVar(value=bool(current.get(cheat_id, cheat.get("default", False))))
                self.live_variables[cheat_id] = variable
                ToggleSwitch(row, variable, command=self.schedule_live_controls_save).pack(side="right", padx=22, pady=14)
            elif cheat.get("kind") == "choice":
                options = [str(value) for value in cheat.get("options", [])]
                selected = str(current.get(cheat_id, cheat.get("default", options[0] if options else "")))
                if selected not in options and options:
                    selected = options[0]
                variable = tk.StringVar(value=selected)
                self.live_variables[cheat_id] = variable
                choice = RoundedDropdown(row, variable, options, command=self.schedule_live_controls_save, width=220)
                choice.pack(side="right", padx=22, pady=10)
            else:
                variable = tk.DoubleVar(value=float(current.get(cheat_id, cheat.get("default", 1))))
                self.live_variables[cheat_id] = variable
                formatted = tk.StringVar()
                step = float(cheat.get("step", 1))
                variable.trace_add("write", lambda *_args, source=variable, output=formatted, increment=step: output.set(f"{float(source.get()):.2f}".rstrip("0").rstrip(".") if increment < 1 else f"{float(source.get()):.0f}"))
                formatted.set(f"{float(variable.get()):.2f}".rstrip("0").rstrip(".") if step < 1 else f"{float(variable.get()):.0f}")
                value_label = tk.Label(row, textvariable=formatted, fg=COLORS["yellow"], bg=COLORS["panel"], width=6, font=("Segoe UI", 10, "bold"))
                value_label.pack(side="right", padx=(2, 16))
                scale = ModernSlider(row, variable, float(cheat.get("minimum", 0)), float(cheat.get("maximum", 100)), step, command=self.schedule_live_controls_save)
                scale.pack(side="right", padx=5)
        actions = tk.Frame(page.content, bg=COLORS["bg2"])
        actions.pack(fill="x", pady=14)
        flat_button(actions, "Apply Live Controls", self.apply_live_controls, accent=True).pack(side="left")
        flat_button(actions, "Reset All Live Controls", self.reset_live_controls, danger=True).pack(side="left", padx=10)

    def build_progress(self) -> None:
        page = ScrollFrame(self.page_host)
        page.pack(fill="both", expand=True)
        intro = self.card(page.content, "Progress & Currency", "Apply exact amounts to your linked Flappy Monkey account. Removals stop at zero.")
        intro.pack(fill="x", pady=(0, 12))
        definitions = [item for item in self.catalog.get("items", []) if item.get("category") in ("currencies", "powerups", "crate_tickets")]
        for item in definitions:
            row = self.card(page.content)
            row.pack(fill="x", pady=4)
            icon = tk.Label(row, text=self.item_fallback_icon(item), fg=COLORS["yellow"], bg=COLORS["panel3"], font=("Segoe UI Symbol", 14, "bold"), width=3, height=2, bd=0)
            icon.pack(side="left", padx=(12, 6), pady=8)
            self.load_item_icon(item, icon, (42, 42))
            tk.Label(row, text=item.get("label", "Value"), fg=COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 11, "bold"), anchor="w").pack(side="left", fill="x", expand=True, padx=8, pady=15)
            variable = tk.StringVar(value="1")
            amount = entry_widget(row, variable)
            amount.set_character_width(12)
            amount.pack(side="left", padx=6)
            flat_button(row, "Add", lambda selected=item, value=variable: self.change_item(selected, value, "grant"), accent=True).pack(side="left", padx=5)
            flat_button(row, "Remove", lambda selected=item, value=variable: self.change_item(selected, value, "remove")).pack(side="left", padx=(5, 14))

    def build_profile(self) -> None:
        page = ScrollFrame(self.page_host)
        page.pack(fill="both", expand=True)
        hero = RoundedPanel(page.content, surface=COLORS["panel"], border=self.profile_accent(), radius=20)
        self.profile_hero_panel = hero
        hero.pack(fill="x", pady=(0, 12))
        hero_inner = tk.Frame(hero, bg=COLORS["panel"])
        hero_inner.pack(fill="both", expand=True, padx=9, pady=9)
        visual = tk.Canvas(hero_inner, height=164, bg=COLORS["panel"], bd=0, highlightthickness=0)
        self.profile_hero_canvas = visual
        visual.pack(side="left", fill="both", expand=True)
        self.prepare_profile_hero(visual)

        controls = tk.Frame(hero_inner, bg=COLORS["panel"], width=170)
        controls.pack(side="right", fill="y", padx=(12, 4), pady=9)
        controls.pack_propagate(False)
        flat_button(controls, "Refresh Access", self.refresh_access, accent=True).pack(pady=4, fill="x")
        flat_button(controls, "Copy User ID", lambda: self.copy_text(str(self.profile.get("id", "")))).pack(pady=4, fill="x")
        flat_button(controls, "Log Out", self.logout, danger=True).pack(pady=4, fill="x")

        info_row = tk.Frame(page.content, bg=COLORS["bg2"])
        info_row.pack(fill="x", pady=(0, 12))
        joined = self.format_date(str(self.profile.get("joinedAt", "")))
        for column, (label, value) in enumerate((("SERVER MEMBER SINCE", joined), ("HIGHEST ACCESS ROLE", self.main_role_name()), ("ACCESS STATUS", "AUTHORIZED"))):
            card = self.card(info_row)
            card.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 5, 0 if column == 2 else 5))
            tk.Label(card, text=label, fg=COLORS["muted"], bg=COLORS["panel"], font=("Segoe UI", 8, "bold")).pack(anchor="w", padx=15, pady=(13, 3))
            tk.Label(card, text=value, fg=COLORS["green"] if label == "ACCESS STATUS" else COLORS["text"], bg=COLORS["panel"], font=("Segoe UI", 12, "bold"), wraplength=240).pack(anchor="w", padx=15, pady=(0, 14))
            info_row.grid_columnconfigure(column, weight=1)

        roles = self.card(page.content, "Flappy Monkey Server Roles", "This list refreshes from Discord. Role badges use the role's actual Discord color.")
        roles.pack(fill="x", pady=(0, 12))
        role_wrap = tk.Frame(roles, bg=COLORS["panel"])
        role_wrap.pack(fill="x", padx=16, pady=(4, 18))
        all_roles = list(self.profile.get("roles", []))
        resolved_roles = [
            role for role in all_roles
            if not re.fullmatch(r"(?:Discord )?Role\s+\d+", str(role.get("name", "")), flags=re.IGNORECASE)
        ]
        for index, role in enumerate(resolved_roles):
            color = f"#{int(role.get('color', 0) or 0):06x}" if int(role.get("color", 0) or 0) else COLORS["stroke2"]
            badge = RoundedPanel(role_wrap, surface=COLORS["panel2"], border=color, radius=12)
            badge.grid(row=index // 3, column=index % 3, sticky="ew", padx=4, pady=4)
            initials = "".join(part[:1] for part in str(role.get("name", "Role")).split()[:2]).upper()
            role_icon = tk.Label(badge, text=initials or "◆", fg=COLORS["text"], bg=color, width=3, height=1, font=("Segoe UI", 8, "bold"), bd=0, highlightthickness=0)
            role_icon.pack(side="left", padx=(7, 7), pady=8)
            if role.get("iconUrl"):
                self.load_remote_avatar(str(role.get("iconUrl")), role_icon, (26, 26), round_image=True)
            tk.Label(badge, text=role.get("name", "Discord Role"), fg=COLORS["text"], bg=COLORS["panel2"], font=("Segoe UI", 9, "bold"), anchor="w", wraplength=210).pack(side="left", fill="x", expand=True, padx=(0, 8), pady=8)
            role_wrap.grid_columnconfigure(index % 3, weight=1)
        unresolved_count = len(all_roles) - len(resolved_roles)
        if unresolved_count:
            pending = RoundedPanel(role_wrap, surface=COLORS["panel2"], border=COLORS["stroke2"], radius=12)
            pending.grid(row=len(resolved_roles) // 3, column=len(resolved_roles) % 3, sticky="ew", padx=4, pady=4)
            tk.Label(pending, text="↻", fg=COLORS["teal"], bg=COLORS["panel2"], width=3, font=("Segoe UI Symbol", 10, "bold")).pack(side="left", padx=(7, 7), pady=8)
            tk.Label(pending, text=f"Refreshing {unresolved_count} Discord role name{'s' if unresolved_count != 1 else ''}…", fg=COLORS["muted"], bg=COLORS["panel2"], font=("Segoe UI", 9, "bold"), anchor="w", wraplength=210).pack(side="left", fill="x", expand=True, padx=(0, 8), pady=8)
            role_wrap.grid_columnconfigure(len(resolved_roles) % 3, weight=1)

        customization = self.card(page.content, "Edit Local Control Panel Profile", "Customize the banner and accent shown in this app. Discord identity and access roles cannot be edited here.")
        customization.pack(fill="x", pady=(0, 12))
        buttons = tk.Frame(customization, bg=COLORS["panel"])
        buttons.pack(fill="x", padx=16, pady=(0, 18))
        flat_button(buttons, "Customize Banner", self.choose_banner).pack(side="left", padx=(0, 8))
        flat_button(buttons, "Customize Accent Color", self.choose_accent).pack(side="left", padx=8)
        flat_button(buttons, "Clear Banner", self.clear_banner).pack(side="left", padx=8)

    def build_settings(self) -> None:
        page = ScrollFrame(self.page_host)
        page.pack(fill="both", expand=True)
        theme_card = self.card(page.content, "Animated Themes", "Change the entire Control Panel palette, glow system, controls, and animated background scene.")
        theme_card.pack(fill="x", pady=(0, 12))
        self.build_theme_selector(theme_card, compact=True).pack(fill="x", padx=18, pady=(0, 18))
        connection = self.card(page.content, "Connection", "The official Render server hosts Discord authorization and game account controls.")
        connection.pack(fill="x", pady=(0, 12))
        form = tk.Frame(connection, bg=COLORS["panel"])
        form.pack(fill="x", padx=18, pady=(0, 18))
        self.server_var = tk.StringVar(value=str(self.config_store.data["server_url"]))
        self.invite_var = tk.StringVar(value=str(self.config_store.data["invite_url"]))
        for row, (label, variable) in enumerate((("SERVER URL", self.server_var), ("DISCORD INVITE", self.invite_var))):
            tk.Label(form, text=label, fg=COLORS["muted"], bg=COLORS["panel"], font=("Segoe UI", 8, "bold")).grid(row=row, column=0, sticky="w", padx=(0, 12), pady=7)
            field = entry_widget(form, variable)
            field.grid(row=row, column=1, sticky="ew", pady=7)
        form.grid_columnconfigure(1, weight=1)
        action_row = tk.Frame(connection, bg=COLORS["panel"])
        action_row.pack(fill="x", padx=18, pady=(0, 18))
        flat_button(action_row, "Save Settings", self.save_settings, accent=True).pack(side="left")
        flat_button(action_row, "Test Connection", self.test_connection).pack(side="left", padx=10)
        flat_button(action_row, "Open Discord Server", lambda: webbrowser.open(self.invite_var.get().strip() or DEFAULT_INVITE)).pack(side="left")

        security = self.card(page.content, "Security Model", "No Discord secret or bot token is stored in this app. Your short-lived access token is encrypted with Windows DPAPI. The server re-checks current guild membership and roles regularly; leaving the server or losing an approved role denies further requests.")
        security.pack(fill="x", pady=(0, 12))
        permissions = ["Profile and live Discord role read", "Your linked account read", "Individual item grant/remove", "Collection unlock", "Progress and currency changes", "Safe live controls"]
        for permission in permissions:
            tk.Label(security, text=f"✓  {permission}", fg=COLORS["green"], bg=COLORS["panel"], font=("Segoe UI", 10), anchor="w").pack(fill="x", padx=18, pady=4)
        tk.Frame(security, bg=COLORS["panel"], height=10).pack()

    def load_account(self) -> None:
        self.show_status("Loading your linked Flappy Monkey account…")
        if hasattr(self, "account_identity_label") and self.account_identity_label.winfo_exists():
            self.account_identity_label.configure(text="Checking link…", fg=COLORS["muted"])

        def task() -> dict:
            return self.api.request("GET", "/cheat-api/account")

        def success(result: dict) -> None:
            self.apply_account_snapshot(result)
            account = result.get("account", {})
            self.show_status(f"Loaded your account: {account.get('username', account.get('id', 'Flappy Monkey player'))} · {'online' if result.get('online') else 'offline'}.", success=True)
            # Do not destroy a search/amount field while the user is typing.
            # Only the pages whose visible values depend on this response need
            # an automatic first-load rebuild.
            focused = self.focus_get()
            if self.current_page in {"dashboard", "live"} and not isinstance(focused, tk.Entry):
                self.show_page(self.current_page)

        def failure(error) -> None:
            if hasattr(self, "account_identity_label") and self.account_identity_label.winfo_exists():
                message = str(error).lower()
                if isinstance(error, ApiError) and error.status == 403 and "not linked" in message:
                    label = "Account not linked · Retry"
                elif isinstance(error, ApiError) and error.status == 404:
                    label = "Linked account not found · Retry"
                elif not isinstance(error, ApiError) or error.status == 0 or error.status >= 500:
                    label = "Server unavailable · Retry"
                else:
                    label = "Could not load account · Retry"
                self.account_identity_label.configure(text=label, fg=COLORS["red"])
            self.handle_protected_error(error)

        self.run_async(task, success, failure)

    def apply_account_snapshot(self, result: dict) -> None:
        if not isinstance(result, dict) or not isinstance(result.get("account"), dict):
            return
        self.account = result
        account = result.get("account", {})
        account_id = str(account.get("id", ""))
        if account_id:
            self.target_var.set(account_id)
            if self.config_store.data.get("target_user_id") != account_id:
                self.config_store.data["target_user_id"] = account_id
                self.config_store.save()
        self.refresh_account_widgets()

    def require_target(self) -> str:
        target = str(self.account.get("account", {}).get("id") or self.target_var.get()).strip().upper()
        if not target:
            raise ApiError("Your linked Flappy Monkey account is still loading.")
        return target

    def change_item(self, item: dict, amount_var: tk.StringVar, operation: str) -> None:
        try:
            amount = int(float(amount_var.get() or "1"))
        except ValueError:
            self.show_status("Enter a valid whole-number amount.", error=True)
            return
        verb = "Removing" if operation == "remove" else "Granting"
        self.show_status(f"{verb} {item.get('label', 'item')}…")

        def task() -> dict:
            return self.api.request("POST", "/cheat-api/grant", {
                "operation": operation,
                "reward": {"type": item.get("type"), "itemId": item.get("itemId", ""), "label": item.get("label"), "amount": amount},
            })

        def success(result: dict) -> None:
            self.apply_account_snapshot({**self.account, "account": result.get("account", {}), "owned": result.get("owned", {}), "online": self.account.get("online", False)})
            self.show_status(f"{item.get('label')} {'removed' if operation == 'remove' else 'granted'} successfully.", success=True)

        self.run_async(task, success, self.handle_protected_error)

    def unlock_selected_category(self) -> None:
        category = self.category_label_to_id.get(self.category_var.get(), "all")
        if category == "all":
            self.show_status("Choose a specific category or use Unlock Everything.", error=True)
            return
        self.batch_unlock(category)

    def batch_unlock(self, category: str) -> None:
        label = "your complete collection" if category == "all" else f"all {humanize(category)} items"
        if category == "all" and not messagebox.askyesno(APP_NAME, f"Unlock {label}? This can add hundreds of permanent items to your account."):
            return
        self.show_status(f"Granting {label}. The server is saving every item durably…")

        def task() -> dict:
            return self.api.request("POST", "/cheat-api/batch", {
                "mode": "unlock_all" if category == "all" else "unlock_category",
                "category": "" if category == "all" else category,
            })

        def success(result: dict) -> None:
            self.apply_account_snapshot({**self.account, "account": result.get("account", {}), "owned": result.get("owned", {}), "online": self.account.get("online", False)})
            rejected = len(result.get("rejected", []))
            restricted = int(result.get("skippedRestrictedCount", 0) or 0)
            message = f"Granted {int(result.get('grantedCount', 0)):,} items"
            if restricted:
                message += f" · {restricted} developer-only item{'s' if restricted != 1 else ''} kept locked"
            if rejected:
                message += f" · {rejected} unsupported entries were rejected"
            self.show_status(message + ".", error=bool(rejected), success=not rejected)

        self.run_async(task, success, self.handle_protected_error)

    def apply_live_controls(self) -> None:
        if self._live_save_after_id:
            try:
                self.after_cancel(self._live_save_after_id)
            except tk.TclError:
                pass
            self._live_save_after_id = None
        values = {key: variable.get() for key, variable in self.live_variables.items()}
        self.show_status("Sending live controls to your game…")

        def task() -> dict:
            return self.api.request("POST", "/cheat-api/live", {"values": values})

        def success(result: dict) -> None:
            self.account["live"] = result.get("state", {})
            online = bool(result.get("online"))
            self.account["online"] = online
            self.refresh_account_widgets()
            self.show_status("Live controls applied" + (" to the online game." if online else "; they will apply when that account logs in."), success=True)

        self.run_async(task, success, self.handle_protected_error)

    def schedule_live_controls_save(self) -> None:
        """Persist a finished toggle/slider interaction without rebuilding the page."""
        if self._live_save_after_id:
            try:
                self.after_cancel(self._live_save_after_id)
            except tk.TclError:
                pass
        self._live_save_after_id = self.after(260, self.apply_live_controls)

    def reset_live_controls(self) -> None:
        if self._live_save_after_id:
            try:
                self.after_cancel(self._live_save_after_id)
            except tk.TclError:
                pass
            self._live_save_after_id = None
        self.show_status("Resetting every live control…")
        def task() -> dict:
            return self.api.request("POST", "/cheat-api/live/reset", {})

        def success(result: dict) -> None:
            self.account["live"] = result.get("state", {})
            defaults = {str(cheat.get("id")): cheat.get("default", False) for cheat in self.catalog.get("cheats", [])}
            for control_id, variable in self.live_variables.items():
                if control_id in defaults:
                    variable.set(defaults[control_id])
            self.account["online"] = bool(result.get("online"))
            self.refresh_account_widgets()
            self.show_status("All live controls reset.", success=True)

        self.run_async(task, success, self.handle_protected_error)

    def reset_game_progress(self) -> None:
        if str(getattr(self, "reset_progress_var", tk.StringVar()).get()).strip().upper() != "RESET":
            self.show_status("Type RESET in the confirmation box before resetting progress.", error=True)
            return
        if not messagebox.askyesno(
            "Reset Game Progress",
            "Permanently reset all progress on your linked Flappy Monkey account?\n\nThis cannot be undone.",
            icon="warning",
        ):
            return
        self.show_status("Resetting and durably saving your game progress…")

        def task() -> dict:
            return self.api.request("POST", "/cheat-api/progress/reset", {"confirmation": "RESET"})

        def success(result: dict) -> None:
            self.apply_account_snapshot({
                "account": result.get("account", {}),
                "owned": result.get("owned", {}),
                "live": result.get("live", {}),
                "online": self.account.get("online", False),
            })
            self.reset_progress_var.set("")
            self.show_status("Game progress was fully reset and saved.", success=True)
            self.show_page("dashboard")

        self.run_async(task, success, self.handle_protected_error)

    def refresh_access(self) -> None:
        self.show_status("Refreshing current Discord membership and roles…")

        def task() -> dict:
            return self.api.request("GET", "/cheat-api/me?refresh=1")

        def success(result: dict) -> None:
            self.accept_renewed_token(result)
            self.profile = result.get("profile", self.profile)
            self.show_status("Discord membership and approved role confirmed.", success=True)
            self.build_main_ui(initial_page=self.current_page)

        def failure(error) -> None:
            if isinstance(error, ApiError) and error.status in (401, 403):
                self.token_store.clear()
                self.api.token = ""
                self.show_auth_screen(str(error))
            else:
                self.show_status(str(error), error=True)

        self.run_async(task, success, failure)

    def handle_protected_error(self, error) -> None:
        revoked = isinstance(error, ApiError) and error.status == 403 and any(
            phrase in str(error).lower() for phrase in ("role is no longer", "role is no longer present", "authorization session", "not currently a member")
        )
        if isinstance(error, ApiError) and (error.status == 401 or revoked):
            self.token_store.clear()
            self.api.token = ""
            self.profile = {}
            self.account = {}
            self.show_auth_screen(str(error))
            return
        self.show_status(str(error), error=True)

    def accept_renewed_token(self, response: dict) -> None:
        renewed = str(response.get("accessToken") or "") if isinstance(response, dict) else ""
        if renewed:
            self.api.token = renewed
            self.token_store.save(renewed)

    def schedule_access_check(self) -> None:
        if self._access_poll_after_id:
            try:
                self.after_cancel(self._access_poll_after_id)
            except tk.TclError:
                pass
        # Identity and game-account state do not need a 3-second double poll.
        # A calmer interval avoids request bursts when several authorized staff
        # clients share one network while still reflecting live game changes.
        self._access_poll_after_id = self.after(10_000, self._run_access_check)

    def _run_access_check(self) -> None:
        self._access_poll_after_id = None
        if not self.api.token or not self.profile:
            return

        if self._account_poll_inflight:
            self.schedule_access_check()
            return
        self._account_poll_inflight = True

        def task() -> tuple[dict, dict]:
            # Discord gateway events invalidate the server cache immediately,
            # so this lightweight endpoint does not create REST rate limits.
            access = self.api.request("GET", "/cheat-api/me")
            account = self.api.request("GET", "/cheat-api/account")
            return access, account

        def success(results: tuple[dict, dict]) -> None:
            self._account_poll_inflight = False
            result, account = results
            self.accept_renewed_token(result)
            old_role_signature = tuple((str(role.get("id", "")), str(role.get("name", ""))) for role in self.profile.get("roles", []))
            self.profile = result.get("profile", self.profile)
            new_role_signature = tuple((str(role.get("id", "")), str(role.get("name", ""))) for role in self.profile.get("roles", []))
            self.apply_account_snapshot(account)
            role_label = getattr(self, "sidebar_role_label", None)
            if isinstance(role_label, tk.Label) and role_label.winfo_exists():
                role_label.configure(text=self.main_role_name())
            if old_role_signature != new_role_signature and self.current_page == "profile" and not isinstance(self.focus_get(), tk.Entry):
                self.show_page("profile")
            if self._status_is_error:
                self.show_status("Discord access is active and the server connection has recovered.", success=True)
            self.schedule_access_check()

        def failure(error) -> None:
            self._account_poll_inflight = False
            if isinstance(error, ApiError) and error.status in (401, 403):
                self.handle_protected_error(error)
            else:
                # A temporary network problem should not throw the user out.
                self.schedule_access_check()

        self.run_async(task, success, failure)

    def logout(self) -> None:
        token = self.api.token
        self.token_store.clear()
        self.api.token = ""

        def task() -> None:
            if token:
                temporary_api = ControlDeckApi(self.api.base_url, token)
                try:
                    temporary_api.request("POST", "/cheat-api/logout", {})
                except ApiError:
                    pass

        self.run_async(task)
        self.profile = {}
        self.account = {}
        self.show_auth_screen()

    def choose_banner(self) -> None:
        filename = filedialog.askopenfilename(title="Choose Control Panel profile banner", filetypes=[("Images", "*.png *.jpg *.jpeg *.gif *.webp"), ("All files", "*.*")])
        if filename:
            self.config_store.data["profile_banner"] = filename
            self.config_store.save()
            self.refresh_local_profile_design(reload_banner=True)

    def clear_banner(self) -> None:
        self.config_store.data["profile_banner"] = ""
        self.config_store.save()
        self.refresh_local_profile_design(reload_banner=True)

    def choose_accent(self) -> None:
        color = colorchooser.askcolor(color=str(self.config_store.data.get("accent") or COLORS["purple"]), title="Choose Control Panel accent")[1]
        if color:
            self.config_store.data["accent"] = color
            self.config_store.save()
            self.refresh_local_profile_design()

    def refresh_local_profile_design(self, reload_banner: bool = False) -> None:
        accent = self.profile_accent()
        for panel_name in ("sidebar_profile_card", "profile_hero_panel"):
            panel = getattr(self, panel_name, None)
            if isinstance(panel, RoundedPanel) and panel.winfo_exists():
                panel.border_color = accent
                panel._redraw_surface()
        canvas = getattr(self, "profile_hero_canvas", None)
        if isinstance(canvas, tk.Canvas) and canvas.winfo_exists():
            if reload_banner:
                self.prepare_profile_hero(canvas)
            else:
                self.render_profile_hero(canvas)
        self.show_status("Local profile design updated.", success=True)

    def save_settings(self) -> None:
        server = self.server_var.get().strip().rstrip("/")
        invite = self.invite_var.get().strip()
        if not server.startswith(("https://", "http://")):
            self.show_status("Server URL must begin with https:// or http://.", error=True)
            return
        self.config_store.data["server_url"] = server
        self.config_store.data["invite_url"] = invite or DEFAULT_INVITE
        self.config_store.save()
        self.api.base_url = server
        self.show_status("Settings saved.", success=True)

    def test_connection(self) -> None:
        server = self.server_var.get().strip().rstrip("/")
        self.show_status("Testing the Control Panel server…")

        def task() -> dict:
            return ControlDeckApi(server).request("GET", "/cheat-api/status", authenticated=False)

        def success(result: dict) -> None:
            configured = bool(result.get("configured"))
            self.show_status("Server reachable · Discord authorization " + ("is configured." if configured else "still needs setup."), error=not configured, success=configured)

        self.run_async(task, success, lambda error: self.show_status(str(error), error=True))

    def show_status(self, message: str, error: bool = False, success: bool = False) -> None:
        self._status_is_error = bool(error)
        self.status_var.set(message)
        if hasattr(self, "status_bar") and self.status_bar.winfo_exists():
            color = COLORS["red"] if error else COLORS["green"] if success else COLORS["muted"]
            self.status_bar.configure(fg=color)

    def copy_text(self, value: str) -> None:
        self.clipboard_clear()
        self.clipboard_append(value)
        self.show_status("Copied to clipboard.", success=True)

    @staticmethod
    def format_date(value: str) -> str:
        if not value:
            return "Unavailable"
        try:
            date = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return date.strftime("%B %d, %Y")
        except ValueError:
            return value[:24]

    def load_remote_avatar(self, url: str, label: tk.Label, size: tuple[int, int], round_image: bool = False) -> None:
        if not url or Image is None or ImageTk is None:
            return
        cache_key = (url, size, bool(round_image))
        cached = self._remote_image_cache.get(cache_key)
        if cached is not None:
            photo = ImageTk.PhotoImage(cached)
            label.configure(image=photo, text="", width=0, height=0)
            label.image = photo
            self.image_refs.append(photo)
            return

        def task():
            request = urllib.request.Request(url, headers={"User-Agent": f"{APP_NAME}/{APP_VERSION}"})
            with urllib.request.urlopen(request, timeout=12) as response:
                image = Image.open(io.BytesIO(response.read())).convert("RGBA")
            image = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)
            if round_image:
                mask = Image.new("L", size, 0)
                drawer = ImageDraw.Draw(mask)
                drawer.ellipse((0, 0, size[0] - 1, size[1] - 1), fill=255)
                image.putalpha(mask)
            return image

        def success(image) -> None:
            if label.winfo_exists():
                self._remote_image_cache[cache_key] = image
                photo = ImageTk.PhotoImage(image)
                label.configure(image=photo, text="", width=0, height=0)
                label.image = photo
                self.image_refs.append(photo)

        self.run_async(task, success, lambda _error: None)

    def _build_asset_index(self) -> dict[str, Path]:
        roots = []
        bundled = resource_root()
        for root in (bundled, Path(__file__).resolve().parent.parent, Path.cwd()):
            if root.is_dir() and root not in roots:
                roots.append(root)
        index: dict[str, Path] = {}
        extensions = {".png", ".gif", ".webp", ".jpg", ".jpeg"}
        for root in roots:
            try:
                candidates = list(root.glob("*")) + list((root / "assets").rglob("*")) if (root / "assets").is_dir() else list(root.glob("*"))
                for candidate in candidates:
                    if candidate.is_file() and candidate.suffix.lower() in extensions:
                        key = slugify(candidate.stem)
                        if key and key not in index:
                            index[key] = candidate
            except OSError:
                continue
        return index

    def _load_icon_atlas(self):
        if Image is None:
            return None, {}
        bundled = resource_root()
        candidates = (
            bundled / "assets",
            Path(__file__).resolve().parent / "assets",
        )
        for root in candidates:
            image_path = root / "control-panel-icon-atlas.png"
            map_path = root / "control-panel-icon-atlas.json"
            if not image_path.is_file() or not map_path.is_file():
                continue
            try:
                mapping = json.loads(map_path.read_text(encoding="utf-8"))
                return Image.open(image_path).convert("RGBA").copy(), mapping if isinstance(mapping, dict) else {}
            except (OSError, ValueError):
                continue
        return None, {}

    @staticmethod
    def item_fallback_icon(item: dict) -> str:
        icon_by_category = {
            "skins": "🐵", "titles": "★", "badges": "◆", "themes": "✦",
            "banners": "▰", "emotes": "☺", "world_emotes": "☺", "message_emojis": "☻", "auras": "◉",
            "trails": "➟", "pipe_skins": "▥", "currencies": "●", "powerups": "⚡",
            "crate_tickets": "🎟", "duel": "⚔", "duel_items": "⚔", "event_cosmetics": "✹",
            "explosions": "✷", "title_styles": "✧",
        }
        return icon_by_category.get(str(item.get("category", "")), "◇")

    def _item_asset_path(self, item: dict) -> Path | None:
        label_key = slugify(str(item.get("label", "")))
        item_key = slugify(str(item.get("itemId", "")))
        # The item ID is the authoritative game asset filename. Labels can be
        # shared by a skin, banner, event theme, or audio cue, so matching the
        # label first could show the wrong cosmetic artwork.
        candidates = [item_key, label_key]
        category = str(item.get("category", ""))
        if category == "skins":
            candidates += [f"{label_key}-monkey", label_key.removesuffix("-monkey")]
        if category == "emotes":
            candidates += [f"emote-{item_key}", f"emote-{label_key}"]
        category_prefix = {
            "auras": "aura", "banners": "banner", "world_emotes": "emote",
            "pipe_skins": "pipe", "trails": "trail", "title_styles": "title-style",
        }.get(category)
        if category_prefix:
            candidates += [f"{category_prefix}-{item_key}", f"{category_prefix}-{label_key}"]
        if str(item.get("type")) == "duel_sword":
            candidates += [f"sword-{item_key}"]
        if str(item.get("type")) == "duel_finisher":
            candidates += [f"finisher-{item_key}"]
        if category == "event_cosmetics":
            candidates += [item_key]
        if category == "crate_tickets":
            candidates += [f"crate-{item_key}"]
        if category == "powerups":
            powerup_assets = {
                "extralifetokens": "powerup-extra-life", "coindoublertickets": "powerup-banana-doubler",
                "scoreboostertickets": "powerup-score-booster", "xpboosttokens": "powerup-xp-boost",
                "crateluckboosttokens": "powerup-crate-luck", "revivetokens": "powerup-revive",
            }
            candidates += [powerup_assets.get(item_key, "")]
        candidates = [candidate for candidate in candidates if candidate]
        for key in candidates:
            if key in self.asset_index and not key.endswith("-bg"):
                return self.asset_index[key]
        # Do not use broad prefix/suffix guesses here. For example, a lookup
        # for Boss Breaker Monkey must never fall through to the similarly
        # named Boss Breaker event icon. The bundled atlas provides a designed
        # fallback for entries without an exact source asset.
        return None

    def load_item_icon(self, item: dict, label: tk.Label, size: tuple[int, int]) -> None:
        atlas_key = f"{item.get('type', '')}:{item.get('itemId', '')}"
        box = self._icon_atlas_map.get(atlas_key) if isinstance(self._icon_atlas_map, dict) else None
        if self._icon_atlas_image is not None and isinstance(box, list) and len(box) == 4 and ImageTk is not None:
            try:
                cache_key = (f"atlas:{atlas_key}", size)
                cached = self._item_photo_cache.get(cache_key)
                if cached is None:
                    x, y, width, height = (int(value) for value in box)
                    image = self._icon_atlas_image.crop((x, y, x + width, y + height))
                    image = ImageOps.contain(image, size, method=Image.Resampling.LANCZOS)
                    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
                    canvas.alpha_composite(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
                    cached = ImageTk.PhotoImage(canvas)
                    self._item_photo_cache[cache_key] = cached
                label.configure(image=cached, text="", width=0, height=0)
                label.image = cached
                return
            except (OSError, ValueError, TypeError):
                pass
        path = self._item_asset_path(item)
        if not path or Image is None or ImageTk is None:
            return
        try:
            cache_key = (str(path), size)
            cached = self._item_photo_cache.get(cache_key)
            if cached is not None:
                label.configure(image=cached, text="", width=0, height=0)
                label.image = cached
                return
            image = Image.open(path).convert("RGBA")
            image = ImageOps.contain(image, size, method=Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", size, (0, 0, 0, 0))
            canvas.alpha_composite(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
            photo = ImageTk.PhotoImage(canvas)
            self._item_photo_cache[cache_key] = photo
            label.configure(image=photo, text="", width=0, height=0)
            label.image = photo
            self.image_refs.append(photo)
        except (OSError, ValueError):
            pass

    def load_local_avatar(self, filename: Path, label: tk.Label, size: tuple[int, int]) -> None:
        if Image is None or ImageTk is None:
            return
        try:
            image = Image.open(filename).convert("RGBA")
            image = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)
            mask = Image.new("L", size, 0)
            drawer = ImageDraw.Draw(mask)
            drawer.ellipse((0, 0, size[0] - 1, size[1] - 1), fill=255)
            image.putalpha(mask)
            photo = ImageTk.PhotoImage(image)
            try:
                label_background = str(label.cget("bg"))
            except tk.TclError:
                label_background = COLORS["panel"]
            label.configure(image=photo, text="", width=0, height=0, bg=label_background)
            label.image = photo
            self.image_refs.append(photo)
        except (OSError, ValueError):
            pass

    def load_local_banner(self, filename: str, master: tk.Frame) -> None:
        if Image is None or ImageTk is None:
            return
        try:
            image = Image.open(filename).convert("RGBA")
            image = ImageOps.fit(image, (900, 150), method=Image.Resampling.LANCZOS)
            image.putalpha(72)
            photo = ImageTk.PhotoImage(image)
            label = tk.Label(master, image=photo, bg=COLORS["panel"], bd=0)
            label.place(relx=0, rely=0, relwidth=1, relheight=1)
            label.lift(master.surface_canvas)
            self.image_refs.append(photo)
        except (OSError, ValueError):
            pass

    def prepare_profile_hero(self, canvas: tk.Canvas) -> None:
        canvas._banner_source = None
        canvas._avatar_source = None
        banner_path = str(self.config_store.data.get("profile_banner") or "")
        if Image is not None and banner_path and Path(banner_path).is_file():
            try:
                canvas._banner_source = Image.open(banner_path).convert("RGBA").copy()
            except (OSError, ValueError):
                pass
        canvas.bind("<Configure>", lambda _event: self.render_profile_hero(canvas))
        self.after_idle(lambda: self.render_profile_hero(canvas) if canvas.winfo_exists() else None)
        avatar_url = str(self.profile.get("avatarUrl") or "")
        if avatar_url and Image is not None:
            def task():
                request = urllib.request.Request(avatar_url, headers={"User-Agent": f"{APP_NAME}/{APP_VERSION}"})
                with urllib.request.urlopen(request, timeout=12) as response:
                    return Image.open(io.BytesIO(response.read())).convert("RGBA").copy()

            def success(image) -> None:
                if canvas.winfo_exists():
                    canvas._avatar_source = image
                    self.render_profile_hero(canvas)

            self.run_async(task, success, lambda _error: None)

    def render_profile_hero(self, canvas: tk.Canvas) -> None:
        if not canvas.winfo_exists():
            return
        width = max(520, canvas.winfo_width())
        height = max(150, canvas.winfo_height())
        canvas.delete("all")
        if Image is not None and ImageTk is not None:
            source = getattr(canvas, "_banner_source", None)
            if source is not None:
                art = ImageOps.fit(source, (width, height), method=Image.Resampling.LANCZOS)
            else:
                art = Image.new("RGBA", (width, height), COLORS["panel2"])
                painter = ImageDraw.Draw(art)
                painter.ellipse((width * .55, -height * 1.2, width * 1.12, height * 1.65), fill=COLORS["orb1"])
                painter.ellipse((-width * .18, -height * .8, width * .38, height * 1.4), fill=COLORS["orb2"])
            overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)
            for x in range(width):
                strength = int(182 - min(72, x / max(1, width) * 72))
                overlay_draw.line((x, 0, x, height), fill=(5, 7, 15, strength))
            for y in range(height):
                strength = int(28 + y / max(1, height) * 70)
                overlay_draw.line((0, y, width, y), fill=(4, 6, 12, strength))
            art = Image.alpha_composite(art, overlay)
            mask = Image.new("L", (width, height), 0)
            ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=18, fill=255)
            art.putalpha(mask)
            photo = ImageTk.PhotoImage(art)
            canvas._hero_photo = photo
            canvas.create_image(0, 0, image=photo, anchor="nw")
        else:
            _rounded_rectangle(canvas, 0, 0, width - 1, height - 1, 18, fill=COLORS["panel2"], outline=COLORS["stroke"])

        accent = self.profile_accent()
        avatar_x, avatar_y, avatar_size = 66, height / 2, 92
        canvas.create_oval(avatar_x - 50, avatar_y - 50, avatar_x + 50, avatar_y + 50, fill=blend_color(COLORS["panel"], accent, .2), outline=accent, width=3)
        avatar_source = getattr(canvas, "_avatar_source", None)
        if avatar_source is not None and Image is not None and ImageTk is not None:
            avatar = ImageOps.fit(avatar_source, (avatar_size, avatar_size), method=Image.Resampling.LANCZOS)
            avatar_mask = Image.new("L", (avatar_size, avatar_size), 0)
            ImageDraw.Draw(avatar_mask).ellipse((0, 0, avatar_size - 1, avatar_size - 1), fill=255)
            avatar.putalpha(avatar_mask)
            avatar_photo = ImageTk.PhotoImage(avatar)
            canvas._hero_avatar_photo = avatar_photo
            canvas.create_image(avatar_x, avatar_y, image=avatar_photo)
        else:
            canvas.create_text(avatar_x, avatar_y, text=self.initials(), fill=COLORS["text"], font=("Segoe UI", 20, "bold"))

        text_x = 132
        canvas.create_text(text_x, height / 2 - 36, text=self.profile_name(), fill=COLORS["text"], font=("Segoe UI", 24, "bold"), anchor="w")
        canvas.create_text(text_x, height / 2 + 1, text=f"@{self.profile.get('username', '')}  ·  {self.main_role_name()}", fill=accent, font=("Segoe UI", 10, "bold"), anchor="w")
        canvas.create_text(text_x, height / 2 + 28, text=f"Discord User ID  {self.profile.get('id', '')}", fill=COLORS["muted"], font=("Consolas", 9), anchor="w")

    def _close(self) -> None:
        if self._poll_after_id:
            try:
                self.after_cancel(self._poll_after_id)
            except tk.TclError:
                pass
        if self._access_poll_after_id:
            try:
                self.after_cancel(self._access_poll_after_id)
            except tk.TclError:
                pass
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.destroy()


if __name__ == "__main__":
    ControlDeckApp().mainloop()
