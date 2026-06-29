from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


ROOT_DIR = Path(__file__).resolve().parent.parent
SAMPLE_DATA_PATH = ROOT_DIR / "data" / "sample_wafers.json"

ITEM_FIELDS = (
    "item_type",
    "section",
    "parent_id",
    "order_index",
    "layer_name",
    "material",
    "thickness_nm",
    "periods",
    "single_period_thickness_nm",
    "doping",
    "doping_type",
    "growth_temp",
    "notes",
    "is_quantum_dot",
)

TEXT_ITEM_FIELDS = {"item_type", "section", "layer_name", "material", "doping", "doping_type", "growth_temp", "notes"}
FLOAT_ITEM_FIELDS = {"thickness_nm", "single_period_thickness_nm"}
INT_ITEM_FIELDS = {"parent_id", "order_index", "periods", "is_quantum_dot"}
ITEM_SECTIONS = {"source", "as_pressure"}
WAFER_TYPES = {"formal", "test", "machine"}
MACHINE_RECORD_TYPES = {"", "open_chamber", "speed_test"}
WAFER_FIELDS = (
    "wafer_code",
    "size",
    "structure_name",
    "growth_date",
    "notes",
    "sample_holder_code",
    "wafer_type",
    "machine_record_type",
    "as_beam_ratio",
    "qd_islanding_time",
    "qd_deposition",
    "reconstruction_temp",
    "qd_growth_temp_offset",
    "qd_growth_temp",
    "growth_rate",
    "qd_density",
    "qd_volume",
    "qd_volume_cv",
    "qd_height",
    "pl_peak_nm",
    "pl_fwhm_nm",
    "pl_intensity",
    "standby_vacuum",
    "as_pressure_fill_vacuum",
    "as_bulk_temp",
)
TEST_WAFER_FIELDS = (
    "as_beam_ratio",
    "qd_islanding_time",
    "qd_deposition",
    "reconstruction_temp",
    "qd_growth_temp_offset",
    "qd_growth_temp",
    "growth_rate",
    "qd_density",
    "qd_volume",
    "qd_volume_cv",
    "qd_height",
    "pl_peak_nm",
    "pl_fwhm_nm",
    "pl_intensity",
)
MACHINE_WAFER_FIELDS = (
    "machine_record_type",
    "standby_vacuum",
    "as_pressure_fill_vacuum",
    "as_bulk_temp",
)


class DuplicateWaferCodeError(ValueError):
    code = "duplicate_wafer_code"

    def __init__(self, wafer_code: str) -> None:
        self.wafer_code = wafer_code
        super().__init__(f"片号 {wafer_code} 已存在，请换一个片号。")


def utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def connect(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path | str) -> None:
    path = Path(db_path)
    should_seed_sample = not path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS wafer (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wafer_code TEXT NOT NULL UNIQUE,
                size TEXT DEFAULT '',
                structure_name TEXT DEFAULT '',
                growth_date TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                sample_holder_code TEXT DEFAULT '',
                wafer_type TEXT DEFAULT 'formal',
                machine_record_type TEXT DEFAULT '',
                as_beam_ratio TEXT DEFAULT '',
                qd_islanding_time TEXT DEFAULT '',
                qd_deposition TEXT DEFAULT '',
                reconstruction_temp TEXT DEFAULT '',
                qd_growth_temp_offset TEXT DEFAULT '',
                qd_growth_temp TEXT DEFAULT '',
                growth_rate TEXT DEFAULT '',
                qd_density TEXT DEFAULT '',
                qd_volume TEXT DEFAULT '',
                qd_volume_cv TEXT DEFAULT '',
                qd_height TEXT DEFAULT '',
                pl_peak_nm TEXT DEFAULT '',
                pl_fwhm_nm TEXT DEFAULT '',
                pl_intensity TEXT DEFAULT '',
                standby_vacuum TEXT DEFAULT '',
                as_pressure_fill_vacuum TEXT DEFAULT '',
                as_bulk_temp TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS structure_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wafer_id INTEGER NOT NULL,
                parent_id INTEGER,
                item_type TEXT NOT NULL CHECK (item_type IN ('layer', 'repeat')),
                section TEXT DEFAULT 'source',
                order_index INTEGER NOT NULL DEFAULT 0,
                layer_name TEXT DEFAULT '',
                material TEXT DEFAULT '',
                thickness_nm REAL,
                periods INTEGER,
                single_period_thickness_nm REAL,
                doping TEXT DEFAULT '',
                doping_type TEXT DEFAULT '',
                growth_temp TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                is_quantum_dot INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (wafer_id) REFERENCES wafer(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES structure_item(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_structure_item_wafer_parent
                ON structure_item (wafer_id, parent_id, order_index);

            CREATE TABLE IF NOT EXISTS template (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        ensure_column(conn, "structure_item", "doping_type", "TEXT DEFAULT ''")
        ensure_column(conn, "structure_item", "section", "TEXT DEFAULT 'source'")
        ensure_column(conn, "wafer", "sample_holder_code", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "wafer_type", "TEXT DEFAULT 'formal'")
        ensure_column(conn, "wafer", "machine_record_type", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "as_beam_ratio", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "qd_islanding_time", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "qd_deposition", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "reconstruction_temp", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "qd_growth_temp_offset", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "qd_growth_temp", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "growth_rate", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "qd_density", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "qd_volume", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "qd_volume_cv", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "qd_height", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "pl_peak_nm", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "pl_fwhm_nm", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "pl_intensity", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "standby_vacuum", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "as_pressure_fill_vacuum", "TEXT DEFAULT ''")
        ensure_column(conn, "wafer", "as_bulk_temp", "TEXT DEFAULT ''")
        if should_seed_sample:
            seed_sample_data(conn)


def seed_sample_data(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT 1 FROM wafer LIMIT 1").fetchone():
        return
    if not SAMPLE_DATA_PATH.exists():
        return
    try:
        payload = json.loads(SAMPLE_DATA_PATH.read_text(encoding="utf-8"))
        import_json_wafers(conn, payload, "skip")
    except (OSError, json.JSONDecodeError, ValueError):
        return


def ensure_column(conn: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}
    if column_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def row_to_dict(row: sqlite3.Row | None) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def clean_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def normalize_doping(value: Any) -> str:
    text = clean_text(value)
    if text.lower() in {"0", "0.0", "none", "no", "undoped", "未掺杂", "不掺杂"}:
        return ""
    return text


def normalize_doping_type(value: Any) -> str:
    text = clean_text(value).upper().replace("型", "").replace("掺杂", "").replace("参杂", "")
    if text in {"N", "P"}:
        return text
    return ""


def normalize_wafer_type(value: Any) -> str:
    text = clean_text(value).lower()
    return text if text in WAFER_TYPES else "formal"


def normalize_machine_record_type(value: Any) -> str:
    text = clean_text(value).lower()
    if text == "开腔":
        return "open_chamber"
    if text == "测速":
        return "speed_test"
    return text if text in MACHINE_RECORD_TYPES else ""


def normalize_item_section(value: Any) -> str:
    text = clean_text(value).lower()
    return text if text in ITEM_SECTIONS else "source"


def computed_growth_rate(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return ""
    seconds = clean_float(match.group(0))
    if not seconds or seconds <= 0:
        return ""
    return f"{1.7 / seconds:.3f}"


def first_number(value: Any) -> Optional[float]:
    text = clean_text(value)
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return clean_float(match.group(0)) if match else None


def format_compact_number(value: float) -> str:
    if abs(value - round(value)) < 1e-9:
        return str(int(round(value)))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def computed_qd_growth_temp(reconstruction_temp: Any, offset: Any, fallback: Any = "") -> str:
    reconstruction = first_number(reconstruction_temp)
    relative = first_number(offset)
    if reconstruction is None or relative is None:
        return clean_text(fallback)
    return format_compact_number(reconstruction + relative)


def prepared_wafer_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    payload = {field: clean_text(data.get(field)) for field in WAFER_FIELDS}
    payload["wafer_type"] = normalize_wafer_type(data.get("wafer_type"))
    payload["machine_record_type"] = normalize_machine_record_type(data.get("machine_record_type"))
    payload["growth_rate"] = computed_growth_rate(data.get("qd_islanding_time"))
    payload["qd_growth_temp"] = computed_qd_growth_temp(
        data.get("reconstruction_temp"),
        data.get("qd_growth_temp_offset"),
        data.get("qd_growth_temp"),
    )
    return payload


def normalize_item_payload(
    data: Dict[str, Any],
    existing: Dict[str, Any] | None = None,
    machine_record: bool = False,
) -> Dict[str, Any]:
    base = dict(existing or {})
    qd_requested = bool(clean_int(data.get("is_quantum_dot", base.get("is_quantum_dot"))))
    for field in ITEM_FIELDS:
        if field not in data:
            continue
        value = data[field]
        if field in TEXT_ITEM_FIELDS:
            base[field] = clean_text(value)
        elif field in FLOAT_ITEM_FIELDS:
            if field == "thickness_nm" and qd_requested:
                base[field] = clean_text(value)
            else:
                base[field] = clean_float(value)
        elif field in INT_ITEM_FIELDS:
            base[field] = clean_int(value)
    base["item_type"] = base.get("item_type") if base.get("item_type") in {"layer", "repeat"} else "layer"
    base["section"] = normalize_item_section(base.get("section"))
    if machine_record:
        base["doping"] = clean_text(base.get("doping"))
        base["doping_type"] = ""
        base["is_quantum_dot"] = 0
    elif base["section"] == "as_pressure":
        base["doping"] = clean_text(base.get("doping"))
        base["doping_type"] = ""
        base["is_quantum_dot"] = 0
    else:
        base["doping"] = normalize_doping(base.get("doping"))
        base["doping_type"] = normalize_doping_type(base.get("doping_type"))
    base["periods"] = base.get("periods") or (1 if base["item_type"] == "repeat" else None)
    base["is_quantum_dot"] = 1 if base.get("is_quantum_dot") else 0
    return base


def is_machine_wafer(conn: sqlite3.Connection, wafer_id: int) -> bool:
    row = conn.execute("SELECT wafer_type FROM wafer WHERE id = ?", (wafer_id,)).fetchone()
    return normalize_wafer_type(row["wafer_type"] if row else "") == "machine"


def list_wafers(conn: sqlite3.Connection, search: str = "", wafer_type: str = "") -> List[Dict[str, Any]]:
    params: List[Any] = []
    where_parts: List[str] = []
    requested_type = clean_text(wafer_type).lower()
    if requested_type in WAFER_TYPES:
        where_parts.append("COALESCE(w.wafer_type, 'formal') = ?")
        params.append(requested_type)
    if search:
        like = f"%{search}%"
        where_parts.append(
            """(
                w.wafer_code LIKE ? OR w.structure_name LIKE ? OR w.notes LIKE ?
                OR COALESCE(w.machine_record_type, '') LIKE ?
                OR COALESCE(w.sample_holder_code, '') LIKE ?
                OR COALESCE(w.as_beam_ratio, '') LIKE ?
                OR COALESCE(w.qd_islanding_time, '') LIKE ?
                OR COALESCE(w.qd_deposition, '') LIKE ?
                OR COALESCE(w.reconstruction_temp, '') LIKE ?
                OR COALESCE(w.qd_growth_temp_offset, '') LIKE ?
                OR COALESCE(w.qd_growth_temp, '') LIKE ?
                OR COALESCE(w.growth_rate, '') LIKE ?
                OR COALESCE(w.qd_density, '') LIKE ?
                OR COALESCE(w.qd_volume, '') LIKE ?
                OR COALESCE(w.qd_volume_cv, '') LIKE ?
                OR COALESCE(w.qd_height, '') LIKE ?
                OR COALESCE(w.pl_peak_nm, '') LIKE ?
                OR COALESCE(w.pl_fwhm_nm, '') LIKE ?
                OR COALESCE(w.pl_intensity, '') LIKE ?
                OR COALESCE(w.standby_vacuum, '') LIKE ?
                OR COALESCE(w.as_pressure_fill_vacuum, '') LIKE ?
                OR COALESCE(w.as_bulk_temp, '') LIKE ?
            )"""
        )
        params.extend([like] * 22)
    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    rows = conn.execute(
        f"""
        SELECT
            w.*,
            COUNT(i.id) AS item_count,
            SUM(CASE WHEN COALESCE(i.doping, '') <> '' OR COALESCE(i.doping_type, '') <> '' THEN 1 ELSE 0 END) AS doped_item_count
        FROM wafer w
        LEFT JOIN structure_item i ON i.wafer_id = w.id
        {where}
        GROUP BY w.id
        ORDER BY
            CASE WHEN UPPER(w.wafer_code) GLOB 'N[0-9][0-9][0-9][0-9][0-9][0-9]*' THEN 0 ELSE 1 END,
            CASE WHEN UPPER(w.wafer_code) GLOB 'N[0-9][0-9][0-9][0-9][0-9][0-9]*' THEN SUBSTR(w.wafer_code, 2, 6) ELSE '' END DESC,
            CASE WHEN UPPER(w.wafer_code) GLOB 'N[0-9][0-9][0-9][0-9][0-9][0-9]*' THEN UPPER(SUBSTR(w.wafer_code, 8)) ELSE '' END DESC,
            w.updated_at DESC,
            w.wafer_code COLLATE NOCASE DESC
        """,
        params,
    ).fetchall()
    return [row_to_dict(row) for row in rows if row]


def get_wafer(conn: sqlite3.Connection, wafer_id: int) -> Dict[str, Any]:
    wafer = row_to_dict(conn.execute("SELECT * FROM wafer WHERE id = ?", (wafer_id,)).fetchone())
    if not wafer:
        raise KeyError("wafer_not_found")
    item_rows = conn.execute(
        """
        SELECT * FROM structure_item
        WHERE wafer_id = ?
        ORDER BY COALESCE(parent_id, 0), order_index, id
        """,
        (wafer_id,),
    ).fetchall()
    wafer["items"] = [row_to_dict(row) for row in item_rows if row]
    return wafer


def create_wafer(conn: sqlite3.Connection, data: Dict[str, Any]) -> Dict[str, Any]:
    now = utc_now()
    code = clean_text(data.get("wafer_code")) or unique_wafer_code(conn, "N-new")
    ensure_unique_wafer_code(conn, code)
    payload = prepared_wafer_payload({**data, "wafer_code": code})
    fields = list(WAFER_FIELDS) + ["created_at", "updated_at"]
    conn.execute(
        f"""
        INSERT INTO wafer ({', '.join(fields)})
        VALUES ({', '.join(['?'] * len(fields))})
        """,
        [payload[field] for field in WAFER_FIELDS] + [now, now],
    )
    wafer_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    return get_wafer(conn, wafer_id)


def update_wafer(conn: sqlite3.Connection, wafer_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    if "qd_islanding_time" in data:
        data = {**data, "growth_rate": computed_growth_rate(data.get("qd_islanding_time"))}
    if "reconstruction_temp" in data or "qd_growth_temp_offset" in data:
        current = row_to_dict(conn.execute("SELECT * FROM wafer WHERE id = ?", (wafer_id,)).fetchone()) or {}
        reconstruction_temp = data.get("reconstruction_temp", current.get("reconstruction_temp"))
        offset = data.get("qd_growth_temp_offset", current.get("qd_growth_temp_offset"))
        fallback = data.get("qd_growth_temp", current.get("qd_growth_temp"))
        data = {**data, "qd_growth_temp": computed_qd_growth_temp(reconstruction_temp, offset, fallback)}
    updates = []
    params: List[Any] = []
    for field in WAFER_FIELDS:
        if field in data:
            if field == "wafer_type":
                value = normalize_wafer_type(data.get(field))
            elif field == "machine_record_type":
                value = normalize_machine_record_type(data.get(field))
            else:
                value = clean_text(data.get(field))
            if field == "wafer_code":
                ensure_unique_wafer_code(conn, value, wafer_id)
            updates.append(f"{field} = ?")
            params.append(value)
    if updates:
        updates.append("updated_at = ?")
        params.append(utc_now())
        params.append(wafer_id)
        conn.execute(f"UPDATE wafer SET {', '.join(updates)} WHERE id = ?", params)
    return get_wafer(conn, wafer_id)


def delete_wafer(conn: sqlite3.Connection, wafer_id: int) -> None:
    conn.execute("DELETE FROM wafer WHERE id = ?", (wafer_id,))


def unique_wafer_code(conn: sqlite3.Connection, base_code: str) -> str:
    base = clean_text(base_code) or "N-new"
    existing = {
        row["wafer_code"]
        for row in conn.execute("SELECT wafer_code FROM wafer WHERE wafer_code LIKE ?", (f"{base}%",))
    }
    if base not in existing:
        return base
    index = 2
    while f"{base}-{index}" in existing:
        index += 1
    return f"{base}-{index}"


def ensure_unique_wafer_code(conn: sqlite3.Connection, wafer_code: str, exclude_id: Optional[int] = None) -> None:
    params: List[Any] = [clean_text(wafer_code)]
    sql = "SELECT id FROM wafer WHERE wafer_code = ?"
    if exclude_id is not None:
        sql += " AND id != ?"
        params.append(exclude_id)
    if conn.execute(sql, params).fetchone():
        raise DuplicateWaferCodeError(clean_text(wafer_code))


def next_order(conn: sqlite3.Connection, wafer_id: int, parent_id: Optional[int]) -> int:
    if parent_id is None:
        row = conn.execute(
            "SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM structure_item WHERE wafer_id = ? AND parent_id IS NULL",
            (wafer_id,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM structure_item WHERE wafer_id = ? AND parent_id = ?",
            (wafer_id, parent_id),
        ).fetchone()
    return int(row["next_order"])


def sibling_where(parent_id: Optional[int]) -> str:
    return "parent_id IS NULL" if parent_id is None else "parent_id = ?"


def create_item(conn: sqlite3.Connection, wafer_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    after_id = clean_int(data.get("after_id"))
    before_id = clean_int(data.get("before_id"))
    parent_id = clean_int(data.get("parent_id"))
    order_index = None
    if before_id:
        before = row_to_dict(
            conn.execute("SELECT * FROM structure_item WHERE id = ? AND wafer_id = ?", (before_id, wafer_id)).fetchone()
        )
        if not before:
            raise KeyError("before_item_not_found")
        parent_id = before["parent_id"]
        order_index = int(before["order_index"])
        shift_siblings(conn, wafer_id, parent_id, order_index)
    elif after_id:
        after = row_to_dict(
            conn.execute("SELECT * FROM structure_item WHERE id = ? AND wafer_id = ?", (after_id, wafer_id)).fetchone()
        )
        if not after:
            raise KeyError("after_item_not_found")
        parent_id = after["parent_id"]
        order_index = int(after["order_index"]) + 1
        shift_siblings(conn, wafer_id, parent_id, order_index)
    if order_index is None:
        order_index = next_order(conn, wafer_id, parent_id)

    item = normalize_item_payload(data, machine_record=is_machine_wafer(conn, wafer_id))
    now = utc_now()
    conn.execute(
        """
        INSERT INTO structure_item (
            wafer_id, parent_id, item_type, section, order_index, layer_name, material,
            thickness_nm, periods, single_period_thickness_nm, doping,
            doping_type, growth_temp, notes, is_quantum_dot, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            wafer_id,
            parent_id,
            item["item_type"],
            item.get("section", "source"),
            order_index,
            item.get("layer_name", ""),
            item.get("material", ""),
            item.get("thickness_nm"),
            item.get("periods"),
            item.get("single_period_thickness_nm"),
            item.get("doping", ""),
            item.get("doping_type", ""),
            item.get("growth_temp", ""),
            item.get("notes", ""),
            item.get("is_quantum_dot", 0),
            now,
            now,
        ),
    )
    item_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    touch_wafer(conn, wafer_id)
    return row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (item_id,)).fetchone())


def shift_siblings(conn: sqlite3.Connection, wafer_id: int, parent_id: Optional[int], start_order: int) -> None:
    if parent_id is None:
        conn.execute(
            "UPDATE structure_item SET order_index = order_index + 1 WHERE wafer_id = ? AND parent_id IS NULL AND order_index >= ?",
            (wafer_id, start_order),
        )
    else:
        conn.execute(
            "UPDATE structure_item SET order_index = order_index + 1 WHERE wafer_id = ? AND parent_id = ? AND order_index >= ?",
            (wafer_id, parent_id, start_order),
        )


def update_item(conn: sqlite3.Connection, item_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    current = row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (item_id,)).fetchone())
    if not current:
        raise KeyError("item_not_found")
    item = normalize_item_payload(data, current, is_machine_wafer(conn, int(current["wafer_id"])))
    now = utc_now()
    conn.execute(
        """
        UPDATE structure_item SET
            item_type = ?, section = ?, layer_name = ?, material = ?, thickness_nm = ?,
            periods = ?, single_period_thickness_nm = ?, doping = ?,
            doping_type = ?, growth_temp = ?, notes = ?, is_quantum_dot = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            item["item_type"],
            item.get("section", "source"),
            item.get("layer_name", ""),
            item.get("material", ""),
            item.get("thickness_nm"),
            item.get("periods"),
            item.get("single_period_thickness_nm"),
            item.get("doping", ""),
            item.get("doping_type", ""),
            item.get("growth_temp", ""),
            item.get("notes", ""),
            item.get("is_quantum_dot", 0),
            now,
            item_id,
        ),
    )
    touch_wafer(conn, int(current["wafer_id"]))
    return row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (item_id,)).fetchone())


def item_tree(conn: sqlite3.Connection, item_id: int) -> Optional[Dict[str, Any]]:
    current = row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (item_id,)).fetchone())
    if not current:
        return None
    children = conn.execute(
        "SELECT id FROM structure_item WHERE parent_id = ? ORDER BY order_index, id",
        (item_id,),
    ).fetchall()
    current["children"] = [item_tree(conn, int(child["id"])) for child in children]
    current["children"] = [child for child in current["children"] if child]
    return current


def delete_item(conn: sqlite3.Connection, item_id: int) -> Optional[Dict[str, Any]]:
    current = row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (item_id,)).fetchone())
    if not current:
        return None
    deleted = item_tree(conn, item_id)
    delete_item_children(conn, item_id)
    conn.execute("DELETE FROM structure_item WHERE id = ?", (item_id,))
    normalize_order(conn, int(current["wafer_id"]), current["parent_id"])
    touch_wafer(conn, int(current["wafer_id"]))
    return deleted


def delete_item_children(conn: sqlite3.Connection, item_id: int) -> None:
    children = conn.execute("SELECT id FROM structure_item WHERE parent_id = ?", (item_id,)).fetchall()
    for child in children:
        delete_item_children(conn, int(child["id"]))
        conn.execute("DELETE FROM structure_item WHERE id = ?", (int(child["id"]),))


def restore_item_tree(conn: sqlite3.Connection, wafer_id: int, tree: Dict[str, Any]) -> Dict[str, Any]:
    parent_id = clean_int(tree.get("parent_id"))
    if parent_id and not conn.execute(
        "SELECT 1 FROM structure_item WHERE id = ? AND wafer_id = ?",
        (parent_id, wafer_id),
    ).fetchone():
        parent_id = None

    requested_order = clean_int(tree.get("order_index"))
    max_order = next_order(conn, wafer_id, parent_id)
    order_index = requested_order if requested_order is not None and requested_order <= max_order else max_order
    shift_siblings(conn, wafer_id, parent_id, order_index)
    id_map: Dict[int, int] = {}
    restored = insert_tree_from_payload(conn, wafer_id, tree, parent_id, order_index, id_map)
    restored["_id_map"] = id_map
    normalize_order(conn, wafer_id, parent_id)
    touch_wafer(conn, wafer_id)
    return restored


def insert_tree_from_payload(
    conn: sqlite3.Connection,
    wafer_id: int,
    payload: Dict[str, Any],
    parent_id: Optional[int],
    order_index: int,
    id_map: Optional[Dict[int, int]] = None,
) -> Dict[str, Any]:
    item = normalize_item_payload(payload, machine_record=is_machine_wafer(conn, wafer_id))
    now = utc_now()
    conn.execute(
        """
        INSERT INTO structure_item (
            wafer_id, parent_id, item_type, section, order_index, layer_name, material,
            thickness_nm, periods, single_period_thickness_nm, doping,
            doping_type, growth_temp, notes, is_quantum_dot, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            wafer_id,
            parent_id,
            item["item_type"],
            item.get("section", "source"),
            order_index,
            item.get("layer_name", ""),
            item.get("material", ""),
            item.get("thickness_nm"),
            item.get("periods"),
            item.get("single_period_thickness_nm"),
            item.get("doping", ""),
            item.get("doping_type", ""),
            item.get("growth_temp", ""),
            item.get("notes", ""),
            item.get("is_quantum_dot", 0),
            now,
            now,
        ),
    )
    new_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    old_id = clean_int(payload.get("id"))
    if id_map is not None and old_id is not None:
        id_map[old_id] = new_id
    for child_index, child in enumerate(payload.get("children", [])):
        insert_tree_from_payload(conn, wafer_id, child, new_id, child_index, id_map)
    return row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (new_id,)).fetchone())


def normalize_order(conn: sqlite3.Connection, wafer_id: int, parent_id: Optional[int]) -> None:
    if parent_id is None:
        rows = conn.execute(
            "SELECT id FROM structure_item WHERE wafer_id = ? AND parent_id IS NULL ORDER BY order_index, id",
            (wafer_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id FROM structure_item WHERE wafer_id = ? AND parent_id = ? ORDER BY order_index, id",
            (wafer_id, parent_id),
        ).fetchall()
    for index, row in enumerate(rows):
        conn.execute("UPDATE structure_item SET order_index = ? WHERE id = ?", (index, int(row["id"])))


def move_item(conn: sqlite3.Connection, item_id: int, direction: str) -> Dict[str, Any]:
    current = row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (item_id,)).fetchone())
    if not current:
        raise KeyError("item_not_found")
    parent_id = current["parent_id"]
    wafer_id = int(current["wafer_id"])
    section = normalize_item_section(current.get("section"))
    if parent_id is None:
        siblings = conn.execute(
            """
            SELECT id, order_index FROM structure_item
            WHERE wafer_id = ? AND parent_id IS NULL AND COALESCE(section, 'source') = ?
            ORDER BY order_index, id
            """,
            (wafer_id, section),
        ).fetchall()
    else:
        siblings = conn.execute(
            "SELECT id, order_index FROM structure_item WHERE wafer_id = ? AND parent_id = ? ORDER BY order_index, id",
            (wafer_id, parent_id),
        ).fetchall()
    ids = [int(row["id"]) for row in siblings]
    position = ids.index(item_id)
    if direction == "up" and position > 0:
        swap_a, swap_b = item_id, ids[position - 1]
    elif direction == "down" and position < len(ids) - 1:
        swap_a, swap_b = item_id, ids[position + 1]
    else:
        return row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (item_id,)).fetchone())

    order_a = conn.execute("SELECT order_index FROM structure_item WHERE id = ?", (swap_a,)).fetchone()["order_index"]
    order_b = conn.execute("SELECT order_index FROM structure_item WHERE id = ?", (swap_b,)).fetchone()["order_index"]
    conn.execute("UPDATE structure_item SET order_index = ? WHERE id = ?", (order_b, swap_a))
    conn.execute("UPDATE structure_item SET order_index = ? WHERE id = ?", (order_a, swap_b))
    touch_wafer(conn, wafer_id)
    return row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (item_id,)).fetchone())


def clone_item_tree(
    conn: sqlite3.Connection,
    source_item_id: int,
    target_wafer_id: int,
    target_parent_id: Optional[int] = None,
    order_index: Optional[int] = None,
) -> Dict[str, Any]:
    source = row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (source_item_id,)).fetchone())
    if not source:
        raise KeyError("source_item_not_found")
    if order_index is None:
        order_index = next_order(conn, target_wafer_id, target_parent_id)
    now = utc_now()
    conn.execute(
        """
        INSERT INTO structure_item (
            wafer_id, parent_id, item_type, section, order_index, layer_name, material,
            thickness_nm, periods, single_period_thickness_nm, doping,
            doping_type, growth_temp, notes, is_quantum_dot, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            target_wafer_id,
            target_parent_id,
            source["item_type"],
            source.get("section", "source"),
            order_index,
            source["layer_name"],
            source["material"],
            source["thickness_nm"],
            source["periods"],
            source["single_period_thickness_nm"],
            source["doping"],
            source.get("doping_type", ""),
            source["growth_temp"],
            source["notes"],
            source["is_quantum_dot"],
            now,
            now,
        ),
    )
    new_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    children = conn.execute(
        "SELECT id FROM structure_item WHERE parent_id = ? ORDER BY order_index, id",
        (source_item_id,),
    ).fetchall()
    for child_index, child in enumerate(children):
        clone_item_tree(conn, int(child["id"]), target_wafer_id, new_id, child_index)
    touch_wafer(conn, target_wafer_id)
    return row_to_dict(conn.execute("SELECT * FROM structure_item WHERE id = ?", (new_id,)).fetchone())


def paste_item(
    conn: sqlite3.Connection,
    target_wafer_id: int,
    source_item_id: int,
    target_parent_id: Optional[int] = None,
    after_id: Optional[int] = None,
    before_id: Optional[int] = None,
) -> Dict[str, Any]:
    order_index = None
    before_id = clean_int(before_id)
    after_id = clean_int(after_id)
    if before_id:
        before = row_to_dict(
            conn.execute("SELECT * FROM structure_item WHERE id = ? AND wafer_id = ?", (before_id, target_wafer_id)).fetchone()
        )
        if not before:
            raise KeyError("before_item_not_found")
        target_parent_id = before["parent_id"]
        order_index = int(before["order_index"])
        shift_siblings(conn, target_wafer_id, target_parent_id, order_index)
    elif after_id:
        after = row_to_dict(
            conn.execute("SELECT * FROM structure_item WHERE id = ? AND wafer_id = ?", (after_id, target_wafer_id)).fetchone()
        )
        if not after:
            raise KeyError("after_item_not_found")
        target_parent_id = after["parent_id"]
        order_index = int(after["order_index"]) + 1
        shift_siblings(conn, target_wafer_id, target_parent_id, order_index)
    return clone_item_tree(conn, source_item_id, target_wafer_id, target_parent_id, order_index)


def duplicate_wafer(conn: sqlite3.Connection, wafer_id: int, new_code: str | None = None) -> Dict[str, Any]:
    source = row_to_dict(conn.execute("SELECT * FROM wafer WHERE id = ?", (wafer_id,)).fetchone())
    if not source:
        raise KeyError("wafer_not_found")
    requested_code = clean_text(new_code)
    if requested_code:
        ensure_unique_wafer_code(conn, requested_code)
        code = requested_code
    else:
        code = unique_wafer_code(conn, f"{source['wafer_code']}-copy")
    now = utc_now()
    payload = prepared_wafer_payload({**source, "wafer_code": code})
    fields = list(WAFER_FIELDS) + ["created_at", "updated_at"]
    conn.execute(
        f"""
        INSERT INTO wafer ({', '.join(fields)})
        VALUES ({', '.join(['?'] * len(fields))})
        """,
        [payload[field] for field in WAFER_FIELDS] + [now, now],
    )
    new_wafer_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    roots = conn.execute(
        "SELECT id FROM structure_item WHERE wafer_id = ? AND parent_id IS NULL ORDER BY order_index, id",
        (wafer_id,),
    ).fetchall()
    for index, root in enumerate(roots):
        clone_item_tree(conn, int(root["id"]), new_wafer_id, None, index)
    return get_wafer(conn, new_wafer_id)


def import_json_wafers(conn: sqlite3.Connection, payload: Any, conflict_strategy: str = "overwrite") -> Dict[str, Any]:
    if isinstance(payload, dict) and "wafers" in payload:
        wafers = payload.get("wafers") or []
    elif isinstance(payload, list):
        wafers = payload
    elif isinstance(payload, dict):
        wafers = [payload]
    else:
        raise ValueError("json_import_payload_invalid")

    imported = []
    errors = []
    skipped = []
    for index, wafer_data in enumerate(wafers, start=1):
        try:
            wafer = import_json_wafer(conn, wafer_data, conflict_strategy)
            if wafer:
                imported.append({"wafer_code": wafer["wafer_code"], "item_count": len(wafer["items"])})
            else:
                skipped.append({"wafer_code": clean_text(wafer_data.get("wafer_code"))})
        except Exception as exc:
            label = wafer_data.get("wafer_code") if isinstance(wafer_data, dict) else f"#{index}"
            errors.append({"wafer_code": label or f"#{index}", "error": str(exc)})
    return {"imported": imported, "errors": errors, "skipped": skipped}


def import_json_wafer(conn: sqlite3.Connection, wafer_data: Dict[str, Any], conflict_strategy: str = "overwrite") -> Optional[Dict[str, Any]]:
    if not isinstance(wafer_data, dict):
        raise ValueError("wafer_payload_invalid")
    code = clean_text(wafer_data.get("wafer_code"))
    if not code:
        raise ValueError("wafer_code_required")

    now = utc_now()
    existing = row_to_dict(conn.execute("SELECT * FROM wafer WHERE wafer_code = ?", (code,)).fetchone())
    strategy = conflict_strategy if conflict_strategy in {"overwrite", "rename", "skip"} else "overwrite"
    if existing and strategy == "skip":
        return None
    if existing and strategy == "rename":
        code = unique_wafer_code(conn, code)
        existing = None
    payload = prepared_wafer_payload({**wafer_data, "wafer_code": code})
    if existing:
        wafer_id = int(existing["id"])
        update_fields = [field for field in WAFER_FIELDS if field != "wafer_code"]
        conn.execute(
            f"""
            UPDATE wafer SET
                {', '.join([f'{field} = ?' for field in update_fields])},
                updated_at = ?
            WHERE id = ?
            """,
            [payload[field] for field in update_fields] + [now, wafer_id],
        )
        conn.execute("DELETE FROM structure_item WHERE wafer_id = ?", (wafer_id,))
    else:
        fields = list(WAFER_FIELDS) + ["created_at", "updated_at"]
        conn.execute(
            f"""
            INSERT INTO wafer ({', '.join(fields)})
            VALUES ({', '.join(['?'] * len(fields))})
            """,
            [payload[field] for field in WAFER_FIELDS] + [now, now],
        )
        wafer_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])

    roots = json_item_roots(wafer_data.get("items") or [])
    for index, root in enumerate(roots):
        payload = dict(root)
        payload["order_index"] = index
        insert_tree_from_payload(conn, wafer_id, payload, None, index, {})
    return get_wafer(conn, wafer_id)


