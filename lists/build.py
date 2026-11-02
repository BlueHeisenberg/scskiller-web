"""Rebuilds the no-JS snapshot of /requests/ and /supported/ from the public lists the API serves.

    python -I lists/build.py <folder with requests.json and supported.json> [site root, default .]

The JSON is what app.js renders live (https://api.scskiller.com/v1/content/), already public. The page markup matches
the server's list builder, which publishes that JSON every hour; run by .github/workflows/lists.yml.
"""
import datetime, html, json, re, sys, unicodedata
from pathlib import Path

SITE = "https://scskiller.com"
LOGO = ('<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M18 4 7 18h8l-2 10 12-15h-8l2-9z" fill="none" stroke="#4cc2ff" '
        'stroke-width="2.2" stroke-linejoin="round"/></svg>')
PAGES = [("index.html", "Game request list"), ("supported.html", "Supported game list")]
LIVE = {"index.html": "requests.json", "supported.html": "supported.json"}  # what app.js loads from the API
SLUG = {"index.html": "requests", "supported.html": "supported"}  # the website's paths
DESCRIPTION = {"index.html": "The games players asked SCSKiller to support, ranked by requests, Patreon members first.",
               "supported.html": "Every game SCSKiller can compile, with the community database's tags and the version that added it."}
EXPEDITE_URL = "https://support.scskiller.com/posts/one-time-game-171982316"
PATREON_URL = "https://support.scskiller.com"
DISCORD_REQUESTS_URL = "https://discord.com/channels/1554579978262417579/1556798216958247012"  # #game-requests, members
DISCORD_BACKER_URL = "https://discord.com/channels/1554579978262417579/1558523634966859847"  # #backers-game-request, backers
# key, tag, what it means. The community database is the Patreon supporters' shared data.
SOURCES = [("team", "Official", "Shared by us, for Patreon supporters"),
           ("community", "Shared by users", "Shared by players, for Patreon supporters")]
UNTAGGED = "Compiles without the community database"
PARTIAL_LINE = "Part of the game's shaders can't be compiled yet"
AC_LINE = "The game contains anti-cheat. Enabling the recorder there is at your own risk, SCSKiller isn't responsible for bans."
TAG_KEYS = {"team": "official", "community": "shared_by_users"}
TAG = '<span class="tag src-{key}">{tag}</span>'


def esc(s):
    return html.escape("" if s is None else str(s))


def flat(s):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", s or "").lower())


def utc(t):
    d = datetime.datetime.fromisoformat(t.replace("Z", "+00:00")) if t else None
    return f"{d:%b} {d.day}, {d:%H:%M} UTC" if d else "-"


def site_parts(root):
    """The website's own header nav and footer, from its privacy page, nobody's page marked current."""
    text = (root / "privacy/index.html").read_text(encoding="utf-8").replace(' aria-current="page"', "")
    return {"nav": re.search(r'    <nav class="nav" aria-label="Main">.*?</nav>', text, re.S)[0],
            "footer": re.search(r'<footer class="site-footer">.*?</footer>', text, re.S)[0]}


def page(out, file, lede, side, body, updated, site):
    """body: (list html, number of games). side: the buttons or legend beside the head. updated: the data's time."""
    title = dict(PAGES)[file]
    items, total = body
    a, own, path = "/assets/", "/lists/", out / SLUG[file] / "index.html"
    meta = (f'<meta name="description" content="{esc(DESCRIPTION[file])}">\n'
            f'<meta name="theme-color" content="#05070a">\n<meta name="color-scheme" content="dark">\n'
            f'<link rel="canonical" href="{SITE}/{SLUG[file]}/">')
    nav = re.sub(r'href="/(requests|supported)/"', r'href="../\1/"', site["nav"]).replace(
        f'href="../{SLUG[file]}/"', f'href="../{SLUG[file]}/" aria-current="page"')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · SCSKiller</title>
{meta}
<link rel="icon" href="{a}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="{a}site.css">
<link rel="stylesheet" href="{own}compat.css">
<link rel="stylesheet" href="{own}style.css">
<script>document.documentElement.classList.add('js')</script>
<script src="{a}bg.js" defer></script>
<script src="{a}site.js" defer></script>
<script src="{own}app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/">{LOGO}SCSKiller</a>
{nav}
  </div>
