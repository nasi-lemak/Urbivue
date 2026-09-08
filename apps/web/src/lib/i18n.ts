import { useEffect, useState } from 'react';

/**
 * Lightweight i18n for the public-facing UI. No library: a keyed dictionary,
 * `{var}` interpolation, and a subscription hook so a language switch
 * re-renders live. Adding a language = adding a column here; keys missing a
 * translation fall back to English, and dynamic server-side names (report
 * categories) fall back to the server's string.
 */

export type Lang = 'en' | 'ms';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ms', label: 'BM' },
];

const LANG_KEY = 'urbivue.lang';

type Entry = { en: string; ms: string };

const DICT: Record<string, Entry> = {
  // Shell
  'portal.tagline': { en: 'City services — public map', ms: 'Perkhidmatan bandar — peta awam' },
  'portal.legend': { en: 'Legend', ms: 'Petunjuk' },
  'legend.toilet': { en: 'Public toilet', ms: 'Tandas awam' },
  'legend.green': {
    en: 'Accessible / river normal',
    ms: 'Mesra OKU / paras sungai normal',
  },
  'legend.amber': {
    en: 'Minor issues / river warning',
    ms: 'Isu kecil / amaran paras sungai',
  },
  'legend.red': {
    en: 'Non-compliant / river danger',
    ms: 'Tidak patuh / bahaya paras sungai',
  },

  // Flood banner
  'banner.danger': {
    en: '⚠ Flood danger: river levels critically high. Avoid low-lying areas.',
    ms: '⚠ Bahaya banjir: paras sungai sangat tinggi. Elakkan kawasan rendah.',
  },
  'banner.warning': {
    en: '⚠ Flood advisory: river levels elevated. Stay alert near waterways.',
    ms: '⚠ Makluman banjir: paras sungai meningkat. Berwaspada berhampiran sungai.',
  },

  // Map popups
  'popup.riverLevel': { en: 'River level', ms: 'Paras sungai' },
  'popup.hours': { en: 'Hours', ms: 'Waktu operasi' },
  'popup.accessibleFixtures': { en: 'Accessible fixtures', ms: 'Kemudahan OKU' },
  'popup.rating': { en: 'Rating', ms: 'Penilaian' },
  'popup.lastCleaned': { en: 'Last cleaned', ms: 'Terakhir dibersihkan' },
  'popup.noRecord': { en: 'no record', ms: 'tiada rekod' },

  // Report form
  'report.title': { en: 'Report an issue', ms: 'Laporkan masalah' },
  'report.category': { en: 'Category', ms: 'Kategori' },
  'report.whatsWrong': { en: "What's wrong?", ms: 'Apakah masalahnya?' },
  'report.describePlaceholder': {
    en: 'Describe the issue (at least 10 characters)',
    ms: 'Terangkan masalah (sekurang-kurangnya 10 aksara)',
  },
  'report.contact': {
    en: 'Phone or email (optional — for status updates)',
    ms: 'Telefon atau e-mel (pilihan — untuk kemas kini status)',
  },
  'report.contactPlaceholder': { en: 'e.g. +60 12-345 6789', ms: 'cth. +60 12-345 6789' },
  'report.pickLocation': { en: 'Pick location on map', ms: 'Pilih lokasi pada peta' },
  'report.tapMap': { en: 'Tap the map…', ms: 'Ketik pada peta…' },
  'report.locationSet': {
    en: '📍 Location set — pick again',
    ms: '📍 Lokasi ditetapkan — pilih semula',
  },
  'report.submit': { en: 'Submit report', ms: 'Hantar laporan' },
  'report.needLocation': {
    en: 'Tap "Pick location", then tap the map.',
    ms: 'Ketik "Pilih lokasi", kemudian ketik pada peta.',
  },
  'report.submitFailed': { en: 'Submit failed', ms: 'Penghantaran gagal' },
  'report.thanks': {
    en: 'Thanks — your report is in.',
    ms: 'Terima kasih — laporan anda telah diterima.',
  },
  'report.thanksDuplicate': {
    en: 'Thanks — this issue was already reported and your report has been linked to it.',
    ms: 'Terima kasih — masalah ini telah pun dilaporkan dan laporan anda telah dikaitkan dengannya.',
  },
  'report.trackingId': { en: 'Tracking ID', ms: 'ID penjejakan' },
  'report.addPhoto': { en: 'Add a photo (optional)', ms: 'Tambah gambar (pilihan)' },
  'report.photoOk': { en: 'Photo attached — thank you.', ms: 'Gambar dilampirkan — terima kasih.' },
  'report.photoFail': { en: 'Photo upload failed.', ms: 'Muat naik gambar gagal.' },
  'report.another': { en: 'Report another', ms: 'Laporkan yang lain' },

  // Tracking
  'track.title': { en: 'Track a report', ms: 'Jejak laporan' },
  'track.check': { en: 'Check status', ms: 'Semak status' },
  'track.status': { en: 'Status', ms: 'Status' },

  // Report statuses (server enum values)
  'status.new': { en: 'new', ms: 'baharu' },
  'status.triaged': { en: 'triaged', ms: 'disaring' },
  'status.in_progress': { en: 'in progress', ms: 'sedang dijalankan' },
  'status.resolved': { en: 'resolved', ms: 'selesai' },
  'status.closed': { en: 'closed', ms: 'ditutup' },
  'status.not found': { en: 'not found', ms: 'tidak dijumpai' },

  // Report categories (registry keys; server name is the fallback)
  'category.blocked_drain': { en: 'Blocked drain', ms: 'Longkang tersumbat' },
  'category.damaged_drain_cover': {
    en: 'Broken or missing drain cover',
    ms: 'Penutup longkang rosak atau hilang',
  },
  'category.street_flooding': { en: 'Street flooding', ms: 'Banjir di jalan' },
  'category.fallen_tree': { en: 'Fallen tree', ms: 'Pokok tumbang' },
  'category.dangerous_tree': { en: 'Dangerous tree', ms: 'Pokok berbahaya' },
  'category.request_pruning': { en: 'Request tree pruning', ms: 'Mohon pemangkasan pokok' },
  'category.dirty_toilet': { en: 'Dirty toilet', ms: 'Tandas kotor' },
  'category.toilet_broken': { en: 'Broken toilet fixtures', ms: 'Kelengkapan tandas rosak' },
  'category.toilet_locked': {
    en: 'Toilet locked in opening hours',
    ms: 'Tandas berkunci waktu operasi',
  },
  'category.street_light_out': {
    en: 'Street light not working',
    ms: 'Lampu jalan tidak berfungsi',
  },
  'category.damaged_light_pole': { en: 'Damaged light pole', ms: 'Tiang lampu rosak' },
  'category.overflowing_bin': { en: 'Overflowing bin', ms: 'Tong sampah melimpah' },
  'category.illegal_dumping': { en: 'Illegal dumping', ms: 'Pembuangan sampah haram' },
  'category.blocked_ramp': { en: 'Blocked ramp', ms: 'Tanjakan OKU terhalang' },
  'category.damaged_tactile_paving': { en: 'Damaged tactile paving', ms: 'Turapan sentuh rosak' },
  'category.broken_lift': { en: 'Broken lift', ms: 'Lif rosak' },
  'category.slope_crack_or_slip': {
    en: 'Slope crack or slip',
    ms: 'Retakan atau runtuhan cerun',
  },
};

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'ms') return saved;
    if (navigator.language?.toLowerCase().startsWith('ms')) return 'ms';
  } catch {
    /* SSR/thumbnail contexts */
  }
  return 'en';
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* fine */
  }
  listeners.forEach((l) => l());
}

/** Translate a key; `fallback` covers dynamic server-provided strings. */
export function t(key: string, fallback?: string): string {
  const entry = DICT[key];
  if (!entry) return fallback ?? key;
  return entry[current] ?? entry.en;
}

export function useI18n(): { t: typeof t; lang: Lang; setLang: (l: Lang) => void } {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { t, lang: current, setLang };
}
