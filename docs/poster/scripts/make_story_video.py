"""Cut the story version of the robot-dog demo: real wildfire footage, the animated robot dog and
the simulator recording, each shot tagged with what it is.

Run from the repo root (after render_robot_anim.py):
  python3 -I docs/poster/scripts/make_story_video.py [--long]
Writes docs/poster/media/robot-dog-story.mp4 (1920x1080, 30 fps), or with --long the 90 s cut
docs/poster/media/robot-dog-story-90s.mp4: no animation (the robot-dog design image instead), longer
simulator shots, a rule card and a results card.

Inputs:
  media/real/*.mp4         trimmed Pexels clips (see media/real/CREDITS.md)
  media/anim/*.mp4         animated robot dog (render_robot_anim.py)
  media/robot-dog-demo.mp4 captioned simulator recording (record_robot_demo.py)
"""
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[3]
MEDIA = ROOT / "docs/poster/media"
LONG = "--long" in sys.argv
OUT = MEDIA / ("robot-dog-story-90s.mp4" if LONG else "robot-dog-story.mp4")
W, H, FPS, FADE = 1920, 1080, 30, 0.25
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
REG, BOLD = 0, 1
BLUE, ORANGE, RED = (141, 180, 255), (242, 165, 65), (226, 0, 26)

REAL, ANIM, SIM = "Real footage (Pexels)", "Animation", "Simulation"
CONCEPT = "Design concept (image)"
ROBOT_PNG = ROOT / "docs/poster/img/wildfire-robot-transparent.png"
SIM_SRC = MEDIA / "robot-dog-demo.mp4"

# (source, start s, duration s, tag, caption heading, caption text, heading colour).
# Simulator shots carry their own captions from the recording.
SHOTS = [
    ("card:title", 0, 3.5, None, None, None, None),
    (MEDIA / "real/fire-smoke-sunset.mp4", 0, 5, REAL, "The fire", "A wildfire burns on steep, brushy slopes.", ORANGE),
    (MEDIA / "real/crew-aerial.mp4", 0.5, 5, REAL, "The crew", "Too dangerous to send firefighters close enough to see where the edge is going.", ORANGE),
    (MEDIA / "anim/ready.mp4", 0.5, 4, ANIM, "The robot dog", "Ready at staging, with a forecast of where the fire will spread.", BLUE),
    (SIM_SRC, 2, 7.5, SIM, None, None, None),
    (MEDIA / "anim/depart.mp4", 0.5, 4.5, ANIM, "1 · Launch", "It sets off on a route that keeps 100 m from the forecast fire, with 30 minutes in hand.", BLUE),
    (MEDIA / "real/smoke-plume.mp4", 0.5, 5, REAL, "2 · Wind shifts", "The real wind changes and pushes the fire a new way.", ORANGE),
    (SIM_SRC, 10.5, 2.5, SIM, None, None, None),
    (MEDIA / "real/charred-ground.mp4", 0.5, 4, REAL, "3 · Measure", "Near the fire edge, the ground is still smouldering.", BLUE),
    (MEDIA / "anim/scout.mp4", 0.5, 4, ANIM, "3 · Measure", "The dog walks closer to the real fire.", BLUE),
    (MEDIA / "anim/measure.mp4", 0.5, 4.5, ANIM, "3 · Measure", "It measures wind, temperature, humidity and where the edge really is.", BLUE),
    (SIM_SRC, 24.0, 6.5, SIM, None, None, None),
    (SIM_SRC, 30.6, 4.5, SIM, None, None, None),
    (MEDIA / "anim/home.mp4", 0.5, 4.5, ANIM, "6 · Home safe", "It walks home on its escape path, ahead of the fire.", BLUE),
    (SIM_SRC, 37.6, 3.7, SIM, None, None, None),
    ("card:credits", 0, 6, None, None, None, None),
]
if LONG:
    # Same story with time to read, and no animation: the robot-dog design image (slow push-in) stands in for it.
    # ("still:robot", zoom-to, focus x, focus y): the push-in ends at `zoom-to`, holding the focus point still.
    SHOTS = [
        ("card:title", 0, 4, None, None, None, None),
        (MEDIA / "real/fire-smoke-sunset.mp4", 0, 6, REAL, "The fire", "A wildfire burns on steep, brushy slopes.", ORANGE),
        (MEDIA / "real/crew-aerial.mp4", 0, 6, REAL, "The crew", "Too dangerous to send firefighters close enough to see where the edge is going.", ORANGE),
        (("still:robot", 1.08, 960, 470), 0, 5.5, CONCEPT, "The robot dog", "Ready at staging, with a forecast of where the fire will spread.", BLUE),
        ("card:rule", 0, 6, None, None, None, None),
        (SIM_SRC, 1.5, 8.3, SIM, None, None, None),
        (MEDIA / "real/smoke-plume.mp4", 0, 6, REAL, "2 · Wind shifts", "The real wind changes and pushes the fire a new way.", ORANGE),
        (SIM_SRC, 10.3, 9, SIM, None, None, None),
        (MEDIA / "real/charred-ground.mp4", 0, 5, REAL, "3 · Measure", "Near the fire edge, the ground is still smouldering.", BLUE),
        (("still:robot", 1.45, 1160, 330), 0, 5.5, CONCEPT, "3 · Measure", "It measures wind, temperature, humidity and where the edge really is.", BLUE),
        (SIM_SRC, 24.0, 6.5, SIM, None, None, None),
        (SIM_SRC, 30.6, 4.5, SIM, None, None, None),
        (SIM_SRC, 36.7, 4.6, SIM, None, None, None),
        ("card:results", 0, 7, None, None, None, None),
        ("card:credits", 0, 5.3, None, None, None, None),
    ]

