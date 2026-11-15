"""
Generates high-resolution museum-grade social preview graphics for XYLEM.
Creates:
  - public/og-preview.png (1200x630, 24-bit RGB)
  - public/og-preview.svg (1200x630 vector SVG)
"""

import math
import os
import sys
from PIL import Image, ImageDraw, ImageFont

WIDTH = 1200
HEIGHT = 630

def create_og_preview_png(output_path: str):
    img = Image.new("RGBA", (WIDTH, HEIGHT), (18, 16, 14, 255))
    draw = ImageDraw.Draw(img)

    # 1. Subtle radial ambient gradient / vignette
    cx_bg, cy_bg = 380, 315
    for r in range(450, 0, -5):
        alpha = int(28 * (1.0 - r / 450.0))
        draw.ellipse(
            [cx_bg - r, cy_bg - r, cx_bg + r, cy_bg + r],
            fill=(45, 38, 30, alpha)
        )

    # 2. Draw fine museum border & header rules
    draw.rectangle([20, 20, WIDTH - 20, HEIGHT - 20], outline=(48, 40, 32, 200), width=1)
    draw.rectangle([24, 24, WIDTH - 24, HEIGHT - 24], outline=(38, 32, 26, 140), width=1)

    # 3. Draw Organic Dendrochronology Specimen (Center around 380, 315)
    center_x = 380.0
    center_y = 315.0
    pith_x = 372.0
    pith_y = 322.0
    num_rings = 68
    max_radius = 230.0

    # Draw medullary rays radiating outward from pith
    num_rays = 48
    for ray_idx in range(num_rays):
        angle = (ray_idx / num_rays) * 2.0 * math.pi + 0.15
        r_start = 12.0
        r_end = max_radius * (0.88 + 0.10 * math.sin(ray_idx * 3.7))
        x1 = pith_x + r_start * math.cos(angle)
        y1 = pith_y + r_start * math.sin(angle)
        x2 = pith_x + r_end * math.cos(angle)
        y2 = pith_y + r_end * math.sin(angle)
        draw.line([(x1, y1), (x2, y2)], fill=(62, 50, 38, 45), width=1)

    # Fire scar parameters (azimuth 70 deg to 115 deg)
    scar_start_deg = 65.0
    scar_end_deg = 118.0
    scar_start_rad = math.radians(scar_start_deg)
    scar_end_rad = math.radians(scar_end_deg)
    scar_year_ring = 42

    # Draw concentric growth rings from outermost bark to pith
    # Pre-render rings
    for ring_idx in range(num_rings, 0, -1):
        frac = ring_idx / num_rings
        r_base = frac * max_radius
        
        # Color palettes: Heartwood (inner 60%) to Sapwood (outer 40%)
        is_heartwood = frac < 0.62
        if is_heartwood:
            # Rich aged heartwood tones: amber, umber, deep chestnut
            blend = frac / 0.62
            ew_r = int(145 + blend * 55)
            ew_g = int(95 + blend * 50)
            ew_b = int(55 + blend * 40)
            lw_r, lw_g, lw_b = int(58 + blend * 20), int(36 + blend * 15), int(22 + blend * 10)
        else:
            # Pale sapwood tones: honey, parchment, bone
            blend = (frac - 0.62) / 0.38
            ew_r = int(200 + blend * 25)
            ew_g = int(170 + blend * 20)
            ew_b = int(125 + blend * 20)
            lw_r, lw_g, lw_b = int(95 + blend * 25), int(72 + blend * 20), int(48 + blend * 15)

        # Anisotropic eccentricity: compression reaction wood in quadrant 3 (angle ~ 215 deg)
        # Build polygon vertices for this ring boundary
        points = []
        num_steps = 140
        for step in range(num_steps):
            th = (step / num_steps) * 2.0 * math.pi
            
            # Reaction wood harmonic
            eccentricity = 1.0 + 0.14 * math.cos(th - math.radians(215.0))
            # Organic waviness
            wave = (
                0.022 * math.sin(5.0 * th + ring_idx * 0.3) +
                0.015 * math.cos(8.0 * th - ring_idx * 0.2) +
                0.008 * math.sin(13.0 * th)
            )
            r = r_base * eccentricity * (1.0 + wave)

            # Fire scar catface flattening / notch if ring is after fire
            if ring_idx > scar_year_ring:
                th_deg = math.degrees(th) % 360.0
                if scar_start_deg <= th_deg <= scar_end_deg:
                    # Inward roll / depression
                    mid_scar = (scar_start_deg + scar_end_deg) / 2.0
                    dist_to_mid = abs(th_deg - mid_scar) / ((scar_end_deg - scar_start_deg) / 2.0)
                    depression = (1.0 - dist_to_mid ** 2) * (max_radius * 0.22)
                    r = max(10.0, r - depression)

            # Pith displacement migrates toward center as tree matures
            px = pith_x * (1.0 - frac * 0.6) + center_x * (frac * 0.6)
            py = pith_y * (1.0 - frac * 0.6) + center_y * (frac * 0.6)
            x = px + r * math.cos(th)
            y = py + r * math.sin(th)
            points.append((x, y))

        # Fill the ring polygon with earlywood
        draw.polygon(points, fill=(ew_r, ew_g, ew_b, 235), outline=(lw_r, lw_g, lw_b, 255))

    # Draw Bark Periderm around outer rim
    for bark_step in range(160):
        th = (bark_step / 160.0) * 2.0 * math.pi
        eccentricity = 1.0 + 0.14 * math.cos(th - math.radians(215.0))
        wave = 0.03 * math.sin(7.0 * th) + 0.02 * math.cos(14.0 * th)
        r_inner = max_radius * eccentricity * (1.0 + wave)
        r_outer = r_inner + 12.0 + 4.0 * math.sin(21.0 * th)
        
        x1 = center_x + r_inner * math.cos(th)
        y1 = center_y + r_inner * math.sin(th)
        x2 = center_x + r_outer * math.cos(th)
        y2 = center_y + r_outer * math.sin(th)
        bark_color = (42 + int(12 * math.sin(th * 9)), 30 + int(8 * math.sin(th * 9)), 22, 240)
        draw.line([(x1, y1), (x2, y2)], fill=bark_color, width=4)

    # Draw Fire Catface Charred Heartwood Exposure
    scar_poly = []
    for step in range(30):
        th = scar_start_rad + (step / 29.0) * (scar_end_rad - scar_start_rad)
        r = (scar_year_ring / num_rings) * max_radius * (1.0 + 0.14 * math.cos(th - math.radians(215.0))) * 0.94
        x = center_x + r * math.cos(th)
        y = center_y + r * math.sin(th)
        scar_poly.append((x, y))
    # Close polygon near center
    mid_scar_rad = (scar_start_rad + scar_end_rad) / 2.0
    scar_apex_r = (scar_year_ring / num_rings) * max_radius * 0.70
    scar_poly.append((center_x + scar_apex_r * math.cos(mid_scar_rad), center_y + scar_apex_r * math.sin(mid_scar_rad)))
    draw.polygon(scar_poly, fill=(24, 18, 14, 255), outline=(12, 8, 6, 255))

    # Draw Inward-Curling Woundwood Callus Margins
    for apex_pt, curl_dir in [(scar_poly[0], 1), (scar_poly[-2], -1)]:
        cx_curl, cy_curl = apex_pt
        draw.ellipse(
            [cx_curl - 7, cy_curl - 7, cx_curl + 7, cy_curl + 7],
            fill=(180, 140, 95, 255),
            outline=(45, 28, 16, 255),
            width=2
        )

    # Draw Traumatic Resin Pockets (Tangential lenticular inclusions)
    resin_spots = [
        (math.radians(160.0), max_radius * 0.48, 18, 5),
        (math.radians(290.0), max_radius * 0.65, 22, 6),
        (math.radians(340.0), max_radius * 0.38, 14, 4),
    ]
    for r_th, r_dist, r_w, r_h in resin_spots:
        rx = center_x + r_dist * math.cos(r_th)
        ry = center_y + r_dist * math.sin(r_th)
        draw.ellipse(
            [rx - r_w / 2, ry - r_h / 2, rx + r_w / 2, ry + r_h / 2],
            fill=(225, 145, 30, 240),
            outline=(85, 45, 10, 255),
            width=1
        )

    # Draw Dark Pith Core
    draw.ellipse([pith_x - 5, pith_y - 5, pith_x + 5, pith_y + 5], fill=(48, 28, 14, 255), outline=(20, 12, 6, 255))

    # 4. Typographic Ledger & Curatorial Framing (Right side)
    try:
        font_badge = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
        font_title = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", 58)
        font_subtitle = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 16)
        font_body = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 14)
        font_ledger_title = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 13)
        font_ledger_val = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
        font_url = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 14)
    except Exception:
        font_badge = ImageFont.load_default()
        font_title = font_badge
        font_subtitle = font_badge
        font_body = font_badge
        font_ledger_title = font_badge
        font_ledger_val = font_badge
        font_url = font_badge

    # Header Badge (Top Left of right column)
    col_x = 680
    top_y = 65

    draw.text((col_x, top_y), "MUSEUM OF GENERATIVE DENDROCHRONOLOGY · ARCHIVAL MONOGRAPH", font=font_badge, fill=(185, 155, 115, 230))
    
    # Title "XYLEM"
    draw.text((col_x, top_y + 26), "XYLEM", font=font_title, fill=(248, 245, 238, 255))
    
    # Subtitle
    draw.text((col_x, top_y + 98), "AN ECOLOGICAL LEDGER OF DEEP TIME · RETROSPECTIVE DENDROCHRONOLOGY", font=font_subtitle, fill=(212, 192, 168, 255))
    
    # Fine separator rule
    draw.line([(col_x, top_y + 130), (WIDTH - 60, top_y + 130)], fill=(75, 62, 50, 180), width=1)

    # Curatorial Thesis Paragraph
    thesis_lines = [
        "A museum-grade generative installation reading planetary ecological",
        "history in reverse through cellular wood anatomy, earlywood/latewood",
        "transitions, decadal megadroughts, and anatomical trauma markers."
    ]
    cur_y = top_y + 148
    for line in thesis_lines:
        draw.text((col_x, cur_y), line, font=font_body, fill=(185, 175, 160, 240))
        cur_y += 22

    # Archival Specimen Data Card (Structured Ledger Box)
    box_x = col_x
    box_y = cur_y + 18
    box_w = WIDTH - 60 - box_x
    box_h = 192

    # Card background and border
    draw.rectangle([box_x, box_y, box_x + box_w, box_y + box_h], fill=(24, 21, 18, 230), outline=(58, 48, 38, 200), width=1)
    draw.rectangle([box_x + 1, box_y + 1, box_x + box_w - 1, box_y + 26], fill=(34, 29, 25, 255))
    draw.text((box_x + 12, box_y + 6), "BIOLOGICAL LEDGER · SPECIMEN ARCHIVE № 4875", font=font_ledger_title, fill=(210, 180, 140, 255))

    ledger_rows = [
        ("SPECIES ANALOG", "Pinus longaeva (Great Basin Bristlecone Pine)"),
        ("PROVENANCE", "White Mountains, California · 37.38°N, 118.17°W (3,100 m)"),
        ("CHRONOLOGY HORIZON", "2849 BCE – 2026 CE (4,875 Rings Continuous)"),
        ("BIOPHYSICAL MODEL", "Vaganov-Shashkin VS-Lite · Soil Moisture Balance"),
        ("TRAUMA SIGNATURES", "Catface Fire Scar (Callus Curls) · Pitch Pockets · IADF"),
        ("STANDARDIZATION", "Relative Ring Width Index (RWI: 0.31 Drought – 1.48 Pluvial)")
    ]

    row_y = box_y + 36
    for key, val in ledger_rows:
        draw.text((box_x + 12, row_y), key + ":", font=font_ledger_title, fill=(155, 138, 120, 240))
        draw.text((box_x + 165, row_y), val, font=font_ledger_val, fill=(230, 220, 205, 255))
        row_y += 24

    # Bottom Telemetry Bar
    bottom_y = box_y + box_h + 20
    draw.line([(col_x, bottom_y), (WIDTH - 60, bottom_y)], fill=(65, 54, 44, 180), width=1)
    draw.text((col_x, bottom_y + 12), "EXHIBITION MONOGRAPH · DUAL-MODE PEEL & GROW", font=font_badge, fill=(145, 130, 115, 200))
    draw.text((WIDTH - 215, bottom_y + 12), "HTTPS://XYLEM.ART", font=font_url, fill=(225, 195, 150, 255))

    # Scale bar beside specimen
    draw.line([(60, HEIGHT - 55), (180, HEIGHT - 55)], fill=(180, 160, 135, 220), width=2)
    draw.line([(60, HEIGHT - 60), (60, HEIGHT - 50)], fill=(180, 160, 135, 220), width=1)
    draw.line([(180, HEIGHT - 60), (180, HEIGHT - 50)], fill=(180, 160, 135, 220), width=1)
    draw.text((64, HEIGHT - 76), "SCALE: 100 mm RADIAL EXTENT", font=font_badge, fill=(160, 145, 125, 200))

    # Save PNG
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img.save(output_path, "PNG", optimize=True)
    print(f"Generated {output_path} ({WIDTH}x{HEIGHT}) successfully.")


