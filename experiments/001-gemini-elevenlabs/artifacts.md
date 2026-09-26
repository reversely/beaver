# Artifact library: dimensions and sources

## Summary

Each review notebook in the desktop interface shows a small low-poly model of an object that
illustrates its subject: the Peace Tower for a notebook on Parliament, a canoe for the fur trade.
This document records the real-world dimensions each model follows, the source of every dimension,
and the parts of each model that are drawn freely. The models are built in code from simple shapes,
so the proportions between those shapes carry all of the model's accuracy. A reviewer can check
every number below against its source.

## Conventions

- All dimensions are in millimetres. The code stores millimetres and converts to scene units only
  when it renders, with one constant: `MM_TO_UNIT`.
- The axes follow three.js: +X runs along an object's length, +Y points up, and +Z points toward
  the viewer. Each model stands on the plane Y = 0.
- A **sourced** dimension comes from a cited page. A **calculated** dimension comes from sourced
  dimensions by the arithmetic shown. A **ranged** dimension takes a value inside a range a source
  gives, and the table names the range. A **stylized** dimension has no source; it fixes a shape the
  model needs, and the table says so.
- Confidence levels describe the source. `high` covers a primary source: the institution that owns
  the object, a governing rulebook, or a government standard. `medium` covers a secondary source or a
  value the source hedges. `low` covers a single retail product standing in for a category with no
  standard.
- `S`-numbers cite the sources table at the end of this document.

## Pieces

### Peace Tower

The Peace Tower illustrates Parliament, government, and national institutions.

| Dimension | mm | Kind | Source | Confidence |
|---|---:|---|---|---|
| Height, ground to flagpole base | 92,200 | sourced | S1 | high |
| Flagpole length | 10,700 | sourced | S2 | high |
| Base, square floor plate | 12,200 | sourced | S3 | medium |
| Clock face diameter | 4,800 | sourced | S4 | high |
| Clock face centre height | 64,000 | stylized | S4 gives only the 60,000 observation level below the clocks | low |
| Copper spire height | 24,000 | stylized | Estimated from photographs; no source gives it | low |
| Flag, width × height | 4,600 × 2,300 | sourced | S5 | high |
| Corner turret width | 1,800 | stylized | Estimated from photographs | low |

The shaft and belfry fill the 68,200 mm between the ground and the base of the spire (92,200 minus
24,000). The model shows the four corner turrets and the belfry openings as simple blocks.

### North canoe (*canot du nord*)

The canoe illustrates the fur trade, the voyageurs, and early exploration.

| Dimension | mm | Kind | Source | Confidence |
|---|---:|---|---|---|
| Length overall | 9,119 | sourced | S6 | high |
| Beam, inside the gunwales | 1,448 | sourced | S6 | high |
| Depth amidships to the gunwale tops | 660 | sourced | S6 | high |
| Stem height | 1,346 | sourced | S6 | high |
| Paddle length | 1,600 | stylized | No voyageur paddle standard was found | low |
| Rocker, keel rise at each end | 150 | stylized | S6 gives no keel profile | low |

S6 describes a four-fathom canoe on the northwest route. S7 gives about 7,000 mm for the type,
measured differently; S6 alone gives a matching beam and depth, so the model follows S6.

### Poutine

The poutine illustrates food and everyday culture.

| Dimension | mm | Kind | Source | Confidence |
|---|---:|---|---|---|
| Container, square bowl | 169 × 169 × 70 | sourced | S8 | low |
| Container base width | 130 | stylized | The bowl tapers; S8 gives only the top | low |
| Fry cross-section | 9.5 × 9.5 | sourced | S10 gives 9.5 for the thinner side of a steak cut; S9 gives 6.4 for shoestring; S12 calls poutine fries medium | low |
| Fry length | 75 | stylized | No source gives a length | low |
| Cheese curd | 19 cube | sourced | S11 | low |
| Gravy layer | 12 | stylized | Covers the top of the fries | low |

No standard defines a poutine serving. Every value here follows a single product or recipe.

### Open book

The open book illustrates language learning and reading.

| Dimension | mm | Kind | Source | Confidence |
|---|---:|---|---|---|
| Page, width × height | 152.4 × 228.6 | sourced | S13 | high |
| Thickness, 300 pages on white paper | 17.2 | calculated | S14 gives 0.0572 mm per page; 300 × 0.0572 | high |
| Cover board | 0.3 | stylized | Paperback card cover | low |
| Page count | 300 | stylized | The page count S14's per-page figure multiplies | low |
| Opening angle | 160 degrees | stylized | A book resting open on a table | low |

