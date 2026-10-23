#!/usr/bin/env python3
"""Generate deterministic Project Dashboard placeholder/store icons; source for asset audit."""
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]/'extension'/'icons'
root.mkdir(parents=True, exist_ok=True)
# Explicit size, no runtime assets or fonts.
for size in (16, 48, 128):
    S=512
    im=Image.new('RGBA',(S,S),(0,0,0,0))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((16,16,496,496),radius=112,fill='#121820')
    d.rounded_rectangle((87,94,423,418),radius=45,outline='#65758b',width=19)
    # Four status tiles, two filled, one active and one outline
    d.rounded_rectangle((125,132,236,242),radius=22,fill='#eef2f8')
    d.rounded_rectangle((272,132,383,242),radius=22,fill='#6d91ce')
    d.rounded_rectangle((125,278,236,380),radius=22,fill='#697584')
    d.rounded_rectangle((272,278,383,380),radius=22,outline='#dae3f2',width=19)
    im.resize((size,size),Image.Resampling.LANCZOS).save(root/f'icon{size}.png', optimize=True)
print('Generated', *(f'{(root/f"icon{s}.png").stat().st_size}B' for s in (16,48,128)))