/**
 * GrainShield AI — Gujarati Localization (i18n)
 *
 * Usage:
 *   import { t, setLang, getLang } from "@/lib/i18n";
 *   t("submit_trip")  // returns "ટ્રિપ સબમિટ કરો" in 'gu' mode, "Submit Trip" in 'en'
 *
 * To switch language:
 *   setLang("gu");   // Gujarati
 *   setLang("en");   // English (default)
 *
 * Language preference is persisted in localStorage as "gs_lang".
 */

export type Lang = "en" | "gu";

const STORAGE_KEY = "gs_lang";

let _lang: Lang = "en";

// Initialize from localStorage on module load
if (typeof window !== "undefined") {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "gu" || stored === "en") _lang = stored;
}

export function getLang(): Lang {
  return _lang;
}

export function setLang(lang: Lang): void {
  _lang = lang;
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, lang);
  }
}

// ---------------------------------------------------------------------------
// Translation map — English → Gujarati
// ---------------------------------------------------------------------------
const translations: Record<string, { en: string; gu: string }> = {
  // ── Navigation ────────────────────────────────────────────────────────────
  home: { en: "Home", gu: "હોમ" },
  my_trips: { en: "My Trips", gu: "મારી ટ્રિપ્સ" },
  my_profile: { en: "My Profile", gu: "મારી પ્રોફાઇલ" },
  help_faq: { en: "Help & FAQ", gu: "સહાય અને FAQ" },
  sign_out: { en: "Sign Out", gu: "સાઇન આઉટ" },
  sign_in: { en: "Sign In", gu: "સાઇન ઇન" },

  // ── Upload / Submit Trip ──────────────────────────────────────────────────
  submit_trip: { en: "Submit Trip", gu: "ટ્રિપ સબમિટ કરો" },
  upload_photo: { en: "Upload Photo for Verification", gu: "ચકાસણી માટે ફોટો અપલોડ કરો" },
  vehicle_no: { en: "Vehicle No.", gu: "વાહન નંબર" },
  trip_stage: { en: "Trip Stage", gu: "ટ્રિપ સ્ટેજ" },
  origin: { en: "Origin", gu: "ઉત્પત્તિ સ્થળ" },
  destination: { en: "Destination", gu: "ગંતવ્ય સ્થળ" },
  commodity: { en: "Commodity", gu: "માલ / અનાજ" },
  optional: { en: "optional", gu: "વૈકલ્પિક" },
  required: { en: "required", gu: "જરૂરી" },
  submit: { en: "Submit", gu: "સબમિટ કરો" },
  reset: { en: "Reset", gu: "રીસેટ કરો" },
  submitting: { en: "Submitting…", gu: "સબમિટ થઈ રહ્યું છે…" },
  tap_photo: { en: "Tap to take or choose photo", gu: "ફોટો લેવા અથવા પસંદ કરવા ટેપ કરો" },
  jpg_png: { en: "JPG, PNG, WebP (Max 10MB)", gu: "JPG, PNG, WebP (મહત્તમ 10MB)" },

  // ── Trip stages ───────────────────────────────────────────────────────────
  first_mile: { en: "First Mile — FCI Mandi to Godown", gu: "પ્રથમ માઈલ — FCI મંડી થી ગોડાઉન" },
  last_mile: {
    en: "Last Mile — Godown to Fair Price Shop",
    gu: "છેલ્લો માઈલ — ગોડાઉન થી સસ્તા અનાજ ભંડાર",
  },
  select_stage: { en: "Select Stage", gu: "સ્ટેજ પસંદ કરો" },

  // ── Trip ID ───────────────────────────────────────────────────────────────
  trip_id_auto: {
    en: "Your Trip ID is generated automatically by the system. You do not need to enter one.",
    gu: "તમારો ટ્રિપ ID સિસ્ટમ દ્વારા આપોઆપ જનરેટ થાય છે. તમારે કોઈ ID દાખલ કરવી નથી.",
  },
  your_trip_id: { en: "Your Trip ID", gu: "તમારો ટ્રિપ ID" },
  trip_submitted: { en: "Trip Submitted", gu: "ટ્રિપ સફળ રીતે સબમિટ થઈ" },
  save_trip_id: {
    en: "Save this ID for your records. You can track your trip status in My Trips.",
    gu: "આ ID સાચવી રાખો. 'મારી ટ્રિપ્સ'માં ટ્રેક કરી શકો છો.",
  },
  go_to_status: { en: "Go to Verification Status", gu: "ચકાસણી સ્થિતિ પર જાઓ" },

  // ── My Trips ──────────────────────────────────────────────────────────────
  no_trips: { en: "No trips yet", gu: "હજી સુધી કોઈ ટ્રિપ નથી" },
  trip_code: { en: "Trip ID", gu: "ટ્રિપ ID" },
  status: { en: "Status", gu: "સ્થિતિ" },
  date: { en: "Date", gu: "તારીખ" },
  details: { en: "Details", gu: "વિગત" },

  // ── Verification results ──────────────────────────────────────────────────
  result_pass: { en: "Verified — Pass", gu: "ચકાસણી — પાસ" },
  result_retake: { en: "Retake Required", gu: "ફરી ફોટો આવશ્યક" },
  result_rejected: { en: "Rejected", gu: "નામંજૂર" },
  result_processing: { en: "Processing…", gu: "પ્રક્રિયા ચાલી રહી છે…" },
  result_manual_review: { en: "Under Manual Review", gu: "મેન્યુઅલ સમીક્ષા હેઠળ" },
  retake_photo: { en: "Retake Photo", gu: "ફોટો ફરી લો" },

  // ── Image requirements ────────────────────────────────────────────────────
  img_requirements: { en: "Image Requirements", gu: "છબી આવશ્યકતાઓ" },
  img_clear: { en: "Image must be clear and in focus", gu: "છબી સ્પષ્ટ અને ફોકસ થયેલ હોવી જોઈએ" },
  img_plate: {
    en: "Vehicle number plate must be visible",
    gu: "વાહનની નંબર પ્લેટ દેખાવી જોઈએ",
  },
  img_daylight: {
    en: "Photograph must be taken in daylight",
    gu: "ફોટો દિવસના પ્રકાશમાં લેવો જોઈએ",
  },
  img_size: { en: "File size should not exceed 10MB", gu: "ફાઇલ કદ 10MB થી વધવું ન જોઈએ" },

  // ── Auth ──────────────────────────────────────────────────────────────────
  email: { en: "Email", gu: "ઈ-મેઇલ" },
  password: { en: "Password", gu: "પાસવર્ડ" },
  full_name: { en: "Full Name", gu: "પૂરું નામ" },
  register: { en: "Register", gu: "નોંધણી કરો" },
  forgot_password: { en: "Forgot Password?", gu: "પાસવર્ડ ભૂલ્યા?" },
  reset_password: { en: "Reset Password", gu: "પાસવર્ડ ફરીથી સેટ કરો" },

  // ── Profile ───────────────────────────────────────────────────────────────
  full_name_label: { en: "Full Name", gu: "પૂરું નામ" },
  phone: { en: "Phone", gu: "ફોન" },
  district: { en: "District", gu: "જિલ્લો" },
  save: { en: "Save", gu: "સાચવો" },
  change_password: { en: "Change Password", gu: "પાસવર્ડ બદલો" },

  // ── Errors ────────────────────────────────────────────────────────────────
  error_required: { en: "This field is required", gu: "આ ક્ષેત્ર ભરવું ફરજિયાત છે" },
  error_vehicle: { en: "Invalid vehicle number format", gu: "ખોટો વાહન નંબર ફોર્મેટ" },
  error_stage: { en: "Please select a trip stage", gu: "કૃપા કરીને ટ્રિપ સ્ટેજ પસંદ કરો" },
  error_photo: {
    en: "Please select or capture a photograph before submitting",
    gu: "સબમિટ કરતા પહેલાં ફોટો પસંდ કરો અથવા ખેંચો",
  },
  error_submit: {
    en: "Submission failed. Please try again.",
    gu: "સબમિટ નિષ્ફળ. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },

  // ── Checkpoints ───────────────────────────────────────────────────────────
  cp1_desc: {
    en: "CP1 — Departure: Photograph the vehicle at the FCI Mandi / warehouse before it departs.",
    gu: "CP1 — પ્રસ્થાન: FCI મંડી / વેરહાઉસ પર વાહન છોડ્યા પહેલાં ફોટો લો.",
  },
  cp2_desc: {
    en: "CP2 — Arrival: Photograph the vehicle at the godown / storage depot upon arrival.",
    gu: "CP2 — આગમન: ગોડાઉન / ભંડારણ ડેપો પર આવ્યા પછી ફોટો લો.",
  },
  cp3_desc: {
    en: "CP3 — Departure: Photograph the vehicle at the godown before it leaves for the Fair Price Shop.",
    gu: "CP3 — પ્રસ્થાન: સસ્તા અનાજ ભંડાર તરફ જતા પહેલાં ગોડાઉન ખાતે ફોટો લો.",
  },
  cp4_desc: {
    en: "CP4 — Delivery: Photograph the vehicle at the Fair Price Shop upon final delivery.",
    gu: "CP4 — ડિલિવરી: અંતિમ ડિલિવરી સમયે સસ્તા અનાજ ભંડાર ખાતે ફોટો લો.",
  },
};

/**
 * Translate a key into the current language.
 * Falls back to the key itself if no translation found.
 */
export function t(key: string): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[_lang] ?? entry.en ?? key;
}

/**
 * Returns all available keys (useful for testing completeness).
 */
export function allKeys(): string[] {
  return Object.keys(translations);
}

/**
 * Returns a language-toggle label (shown in UI to switch language).
 */
export function langToggleLabel(): string {
  return _lang === "en" ? "ગુજરાતી" : "English";
}
