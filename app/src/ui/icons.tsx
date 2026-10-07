// Icon paths copied from the approved design (design/app-proposal/build.mjs), 24x24, 1.75 stroke.
import React from "react";
import { SvgXml } from "react-native-svg";

export const ICONS = {
  home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
  leaders: '<path d="M3.5 20.5h17M5.5 20.5v-6h4v6M10 20.5V8h4v12.5M14.5 20.5v-9h4v9"/>',
  feed: '<path d="M13.2 2.8 5 13.5h6.2l-1 7.7 8.3-10.8h-6.3z"/>',
  positions: '<path d="M11 3.6a8.5 8.5 0 1 0 9.4 9.4H11z"/><path d="M14 3.2a8.5 8.5 0 0 1 6.8 6.8H14z"/>',
  back: '<path d="M19.5 12h-15M10.5 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6A2 2 0 0 0 4 6v7.5a2 2 0 0 0 2 2h2.5"/>',
  ext: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  fp: '<path d="M7.6 4.6A8.6 8.6 0 0 1 20.4 12v1"/><path d="M3.6 15.5a14 14 0 0 0 .4-3.5 8 8 0 0 1 1.6-4.8"/><path d="M6.6 19.2A13 13 0 0 0 8 12a4 4 0 0 1 8 0v1.5"/><path d="M12 12v1.5a17 17 0 0 1-2.2 8.2"/><path d="M15.8 17a22 22 0 0 1-1.4 4.3"/><path d="M19.6 16.8a20 20 0 0 1-.6 2.6"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="M12 3l7.5 3v5.2c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrdown: '<path d="M12 4.5v15M6 13.5l6 6 6-6"/>',
  arrup: '<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>',
  tune: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.1"/>',
  warn: '<path d="M10.3 4.2 2.9 17.4A2 2 0 0 0 4.6 20.4h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 16.8v.1"/>',
  wifioff: '<path d="M3 3l18 18M8.6 16.4a4.8 4.8 0 0 1 6.3-.5M5.2 12.9a9.6 9.6 0 0 1 4.6-2.5M18.8 12.9a9.7 9.7 0 0 0-2.1-1.5M2 9a14.5 14.5 0 0 1 4.3-2.8M22 9a14.6 14.6 0 0 0-10.4-3.5M12 20v.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  key: '<circle cx="8" cy="15.5" r="4.5"/><path d="M11.2 12.3 20 3.5M17 6.5l2.5 2.5M14.5 9l2 2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
  doc: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  wallet: '<path d="M4 7.5h15a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M4 7.5V6.5A2 2 0 0 1 6 4.5h10.5v3M16 14h.1"/>',
  share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 0-2.4 5.9"/><path d="M20.5 4.5v7h-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  bksp: '<path d="M9 5.5h10.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3 12z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
  tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.4 1.4 0 0 1 0 2l-7.1 7.1a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>',
  layers: '<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5"/>',
  send: '<path d="M20.5 3.5 10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4z"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  split: '<path d="M4 6h16M4 12h10M4 18h6"/><path d="M17 15l3 3-3 3"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  list: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.1M8 16.5h.1"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  img: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-5-5-9 9"/>',
  more: '<circle cx="12" cy="5.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18.5" r="1.2"/>',
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24, color, strokeWidth = 1.75 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const xml = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} />;
}
