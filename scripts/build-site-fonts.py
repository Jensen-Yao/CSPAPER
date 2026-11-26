"""Build the self-hosted webfonts used by GitHub Pages and the online demo.

- Noto Serif SC / Noto Sans SC (OFL): instanced to fixed weights and subset to the
  characters that actually occur in the site sources.
- Inter / DM Mono (OFL): the Latin subsets are copied from the local UIYC font mirror.

Re-run after changing site copy so that new characters are included.

Usage: python scripts/build-site-fonts.py [--uiycs F:/REA-anything/uiycs]
Requires: fonttools, brotli.
"""
import argparse
import glob
import os
import shutil
import sys
import tempfile

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
OUT = os.path.join(DOCS, "assets", "fonts")
SOURCES = ["index.html", os.path.join("demo", "index.html"), os.path.join("demo", "demo.js"), os.path.join("..", "scripts", "banner", "banner.html")]
EXTRA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" + \
        "　、。〃々〈〉《》「」『』【】〔〕〖〗〘〙〚〛〜〝〞〟〰〾〿–—‘’‛“”„†‡•…‰′″‹››※‼⁇⁈⁉⁓" + \
        "１２３４５６７８９０％＋－＝（）｛｝［］｜：；，．／＠＃＄＾＆＊"


def site_text():
    text = EXTRA
    for name in SOURCES:
        path = os.path.join(DOCS, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                text += handle.read()
    return "".join(sorted(set(text)))


def instance_and_subset(source, weight, text, output):
    font = TTFont(source)
    static = instantiateVariableFont(font, {"wght": weight}, updateFontNames=True)
    handle, static_path = tempfile.mkstemp(suffix=".ttf")
    os.close(handle)
    try:
        static.save(static_path)
        text_handle, text_path = tempfile.mkstemp(suffix=".txt")
        with os.fdopen(text_handle, "w", encoding="utf-8") as stream:
            stream.write(text)
        try:
            subset.main([static_path, "--text-file=" + text_path, "--flavor=woff2", "--output-file=" + output,
                         "--name-IDs=0,1,2,3,4,5,6,13,14", "--drop-tables+=DSIG"])
        finally:
            os.remove(text_path)
    finally:
        os.remove(static_path)
    print(os.path.basename(output), str(os.path.getsize(output) // 1024) + " KB")


def latin_file(family_dir):
    """Pick the Google Fonts 'latin' subset: has e-acute and em dash, lacks A-macron."""
    for path in sorted(glob.glob(os.path.join(family_dir, "*.woff2"))):
        font = TTFont(path)
        cmap = font.getBestCmap()
        font.close()
        if 0xE9 in cmap and 0x2014 in cmap and 0x100 not in cmap:
            return path
    raise SystemExit("latin subset not found in " + family_dir)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--uiycs", default="F:/REA-anything/uiycs")
    args = parser.parse_args()
    os.makedirs(OUT, exist_ok=True)
    text = site_text()
    print("unique characters:", len(set(text)))
    cjk = os.path.join(args.uiycs, "fonts-cjk")
    instance_and_subset(os.path.join(cjk, "noto-serif-sc", "NotoSerifSC-VF.ttf"), 600, text, os.path.join(OUT, "serif-sc-600.woff2"))
    sans = os.path.join(cjk, "noto-sans-sc", "NotoSansSC-VF.ttf")
    for weight in (400, 700):
        instance_and_subset(sans, weight, text, os.path.join(OUT, "sans-sc-%d.woff2" % weight))
    for family, weight, name in (("inter", 400, "inter-400.woff2"), ("inter", 700, "inter-700.woff2"), ("dm-mono", 400, "dm-mono-400.woff2")):
        source = latin_file(os.path.join(args.uiycs, "fonts", family))
        shutil.copyfile(source, os.path.join(OUT, name))
        print(name, str(os.path.getsize(os.path.join(OUT, name)) // 1024) + " KB")
    # All bundled families use the SIL Open Font License 1.1; keep one copy of the license text.
    license_path = os.path.join(args.uiycs, "fonts", "inter", "OFL.txt")
    if os.path.exists(license_path):
        shutil.copyfile(license_path, os.path.join(OUT, "OFL.txt"))
    return 0


if __name__ == "__main__":
    sys.exit(main())