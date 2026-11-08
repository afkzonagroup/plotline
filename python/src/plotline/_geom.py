# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Coordinates and exact geometry on the six-decimal grid (mirror of
src/core/coords.ts and src/core/geometry/*.ts). Coordinates are integers in
millionths of a degree, truncated toward zero as the EUDR Information System
truncates them; Python integers make every predicate exact."""
import math
import re

MICRO = 1_000_000
MAX_ABS_COORDINATE = 10_000
HALF_TURN = 180 * MICRO
TURN = 2 * HALF_TURN

_DECIMAL = re.compile(r"^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$")


class Coordinate:
    __slots__ = ("micro", "value", "decimals", "truncated")

    def __init__(self, micro, value, decimals, truncated):
        self.micro = micro
        self.value = value
        self.decimals = decimals
        self.truncated = truncated


def parse_coordinate(raw):
    """Reads decimal text as a coordinate, or returns None."""
    m = _DECIMAL.match(raw)
    if m is None:
        return None
    try:
        value = float(raw)
    except (ValueError, OverflowError):
        return None
    if value != value or abs(value) > MAX_ABS_COORDINATE:
        return None
    negative = m.group(1) == "-"
    int_part = m.group(2)
    frac_part = m.group(3) or ""
    exp = max(-100_000, min(100_000, int(m.group(4) or "0")))
    digits = int_part + frac_part
    point = len(int_part) + exp
    decimals = max(0, len(digits) - point)
    keep = point + 6
    micro = 0
    if keep <= 0:
        truncated = re.search(r"[1-9]", digits) is not None
    else:
        head = digits + "0" * (keep - len(digits)) if keep >= len(digits) else digits[:keep]
        truncated = keep < len(digits) and re.search(r"[1-9]", digits[keep:]) is not None
        micro = int(head)
    if negative and micro != 0:
        micro = -micro
    return Coordinate(micro, value, decimals, truncated)


def format_micro(micro):
    negative = micro < 0
    a = abs(micro)
    whole = a // MICRO
    frac = ("%06d" % (a % MICRO)).rstrip("0")
    return ("-" if negative else "") + str(whole) + ("." + frac if frac else "")


class Pt:
    """A point on the grid; `src` points back to a source position when unwrapped."""

    __slots__ = ("x", "y", "src")

    def __init__(self, x, y, src=None):
        self.x = x
        self.y = y
        self.src = src


# ---- predicates ----


def orient(a, b, c):
    d = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    return 1 if d > 0 else -1 if d < 0 else 0


def same_point(a, b):
    return a.x == b.x and a.y == b.y


def _within(a, b, c):
    return min(a.x, b.x) <= c.x <= max(a.x, b.x) and min(a.y, b.y) <= c.y <= max(a.y, b.y)


def segment_relation(a, b, c, d):
    if max(a.x, b.x) < min(c.x, d.x) or max(c.x, d.x) < min(a.x, b.x):
        return "none"
    if max(a.y, b.y) < min(c.y, d.y) or max(c.y, d.y) < min(a.y, b.y):
        return "none"
    o1 = orient(a, b, c)
    o2 = orient(a, b, d)
    o3 = orient(c, d, a)
    o4 = orient(c, d, b)
    if o1 != 0 and o2 != 0 and o3 != 0 and o4 != 0:
        return "cross" if o1 != o2 and o3 != o4 else "none"
    if o1 == 0 and o2 == 0:
        use_x = a.x != b.x or c.x != d.x
        if use_x:
            a0, a1 = min(a.x, b.x), max(a.x, b.x)
            c0, c1 = min(c.x, d.x), max(c.x, d.x)
        else:
            a0, a1 = min(a.y, b.y), max(a.y, b.y)
            c0, c1 = min(c.y, d.y), max(c.y, d.y)
        lo = max(a0, c0)
        hi = min(a1, c1)
        if lo > hi:
            return "none"
        return "overlap" if lo < hi else "touch"
    if o1 == 0 and _within(a, b, c):
        return "touch"
    if o2 == 0 and _within(a, b, d):
        return "touch"
    if o3 == 0 and _within(c, d, a):
        return "touch"
    if o4 == 0 and _within(c, d, b):
        return "touch"
    return "none"


def locate(p, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        a = ring[j]
        b = ring[i]
        if orient(a, b, p) == 0 and _within(a, b, p):
            return "boundary"
        if (a.y > p.y) != (b.y > p.y):
            o = orient(a, b, p)
            if (o > 0) if b.y > a.y else (o < 0):
                inside = not inside
        j = i
    return "inside" if inside else "outside"


# ---- rings ----


class Budget:
    __slots__ = ("remaining", "exhausted")

    def __init__(self, n):
        self.remaining = n
        self.exhausted = False


def is_closed(ring):
    return len(ring) >= 2 and same_point(ring[0], ring[-1])


def open_ring(ring):
    return list(ring[:-1]) if is_closed(ring) else list(ring)


def close_ring(open_):
    return list(open_) + [open_[0]] if open_ else []


def dedupe_cyclic(open_):
    out = []
    for p in open_:
        if not out or not same_point(out[-1], p):
            out.append(p)
    while len(out) > 1 and same_point(out[0], out[-1]):
        out.pop()
    return out, len(open_) - len(out)


def _is_spike(ring, i):
    n = len(ring)
    p = ring[(i - 1) % n]
    v = ring[i]
    q = ring[(i + 1) % n]
    if orient(p, v, q) != 0:
        return False
    dot = (v.x - p.x) * (q.x - v.x) + (v.y - p.y) * (q.y - v.y)
    return dot < 0 or same_point(p, q)


def find_spikes(ring):
    if len(ring) < 3:
        return []
    return [i for i in range(len(ring)) if _is_spike(ring, i)]


def remove_spikes(open_):
    ring = dedupe_cyclic(open_)[0]
    removed = len(open_) - len(ring)
    guard = 0
    while guard <= len(open_) and len(ring) >= 3:
        spikes = find_spikes(ring)
        if not spikes:
            break
        first = spikes[0]
        nxt = dedupe_cyclic([p for i, p in enumerate(ring) if i != first])[0]
        removed += len(ring) - len(nxt)
        ring = nxt
        guard += 1
    return ring, removed


def is_collinear(open_):
    if not open_:
        return True
    a = open_[0]
    b = next((p for p in open_ if not same_point(p, a)), None)
    if b is None:
        return True
    return all(orient(a, b, c) == 0 for c in open_)


def ring_orientation(open_):
    n = len(open_)
    if n < 3:
        return 0
    o = open_[0]
    s = 0
    for i in range(n):
        a = open_[i]
        b = open_[(i + 1) % n]
        s += (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y)
    return 1 if s > 0 else -1 if s < 0 else 0


def find_self_intersection(open_, work):
    """Returns (i, j, relation) or None; sets work.exhausted when the budget runs out."""
    n = len(open_)
    if n < 3:
        return None
    seen = {}
    for i, p in enumerate(open_):
        key = (p.x, p.y)
        if key in seen:
            return (seen[key], i, "repeated-vertex")
        seen[key] = i
    min_x = [0] * n
    max_x = [0] * n
    min_y = [0] * n
    max_y = [0] * n
    for i in range(n):
        a = open_[i]
        b = open_[(i + 1) % n]
        min_x[i] = min(a.x, b.x)
        max_x[i] = max(a.x, b.x)
        min_y[i] = min(a.y, b.y)
        max_y[i] = max(a.y, b.y)
    order = sorted(range(n), key=lambda i: (min_x[i], i))
    active = []
    for e in order:
        ex = min_x[e]
        active = [a for a in active if max_x[a] >= ex]
        for a in active:
            work.remaining -= 1
            if work.remaining < 0:
                work.exhausted = True
                return None
            if max_y[a] < min_y[e] or max_y[e] < min_y[a]:
                continue
            adjacent = abs(a - e) == 1 or abs(a - e) == n - 1
            rel = segment_relation(open_[a], open_[(a + 1) % n], open_[e], open_[(e + 1) % n])
            if adjacent:
                if rel == "overlap":
                    return (min(a, e), max(a, e), rel)
                continue
            if rel != "none":
                return (min(a, e), max(a, e), rel)
        active.append(e)
    return None


def crosses_antimeridian(open_):
    n = len(open_)
    for i in range(n):
        if abs(open_[(i + 1) % n].x - open_[i].x) > HALF_TURN:
            return True
    return False


def unwrap_ring(open_):
    n = len(open_)
    if n == 0:
        return []
    out = []
    shift = 0
    prev_x = open_[0].x
    for i, p in enumerate(open_):
        if i > 0:
            dx = p.x - prev_x
            if dx > HALF_TURN:
                shift -= TURN
            elif dx < -HALF_TURN:
                shift += TURN
        prev_x = p.x
        out.append(Pt(p.x + shift, p.y, p))
    if abs(out[0].x - out[-1].x) > HALF_TURN:
        return None
    return out


# ---- area (authalic sphere, see src/core/geometry/area.ts) ----

WGS84_A = 6_378_137
WGS84_F = 1 / 298.257223563
_E2 = WGS84_F * (2 - WGS84_F)
_E = math.sqrt(_E2)


def _q(sin_phi):
    es = _E * sin_phi
    return (1 - _E2) * (sin_phi / (1 - _E2 * sin_phi * sin_phi) - (1 / (2 * _E)) * math.log((1 - es) / (1 + es)))


_QP = _q(1)
AUTHALIC_RADIUS = WGS84_A * math.sqrt(_QP / 2)
_RAD = math.pi / 180


def authalic_latitude(phi):
    return math.asin(max(-1.0, min(1.0, _q(math.sin(phi)) / _QP)))


def ring_area_square_metres(open_):
    n = len(open_)
    if n < 3:
        return 0.0
    total = 0.0
    last = open_[-1]
    lambda0 = (last.x / MICRO) * _RAD
    phi_last = authalic_latitude((last.y / MICRO) * _RAD) / 2 + math.pi / 4
    cos0 = math.cos(phi_last)
    sin0 = math.sin(phi_last)
    for p in open_:
        lam = (p.x / MICRO) * _RAD
        phi = authalic_latitude((p.y / MICRO) * _RAD) / 2 + math.pi / 4
        d = lam - lambda0
        if d > math.pi:
            d -= 2 * math.pi
        elif d < -math.pi:
            d += 2 * math.pi
        sd = 1 if d >= 0 else -1
        ad = sd * d
        cos1 = math.cos(phi)
        sin1 = math.sin(phi)
        k = sin0 * sin1
        u = cos0 * cos1 + k * math.cos(ad)
        v = k * sd * math.sin(ad)
        total += math.atan2(v, u)
        lambda0 = lam
        cos0 = cos1
        sin0 = sin1
    excess = abs(2 * total)
    sr = min(excess, 4 * math.pi - excess)
    return sr * AUTHALIC_RADIUS * AUTHALIC_RADIUS


def polygon_hectares(rings):
    total = 0.0
    for i, ring in enumerate(rings):
        a = ring_area_square_metres(ring)
        total += a if i == 0 else -a
    return max(0.0, total) / 10_000


# ---- overlap ----

_SCALE = 6


def box_of(ring):
    return (min(p.x for p in ring), min(p.y for p in ring), max(p.x for p in ring), max(p.y for p in ring))


def interior_point(ring):
    n = len(ring)
    v = 0
    for i in range(1, n):
        p = ring[i]
        best = ring[v]
        if p.x < best.x or (p.x == best.x and p.y < best.y):
            v = i
    a = ring[(v - 1) % n]
    b = ring[(v + 1) % n]
    c = ring[v]
    triangle = [a, c, b]
    q = None
    q_dist = -1
    for i in range(n):
        if i in (v, (v - 1) % n, (v + 1) % n):
            continue
        p = ring[i]
        if locate(p, triangle) == "outside":
            continue
        d = abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
        if d > q_dist:
            q_dist = d
            q = p
    if q is None:
        return Pt(2 * (a.x + b.x + c.x), 2 * (a.y + b.y + c.y))
    return Pt(3 * (c.x + q.x), 3 * (c.y + q.y))


def polygon_relation(a, b, work):
    ba = box_of(a)
    bb = box_of(b)
    if ba[2] < bb[0] or bb[2] < ba[0] or ba[3] < bb[1] or bb[3] < ba[1]:
        return "disjoint"
    shared = False
    touch = False
    na = len(a)
    nb = len(b)
    edges = []
    for ring_id, ring, n in ((0, a, na), (1, b, nb)):
        for i in range(n):
            p = ring[i]
            q = ring[(i + 1) % n]
            edges.append((min(p.x, q.x), ring_id, i, max(p.x, q.x), min(p.y, q.y), max(p.y, q.y)))
    edges.sort(key=lambda e: (e[0], e[1], e[2]))
    active = []
    for e in edges:
        active = [x for x in active if x[3] >= e[0]]
        for o in active:
            if o[1] == e[1]:
                continue
            work.remaining -= 1
            if work.remaining < 0:
                work.exhausted = True
                return None
            if o[5] < e[4] or e[5] < o[4]:
                continue
            ea, eb = (a, na) if e[1] == 0 else (b, nb)
            oa, ob = (a, na) if o[1] == 0 else (b, nb)
            rel = segment_relation(ea[e[2]], ea[(e[2] + 1) % eb], oa[o[2]], oa[(o[2] + 1) % ob])
            if rel == "cross":
                return "overlap"
            if rel == "overlap":
                shared = True
            elif rel == "touch":
                touch = True
        active.append(e)
    sa = [Pt(p.x * _SCALE, p.y * _SCALE) for p in a]
    sb = [Pt(p.x * _SCALE, p.y * _SCALE) for p in b]

    def probes(ring, s):
        out = list(s)
        for i in range(len(ring)):
            p = ring[i]
            q = ring[(i + 1) % len(ring)]
            out.append(Pt((p.x + q.x) * (_SCALE // 2), (p.y + q.y) * (_SCALE // 2)))
        out.append(interior_point(ring))
        return out

    for points, target in ((probes(a, sa), sb), (probes(b, sb), sa)):
        for p in points:
            work.remaining -= len(target)
            if work.remaining < 0:
                work.exhausted = True
                return None
            loc = locate(p, target)
            if loc == "inside":
                return "overlap"
            if loc == "boundary":
                touch = True
    return "shared-edge" if shared else "touch" if touch else "disjoint"


# ---- antimeridian ----


def _div_trunc(num, den):
    q = abs(num) // abs(den)
    return q if (num >= 0) == (den > 0) else -q


def _crossing_y(p, q, x):
    return p.y + _div_trunc((x - p.x) * (q.y - p.y), q.x - p.x)


def _clip(ring, x, keep_west):
    def inside(p):
        return p.x <= x if keep_west else p.x >= x

    out = []
    n = len(ring)
    for i in range(n):
        p = ring[i]
        q = ring[(i + 1) % n]
        pin = inside(p)
        qin = inside(q)
        if pin and qin:
            out.append(q)
        elif pin and not qin:
            out.append(Pt(x, _crossing_y(p, q, x)))
        elif not pin and qin:
            out.append(Pt(x, _crossing_y(p, q, x)))
            out.append(q)
    return out


def cut_at_antimeridian(unwrapped):
    min_x = min(p.x for p in unwrapped)
    shift = TURN if min_x < -HALF_TURN else 0
    ring = [Pt(p.x + shift, p.y) for p in unwrapped]
    east = [Pt(p.x, p.y) for p in _clip(ring, HALF_TURN, True)]
    west = [Pt(p.x - TURN, p.y) for p in _clip(ring, HALF_TURN, False)]
    return east, west
