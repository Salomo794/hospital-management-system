#!/usr/bin/env python3
import base64
import json
import os
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote


def quote_identifier(value):
    if not value.replace("_", "a").isalnum() or not value:
        raise ValueError(f"Unsupported SQLite identifier: {value}")
    return '"' + value.replace('"', '""') + '"'


def open_source(path):
    resolved = Path(path).resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("SQLite source must be a regular file.")
    uri = f"file:{quote(str(resolved), safe='/')}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def backup(source, destination):
    destination_path = Path(destination).resolve()
    if destination_path.exists():
        raise FileExistsError("Refusing to overwrite an existing SQLite backup.")
    descriptor = os.open(destination_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        with open_source(source) as source_connection:
            with sqlite3.connect(destination_path) as backup_connection:
                source_connection.backup(backup_connection)
        os.chmod(destination_path, 0o600)
    except Exception:
        destination_path.unlink(missing_ok=True)
        raise


def inspect(source):
    with open_source(source) as connection:
        integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        foreign_key_errors = [
            {
                "table": row[0],
                "rowid": row[1],
                "parent": row[2],
                "foreign_key_id": row[3],
            }
            for row in connection.execute("PRAGMA foreign_key_check")
        ]
        table_names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        tables = []
        for table_name in table_names:
            table = quote_identifier(table_name)
            columns = [dict(row) for row in connection.execute(f"PRAGMA table_info({table})")]
            if not columns:
                raise ValueError(f"Could not inspect source table {table_name}.")
            null_counts = {}
            for column in columns:
                name = column["name"]
                quoted_column = quote_identifier(name)
                result = connection.execute(
                    f"SELECT SUM(CASE WHEN {quoted_column} IS NULL THEN 1 ELSE 0 END) "
                    f"FROM {table}"
                ).fetchone()[0]
                null_counts[name] = result or 0
            foreign_keys = [
                {
                    "table": row["table"],
                    "from": row["from"],
                    "to": row["to"],
                }
                for row in connection.execute(f"PRAGMA foreign_key_list({table})")
            ]
            row_count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            primary_key = [
                column["name"]
                for column in sorted(columns, key=lambda value: value["pk"])
                if column["pk"]
            ]
            tables.append(
                {
                    "name": table_name,
                    "columns": columns,
                    "foreign_keys": foreign_keys,
                    "primary_key": primary_key,
                    "row_count": row_count,
                    "null_counts": null_counts,
                }
            )
        return {
            "integrity_check": integrity,
            "foreign_key_errors": foreign_key_errors,
            "tables": tables,
        }


def encode(value):
    if isinstance(value, bytes):
        return {"$type": "blob", "value": base64.b64encode(value).decode("ascii")}
    if isinstance(value, int):
        return {"$type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"$type": "number", "value": repr(value)}
    return value


def dump(source, table_name):
    table = quote_identifier(table_name)
    with open_source(source) as connection:
        columns = [item["name"] for item in connection.execute(f"PRAGMA table_info({table})")]
        if not columns:
            raise ValueError(f"Source table {table_name} does not exist.")
        order = ["id"] if "id" in columns else []
        ordering = f" ORDER BY {quote_identifier(order[0])}" if order else ""
        for row in connection.execute(f"SELECT * FROM {table}{ordering}"):
            print(json.dumps([encode(row[column]) for column in columns], separators=(",", ":")))


def validate_foreign_keys(source, constraints):
    results = []
    with open_source(source) as connection:
        for key in constraints:
            table = quote_identifier(key["table"])
            column = quote_identifier(key["column"])
            referenced_table = quote_identifier(key["referencedTable"])
            referenced_column = quote_identifier(key["referencedColumn"])
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' "
                    "AND name NOT LIKE 'sqlite_%'"
                )
            }
            if key["table"] not in tables:
                continue
            if key["referencedTable"] not in tables:
                count = connection.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE {column} IS NOT NULL"
                ).fetchone()[0]
            else:
                count = connection.execute(
                    f"SELECT COUNT(*) FROM {table} child "
                    f"LEFT JOIN {referenced_table} parent "
                    f"ON child.{column} = parent.{referenced_column} "
                    f"WHERE child.{column} IS NOT NULL AND parent.{referenced_column} IS NULL"
                ).fetchone()[0]
            if count:
                results.append({**key, "invalid_count": count})
    return results


def main():
    if len(sys.argv) < 3:
        raise ValueError("Expected an operation and SQLite file path.")
    operation, source = sys.argv[1:3]
    if operation == "backup":
        if len(sys.argv) != 4:
            raise ValueError("Backup operation requires a destination path.")
        backup(source, sys.argv[3])
    elif operation == "inspect":
        print(json.dumps(inspect(source), separators=(",", ":")))
    elif operation == "dump":
        if len(sys.argv) != 4:
            raise ValueError("Dump operation requires a table name.")
        dump(source, sys.argv[3])
    elif operation == "validate-fks":
        if len(sys.argv) != 4:
            raise ValueError("Foreign-key validation requires a JSON constraints argument.")
        print(json.dumps(validate_foreign_keys(source, json.loads(sys.argv[3])), separators=(",", ":")))
    else:
        raise ValueError(f"Unknown operation: {operation}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
