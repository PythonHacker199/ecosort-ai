// Waste classification engine: text search, fuzzy matching, rule-based
// fallback for unknown items, and mapping of image-model labels to items.
const { WASTE_ITEMS, IMAGENET_WASTE_MAP } = require('../data/wasteData');

const ITEMS_BY_ID = new Map(WASTE_ITEMS.map(item => [item.id, item]));

function getItemById(id) {
  return ITEMS_BY_ID.get(id) || null;
}

function capitalizeWords(str) {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

// ----------------------------------------------------
// Text search: exact -> keyword -> fuzzy -> material rules
// ----------------------------------------------------
function searchWasteByText(query) {
  if (!query || typeof query !== 'string') return null;
  const cleanQuery = query.toLowerCase().trim();
  if (cleanQuery.length === 0) return null;

  for (const item of WASTE_ITEMS) {
    if (item.id === cleanQuery || item.name.toLowerCase() === cleanQuery) {
      return { item, confidence: 1.0, matchType: 'exact' };
    }
  }

  for (const item of WASTE_ITEMS) {
    if (item.keywords.includes(cleanQuery)) {
      return { item, confidence: 0.98, matchType: 'keyword_exact' };
    }
  }

  let bestCandidate = null;
  let highestScore = 0;
  const queryWords = cleanQuery.split(/\s+/);

  for (const item of WASTE_ITEMS) {
    let score = 0;
    const nameLower = item.name.toLowerCase();

    if (nameLower.includes(cleanQuery)) {
      score += 0.8;
      if (nameLower.startsWith(cleanQuery)) score += 0.15;
    }

    for (const kw of item.keywords) {
      if (kw.includes(cleanQuery) || cleanQuery.includes(kw)) {
        score = Math.max(score, 0.75);
      }
      const kwWords = kw.split(/\s+/);
      const common = queryWords.filter(w => kwWords.includes(w) && w.length > 2);
      if (common.length > 0) {
        score = Math.max(score, 0.5 + common.length * 0.15);
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestCandidate = item;
    }
  }

  if (bestCandidate && highestScore >= 0.5) {
    return { item: bestCandidate, confidence: Math.min(0.95, highestScore), matchType: 'fuzzy' };
  }

  return guessWasteByMaterialRules(cleanQuery);
}

// Fallback rule engine when an item isn't in the knowledge base
function guessWasteByMaterialRules(query) {
  const q = query.toLowerCase();
  const name = capitalizeWords(query);

  if (/fruit|veg|peel|food|leaf|leaves|flower|rotten|bread|meat|curry|rice|seed|tea|coffee|grass|compost|dung|egg/i.test(q)) {
    return {
      item: {
        id: 'generic-organic',
        name,
        category: 'Organic / Wet Waste',
        binId: 'green',
        isRecyclable: false,
        isCompostable: true,
        recyclabilityStatus: 'Compostable (Organic)',
        badgeColor: 'green',
        decompositionTime: '2 to 12 weeks',
        material: 'Organic biodegradable matter',
        preparationTip: 'Discard directly into Green Bin without plastic bags.',
        ecoFact: 'Organic food scraps produce rich fertilizer through composting.',
        icon: 'leaf'
      },
      confidence: 0.75,
      matchType: 'heuristic'
    };
  }

  if (/battery|cell|phone|charger|wire|cable|laptop|mouse|keyboard|screen|headphone|electronic|circuit|bulb|earphone|plug|remote/i.test(q)) {
    return {
      item: {
        id: 'generic-ewaste',
        name,
        category: 'Electronic Waste (E-Waste)',
        binId: 'orange',
        isRecyclable: true,
        isCompostable: false,
        recyclabilityStatus: 'E-Waste (Special Center)',
        badgeColor: 'amber',
        decompositionTime: 'Hundreds of years',
        material: 'Electronic circuitry, precious metals & plastics',
        preparationTip: 'Never throw in general trash. Bring to an authorized e-waste collection center.',
        ecoFact: 'E-waste contains recoverable gold, copper, and silver.',
        icon: 'cpu'
      },
      confidence: 0.8,
      matchType: 'heuristic'
    };
  }

  if (/medicine|pill|tablet|syringe|needle|bandage|diaper|sanitary|chemical|poison|pesticide|paint|thinner|bleach/i.test(q)) {
    return {
      item: {
        id: 'generic-hazardous',
        name,
        category: 'Hazardous & Biomedical Waste',
        binId: 'red',
        isRecyclable: false,
        isCompostable: false,
        recyclabilityStatus: 'Hazardous Waste',
        badgeColor: 'red',
        decompositionTime: 'Decades to centuries',
        material: 'Toxic chemical or biohazardous material',
        preparationTip: 'Wrap safely and drop into Red / Biomedical collection bin.',
        ecoFact: 'Proper disposal prevents toxic pollution of soil and drinking water.',
        icon: 'alert-triangle'
      },
      confidence: 0.82,
      matchType: 'heuristic'
    };
  }

  if (/bottle|can|box|carton|paper|glass|jar|cardboard|tin|foil|aluminum|metal|plastic/i.test(q)) {
    if (/chip|wrapper|styrofoam|thermocol|straw|soiled|greasy|pouch/i.test(q)) {
      return {
        item: {
          id: 'generic-residual',
          name,
          category: 'Dry Non-Recyclable (Landfill)',
          binId: 'grey',
          isRecyclable: false,
          isCompostable: false,
          recyclabilityStatus: 'Non-Recyclable',
          badgeColor: 'red',
          decompositionTime: '100+ years',
          material: 'Multi-layer composite / non-recyclable polymer',
          preparationTip: 'Place in Grey / Black Dry Non-Recyclable Bin.',
          ecoFact: 'Reducing single-use packaging helps decrease landfill buildup.',
          icon: 'trash-2'
        },
        confidence: 0.72,
        matchType: 'heuristic'
      };
    }

    return {
      item: {
        id: 'generic-recyclable',
        name,
        category: 'Dry Recyclable Waste',
        binId: 'blue',
        isRecyclable: true,
        isCompostable: false,
        recyclabilityStatus: 'Recyclable (Clean & Dry)',
        badgeColor: 'blue',
        decompositionTime: '50 to 500 years',
        material: 'Recyclable plastic / paper / metal / glass',
        preparationTip: 'Clean, rinse and dry before placing into Blue Recyclable Bin.',
        ecoFact: 'Recycling helps reduce greenhouse gas emissions and resource depletion.',
        icon: 'recycle'
      },
      confidence: 0.75,
      matchType: 'heuristic'
    };
  }

  return null;
}

// Autocomplete: items whose name or keywords contain the query
function suggestItems(query, limit = 5) {
  const clean = (query || '').toLowerCase().trim();
  if (clean.length < 2) return [];
  return WASTE_ITEMS
    .filter(it => it.name.toLowerCase().includes(clean) || it.keywords.some(k => k.includes(clean)))
    .slice(0, limit)
    .map(it => ({ id: it.id, name: it.name, binId: it.binId }));
}

// ----------------------------------------------------
// Map image-model predictions (e.g. MobileNet labels) to waste items
// predictions: [{ className: 'water bottle', probability: 0.83 }, ...]
// ----------------------------------------------------
function classifyFromLabels(predictions) {
  const mapped = [];

  for (const pred of predictions) {
    const rawClass = pred.className.toLowerCase();
    let foundItem = null;

    for (const [key, itemId] of Object.entries(IMAGENET_WASTE_MAP)) {
      if (rawClass.includes(key)) {
        foundItem = getItemById(itemId);
        if (foundItem) break;
      }
    }

    if (!foundItem) {
      const searchResult = searchWasteByText(rawClass.split(',')[0]);
      if (searchResult) foundItem = searchResult.item;
    }

    if (foundItem && !mapped.some(r => r.item.id === foundItem.id)) {
      mapped.push({
        item: foundItem,
        confidence: pred.probability,
        rawLabel: pred.className,
        source: 'mobilenet'
      });
    }
  }

  if (mapped.length === 0) return null;
  return { primary: mapped[0], alternatives: mapped.slice(1) };
}

module.exports = {
  getItemById,
  searchWasteByText,
  suggestItems,
  classifyFromLabels
};
