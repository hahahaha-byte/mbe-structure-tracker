from __future__ import annotations

import argparse
import csv
import io
import json
import mimetypes
import sys
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.parse import parse_qs, unquote, urlparse

from mbe_tracker.database import (
    connect,
    create_item,
    create_wafer,
    delete_item,
    delete_wafer,
    DuplicateWaferCodeError,
    duplicate_wafer,
    export_payload,
    get_wafer,
    import_wafer,
    init_db,
    list_wafers,
    move_item,
    paste_item,
    payload_json,
    restore_item_tree,
    update_item,
    update_wafer,
)
from mbe_tracker.excel_importer import DEFAULT_IMPORT_DIR, iter_excel_files, parse_xlsx


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DEFAULT_DB = ROOT / "data" / "mbe.sqlite"


class AppState:
    db_path = DEFAULT_DB


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def text_response(
    handler: BaseHTTPRequestHandler,
    status: int,
    body: str,
    content_type: str = "text/plain; charset=utf-8",
    filename: Optional[str] = None,
) -> None:
    raw = body.encode("utf-8-sig" if content_type.startswith("text/csv") else "utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(raw)))
    if filename:
        handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.end_headers()
    handler.wfile.write(raw)


def parse_body(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    length = int(handler.headers.get("Content-Length", 0))
    if not length:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    if not raw:
        return {}
    return json.loads(raw)


class MBEHandler(BaseHTTPRequestHandler):
    server_version = "MBETracker/0.1"

    def do_GET(self) -> None:
        self.dispatch("GET")

    def do_POST(self) -> None:
        self.dispatch("POST")

    def do_PUT(self) -> None:
        self.dispatch("PUT")

    def do_DELETE(self) -> None:
        self.dispatch("DELETE")

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    def dispatch(self, method: str) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/"):
                self.handle_api(method, parsed.path, parse_qs(parsed.query))
            else:
                self.handle_static(parsed.path)
        except KeyError as exc:
            json_response(self, HTTPStatus.NOT_FOUND, {"error": str(exc)})
        except DuplicateWaferCodeError as exc:
            json_response(
                self,
                HTTPStatus.CONFLICT,
                {"error": str(exc), "code": exc.code, "wafer_code": exc.wafer_code},
            )
        except ValueError as exc:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except sqlite_error() as exc:
            json_response(self, HTTPStatus.CONFLICT, sqlite_error_payload(exc))
        except Exception as exc:
            json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def handle_static(self, path: str) -> None:
        if path in {"", "/"}:
            file_path = STATIC_DIR / "index.html"
        else:
            relative = Path(unquote(path.lstrip("/")))
            file_path = (ROOT / relative).resolve()
            if STATIC_DIR not in file_path.parents and file_path != STATIC_DIR:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
        if not file_path.exists() or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        raw = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def handle_api(self, method: str, path: str, query: Dict[str, Any]) -> None:
        parts = [unquote(part) for part in path.strip("/").split("/")]
        body = parse_body(self) if method in {"POST", "PUT"} else {}
        init_db(AppState.db_path)
        with connect(AppState.db_path) as conn:
            if method == "GET" and parts == ["api", "health"]:
                json_response(self, HTTPStatus.OK, {"ok": True})
                return
            if method == "GET" and parts == ["api", "wafers"]:
                search = query.get("search", [""])[0]
                json_response(self, HTTPStatus.OK, {"wafers": list_wafers(conn, search)})
                return
            if method == "POST" and parts == ["api", "wafers"]:
                json_response(self, HTTPStatus.CREATED, {"wafer": create_wafer(conn, body)})
                return
            if method == "GET" and len(parts) == 3 and parts[:2] == ["api", "wafers"]:
                json_response(self, HTTPStatus.OK, {"wafer": get_wafer(conn, int(parts[2]))})
                return
            if method == "PUT" and len(parts) == 3 and parts[:2] == ["api", "wafers"]:
                json_response(self, HTTPStatus.OK, {"wafer": update_wafer(conn, int(parts[2]), body)})
                return
            if method == "DELETE" and len(parts) == 3 and parts[:2] == ["api", "wafers"]:
                delete_wafer(conn, int(parts[2]))
                json_response(self, HTTPStatus.OK, {"ok": True})
                return
            if method == "POST" and len(parts) == 4 and parts[:2] == ["api", "wafers"] and parts[3] == "duplicate":
                wafer = duplicate_wafer(conn, int(parts[2]), body.get("wafer_code"))
                json_response(self, HTTPStatus.CREATED, {"wafer": wafer})
                return
            if method == "POST" and len(parts) == 4 and parts[:2] == ["api", "wafers"] and parts[3] == "items":
                item = create_item(conn, int(parts[2]), body)
                json_response(self, HTTPStatus.CREATED, {"item": item})
                return
            if method == "POST" and len(parts) == 4 and parts[:2] == ["api", "wafers"] and parts[3] == "paste":
                item = paste_item(
                    conn,
                    int(parts[2]),
                    int(body["source_item_id"]),
                    body.get("parent_id"),
                    body.get("after_id"),
                    body.get("before_id"),
                )
                json_response(self, HTTPStatus.CREATED, {"item": item})
                return
            if method == "PUT" and len(parts) == 3 and parts[:2] == ["api", "items"]:
                json_response(self, HTTPStatus.OK, {"item": update_item(conn, int(parts[2]), body)})
                return
            if method == "DELETE" and len(parts) == 3 and parts[:2] == ["api", "items"]:
                deleted = delete_item(conn, int(parts[2]))
                json_response(self, HTTPStatus.OK, {"ok": True, "deleted": deleted})
                return
            if method == "POST" and len(parts) == 4 and parts[:2] == ["api", "items"] and parts[3] == "move":
                item = move_item(conn, int(parts[2]), body.get("direction", "up"))
                json_response(self, HTTPStatus.OK, {"item": item})
                return
            if method == "POST" and len(parts) == 4 and parts[:2] == ["api", "wafers"] and parts[3] == "restore":
                item = restore_item_tree(conn, int(parts[2]), body["tree"])
                id_map = item.pop("_id_map", {})
                json_response(self, HTTPStatus.CREATED, {"item": item, "id_map": id_map})
                return
            if method == "POST" and parts == ["api", "import", "excel"]:
                result = import_excel(conn, body)
                json_response(self, HTTPStatus.OK, result)
                return
            if method == "GET" and parts == ["api", "export", "json"]:
                wafer_id = optional_int(query.get("wafer_id", [""])[0])
                text_response(self, HTTPStatus.OK, payload_json(conn, wafer_id), "application/json; charset=utf-8", "mbe-wafers.json")
                return
            if method == "GET" and parts == ["api", "export", "csv"]:
                wafer_id = optional_int(query.get("wafer_id", [""])[0])
                text_response(self, HTTPStatus.OK, export_csv(conn, wafer_id), "text/csv; charset=utf-8", "mbe-structure.csv")
                return
        json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})


