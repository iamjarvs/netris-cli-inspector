"""
Minimal Netris controller API client.

Handles cookie-based session auth (either a pre-captured `connect.sid` token,
or a username/password login against /api/auth) and wraps GET/POST/PUT/DELETE
against both the v1 (/api/...) and v2 (/api/v2/...) surfaces on the same host
-- plus the one v2 resource (/vpc-peering) that isn't versioned at all. Pass
the path exactly as it appears in the spec ("/api/v2/sites", "/api/sites",
"/vpc-peering") and this client doesn't need to know which version it is.

Netris wraps most CRUD responses in an envelope:
    {"data": ..., "isSuccess": bool, "message": str, "errors": {...}, "meta": {...}}
but a number of simpler/legacy endpoints return bare JSON with no envelope at
all (see references/index.md). This client returns the parsed JSON body
as-is on success and only raises when the HTTP status is an error OR an
envelope is present with isSuccess: false -- callers still need to know the
specific endpoint's response shape before indexing into it.

Usage:
    from netris_client import NetrisClient

    client = NetrisClient("https://netris.example.com", token="s%3Aabc123...")
    # or: client = NetrisClient(host, username="admin", password="...")

    sites = client.get("/api/v2/sites")["data"]
    for hw in client.paginate("/api/v2/hw", params={"type": "switch"}):
        print(hw["name"], hw["mainAddress"])
"""
from __future__ import annotations

from typing import Any, Iterator, Optional

import requests


class NetrisAPIError(RuntimeError):
    """Raised for both HTTP-level errors and isSuccess: false envelopes."""

    def __init__(
        self,
        message: str,
        status_code: int,
        errors: Optional[dict] = None,
        payload: Any = None,
    ):
        super().__init__(f"[{status_code}] {message}")
        self.status_code = status_code
        self.errors = errors or {}
        self.payload = payload


class NetrisClient:
    def __init__(
        self,
        host: str,
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        auth_scheme_id: Optional[int] = None,
        verify: bool = True,
        timeout: float = 30.0,
    ):
        """
        host: e.g. "https://netris.example.com" (no trailing slash needed).
        token: a captured `connect.sid` cookie value -- skips the login call.
        username/password: used to log in via POST /api/auth if no token is given.
        auth_scheme_id: only needed if the deployment has more than one
            configured auth scheme (see GET /api/auth-schemes) and the
            default isn't the one you want.
        verify: set False for self-signed lab certs.
        """
        self.host = host.rstrip("/")
        self.session = requests.Session()
        self.session.verify = verify
        self.timeout = timeout

        if token:
            self.session.cookies.set("connect.sid", token)
        elif username and password:
            self.login(username, password, auth_scheme_id)
        else:
            raise ValueError("Provide either token=, or username=+password=.")

    def login(
        self, username: str, password: str, auth_scheme_id: Optional[int] = None
    ) -> None:
        """Authenticate against POST /api/auth and capture the connect.sid cookie."""
        body = {"user": username, "password": password}
        if auth_scheme_id is not None:
            body["authSchemeID"] = auth_scheme_id
        resp = self.session.post(
            f"{self.host}/api/auth", json=body, timeout=self.timeout
        )
        if resp.status_code != 200 or "connect.sid" not in self.session.cookies.get_dict():
            raise NetrisAPIError(
                f"Login failed for user {username!r}",
                resp.status_code,
                payload=self._safe_json(resp),
            )

    @staticmethod
    def _safe_json(resp: requests.Response) -> Any:
        try:
            return resp.json()
        except ValueError:
            return resp.text

    def request(self, method: str, path: str, **kwargs) -> Any:
        """
        Low-level call. `path` should include whatever prefix the spec shows
        for that endpoint -- "/api/v2/sites", "/api/sites", or the unversioned
        "/vpc-peering". Extra kwargs (params=, json=, ...) pass straight
        through to requests.
        """
        url = f"{self.host}{path}"
        resp = self.session.request(method, url, timeout=self.timeout, **kwargs)
        body = self._safe_json(resp)

        if not resp.ok:
            message = body.get("message") if isinstance(body, dict) else str(body)
            errors = body.get("errors") if isinstance(body, dict) else None
            raise NetrisAPIError(message or resp.reason, resp.status_code, errors, body)

        if isinstance(body, dict) and body.get("isSuccess") is False:
            raise NetrisAPIError(
                body.get("message", "Request reported isSuccess: false"),
                resp.status_code,
                body.get("errors"),
                body,
            )
        return body

    def get(self, path: str, params: Optional[dict] = None) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, json_body: Optional[dict] = None) -> Any:
        return self.request("POST", path, json=json_body)

    def put(self, path: str, json_body: Optional[dict] = None) -> Any:
        return self.request("PUT", path, json=json_body)

    def delete(
        self,
        path: str,
        json_body: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> Any:
        return self.request("DELETE", path, json=json_body, params=params)

    def paginate(
        self,
        path: str,
        params: Optional[dict] = None,
        page_param: str = "page",
        limit_param: str = "limit",
        page_size: int = 50,
        data_key: str = "data",
    ) -> Iterator[Any]:
        """
        Generic pager for page/limit-style v2 list endpoints. Field names
        for page/limit aren't fully consistent across the API (some also
        accept pageSize, or sortOrder instead of order) -- check
        references/index.md and the specific endpoint before assuming
        page_param="page", limit_param="limit" is right, and override them
        if not. Stops when a page comes back with fewer than page_size items.
        """
        params = dict(params or {})
        page = 1
        while True:
            params[page_param] = page
            params[limit_param] = page_size
            body = self.get(path, params=params)
            items = body.get(data_key, []) if isinstance(body, dict) else body
            if not items:
                return
            yield from items
            if len(items) < page_size:
                return
            page += 1
