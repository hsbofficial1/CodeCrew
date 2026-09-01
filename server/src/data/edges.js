/**
 * Multimodal corridor network for the NER.
 *
 * ROAD links follow real National Highway / state corridors and carry the NH
 * number in `ref`. RAIL links follow the Northeast Frontier Railway network.
 * WATER links follow NW-2 (Brahmaputra) and NW-16 (Barak). AIR links follow
 * scheduled + UDAN-RCS sectors out of the Guwahati and Kolkata hubs.
 *
 * `km` is given where the road distance is well known; otherwise routing derives
 * it from the great-circle distance times a terrain winding factor (see graph.js).
 *
 * Susceptibility fields are 0..1 priors for the physical hazard model:
 *   landslide - slope + geology + documented blockage history on that corridor
 *   flood     - low-lying / river-basin exposure
 * They are the demo's own layer; see README "Data provenance".
 */

/**
 * @param {string} from
 * @param {string} to
 * @param {'road'|'rail'|'water'|'air'} mode
 * @param {object} attrs
 */
const E = (from, to, mode, attrs = {}) => ({
  from,
  to,
  mode,
  ref: attrs.ref ?? null,
  name: attrs.name ?? null,
  km: attrs.km ?? null,
  terrain: attrs.terrain ?? 'plain', // plain | hill | high_hill
  lanes: attrs.lanes ?? 2, // 1 = single, 2 = intermediate/two-lane, 4 = four-lane
  surface: attrs.surface ?? 0.75, // 0..1 pavement condition index
  allWeather: attrs.allWeather ?? true,
  bridgeLoadClassT: attrs.bridgeLoadClassT ?? 40,
  maxGradientPct: attrs.maxGradientPct ?? 4,
  nightTravelSafe: attrs.nightTravelSafe ?? true,
  landslideSusceptibility: attrs.landslideSusceptibility ?? 0.1,
  floodSusceptibility: attrs.floodSusceptibility ?? 0.15,
  commercialVolume: attrs.commercialVolume ?? 0.5, // 0..1, drives congestion
  seasonalClosure: attrs.seasonalClosure ?? null, // e.g. { months:[12,1,2], reason:'snow' }
});

