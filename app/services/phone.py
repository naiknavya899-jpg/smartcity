import re


def normalize_indian_mobile(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip()
    if not re.fullmatch(r"[+\d\s().-]+", value):
        raise ValueError("Enter a valid Indian mobile number")

    digits = re.sub(r"\D", "", value)
    if digits.startswith("0091"):
        digits = digits[4:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]

    if len(digits) != 10 or digits[0] not in "6789":
        raise ValueError("Enter a valid Indian mobile number")
    return f"91{digits}"
