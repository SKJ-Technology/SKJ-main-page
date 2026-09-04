// Reading an Italian menu.
//
// This is a glossary rather than a translator on purpose. Menu language is
// jargon: OCR plus general machine translation renders "crudo" as "raw" and
// leaves you none the wiser, and "coperto" as "covered". These are the words
// that actually appear, with what they mean in practice.
//
// Offline. No requests at all.

export const MENU_SECTIONS = [
  {
    id: 'structure', label: 'How a menu is built',
    note: 'You are not expected to order every course. Two is normal, and nobody minds.',
    terms: [
      ['Coperto', 'A per-person cover charge, usually €1–3. Legal, on the bill, and not a tip.'],
      ['Servizio', 'Service charge. If it appears, tipping on top is unnecessary.'],
      ['Antipasto', 'Starter. Cured meats, cheese, fried bits.'],
      ['Primo', 'First course — pasta, risotto or soup. Not a starter, a full plate.'],
      ['Secondo', 'Main — meat or fish, usually served alone.'],
      ['Contorno', 'Side dish, ordered separately. A secondo comes with nothing.'],
      ['Dolce', 'Dessert.'],
      ['Menù del giorno', "Today's set menu, often the best value at lunch."],
      ['Menù turistico', 'Fixed tourist menu. Cheap, rarely good.'],
      ['Degustazione', 'Tasting menu, several small courses.'],
      ['Sfizi / Stuzzichini', 'Small nibbles to share.'],
      ['Su prenotazione', 'Must be ordered in advance.'],
      ['Secondo disponibilità', 'Subject to availability.'],
    ],
  },
  {
    id: 'cooking', label: 'How it is cooked',
    terms: [
      ['Crudo', 'Raw or cured — as in prosciutto crudo, or raw fish.'],
      ['Cotto', 'Cooked. Prosciutto cotto is ordinary ham.'],
      ['Alla griglia', 'Grilled.'],
      ['Al forno', 'Baked in the oven.'],
      ['Fritto', 'Fried.'],
      ['In umido', 'Stewed.'],
      ['Al vapore', 'Steamed.'],
      ['Ripieno', 'Stuffed.'],
      ['Gratinato', 'Browned with breadcrumbs or cheese on top.'],
      ['Alla brace', 'Cooked over embers.'],
      ['Al sangue / Media / Ben cotta', 'Rare / medium / well done.'],
      ['Affumicato', 'Smoked.'],
      ['Sott’olio', 'Preserved in oil.'],
      ['Impanato', 'Breadcrumbed.'],
    ],
  },
  {
    id: 'meat', label: 'Meat',
    terms: [
      ['Manzo', 'Beef.'], ['Vitello', 'Veal.'], ['Maiale', 'Pork.'],
      ['Agnello', 'Lamb.'], ['Pollo', 'Chicken.'], ['Tacchino', 'Turkey.'],
      ['Coniglio', 'Rabbit — common and unremarkable here.'],
      ['Cinghiale', 'Wild boar, often in a ragù.'],
      ['Salsiccia', 'Sausage.'], ['Prosciutto', 'Ham, crudo cured or cotto cooked.'],
      ['Speck', 'Smoked cured ham, a northern thing.'],
      ['Bresaola', 'Air-dried beef, sliced thin.'],
      ['Guanciale', 'Cured pork cheek — what carbonara actually uses.'],
      ['Trippa', 'Tripe.'], ['Fegato', 'Liver.'],
      ['Ossobuco', 'Braised veal shank.'],
      ['Tagliata', 'Sliced grilled steak.'],
      ['Cotoletta', 'Breaded cutlet.'],
    ],
  },
  {
    id: 'fish', label: 'Fish and seafood',
    note: 'Frozen fish must be declared, usually with an asterisk and "surgelato" in the small print.',
    terms: [
      ['Pesce', 'Fish.'], ['Frutti di mare', 'Seafood in general.'],
      ['Vongole', 'Clams.'], ['Cozze', 'Mussels.'], ['Gamberi', 'Prawns.'],
      ['Scampi', 'Langoustines.'], ['Calamari', 'Squid.'], ['Polpo', 'Octopus.'],
      ['Seppia', 'Cuttlefish — the ink in black pasta.'],
      ['Branzino', 'Sea bass.'], ['Orata', 'Sea bream.'], ['Tonno', 'Tuna.'],
      ['Salmone', 'Salmon.'], ['Baccalà', 'Salt cod.'], ['Acciughe', 'Anchovies.'],
      ['Fritto misto', 'Mixed fried seafood.'],
      ['Surgelato', 'Frozen. Must be declared on the menu.'],
    ],
  },
  {
    id: 'pasta', label: 'Pasta and rice',
    terms: [
      ['Al dente', 'Firm to the bite. This is correct, not undercooked.'],
      ['Ragù', 'Slow-cooked meat sauce. Bolognese is one kind of ragù.'],
      ['Cacio e pepe', 'Pecorino and black pepper. No cream.'],
      ['Amatriciana', 'Tomato, guanciale, pecorino.'],
      ['Carbonara', 'Egg, pecorino, guanciale, pepper. No cream, ever.'],
      ['Aglio, olio e peperoncino', 'Garlic, oil and chilli.'],
      ['Pesto', 'Basil, pine nuts, garlic, parmesan — contains nuts.'],
      ['Arrabbiata', 'Spicy tomato.'],
      ['Gnocchi', 'Potato dumplings.'],
      ['Risotto', 'Rice cooked slowly. Often takes 20 minutes, made to order.'],
      ['Ripieni', 'Filled pasta — ravioli, tortellini, agnolotti.'],
      ['In bianco', 'Plain, no tomato sauce.'],
    ],
  },
  {
    id: 'veg', label: 'Vegetables and cheese',
    terms: [
      ['Verdure', 'Vegetables.'], ['Melanzane', 'Aubergine.'], ['Zucchine', 'Courgette.'],
      ['Peperoni', 'Bell peppers — not spicy sausage.'],
      ['Funghi', 'Mushrooms.'], ['Carciofi', 'Artichokes.'], ['Spinaci', 'Spinach.'],
      ['Rucola', 'Rocket.'], ['Fagioli', 'Beans.'], ['Ceci', 'Chickpeas.'],
      ['Patate', 'Potatoes.'], ['Insalata mista', 'Mixed salad.'],
      ['Mozzarella di bufala', 'Buffalo mozzarella, softer and tangier.'],
      ['Pecorino', 'Hard sheep cheese, salty.'],
      ['Grana / Parmigiano', 'Hard aged cow cheese.'],
      ['Gorgonzola', 'Blue cheese.'], ['Stracciatella', 'Creamy shredded mozzarella.'],
      ['Burrata', 'Mozzarella shell with cream inside.'],
    ],
  },
  {
    id: 'drink', label: 'Drinks',
    terms: [
      ['Acqua naturale', 'Still water.'], ['Acqua frizzante', 'Sparkling water.'],
      ['Caffè', 'Espresso. Just "un caffè" gets you a single shot.'],
      ['Caffè americano', 'Espresso diluted with hot water.'],
      ['Cappuccino', 'Milky coffee. Ordering one after lunch marks you out, but nobody will refuse.'],
      ['Macchiato', 'Espresso with a dash of milk.'],
      ['Corretto', 'Espresso "corrected" with grappa or sambuca.'],
      ['Vino della casa', 'House wine, sold by the quarter, half or litre. Usually fine and cheap.'],
      ['Sfuso', 'Loose, unbottled — of house wine.'],
      ['Calice', 'A glass of wine.'], ['Bottiglia', 'Bottle.'],
      ['Birra alla spina', 'Draught beer.'], ['Media / Piccola', 'Medium (0.4l) / small (0.2l).'],
      ['Amaro', 'Bitter herbal digestivo, drunk after eating.'],
      ['Spritz', 'Aperol or Campari with prosecco and soda.'],
      ['Coperto incluso', 'Cover charge already included.'],
    ],
  },
  {
    id: 'allergy', label: 'Allergies and diet',
    note: 'Say it before ordering, not after. "Sono allergico a…" — I am allergic to…',
    terms: [
      ['Senza glutine', 'Gluten free.'],
      ['Celiachia', 'Coeliac disease — widely understood in Italy.'],
      ['Lattosio', 'Lactose.'], ['Frutta secca', 'Nuts.'], ['Arachidi', 'Peanuts.'],
      ['Uova', 'Eggs.'], ['Crostacei', 'Shellfish.'], ['Molluschi', 'Molluscs.'],
      ['Soia', 'Soy.'], ['Sedano', 'Celery.'], ['Senape', 'Mustard.'],
      ['Vegetariano', 'Vegetarian.'], ['Vegano', 'Vegan.'],
      ['Contiene', 'Contains.'], ['Può contenere tracce di', 'May contain traces of.'],
    ],
  },
  {
    id: 'bill', label: 'Paying',
    terms: [
      ['Il conto', 'The bill. It will not come until you ask.'],
      ['Scontrino', 'Receipt. Keep it — legally you should leave with one.'],
      ['Bancomat', 'Debit card, and also the cash machine.'],
      ['POS', 'Card terminal. "Avete il POS?" — do you take cards?'],
      ['Contanti', 'Cash.'],
      ['Alla romana', 'Splitting the bill evenly.'],
      ['Asporto / Da portare via', 'Takeaway.'],
      ['Prezzo al kg', 'Price per kilo — common for fish, so ask what a portion costs.'],
      ['Etto', '100 grams. Fish and meat are often priced per etto.'],
    ],
  },
];

export const MENU_TERM_COUNT = MENU_SECTIONS.reduce((n, s) => n + s.terms.length, 0);

/** Case- and accent-insensitive search across every term. */
export function searchMenu(query) {
  const fold = (t) => t.toLowerCase()
    .replace(/[àá]/g, 'a').replace(/[èé]/g, 'e').replace(/[ìí]/g, 'i')
    .replace(/[òó]/g, 'o').replace(/[ùú]/g, 'u').replace(/[’']/g, '');
  const q = fold(query.trim());
  if (q.length < 2) return [];

  const out = [];
  for (const section of MENU_SECTIONS) {
    for (const [term, meaning] of section.terms) {
      const ft = fold(term);
      // Terms can be several words ("Prosciutto crudo"), so score each word too.
      const words = ft.split(/[\s/,]+/);
      let score = 0;
      if (ft === q) score = 100;
      else if (words.includes(q)) score = 90;
      else if (words.some((w) => w.startsWith(q))) score = 70;
      else if (ft.includes(q)) score = 40;
      else if (fold(meaning).includes(q)) score = 10;
      if (score) out.push({ term, meaning, section: section.label, score });
    }
  }
  out.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  return out;
}