</header>

<main id="main">
  <section class="hero sub">
    <div class="band" aria-hidden="true"><canvas class="scene" data-variant="band"></canvas></div>
    <div class="wrap"><div class="head{"" if side else " solo"}">
      <div class="head-text">
        <h1>{esc(title)}</h1>
        {f'<p class="lede">{esc(lede)}</p>' if lede else ""}
        <form class="controls" role="search" data-for="list"><div class="field grow"><input id="q" type="search" aria-label="Search games" placeholder="Search by name" autocomplete="off" spellcheck="false"></div></form>
        <p class="floor">Updated <time datetime="{updated or ""}">{esc(utc(updated))}</time></p>
        <p class="status" role="status" aria-live="polite">{total} of {total} games</p>
      </div>
{side}
    </div></div>
  </section>

  <section class="compat-body">
    <div class="wrap" id="list" data-live="{LIVE[file]}">
{items}
    </div>
  </section>
</main>

{site["footer"]}
</body>
</html>
""", encoding="utf-8")


REQUEST_SIDE = f"""      <div class="side">
        <a class="btn btn-primary btn-shine" href="{EXPEDITE_URL}">Expedite a game</a>
        <a class="btn" href="{PATREON_URL}">Support on Patreon</a>
        <a class="btn" href="{DISCORD_REQUESTS_URL}">Request a game on Discord</a>
      </div>"""


def ranked(cls, heads, items, start=1, first="Game"):
    """A list of cards under a column header row. heads: (label, class) after # and the first column."""
    head = "".join(f'<span class="{c}">{h}</span>' for h, c in heads)
    return (f'<div class="ranked-head {cls}" aria-hidden="true"><span></span><span>{first}</span>{head}</div>'
            f'<ol class="ranked {cls}" start="{start}">{"".join(items)}</ol>')


def item(n, name, cells, q=None, kind="game panel"):
    """One card: its rank (none for engines), name and cells (html, label for screen readers or "", class)."""
    cs = "".join(f'<span class="cell {cls}">' + (f'<span class="visually-hidden">{lab}: </span>' if lab else "") + f"{h}</span>"
                 for h, lab, cls in cells)
    rank = f'<span class="visually-hidden">Rank </span>{n}' if n else ""
    return (f'<li class="{kind}" data-q="{esc(q or flat(name))}"><div class="game-row">'
            f'<span class="rank">{rank}</span><h3 class="gname">{esc(name)}</h3><div class="cells">{cs}</div></div></li>')


def unit(text):
    """A word the compact cards show beside a value, where the column headers are gone."""
    return f'<span class="unit" aria-hidden="true">{text}</span>'


def count_cell(n):
    return (f'{n}{unit(" request" if n == 1 else " requests")}', "Requests", "num")


def group(title, body, link=""):
    """A section: its title, a link or one short line beside it, its list."""
    return f'      <div class="group"><div class="group-head"><h2>{title}</h2>{link}</div>{body}</div>'


# a status's pill class and tooltip, app.js has the same table
PILL = {"waiting": ("v-none", "What SCSKiller needs first"), "working": ("v-helped", "We're working on this game"),
        "queue": ("v-none", "Waiting for its turn")}


def pill(label, state):
    cls, why = PILL[state]
    return f'<span class="verdict {cls}" title="{why}">{esc(label)}</span>'


SECTIONS = {"patreon": ("Patreon priority", f'<a href="{DISCORD_BACKER_URL}">Patreon members: #backers-game-request</a>'),
            "community": ("Community requests", "")}


