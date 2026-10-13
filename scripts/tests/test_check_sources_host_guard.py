#!/usr/bin/env python3
"""
sources-host-guard, ported from CoClerk's plugin-packager tests/test_sources_host_guard.py.

The data server's sources module is its only outbound network surface, and it runs
outside Cowork's egress allowlist. What it may contact is fixed by its own code:
https only, the shipped SOURCES_ALLOWED_HOSTS constant, and assertSourcesHost as the
first statement of every function that makes a request.

Every assertion takes the REAL source bundle, breaks exactly one invariant in an
in-memory copy, and requires the checker to notice. The bundle is never written to.

Run: python -m pytest -q scripts/tests/test_check_sources_host_guard.py
"""

import importlib.util
import os
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_plugin", os.path.join(SCRIPTS, "check_plugin.py"))
check_plugin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_plugin)

SERVER_JS = check_plugin.server_path(
    check_plugin.REPO, check_plugin.server_owner(check_plugin.REPO, "data"), "data", *check_plugin.DATA_BUNDLE)


class SourcesHostGuardTest(unittest.TestCase):
    """Each test breaks one invariant and asserts the checker catches it."""

    @classmethod
    def setUpClass(cls):
        if not os.path.isfile(SERVER_JS):
            raise unittest.SkipTest(f"{SERVER_JS} not built")
        with open(SERVER_JS, encoding="utf-8") as f:
            cls.clean = f.read()

    def assertCaught(self, broken, fragment):
        """The mutated bundle must produce a violation naming `fragment`."""
        hits = check_plugin.sources_host_guard_violations(broken)
        self.assertTrue(hits, "checker reported NO violation for a broken bundle")
        self.assertTrue(
            any(fragment in h for h in hits),
            f"expected a violation mentioning {fragment!r}, got {hits!r}")

    def mutate(self, old, new):
        """Replace `old`, asserting it occurs exactly once so the break is unambiguous."""
        self.assertEqual(1, self.clean.count(old), f"fixture anchor {old!r} is not unique in the bundle")
        return self.clean.replace(old, new)

    # -- baseline ----------------------------------------------------------

    def test_the_shipped_bundle_is_clean(self):
        """Guards against the check passing only because the bundle drifted."""
        self.assertEqual([], check_plugin.sources_host_guard_violations(self.clean))

    # -- the guard runs before every request ---------------------------------

    def test_removing_the_guard_before_the_request_is_caught(self):
        self.assertCaught(
            self.mutate("function requestSource(url, allowed, transport) {\n  assertSourcesHost(url, allowed);\n",
                        "function requestSource(url, allowed, transport) {\n"),
            "in requestSource is not preceded by assertSourcesHost")

    def test_a_second_unguarded_request_function_is_caught(self):
        self.assertCaught(
            self.mutate("var HTTPS_TRANSPORT = { request: https.request };",
                        "var HTTPS_TRANSPORT = { request: https.request };\n"
                        "function sneak(url) {\n  return https.request(url);\n}"),
            "in sneak is not preceded by assertSourcesHost")

    def test_a_request_at_module_scope_is_caught(self):
        self.assertCaught(
            self.mutate("var HTTPS_TRANSPORT = { request: https.request };",
                        "var HTTPS_TRANSPORT = { request: https.request };\n"
                        'var probe = fetch("https://example.com/");'),
            "in module scope is not preceded by assertSourcesHost")

    def test_renaming_the_request_site_fails_rather_than_passing_vacuously(self):
        self.assertCaught(
            self.mutate("transport.request(", "transport.send("),
            "no request site found")

    # -- the guard itself ---------------------------------------------------

    def test_renaming_the_guard_is_caught(self):
        self.assertCaught(
            self.mutate("function assertSourcesHost(url, allowed)",
                        "function assertSourcesHostDisabled(url, allowed)"),
            "assertSourcesHost guard is missing")

    def test_a_guard_that_admits_plain_http_is_caught(self):
        self.assertCaught(
            self.mutate('url.protocol !== "https:"', "false"),
            "no longer refuses a non-https URL")

    def test_a_guard_that_admits_any_host_is_caught(self):
        self.assertCaught(
            self.mutate("!allowed.includes(url.hostname)", "false"),
            "no longer refuses a host outside the allowed list")

    def test_a_plain_http_transport_is_caught(self):
        """An https URL carried over plain http would pass the guard and still leak."""
        self.assertCaught(
            self.mutate("{ request: https.request }", "{ request: http.request }"),
            "plain node:http")

    # -- the shipped constant -------------------------------------------------

    def test_an_extra_shipped_host_is_caught(self):
        self.assertCaught(
            self.mutate('SOURCES_ALLOWED_HOSTS = ["www.bclaws.gov.bc.ca"',
                        'SOURCES_ALLOWED_HOSTS = ["evil.example", "www.bclaws.gov.bc.ca"'),
            "SOURCES_ALLOWED_HOSTS is")

    def test_a_fetcher_built_from_a_widened_host_list_is_caught(self):
        self.assertCaught(
            self.mutate("createSourceFetcher(() => SOURCES_ALLOWED_HOSTS,",
                        'createSourceFetcher(() => [...SOURCES_ALLOWED_HOSTS, "evil.example"],'),
            "sourcesFetcher is not created from SOURCES_ALLOWED_HOSTS unmodified")

    def test_a_second_fetcher_call_site_is_caught(self):
        self.assertCaught(
            self.mutate("var HTTPS_TRANSPORT = { request: https.request };",
                        "var HTTPS_TRANSPORT = { request: https.request };\n"
                        'var sneakFetcher = createSourceFetcher(() => ["evil.example"], HTTPS_TRANSPORT);'),
            "createSourceFetcher( is called 2 times")

    def test_renaming_the_constant_fails_rather_than_passing_vacuously(self):
        self.assertCaught(
            self.mutate('SOURCES_ALLOWED_HOSTS = ["www.bclaws.gov.bc.ca"',
                        'SOURCE_HOSTS = ["www.bclaws.gov.bc.ca"'),
            "SOURCES_ALLOWED_HOSTS literal not found")

    def test_a_bundle_without_the_sources_module_is_caught(self):
        broken = self.clean.replace("// src/sources/", "// src/elsewhere/")
        self.assertNotEqual(broken, self.clean, "fixture anchor is no longer in the bundle")
        self.assertCaught(broken, "not in the bundle")


if __name__ == "__main__":
    unittest.main()
