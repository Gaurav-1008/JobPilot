"""
SSRF guard (P3.1.4) — architecture.md §11.5.

THE THREAT. Hydration fetches a URL. Most arrive from our own scrapers, but
`POST /api/jobs/manual` (P2.3.8) lets any authenticated user hand the server an
arbitrary URL to fetch **from inside our network**. Without this module the
fetcher is a general-purpose SSRF primitive: cloud instance metadata, internal
admin panels, Redis, Postgres — anything reachable from the worker.

THE ONE RULE THAT MATTERS. Reason about RESOLVED IP ADDRESSES, never about URL
strings. Every string-level blocklist has published bypasses, and new encodings
keep arriving (EC-P3-10). The shape that holds is:

    parse -> scheme allowlist -> host allowlist -> RESOLVE
          -> check every resolved IP -> connect TO THAT IP
          -> re-validate on EVERY redirect hop

EC-P3-16 (DNS rebinding) is why the last two steps matter: a name that resolves
to a public IP during validation can resolve to 127.0.0.1 microseconds later on
connect. Validating and then handing the *hostname* to an HTTP client re-resolves
and loses the guarantee.
"""

from __future__ import annotations

import ipaddress
import socket
import urllib.parse

# EC-P3-11: an ALLOWLIST. A blocklist of file://, gopher://, ftp:// forgets the
# next scheme someone finds.
ALLOWED_SCHEMES = frozenset({"https"})

# Hosts we will fetch job descriptions from. Extended when a board is added, or
# by a user confirming a company careers domain.
DEFAULT_ALLOWED_HOSTS = frozenset({
    "naukri.com",
    "remoteok.com",
    "wellfound.com",
    "angel.co",          # wellfound's former domain, still redirects here
    "lever.co",
    "greenhouse.io",
    "ashbyhq.com",
    "workable.com",
})

MAX_REDIRECTS = 3
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
CONNECT_TIMEOUT_SEC = 10.0
TOTAL_TIMEOUT_SEC = 30.0


class SsrfBlocked(Exception):
    """The URL is not safe to fetch. Callers report `blocked`, never retry."""


def _is_public_ip(ip_str: str) -> bool:
    """
    EC-P3-08/09/10 — parse to an IP OBJECT and ask the stdlib.

    This is what makes decimal (2130706433), hex (0x7f000001), octal, short
    (127.1), IPv6-mapped (::ffff:127.0.0.1), and every future encoding fall out
    for free: they are all the same address once parsed, and none of them are
    global.
    """
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False

    # `is_global` already excludes private, loopback, link-local, multicast,
    # reserved and unspecified ranges. 169.254.169.254 — cloud instance
    # metadata, the payload that turns SSRF into credential theft (EC-P3-09) —
    # is link-local, so it is covered here rather than by a special case.
    if not ip.is_global:
        return False

    # IPv4-mapped IPv6 (::ffff:127.0.0.1) reports is_global on some versions.
    # Unwrap and re-check rather than trusting it.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped.is_global

    return True


def _host_allowed(host: str, allowed: frozenset[str]) -> bool:
    """
    EC-P3-15 — exact host, or a proper subdomain boundary. NEVER `in`.

    `"naukri.com" in "naukri.com.evil.com"` is True, which is how suffix checks
    get bypassed.

    EC-P3-17 — the host is compared in its punycode (IDNA) form, so a Cyrillic
    homograph does not slip past an ASCII comparison.
    """
    host = host.lower().rstrip(".")
    try:
        host = host.encode("idna").decode("ascii").lower()
    except (UnicodeError, UnicodeDecodeError):
        return False

    return any(host == d or host.endswith(f".{d}") for d in allowed)


def validate_url(
    url: str,
    allowed_hosts: frozenset[str] = DEFAULT_ALLOWED_HOSTS,
) -> tuple[str, str]:
    """
    Validate a single URL and return ``(hostname, resolved_ip)``.

    The caller must connect to the RETURNED IP with the hostname in the Host
    header — not re-resolve the name — or EC-P3-16 reopens.

    Raises :class:`SsrfBlocked` for anything unsafe.
    """
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError as exc:
        raise SsrfBlocked(f"unparseable url: {exc}") from exc

    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise SsrfBlocked(f"scheme not allowed: {parts.scheme!r}")

    # EC-P3-14 — read the parsed HOST, never regex the string. In
    # `https://naukri.com@evil.com/`, "naukri.com" is userinfo and the real host
    # is evil.com. urlsplit gets this right; substring matching does not.
    host = parts.hostname
    if not host:
        raise SsrfBlocked("no host in url")

    if parts.username or parts.password:
        # Credentials in a job-description URL have no legitimate purpose here,
        # and they are the classic vehicle for the confusion above.
        raise SsrfBlocked("credentials in url")

    if not _host_allowed(host, allowed_hosts):
        raise SsrfBlocked(f"host not in allowlist: {host}")

    # Resolve and check EVERY address the name maps to. A name with one public
    # and one private A record must be rejected, not load-balanced into.
    try:
        infos = socket.getaddrinfo(host, parts.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SsrfBlocked(f"dns resolution failed: {exc}") from exc

    ips = {info[4][0] for info in infos}
    if not ips:
        raise SsrfBlocked("dns returned no addresses")

    for ip in ips:
        if not _is_public_ip(ip):
            raise SsrfBlocked(f"resolves to a non-public address: {ip}")

    # Deterministic pick so the connection target matches what we validated.
    return host, sorted(ips)[0]


def validate_redirect_chain(
    url: str,
    allowed_hosts: frozenset[str] = DEFAULT_ALLOWED_HOSTS,
) -> None:
    """
    Validate a redirect target.

    EC-P3-12 — this must be called on EVERY hop, not only the initial URL.
    Validating only the first is the single most common SSRF bypass: an
    allowlisted host happily 302s to http://169.254.169.254/.

    EC-P3-13 — hop counting is the caller's job; cap at MAX_REDIRECTS.
    """
    validate_url(url, allowed_hosts)
