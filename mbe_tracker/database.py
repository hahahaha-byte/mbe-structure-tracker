from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


ITEM_FIELDS = (
    "item_type",
    "parent_id",
    "order_index",
    "layer_name",
    "material",
    "thickness_nm",
    "periods",
    "single_period_thickness_nm",
    "doping",
    "growth_temp",
    "notes",
    "is_quantum_dot",
)

TEXT_ITEM_FIELDS = {"item_type", "layer_name", "material", "doping", "growth_temp", "notes"}
FLOAT_ITEM_FIELDS = {"thickness_nm", "single_period_thickness_nm"}
INT_ITEM_FIELDS = {"parent_id", "order_index", "periods", "is_quantum_dot"}


def utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def connect(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path | str) -> None:
    path = Path(db_path)
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
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS structure_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wafer_id INTEGER NOT NULL,
                parent_id INTEGER,
                item_type TEXT NOT NULL CHECK (item_type IN ('layer', 'repeat')),
                order_index INTEGER NOT NULL DEFAULT 0,
                layer_name TEXT DEFAULT '',
                material TEXT DEFAULT '',
                thickness_nm REAL,
                periods INTEGER,
                single_period_thickness_nm REAL,
                doping TEXT DEFAULT '',
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


def normalize_item_payload(data: Dict[str, Any], existing: Dict[str, Any] | None = None) -> Dict[str, Any]:
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
    base["doping"] = normalize_doping(base.get("doping"))
    base["periods"] = base.get("periods") or (1 if base["item_type"] == "repeat" else None)
    base["is_quantum_dot"] = 1 if base.get("is_quantum_dot") else 0
    return base


def list_wafers(conn: sqlite3.Connection, search: str = "") -> List[Dict[str, Any]]:
    params: List[Any] = []
    where = ""
    if search:
        like = f"%{search}%"
        where = "WHERE w.wafer_code LIKE ? OR w.structure_name LIKE ? OR w.notes LIKE ?"
        params.extend([like, like, like])
    rows = conn.execute(
        f"""
        SELECT
            w.*,
            COUNT(i.id) AS item_count,
            SUM(CASE WHEN COALESCE(i.doping, '') <> '' THEN 1 ELSE 0 END) AS doped_item_count
        FROM wafer w
        LEFT JOIN structure_item i ON i.wafer_id = w.id
        {where}
        GROUP BY w.id
        ORDER BY w.updated_at DESC, w.wafer_code COLLATE NOCASE
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
    conn.execute(
        """
        INSERT INTO wafer (wafer_code, size, structure_name, growth_date, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            code,
            clean_text(data.get("size")),
            clean_text(data.get("structure_name")),
            clean_text(data.get("growth_date")),
            clean_text(data.get("notes")),
            now,
            now,
        ),
    )
    wafer_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    return get_wafer(conn, wafer_id)