def json_item_roots(items: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    item_list = [dict(item) for item in items if isinstance(item, dict)]
    if not item_list:
        return []
    if any("children" in item for item in item_list):
        roots = [item for item in item_list if not clean_int(item.get("parent_id"))]
        return sorted(roots or item_list, key=lambda item: (clean_int(item.get("order_index")) or 0, clean_int(item.get("id")) or 0))

    by_id = {clean_int(item.get("id")): item for item in item_list if clean_int(item.get("id")) is not None}
    if not by_id:
        return sorted(item_list, key=lambda item: clean_int(item.get("order_index")) or 0)
    children: Dict[Optional[int], List[Dict[str, Any]]] = {}
    for item in item_list:
        parent_id = clean_int(item.get("parent_id"))
        if parent_id not in by_id:
            parent_id = None
        children.setdefault(parent_id, []).append(item)
    for group in children.values():
        group.sort(key=lambda item: (clean_int(item.get("order_index")) or 0, clean_int(item.get("id")) or 0))

    def attach(item: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(item)
        payload["children"] = [attach(child) for child in children.get(clean_int(item.get("id")), [])]
        return payload

    return [attach(root) for root in children.get(None, [])]


def touch_wafer(conn: sqlite3.Connection, wafer_id: int) -> None:
    conn.execute("UPDATE wafer SET updated_at = ? WHERE id = ?", (utc_now(), wafer_id))


def export_payload(conn: sqlite3.Connection, wafer_id: Optional[int] = None) -> Dict[str, Any]:
    if wafer_id:
        return {"wafers": [get_wafer(conn, wafer_id)]}
    return {"wafers": [get_wafer(conn, int(row["id"])) for row in conn.execute("SELECT id FROM wafer ORDER BY wafer_code")]}


def payload_json(conn: sqlite3.Connection, wafer_id: Optional[int] = None) -> str:
    return json.dumps(export_payload(conn, wafer_id), ensure_ascii=False, indent=2)