### Easel with *The Jack Pine*

The easel illustrates art, painters, and the Group of Seven.

| Dimension | mm | Kind | Source | Confidence |
|---|---:|---|---|---|
| Canvas, height × width | 1,279 × 1,398 | sourced | S15 | high |
| Canvas depth (stretcher) | 25 | stylized | No source gives it | low |
| Easel overall height | 2,300 | ranged | S17 gives a 1,524 to 2,591 range for an H-frame studio easel | low |
| Easel ledge height | 600 | ranged | S16 gives a 152 to 1,067 range | low |
| Easel base, width × depth | 760 × 760 | stylized | Wider than S16's 559 base, to carry the larger canvas | low |
| Post section | 45 × 45 | stylized | No source gives it | low |

The painting's surface uses the painting's own palette in flat colours: pale green sky, orange
horizon band, dark blue hills, and a dark pine. The model does not reproduce the painting.

### National Flag of Canada

The flag illustrates national symbols and identity.

| Dimension | Units of the flag's length | Kind | Source | Confidence |
|---|---:|---|---|---|
| Length × width | 64 × 32 | sourced | S18 | high |
| White square | 32 × 32 | sourced | S18 | high |
| Each red bar | 16 × 32 | calculated | 64 minus 32, split into two bars | high |
| Maple leaf | 11 points, inside the white square | sourced shape, stylized geometry | S18 names 11 points and gives no outline | medium |
| Flag at model scale | 4,600 × 2,300 | sourced | S5, the Peace Tower flag | high |
| Pole height | 10,700 | sourced | S2, the Peace Tower flagpole that carries this flag | high |

### Hockey stick and puck

The stick and puck illustrate sport and winter life.

| Dimension | mm | Kind | Source | Confidence |
|---|---:|---|---|---|
| Puck diameter | 76.2 | sourced | S19, Rule 13.1 | high |
| Puck thickness | 25.4 | sourced | S19, Rule 13.1 | high |
| Stick length, heel to shaft end | 1,600 | sourced | S19, Rule 10.1 maximum | high |
| Blade length, heel to toe | 317.5 | sourced | S19, Rule 10.1 maximum | high |
| Blade height | 70 | ranged | S19, Rule 10.1 range of 50.8 to 76.2 | high |
| Blade curve | 19 | sourced | S19, Rule 10.1 maximum of 19.05 | high |
| Shaft cross-section | 32 × 22 | stylized | Rule 10.1 sets no shaft section | low |
| Blade thickness | 12 | stylized | Rule 10.1 sets no thickness | low |
| Shaft angle above the ice | 45 degrees | stylized | A stick held with the blade on the ice | low |
| Ice slab radius | 500 | stylized | A patch of rink under the blade and puck | low |

### Loonie

The loonie illustrates money and the economy.

| Dimension | mm | Kind | Source | Confidence |
|---|---:|---|---|---|
| Diameter | 26.5 | sourced | S20 | high |
| Thickness | 1.95 | sourced | S20 | high |
| Number of sides | 11 | sourced | S20 | high |

The model shows the coin on edge, tilted toward the viewer, with a raised rim. The loon on the face
appears as a flat inset shape.

### Pieces held back

A ballot box would illustrate voting and elections. Elections Canada publishes no dimensions for its
ballot box or its ballot paper; S21 records that the Chief Electoral Officer sets the size. The
library omits the ballot box until a source exists. Civic notebooks on elections show the Peace
Tower.

## Checks between dimensions

Each check compares dimensions within one model. The model code runs every check when it builds, and
a failed check shows in the browser console.

| Check | Calculation | Result |
|---|---|---|
| Clock faces fit the tower face | 4,800 < 12,200 | pass |
| Clocks sit above the observation level | 64,000 > 60,000 | pass |
| Flag fits the flagpole | 2,300 < 10,700 | pass |
| Clocks sit below the spire | 64,000 + 2,400 = 66,400 < 68,200 | pass |
| Canoe length to beam matches S6 | 9,119 ÷ 1,448 = 6.3 | pass |
| Canoe stems rise above the gunwales | 1,346 > 660 | pass |
| Fries fit inside the bowl | 75 < 169 × √2 = 239 diagonal | pass |
| Curds sit on the fries below the rim | 19 < 70 | pass |
| Painting sits on the easel | 600 + 1,279 = 1,879 < 2,300 | pass |
| Canvas width against the easel base | 1,398 > 760, so the canvas overhangs the base | intended, as on a studio easel |
| Puck under the blade | 25.4 < 70 | pass |
| Blade height inside Rule 10.1 | 50.8 ≤ 70 ≤ 76.2 | pass |
| Book pages fit the cover | 17.2 ÷ 2 per side < 152.4 | pass |
| Flag bars and square fill the length | 16 + 32 + 16 = 64 | pass |
| Flag keeps the 2:1 proportion | 4,600 ÷ 2,300 = 64 ÷ 32 | pass |

