export declare const manualResearchModules: readonly ["map-rank-tracker", "pla-research", "ads-launch-assistant", "adclarity", "semrush-rank", "keyword-observations", "competitor-observations", "backlink-observations", "ranking-observations"];
export type ManualResearchModule = typeof manualResearchModules[number];
export declare function isManualResearchModule(value: string): value is ManualResearchModule;
export declare function parseManualResearchInput(module: ManualResearchModule, value: unknown): Record<string, unknown>;
