#!/usr/bin/env python3
"""
OAS Comprehensive Technical Dossier & Platform Reference PDF Generator
Generates an executive-grade, multi-page publication PDF with vector graphics,
custom typography layout, tables, callout cards, and running headers/footers.
"""

import os
import sys
import zlib
import math

class PDFBuilder:
    def __init__(self, filename, title="Operating Agent System (OAS) Comprehensive Platform Guide"):
        self.filename = filename
        self.title = title
        # Page size A4: 595.28 x 841.89 points
        self.pw = 595.28
        self.ph = 841.89
        self.margin_left = 48.0
        self.margin_right = 48.0
        self.margin_top = 52.0
        self.margin_bottom = 52.0
        self.content_w = self.pw - self.margin_left - self.margin_right # 499.28 pt
        
        self.pages = []  # list of page drawing stream commands
        self.current_page_ops = []
        self.current_y = self.ph - self.margin_top
        self.page_number = 1
        self.toc_entries = [] # (title, page_num, level)
        
        # Color palette
        self.c_navy = (0.05, 0.09, 0.16)       # #0D172A
        self.c_dark = (0.09, 0.11, 0.15)       # #171C26
        self.c_primary = (0.12, 0.35, 0.85)    # #1E59D9 - Royal Blue
        self.c_primary_light = (0.92, 0.95, 1.0) # #EBF2FF
        self.c_accent = (0.02, 0.65, 0.55)     # #05A68C - Teal
        self.c_text_main = (0.12, 0.15, 0.20)  # #1E2633 - Charcoal
        self.c_text_muted = (0.40, 0.45, 0.53) # #667387 - Slate
        self.c_border = (0.85, 0.88, 0.92)     # #D9E0EB
        self.c_card_bg = (0.97, 0.98, 0.99)    # #F8FAFC
        self.c_code_bg = (0.94, 0.95, 0.97)    # #F0F2F7
        self.c_callout_bg = (0.95, 0.97, 1.0)  # #F2F7FF
        self.c_callout_border = (0.20, 0.45, 0.90)
        self.c_warning_bg = (1.0, 0.97, 0.92)  # #FFF7EB
        self.c_warning_border = (0.85, 0.50, 0.10)
        self.c_success_bg = (0.93, 0.98, 0.95)  # #EDFAF2
        self.c_success_border = (0.10, 0.65, 0.35)

    def _escape_text(self, text):
        return text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

    def new_page(self):
        if self.current_page_ops:
            self.pages.append(self.current_page_ops)
            self.page_number += 1
        self.current_page_ops = []
        self.current_y = self.ph - self.margin_top

    def start_page(self):
        self.new_page()

    def end_page(self):
        self.new_page()

    def ensure_space(self, needed_h):
        if self.current_y - needed_h < self.margin_bottom + 20:
            self.new_page()

    def set_color_fill(self, rgb):
        r, g, b = rgb
        self.current_page_ops.append(f"{r:.3f} {g:.3f} {b:.3f} rg")

    def set_color_stroke(self, rgb):
        r, g, b = rgb
        self.current_page_ops.append(f"{r:.3f} {g:.3f} {b:.3f} RG")

    def draw_rect(self, x, y, w, h, fill_rgb=None, stroke_rgb=None, line_width=1.0):
        ops = []
        if fill_rgb:
            r, g, b = fill_rgb
            ops.append(f"{r:.3f} {g:.3f} {b:.3f} rg")
        if stroke_rgb:
            r, g, b = stroke_rgb
            ops.append(f"{r:.3f} {g:.3f} {b:.3f} RG")
            ops.append(f"{line_width:.2f} w")
        ops.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re")
        if fill_rgb and stroke_rgb:
            ops.append("B")
        elif fill_rgb:
            ops.append("f")
        elif stroke_rgb:
            ops.append("S")
        self.current_page_ops.append(" ".join(ops))

    def draw_line(self, x1, y1, x2, y2, stroke_rgb, line_width=1.0):
        r, g, b = stroke_rgb
        op = f"{r:.3f} {g:.3f} {b:.3f} RG {line_width:.2f} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S"
        self.current_page_ops.append(op)

    def draw_text(self, x, y, text, font="F1", size=10, rgb=(0.1, 0.1, 0.1)):
        r, g, b = rgb
        esc = self._escape_text(text)
        op = f"BT {r:.3f} {g:.3f} {b:.3f} rg /{font} {size:.2f} Tf {x:.2f} {y:.2f} Td ({esc}) Tj ET"
        self.current_page_ops.append(op)

    def char_width(self, char, font="F1", size=10):
        # Approximate proportional font metrics
        if font == "F3" or font == "F4": # Courier / Courier-Bold monospace
            return size * 0.60
        is_bold = (font == "F2")
        if char in "ijl|:,.'! ":
            return size * (0.30 if not is_bold else 0.35)
        elif char in "mwMW@":
            return size * (0.85 if not is_bold else 0.90)
        elif char.isupper():
            return size * (0.65 if not is_bold else 0.72)
        else:
            return size * (0.50 if not is_bold else 0.55)

    def text_width(self, text, font="F1", size=10):
        return sum(self.char_width(c, font, size) for c in text)

    def wrap_text(self, text, max_w, font="F1", size=10):
        words = text.split(' ')
        lines = []
        cur_line = []
        cur_w = 0.0
        space_w = self.char_width(' ', font, size)

        for w in words:
            word_w = self.text_width(w, font, size)
            if cur_w + word_w + (space_w if cur_line else 0) <= max_w:
                cur_line.append(w)
                cur_w += word_w + (space_w if len(cur_line) > 1 else 0)
            else:
                if cur_line:
                    lines.append(" ".join(cur_line))
                cur_line = [w]
                cur_w = word_w
        if cur_line:
            lines.append(" ".join(cur_line))
        return lines or [""]

    # High-level layout components
    def add_h1(self, title, add_to_toc=True):
        self.ensure_space(55)
        self.current_y -= 18
        if add_to_toc:
            self.toc_entries.append((title, self.page_number, 1))
        # Draw section accent badge/line
        self.draw_rect(self.margin_left, self.current_y - 2, 4, 20, fill_rgb=self.c_primary)
        self.draw_text(self.margin_left + 12, self.current_y, title, font="F2", size=17, rgb=self.c_navy)
        self.current_y -= 26

    def add_h2(self, title, add_to_toc=False):
        self.ensure_space(42)
        self.current_y -= 12
        if add_to_toc:
            self.toc_entries.append((title, self.page_number, 2))
        self.draw_text(self.margin_left, self.current_y, title, font="F2", size=13, rgb=self.c_primary)
        self.draw_line(self.margin_left, self.current_y - 4, self.margin_left + self.content_w, self.current_y - 4, stroke_rgb=self.c_border, line_width=0.75)
        self.current_y -= 18

    def add_h3(self, title):
        self.ensure_space(30)
        self.current_y -= 8
        self.draw_text(self.margin_left, self.current_y, title, font="F2", size=11, rgb=self.c_dark)
        self.current_y -= 14

    def add_p(self, text, size=9.5, rgb=None, line_spacing=13.5):
        rgb = rgb or self.c_text_main
        lines = self.wrap_text(text, self.content_w, font="F1", size=size)
        for line in lines:
            self.ensure_space(line_spacing)
            self.draw_text(self.margin_left, self.current_y, line, font="F1", size=size, rgb=rgb)
            self.current_y -= line_spacing
        self.current_y -= 4

    def add_bullet(self, title, text, size=9.0):
        t_w = self.text_width(title + " ", font="F2", size=size)
        bullet_sym = "•"
        avail_w = self.content_w - 20
        full_text = text
        lines = self.wrap_text(full_text, avail_w - t_w, font="F1", size=size)
        
        self.ensure_space(15 + len(lines) * 12)
        self.draw_text(self.margin_left + 4, self.current_y, bullet_sym, font="F2", size=size, rgb=self.c_primary)
        self.draw_text(self.margin_left + 16, self.current_y, title + ":", font="F2", size=size, rgb=self.c_navy)
        
        if lines:
            first_line = lines[0]
            self.draw_text(self.margin_left + 16 + t_w, self.current_y, first_line, font="F1", size=size, rgb=self.c_text_main)
            self.current_y -= 12.5
            
            for line in lines[1:]:
                self.ensure_space(12.5)
                self.draw_text(self.margin_left + 16, self.current_y, line, font="F1", size=size, rgb=self.c_text_main)
                self.current_y -= 12.5
        else:
            self.current_y -= 13
        self.current_y -= 2

    def add_callout(self, title, text, kind="info"):
        bg = self.c_callout_bg
        border = self.c_callout_border
        icon = "NOTE"
        if kind == "warning":
            bg = self.c_warning_bg
            border = self.c_warning_border
            icon = "CRITICAL SECURITY DIRECTIVE"
        elif kind == "success":
            bg = self.c_success_bg
            border = self.c_success_border
            icon = "KEY PLATFORM CAPABILITY"
        
        lines = self.wrap_text(text, self.content_w - 24, font="F1", size=8.5)
        box_h = 24 + len(lines) * 11.5
        self.ensure_space(box_h + 10)
        
        box_y = self.current_y - box_h + 10
        # Card background
        self.draw_rect(self.margin_left, box_y, self.content_w, box_h, fill_rgb=bg, stroke_rgb=self.c_border, line_width=0.75)
        # Left accent stripe
        self.draw_rect(self.margin_left, box_y, 4, box_h, fill_rgb=border)
        # Title
        self.draw_text(self.margin_left + 14, self.current_y - 2, f"{icon}: {title}", font="F2", size=9, rgb=border)
        # Text
        ty = self.current_y - 15
        for l in lines:
            self.draw_text(self.margin_left + 14, ty, l, font="F1", size=8.5, rgb=self.c_text_main)
            ty -= 11.5
        self.current_y = box_y - 10

    def add_code_block(self, code_lines):
        box_h = 16 + len(code_lines) * 11.5
        self.ensure_space(box_h + 8)
        box_y = self.current_y - box_h + 8
        self.draw_rect(self.margin_left, box_y, self.content_w, box_h, fill_rgb=self.c_code_bg, stroke_rgb=self.c_border, line_width=0.75)
        
        ty = self.current_y - 4
        for line in code_lines:
            self.draw_text(self.margin_left + 10, ty, line, font="F3", size=8, rgb=(0.15, 0.2, 0.28))
            ty -= 11.5
        self.current_y = box_y - 8

    def add_table(self, headers, rows, col_widths=None):
        num_cols = len(headers)
        if not col_widths:
            col_widths = [self.content_w / num_cols] * num_cols
        
        # Calculate row heights
        row_heights = []
        wrapped_rows = []
        for row in rows:
            max_lines = 1
            wrapped_cells = []
            for idx, cell in enumerate(row):
                w = col_widths[idx] - 10
                cell_lines = self.wrap_text(str(cell), w, font="F1", size=8.0)
                wrapped_cells.append(cell_lines)
                if len(cell_lines) > max_lines:
                    max_lines = len(cell_lines)
            row_heights.append(max(18, 8 + max_lines * 10))
            wrapped_rows.append(wrapped_cells)

        header_h = 22
        self.ensure_space(header_h + row_heights[0] + 10)

        # Draw Header
        h_y = self.current_y - header_h + 6
        self.draw_rect(self.margin_left, h_y, self.content_w, header_h, fill_rgb=self.c_navy)
        
        cx = self.margin_left
        for idx, h in enumerate(headers):
            self.draw_text(cx + 6, h_y + 7, h, font="F2", size=8.5, rgb=(1.0, 1.0, 1.0))
            cx += col_widths[idx]
        self.current_y = h_y

        # Draw Rows
        for r_idx, (r_cells, r_h) in enumerate(zip(wrapped_rows, row_heights)):
            self.ensure_space(r_h)
            row_y = self.current_y - r_h
            bg = (1.0, 1.0, 1.0) if r_idx % 2 == 0 else self.c_card_bg
            self.draw_rect(self.margin_left, row_y, self.content_w, r_h, fill_rgb=bg, stroke_rgb=self.c_border, line_width=0.5)

            cx = self.margin_left
            for c_idx, cell_lines in enumerate(r_cells):
                cell_y = row_y + r_h - 11
                is_first_col = (c_idx == 0)
                font_name = "F2" if is_first_col else "F1"
                text_color = self.c_navy if is_first_col else self.c_text_main
                for line in cell_lines:
                    self.draw_text(cx + 6, cell_y, line, font=font_name, size=8.0, rgb=text_color)
                    cell_y -= 9.5
                cx += col_widths[c_idx]
            self.current_y = row_y
        self.current_y -= 10

    def draw_cover_page(self):
        self.start_page()
        
        # Hero Top Dark Banner
        banner_h = 260
        self.draw_rect(0, self.ph - banner_h, self.pw, banner_h, fill_rgb=self.c_navy)
        
        # Decorative vector accent bars
        self.draw_rect(self.margin_left, self.ph - 48, 60, 4, fill_rgb=self.c_accent)
        
        # Super badge
        self.draw_rect(self.margin_left, self.ph - 85, 230, 20, fill_rgb=(0.12, 0.20, 0.35))
        self.draw_text(self.margin_left + 8, self.ph - 78, "OAS ENTERPRISE ARCHITECTURE DOSSIER", font="F2", size=8.5, rgb=self.c_accent)
        
        # Document Title
        self.draw_text(self.margin_left, self.ph - 128, "OPERATING AGENT SYSTEM", font="F2", size=26, rgb=(1.0, 1.0, 1.0))
        self.draw_text(self.margin_left, self.ph - 156, "Universal Agent Operating System & Control Plane", font="F2", size=15, rgb=(0.70, 0.82, 1.0))
        
        # Subtitle / Tagline
        subtitle_p1 = "Comprehensive Technical Blueprint, Architectural Reference, Capabilities Catalog,"
        subtitle_p2 = "and Enterprise Strategy for Autonomous Multi-Agent Software Engineering."
        self.draw_text(self.margin_left, self.ph - 188, subtitle_p1, font="F1", size=10, rgb=(0.80, 0.85, 0.95))
        self.draw_text(self.margin_left, self.ph - 202, subtitle_p2, font="F1", size=10, rgb=(0.80, 0.85, 0.95))
        
        # Metadata Pill Box
        meta_y = self.ph - 246
        self.draw_line(self.margin_left, meta_y + 16, self.pw - self.margin_right, meta_y + 16, stroke_rgb=(0.20, 0.28, 0.42), line_width=0.75)
        self.draw_text(self.margin_left, meta_y, "Version: 2.2.1", font="F2", size=8.5, rgb=(0.9, 0.9, 0.9))
        self.draw_text(self.margin_left + 110, meta_y, "Author: Nihir Patel", font="F1", size=8.5, rgb=(0.8, 0.8, 0.8))
        self.draw_text(self.margin_left + 230, meta_y, "License: MIT Forever", font="F1", size=8.5, rgb=(0.8, 0.8, 0.8))
        self.draw_text(self.margin_left + 350, meta_y, "Classification: Technical Whitepaper", font="F1", size=8.5, rgb=(0.8, 0.8, 0.8))
        
        # 4 Key Metrics Cards in a 2x2 Grid
        self.current_y = self.ph - banner_h - 24
        
        cards = [
            ("69 Specialized Agents", "Autonomous subagents for architecture, TDD, code review, build repair, security, and ML pipelines."),
            ("286 Production Skills", "Modular, battle-tested engineering workflows with YAML metadata across all languages and frameworks."),
            ("12 Supported Harnesses", "Cross-platform runtime parity: Claude Code, Codex, Cursor, Gemini, OpenCode, Zed, Kimi, etc."),
            ("40,000+ Stars & Trending #1", "Ecosystem standard for AI agent harnesses, memory vault, and enterprise control-plane orchestration.")
        ]
        
        card_w = (self.content_w - 14) / 2
        card_h = 58
        
        for i, (head, desc) in enumerate(cards):
            row = i // 2
            col = i % 2
            cx = self.margin_left + col * (card_w + 14)
            cy = self.current_y - (row * (card_h + 12)) - card_h
            
            self.draw_rect(cx, cy, card_w, card_h, fill_rgb=self.c_card_bg, stroke_rgb=self.c_border, line_width=0.75)
            self.draw_rect(cx, cy, 3.5, card_h, fill_rgb=self.c_primary)
            self.draw_text(cx + 10, cy + card_h - 16, head, font="F2", size=10, rgb=self.c_navy)
            
            lines = self.wrap_text(desc, card_w - 16, font="F1", size=8.0)
            ty = cy + card_h - 28
            for l in lines:
                self.draw_text(cx + 10, ty, l, font="F1", size=8.0, rgb=self.c_text_muted)
                ty -= 9.5

        self.current_y -= (2 * (card_h + 12) + 12)
        
        # Executive Core Principle Callout
        self.add_callout(
            "THE OAS PLATFORM AXIOM",
            '"Optimize the context window. Persist everything else." OAS elevates AI coding from brittle, conversational "vibe coding" into a deterministic, test-driven, self-healing software engineering discipline. It orchestrates multi-agent swarms with mathematical guarantees against context collapse, supply-chain poisoning, and concurrent code regressions.',
            kind="success"
        )
        
        # Table of Contents Preview Box
        self.current_y -= 8
        self.draw_rect(self.margin_left, self.current_y - 120, self.content_w, 120, fill_rgb=(0.99, 0.99, 1.0), stroke_rgb=self.c_border, line_width=0.75)
        self.draw_text(self.margin_left + 14, self.current_y - 18, "DOCUMENT CONTENTS & EXECUTIVE OUTLINE", font="F2", size=9.5, rgb=self.c_navy)
        self.draw_line(self.margin_left + 14, self.current_y - 24, self.margin_left + self.content_w - 14, self.current_y - 24, stroke_rgb=self.c_border, line_width=0.5)
        
        toc_cols = [
            [
                "1. Executive Summary & Philosophy",
                "2. Mission, Vision & Industry Need",
                "3. The 6 Critical Problems OAS Solves",
                "4. 3-Layer Operating Architecture"
            ],
            [
                "5. 69 Autonomous Agents Taxonomy",
                "6. 286 Workflow Skills Ecosystem",
                "7. OAS Memory Vault & Unified Context",
                "8. TCAS Airspace Collision Deconfliction"
            ],
            [
                "9. AgentShield Supply Chain Security",
                "10. OAS Studio & Cloud Control Plane",
                "11. User Benefits & Enterprise Impact",
                "12. 12-Harness Support & Roadmap"
            ]
        ]
        
        col_w = (self.content_w - 28) / 3
        for c_idx, items in enumerate(toc_cols):
            x = self.margin_left + 14 + c_idx * col_w
            y = self.current_y - 38
            for itm in items:
                self.draw_text(x, y, itm, font="F1", size=8.0, rgb=self.c_text_main)
                y -= 18

        self.end_page()

    def render_running_headers_and_footers(self, total_pages):
        """Pass over all pages (except cover) to stamp running headers, footers, and page numbers."""
        for p_idx in range(1, total_pages):
            ops = self.pages[p_idx]
            page_num = p_idx + 1
            
            # Running Header
            h_ops = []
            h_ops.append(f"{self.c_text_muted[0]:.3f} {self.c_text_muted[1]:.3f} {self.c_text_muted[2]:.3f} rg")
            esc_title = self._escape_text("OPERATING AGENT SYSTEM (OAS)  |  TECHNICAL PLATFORM DOSSIER")
            h_ops.append(f"BT /F2 7.5 Tf {self.margin_left:.2f} {self.ph - 32:.2f} Td ({esc_title}) Tj ET")
            esc_version = self._escape_text("RELEASE v2.2.1")
            v_w = self.text_width("RELEASE v2.2.1", font="F2", size=7.5)
            h_ops.append(f"BT /F2 7.5 Tf {self.pw - self.margin_right - v_w:.2f} {self.ph - 32:.2f} Td ({esc_version}) Tj ET")
            
            # Header rule
            r, g, b = self.c_border
            h_ops.append(f"{r:.3f} {g:.3f} {b:.3f} RG 0.5 w {self.margin_left:.2f} {self.ph - 36:.2f} m {self.pw - self.margin_right:.2f} {self.ph - 36:.2f} l S")
            
            # Running Footer rule
            h_ops.append(f"{r:.3f} {g:.3f} {b:.3f} RG 0.5 w {self.margin_left:.2f} 36.00 m {self.pw - self.margin_right:.2f} 36.00 l S")
            
            # Running Footer Text
            esc_footer = self._escape_text("Confidential & Proprietary  •  Operating Agent Systems Open Specification  •  oas.tools")
            h_ops.append(f"BT /F1 7.5 Tf {self.margin_left:.2f} 25.00 Td ({esc_footer}) Tj ET")
            
            # Page Number: Page X of Y
            page_str = f"Page {page_num} of {total_pages}"
            p_w = self.text_width(page_str, font="F2", size=7.5)
            h_ops.append(f"BT /F2 7.5 Tf {self.pw - self.margin_right - p_w:.2f} 25.00 Td ({self._escape_text(page_str)}) Tj ET")
            
            # Prepend header and append footer
            self.pages[p_idx] = h_ops + ops

    def compile_pdf(self):
        if self.current_page_ops:
            self.pages.append(self.current_page_ops)
            self.page_number += 1
            self.current_page_ops = []
        total_pages = len(self.pages)
        self.render_running_headers_and_footers(total_pages)
        
        objects = []
        def add_obj(content):
            objects.append(content)
            return len(objects)

        # Catalog
        cat_id = add_obj("<< /Type /Catalog /Pages 2 0 R >>") # 1
        
        # Pages object placeholder (2)
        pages_id = add_obj("") # will update
        
        # Standard Fonts
        # 3: Helvetica
        font1_id = add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
        # 4: Helvetica-Bold
        font2_id = add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
        # 5: Courier
        font3_id = add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")
        # 6: Courier-Bold
        font4_id = add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>")

        page_ids = []
        content_ids = []

        # Build each page object and content stream
        for p_idx, ops in enumerate(self.pages):
            stream_data = "\n".join(ops).encode("latin1", "replace")
            compressed = zlib.compress(stream_data)
            
            # Stream object
            stream_obj = f"<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n".encode("latin1") + compressed + b"\nendstream"
            stream_id = add_obj(stream_obj)
            content_ids.append(stream_id)

            # Page object
            page_obj = (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.pw:.2f} {self.ph:.2f}] "
                f"/Contents {stream_id} 0 R "
                f"/Resources << /Font << /F1 {font1_id} 0 R /F2 {font2_id} 0 R /F3 {font3_id} 0 R /F4 {font4_id} 0 R >> >> >>"
            )
            p_id = add_obj(page_obj)
            page_ids.append(p_id)

        # Update Pages object (id 2)
        kids_str = " ".join([f"{pid} 0 R" for pid in page_ids])
        objects[pages_id - 1] = f"<< /Type /Pages /Kids [{kids_str}] /Count {len(page_ids)} >>"

        # Write PDF binary
        offsets = []
        pdf_bytes = [b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"]
        curr_offset = len(pdf_bytes[0])

        for i, obj in enumerate(objects, 1):
            offsets.append(curr_offset)
            if isinstance(obj, str):
                entry = f"{i} 0 obj\n{obj}\nendobj\n".encode("latin1")
            else:
                entry = f"{i} 0 obj\n".encode("latin1") + obj + b"\nendobj\n"
            pdf_bytes.append(entry)
            curr_offset += len(entry)

        xref_offset = curr_offset
        xref = [f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"]
        for off in offsets:
            xref.append(f"{off:010d} 00000 n \n")
        trailer = (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R "
            f"/Info << /Title ({self._escape_text(self.title)}) /Author (Nihir Patel) /Creator (OAS Engine v2.2.1) >> >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        )
        
        with open(self.filename, "wb") as f:
            for chunk in pdf_bytes:
                f.write(chunk)
            f.write("".join(xref).encode("latin1"))
            f.write(trailer.encode("latin1"))

        print(f"Successfully generated {self.filename} ({total_pages} pages, {curr_offset} bytes)")


def generate_dossier():
    output_path = "/Users/nihirpatel/Documents/Workspace/Operating Agent System/Operating_Agent_System_Comprehensive_Guide.pdf"
    doc = PDFBuilder(output_path, "Operating Agent System (OAS) - Comprehensive Platform Dossier")
    
    # -------------------------------------------------------------------------
    # COVER PAGE
    # -------------------------------------------------------------------------
    doc.draw_cover_page()

    # -------------------------------------------------------------------------
    # SECTION 1: EXECUTIVE SUMMARY & SYSTEM OVERVIEW
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("1. Executive Summary & System Overview")
    doc.add_p(
        "The Operating Agent System (OAS) is a production-grade, harness-native agent operating system designed "
        "to bring engineering rigor, determinism, and enterprise security to AI-assisted software development. "
        "Unlike basic autocomplete plugins, superficial prompt wrappers, or monolithic proprietary IDEs, OAS provides a "
        "universal meta-harness layer that unifies specialized agent orchestration, workflow skills, deterministic lifecycle hooks, "
        "durable cross-session memory, and real-time execution control."
    )
    doc.add_p(
        "Currently deployed at version 2.2.1, OAS has emerged as one of the most widely adopted open-source agent frameworks in the world, "
        "holding the #1 global trending position on GitHub with over 40,000 stars and multi-thousand weekly downloads across npm. "
        "It acts as a force multiplier for software teams by converting raw Foundation Models (Claude 3.7 Sonnet, GPT-4o, Gemini 2.5, "
        "DeepSeek-R1, and open-source models) into disciplined software engineering teams."
    )
    
    doc.add_h2("The Core OAS Philosophy")
    doc.add_p(
        "OAS was founded on five non-negotiable engineering principles designed to prevent the common failure modes of autonomous coding agents:"
    )
    doc.add_bullet("1. Agent-First Specialization", "Never force a single prompt to do everything. Complex tasks are decomposed and routed to domain-specific agents (planners, architects, TDD guides, language reviewers, build resolvers, security auditors).")
    doc.add_bullet("2. Test-Driven Development (TDD)", "Mandatory 80%+ test coverage. Every feature and bugfix must strictly follow the Red-Green-Refactor loop. Code without tests is rejected at the gate.")
    doc.add_bullet("3. Security-First & Zero Trust", "All user input is treated as untrusted. Hardcoded secrets, unvalidated SQL/HTML, prompt injection vectors, and untrusted dependencies are actively intercepted and blocked by AgentShield.")
    doc.add_bullet("4. Immutability & Pure State", "Code and state modifications must create new objects and return copies with changes applied rather than mutating shared memory or global state, preventing catastrophic concurrency bugs.")
    doc.add_bullet("5. Plan Before Execute", "No destructive edits without an approved plan. The agent decomposes goals into verified milestones, reviews them with human operators via Plan Canvas, and executes sequentially.")

    doc.add_callout(
        "THE DICHOTOMY",
        "Raw AI models are probabilistic autocomplete engines. Software engineering is a deterministic discipline where a single misplaced token breaks production. OAS bridges this chasm by constraining probabilistic intelligence with deterministic operating system primitives.",
        kind="info"
    )

    # -------------------------------------------------------------------------
    # SECTION 2: MISSION AND VISION
    # -------------------------------------------------------------------------
    doc.add_h1("2. Mission and Vision")
    doc.add_p(
        "The software industry is experiencing an unprecedented transition: developers are moving from manual coding to supervising autonomous AI agents. "
        "However, this transition has exposed deep structural flaws in existing tooling. Current AI tools operate in disconnected silos, "
        "suffer from severe amnesia between chat sessions, degrade rapidly as context grows, and introduce massive supply-chain security risks."
    )
    
    doc.add_h2("The OAS Mission")
    doc.add_p(
        "To build the universal, open-standard operating system for AI software engineering—giving every developer, engineering team, "
        "and enterprise an immutable, test-driven, and secure runtime that works seamlessly across any AI coding harness, model, or IDE."
    )

    doc.add_h2("The OAS Vision")
    doc.add_p(
        "OAS envisions a future where software development is transformed from manual token-by-token typing into multi-agent collaborative engineering. "
        "In this future:"
    )
    doc.add_bullet("Autonomous Engineering Swarms", "Specialized agents work asynchronously across isolated git worktrees, implementing features, writing regression tests, reviewing diffs, and fixing build errors in parallel.")
    doc.add_bullet("Durable Organizational Memory", "Every architectural decision, bug diagnosis, and domain learning is automatically captured into a shared, inspectable memory vault that follows developers across sessions and platforms.")
    doc.add_bullet("Harness Freedom & Anti-Lock-in", "Engineers are never locked into a single proprietary subscription. The same skills, rules, memory, and agents execute with identical behavior whether running in Claude Code, Codex, Cursor, Gemini, OpenCode, or Zed.")
    doc.add_bullet("Provable Software Correctness", "Code generation is governed by automated mathematical verification, formal evaluation harnesses, and continuous supply-chain auditing, ensuring that software built with AI meets or exceeds human safety standards.")

    # -------------------------------------------------------------------------
    # SECTION 3: THE 6 CRITICAL PROBLEMS OAS SOLVES
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("3. What Problems Is OAS Solving?")
    doc.add_p(
        "Modern AI development tools suffer from six systemic problems that prevent them from scaling beyond toy demos into mission-critical production systems. "
        "OAS was architected from the ground up to solve each of these failure modes:"
    )

    problems = [
        ("Problem 1: The 'Vibe Coding' Trap & Brownfield Collapse",
         "The vast majority of AI coding tools encourage 'vibe coding'—generating hundreds of lines of code based on vibes and conversational prompts without tests or architectural planning. In greenfield projects this feels fast, but in brownfield production codebases it invariably causes silent regressions, broken contracts, and cascading technical debt. OAS enforces the Red-Green-Refactor TDD cycle and architectural planning before a single line of production code is touched."),
        
        ("Problem 2: The Context Cliff & Cognitive Degradation",
         "Large Language Models exhibit severe cognitive degradation as conversation transcripts swell past 80,000–120,000 tokens (known as the 'Context Cliff'). Models begin hallucinating nonexistent functions, forgetting earlier instructions, and repeating mistakes. OAS features the Strategic Context Compactor, which monitors token budgets in real time and compacts transient logs while persisting critical architectural facts to disk."),
        
        ("Problem 3: Harness Fragmentation & Vendor Lock-in",
         "Engineering teams are fragmented across tools: frontend engineers use Cursor, backend teams use Codex or OpenCode, terminal power-users use Claude Code, and cloud engineers use Gemini. Previously, each tool required separate prompts, custom rules, and proprietary configuration. OAS acts as a Universal Meta-Harness: write a skill or rule once, and it automatically works across all 12 supported harnesses."),
        
        ("Problem 4: Cross-Session Amnesia & Fragmented State",
         "Every time an AI chat session ends, its accumulated knowledge is wiped out. If an agent spent two hours understanding a subtle concurrency bug in your authentication service, the next agent tomorrow starts from zero. OAS features the OAS Memory Vault (backed by SQLite and standardized Markdown frontmatter), enabling agents to save lessons, architectural decisions, and handoff state across sessions and different harnesses."),
        
        ("Problem 5: Supply Chain Attacks & Weaponized Agent Tools",
         "In early 2026, research disclosures (CVE-2025-59536, CVE-2026-21852, and Snyk's ToxicSkills study) revealed that 36% of public agent skills contained prompt injection or malicious execution payloads. Malicious git repositories could execute code or exfiltrate API keys before users even confirmed trust dialogs. OAS integrates AgentShield, which actively scans hooks, prompts, MCP configs, and dependencies for supply-chain indicators of compromise (IOCs)."),
        
        ("Problem 6: Runaway Autonomous Loop Stalls & Token Burn",
         "When agents are run in autonomous loops (e.g., Ralphinho RFC pipelines or overnight batch tasks), they frequently get trapped in infinite retry loops, repeating the same broken command and burning hundreds of dollars in API credits. OAS includes the Loop Operator agent, TCAS Airspace deconfliction, and stale loop monitors that detect repetitive error states and trigger human-in-the-loop intervention.")
    ]

    for title, desc in problems:
        doc.add_h3(title)
        doc.add_p(desc, size=8.5, line_spacing=11.5)

    # -------------------------------------------------------------------------
    # SECTION 4: HOW THE PLATFORM WORKS - THE 3-TIER ARCHITECTURE
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("4. How the Platform Works: The 3-Tier Operating Architecture")
    doc.add_p(
        "OAS operates as a full-stack agent operating system structured into three distinct, highly coordinated layers. "
        "This modular design allows organizations to run OAS as a complete end-to-end platform or selectively adopt the layers that fit their existing toolchain:"
    )

    doc.add_h2("The 3-Layer System Model")

    layers = [
        ("Layer 1: Meta-Harness & Skill Ecosystem",
         "The foundational layer containing 69 specialized agents, 286 workflow skills, 94 command entrypoints, deterministic lifecycle hooks, and language-specific rules. It provides universal manifest resolution, allowing any supported harness (Claude Code, Codex, Cursor, Gemini, etc.) to discover and execute standardized OAS assets."),
        
        ("Layer 2: Dedicated OAS Agent Runtime Engine",
         "The local orchestration and execution engine implemented in Node.js and TypeScript (`packages/engine`, `packages/db`, `packages/parser`). It includes the AgentDagScheduler for multi-agent DAG pipelines, the ExecutionSandbox for isolated terminal execution, the StrategicCompactor for token budgeting, the UniversalModelGateway for multi-model routing, and the WorktreeRunner for git isolation."),
        
        ("Layer 3: Enterprise Control Plane & Agentic IDE",
         "The visual operator surface and real-time streaming control plane (`apps/web` and `apps/api`). It features a browser-based Studio UI with live DAG visualization, real-time Server-Sent Events (SSE) telemetry, interactive Knowledge Graph navigation, Plan Canvas Pro for collaborative plan review, and multi-session management.")
    ]

    for l_title, l_desc in layers:
        doc.add_bullet(l_title, l_desc, size=8.5)

    doc.add_h2("Detailed Engine Subsystems (`packages/engine`)")
    
    subsystems_table = [
        ("Subsystem", "Component File", "Core Responsibility & Mechanism"),
        ("DAG Scheduler", "scheduler.js", "Constructs dependency execution graphs for multi-agent workflows with event-driven pause, resume, and abort controls."),
        ("Execution Sandbox", "sandbox.js", "Enforces path-confined file access and command execution, preventing runaway scripts from escaping the project root."),
        ("Strategic Compactor", "compactor.js", "Monitors token consumption against model budget thresholds (e.g. 200k tokens), triggering structured summaries."),
        ("Model Gateway", "llm-gateway.js", "Universal abstraction layer routing requests across Anthropic, OpenAI, Gemini, and open-source models with failover."),
        ("Worktree Runner", "worktree-runner.js", "Provisions isolated Git worktrees for concurrent agent branches, eliminating workspace file collisions."),
        ("Command Runner", "command-runner.js", "Executes 94 slash commands and pipelines, bridging human intent to agent task execution."),
        ("Parser & Sync", "parser.js", "Indexes all agents, skills, hooks, and MCP servers into an in-memory knowledge graph and SQLite database."),
        ("Memory Store", "packages/db", "Local SQLite database (`.oas-store.json`) tracking sessions, telemetry, agent step events, and operator interventions.")
    ]
    doc.add_table(
        ["Subsystem", "Component", "Responsibility & Mechanism"],
        subsystems_table[1:],
        col_widths=[110, 105, 284]
    )

    doc.add_callout(
        "ARCHITECTURAL PRINCIPLE: ZERO CLOUD LOCK-IN",
        "The entire OAS runtime engine executes 100% locally on the developer's machine or self-hosted server. Telemetry and state are stored in a local SQLite file. No private code, customer prompts, or API keys are ever transmitted to third-party servers without explicit user configuration.",
        kind="success"
    )

    # -------------------------------------------------------------------------
    # SECTION 5: THE 69 SPECIALIZED AGENTS
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("5. The Complete Capabilities Catalog: 69 Specialized Agents")
    doc.add_p(
        "A foundational insight of OAS is that general-purpose prompts fail at specialized tasks. A prompt optimized for high-level software architecture "
        "makes poor decisions during low-level memory debugging, and a prompt tuned for aggressive code generation frequently overlooks subtle security flaws. "
        "OAS solves this by providing 69 specialized agents, each configured with domain-specific system instructions, tool restrictions, and validation rubrics."
    )

    doc.add_h2("Agent Taxonomy & Core Directory")

    agents_data = [
        ("Agent ID", "Domain & Specialization", "Primary Purpose & Activation Criteria"),
        ("planner", "Planning & Strategy", "Implementation planning, breaking complex features into phases, risk analysis."),
        ("architect", "System Architecture", "System design, scalability, service decomposition, and architectural decisions."),
        ("tdd-guide", "Test-Driven Development", "Enforcing Red-Green-Refactor cycles, writing unit/integration tests before code."),
        ("code-reviewer", "General Code Review", "Post-implementation quality review, maintainability, and standard compliance."),
        ("security-reviewer", "Vulnerability & Security", "Auditing authentication, secrets, OWASP top 10, and injection vulnerabilities."),
        ("spec-miner", "Brownfield Onboarding", "Extracting specifications and data contracts from legacy brownfield codebases."),
        ("build-error-resolver", "Universal Build Fixer", "Diagnosing and fixing compilation, bundling, and TypeScript type errors."),
        ("e2e-runner", "End-to-End Testing", "Generating, maintaining, and running Playwright browser automation tests."),
        ("refactor-cleaner", "Code Maintenance", "Eliminating dead code, unused exports, duplicate abstractions, and tech debt."),
        ("doc-updater", "Documentation & Maps", "Synchronizing READMEs, API codemaps, and Architecture Decision Records (ADRs)."),
        ("typescript-reviewer", "TypeScript / JavaScript", "Specialist review for TS 5.x, React, Node, Next.js, and strict type safety."),
        ("python-reviewer", "Python & Ecosystem", "Code quality, PEP 8, async patterns, and library idioms for Python services."),
        ("go-reviewer", "Go Systems", "Go concurrency patterns (goroutines, channels), interfaces, and error handling."),
        ("go-build-resolver", "Go Build Repair", "Resolving Go compilation, module dependency, and linking failures."),
        ("rust-reviewer", "Rust & Memory Safety", "Reviewing ownership, borrowing, lifetime annotations, and unsafe code boundaries."),
        ("rust-build-resolver", "Rust Compiler Errors", "Interpreting rustc borrow-checker errors and resolving cargo build breaks."),
        ("cpp-reviewer", "C / C++ Systems", "Modern C++20/23, RAII, pointer safety, undefined behavior, and memory leaks."),
        ("cpp-build-resolver", "C/C++ Build Systems", "CMake, Make, Clang/GCC compiler error resolution, and linking errors."),
        ("java-reviewer", "Java & Spring Boot", "Enterprise Java patterns, Spring Boot configuration, DI, and Hibernate/JPA."),
        ("java-build-resolver", "Java Build Tooling", "Maven and Gradle build resolution, dependency conflicts, and JVM tuning."),
        ("kotlin-reviewer", "Kotlin & Mobile", "Kotlin Coroutines, Flows, Android Jetpack Compose, and KMP architecture."),
        ("django-reviewer", "Django & DRF", "Django ORM efficiency (N+1 query elimination), migrations, and REST APIs."),
        ("django-build-resolver", "Django Operations", "Resolving Django migration clashes, collectstatic failures, and startup errors."),
        ("database-reviewer", "PostgreSQL & Supabase", "Database schema design, indexing strategies, query plan optimization (EXPLAIN)."),
        ("mle-reviewer", "Machine Learning Eng.", "ML pipeline validation, data contracts, model eval, serving, and drift detection."),
        ("rag-pipeline-reviewer", "RAG & Vector Search", "Chunking strategies, embedding retrieval quality, reranking, and RAGAS evals."),
        ("loop-operator", "Autonomous Execution", "Monitoring autonomous agent loops, detecting stalls, managing token budgets."),
        ("harness-optimizer", "Harness Performance", "Tuning harness configs for reliability, maximum throughput, and low token cost.")
    ]

    doc.add_table(
        ["Agent ID", "Domain & Specialization", "Primary Purpose & Activation Criteria"],
        agents_data[1:15],
        col_widths=[105, 115, 279]
    )

    doc.start_page()
    doc.add_h2("Agent Taxonomy (Continued: Systems, Languages & Infrastructure)")
    doc.add_table(
        ["Agent ID", "Domain & Specialization", "Primary Purpose & Activation Criteria"],
        agents_data[15:],
        col_widths=[105, 115, 279]
    )

    doc.add_h2("Autonomous Agent Orchestration")
    doc.add_p(
        "OAS agents are not designed to work in isolation. The system employs proactive multi-agent orchestration, "
        "where agents automatically delegate to one another based on lifecycle stage:"
    )
    doc.add_bullet("Feature Initiation", "When a user requests a complex feature, OAS automatically invokes the planner to establish requirements and an implementation plan before code is touched.")
    doc.add_bullet("Development Cycle", "The planner hands off to tdd-guide, which writes failing tests (RED) and prompts for minimal code (GREEN).")
    doc.add_bullet("Review & Quality Gate", "Once implementation completes, code-reviewer and language-specific reviewers (e.g., typescript-reviewer) evaluate maintainability while security-reviewer scans for vulnerabilities.")
    doc.add_bullet("Failure Recovery", "If a build or type error occurs at any point, control automatically transfers to build-error-resolver, which isolates and fixes the error incrementally before returning control.")

    # -------------------------------------------------------------------------
    # SECTION 6: THE 286 WORKFLOW SKILLS ECOSYSTEM
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("6. The 286 Workflow Skills Ecosystem")
    doc.add_p(
        "While agents represent active execution personas, Skills represent procedural domain knowledge and workflows. "
        "Every OAS skill lives in `skills/<name>/SKILL.md` and contains structured YAML frontmatter (name, description, origin, metadata), "
        "actionable step-by-step guidance, tested code patterns, and explicit 'When to Use' criteria."
    )
    doc.add_p(
        "With 286 production skills, OAS provides the most comprehensive AI development catalog in existence, spanning modern web development, "
        "systems programming, distributed architectures, machine learning, bioinformatics, and enterprise operations."
    )

    doc.add_h2("Skill Categorization & High-Impact Domains")

    skill_categories = [
        ("Frontend & UI Engineering", "React, Next.js 16+ Turbopack, Vue, Nuxt 4, Svelte, Tailwind, Liquid Glass, Motion Foundations, Accessibility (a11y), CWV optimization (LCP, INP)."),
        ("Backend & Distributed Systems", "Express, NestJS, FastAPI, Django, Spring Boot, Quarkus, Golang patterns, Microservices, Hexagonal architecture, ClickHouse, Postgres, Redis, Prisma."),
        ("Test-Driven Dev & Verification", "TDD workflow, Playwright E2E testing, AI regression testing, verification loop, checkpointing, contract-first APIs, test coverage analysis."),
        ("Cloud, DevOps & Infrastructure", "Docker patterns, Kubernetes, Flox environments, Uncloud self-hosting, homelab networking (Pi-hole, WireGuard, VLANs), serverless architectures."),
        ("AI, Machine Learning & RAG", "MLE production pipelines, RAG pipeline evaluation, token budget advisory, Prompt optimizer, on-device foundation models, RecSys architecture."),
        ("Biomedical & Life Sciences", "AlphaFold DB structural analysis, Ensembl, UniProt, ChEMBL, PubMed, ClinicalTrials.gov, dbSNP, gnomAD, Foldseek, PDB biomolecular modeling."),
        ("Security & Supply Chain", "AgentShield scan, supply chain incident response, DeFi AMM security, HIPAA/PHI compliance, memory leak debugging, secret detection."),
        ("Multi-Agent & Meta-Operations", "DMUX multi-agent orchestration, continuous agent loops, autonomous loops, unified memory vault, plan canvas, worktree orchestration.")
    ]

    for cat_name, cat_desc in skill_categories:
        doc.add_bullet(cat_name, cat_desc, size=8.5)

    doc.add_h2("Skill Anatomy & Standards")
    doc.add_p(
        "Every skill adheres to strict quality and safety guidelines defined in `RULES.md`:"
    )
    doc.add_code_block([
        "---",
        "name: unified-memory",
        "description: Share durable context between Claude, Codex, Cursor, and other harnesses.",
        "metadata:",
        "  origin: OAS",
        "---",
        "# Unified Memory Workflow",
        "## Runtime Prerequisite: Requires oas-universal CLI",
        "## When To Use: Save durable context, hand off work across harnesses, resume prior tasks.",
        "## Scopes: project (.oas/memory/project/), team (.oas/memory/team/), user (~/.oas/memory/)"
    ])

    # -------------------------------------------------------------------------
    # SECTION 7: OAS MEMORY VAULT & UNIFIED CONTEXT
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("7. Flagship Innovation: OAS Memory Vault")
    doc.add_p(
        "A central architectural innovation of OAS is the Memory Vault (`oas memory` CLI and `oas-memory-mcp`). "
        "Historically, AI agents have been ephemeral: every new session begins with a blank slate, and context cannot "
        "be shared between different tools (e.g., passing work from Claude Code to Codex). "
        "The OAS Memory Vault provides a universal, inspectable, and secure persistence layer."
    )

    doc.add_h2("The 3-Tier Storage Scopes")

    scopes_data = [
        ("Scope", "Disk Storage Location", "Governance & Visibility Rules"),
        ("Project Scope", "<repo>/.oas/memory/project/", "Repo-local ephemeral context. Protected by a fail-closed `.gitignore` to prevent accidental secret commits."),
        ("Team Scope", "<repo>/.oas/memory/team/", "Durable architectural context intended for version control, team review, and Git PR sharing."),
        ("User Scope", "~/.oas/memory/", "Operator-level context that follows the individual developer across all repositories on their machine.")
    ]
    doc.add_table(
        ["Scope", "Storage Location", "Governance & Visibility Rules"],
        scopes_data[1:],
        col_widths=[90, 150, 259]
    )

    doc.add_h2("Memory Schema & Cross-Harness Handoffs (`oas.memory.v1`)")
    doc.add_p(
        "Memories are stored as human-readable Markdown files with strict YAML frontmatter conforming to `oas.memory.v1`. "
        "This allows any developer to inspect, edit, or delete memories using standard tools like `cat`, `grep`, or VS Code:"
    )

    doc.add_code_block([
        "---",
        "schema: oas.memory.v1",
        "id: mem-2026-09-07-auth-migration",
        "title: Authentication Migration to PKCE",
        "kind: handoff",
        "source_harness: claude-code",
        "target_harness: codex",
        "trust: unreviewed",
        "tags: [auth, security, migration]",
        "---",
        "## Handoff Summary",
        "Unit tests in tests/auth.test.js pass. Pending task: update DRF views to validate PKCE challenge."
    ])

    doc.add_callout(
        "FAIL-CLOSED SECURITY IN THE VAULT",
        "The Memory Vault enforces a strict fail-closed security boundary: memories recalled into agent context are treated as untrusted data rather than executable instructions. This prevents memory poisoning attacks (where an adversary implants malicious commands into persistent memory to hijack future agent sessions).",
        kind="warning"
    )

    # -------------------------------------------------------------------------
    # SECTION 8: TCAS AIRSPACE COLLISION DECONFLICTION
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("8. TCAS Airspace Collision Deconfliction (Layer 4)")
    doc.add_p(
        "When running multi-agent swarms or parallel autonomous loops (e.g., using `dmux` or background workers), "
        "a critical danger arises: multiple agents editing the same files simultaneously, causing merge conflicts, "
        "overwritten code, and race conditions. "
        "OAS solves this with TCAS (Traffic Collision Avoidance System)—a Layer 4 Airspace Deconfliction engine."
    )

    doc.add_h2("How TCAS Protects the Workspace")
    doc.add_bullet("1. File Proximity Probing", "Before an agent begins editing a file or module, TCAS checks active agent leases. If another agent is currently modifying the same file tree, TCAS issues an immediate proximity alert.")
    doc.add_bullet("2. Worktree Isolation", "When parallel tasks are detected, TCAS automatically spins up temporary, isolated Git worktrees (`scripts/orchestrate-worktrees.js`). Each agent works on a private filesystem branch, completely isolated from concurrent edits.")
    doc.add_bullet("3. Semantic Lock Arbitration", "If two agents require write access to the same shared interface or schema, TCAS acts as an arbiter, pausing the secondary agent until the primary agent commits and passes unit tests.")
    doc.add_bullet("4. Collision Deconfliction", "Upon task completion, TCAS merges the isolated worktree back into the main branch, verifying that tests still pass and no regressions were introduced.")

    doc.add_h2("Strategic Context Compaction")
    doc.add_p(
        "In addition to spatial deconfliction, OAS manages temporal resource limits through the Strategic Context Compactor (`packages/engine/src/compactor.js`). "
        "When an agent session approaches the 200,000 token limit, the compactor:"
    )
    doc.add_bullet("Strips Ephemeral Traces", "Removes raw terminal outputs, large JSON tool responses, and redundant diffs that have already been validated.")
    doc.add_bullet("Distills Decisions", "Extracts key architectural decisions, file changes, and pending goals into structured summaries.")
    doc.add_bullet("Preserves Momentum", "Re-injects the compacted state into a clean context window, allowing tasks to run indefinitely without hitting the context cliff.")

    # -------------------------------------------------------------------------
    # SECTION 9: AGENTSHIELD & SUPPLY CHAIN DEFENSE
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("9. AgentShield: Enterprise Supply Chain Security")
    doc.add_p(
        "In 2025 and 2026, the rise of autonomous coding tools created a new attack vector: AI supply-chain poisoning. "
        "Attacks such as CVE-2025-59536 (Remote Code Execution via poisoned project configs) and CVE-2026-21852 (API key exfiltration via redirected base URLs) "
        "demonstrated that simply opening an untrusted repository in an AI tool could compromise an engineer's machine. "
        "OAS addresses this with AgentShield—a dedicated security suite built directly into the operating system."
    )

    doc.add_h2("The 5 Layers of AgentShield Protection")

    shield_layers = [
        ("Protection Layer", "Scan Surface", "Threat Mitigated"),
        ("1. IOC Scanner", "`scripts/ci/scan-supply-chain-iocs.js`", "Scans project files for known malicious domains, URLs, base URL overrides, and leaked credentials."),
        ("2. Prompt Guard", "`packages/engine/src/sandbox.js`", "Detects indirect prompt injection payloads hidden inside markdown docs, PR comments, and email attachments."),
        ("3. Hook Auditor", "`scripts/ci/validate-hooks.js`", "Validates that lifecycle hooks do not execute arbitrary shell commands without explicit user permission."),
        ("4. MCP Gatekeeper", "`.mcp.json` & server configs", "Prevents shadow MCP servers from auto-approving dangerous tools or silently exfiltrating source code."),
        ("5. Secret Interceptor", "PreToolUse Hook Engine", "Strips API keys, bearer tokens, SSH keys, and system paths from agent tool outputs before they reach the model.")
    ]
    doc.add_table(
        ["Protection Layer", "Scan Surface", "Threat Mitigated"],
        shield_layers[1:],
        col_widths=[105, 155, 239]
    )

    doc.add_h2("The Simon Willison 'Lethal Trifecta'")
    doc.add_p(
        "AgentShield is architected specifically to dismantle the 'Lethal Trifecta' of AI vulnerabilities:"
    )
    doc.add_bullet("Private Data Access", "The agent has read access to proprietary source code and local secrets.")
    doc.add_bullet("Untrusted Content Processing", "The agent reads foreign input (untrusted GitHub PRs, external docs, web search results).")
    doc.add_bullet("External Communication", "The agent has access to tools that can make network requests or push git commits.")
    doc.add_p(
        "When all three conditions exist, prompt injection transforms from a curiosity into remote code execution and data exfiltration. "
        "AgentShield breaks this chain by strictly sandboxing network communication, sanitizing external inputs, and sequestering secrets in memory."
    )

    # -------------------------------------------------------------------------
    # SECTION 10: OAS STUDIO & CLOUD CONTROL PLANE
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("10. OAS Studio & Enterprise Cloud Control Plane")
    doc.add_p(
        "While terminal-based CLI tools are ideal for headless execution, complex multi-agent workflows require visual observability. "
        "OAS includes OAS Studio (`scripts/oas-studio.js` and `apps/web`), an enterprise-grade web control plane and visual agentic IDE "
        "running locally at `http://127.0.0.1:3458/`."
    )

    doc.add_h2("Studio Architecture & Capabilities")

    studio_views = [
        ("View / Subsystem", "Technology", "Operational Function"),
        ("Execution DAG", "SVG / Canvas + SSE", "Visualizes real-time dependency graphs of executing agents, showing task status, token burn, and pause/resume controls."),
        ("Live Workspace", "Real-time Terminal", "Interactive console allowing operators to monitor live stdout/stderr, inspect tool calls, and provide human feedback."),
        ("Knowledge Graph", "Force-Directed Graph", "Interactive 3D/2D visualization linking 69 agents, 286 skills, 94 commands, and MCP servers with searchable node relationships."),
        ("Plan Canvas Pro", "Interactive Canvas", "Browser-based canvas for reviewing implementation plans, allowing operators to annotate items, chat, and click 'Approve'."),
        ("Capabilities Catalog", "Virtual List UI", "Comprehensive, filterable library of all installed skills, agents, commands, and MCP configs with instant search."),
        ("Memory & Telemetry", "SQLite Inspector", "Visual explorer for the OAS Memory Vault and SQLite state store, displaying session history and telemetry metrics."),
        ("Studio Builder", "Visual Workflow Editor", "Drag-and-drop agent pipeline builder for chaining agents, defining fallback triggers, and creating custom DAGs.")
    ]
    doc.add_table(
        ["View / Subsystem", "Technology", "Operational Function"],
        studio_views[1:],
        col_widths=[110, 110, 279]
    )

    doc.add_h2("Real-Time Streaming Engine (`apps/api/src/server.js`)")
    doc.add_p(
        "The control plane communicates with the execution engine via a high-performance Server-Sent Events (SSE) streaming engine. "
        "It emits fine-grained events for every step in an agent's lifecycle:"
    )
    doc.add_bullet("agent:step", "Emitted whenever an agent performs reasoning, invokes a tool, or produces code modifications.")
    doc.add_bullet("agent:intervention:paused", "Triggered when an agent detects an ambiguous requirement or dangerous command, pausing execution for operator review.")
    doc.add_bullet("agent:human_in_the_loop:feedback", "Allows the human operator to inject course-correcting instructions directly into the running agent without restarting the session.")

    # -------------------------------------------------------------------------
    # SECTION 11: HOW OAS HELPS USERS & ORGANIZATIONS
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("11. Value Proposition: How OAS Empowers Users")
    doc.add_p(
        "OAS delivers distinct, measurable value across every tier of the software engineering hierarchy:"
    )

    personas = [
        ("For Individual Developers & Freelancers",
         "Eliminates the tedious cognitive overhead of writing boilerplate, unit tests, and documentation. Developers act as technical directors, approving plans on Plan Canvas while specialized agents write tests, implement code, and fix build errors automatically. Delivers 10x engineering velocity without sacrificing code quality."),
        
        ("For Tech Leads & Software Architects",
         "Enforces team-wide architectural discipline automatically. Standardized rules (immutability, 80%+ test coverage, clean architecture) are strictly verified by automated code-reviewers and security-reviewers before code can be merged, eliminating architectural drift across large teams."),
        
        ("For Enterprise Engineering & CISO Teams",
         "Solves the compliance, security, and governance nightmare of 'shadow AI.' AgentShield eliminates supply-chain risks, verifies dependencies, and sanitizes secrets. Complete audit trails in SQLite provide provable governance for regulated industries (healthcare HIPAA, financial compliance)."),
        
        ("For Autonomous Loop & AI Engineers",
         "Provides the bulletproof infrastructure needed to run safe, multi-hour autonomous loops. TCAS prevents file collisions, the Strategic Compactor prevents token exhaustion, and loop monitors eliminate runaway retries, allowing safe overnight feature development.")
    ]

    for p_title, p_desc in personas:
        doc.add_h3(p_title)
        doc.add_p(p_desc, size=8.5, line_spacing=11.5)

    doc.add_h2("The Open-Source Business Model & Platform Value Loop")
    doc.add_p(
        "OAS follows the proven open-source infrastructure playbook (similar to Linux, PostgreSQL, or Kubernetes):"
    )
    doc.add_bullet("Free Forever Open-Source Core (MIT)", "The full meta-harness layer, all 69 agents, 286 skills, memory vault, and local CLI remain MIT-licensed open source forever. Anyone can clone, inspect, and use it freely.")
    doc.add_bullet("OAS Pro & Hosted Control Plane ($19/seat/mo)", "For private enterprise repositories, OAS Tools provides a hosted GitHub App, managed multi-agent queues, cloud team memory synchronization, and compliance audit reporting.")
    doc.add_bullet("Compute & Ecosystem Partnerships", "Strategic partnerships with high-performance compute and evaluation providers (Itô Markets for decentralized compute, Fal.ai for media, CodeRabbit and Greptile for automated review) fund continuous full-time maintenance.")

    # -------------------------------------------------------------------------
    # SECTION 12: COMPATIBILITY MATRIX & GETTING STARTED
    # -------------------------------------------------------------------------
    doc.start_page()
    doc.add_h1("12. Compatibility Matrix & Getting Started Guide")
    doc.add_p(
        "OAS provides native compatibility and adapters across 12 modern AI harnesses and editors:"
    )

    matrix = [
        ("Harness / Editor", "Integration Level", "Supported Capabilities"),
        ("Claude Code", "Native Full Support", "Full 69 agents, 286 skills, 94 commands, lifecycle hooks, memory vault, and guided plugin setup."),
        ("Codex (OpenAI)", "Native Sync Path", "Full agent sync, memory vault, worktree execution, and MCP configuration."),
        ("Cursor IDE", "Adapter Support", "Rules, cursorrules generation, memory vault CLI, and skill workflow lookup."),
        ("Google Gemini", "Adapter Support", "Adapted agents, system instructions, MCP tools, and memory integration."),
        ("OpenCode", "Plugin Support", "Full plugin pack, commands, skills, and model gateway integration."),
        ("Zed Editor", "Adapter Support", "Slash commands, context server configuration, and rules enforcement."),
        ("Kimi Code", "Native Guided Setup", "Full guided install, skills pack, and hook profile integration."),
        ("Hermes", "Adapter Support", "Memory vault bridge, cross-harness handoffs, and skill discovery."),
        ("Pi", "Extension Support", "Pi extension bridge (`.pi/extensions`), prompts, and skills."),
        ("Antigravity IDE", "Native Plugin Support", "Eager/lazy MCP servers, custom skills, rules, and background tasks."),
        ("Qwen Code", "Adapter Support", "Rules pack, prompt templates, and selective skill manifests."),
        ("GitHub Copilot", "Rules Adapter", "Repo-level instructions (`.github/copilot-instructions.md`) and coding standards.")
    ]
    doc.add_table(
        ["Harness / Editor", "Integration Level", "Supported Capabilities"],
        matrix[1:],
        col_widths=[105, 110, 284]
    )

    doc.add_h2("Quick-Start Installation & Verification")
    doc.add_p(
        "Getting started with OAS is accomplished via the universal Node.js CLI:"
    )
    doc.add_code_block([
        "# 1. Guided Multi-Harness Setup (Configures Claude Code, Codex, or Kimi):",
        "npx oas-universal setup",
        "",
        "# 2. Launch the Enterprise Studio & Cloud Control Plane UI:",
        "npx oas-universal control-pane   # or: node scripts/oas-studio.js",
        "",
        "# 3. Initialize the OAS Memory Vault in your repository:",
        "oas memory init --scope project",
        "",
        "# 4. Run System Diagnostic & Health Check:",
        "oas doctor"
    ])

    doc.add_h2("Conclusion")
    doc.add_p(
        "Operating Agent System (OAS) v2.2.1 represents the maturation of AI-driven software development from erratic, "
        "unstructured autocomplete prompts into an enterprise-grade, deterministic engineering discipline. "
        "By uniting specialized autonomous agents, comprehensive workflow skills, durable cross-session memory, "
        "uncompromising supply-chain security, and a real-time visual control plane, OAS provides the foundational "
        "operating system that will power the next decade of software engineering."
    )

    # Compile the document
    doc.compile_pdf()

if __name__ == "__main__":
    generate_dossier()