export const EDGES = [
  // ============================== ROAD: Assam trunk (NH-27 East-West Corridor)
  E('SLG', 'BNG', 'road', { ref: 'NH-27', name: 'Siliguri - Bongaigaon (Siliguri Corridor)', km: 236, lanes: 4, surface: 0.86, commercialVolume: 0.95, floodSusceptibility: 0.4 }),
  E('BNG', 'GHY', 'road', { ref: 'NH-27', name: 'Bongaigaon - Guwahati', km: 178, lanes: 4, surface: 0.88, commercialVolume: 0.9, floodSusceptibility: 0.35 }),
  E('DBR', 'BNG', 'road', { ref: 'NH-17', name: 'Dhubri - Bongaigaon', km: 92, lanes: 2, surface: 0.66, commercialVolume: 0.45, floodSusceptibility: 0.62 }),
  E('GHY', 'NGN', 'road', { ref: 'NH-27', name: 'Guwahati - Nagaon', km: 123, lanes: 4, surface: 0.85, commercialVolume: 0.88, floodSusceptibility: 0.45 }),
  E('NGN', 'GLG', 'road', { ref: 'NH-715', name: 'Nagaon - Golaghat', km: 148, lanes: 2, surface: 0.74, commercialVolume: 0.62, floodSusceptibility: 0.5 }),
  E('GLG', 'JRH', 'road', { ref: 'NH-715', name: 'Golaghat - Jorhat', km: 55, lanes: 2, surface: 0.78, commercialVolume: 0.6, floodSusceptibility: 0.42 }),
  E('JRH', 'DIB', 'road', { ref: 'NH-715', name: 'Jorhat - Dibrugarh', km: 136, lanes: 2, surface: 0.76, commercialVolume: 0.6, floodSusceptibility: 0.48 }),
  E('DIB', 'TSK', 'road', { ref: 'NH-37', name: 'Dibrugarh - Tinsukia', km: 48, lanes: 2, surface: 0.8, commercialVolume: 0.58, floodSusceptibility: 0.4 }),
  E('NGN', 'LMG', 'road', { ref: 'NH-36', name: 'Nagaon - Lumding', km: 78, lanes: 2, surface: 0.7, commercialVolume: 0.45, floodSusceptibility: 0.35 }),
  E('GHY', 'TEZ', 'road', { ref: 'NH-15', name: 'Guwahati - Tezpur (north bank)', km: 181, lanes: 2, surface: 0.75, commercialVolume: 0.55, floodSusceptibility: 0.55 }),
  E('TEZ', 'NLP', 'road', { ref: 'NH-15', name: 'Tezpur - North Lakhimpur', km: 172, lanes: 2, surface: 0.68, commercialVolume: 0.4, floodSusceptibility: 0.66 }),
  E('NLP', 'DIB', 'road', { ref: 'NH-15 / Bogibeel', name: 'North Lakhimpur - Dibrugarh via Bogibeel bridge', km: 63, lanes: 2, surface: 0.82, bridgeLoadClassT: 70, commercialVolume: 0.5, floodSusceptibility: 0.5 }),
  E('TEZ', 'NGN', 'road', { ref: 'NH-37 / Kaliabor', name: 'Tezpur - Nagaon via Kaliabhomora bridge', km: 74, lanes: 2, surface: 0.78, bridgeLoadClassT: 55, commercialVolume: 0.5, floodSusceptibility: 0.5 }),
  E('GHY', 'BYR', 'road', { ref: 'NH-6', name: 'Guwahati - Byrnihat', km: 32, lanes: 4, surface: 0.84, commercialVolume: 0.8, floodSusceptibility: 0.2 }),

  // ============================================= ROAD: Meghalaya (NH-6, NH-62)
  E('BYR', 'SHL', 'road', { ref: 'NH-6', name: 'Byrnihat - Shillong', km: 68, terrain: 'hill', lanes: 2, surface: 0.78, maxGradientPct: 7, landslideSusceptibility: 0.52, commercialVolume: 0.75 }),
  E('SHL', 'JOW', 'road', { ref: 'NH-6', name: 'Shillong - Jowai', km: 64, terrain: 'hill', lanes: 2, surface: 0.74, maxGradientPct: 7, landslideSusceptibility: 0.48, commercialVolume: 0.6 }),
  E('JOW', 'SCL', 'road', { ref: 'NH-6', name: 'Jowai - Silchar (Sonapur - Jaintia hills)', km: 178, terrain: 'hill', lanes: 2, surface: 0.55, maxGradientPct: 9, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.86, floodSusceptibility: 0.3, commercialVolume: 0.7 }),
  E('SHL', 'DWK', 'road', { ref: 'NH-206', name: 'Shillong - Dawki (Bangladesh LCS)', km: 82, terrain: 'hill', lanes: 2, surface: 0.62, maxGradientPct: 9, landslideSusceptibility: 0.6, commercialVolume: 0.5 }),
  E('SHL', 'NGS', 'road', { ref: 'NH-127B', name: 'Shillong - Nongstoin', km: 92, terrain: 'hill', lanes: 2, surface: 0.55, maxGradientPct: 8, allWeather: false, landslideSusceptibility: 0.62, commercialVolume: 0.25 }),
  E('NGS', 'TUR', 'road', { ref: 'NH-62', name: 'Nongstoin - Tura', km: 132, terrain: 'hill', lanes: 2, surface: 0.5, maxGradientPct: 8, allWeather: false, landslideSusceptibility: 0.64, commercialVolume: 0.3 }),
  E('TUR', 'BGM', 'road', { ref: 'NH-62', name: 'Tura - Baghmara', km: 118, terrain: 'hill', lanes: 1, surface: 0.45, maxGradientPct: 9, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.6, commercialVolume: 0.2 }),
  E('BNG', 'TUR', 'road', { ref: 'NH-127B', name: 'Bongaigaon - Tura via Phulbari', km: 148, lanes: 2, surface: 0.66, commercialVolume: 0.4, floodSusceptibility: 0.55, landslideSusceptibility: 0.2 }),

  // =========================================== ROAD: Nagaland / Manipur (NH-2)
  E('NGN', 'DMU', 'road', { ref: 'NH-27', name: 'Nagaon - Dimapur', km: 145, lanes: 2, surface: 0.76, commercialVolume: 0.8, floodSusceptibility: 0.4 }),
  E('DMU', 'KOH', 'road', { ref: 'NH-29', name: 'Dimapur - Kohima', km: 74, terrain: 'hill', lanes: 2, surface: 0.6, maxGradientPct: 8, allWeather: false, landslideSusceptibility: 0.78, commercialVolume: 0.82 }),
  E('KOH', 'IMF', 'road', { ref: 'NH-2', name: 'Kohima - Imphal (Manipur lifeline)', km: 137, terrain: 'hill', lanes: 2, surface: 0.58, maxGradientPct: 9, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.88, commercialVolume: 0.85 }),
  E('KOH', 'SEN', 'road', { ref: 'NH-2', name: 'Kohima - Senapati', km: 62, terrain: 'hill', lanes: 2, surface: 0.58, maxGradientPct: 9, allWeather: false, landslideSusceptibility: 0.82, commercialVolume: 0.6 }),
  E('SEN', 'IMF', 'road', { ref: 'NH-2', name: 'Senapati - Imphal', km: 76, terrain: 'hill', lanes: 2, surface: 0.62, maxGradientPct: 8, landslideSusceptibility: 0.74, commercialVolume: 0.7 }),
  E('IMF', 'MOR', 'road', { ref: 'NH-102', name: 'Imphal - Moreh (Asian Highway 1)', km: 110, terrain: 'hill', lanes: 2, surface: 0.6, maxGradientPct: 8, nightTravelSafe: false, landslideSusceptibility: 0.7, commercialVolume: 0.5 }),
  E('IMF', 'CCP', 'road', { ref: 'NH-2', name: 'Imphal - Churachandpur', km: 62, terrain: 'hill', lanes: 2, surface: 0.6, maxGradientPct: 7, landslideSusceptibility: 0.62, commercialVolume: 0.45 }),
  E('IMF', 'UKH', 'road', { ref: 'NH-150', name: 'Imphal - Ukhrul', km: 84, terrain: 'high_hill', lanes: 1, surface: 0.42, maxGradientPct: 11, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.84, commercialVolume: 0.2 }),
  E('IMF', 'JIR', 'road', { ref: 'NH-37', name: 'Imphal - Jiribam', km: 220, terrain: 'hill', lanes: 2, surface: 0.5, maxGradientPct: 9, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.85, commercialVolume: 0.55 }),
  E('JIR', 'SCL', 'road', { ref: 'NH-37', name: 'Jiribam - Silchar', km: 96, lanes: 2, surface: 0.62, landslideSusceptibility: 0.35, floodSusceptibility: 0.5, commercialVolume: 0.5 }),
  E('DMU', 'WOK', 'road', { ref: 'NH-2', name: 'Dimapur - Wokha', km: 80, terrain: 'hill', lanes: 2, surface: 0.55, maxGradientPct: 9, allWeather: false, landslideSusceptibility: 0.74, commercialVolume: 0.35 }),
  E('WOK', 'MKG', 'road', { ref: 'NH-61', name: 'Wokha - Mokokchung', km: 78, terrain: 'hill', lanes: 1, surface: 0.45, maxGradientPct: 10, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.8, commercialVolume: 0.25 }),
  E('MKG', 'TUE', 'road', { ref: 'NH-702', name: 'Mokokchung - Tuensang', km: 96, terrain: 'high_hill', lanes: 1, surface: 0.36, maxGradientPct: 12, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.9, commercialVolume: 0.15 }),
  E('TUE', 'MON', 'road', { ref: 'NH-702', name: 'Tuensang - Mon', km: 88, terrain: 'high_hill', lanes: 1, surface: 0.34, maxGradientPct: 12, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.9, commercialVolume: 0.12 }),
  E('MKG', 'JRH', 'road', { ref: 'NH-61', name: 'Mokokchung - Jorhat', km: 86, terrain: 'hill', lanes: 2, surface: 0.55, maxGradientPct: 8, allWeather: false, landslideSusceptibility: 0.66, commercialVolume: 0.3 }),
  E('MON', 'TSK', 'road', { ref: 'NH-315A', name: 'Mon - Tinsukia', km: 128, terrain: 'hill', lanes: 1, surface: 0.4, maxGradientPct: 10, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.78, commercialVolume: 0.15 }),

  // ================================================ ROAD: Barak valley, Mizoram, Tripura
  E('SCL', 'KRM', 'road', { ref: 'NH-37', name: 'Silchar - Karimganj', km: 62, lanes: 2, surface: 0.68, floodSusceptibility: 0.72, commercialVolume: 0.45 }),
  E('SCL', 'VRG', 'road', { ref: 'NH-306', name: 'Silchar - Vairengte', km: 88, lanes: 2, surface: 0.6, landslideSusceptibility: 0.45, floodSusceptibility: 0.4, commercialVolume: 0.6 }),
  E('VRG', 'AJL', 'road', { ref: 'NH-306', name: 'Vairengte - Aizawl', km: 152, terrain: 'hill', lanes: 2, surface: 0.52, maxGradientPct: 10, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.84, commercialVolume: 0.65 }),
  E('AJL', 'LGL', 'road', { ref: 'NH-54', name: 'Aizawl - Lunglei', km: 165, terrain: 'hill', lanes: 2, surface: 0.5, maxGradientPct: 10, allWeather: false, landslideSusceptibility: 0.8, commercialVolume: 0.35 }),
  E('LGL', 'SAI', 'road', { ref: 'NH-54', name: 'Lunglei - Saiha', km: 168, terrain: 'hill', lanes: 1, surface: 0.4, maxGradientPct: 11, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.86, commercialVolume: 0.15 }),
  E('AJL', 'CHP', 'road', { ref: 'NH-6', name: 'Aizawl - Champhai (Myanmar LCS)', km: 194, terrain: 'hill', lanes: 1, surface: 0.44, maxGradientPct: 11, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.85, commercialVolume: 0.25 }),
  E('SCL', 'DMR', 'road', { ref: 'NH-8', name: 'Silchar - Dharmanagar via Churaibari', km: 106, lanes: 2, surface: 0.66, floodSusceptibility: 0.6, landslideSusceptibility: 0.3, commercialVolume: 0.7 }),
  E('DMR', 'KLS', 'road', { ref: 'SH', name: 'Dharmanagar - Kailashahar', km: 48, lanes: 2, surface: 0.6, floodSusceptibility: 0.55, commercialVolume: 0.3 }),
  E('DMR', 'AMB', 'road', { ref: 'NH-8', name: 'Dharmanagar - Ambassa', km: 96, terrain: 'hill', lanes: 2, surface: 0.62, maxGradientPct: 6, landslideSusceptibility: 0.4, commercialVolume: 0.6 }),
  E('AMB', 'IXA', 'road', { ref: 'NH-8', name: 'Ambassa - Agartala', km: 82, lanes: 2, surface: 0.72, landslideSusceptibility: 0.22, floodSusceptibility: 0.4, commercialVolume: 0.72 }),
  E('IXA', 'UDP', 'road', { ref: 'NH-8', name: 'Agartala - Udaipur', km: 55, lanes: 2, surface: 0.76, floodSusceptibility: 0.42, commercialVolume: 0.5 }),
  E('UDP', 'SBR', 'road', { ref: 'NH-8', name: 'Udaipur - Sabroom (Maitri Setu)', km: 78, lanes: 2, surface: 0.7, floodSusceptibility: 0.45, commercialVolume: 0.4 }),

  // ================================================= ROAD: Arunachal, Sikkim
  E('TEZ', 'ITA', 'road', { ref: 'NH-15', name: 'Tezpur - Itanagar', km: 210, lanes: 2, surface: 0.7, landslideSusceptibility: 0.35, floodSusceptibility: 0.5, commercialVolume: 0.5 }),
  E('ITA', 'ZRO', 'road', { ref: 'NH-13', name: 'Itanagar - Ziro (Trans-Arunachal)', km: 112, terrain: 'high_hill', lanes: 1, surface: 0.42, maxGradientPct: 11, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.88, commercialVolume: 0.2 }),
  E('ZRO', 'IXV', 'road', { ref: 'NH-13', name: 'Ziro - Aalo', km: 168, terrain: 'high_hill', lanes: 1, surface: 0.35, maxGradientPct: 12, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.92, commercialVolume: 0.12 }),
  E('IXV', 'IXT', 'road', { ref: 'NH-13', name: 'Aalo - Pasighat', km: 100, terrain: 'hill', lanes: 1, surface: 0.44, maxGradientPct: 10, allWeather: false, landslideSusceptibility: 0.82, commercialVolume: 0.18 }),
  E('IXT', 'DIB', 'road', { ref: 'NH-515 / Bogibeel', name: 'Pasighat - Dibrugarh', km: 145, lanes: 2, surface: 0.66, landslideSusceptibility: 0.3, floodSusceptibility: 0.6, commercialVolume: 0.35 }),
  E('IXT', 'ROI', 'road', { ref: 'NH-13', name: 'Pasighat - Roing', km: 105, terrain: 'hill', lanes: 1, surface: 0.42, allWeather: false, landslideSusceptibility: 0.8, floodSusceptibility: 0.5, commercialVolume: 0.15 }),
  E('ROI', 'TEI', 'road', { ref: 'NH-13', name: 'Roing - Tezu', km: 100, terrain: 'hill', lanes: 1, surface: 0.44, allWeather: false, landslideSusceptibility: 0.78, commercialVolume: 0.15 }),
  E('TEI', 'NAM', 'road', { ref: 'NH-315', name: 'Tezu - Namsai', km: 62, terrain: 'hill', lanes: 2, surface: 0.55, landslideSusceptibility: 0.55, commercialVolume: 0.2 }),
  E('NAM', 'TSK', 'road', { ref: 'NH-315', name: 'Namsai - Tinsukia', km: 68, lanes: 2, surface: 0.66, landslideSusceptibility: 0.25, floodSusceptibility: 0.45, commercialVolume: 0.3 }),
  E('TEZ', 'BOM', 'road', { ref: 'NH-13', name: 'Tezpur - Bomdila', km: 160, terrain: 'high_hill', lanes: 2, surface: 0.5, maxGradientPct: 10, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.88, commercialVolume: 0.25 }),
  E('BOM', 'TAW', 'road', { ref: 'NH-13 / Sela', name: 'Bomdila - Tawang via Sela Tunnel', km: 180, terrain: 'high_hill', lanes: 1, surface: 0.46, maxGradientPct: 12, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.9, commercialVolume: 0.15, seasonalClosure: { months: [12, 1, 2], reason: 'snow at Sela Pass (13,700 ft)' } }),
  E('SLG', 'RGP', 'road', { ref: 'NH-10', name: 'Siliguri - Rangpo (Sikkim lifeline)', km: 78, terrain: 'hill', lanes: 2, surface: 0.55, maxGradientPct: 8, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.9, floodSusceptibility: 0.45, commercialVolume: 0.8 }),
  E('RGP', 'GTK', 'road', { ref: 'NH-10', name: 'Rangpo - Gangtok', km: 40, terrain: 'hill', lanes: 2, surface: 0.66, maxGradientPct: 8, landslideSusceptibility: 0.72, commercialVolume: 0.7 }),
  E('RGP', 'PYG', 'road', { ref: 'SH', name: 'Rangpo - Pakyong', km: 28, terrain: 'hill', lanes: 2, surface: 0.68, landslideSusceptibility: 0.6, commercialVolume: 0.4 }),
  E('GTK', 'MNG', 'road', { ref: 'NH-310', name: 'Gangtok - Mangan (North Sikkim)', km: 62, terrain: 'high_hill', lanes: 1, surface: 0.4, maxGradientPct: 12, allWeather: false, nightTravelSafe: false, landslideSusceptibility: 0.93, commercialVolume: 0.15 }),
  E('RGP', 'NAM_SK', 'road', { ref: 'NH-10 / SH', name: 'Rangpo - Namchi', km: 55, terrain: 'hill', lanes: 2, surface: 0.58, maxGradientPct: 9, allWeather: false, landslideSusceptibility: 0.76, commercialVolume: 0.3 }),
  E('CCU', 'SLG', 'road', { ref: 'NH-12 / NH-27', name: 'Kolkata - Siliguri', km: 570, lanes: 4, surface: 0.85, commercialVolume: 0.95, floodSusceptibility: 0.3 }),

  // ==================================================== RAIL (NF Railway)
  E('CCU', 'SLG', 'rail', { ref: 'NFR', name: 'Kolkata - New Jalpaiguri', km: 570, commercialVolume: 0.9, floodSusceptibility: 0.25 }),
  E('SLG', 'BNG', 'rail', { ref: 'NFR', name: 'NJP - New Bongaigaon', km: 248, commercialVolume: 0.85, floodSusceptibility: 0.4 }),
  E('BNG', 'GHY', 'rail', { ref: 'NFR', name: 'New Bongaigaon - Guwahati', km: 182, commercialVolume: 0.85, floodSusceptibility: 0.35 }),
  E('BNG', 'DBR', 'rail', { ref: 'NFR', name: 'New Bongaigaon - Dhubri', km: 105, commercialVolume: 0.35, floodSusceptibility: 0.6 }),
  E('GHY', 'NGN', 'rail', { ref: 'NFR', name: 'Guwahati - Chaparmukh/Nagaon', km: 130, commercialVolume: 0.6, floodSusceptibility: 0.45 }),
  E('GHY', 'LMG', 'rail', { ref: 'NFR', name: 'Guwahati - Lumding', km: 180, commercialVolume: 0.7, floodSusceptibility: 0.4 }),
  E('LMG', 'DMU', 'rail', { ref: 'NFR', name: 'Lumding - Dimapur', km: 96, commercialVolume: 0.72, floodSusceptibility: 0.3 }),
  E('DMU', 'JRH', 'rail', { ref: 'NFR', name: 'Dimapur - Mariani/Jorhat', km: 128, commercialVolume: 0.6, floodSusceptibility: 0.35 }),
  E('JRH', 'DIB', 'rail', { ref: 'NFR', name: 'Mariani - Dibrugarh', km: 140, commercialVolume: 0.6, floodSusceptibility: 0.42 }),
  E('DIB', 'TSK', 'rail', { ref: 'NFR', name: 'Dibrugarh - Tinsukia', km: 50, commercialVolume: 0.55, floodSusceptibility: 0.35 }),
  E('GHY', 'TEZ', 'rail', { ref: 'NFR', name: 'Rangiya - Dekargaon (Tezpur)', km: 185, commercialVolume: 0.35, floodSusceptibility: 0.5 }),
  E('TEZ', 'NLP', 'rail', { ref: 'NFR', name: 'Dekargaon - North Lakhimpur', km: 180, commercialVolume: 0.3, floodSusceptibility: 0.6 }),
  E('LMG', 'SCL', 'rail', { ref: 'NFR (Lumding-Badarpur hill section)', name: 'Lumding - Silchar hill section', km: 210, terrain: 'hill', allWeather: false, landslideSusceptibility: 0.9, floodSusceptibility: 0.35, commercialVolume: 0.65 }),
  E('SCL', 'KRM', 'rail', { ref: 'NFR', name: 'Silchar - Karimganj', km: 66, floodSusceptibility: 0.68, commercialVolume: 0.4 }),
  E('KRM', 'DMR', 'rail', { ref: 'NFR', name: 'Karimganj - Dharmanagar', km: 52, floodSusceptibility: 0.6, commercialVolume: 0.5 }),
  E('DMR', 'AMB', 'rail', { ref: 'NFR', name: 'Dharmanagar - Ambassa', km: 98, terrain: 'hill', landslideSusceptibility: 0.4, commercialVolume: 0.55 }),
  E('AMB', 'IXA', 'rail', { ref: 'NFR', name: 'Ambassa - Agartala', km: 86, commercialVolume: 0.6, floodSusceptibility: 0.35 }),
  E('IXA', 'UDP', 'rail', { ref: 'NFR', name: 'Agartala - Udaipur', km: 58, commercialVolume: 0.45 }),
  E('UDP', 'SBR', 'rail', { ref: 'NFR', name: 'Udaipur - Sabroom', km: 80, commercialVolume: 0.35 }),
  E('SCL', 'JIR', 'rail', { ref: 'NFR', name: 'Silchar - Jiribam', km: 55, floodSusceptibility: 0.55, commercialVolume: 0.3 }),

  // ==================================== WATER: NW-2 Brahmaputra, NW-16 Barak
  E('CCU', 'DBR', 'water', { ref: 'NW-1 / IBP Route', name: 'Haldia - Dhubri (Indo-Bangladesh Protocol route)', km: 1010, commercialVolume: 0.4, floodSusceptibility: 0.3 }),
  E('DBR', 'GHY', 'water', { ref: 'NW-2', name: 'Dhubri - Pandu (Guwahati) on the Brahmaputra', km: 220, commercialVolume: 0.35, floodSusceptibility: 0.25 }),
  E('GHY', 'TEZ', 'water', { ref: 'NW-2', name: 'Pandu - Silghat/Tezpur', km: 165, commercialVolume: 0.25, floodSusceptibility: 0.25 }),
  E('TEZ', 'JRH', 'water', { ref: 'NW-2', name: 'Silghat - Neamati (Jorhat)', km: 175, commercialVolume: 0.22, floodSusceptibility: 0.25 }),
  E('JRH', 'DIB', 'water', { ref: 'NW-2', name: 'Neamati - Dibrugarh', km: 150, commercialVolume: 0.22, floodSusceptibility: 0.28 }),
  E('DIB', 'IXT', 'water', { ref: 'NW-2 / NW-18', name: 'Dibrugarh - Pasighat (Siang)', km: 130, commercialVolume: 0.12, floodSusceptibility: 0.4 }),
  E('KRM', 'SCL', 'water', { ref: 'NW-16', name: 'Karimganj - Silchar on the Barak', km: 71, commercialVolume: 0.18, floodSusceptibility: 0.4 }),

  // ============================================= AIR (scheduled + UDAN-RCS)
  E('CCU', 'GHY', 'air', { ref: 'Scheduled', name: 'Kolkata - Guwahati', km: 525, commercialVolume: 0.9 }),
  E('CCU', 'IXA', 'air', { ref: 'Scheduled', name: 'Kolkata - Agartala', km: 330, commercialVolume: 0.7 }),
  E('CCU', 'IMF', 'air', { ref: 'Scheduled', name: 'Kolkata - Imphal', km: 580, commercialVolume: 0.6 }),
  E('CCU', 'AJL', 'air', { ref: 'Scheduled', name: 'Kolkata - Aizawl (Lengpui)', km: 430, commercialVolume: 0.5 }),
  E('GHY', 'IMF', 'air', { ref: 'Scheduled', name: 'Guwahati - Imphal', km: 240, commercialVolume: 0.7 }),
  E('GHY', 'IXA', 'air', { ref: 'Scheduled', name: 'Guwahati - Agartala', km: 290, commercialVolume: 0.6 }),
  E('GHY', 'AJL', 'air', { ref: 'Scheduled', name: 'Guwahati - Aizawl', km: 290, commercialVolume: 0.5 }),
  E('GHY', 'DMU', 'air', { ref: 'Scheduled', name: 'Guwahati - Dimapur', km: 200, commercialVolume: 0.45 }),
  E('GHY', 'DIB', 'air', { ref: 'Scheduled', name: 'Guwahati - Dibrugarh', km: 350, commercialVolume: 0.5 }),
  E('GHY', 'JRH', 'air', { ref: 'UDAN-RCS', name: 'Guwahati - Jorhat', km: 250, commercialVolume: 0.3 }),
  E('GHY', 'SCL', 'air', { ref: 'Scheduled', name: 'Guwahati - Silchar', km: 190, commercialVolume: 0.45 }),
  E('GHY', 'SHL', 'air', { ref: 'UDAN-RCS', name: 'Guwahati - Shillong (Umroi)', km: 80, commercialVolume: 0.25 }),
  E('GHY', 'TUR', 'air', { ref: 'UDAN-RCS', name: 'Guwahati - Tura (Baljek)', km: 175, commercialVolume: 0.15 }),
  E('GHY', 'ITA', 'air', { ref: 'UDAN-RCS', name: 'Guwahati - Itanagar (Donyi Polo)', km: 195, commercialVolume: 0.3 }),
  E('GHY', 'TEZ', 'air', { ref: 'UDAN-RCS', name: 'Guwahati - Tezpur', km: 145, commercialVolume: 0.15 }),
  E('GHY', 'PYG', 'air', { ref: 'UDAN-RCS', name: 'Guwahati - Pakyong (Sikkim)', km: 400, commercialVolume: 0.2 }),
  E('DIB', 'IXT', 'air', { ref: 'UDAN-RCS', name: 'Dibrugarh - Pasighat', km: 105, commercialVolume: 0.12 }),
  E('DIB', 'TEI', 'air', { ref: 'UDAN-RCS', name: 'Dibrugarh - Tezu', km: 125, commercialVolume: 0.12 }),
  E('DIB', 'IXV', 'air', { ref: 'UDAN-RCS', name: 'Dibrugarh - Aalo', km: 145, commercialVolume: 0.1 }),
  E('IMF', 'AJL', 'air', { ref: 'UDAN-RCS', name: 'Imphal - Aizawl', km: 190, commercialVolume: 0.15 }),
];

