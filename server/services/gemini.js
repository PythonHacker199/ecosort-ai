// Optional Google Gemini vision classification.
// Runs on the server so the API key is never exposed to browsers.
const { DUSTBINS } = require('../data/wasteData');

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 20000;

const PROMPT = `
You are an expert Smart Waste Segregation AI. Analyze this image of waste/item.
Identify what the item is and categorize it for municipal waste segregation.
Return your response STRICTLY as a valid JSON object with the following fields:
{
  "name": "Item Name (e.g. Plastic Water Bottle, Banana Peel, Potato Chips Packet)",
  "category": "Organic / Wet Waste" OR "Dry Recyclable Waste" OR "Dry Non-Recyclable (Landfill)" OR "Electronic Waste" OR "Hazardous & Biomedical Waste",
  "binId": "green" (for organic/wet) OR "blue" (for dry recyclables) OR "grey" (for non-recyclable landfill) OR "red" (for hazardous/sanitary) OR "orange" (for e-waste),
  "isRecyclable": true or false,
  "isCompostable": true or false,
  "recyclabilityStatus": "e.g. Highly Recyclable (PET #1) / Compostable / Non-Recyclable",
  "decompositionTime": "estimated time, e.g. 450 years / 2-4 weeks",
  "material": "Material composition",
  "preparationTip": "Specific segregation step, e.g. Rinse and flatten, Keep cap on",
  "ecoFact": "An interesting environmental fact about this material",
  "confidence": 0.95
}
Return pure JSON only.
`;

const BIN_ICONS = { green: 'leaf', blue: 'recycle', grey: 'trash-2', red: 'alert-triangle', orange: 'cpu' };

// Model output is untrusted: coerce every field to a bounded string/boolean
function text(value, fallback, maxLength = 300) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().slice(0, maxLength);
}

function normalizeGeminiItem(parsed) {
  const binId = Object.hasOwn(DUSTBINS, parsed.binId) ? parsed.binId : 'grey';
  const isRecyclable = parsed.isRecyclable === true;
  const isCompostable = parsed.isCompostable === true;
  const confidence = Number(parsed.confidence);

  return {
    item: {
      id: null,
      name: text(parsed.name, 'Unidentified Item', 120),
      category: text(parsed.category, DUSTBINS[binId].category, 120),
      binId,
      isRecyclable,
      isCompostable,
      recyclabilityStatus: text(parsed.recyclabilityStatus, isRecyclable ? 'Recyclable' : 'Non-Recyclable', 120),
      decompositionTime: text(parsed.decompositionTime, 'Varies', 120),
      material: text(parsed.material, 'Mixed materials'),
      preparationTip: text(parsed.preparationTip, 'Follow standard local municipal segregation rules.'),
      ecoFact: text(parsed.ecoFact, 'Segregating at source prevents up to 70% of waste from reaching landfills.'),
      icon: BIN_ICONS[binId]
    },
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.9,
    source: 'gemini'
  };
}

async function classifyWithGemini({ imageBuffer, mimeType, apiKey, model }) {
  const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: imageBuffer.toString('base64') } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: 'application/json'
      }
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('No content received from Gemini');

  const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
  return normalizeGeminiItem(JSON.parse(cleaned));
}

module.exports = { classifyWithGemini, normalizeGeminiItem };
