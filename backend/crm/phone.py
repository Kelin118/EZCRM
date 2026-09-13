def normalize_kz_phone(value):
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if len(digits) == 11 and digits.startswith('8'):
        return f'7{digits[1:]}'
    if len(digits) == 10:
        return f'7{digits}'
    if len(digits) == 11 and digits.startswith('7'):
        return digits
    return ''