def sqlite_error() -> type[Exception]:
    import sqlite3

    return sqlite3.Error


def sqlite_error_payload(exc: Exception) -> Dict[str, Any]:
    message = str(exc)
    if "UNIQUE constraint failed: wafer.wafer_code" in message:
        return {"error": "片号已存在，请换一个片号。", "code": "duplicate_wafer_code"}
    return {"error": message}


def optional_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    return int(value)


def import_excel(conn: Any, body: Dict[str, Any]) -> Dict[str, Any]:
    directory = Path(body.get("directory") or DEFAULT_IMPORT_DIR).expanduser()
    pattern = body.get("pattern") or "片号N*.xlsx"
    imported = []
    errors = []
    for file_path in iter_excel_files(directory, pattern):
        try:
            parsed = parse_xlsx(file_path)
            wafer = import_wafer(conn, parsed["wafer"], parsed["items"])
            imported.append({"file": file_path.name, "wafer_code": wafer["wafer_code"], "item_count": len(wafer["items"])})
        except Exception as exc:
            errors.append({"file": file_path.name, "error": str(exc)})
    return {"imported": imported, "errors": errors, "directory": str(directory), "pattern": pattern}


def export_csv(conn: Any, wafer_id: Optional[int] = None) -> str:
    payload = export_payload(conn, wafer_id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "wafer_code",
            "size",
            "structure_name",
            "path",
            "type",
            "layer_name",
            "material",
            "thickness_nm",
            "periods",
            "single_period_thickness_nm",
            "doping",
            "growth_temp",
            "is_quantum_dot",
            "notes",
        ]
    )
    for wafer in payload["wafers"]:
        children = build_children_map(wafer["items"])
        write_csv_items(writer, wafer, children, None, "")
    return output.getvalue()


def build_children_map(items: list[Dict[str, Any]]) -> Dict[Optional[int], list[Dict[str, Any]]]:
    children: Dict[Optional[int], list[Dict[str, Any]]] = {}
    for item in items:
        children.setdefault(item["parent_id"], []).append(item)
    for group in children.values():
        group.sort(key=lambda row: (row["order_index"], row["id"]))
    return children


def write_csv_items(
    writer: csv.writer,
    wafer: Dict[str, Any],
    children: Dict[Optional[int], list[Dict[str, Any]]],
    parent_id: Optional[int],
    prefix: str,
) -> None:
    for index, item in enumerate(children.get(parent_id, []), start=1):
        path = f"{prefix}.{index}" if prefix else str(index)
        writer.writerow(
            [
                wafer["wafer_code"],
                wafer["size"],
                wafer["structure_name"],
                path,
                item["item_type"],
                item["layer_name"],
                item["material"],
                item["thickness_nm"] or "",
                item["periods"] or "",
                item["single_period_thickness_nm"] or "",
                item["doping"],
                item["growth_temp"],
                item["is_quantum_dot"],
                item["notes"],
            ]
        )
        write_csv_items(writer, wafer, children, item["id"], path)


def run_import_command(args: argparse.Namespace) -> None:
    init_db(args.db)
    with connect(args.db) as conn:
        result = import_excel(conn, {"directory": args.directory, "pattern": args.pattern})
    print(json.dumps(result, ensure_ascii=False, indent=2))


def run_server(args: argparse.Namespace) -> None:
    AppState.db_path = Path(args.db).expanduser()
    init_db(AppState.db_path)
    server = ThreadingHTTPServer((args.host, args.port), MBEHandler)
    print(f"MBE tracker running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local MBE wafer structure tracker")
    subparsers = parser.add_subparsers(dest="command")

    serve = subparsers.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--db", default=str(DEFAULT_DB))

    importer = subparsers.add_parser("import-excel")
    importer.add_argument("--db", default=str(DEFAULT_DB))
    importer.add_argument("--directory", default=str(DEFAULT_IMPORT_DIR))
    importer.add_argument("--pattern", default="片号N*.xlsx")
    return parser


def main() -> None:
    parser = build_parser()
    if len(sys.argv) == 1:
        args = parser.parse_args(["serve"])
    else:
        args = parser.parse_args()
    if args.command == "import-excel":
        run_import_command(args)
    else:
        run_server(args)


if __name__ == "__main__":
    main()
