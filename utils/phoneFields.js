/**
 * Normalize phone-related form fields so stored values include a leading country code (+E.164 style).
 * Handles common intl-tel-input / Webflow patterns: hidden "_full" fields and separate dial-code keys.
 */

const FULL_SUFFIXES = ["_full", "-full", "_international", "_e164", "_complete"];

function isPhoneLikeFieldKey(key) {
  const k = String(key || "").toLowerCase();
  if (!k) return false;
  if (/(^|[-_])(phone|tel|mobile|cell|whatsapp)([-_]|$)/i.test(k)) return true;
  if (/contact/.test(k) && /(number|no|phone|tel|mobile)/.test(k)) return true;
  return false;
}

function stripNonDigits(s) {
  return String(s == null ? "" : s).replace(/\D/g, "");
}

function toPlusDialDigits(rawDial) {
  const digits = stripNonDigits(rawDial);
  if (!digits) return "";
  return `+${digits}`;
}

function looksLikeE164(value) {
  const s = String(value == null ? "" : value).replace(/\s/g, "");
  return /^\+[1-9]\d{6,14}$/.test(s);
}

function preferFullPhoneVariantFields(data) {
  if (!data || typeof data !== "object") return;

  for (const key of Object.keys(data)) {
    for (const suf of FULL_SUFFIXES) {
      if (!key.endsWith(suf)) continue;
      const base = key.slice(0, -suf.length);
      if (!base) continue;

      const fullVal = data[key];
      if (typeof fullVal !== "string" || !looksLikeE164(fullVal)) continue;

      const cur = data[base];
      const curStr = cur == null ? "" : String(cur);

      if (looksLikeE164(curStr)) {
        delete data[key];
        continue;
      }

      data[base] = fullVal;
      delete data[key];
    }
  }
}

function mergeDialCodeCompanionFields(data) {
  if (!data || typeof data !== "object") return;

  const keys = Object.keys(data);
  const companionRe =
    /^(.+?)[_\-](country|countrycode|country_code|country-code|dialcode|dial_code|dial|prefix)$/i;

  for (const key of keys) {
    const m = key.match(companionRe);
    if (!m) continue;

    const base = m[1];
    if (!isPhoneLikeFieldKey(base)) continue;
    if (!Object.prototype.hasOwnProperty.call(data, base)) continue;

    const baseVal = data[base];
    if (Array.isArray(baseVal)) continue;

    const baseStr = baseVal == null ? "" : String(baseVal).trim();
    if (!baseStr) continue;
    if (looksLikeE164(baseStr)) {
      delete data[key];
      continue;
    }

    const dialRaw = data[key];
    const dialPlus = toPlusDialDigits(dialRaw);
    const nationalDigits = stripNonDigits(baseStr);
    if (!dialPlus || !nationalDigits) continue;

    data[base] = `${dialPlus}${nationalDigits}`;
    delete data[key];
  }
}

/**
 * Mutates `data` in place (plain object from multer/express body).
 */
function normalizePhoneFieldsInFormData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;

  preferFullPhoneVariantFields(data);
  mergeDialCodeCompanionFields(data);
  return data;
}

module.exports = {
  normalizePhoneFieldsInFormData,
};
