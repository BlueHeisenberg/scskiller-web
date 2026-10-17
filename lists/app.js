// The page is a snapshot from build.py. The live lists (build.py --emit-json) replace it when they're valid and newer,
// on any failure the snapshot stays.
const DATA_URL = 'https://api.scskiller.com/v1/content/';

// Search: drops case, accents and punctuation, as build.py's flat() writes data-q. Cards keep their rank.
const norm = (s) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const list = document.getElementById('list');
const input = document.getElementById('q');
const status = document.querySelector('.status');

function filter() {
  const q = norm(input.value);
  const games = [...list.querySelectorAll('.game[data-q]:not(.engine)')];
  for (const g of list.querySelectorAll('.game[data-q]')) g.hidden = !g.dataset.q.includes(q);
  for (const grp of list.querySelectorAll('.group')) grp.hidden = !grp.querySelector('.game:not([hidden])');
  status.textContent = `${games.filter((g) => !g.hidden).length} of ${games.length} games`;
}
input.form.addEventListener('submit', (e) => e.preventDefault());
input.addEventListener('input', filter);

// The same markup as build.py's item(), ranked() and group().
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const unit = (t) => `<span class="unit" aria-hidden="true">${t}</span>`;
const cell = (h, label, cls) => `<span class="cell ${cls}">${label ? `<span class="visually-hidden">${label}: </span>` : ''}${h}</span>`;
const item = (n, name, cells, q, kind = 'game panel') => `<li class="${kind}" data-q="${esc(q)}"><div class="game-row">`
  + `<span class="rank">${n ? `<span class="visually-hidden">Rank </span>${n}` : ''}</span><h3 class="gname">${esc(name)}</h3>`
  + `<div class="cells">${cells.join('')}</div></div></li>`;
const ranked = (cls, heads, items, start = 1, first = 'Game') => `<div class="ranked-head ${cls}" aria-hidden="true"><span></span>`
  + `<span>${first}</span>${heads.map(([h, c]) => `<span class="${c}">${h}</span>`).join('')}</div>`
  + `<ol class="ranked ${cls}" start="${start}">${items.join('')}</ol>`;
const group = (title, body, link = '') => `<div class="group"><div class="group-head"><h2>${title}</h2>${link}</div>${body}</div>`;

// build.py's PILL, SECTIONS, TAG and SOURCES
const PILL = { waiting: ['v-none', 'What SCSKiller needs first'], working: ['v-helped', "We're working on this game"],
  queue: ['v-none', 'Waiting for its turn'] };
const SECTIONS = { patreon: ['Patreon priority', '<a href="https://discord.com/channels/1554579978262417579/1558523634966859847">Patreon members: #backers-game-request</a>'],
  community: ['Community requests', ''] };
const TAGS = { official: '<span class="tag src-team">Official</span>', shared_by_users: '<span class="tag src-community">Shared by users</span>',
  anti_cheat: '<span class="tag ac" title="Contains anti-cheat">Anti-cheat</span>' };

function requestsHtml(d) {
  const heads = [['Requests', 'num'], ['Status', '']];
  const cells = (g) => [cell(`${g.requests}${unit(g.requests === 1 ? ' request' : ' requests')}`, 'Requests', 'num'),
    cell(`<span class="verdict ${PILL[g.state][0]}" title="${PILL[g.state][1]}">${esc(g.status)}</span>`, 'Status', 'state')];
  const out = [];
  for (const [sec, [title, link]] of Object.entries(SECTIONS)) {
    const part = d.games.filter((g) => g.section === sec);
    if (part.length) out.push(group(title, ranked('req', heads, part.map((g) => item(g.rank, g.name, cells(g), norm(g.name))), part[0].rank), link));
  }
  const engines = d.games.filter((g) => g.section === 'engine');
  if (engines.length) {
    out.push(group('Requested engines', ranked('req engines', heads,
      engines.map((g) => item(null, g.name, cells(g), norm(g.name), 'game panel engine')), 1, 'Engine or games')));
  }
  return out.join('\n');
}

function supportedHtml(d) {
  const since = (s) => cell(unit('since ') + esc(s), 'Since', 'since');
  const games = d.games.map((g) => item(g.rank, g.name, [cell(g.tags.map((t) => TAGS[t]).join(''), '', 'tags'), since(g.since)], g.search));
  const engines = d.engines.map((e) => item(null, e.name, [cell(esc(e.covers), 'Covers', 'covers'), since(e.since)], norm(e.name), 'game panel engine'));
  return [group('Supported games', ranked('sup', [['', 'tags'], ['Since', '']], games)),
    group('Supported engines', ranked('eng engines', [['Covers', ''], ['Since', '']], engines, 1, 'Engine'),
      '<span class="note">What SCSKiller 1.3.0 reads</span>')].join('\n');
}

const str = (v) => typeof v === 'string';
const VALID = {
  'requests.json': (g) => str(g.name) && Number.isInteger(g.requests) && str(g.status) && g.state in PILL
    && (g.section in SECTIONS ? Number.isInteger(g.rank) : g.section === 'engine'),
  'supported.json': (g) => str(g.name) && Number.isInteger(g.rank) && str(g.since) && str(g.search)
    && Array.isArray(g.tags) && g.tags.every((t) => t in TAGS),
};
const RENDER = { 'requests.json': requestsHtml, 'supported.json': supportedHtml };

// "Oct 17, 18:47 UTC", as build.py's utc()
function utc(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

async function live() {
  const file = list.dataset.live;
  const time = document.querySelector('.floor time');
  const res = await fetch(DATA_URL + file, { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
  if (!res.ok) return;
  const d = await res.json();
  const ok = d && d.schema === 1 && str(d.updated) && !Number.isNaN(Date.parse(d.updated)) && Array.isArray(d.games) && d.games.length
    && d.games.every(VALID[file]) && (file !== 'supported.json' || (Array.isArray(d.engines)
      && d.engines.every((e) => str(e.name) && str(e.covers) && str(e.since))));
  if (!ok || (time.dateTime && Date.parse(d.updated) <= Date.parse(time.dateTime))) return;
  const html = RENDER[file](d);
  list.innerHTML = html;
  time.dateTime = d.updated;
  time.textContent = utc(d.updated);
  filter();
}
if (list.dataset.live) live().catch(() => {});
