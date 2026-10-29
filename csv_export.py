"""Spreadsheet-safe presentation of user text; stored evidence stays unchanged."""
import re


def spreadsheet_cell(value):
    # CSV quoting alone does not stop spreadsheet formula evaluation. Protect
    # leading controls and formulas hidden behind whitespace, including the
    # full-width operators accepted by some spreadsheet locales.
    if isinstance(value, str) and (value.startswith(('\t', '\r', '\n')) or
                                  re.match(r'^[\s\ufeff]*[=+\-@＝＋－＠]', value)):
        return "'" + value
    return value
