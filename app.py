import os
import re
import time
from typing import Dict, List, Any, Optional

from flask import Flask, request, jsonify
import traceback
from flask_cors import CORS
import gspread
from google.oauth2.service_account import Credentials


SPREADSHEET_ID = "1lLnSxFwjmt-bKuNRkwSeP_9z7Rw6yomHRcjt4gbhgJc"
SERVICE_ACCOUNT_FILE = os.path.join(os.path.dirname(__file__), "sbertmodel-64ae72e35a07.json")

# Имена листов
SHEET_SELECTION = "Выборка"
SHEET_TEXTS = "Тексты"

# Список потенциальных названий колонок для совместимости с таблицей
COLUMN_ALIASES = {
    "fio": ["ФИО", "Тестировщик", "Тестирующий", "Фио"],
    "partner": ["Партнер", "Партнёр", "Partner"],
    "name": ["Ресторан", "Рестораны", "Название", "Название ресторана"],
    "address": ["Адрес", "адрес"],
    "city": ["Город", "город"],
    "check_method": ["Способ проверки", "Способ проверки ", "Способ", "Проверка"],
    "wave": ["№ волны", "Номер волны", "Волна"],
}


def _normalize_string(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", "", str(value)).lower().replace("ё", "е")


def _find_column(row_header: List[str], aliases: List[str]) -> Optional[str]:
    header_map = {h: h for h in row_header}
    for h in row_header:
        header_map[_normalize_string(h)] = h
    for candidate in aliases:
        original = header_map.get(_normalize_string(candidate))
        if original:
            return original
    return None


def _build_gspread_client():
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise RuntimeError(
            f"Service account file not found: {SERVICE_ACCOUNT_FILE}. Поместите JSON рядом с app.py"
        )
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    return gspread.authorize(creds)


# Улучшенное кэширование с автообновлением каждые 2 минуты
import threading
from datetime import datetime, timedelta

class SheetCache:
    def __init__(self, ttl_seconds: int = 120):  # 2 минуты
        self.ttl = ttl_seconds
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._start_background_update()

    def get(self, key: str):
        with self._lock:
            item = self._cache.get(key)
            if not item:
                return None
            if time.time() - item["ts"] > self.ttl:
                return None
            return item["value"]

    def set(self, key: str, value: Any):
        with self._lock:
            self._cache[key] = {"ts": time.time(), "value": value}

    def force_refresh(self):
        """Принудительно обновляет весь кеш"""
        with self._lock:
            self._cache.clear()
        
        # Предзагружаем основные данные
        try:
            _read_sheet_header(SHEET_SELECTION)
            _read_sheet_as_dicts(SHEET_SELECTION)
            _read_sheet_header(SHEET_TEXTS)  
            _read_sheet_as_dicts(SHEET_TEXTS)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Кеш обновлен успешно")
        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Ошибка обновления кеша: {e}")

    def _start_background_update(self):
        """Запускает фоновое обновление кеша"""
        def update_loop():
            while True:
                time.sleep(self.ttl)  # Ждем 2 минуты
                self.force_refresh()
        
        thread = threading.Thread(target=update_loop, daemon=True)
        thread.start()

sheet_cache = SheetCache(ttl_seconds=120)  # 2 минуты кеш


def _get_worksheet_by_name_like(sh, target_name: str):
    def norm(x: str) -> str:
        return _normalize_string(x or "")
    t = norm(target_name)
    try:
        return sh.worksheet(target_name)
    except Exception:
        pass
    for ws in sh.worksheets():
        if norm(ws.title) == t:
            return ws
    for ws in sh.worksheets():
        if t in norm(ws.title):
            return ws
    return None


def _read_sheet_as_dicts(sheet_name: str) -> List[Dict[str, Any]]:
    cache_key = f"sheet::{sheet_name}"
    cached = sheet_cache.get(cache_key)
    if cached is not None:
        return cached

    gc = _build_gspread_client()
    sh = gc.open_by_key(SPREADSHEET_ID)
    worksheet = _get_worksheet_by_name_like(sh, sheet_name)
    if worksheet is None:
        raise RuntimeError(f"Лист '{sheet_name}' не найден в таблице")
    
    # Получаем все значения и обрабатываем вручную, чтобы избежать проблем с дублирующимися заголовками
    all_values = worksheet.get_all_values()
    if not all_values:
        sheet_cache.set(cache_key, [])
        return []
    
    # Первая строка - заголовки
    headers = all_values[0]
    
    # Создаем уникальные заголовки для дублирующихся колонок
    unique_headers = []
    header_counts = {}
    for h in headers:
        if h in header_counts:
            header_counts[h] += 1
            unique_headers.append(f"{h}_{header_counts[h]}")
        else:
            header_counts[h] = 0
            unique_headers.append(h)
    
    # Преобразуем строки в словари используя ОРИГИНАЛЬНЫЕ заголовки для ключей
    rows = []
    for row_values in all_values[1:]:  # пропускаем заголовок
        # Дополняем строку пустыми значениями если колонок меньше чем заголовков
        while len(row_values) < len(headers):
            row_values.append("")
        
        row_dict = {}
        for i, header in enumerate(headers):
            if i < len(row_values):
                row_dict[header] = row_values[i]
            else:
                row_dict[header] = ""
        rows.append(row_dict)
    
    sheet_cache.set(cache_key, rows)
    return rows


def _read_sheet_header(sheet_name: str) -> List[str]:
    cache_key = f"sheet_header::{sheet_name}"
    cached = sheet_cache.get(cache_key)
    if cached is not None:
        return cached
    
    gc = _build_gspread_client()
    sh = gc.open_by_key(SPREADSHEET_ID)
    worksheet = _get_worksheet_by_name_like(sh, sheet_name)
    if worksheet is None:
        raise RuntimeError(f"Лист '{sheet_name}' не найден в таблице")
    
    # Возвращаем оригинальные заголовки для совместимости
    headers = worksheet.row_values(1)
    sheet_cache.set(cache_key, headers)
    return headers


def _get_value(row: Dict[str, Any], header: List[str], aliases: List[str]) -> Any:
    col = _find_column(header, aliases)
    if not col:
        return None
    return row.get(col)


app = Flask(__name__, static_url_path="", static_folder=".")
CORS(app)


@app.get("/api/assignments")
def api_assignments():
    fio = request.args.get("fio", "").strip()
    if not fio:
        return jsonify({"error": "fio is required"}), 400

    normalized_fio = _normalize_string(fio)
    
    # Простая отладка для понимания что происходит
    debug_enabled = request.args.get("debug") == "1"
    try:
        header = _read_sheet_header(SHEET_SELECTION)
        rows = _read_sheet_as_dicts(SHEET_SELECTION)
    except Exception as e:
        hint = (
            "Нет доступа к таблице для сервисного аккаунта или лист не найден. "
            "Выдайте доступ email из client_email JSON и проверьте название листа 'Выборка'."
        )
        return jsonify({
            "error": "read_failed",
            "message": f"{hint} Детали: {e}",
            "trace": traceback.format_exc(),
        }), 500

    result: List[Dict[str, Any]] = []
    col_fio = _find_column(header, COLUMN_ALIASES["fio"]) or ""
    col_partner = _find_column(header, COLUMN_ALIASES["partner"]) or "Партнер"
    col_name = _find_column(header, COLUMN_ALIASES["name"]) or "Ресторан"
    col_address = _find_column(header, COLUMN_ALIASES["address"]) or "Адрес"
    col_city = _find_column(header, COLUMN_ALIASES["city"]) or "Город"
    col_method = _find_column(header, COLUMN_ALIASES["check_method"]) or "Способ проверки"
    col_wave = _find_column(header, COLUMN_ALIASES["wave"]) or "№ волны"

    matched_fio_rows = []
    wave_debug = []
    
    for idx, row in enumerate(rows):
        row_fio = _normalize_string(str(row.get(col_fio, "")))
        if row_fio != normalized_fio:
            continue
        
        # Эта строка прошла фильтр по ФИО
        wave_val = str(row.get(col_wave, "")).strip()
        normalized_wave = _normalize_string(wave_val)
        
        wave_check = normalized_wave == "1" or "волна1" in normalized_wave or re.search(r"(^|[^\d])1([^\d]|$)", normalized_wave)
        
        wave_debug.append({
            "row_idx": idx,
            "raw_wave": wave_val,
            "normalized_wave": normalized_wave,
            "passes_wave_filter": wave_check
        })
        
        matched_fio_rows.append(row)
        
        # допускаем варианты: "волна 1", "волна1", "1", "волна 1; волна 2"
        if not wave_check:
            continue

        partner = str(row.get(col_partner, "")).strip()
        name = str(row.get(col_name, "")).strip()
        address = str(row.get(col_address, "")).strip()
        city = str(row.get(col_city, "")).strip()
        method = str(row.get(col_method, "")).strip()

        result.append(
            {
                "id": idx,  # локальный ID из индекса в массиве
                "partner": partner,
                "name": name,
                "address": address,
                "city": city,
                "method": method,
                "wave": wave_val,
                "display": f"{partner} — {name} — {address} — {method}",
            }
        )

    response_data = {"fio": fio, "items": result}
    
    # Добавляем отладочную информацию если результат пустой или debug=1
    if len(result) == 0 or debug_enabled:
        total_fio_matches = 0
        for row in rows:
            if _normalize_string(str(row.get(col_fio, ""))) == normalized_fio:
                total_fio_matches += 1
        
        response_data["debug"] = {
            "search_fio": fio,
            "normalized_search_fio": normalized_fio,
            "total_rows": len(rows),
            "total_fio_matches": total_fio_matches,
            "matched_fio_rows_count": len(matched_fio_rows),
            "wave_debug": wave_debug,
            "col_fio": col_fio
        }
    
    return jsonify(response_data)


def _find_text_column(header: List[str], partner: str, method: str) -> Optional[str]:
    """Улучшенный поиск колонки с текстом для комбинации партнер + метод"""
    
    # Варианты поиска в порядке приоритета
    search_variants = [
        f"{partner} {method}",  # точное совпадение
        f"{partner}_{method}",  # с подчеркиванием
        f"{partner}-{method}",  # с дефисом
        f"{partner}.{method}",  # с точкой
        f"{partner}{method}",   # слитно
    ]
    
    # Первый проход - точные совпадения
    for variant in search_variants:
        normalized_variant = _normalize_string(variant)
        for h in header:
            if _normalize_string(h) == normalized_variant:
                return h
    
    # Второй проход - содержит партнера и метод
    normalized_partner = _normalize_string(partner)
    normalized_method = _normalize_string(method)
    
    for h in header:
        normalized_h = _normalize_string(h)
        if normalized_partner in normalized_h and normalized_method in normalized_h:
            return h
    
    # Третий проход - только партнер
    for h in header:
        if _normalize_string(h).startswith(normalized_partner):
            return h
    
    return None


@app.get("/api/text")
def api_text():
    partner = request.args.get("partner", "").strip()
    method = request.args.get("method", "").strip()
    if not partner or not method:
        return jsonify({"error": "partner and method are required"}), 400

    try:
        header = _read_sheet_header(SHEET_TEXTS)
        rows = _read_sheet_as_dicts(SHEET_TEXTS)
    except Exception as e:
        return jsonify({"error": "read_failed", "message": str(e), "trace": traceback.format_exc()}), 500

    if not rows or len(rows) < 3:
        return jsonify({"error": "Texts sheet structure invalid"}), 500

    # Структура листа "Тексты":
    # Строка 0: Названия партнеров
    # Строка 1: Способы проверки  
    # Строка 2+: Тексты инструкций
    
    partners_row = rows[0]  # Строка с партнерами
    methods_row = rows[1]   # Строка со способами проверки
    text_row = rows[2]      # Строка с текстами
    
    found_text = ""
    found_column = None
    
    # Ищем колонку где партнер + способ совпадают
    for col_key in header:
        if not col_key:  # Пропускаем пустые колонки
            continue
            
        partner_in_col = str(partners_row.get(col_key, "")).strip()
        method_in_col = str(methods_row.get(col_key, "")).strip()
        
        # Проверяем совпадение партнера и способа
        if (_normalize_string(partner) == _normalize_string(partner_in_col) and 
            _normalize_string(method) == _normalize_string(method_in_col)):
            
            found_text = str(text_row.get(col_key, "")).strip()
            found_column = col_key
            break
    
    # Fallback на общий текст из первой строки (колонка с пустым заголовком)
    general_text = str(text_row.get("", "")).strip()

    return jsonify({
        "key": f"{partner} {method}",
        "text": found_text or general_text,
        "general": general_text,
        "column": found_column
    })


@app.get("/health")
def health():
    return jsonify({"ok": True})




@app.post("/api/refresh-cache")
def api_refresh_cache():
    """Принудительное обновление кеша"""
    try:
        sheet_cache.force_refresh()
        return jsonify({
            "status": "success",
            "message": "Кеш обновлен успешно",
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            "status": "error", 
            "message": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500


@app.get("/api/debug/connection")
def api_debug_connection():
    """Проверка подключения к Google Sheets"""
    try:
        # Проверяем существование service account файла
        if not os.path.exists(SERVICE_ACCOUNT_FILE):
            return jsonify({
                "error": "Service account file not found",
                "file_path": SERVICE_ACCOUNT_FILE,
                "exists": False
            }), 500
        
        # Пытаемся создать клиента
        gc = _build_gspread_client()
        
        # Пытаемся открыть таблицу
        try:
            sh = gc.open_by_key(SPREADSHEET_ID)
            spreadsheet_title = sh.title
        except Exception as e:
            return jsonify({
                "error": "Cannot access spreadsheet",
                "spreadsheet_id": SPREADSHEET_ID,
                "details": str(e),
                "hint": "Проверьте что service account email имеет доступ к таблице"
            }), 500
        
        # Проверяем доступность листов
        worksheets = []
        selection_sheet = None
        texts_sheet = None
        
        try:
            for ws in sh.worksheets():
                worksheets.append(ws.title)
            
            selection_sheet = _get_worksheet_by_name_like(sh, SHEET_SELECTION)
            texts_sheet = _get_worksheet_by_name_like(sh, SHEET_TEXTS)
            
        except Exception as e:
            return jsonify({
                "error": "Cannot read worksheets",
                "details": str(e)
            }), 500
        
        # Проверяем заголовки листов
        selection_header = []
        texts_header = []
        
        if selection_sheet:
            try:
                selection_header = selection_sheet.row_values(1)
            except Exception as e:
                return jsonify({
                    "error": f"Cannot read {SHEET_SELECTION} header",
                    "details": str(e)
                }), 500
        
        if texts_sheet:
            try:
                texts_header = texts_sheet.row_values(1)
            except Exception as e:
                return jsonify({
                    "error": f"Cannot read {SHEET_TEXTS} header", 
                    "details": str(e)
                }), 500
        
        return jsonify({
            "status": "success",
            "spreadsheet_title": spreadsheet_title,
            "spreadsheet_id": SPREADSHEET_ID,
            "service_account_email": "sbert-16@sbertmodel.iam.gserviceaccount.com",
            "worksheets": worksheets,
            "selection_sheet_found": selection_sheet is not None,
            "selection_sheet_title": selection_sheet.title if selection_sheet else None,
            "selection_header": selection_header,
            "texts_sheet_found": texts_sheet is not None,
            "texts_sheet_title": texts_sheet.title if texts_sheet else None,
            "texts_header": texts_header,
            "column_mapping": {
                "fio": _find_column(selection_header, COLUMN_ALIASES["fio"]) if selection_header else None,
                "partner": _find_column(selection_header, COLUMN_ALIASES["partner"]) if selection_header else None,
                "name": _find_column(selection_header, COLUMN_ALIASES["name"]) if selection_header else None,
                "address": _find_column(selection_header, COLUMN_ALIASES["address"]) if selection_header else None,
                "city": _find_column(selection_header, COLUMN_ALIASES["city"]) if selection_header else None,
                "check_method": _find_column(selection_header, COLUMN_ALIASES["check_method"]) if selection_header else None,
                "wave": _find_column(selection_header, COLUMN_ALIASES["wave"]) if selection_header else None,
            }
        })
        
    except Exception as e:
        return jsonify({
            "error": "Unexpected error",
            "details": str(e),
            "trace": traceback.format_exc()
        }), 500


@app.get("/api/debug/assignments")
def api_debug_assignments():
    fio = request.args.get("fio", "").strip()
    normalized_fio = _normalize_string(fio)
    header = _read_sheet_header(SHEET_SELECTION)
    rows = _read_sheet_as_dicts(SHEET_SELECTION)

    col_fio = _find_column(header, COLUMN_ALIASES["fio"]) or ""
    col_partner = _find_column(header, COLUMN_ALIASES["partner"]) or "Партнер"
    col_name = _find_column(header, COLUMN_ALIASES["name"]) or "Ресторан"
    col_address = _find_column(header, COLUMN_ALIASES["address"]) or "Адрес"
    col_city = _find_column(header, COLUMN_ALIASES["city"]) or "Город"
    col_method = _find_column(header, COLUMN_ALIASES["check_method"]) or "Способ проверки"
    col_wave = _find_column(header, COLUMN_ALIASES["wave"]) or "№ волны"

    sample_rows = []
    debug_info = []
    
    for i, row in enumerate(rows):
        row_fio_value = str(row.get(col_fio, ""))
        row_normalized_fio = _normalize_string(row_fio_value)
        
        # Добавляем отладочную информацию для первых нескольких строк
        if i < 5:
            debug_info.append({
                "row_index": i,
                "raw_fio": row_fio_value,
                "normalized_fio": row_normalized_fio,
                "search_normalized_fio": normalized_fio,
                "matches": row_normalized_fio == normalized_fio,
                "col_fio_key": col_fio,
                "all_keys": list(row.keys())  # все ключи
            })
        
        if normalized_fio and row_normalized_fio != normalized_fio:
            continue
            
        sample_rows.append({
            "ФИО": row.get(col_fio),
            "Партнер": row.get(col_partner),
            "Название": row.get(col_name),
            "Адрес": row.get(col_address),
            "Город": row.get(col_city),
            "Способ проверки": row.get(col_method),
            "№ волны": row.get(col_wave),
        })
        if len(sample_rows) >= 10:
            break

    return jsonify({
        "header": header,
        "resolved_columns": {
            "fio": col_fio, "partner": col_partner, "name": col_name, "address": col_address,
            "city": col_city, "check_method": col_method, "wave": col_wave,
        },
        "rows_total": len(rows),
        "sample": sample_rows,
        "debug_info": debug_info,
        "search_params": {
            "original_fio": fio,
            "normalized_fio": normalized_fio
        }
    })


@app.get("/")
def root():
    # Отдать новую страницу
    return app.send_static_file("new_index.html")




if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)


