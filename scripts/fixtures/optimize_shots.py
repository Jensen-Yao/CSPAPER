"""Convert captured PNG masters into optimized WebP files for README and GitHub Pages.

Usage: python scripts/fixtures/optimize_shots.py <raw_dir> <docs/screenshots>
"""
import os
import sys

from PIL import Image

source, target = sys.argv[1], sys.argv[2]
os.makedirs(target, exist_ok=True)
for name in sorted(os.listdir(source)):
    if not name.endswith(".png"):
        continue
    image = Image.open(os.path.join(source, name)).convert("RGB")
    output = os.path.join(target, name[:-4] + ".webp")
    image.save(output, "WEBP", quality=84, method=6)
    print(name, image.size, str(os.path.getsize(output) // 1024) + " KB")