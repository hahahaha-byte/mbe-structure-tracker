from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree as ET

from .database import clean_float, clean_int, clean_text, normalize_doping


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

DEFAULT_IMPORT_DIR = Path(
    "/Users/hahahaha/Library/CloudStorage/OneDrive-个人/Postgraduate File/杂项/外延表格-含样片结构统计/外延结构统计"
)


def col_to_index(reference: str) -> int:
    letters = "".join(ch for ch in reference if ch.isalpha())
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter.upper()) - 64
    return value


def cell_position(reference: str) -> Tuple[int, int]:
    digits = "".join(ch for ch in reference if ch.isdigit())
    return int(digits), col_to_index(reference)


def read_shared_strings(zf: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings: List[str] = []
    for si in root.findall("a:si", NS):
        strings.append("".join(node.text or "" for node in si.findall(".//a:t", NS)))
    return strings


def workbook_sheets(zf: zipfile.ZipFile) -> List[Tuple[str, str]]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    sheets: List[Tuple[str, str]] = []
    rel_key = f"{{{NS['r']}}}id"
    for sheet in workbook.findall("a:sheets/a:sheet", NS):
        target = rel_map[sheet.attrib[rel_key]]
        sheets.append((sheet.attrib["name"], "xl/" + target.lstrip("/")))
    return sheets


def read_first_sheet_cells(path: Path) -> Dict[Tuple[int, int], str]:
    with zipfile.ZipFile(path) as zf:
        shared = read_shared_strings(zf)
        sheets = workbook_sheets(zf)
        if not sheets:
            return {}
        sheet_path = sheets[0][1]
        worksheet = ET.fromstring(zf.read(sheet_path))
        cells: Dict[Tuple[int, int], str] = {}
        for cell in worksheet.findall(".//a:c", NS):
            reference = cell.attrib.get("r")
            if not reference:
                continue
            row, col = cell_position(reference)
            value_node = cell.find("a:v", NS)
            inline_node = cell.find("a:is", NS)
            value = ""
            if cell.attrib.get("t") == "s" and value_node is not None:
                value = shared[int(value_node.text or 0)]
            elif cell.attrib.get("t") == "inlineStr" and inline_node is not None:
                value = "".join(node.text or "" for node in inline_node.findall(".//a:t", NS))
            elif value_node is not None:
                value = value_node.text or ""
            if value != "":
                cells[(row, col)] = clean_text(value)
        return cells


def find_value_after_label(cells: Dict[Tuple[int, int], str], label: str, max_distance: int = 8) -> str:
    label_norm = label.lower()
    for (row, col), value in cells.items():
        if value.lower() == label_norm:
            for offset in range(1, max_distance + 1):
                candidate = cells.get((row, col + offset), "")
                if candidate:
                    return candidate
    return ""


def find_header_row(cells: Dict[Tuple[int, int], str]) -> Tuple[int, Dict[str, int]]:
    for (row, col), value in cells.items():
        if "材料结构" in value:
            columns = {"material": col, "layer_name": col - 1, "sequence": col - 2}
            for lookup_col in range(1, 18):
                header = cells.get((row, lookup_col), "")
                if "周期" in header and "厚度" not in header:
                    columns["periods"] = lookup_col
                elif "单周期" in header:
                    columns["single_period_thickness_nm"] = lookup_col
                elif "总厚度" in header:
                    columns["thickness_nm"] = lookup_col
                elif "掺杂" in header:
                    columns["doping"] = lookup_col
                elif "温度" in header:
                    columns["growth_temp"] = lookup_col
                elif "备注" in header:
                    columns["notes"] = lookup_col
            columns.setdefault("periods", col + 3)
            columns.setdefault("single_period_thickness_nm", col + 4)
            columns.setdefault("thickness_nm", col + 5)
            columns.setdefault("doping", col + 6)
            return row, columns
    raise ValueError("cannot_find_material_header")


def file_wafer_code(path: Path) -> str:
    match = re.search(r"(N\d+[A-Za-z]?)", path.stem)
    return match.group(1) if match else path.stem


def parse_xlsx(path: Path | str) -> Dict[str, Any]:
    workbook_path = Path(path)
    cells = read_first_sheet_cells(workbook_path)
    header_row, columns = find_header_row(cells)
    wafer_code = cells.get((2, 2)) or file_wafer_code(workbook_path)
    size = find_value_after_label(cells, "Wafer size") or cells.get((3, 5), "")
    structure_name = find_value_after_label(cells, "Structure") or cells.get((2, 9), "")
    items = parse_items(cells, header_row, columns)
    return {
        "wafer": {
            "wafer_code": wafer_code,
            "size": size,
            "structure_name": structure_name,
            "growth_date": "",
            "notes": f"Imported from {workbook_path.name}",
        },
        "items": items,
        "source": str(workbook_path),
    }


def parse_items(cells: Dict[Tuple[int, int], str], header_row: int, columns: Dict[str, int]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    empty_run = 0
    for row in range(header_row + 1, header_row + 220):
        layer_name = cells.get((row, columns["layer_name"]), "")
        material = cells.get((row, columns["material"]), "")
        periods_raw = cells.get((row, columns["periods"]), "")
        single_raw = cells.get((row, columns["single_period_thickness_nm"]), "")
        thickness_raw = cells.get((row, columns["thickness_nm"]), "")
        doping_raw = cells.get((row, columns["doping"]), "")
        growth_temp = cells.get((row, columns.get("growth_temp", 0)), "")
        notes = cells.get((row, columns.get("notes", 0)), "")
        if not any([layer_name, material, periods_raw, single_raw, thickness_raw, doping_raw, growth_temp, notes]):
            empty_run += 1
            if empty_run >= 8 and items:
                break
            continue
        empty_run = 0
        periods = clean_int(periods_raw)
        single = clean_float(single_raw)
        total = clean_float(thickness_raw)
        item_type = "repeat" if periods or single else "layer"
        if item_type == "repeat":
            periods = periods or 1
            if single is None and total is not None and periods:
                single = total / periods
            thickness = None
        else:
            thickness = total if total is not None else single
        items.append(
            {
                "item_type": item_type,
                "layer_name": layer_name,
                "material": material,
                "thickness_nm": thickness,
                "periods": periods,
                "single_period_thickness_nm": single,
                "doping": normalize_doping(doping_raw),
                "growth_temp": growth_temp,
                "notes": notes,
                "is_quantum_dot": 0,
            }
        )
    return items


def iter_excel_files(directory: Path | str, pattern: str = "片号N*.xlsx") -> Iterable[Path]:
    root = Path(directory).expanduser()
    yield from sorted(path for path in root.glob(pattern) if path.is_file() and not path.name.startswith("~$"))


def parse_directory(directory: Path | str = DEFAULT_IMPORT_DIR, pattern: str = "片号N*.xlsx") -> List[Dict[str, Any]]:
    return [parse_xlsx(path) for path in iter_excel_files(directory, pattern)]

