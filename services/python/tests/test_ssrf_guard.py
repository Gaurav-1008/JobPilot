"""
SSRF guard (P3.1.4). Every case here is a published bypass.

The IP-range layer is tested SEPARATELY from the host allowlist, because the
allowlist happens to catch all the obvious payloads on its own — which would
leave the layer that actually matters under DNS rebinding unproven.

─────────────────────────────────────────────────────────────────────────────
DNS IS STUBBED, DELIBERATELY.

`validate_url` resolves the hostname, so the happy-path cases used to perform
live `getaddrinfo` calls against naukri.com and greenhouse.io. That made a
security suite depend on the network: it failed on a slow DNS day, took ten
seconds to do it, and would break CI for reasons having nothing to do with the
code. architecture.md §19 already says recorded fixtures, never live sites in
CI — the rule was written for board adapters, but it applies with more force
here, because a flaky security test is one people learn to re-run rather than
read.

Stubbing costs nothing in coverage and buys three branches that were previously
untestable, all of them security-relevant:

  - a name with BOTH a public and a private A record must be rejected, not
    load-balanced into (the guard checks every address; nothing proved it)
  - an empty DNS answer must block
  - a resolver failure must block rather than fall through

The one thing a stub cannot check is that the real `getaddrinfo` call is shaped
correctly. `test_live_dns_integration` covers that and is opt-in via
JOBPILOT_LIVE_DNS=1, so the signature stays honest without CI depending on it.
─────────────────────────────────────────────────────────────────────────────
"""

import os
import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.ssrf_guard import SsrfBlocked, _is_public_ip, validate_url  # noqa: E402


def _addrinfo(ip: str, port: int = 443):
    """One getaddrinfo 5-tuple. The guard reads `info[4][0]`."""
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    sockaddr = (ip, port, 0, 0) if family == socket.AF_INET6 else (ip, port)
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)


@pytest.fixture(name="resolves_to")
def _resolves_to(monkeypatch):
    """
    Point DNS at whatever addresses a test needs.

    Patches `socket.getaddrinfo` rather than injecting a resolver into the
    guard: the production call stays exactly as it ships, so the test cannot
    pass against a seam that only exists for tests.
    """

    def install(*ips: str, error: Exception | None = None):
        def fake(host, port=None, *args, **kwargs):
            if error is not None:
                raise error
            return [_addrinfo(ip, port or 443) for ip in ips]

        monkeypatch.setattr(socket, "getaddrinfo", fake)

    return install


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
    # Every one of these is refused on scheme or allowlist, BEFORE any
    # resolution — so this test needs no DNS at all, stubbed or otherwise.
    with pytest.raises(SsrfBlocked):
        validate_url(url)


@pytest.mark.parametrize("url", [
    "https://www.naukri.com/job-listings-abc",
    "https://remoteok.com/remote-jobs/1",
    "https://boards.greenhouse.io/acme/jobs/1",
])
def test_allows_allowlisted_boards(url, resolves_to):
    resolves_to("93.184.216.34")
    host, ip = validate_url(url)
    assert host and ip == "93.184.216.34"


@pytest.mark.parametrize("ip,public", [
    ("127.0.0.1", False), ("::1", False), ("169.254.169.254", False),
    ("10.0.0.1", False), ("172.16.0.1", False), ("192.168.1.1", False),
    ("0.0.0.0", False), ("::ffff:127.0.0.1", False), ("fd00::1", False),
    ("100.64.0.1", False),
    ("8.8.8.8", True), ("1.1.1.1", True), ("2606:4700:4700::1111", True),
])
def test_ip_range_layer(ip, public):
    assert _is_public_ip(ip) is public


def test_ip_layer_works_even_when_the_host_is_allowlisted(resolves_to):
    """
    EC-P3-16 — the rebinding shape. If a permitted name resolves privately, the
    IP check is the only thing left. The allowlist masks this in every other
    test, so it is exercised explicitly here.

    Stubbing makes this a true rebinding simulation: an ALLOWLISTED board name that
    answers with loopback, which is precisely the attack. Previously it leaned
    on "localhost" being in /etc/hosts, which tested the same branch by
    accident rather than by design.
    """
    resolves_to("127.0.0.1")
    with pytest.raises(SsrfBlocked, match="non-public"):
        validate_url("https://www.naukri.com/x")


@pytest.mark.parametrize("ips", [
    # The private address must be caught wherever it lands in the answer.
    # ORDER IS THE WHOLE POINT: "1.1.1.1" sorts BEFORE "192.168.1.1", so an
    # implementation that inspects only the first address would wave this
    # through. The reverse pair is included so the test cannot pass by accident
    # if the ordering or the sort ever changes.
    ("1.1.1.1", "192.168.1.1"),
    ("192.168.1.1", "1.1.1.1"),
    ("8.8.8.8", "127.0.0.1"),
    ("93.184.216.34", "10.0.0.5"),
])
def test_rejects_a_name_with_one_public_and_one_private_record(ips, resolves_to):
    """
    The guard checks EVERY resolved address, and this is what that is for: a
    name answering with both a routable and a private address must be refused
    outright, never load-balanced into. Nothing proved this before, because
    real DNS does not hand out mixed answers on demand.

    Verified by mutation — rewriting the guard to check only `sorted(ips)[0]`
    fails this test. An earlier version of it used a pair where the private
    address happened to sort first, and that version passed against the broken
    guard, proving nothing.
    """
    resolves_to(*ips)
    with pytest.raises(SsrfBlocked, match="non-public"):
        validate_url("https://www.naukri.com/x")


def test_rejects_a_name_that_resolves_to_cloud_metadata(resolves_to):
    # The payload that turns SSRF into credential theft (EC-P3-09).
    resolves_to("169.254.169.254")
    with pytest.raises(SsrfBlocked, match="non-public"):
        validate_url("https://www.naukri.com/x")


def test_blocks_when_dns_returns_nothing(resolves_to):
    resolves_to()
    with pytest.raises(SsrfBlocked, match="no addresses"):
        validate_url("https://www.naukri.com/x")


def test_blocks_when_the_resolver_fails(resolves_to):
    # Fail closed: a resolver outage must never become an unchecked fetch.
    resolves_to(error=socket.gaierror("temporary failure"))
    with pytest.raises(SsrfBlocked, match="dns resolution failed"):
        validate_url("https://www.naukri.com/x")


def test_returns_a_deterministic_ip_from_a_multi_record_answer(resolves_to):
    """
    The caller connects to the RETURNED ip, so the pick must not vary between
    the address that was validated and the one that gets dialled.
    """
    resolves_to("93.184.216.34", "8.8.8.8", "1.1.1.1")
    _, first = validate_url("https://www.naukri.com/x")
    _, second = validate_url("https://www.naukri.com/x")
    assert first == second == "1.1.1.1"   # sorted(ips)[0]


@pytest.mark.skipif(
    not os.getenv("JOBPILOT_LIVE_DNS"),
    reason="live DNS; opt in with JOBPILOT_LIVE_DNS=1 (never in CI)",
)
def test_live_dns_integration():
    """
    The one thing the stubs cannot check: that the real `getaddrinfo` call is
    shaped correctly. A wrong argument order or keyword would pass every
    stubbed test above and fail in production on the first manual-paste URL.

    Opt-in, so CI never depends on a third party's nameservers.
    """
    host, ip = validate_url("https://remoteok.com/remote-jobs/1")
    assert host == "remoteok.com"
    assert _is_public_ip(ip)