def update_wafer(conn: sqlite3.Connection, wafer_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    allowed = ("wafer_code", "size", "structure_name", "growth_date", "notes")
    updates = []
    params: List[Any] = []
    for field in allowed:
        if field in data:
            updates.append(f"{field} = ?")
            params.append(clean_text(data.get(field)))
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
    parent_id = clean_int(data.get("parent_id"))
    order_index = None
    if after_id:
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

    item = normalize_item_payload(data)
    now = utc_now()
    conn.execute(
        """
        INSERT INTO structure_item (
            wafer_id, parent_id, item_type, order_index, layer_name, material,
            thickness_nm, periods, single_period_thickness_nm, doping,
            growth_temp, notes, is_quantum_dot, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            wafer_id,
            parent_id,
            item["item_type"],
            order_index,
            item.get("layer_name", ""),
            item.get("material", ""),
            item.get("thickness_nm"),
            item.get("periods"),
            item.get("single_period_thickness_nm"),
            item.get("doping", ""),
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
    item = normalize_item_payload(data, current)
    now = utc_now()
    conn.execute(
        """
        UPDATE structure_item SET
            item_type = ?, layer_name = ?, material = ?, thickness_nm = ?,
            periods = ?, single_period_thickness_nm = ?, doping = ?,
            growth_temp = ?, notes = ?, is_quantum_dot = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            item["item_type"],
            item.get("layer_name", ""),
            item.get("material", ""),
            item.get("thickness_nm"),
            item.get("periods"),
            item.get("single_period_thickness_nm"),
            item.get("doping", ""),
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
    item = normalize_item_payload(payload)
    now = utc_now()
    conn.execute(
        """
        INSERT INTO structure_item (
            wafer_id, parent_id, item_type, order_index, layer_name, material,
            thickness_nm, periods, single_period_thickness_nm, doping,
            growth_temp, notes, is_quantum_dot, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            wafer_id,
            parent_id,
            item["item_type"],
            order_index,
            item.get("layer_name", ""),
            item.get("material", ""),
            item.get("thickness_nm"),
            item.get("periods"),
            item.get("single_period_thickness_nm"),
            item.get("doping", ""),
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
    if parent_id is None:
        siblings = conn.execute(
            "SELECT id, order_index FROM structure_item WHERE wafer_id = ? AND parent_id IS NULL ORDER BY order_index, id",
            (wafer_id,),
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
            wafer_id, parent_id, item_type, order_index, layer_name, material,
            thickness_nm, periods, single_period_thickness_nm, doping,
            growth_temp, notes, is_quantum_dot, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            target_wafer_id,
            target_parent_id,
            source["item_type"],
            order_index,
            source["layer_name"],
            source["material"],
            source["thickness_nm"],
            source["periods"],
            source["single_period_thickness_nm"],
            source["doping"],
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
) -> Dict[str, Any]:
    order_index = None
    if after_id:
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
    code = unique_wafer_code(conn, clean_text(new_code) or f"{source['wafer_code']}-copy")
    now = utc_now()
    conn.execute(
        """
        INSERT INTO wafer (wafer_code, size, structure_name, growth_date, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            code,
            source["size"],
            source["structure_name"],
            source["growth_date"],
            source["notes"],
            now,
            now,
        ),
    )
    new_wafer_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    roots = conn.execute(
        "SELECT id FROM structure_item WHERE wafer_id = ? AND parent_id IS NULL ORDER BY order_index, id",
        (wafer_id,),
    ).fetchall()
    for index, root in enumerate(roots):
        clone_item_tree(conn, int(root["id"]), new_wafer_id, None, index)
    return get_wafer(conn, new_wafer_id)


def import_wafer(conn: sqlite3.Connection, wafer_data: Dict[str, Any], items: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    code = clean_text(wafer_data.get("wafer_code"))
    if not code:
        raise ValueError("wafer_code_required")
    existing = row_to_dict(conn.execute("SELECT * FROM wafer WHERE wafer_code = ?", (code,)).fetchone())
    now = utc_now()
    if existing:
        wafer_id = int(existing["id"])
        conn.execute(
            """
            UPDATE wafer SET size = ?, structure_name = ?, growth_date = ?, notes = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                clean_text(wafer_data.get("size")),
                clean_text(wafer_data.get("structure_name")),
                clean_text(wafer_data.get("growth_date")),
                clean_text(wafer_data.get("notes")),
                now,
                wafer_id,
            ),
        )
        conn.execute("DELETE FROM structure_item WHERE wafer_id = ?", (wafer_id,))
    else:
        conn.execute(
            """
            INSERT INTO wafer (wafer_code, size, structure_name, growth_date, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                code,
                clean_text(wafer_data.get("size")),
                clean_text(wafer_data.get("structure_name")),
                clean_text(wafer_data.get("growth_date")),
                clean_text(wafer_data.get("notes")),
                now,
                now,
            ),
        )
        wafer_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])

    for index, item in enumerate(items):
        payload = dict(item)
        payload["order_index"] = index
        payload["parent_id"] = None
        create_item(conn, wafer_id, payload)
    return get_wafer(conn, wafer_id)


def touch_wafer(conn: sqlite3.Connection, wafer_id: int) -> None:
    conn.execute("UPDATE wafer SET updated_at = ? WHERE id = ?", (utc_now(), wafer_id))


def export_payload(conn: sqlite3.Connection, wafer_id: Optional[int] = None) -> Dict[str, Any]:
    if wafer_id:
        return {"wafers": [get_wafer(conn, wafer_id)]}
    return {"wafers": [get_wafer(conn, int(row["id"])) for row in conn.execute("SELECT id FROM wafer ORDER BY wafer_code")]}


def payload_json(conn: sqlite3.Connection, wafer_id: Optional[int] = None) -> str:
    return json.dumps(export_payload(conn, wafer_id), ensure_ascii=False, indent=2)
