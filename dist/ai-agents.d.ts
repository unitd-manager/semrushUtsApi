export type AiAgentDefinition = {
    id: string;
    route: string;
    name: string;
    description: string;
    category: string;
    capabilities: string[];
    integrations: string[];
    permissions: string[];
    scheduleSupported: boolean;
    defaultMode: "MANUAL" | "APPROVAL_REQUIRED";
};
export declare const aiAgentRegistry: AiAgentDefinition[];
export declare function findAiAgent(agentId: string): AiAgentDefinition | undefined;
