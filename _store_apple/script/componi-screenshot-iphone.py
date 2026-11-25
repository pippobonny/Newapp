#!/usr/bin/env python3
"""Screenshot App Store (iPhone 6.9" 1320x2868 e 6.5" 1242x2688) ricavati dagli
screenshot del Play Store (1080x1920, dati di prova inventati, nessun utente vero).
Uso:  python3 componi-screenshot-iphone.py   (dalla cartella _store_apple/script)
Il titolo in alto resta uguale, il telefono viene ingrandito per riempire il
formato più lungo dell'iPhone. (Filippo, 2026-11-25)"""
from pathlib import Path
from PIL import Image

BASE = Path(__file__).resolve().parent.parent.parent  # cartella App
SRC = BASE / "_store_play"
OUT = BASE / "_store_apple" / "screenshot"
W, H = 1320, 2868
SPLIT = 330      # riga (nello screenshot Play) tra titolo e telefono
PAD_TOP = 150    # spazio in più sopra il titolo
BLEND = 60       # sfumatura tra le due parti

def componi(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGB")
    sw, sh = im.size
    canvas = Image.new("RGB", (W, H))
    # 1) striscia in alto: allungo le prime righe (solo sfondo)
    canvas.paste(im.crop((0, 0, sw, 4)).resize((W, PAD_TOP), Image.LANCZOS), (0, 0))
    # 2) titolo, stessa proporzione dell'originale
    s1 = W / sw
    top = im.crop((0, 0, sw, SPLIT)).resize((W, round(SPLIT * s1)), Image.LANCZOS)
    canvas.paste(top, (0, PAD_TOP))
    y_seam = PAD_TOP + top.size[1]
    # 3) telefono ingrandito fino in fondo, tagliato ai lati
    s2 = (H - y_seam) / (sh - SPLIT)
    start = SPLIT - BLEND / s2
    phone = im.crop((0, round(start), sw, sh))
    pw, ph = round(sw * s2), H - (y_seam - BLEND)
    phone = phone.resize((pw, ph), Image.LANCZOS)
    left = (pw - W) // 2
    phone = phone.crop((left, 0, left + W, ph))
    mask = Image.new("L", (W, ph), 255)
    for y in range(BLEND):
        mask.paste(round(255 * y / BLEND), (0, y, W, y + 1))
    canvas.paste(phone, (0, y_seam - BLEND), mask)
    return canvas

def main():
    for lang in ("italiano", "inglese"):
        for i in range(1, 7):
            src = SRC / lang / f"screenshot-{i}.png"
            if not src.exists():
                continue
            img = componi(src)
            d69 = OUT / lang / "6.9-pollici"
            d65 = OUT / lang / "6.5-pollici"
            d69.mkdir(parents=True, exist_ok=True)
            d65.mkdir(parents=True, exist_ok=True)
            img.save(d69 / f"screenshot-{i}.png", optimize=True)
            # 6.5": stessa immagine rimpicciolita a 1242 di larghezza, tagliata a 2688
            h65 = round(H * 1242 / W)
            small = img.resize((1242, h65), Image.LANCZOS)
            off = (h65 - 2688) // 2
            small.crop((0, off, 1242, off + 2688)).save(d65 / f"screenshot-{i}.png", optimize=True)
            print("ok", lang, i)

if __name__ == "__main__":
    main()
