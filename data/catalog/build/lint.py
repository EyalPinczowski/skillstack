"""Catalog lint and prerequisite helpers. Used by build.py; every function is pure so the
tests in test_lint.py can feed it small fixtures.

Each check returns a list of error strings; an empty list means the data is fine.
"""
import re

PREREQ_KINDS = ("required", "recommended")
DEPTH_LEVELS = ("beginner", "intermediate", "advanced")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def required_prereqs(item):
    """Ids of the item's required prerequisites, in the order they are listed."""
    kinds = item.get("prerequisite_kinds") or {}
    return [p for p in item["prerequisites"] if kinds.get(p, "required") == "required"]


def ordered_required_closure(item_id, by_id):
    """The item plus its transitive required prerequisites, prerequisites first (depth-first
    post-order, each id once). Unknown ids and cycles are skipped here; check_prerequisites
    reports them."""
    out, seen = [], set()

    def visit(i):
        if i in seen or i not in by_id:
            return
        seen.add(i)
        for p in required_prereqs(by_id[i]):
            visit(p)
        out.append(i)

    visit(item_id)
    return out


def find_cycle(items):
    """Return one prerequisite cycle as a list like [a, b, c, a], or None. All prerequisite
    edges count, required and recommended."""
    by_id = {i["id"]: i for i in items}
    state = {}  # id -> 1 visiting, 2 done
    stack = []

    def visit(i):
        state[i] = 1
        stack.append(i)
        for p in by_id[i]["prerequisites"]:
            if p not in by_id:
                continue
            if state.get(p) == 1:
                return stack[stack.index(p):] + [p]
            if p not in state:
                found = visit(p)
                if found:
                    return found
        stack.pop()
        state[i] = 2
        return None

    for i in by_id:
        if i not in state:
            found = visit(i)
            if found:
                return found
    return None


def check_items(items, skill_ids=None):
    errs = []
    ids = {i["id"] for i in items}
    for it in items:
        iid = it["id"]
        for p in it["prerequisites"]:
            if p not in ids:
                errs.append(f"{iid}: prerequisite {p} does not exist")
            if p == iid:
                errs.append(f"{iid}: lists itself as a prerequisite")
        kinds = it.get("prerequisite_kinds")
        if not isinstance(kinds, dict) or set(kinds) != set(it["prerequisites"]):
            errs.append(f"{iid}: prerequisite_kinds must have exactly one entry per prerequisite")
        else:
            for p, k in kinds.items():
                if k not in PREREQ_KINDS:
                    errs.append(f"{iid}: prerequisite_kinds[{p}] is {k!r}, expected one of {PREREQ_KINDS}")
        if it["url_verified"] and not (it["url"] or "").startswith("https://"):
            errs.append(f"{iid}: url_verified is true but the url is not an https url")
        if it.get("type") != "practice" and not it["url"]:
            # A learning item without a url is allowed only while it is unverified and says so.
            if it["url_verified"] or "needs check" not in (it.get("notes") or "").lower():
                errs.append(f"{iid}: missing url (allowed only when url_verified is false and notes say 'needs check')")
        lv = it.get("last_verified_at")
        if lv is not None and not (isinstance(lv, str) and DATE_RE.match(lv)):
            errs.append(f"{iid}: last_verified_at must be YYYY-MM-DD or null, got {lv!r}")
        grp = it.get("subscription_group")
        if grp is not None:
            if it["cost_type"] != "subscription":
                errs.append(f"{iid}: subscription_group is set but cost_type is {it['cost_type']}")
            elif not isinstance(grp, str) or not grp:
                errs.append(f"{iid}: subscription_group must be a non-empty string or null")
        depth = it.get("skill_depth")
        if not isinstance(depth, dict):
            errs.append(f"{iid}: skill_depth must be an object (empty when unset)")
        else:
            for s, d in depth.items():
                if s not in it["skills"]:
                    errs.append(f"{iid}: skill_depth names {s}, which is not one of the item's skills")
                if d not in DEPTH_LEVELS:
                    errs.append(f"{iid}: skill_depth[{s}] is {d!r}, expected one of {DEPTH_LEVELS}")
    cycle = find_cycle(items) if not any("does not exist" in e for e in errs) else None
    if cycle:
        errs.append("prerequisite cycle: " + " -> ".join(cycle))
    # A subscription group is one subscription: members must agree on what it costs.
    groups = {}
    for it in items:
        if it.get("subscription_group"):
            groups.setdefault(it["subscription_group"], []).append(it)
    for g, members in groups.items():
        periods = {m["subscription_period"] for m in members}
        if len(periods) > 1:
            errs.append(f"subscription_group {g}: items disagree on subscription_period {sorted(map(str, periods))}")
        prices = {m["price"] for m in members if m["price"] is not None}
        if len(prices) > 1:
            errs.append(f"subscription_group {g}: items disagree on price {sorted(prices)}")
    return errs


def check_role_paths(items, roles):
    """Every required prerequisite of a `core` item must be in `core`, before the item."""
    by_id = {i["id"]: i for i in items}
    errs = []
    for r in roles:
        core = r["suggested_path"]["core"]
        pos = {x: n for n, x in enumerate(core)}
        for x in core:
            if x not in by_id:
                errs.append(f"role {r['id']}: core item {x} does not exist")
                continue
            for p in required_prereqs(by_id[x]):
                if p not in pos:
                    errs.append(f"role {r['id']}: core item {x} needs prerequisite {p}, which is not in core")
                elif pos[p] > pos[x]:
                    errs.append(f"role {r['id']}: core item {x} comes before its prerequisite {p}")
    return errs


def lint(items, roles, skill_ids=None):
    return check_items(items, skill_ids) + check_role_paths(items, roles)