def font(size, face=REG):
    return ImageFont.truetype(FONT, size, index=face)


def wrap(draw, text, f, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=f) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def overlay(tag, head, text, colour):
    """Transparent 1920x1080 layer: what-is-this tag top left, caption box bottom centre."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(30, BOLD)
    fill, ink = {REAL: ((255, 255, 255, 235), (0, 0, 0)), ANIM: ((26, 79, 194, 235), (255, 255, 255)),
                 CONCEPT: ((26, 79, 194, 235), (255, 255, 255)), SIM: ((0, 0, 0, 215), (255, 255, 255))}[tag]
    tw = d.textlength(tag, font=f)
    d.rectangle([48, 44, 48 + tw + 36, 44 + 56], fill=fill)
    d.text((48 + 18, 44 + 12), tag, font=f, fill=ink)
    if head:
        fh, fb = font(34, BOLD), font(34)
        lines = wrap(d, text, fb, 1100)
        bw = max([d.textlength(head, font=fh)] + [d.textlength(l, font=fb) for l in lines]) + 64
        bh = 30 + 44 + 44 * len(lines) + 22
        x0, y0 = (W - bw) / 2, H - 70 - bh
        d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=14, fill=(18, 22, 30, 215))
        d.text((W / 2, y0 + 30), head, font=fh, fill=colour, anchor="mt")
        for i, l in enumerate(lines):
            d.text((W / 2, y0 + 30 + 44 + 44 * i), l, font=fb, fill=(255, 255, 255), anchor="mt")
    return img


def card(kind):
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    if kind == "title":
        d.rectangle([140, 300, W - 140, 312], fill=(0, 0, 0))
        d.text((140, 340), "Fire-aware", font=font(150, BOLD), fill=(0, 0, 0))
        d.text((140, 500), "robot dogs", font=font(150, BOLD), fill=RED)
        robot = "our robot-dog design" if LONG else "our animated robot dog"
        d.text((140, 720), f"One afternoon at a wildfire: real footage, {robot}, and our simulator.",
               font=font(40), fill=(0, 0, 0))
    elif kind == "rule":
        d.rectangle([140, 300, W - 140, 312], fill=(0, 0, 0))
        d.text((140, 340), "The dog's rule", font=font(80, BOLD), fill=(0, 0, 0))
        d.text((140, 480), "Stay at least 100 m from where the fire", font=font(72, BOLD), fill=RED)
        d.text((140, 570), "is predicted to be, with 30 minutes in hand.", font=font(72, BOLD), fill=RED)
        d.text((140, 720), "It scouts from the closest spot that keeps this rule and still has a way home.",
               font=font(40), fill=(0, 0, 0))
    elif kind == "results":
        d.rectangle([140, 200, W - 140, 212], fill=(0, 0, 0))
        d.text((140, 240), "430 simulated missions", font=font(80, BOLD), fill=(0, 0, 0))
        d.text((140, 350), "The real fire ran hotter and drier than forecast, often with a wind shift.",
               font=font(40), fill=(60, 60, 60))
        cols = [(140, "91%", "reached its scout spot", (0, 71, 187)), (900, "0.5%", "caught by the fire", RED)]
        for x, big, label, colour in cols:
            d.text((x, 450), big, font=font(200, BOLD), fill=colour)
            d.text((x, 690), label, font=font(48, BOLD), fill=(0, 0, 0))
        d.text((140, 840), "A dog that only reacts to the flames it sees, keeping 200 m away: 27% reached, 0.2% caught.",
               font=font(40), fill=(60, 60, 60))
        d.text((140, 940), "Simulated on made-up terrain. No physical robot.", font=font(36), fill=(60, 60, 60))
    else:
        d.rectangle([140, 200, W - 140, 212], fill=(0, 0, 0))
        d.text((140, 240), "What you saw", font=font(80, BOLD), fill=(0, 0, 0))
        rows = [
            ("Real footage", "Pexels, by Kelly (@kelly): aerial fire at sunset, firefighters, smoke plume, charred forest floor. Not the Big Sur fire."),
            ("Design" if LONG else "Animation", "Our robot-dog design concept (image). No physical robot was used." if LONG
             else "Our robot-dog design, animated in three.js. No physical robot was used."),
            ("Simulation", "Our wildfire simulator and robot-dog planner on real Big Sur terrain (Google Photorealistic 3D Tiles)."),
            ("Code", "github.com/sxz2012/wildfire-simulation"),
        ]
        y = 400
        for k, v in rows:
            d.text((140, y), k, font=font(38, BOLD), fill=(0, 0, 0))
            for i, l in enumerate(wrap(d, v, font(38), 1240)):
                d.text((520, y + 50 * i), l, font=font(38), fill=(60, 60, 60))
            y += 50 * len(wrap(d, v, font(38), 1240)) + 40
        d.text((140, 940), "Shawn Zeng · Monta Vista High School", font=font(36, BOLD), fill=RED)
    return img


def robot_still():
    """The robot-dog design image on white, above the caption box, at 2x for a smooth push-in."""
    img = Image.new("RGB", (2 * W, 2 * H), (255, 255, 255))
    robot = Image.open(ROBOT_PNG).convert("RGBA")
    h = 2 * 820
    robot = robot.resize((round(robot.width * h / robot.height), h), Image.LANCZOS)
    img.paste(robot, ((2 * W - robot.width) // 2, 2 * 40), robot)
    return img


def run(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *map(str, args)], check=True)


with tempfile.TemporaryDirectory() as tmpdir:
    tmp = pathlib.Path(tmpdir)
    parts = []
    for i, (src, start, dur, tag, head, text, colour) in enumerate(SHOTS):
        part = tmp / f"{i:02d}.mp4"
        fades = f"fade=in:st=0:d={FADE},fade=out:st={dur - FADE}:d={FADE}"
        if isinstance(src, tuple):
            # Design image: push in toward (fx, fy) (output pixels), caption layer on top, not zoomed.
            _, zoom_to, fx, fy = src
            base, png = tmp / f"{i:02d}-base.png", tmp / f"{i:02d}.png"
            robot_still().save(base)
            overlay(tag, head, text, colour).save(png)
            frames = round(dur * FPS)
            z = f"1+({zoom_to}-1)*on/{frames}"
            zoom = (f"zoompan=z='{z}':d={frames}:s={W}x{H}:fps={FPS}"
                    f":x='{2 * fx}*(1-1/zoom)':y='{2 * fy}*(1-1/zoom)'")
            run("-loop", 1, "-t", dur, "-i", base, "-i", png, "-filter_complex",
                f"[0:v]{zoom},setsar=1[b];[b][1:v]overlay=0:0,format=yuv420p,{fades}",
                "-t", dur, "-c:v", "libx264", "-crf", 18, part)
        elif isinstance(src, str):
            png = tmp / f"{i:02d}.png"
            card(src.split(":")[1]).save(png)
            run("-loop", 1, "-t", dur, "-i", png, "-vf", f"fps={FPS},format=yuv420p,{fades}",
                "-c:v", "libx264", "-crf", 18, part)
        else:
            png = tmp / f"{i:02d}.png"
            overlay(tag, head, text, colour).save(png)
            run("-ss", start, "-t", dur, "-i", src, "-i", png, "-an", "-filter_complex",
                f"[0:v]scale={W}:{H},fps={FPS},setsar=1[b];[b][1:v]overlay=0:0,format=yuv420p,{fades}",
                "-c:v", "libx264", "-crf", 18, part)
        parts.append(part)
    (tmp / "list.txt").write_text("".join(f"file '{p}'\n" for p in parts))
    run("-f", "concat", "-safe", 0, "-i", tmp / "list.txt", "-c:v", "libx264", "-crf", 25,
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT)

print("wrote", OUT.relative_to(ROOT))