## Choosing a piece

The notebook request picks one piece per notebook from this list: `peace_tower`, `north_canoe`,
`poutine`, `open_book`, `easel_jack_pine`, `flag`, `hockey`, `loonie`. When the request names no
piece, the notebook's theme picks one: civic shows `peace_tower`, history shows `north_canoe`,
culture shows `poutine`, and language shows `open_book`. A notebook created before the library
existed has no piece until `run.py pickpieces` picks one.

## Sources

| ID | Publisher | Page | URL |
|---|---|---|---|
| S1 | House of Commons | House of Commons Procedure and Practice, 3rd ed., chapter 6 | https://www.ourcommons.ca/procedure/procedure-and-practice-3/ch_06_2-e.html |
| S2 | Public Services and Procurement Canada | Peace Tower flags | https://www.canada.ca/en/public-services-procurement/services/infrastructure-buildings/parliamentary-precinct/discover/peace-tower/flags.html |
| S3 | Gradient Wind Engineering | Centre Block rehabilitation, Parliament Hill | https://www.gradientwind.com/projects/centre-block-rehabilitation-parliament-hill/ |
| S4 | Senate of Canada | The Peace Tower: Parliament Hill's soaring sentinel | https://sencanada.ca/en/sencaplus/how-why/the-peace-tower-parliament-hills-soaring-sentinel/ |
| S5 | Public Services and Procurement Canada | National Flag of Canada Day fact sheet | https://www.canada.ca/content/dam/pspc-spac/documents/parliamentary-precinct/jour-drap-flag-day-eng.pdf |
| S6 | Adney and Chapelle, Smithsonian Institution, 1964 | *The Bark Canoes and Skin Boats of North America*, fur-trade canoes | https://www.gutenberg.org/files/50828/50828-h/50828-h.htm |
| S7 | Dictionary of Canadianisms on Historical Principles | canot du nord | https://dchp.arts.ubc.ca/entries/canot%20du%20nord |
| S8 | Sabert | 32 oz kraft paper square bowl | https://sabert.com/products/kraft-32-oz-paper-square-bowl |
| S9 | McCain Foodservice | Shoestring fries, 1/4 in | https://mccainusafoodservice.com/products/details/mccain-shoestring-fries-14-xl/ |
| S10 | McCain Foodservice | Steak fries, 3/8 × 3/4 in | https://mccainusafoodservice.com/products/details/mccain-steak-38-x-34-xl/ |
| S11 | New England Cheesemaking Supply | Poutine | https://cheesemaking.com/blogs/fun-along-the-whey/poutine |
| S12 | Wikipedia | Poutine | https://en.wikipedia.org/wiki/Poutine |
| S13 | Amazon Kindle Direct Publishing | Trim size, bleed, and margins | https://kdp.amazon.com/en_US/help/topic/G201834180 |
| S14 | Amazon Kindle Direct Publishing | Cover calculator and spine width | https://kdp.amazon.com/en_US/help/topic/G201953020 |
| S15 | Art Canada Institute | Tom Thomson, *The Jack Pine* | https://artbooks.artcanada.com/art-books/tom-thomson/key-works/the-jack-pine/ |
| S16 | US Art Supply | E-135 studio easel | https://usartsupply.com/products/usa-e-135 |
| S17 | Jerry's Artarama | Carolina studio easel | https://www.jerrysartarama.com/carolina-studio-easel |
| S18 | Canadian Heritage | Description of the National Flag of Canada | https://www.canada.ca/en/canadian-heritage/services/flag-canada-description.html |
| S19 | National Hockey League | Official Rules 2024-25 | https://media.nhl.com/site/asset/public/ext/2024-25/2024-25Rules.pdf |
| S20 | Royal Canadian Mint | $1 circulation coin | https://www.mint.ca/en/discover/canadian-circulation/1-dollar |
| S21 | Elections Canada | Glossary: ballot box | https://www.elections.ca/content.aspx?section=res&dir=glo&document=index&lang=e |