def render_requests(d):
    """The request list's cards: (html, number of games). app.js renders the live JSON the same way."""
    heads = [("Requests", "num"), ("Status", "")]
    cells = lambda g: [count_cell(g["requests"]), (pill(g["status"], g["state"]), "Status", "state")]  # noqa: E731
    out = []
    for sec, (title, link) in SECTIONS.items():
        part = [g for g in d["games"] if g["section"] == sec]
        if part:
            out.append(group(title, ranked("req", heads, [item(g["rank"], g["name"], cells(g)) for g in part], part[0]["rank"]), link))
    engines = [item(None, g["name"], cells(g), kind="game panel engine") for g in d["games"] if g["section"] == "engine"]
    if engines:
        out.append(group("Requested engines", ranked("req engines", heads, engines, first="Engine or games")))
    return "\n".join(out), sum(1 for g in d["games"] if g["section"] != "engine")


SUPPORTED_SIDE = ('      <ul class="side legend-box" aria-label="Tags">'
                  + "".join(f'<li>{TAG.format(key=k, tag=esc(t))} {esc(m)}</li>' for k, t, m in SOURCES) + f'<li><span class="tag none">No tag</span> {esc(UNTAGGED)}</li>'
                  + f'<li><span class="tag partial">Partial coverage</span> {esc(PARTIAL_LINE)}</li>'
                  + f'<li><span class="tag ac">Anti-cheat</span> {esc(AC_LINE)}</li></ul>')


def render_supported(d):
    """Every game SCSKiller can compile, a tag for each way it's in the community database, then the engines:
    (html, number of games). app.js renders the live JSON the same way."""
    tags = {**{TAG_KEYS[k]: TAG.format(key=k, tag=esc(t)) for k, t, _ in SOURCES},
            "partial": '<span class="tag partial">Partial coverage</span>',
            "anti_cheat": '<span class="tag ac" title="Contains anti-cheat">Anti-cheat</span>'}
    since = lambda v: (unit("since ") + esc(v), "Since", "since")  # noqa: E731
    games = [item(g["rank"], g["name"], [("".join(tags[t] for t in g["tags"]), "", "tags"), since(g["since"])], g["search"]) for g in d["games"]]
    engines = [item(None, e["name"], [(esc(e["covers"]), "Covers", "covers"), since(e["since"])], kind="game panel engine") for e in d["engines"]]
    return "\n".join([group("Supported games", ranked("sup", [("", "tags"), ("Since", "")], games)),
                      group("Supported engines", ranked("eng engines", [("Covers", ""), ("Since", "")], engines, first="Engine"),
                            '<span class="note">What SCSKiller 1.3.0 reads</span>')]), len(d["games"])


def valid(d, key):
    """What app.js accepts (schema 1, a time, a non-empty list): anything else keeps the committed pages."""
    return d.get("schema") == 1 and isinstance(d.get("updated"), str) and isinstance(d.get(key), list) and len(d[key]) > 0


def main():
    src, root = Path(sys.argv[1]), Path(sys.argv[2] if len(sys.argv) > 2 else ".")
    rq, sp = (json.loads((src / f).read_text(encoding="utf-8")) for f in ("requests.json", "supported.json"))
    if not (valid(rq, "games") and valid(sp, "games")):
        sys.exit("refused: requests.json or supported.json isn't what app.js accepts; the pages stay as they are")
    parts = site_parts(root)
    page(root, "index.html", "", REQUEST_SIDE, render_requests(rq), rq["updated"], parts)
    page(root, "supported.html", "Games SCSKiller can compile.", SUPPORTED_SIDE, render_supported(sp), sp["updated"], parts)
    print(f"built: {sum(1 for g in rq['games'] if g['section'] != 'engine')} requested ({rq['updated']}), {len(sp['games'])} supported ({sp['updated']})")


if __name__ == "__main__":
    main()
