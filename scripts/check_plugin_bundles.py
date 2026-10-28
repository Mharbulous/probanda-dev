"""Checks on the built server bundles, for check_plugin.py: purity, the sources host guard,
host paths and the schema ceiling."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plugin_layout  # noqa: E402
from check_plugin_sources import HOST_PATH, WORKTREE_PATH, NotApplicable, skills_root, server_path  # noqa: E402

# The hosts the data server's sources module ships with (mcp/src/sources/hosts.ts).
# A host is added here in the same change that adds it to that constant.
SOURCES_ALLOWED_HOSTS = ["www.bclaws.gov.bc.ca", "bclaws.gov.bc.ca", "vaniac.org", "laws-lois.justice.gc.ca"]
# A module's code in an esbuild bundle runs from its `// src/...` marker line to the
# next module marker; every `src/sources/` stretch is collected.
_BUNDLE_MODULE = re.compile(
    r"^// (\S+\.(?:ts|js|mjs|cjs))\n(.*?)(?=^// \S+\.(?:ts|js|mjs|cjs)\n|\Z)", re.M | re.S)
_SOURCES_NETWORK_CALL = re.compile(r"\b(?:https?\d*|transport)\.(?:request|get)\(|\bfetch\(")
_TOP_LEVEL_FUNCTION = re.compile(r"^(?:async )?function (\w+)\([^)]*\)\s*\{", re.M)

# The data server's bundle, inside that server's folder.
DATA_BUNDLE = ("dist", "litigation-mcp.js")
# The servers with `purity` in plugin_layout.SERVERS have their bundles checked for
# Supabase and the commons tool namespace. commons is exempt: it is the plugins'
# Supabase surface. canlii, files, timecamp and contacts-calendars-email must carry neither
# 'supabase' nor 'legal_commons__'. data may carry 'supabase', because its practice writes
# go to Probanda's Cloud, but only through the three items functions and the two
# key-request functions that let a practitioner ask for Probanda's key (Brahm,
# 2026-10-20), and the four suggestion functions through which it sends what a
# practitioner submits on a suggestion card (Brahm, 2026-10-26; lifecycle plan open
# decision 5): every 'functions/v1/' path in it must be items-write, items-sync,
# items-seed, key-request-submit, key-request-status, suggestion-submit,
# suggestion-status, suggestion-withdraw or suggestion-attach-specification, and it
# must carry no other functions path, no '/rest/v1/' and no 'legal_commons__'. So the data
# bundle is not checked for any other Supabase use, such as a Supabase client library.
DATA_FUNCTION_PATHS = ("functions/v1/items-write", "functions/v1/items-sync", "functions/v1/items-seed",
                       "functions/v1/key-request-submit", "functions/v1/key-request-status",
                       "functions/v1/suggestion-submit", "functions/v1/suggestion-status",
                       "functions/v1/suggestion-withdraw", "functions/v1/suggestion-attach-specification")
_FUNCTIONS_PATH = re.compile(r"functions/v1/[a-z0-9_-]*")


# --- sources-host-guard --------------------------------------------------------------------

def sources_host_guard_violations(bundle):
    """Every broken outbound-fetch invariant of the built data server, asserted on the
    bundle TEXT, name-exact: the shipped host constant, the guard with both refusal
    conditions, and the guard as the first statement of every function in the
    sources module that makes a request."""
    hits = []
    region = "\n".join(body for path, body in _BUNDLE_MODULE.findall(bundle)
                       if path.startswith("src/sources/"))
    if not region:
        return ["the sources module (src/sources/) is not in the bundle"]

    m = re.search(r"\bSOURCES_ALLOWED_HOSTS\s*=\s*\[([^\]]*)\]", region)
    if not m:
        hits.append("SOURCES_ALLOWED_HOSTS literal not found in the sources module")
    else:
        hosts = [h.strip().strip('"\'') for h in m.group(1).split(",") if h.strip()]
        if hosts != SOURCES_ALLOWED_HOSTS:
            hits.append(f"SOURCES_ALLOWED_HOSTS is {hosts}, expected {SOURCES_ALLOWED_HOSTS}")

    # The production fetcher is built from the constant unmodified, and it is the only
    # fetcher built: a second createSourceFetcher( call could pass any host list.
    if not re.search(r"\bsourcesFetcher = createSourceFetcher\(\(\) => SOURCES_ALLOWED_HOSTS, ", region):
        hits.append("sourcesFetcher is not created from SOURCES_ALLOWED_HOSTS unmodified")
    calls = len(re.findall(r"(?<!function )\bcreateSourceFetcher\(", region))
    if calls != 1:
        hits.append(f"createSourceFetcher( is called {calls} times in the sources module, expected once (sourcesFetcher)")

    # Name-exact, so `function assertSourcesHostDisabled` cannot satisfy it, and both
    # refusals must survive.
    if not re.search(r"\bfunction assertSourcesHost\s*\(", region):
        hits.append("assertSourcesHost guard is missing from the sources module")
    if 'url.protocol !== "https:"' not in region:
        hits.append("assertSourcesHost no longer refuses a non-https URL")
    if "!allowed.includes(url.hostname)" not in region:
        hits.append("assertSourcesHost no longer refuses a host outside the allowed list")

    # Every request site must sit in a function whose first statement is the guard. A
    # module with no request site at all fails too, so a rename cannot pass vacuously.
    functions = [(fm.start(), fm.group(1), fm.end()) for fm in _TOP_LEVEL_FUNCTION.finditer(region)]
    sites = list(_SOURCES_NETWORK_CALL.finditer(region))
    if not sites:
        hits.append("no request site found in the sources module")
    for site in sites:
        name, guarded = None, False
        enclosing = [f for f in functions if f[0] < site.start()]
        # esbuild closes a top-level function with `}` in column 0.
        if enclosing and "\n}\n" not in region[enclosing[-1][2]:site.start()]:
            name = enclosing[-1][1]
            guarded = bool(re.match(r"\s*assertSourcesHost\(", region[enclosing[-1][2]:]))
        if not guarded:
            hits.append(f"{site.group(0)!r} in {name or 'module scope'} is not preceded by assertSourcesHost")

    # https only, down to the transport: plain node:http must never carry a request.
    if 'from "node:http"' in region or re.search(r"\bhttp\d*\.(?:request|get)\b", region):
        hits.append("the sources module can make a request over plain node:http")

    return hits


def bundle_purity_hits(server, text):
    """The purity tokens one server's bundle text carries (see DATA_FUNCTION_PATHS)."""
    lowered = text.lower()
    if server != "data":
        return [token for token in ("supabase", "legal_commons__") if token in lowered]
    hits = [token for token in ("/rest/v1/", "legal_commons__") if token in lowered]
    hits += sorted({path for path in _FUNCTIONS_PATH.findall(lowered) if path not in DATA_FUNCTION_PATHS})
    return hits