/** Physical + economic characteristics of each transport mode. */
export const MODES = {
  road: {
    label: 'Road',
    baseSpeedKmph: 45,
    ratePerTonneKm: 3.2,      // INR
    co2GramsPerTonneKm: 62,
    handlingHours: 0.5,
    handlingCostPerTonne: 120,
  },
  rail: {
    label: 'Rail',
    baseSpeedKmph: 32,        // freight average incl. yard time
    ratePerTonneKm: 1.5,
    co2GramsPerTonneKm: 22,
    handlingHours: 4,
    handlingCostPerTonne: 420,
  },
  water: {
    label: 'Inland Waterway',
    baseSpeedKmph: 14,
    ratePerTonneKm: 1.1,
    co2GramsPerTonneKm: 16,
    handlingHours: 8,
    handlingCostPerTonne: 560,
  },
  air: {
    label: 'Air Cargo',
    baseSpeedKmph: 480,
    ratePerTonneKm: 48,
    co2GramsPerTonneKm: 602,
    handlingHours: 3,
    handlingCostPerTonne: 2600,
  },
};

/** Winding factor: great-circle km -> actual path km, when `km` is not given. */
export const WINDING = {
  road: { plain: 1.28, hill: 1.62, high_hill: 1.95 },
  rail: { plain: 1.22, hill: 1.5, high_hill: 1.7 },
  water: { plain: 1.75, hill: 1.75, high_hill: 1.75 },
  air: { plain: 1.02, hill: 1.02, high_hill: 1.02 },
};
