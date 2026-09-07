import json
from urllib import parse, request
from urllib.error import HTTPError, URLError

from django.conf import settings


GRAPH_BASE_URL = 'https://graph.facebook.com'
DEFAULT_TIMEOUT = 15


class MetaApiError(Exception):
    def __init__(self, message='Meta не завершила подключение WhatsApp.', *, code=None, status_code=502):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


def _graph_url(path, query=None):
    version = getattr(settings, 'META_GRAPH_API_VERSION', 'v20.0')
    clean_path = str(path).lstrip('/')
    url = f'{GRAPH_BASE_URL}/{version}/{clean_path}'
    if query:
        url = f'{url}?{parse.urlencode(query)}'
    return url


def _safe_error_payload(raw):
    try:
        payload = json.loads(raw.decode('utf-8') if isinstance(raw, bytes) else raw)
    except Exception:
        return None, None
    error = payload.get('error') if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return None, None
    return error.get('message'), error.get('code')


def _request_json(path, *, method='GET', data=None, query=None, access_token=None):
    encoded_data = None
    headers = {'Accept': 'application/json'}
    if data is not None:
        encoded_data = parse.urlencode(data).encode('utf-8')
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    if access_token:
        headers['Authorization'] = f'Bearer {access_token}'
    graph_request = request.Request(
        _graph_url(path, query=query),
        data=encoded_data,
        method=method,
        headers=headers,
    )
    try:
        with request.urlopen(graph_request, timeout=DEFAULT_TIMEOUT) as response:
            raw = response.read()
    except HTTPError as error:
        raw = error.read()
        _message, code = _safe_error_payload(raw)
        raise MetaApiError(code=code, status_code=error.code) from error
    except URLError as error:
        raise MetaApiError() from error

    if not raw:
        return {}
    try:
        return json.loads(raw.decode('utf-8'))
    except ValueError as error:
        raise MetaApiError() from error


def exchange_embedded_signup_code(code):
    payload = _request_json(
        'oauth/access_token',
        data={
            'client_id': getattr(settings, 'META_APP_ID', ''),
            'client_secret': getattr(settings, 'META_APP_SECRET', ''),
            'code': code,
        },
    )
    access_token = payload.get('access_token')
    if not access_token:
        raise MetaApiError(status_code=502)
    return access_token


def subscribe_whatsapp_app(waba_id, access_token):
    try:
        return _request_json(f'{waba_id}/subscribed_apps', method='POST', data={}, access_token=access_token)
    except MetaApiError as error:
        # Meta normally treats repeated subscription as idempotent. Some Graph
        # responses still return an "already subscribed" error; do not block
        # onboarding in that case and never surface token-bearing payloads.
        if 'already' in str(error).lower():
            return {'success': True}
        raise


def get_whatsapp_phone_numbers(waba_id, access_token):
    payload = _request_json(
        f'{waba_id}/phone_numbers',
        query={'fields': 'id,display_phone_number,verified_name'},
        access_token=access_token,
    )
    return payload.get('data') if isinstance(payload.get('data'), list) else []


def get_whatsapp_phone_number(phone_number_id, access_token):
    return _request_json(
        str(phone_number_id),
        query={'fields': 'id,display_phone_number,verified_name'},
        access_token=access_token,
    )