def check_bundle_purity(repo, plugin):
    servers = [s for s in plugin_layout.SERVERS if plugin_layout.SERVERS[s]["purity"] and s in plugin["servers"]]
    if not servers:
        raise NotApplicable(f"{plugin['name']} ships neither the data nor the canlii server")
    purity_hits = []
    found_any_bundle = False
    for server in servers:
        dist_rel = plugin_layout.SERVER_DIRS[server]
        dist = server_path(repo, plugin, server, "dist")
        if not os.path.isdir(dist):
            continue
        blob = ""
        for fn in sorted(os.listdir(dist)):
            if fn.endswith(".js"):
                with open(os.path.join(dist, fn), encoding="utf-8") as f:
                    blob += f.read()
        if not blob:
            continue
        found_any_bundle = True
        purity_hits.extend(f"{dist_rel}/dist: {hit}" for hit in bundle_purity_hits(server, blob))
    if not found_any_bundle:
        return False, "no bundle found"
    return not purity_hits, ("found: " + ", ".join(purity_hits)) if purity_hits else ""


def check_sources_host_guard(repo, plugin):
    data_js = server_path(repo, plugin, "data", *DATA_BUNDLE)
    if not os.path.isfile(data_js):
        return False, "/".join((plugin_layout.SERVER_DIRS["data"],) + DATA_BUNDLE) + " not found"
    with open(data_js, encoding="utf-8") as f:
        guard_hits = sources_host_guard_violations(f.read())
    return not guard_hits, "; ".join(guard_hits)


def check_bundle_no_host_path(repo, plugin):
    servers = [s for s in plugin_layout.SERVERS if plugin_layout.SERVERS[s]["host_path"] and s in plugin["servers"]]
    if not servers:
        raise NotApplicable(f"{plugin['name']} ships no server")
    host_hits = []
    for server in servers:
        dist_rel = plugin_layout.SERVER_DIRS[server]
        dist = server_path(repo, plugin, server, "dist")
        if not os.path.isdir(dist):
            continue
        for fn in sorted(os.listdir(dist)):
            if not fn.endswith(".js"):
                continue
            with open(os.path.join(dist, fn), encoding="utf-8") as f:
                text = f.read()
            m = HOST_PATH.search(text)
            if not m:
                continue
            note = " (linked worktree -- rebuild from the main worktree)" if WORKTREE_PATH.search(text) else ""
            host_hits.append(f"{dist_rel}/dist/{fn}: {m.group(0)!r}{note}")
    return not host_hits, "; ".join(host_hits)


BAKED_SCHEMA = re.compile(r"BAKED_SCHEMA_VERSION = (?:false|true|[^?\n]+)\s*\?\s*null\s*:\s*(\d+)")
ENGINE_TARGET = re.compile(r"^TARGET_SCHEMA_VERSION\s*=\s*(\d+)\s*$", re.M)


def check_bundle_schema_ceiling(repo, plugin):
    """The data bundle's baked drafting-data schema version equals the migration source's target.

    scripts/bundle.mjs bakes TARGET_SCHEMA_VERSION into the bundle at build time
    (src/submission/schema-ceiling.ts). A migrate_engine.py hop committed without a
    rebuilt bundle ships an install whose migration source is ahead of its renderers:
    open_session then withholds every migration and renders nothing. 3935943 (74 over
    a 73 bundle), 78ffce8 (75 over 74) and 7d09fd6 (76 over 74) each reached main so."""
    data_js = server_path(repo, plugin, "data", *DATA_BUNDLE)
    engine = os.path.join(skills_root(repo), "drafting-data", "references", "scripts", "migrate_engine.py")
    if not os.path.isfile(data_js):
        return False, "/".join((plugin_layout.SERVER_DIRS["data"],) + DATA_BUNDLE) + " not found"
    with open(data_js, encoding="utf-8") as f:
        baked = BAKED_SCHEMA.search(f.read())
    with open(engine, encoding="utf-8") as f:
        target = ENGINE_TARGET.search(f.read())
    if not baked or not target:
        return False, ("no baked schema version in the data bundle" if not baked
                       else "no TARGET_SCHEMA_VERSION in drafting-data's migrate_engine.py")
    if baked.group(1) != target.group(1):
        return False, (f"the migration source targets schema {target.group(1)} but the data bundle was built "
                       f"against {baked.group(1)}: rebuild the bundle (/release) before this ships")
    return True, f"both at schema {target.group(1)}"