def create_og_preview_svg(output_path: str):
    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" width="{WIDTH}" height="{HEIGHT}">
  <defs>
    <radialGradient id="ogGlow" cx="32%" cy="50%" r="55%" fx="32%" fy="50%">
      <stop offset="0%" stop-color="#3a2f24" stop-opacity="0.75" />
      <stop offset="60%" stop-color="#1e1814" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#12100e" stop-opacity="1" />
    </radialGradient>
    <filter id="woodGrainFilter">
      <feTurbulence type="fractalNoise" baseFrequency="0.04 0.008" numOctaves="3" result="noise" />
      <feColorMatrix type="matrix" values="0 0 0 0 0.8  0 0 0 0 0.65  0 0 0 0 0.45  0 0 0 0.08 0" result="tint" />
      <feBlend in="SourceGraphic" in2="tint" mode="multiply" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="{WIDTH}" height="{HEIGHT}" fill="#12100e" />
  <rect width="{WIDTH}" height="{HEIGHT}" fill="url(#ogGlow)" />
  <rect x="20" y="20" width="{WIDTH - 40}" height="{HEIGHT - 40}" fill="none" stroke="#382e24" stroke-width="1" />
  <rect x="24" y="24" width="{WIDTH - 48}" height="{HEIGHT - 48}" fill="none" stroke="#2a221b" stroke-width="1" />

  <!-- Radial Specimen Group -->
  <g transform="translate(380, 315)">
    <!-- Bark Rim -->
    <circle r="236" fill="none" stroke="#2c2017" stroke-width="14" stroke-dasharray="18 4 12 6" />
    <circle r="228" fill="#c49b6b" stroke="#382214" stroke-width="2" />
    
    <!-- Outer Sapwood Rings -->
    <circle r="212" fill="#d0ab7a" stroke="#482b1a" stroke-width="1.8" />
    <circle r="196" fill="#cca36e" stroke="#4a2e1d" stroke-width="1.6" />
    <circle r="180" fill="#c59962" stroke="#523320" stroke-width="1.7" />
    <circle r="164" fill="#be9057" stroke="#563622" stroke-width="1.8" />
    <circle r="150" fill="#b6854b" stroke="#5a3824" stroke-width="2.0" />

    <!-- Heartwood Boundary & Transition -->
    <circle r="136" fill="#a8743c" stroke="#542e1a" stroke-width="2.2" />
    <circle r="122" fill="#9e6932" stroke="#4e2815" stroke-width="2.4" />
    <circle r="108" fill="#935e29" stroke="#482211" stroke-width="2.4" />
    <circle r="94"  fill="#895421" stroke="#441e0d" stroke-width="2.5" />
    <circle r="80"  fill="#7e4a1a" stroke="#3e1a0a" stroke-width="2.6" />
    <circle r="66"  fill="#734114" stroke="#381708" stroke-width="2.8" />
    <circle r="52"  fill="#69380f" stroke="#321406" stroke-width="3.0" />
    <circle r="38"  fill="#5f300b" stroke="#2c1105" stroke-width="3.0" />
    <circle r="24"  fill="#522708" stroke="#260e04" stroke-width="3.2" />
    <circle r="12"  fill="#441f06" stroke="#1f0a03" stroke-width="3.2" />
    
    <!-- Pith Offset -->
    <circle cx="-8" cy="7" r="5" fill="#2b1204" stroke="#120501" stroke-width="1" />

    <!-- Fire Scar Notch & Charred Catface -->
    <path d="M 68 -135 Q 110 -155 140 -120 Q 90 -80 68 -135 Z" fill="#140f0c" stroke="#080605" stroke-width="2" />
    <circle cx="68" cy="-135" r="6" fill="#d2a673" stroke="#2a160a" stroke-width="2" />
    <circle cx="140" cy="-120" r="6" fill="#d2a673" stroke="#2a160a" stroke-width="2" />

    <!-- Traumatic Resin Pockets -->
    <ellipse cx="-70" cy="-60" rx="10" ry="3" fill="#e6961e" stroke="#5a2e06" stroke-width="1" transform="rotate(-25 -70 -60)" />
    <ellipse cx="60" cy="90" rx="12" ry="3.5" fill="#e6961e" stroke="#5a2e06" stroke-width="1" transform="rotate(45 60 90)" />
  </g>

  <!-- Typographic Column -->
  <g transform="translate(680, 65)">
    <text x="0" y="0" font-family="'Courier New', monospace" font-size="12" font-weight="600" fill="#b99b73" letter-spacing="1">MUSEUM OF GENERATIVE DENDROCHRONOLOGY · ARCHIVAL MONOGRAPH</text>
    
    <text x="0" y="54" font-family="Georgia, serif" font-size="56" font-weight="bold" fill="#f8f5ee" letter-spacing="2">XYLEM</text>
    <text x="0" y="86" font-family="Georgia, serif" font-size="16" fill="#d4c0a8" letter-spacing="1">AN ECOLOGICAL LEDGER OF DEEP TIME · RETROSPECTIVE DENDROCHRONOLOGY</text>
    
    <line x1="0" y1="108" x2="460" y2="108" stroke="#4b3e32" stroke-width="1" />

    <text x="0" y="134" font-family="Georgia, serif" font-size="14" fill="#b9afa0">A museum-grade generative installation reading planetary ecological</text>
    <text x="0" y="156" font-family="Georgia, serif" font-size="14" fill="#b9afa0">history in reverse through cellular wood anatomy, earlywood/latewood</text>
    <text x="0" y="178" font-family="Georgia, serif" font-size="14" fill="#b9afa0">transitions, decadal megadroughts, and anatomical trauma markers.</text>

    <!-- Ledger Box -->
    <g transform="translate(0, 202)">
      <rect width="460" height="192" fill="#181512" stroke="#3a3026" stroke-width="1" rx="2" />
      <rect width="460" height="26" fill="#221d19" rx="2" />
      <text x="12" y="18" font-family="'Courier New', monospace" font-size="12" font-weight="bold" fill="#d2b48c">BIOLOGICAL LEDGER · SPECIMEN ARCHIVE № 4875</text>
      
      <text x="12" y="52" font-family="'Courier New', monospace" font-size="11" font-weight="bold" fill="#9b8a78">SPECIES ANALOG:</text>
      <text x="160" y="52" font-family="'Courier New', monospace" font-size="11" fill="#e6dccd">Pinus longaeva (Bristlecone Pine)</text>

      <text x="12" y="78" font-family="'Courier New', monospace" font-size="11" font-weight="bold" fill="#9b8a78">PROVENANCE:</text>
      <text x="160" y="78" font-family="'Courier New', monospace" font-size="11" fill="#e6dccd">White Mtns, CA · 37.38°N, 118.17°W (3,100 m)</text>

      <text x="12" y="104" font-family="'Courier New', monospace" font-size="11" font-weight="bold" fill="#9b8a78">CHRONOLOGY:</text>
      <text x="160" y="104" font-family="'Courier New', monospace" font-size="11" fill="#e6dccd">2849 BCE – 2026 CE (4,875 Continuous Rings)</text>

      <text x="12" y="130" font-family="'Courier New', monospace" font-size="11" font-weight="bold" fill="#9b8a78">FORWARD MODEL:</text>
      <text x="160" y="130" font-family="'Courier New', monospace" font-size="11" fill="#e6dccd">Vaganov-Shashkin VS-Lite Biophysical Engine</text>

      <text x="12" y="156" font-family="'Courier New', monospace" font-size="11" font-weight="bold" fill="#9b8a78">TRAUMA MARKERS:</text>
      <text x="160" y="156" font-family="'Courier New', monospace" font-size="11" fill="#e6dccd">Catface Fire Scar · Callus Curls · Resin Pockets</text>

      <text x="12" y="180" font-family="'Courier New', monospace" font-size="11" font-weight="bold" fill="#9b8a78">RWI INDICES:</text>
      <text x="160" y="180" font-family="'Courier New', monospace" font-size="11" fill="#e6dccd">0.31 (Drought Shutdown) – 1.48 (Pluvial Pulse)</text>
    </g>

    <!-- Bottom links -->
    <line x1="0" y1="416" x2="460" y2="416" stroke="#41362c" stroke-width="1" />
    <text x="0" y="438" font-family="'Courier New', monospace" font-size="12" fill="#918273">EXHIBITION MONOGRAPH · DUAL-MODE PEEL &amp; GROW</text>
    <text x="320" y="438" font-family="'Courier New', monospace" font-size="13" font-weight="bold" fill="#e1c396">HTTPS://XYLEM.ART</text>
  </g>
</svg>'''
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"Generated {output_path} ({WIDTH}x{HEIGHT}) successfully.")


if __name__ == "__main__":
    png_path = os.path.join("public", "og-preview.png")
    svg_path = os.path.join("public", "og-preview.svg")
    create_og_preview_png(png_path)
    create_og_preview_svg(svg_path)
