export interface RiskComponents {
  landslide: number; flood: number; physicalModel: number;
  learnedModel: number; congestion: number;
}
export interface RiskAssessment {
  disruptionProbability: number;
  components: RiskComponents;
  inputs: {
    rain24hMm: number; rain3DayMm: number; rain7DayMm: number;
    monsoonIndex: number; weatherSource: string; scenario: string;
  };
  seasonalClosure: { months: number[]; reason: string } | null;
  band: 'low' | 'moderate' | 'high' | 'severe';
}

export interface NodeRef { id: string; name: string; lat: number; lon: number; state?: string }

export interface Segment {
  kind: 'travel'; mode: string; modeLabel: string; label: string;
  ref: string | null; corridorName: string | null;
  from: NodeRef; to: NodeRef;
  km: number; hours: number; effectiveSpeedKmph: number;
  costInr: number; co2Kg: number; terrain: string; allWeather: boolean;
  accessibility: number; risk: RiskAssessment;
}

export type Leg =
  | (Segment & { kind: 'travel' })
  | { kind: 'transfer'; at: NodeRef; fromMode: string; toMode: string; label: string; hours: number; costInr: number }
  | { kind: 'handling'; at: NodeRef; mode: string; label: string; hours: number; costInr: number };

export interface Barrier {
  severity: 'blocking' | 'major' | 'minor';
  where: string; issue: string; mitigation: string;
}

export interface Route {
  id: string; rank: number; recommended: boolean;
  legs: Leg[]; segments: Segment[];
  modesUsed: string[]; modeLabel: string; transshipments: number;
  totals: {
    distanceKm: number; hours: number; etaText: string;
    costInr: number; costPerTonneInr: number; co2Kg: number; co2PerTonneKg: number;
  };
  reliability: {
    arrivalProbability: number; worstLinkProbability: number;
    worstLink: { label: string; ref: string | null; band: string } | null;
    band: string;
  };
  accessibility: {
    score: number; corridorScore: number; terminalScore: number;
    grade: string; barriers: Barrier[]; blocking: number;
  };
  scorecard: { speed: number; cost: number; emissions: number; reliability: number; accessibility: number };
  geometry: { mode: string; risk: number; band: string; label: string; coords: [number, number][] }[];
  objectiveCost: number;
  overallGrade: string;
}

export interface Plan {
  degraded: boolean;
  degradedNote: string | null;
  request: {
    origin: NodeRef; destination: NodeRef; tonnes: number;
    profile: string; profileLabel: string;
    weights: Record<string, number>; modes: string[];
    vehicleGrossWeightT: number; nightDeparture: boolean;
    needsStepFree: boolean; scenario: string; plannedAt: string;
  };
  routes: Route[];
  explanations: { routeId: string; lines: string[] }[];
  comparison: { routeId: string; summary: string; preferWhen: string }[];
  bulletin: { page: number; of: number; text: string; chars: number }[];
}

export interface NetNode {
  id: string; name: string; state: string; lat: number; lon: number;
  category: string; populationServed: number;
  terminals: { rail: boolean; river: boolean; air: boolean; icd: boolean };
  weather?: { precipitationMm: number; rain3DayMm: number; rain7DayMm: number; temperatureC: number | null; source: string };
}

export interface Corridor {
  id: string; from: NodeRef; to: NodeRef;
  mode: string; modeLabel: string; ref: string | null; name: string | null;
  km: number; terrain: string; allWeather: boolean; states: string[];
  risk: RiskAssessment;
}

export interface Summary {
  scenario: string; corridors: number; settlements: number; states: number;
  networkKm: number; byMode: Record<string, number>;
  riskBands: Record<string, number>; meanDisruptionRisk: number;
  stateRisk: { state: string; corridors: number; meanRisk: number; band: string }[];
  weather: WeatherStatus;
}

export interface WeatherStatus {
  source: string; fetchedAt: string | null; nodeCount: number;
  lastError: string | null; provider: string;
}

export interface Alert {
  id: string; severity: 'critical' | 'warning'; type: string;
  corridor: string; ref: string | null; states: string[];
  headline: string; detail: string; probability: number;
  geometry: [number, number][];
}

export interface Isolation {
  hub: string; hubName: string; threshold: number; modes: string[]; scenario: string;
  cutOff: { nodeId: string; name: string; state: string; lat: number; lon: number; populationServed: number; normalKm: number; hasAirport: boolean }[];
  cutOffPopulation: number;
  reachableByAirOnly: string[];
  atRisk: { nodeId: string; name: string; state: string; lat: number; lon: number; populationServed: number; normalKm: number; degradedKm: number; detourKm: number }[];
  detouredPopulation: number;
}

export interface Settlement {
  nodeId: string; name: string; state: string; lat: number; lon: number;
  category: string; populationServed: number; index: number; grade: string;
  subScores: Record<string, number>;
  connectivity: { links: number; modes: string[] };
  access: {
    rampAccess: boolean; stepFreeAccess: boolean; assistedBoarding: boolean;
    lastMileGapKm: number; nearestHealthFacilityKm: number;
    coverage: string; allWeatherApproach: boolean;
  };
  corridors?: { ref: string | null; name: string | null; mode: string; km: number; allWeather: boolean; terrain: string; other: string }[];
}

export interface StateRollup {
  state: string; settlements: number; populationServed: number;
  meanIndex: number; populationWeightedIndex: number;
  underservedCount: number; underservedPopulation: number;
  worst: { name: string; index: number }[];
}

export interface ModelCard {
  name: string; kind: string; trainedAt: string; trainingMs: number;
  samples: { total: number; train: number; test: number };
  features: string[]; weights: Record<string, number>; intercept: number;
  finalTrainLogLoss: number;
  heldOut: { accuracy: number; precision: number; recall: number; rocAuc: number; positiveRate: number };
  trainingData: string;
}

export interface Meta {
  states: string[];
  modes: { id: string; label: string; baseSpeedKmph: number; ratePerTonneKm: number; co2GramsPerTonneKm: number }[];
  profiles: { id: string; label: string; description: string; weights: Record<string, number> }[];
  scenarios: { id: string; label: string; description: string; severity: string }[];
}
