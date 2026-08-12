"""
SSRF guard (P3.1.4). Every case here is a published bypass.

The IP-range layer is tested SEPARATELY from the host allowlist, because the
allowlist happens to catch all the obvious payloads on its own — which would
leave the layer that actually matters under DNS rebinding unproven.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.ssrf_guard import SsrfBlocked, _is_public_ip, validate_url  # noqa: E402


@pytest.mark.parametrize("url", [
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://169.254.169.254/latest/meta-data/",
    "https://2130706433/x",
    "https://0x7f000001/x",
    "https://127.1/x",
    "https://[::ffff:127.0.0.1]/x",
    "file:///etc/passwd",
    "gopher://evil/x",
    "http://naukri.com/x",
    "https://naukri.com@evil.com/x",
    "https://naukri.com.evil.com/x",
    "https://evilnaukri.com/x",
    "https://example.com/job/1",
])
def test_blocks_unsafe_urls(url):
    with pytest.raises(SsrfBlocked):
        validate_url(url)


@pytest.mark.parametrize("url", [
    "https://www.naukri.com/job-listings-abc",
    "https://remoteok.com/remote-jobs/1",
    "https://boards.greenhouse.io/acme/jobs/1",
])
def test_allows_allowlisted_boards(url):
    host, ip = validate_url(url)
    assert host and ip


@pytest.mark.parametrize("ip,public", [
    ("127.0.0.1", False), ("::1", False), ("169.254.169.254", False),
    ("10.0.0.1", False), ("172.16.0.1", False), ("192.168.1.1", False),
    ("0.0.0.0", False), ("::ffff:127.0.0.1", False), ("fd00::1", False),
    ("100.64.0.1", False),
    ("8.8.8.8", True), ("1.1.1.1", True), ("2606:4700:4700::1111", True),
])
def test_ip_range_layer(ip, public):
    assert _is_public_ip(ip) is public


def test_ip_layer_works_even_when_the_host_is_allowlisted():
    """
    EC-P3-16 — the rebinding shape. If a permitted name resolves privately, the
    IP check is the only thing left. The allowlist masks this in every other
    test, so it is exercised explicitly here.
    """
    with pytest.raises(SsrfBlocked, match="non-public"):
        validate_url("https://localhost/x", allowed_hosts=frozenset({"localhost"}))
