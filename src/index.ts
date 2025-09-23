import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { findBestMatch } from 'string-similarity'

import rawDrugMap  from "./data/CIViC_therapy_name_map.json";
import rawGeneMap  from "./data/VICC_gene_alias_map.json";

export const dDrugMap: Record<string, string[]>  = rawDrugMap  as Record<string, string[]>;
export const dGeneMap: Record<string, string[]>  = rawGeneMap  as Record<string, string[]>;

function normalizeStr(s: string): string {
  return s
    .normalize('NFKD')                   // decompose accents
    .replace(/[\u0300-\u036f]/g, '')     // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')        // keep only letters, digits, spaces
    .replace(/\s+/g, ' ')                // collapse runs of spaces
    .trim()
}

/**
 * Map a free‑form name to its primary alias via fuzzy matching.
 *
 * @param name      Input string (may be undefined or null)
 * @param lookup    Record<primary, aliases[]>
 * @param threshold Minimum similarity (0–1) to accept a match
 * @returns         The matched primary string, or undefined if below threshold or name missing
 */
export function normalizeEntity(
  name: string | undefined | null,
  lookup: Record<string, string[]>,
  threshold: number = 0.7
): string | undefined {
  if (!name) {
    return undefined
  }

  const qNorm = normalizeStr(name)

  // Build a map from normalized‑alias → primary
  const aliasToPrimary: Record<string, string> = {}
  for (const [primary, aliases] of Object.entries(lookup)) {
    aliasToPrimary[normalizeStr(primary)] = primary
    for (const alias of aliases) {
      aliasToPrimary[normalizeStr(alias)] = primary
    }
  }

  const candidates = Object.keys(aliasToPrimary)
  const { bestMatch } = findBestMatch(qNorm, candidates)

  return bestMatch.rating >= threshold
    ? aliasToPrimary[bestMatch.target]
    : undefined
}

export type InteractionType = { type?: string; directionality?: string };
export type Interaction = {
  interactionScore?: number | null;
  interactionTypes?: InteractionType[];
  gene?: { name?: string | null } | null;
  drug?: { name?: string | null; approved?: boolean | null } | null;
};
export type DrugNode = { name: string; interactions: Interaction[] };

export interface GeneNode {
  /** Gene (or molecular profile) name. */
  name: string;
  /** Array of interaction objects. */
  interactions: Interaction[];
  /** Any other fields returned by the API. */
  [key: string]: unknown;
}

/**
 * Return up to N interactions with:
 *  1) approved drugs first (drug.approved === true)
 *  2) then by highest interactionScore (desc)
 *
 * @param interactions - Array of interaction objects.
 * @param N            - Maximum number to return (default 20).
 */
export function filterInteractionScore(
  interactions: Interaction[],
  N = 20
): Interaction[] {
  return [...interactions]
    .sort((a, b) => {
      const aApproved = !!a.drug?.approved;
      const bApproved = !!b.drug?.approved;

      // Primary: approved first
      if (aApproved !== bApproved) {
        return aApproved ? -1 : 1;
      }

      // Secondary: higher interactionScore first
      const aScore = a.interactionScore ?? 0;
      const bScore = b.interactionScore ?? 0;
      return bScore - aScore;
    })
    .slice(0, N);
}

/** Exact (case-insensitive) match wins; otherwise pick the node that contains the term and has the most interactions. */
export function findBestNode(nodes: DrugNode[], term: string): DrugNode | undefined {
  const t = term.toLowerCase();

  // 1) exact match first
  const exact = nodes.find(n => n.name.toLowerCase() === t);
  if (exact) return exact;

  // 2) longest node by interactions among substring matches
  let best: DrugNode | undefined;
  let bestLen = -1;
  for (const n of nodes) {
    if (n.name.toLowerCase().includes(t)) {
      const L = n.interactions?.length ?? 0;
      if (L > bestLen) {
        best = n;
        bestLen = L;
      }
    }
  }
  return best;
}

/**
 * Fair-share allocation of a total budget across names based on available counts.
 * Ascending pass; each gets at most avg remaining (floor), capped by its available count.
 */
export function distributeNodes(
  dNodeLens: Record<string, number>,
  total = 100
): Record<string, number> {
  const entries = Object.entries(dNodeLens).sort((a, b) => a[1] - b[1]); // ascending
  const out: Record<string, number> = {};
  let i = 0;
  const num = entries.length;

  for (const [key, val] of entries) {
    const allowed = Math.floor(total / (num - i)) || 0;
    const curr = Math.min(val, Math.max(allowed, 0));
    out[key] = curr;
    total -= curr;
    i += 1;
  }
  return out;
}

/** Approved drugs first, then highest interactionScore (desc). Missing → approved=false, score=0. */
export function filterAndSort(interactions: Interaction[], N = 20): Interaction[] {
  return [...(interactions ?? [])]
    .sort((a, b) => {
      const aApproved = !!a.drug?.approved;
      const bApproved = !!b.drug?.approved;
      if (aApproved !== bApproved) return aApproved ? -1 : 1; // approved first

      const aScore = a.interactionScore ?? 0;
      const bScore = b.interactionScore ?? 0;
      return bScore - aScore; // desc
    })
    .slice(0, N);
}

/**
 * For each requested name:
 *  - choose best node (exact > longest substring)
 *  - budget interactions across names (distributeNodes)
 *  - apply filterAndSort per name with that budget
 * Returns map: requested name → filtered interactions[]
 */
export function selectNodes(
  nodes: DrugNode[],
  normalizedNames: string[],
  totalBudget: number
): Record<string, Interaction[]> {
  const counts: Record<string, number> = {};
  const chosen: Record<string, DrugNode> = {};

  for (const name of normalizedNames) {
    const node = findBestNode(nodes, name);
    if (!node) continue;
    chosen[name] = node;
    counts[name] = node.interactions?.length ?? 0;
  }

  const allocations = distributeNodes(counts, totalBudget);

  const out: Record<string, Interaction[]> = {};
  for (const name of Object.keys(allocations)) {
    const node = chosen[name];
    const N = allocations[name] ?? 0;
    out[name] = filterAndSort(node?.interactions ?? [], N);
  }
  return out;
}

// ========================================
// API CONFIGURATION - Customize for your GraphQL API
// ========================================

export const API_CONFIG = {
  name:        "DGIdbExplorer",
  version:     "0.1.0",
  description: "Fixed‑schema MCP tools for the DGI GraphQL API",
  mcpSpecVersion: "2025-06-18",
  features: {
    structuredToolOutput: true,
    metaFields:           true,
    protocolVersionHeaders: true,
    titleFields:          true,
    toolAnnotations:      true,
  },
  headers: {
    "User-Agent": "MCPDGIdbServer/0.1.0"
  },
} as const;


/** -----------------------------------------------------------------
 *  Tool definitions
 *  ---------------------------------------------------------------- */

export const tools = {
  getGeneInteractionsForDrug: {
    name: "get_gene_interactions_for_drug_list",
    description:
      "Return up to 100 total gene interactions across 1+ drugs; approved first, then highest interaction score.",
    inputSchema: {drugName: z.string()},
    annotations: {
      destructive: false,
      idempotent:  true,
      cacheable:   false,
      world_interaction: "open",
      side_effects: ["external_api_calls"],
      resource_usage: "network_io_heavy",
    },

    async handler(
  		{ drugName }: { drugName: string }  // <- matches schema
	) {

		const query = /* GraphQL */ `
			query drugs($names: [String!]) {
        drugs(names: $names) {
          nodes {
              name
              interactions {
                  gene {
                      name
                  }
                  interactionScore
                  interactionTypes {
                      type
                      directionality
                  }
              }
          }
        }
      }`;


    const rawNames = drugName.split(",").map(s => s.trim()).filter(Boolean);
    // Call normalizeEntity(rawName, dDrugMap, 0.7). Fallback to raw if it returns falsy.
    const normalizedNames = rawNames.map(raw =>
      normalizeEntity(raw, dDrugMap, 0.7) || raw
    );
    const totalBudget = normalizedNames.length === 1 ? 40 : 100;

    const res = await fetch("https://dgidb.org/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...API_CONFIG.headers },
      body: JSON.stringify({ query, variables: { names: normalizedNames } })
    }).then(r => r.json()) as {
      data?: { drugs?: { nodes?: DrugNode[] } };
      errors?: unknown[];
    };

    if (!res.data?.drugs?.nodes) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }]
      };
    }

    const nodes = res.data.drugs.nodes;
    if (!nodes.length) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `No drug nodes found for: ${normalizedNames.join(", ")}` }]
      };
    }

    const payload = selectNodes(nodes, normalizedNames, totalBudget);

    return {
      isError: false,
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }]
    };
	},
}, 

  getDrugInteractionsForGene: {
    name: "get_drug_interactions_for_gene_list",
    description:
      "Return up to 100 drugs that interact with the provided gene list",
    inputSchema: {geneName: z.string()},
    annotations: {
      destructive: false,
      idempotent:  true,
      cacheable:   false,
      world_interaction: "open",
      side_effects: ["external_api_calls"],
      resource_usage: "network_io_heavy",
    },

    async handler(
  		{ geneName }: { geneName: string }  // <- matches schema
	) {

		const query = /* GraphQL */ `
      query genes($names: [String!]) {
          genes(names: $names) {
              nodes {
                  name
                  interactions {
                      drug {
                          name
                          approved
                      }
                      interactionScore
                      interactionTypes {
                          type
                          directionality
                      }

                  }
              }
          }
      }`;

      const rawNames = geneName.split(",").map(s => s.trim()).filter(Boolean);
      const normalizedNames = rawNames.map(raw =>
        normalizeEntity(raw, dGeneMap, 0.7) || raw
      );
      const totalBudget = normalizedNames.length === 1 ? 40 : 100;

			const res = await fetch("https://dgidb.org/api/graphql", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...API_CONFIG.headers },
				body: JSON.stringify({ query, variables: { name: geneName } })
			}).then(r => r.json()) as {
				data?: { genes?: { nodes: { name: string; interactions: any[] }[] } };
				errors?: unknown[];
			};

		// ✅ If no data, wrap in a content-based return for MCP compliance
		if (!res.data?.genes) {
			return {
			isError: true,
			content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }]
			};
		}

		const nodes = res.data.genes.nodes ?? [];

    if (!nodes.length) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `No gene nodes found for: ${normalizedNames.join(", ")}` }]
      };
    }

    const payload = selectNodes(nodes, normalizedNames, totalBudget);

    return {
      isError: false,
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }]
    };
	},
	},

} as const;



// -------------------------------------------------------------
// MCP SERVER (only the two fixed tools)
// -------------------------------------------------------------
class DgidbMCP extends McpAgent {
  server = new McpServer({
    name:        API_CONFIG.name,
    version:     API_CONFIG.version,
    description: API_CONFIG.description,},
    
    {
    instructions: `
	Use the tools to find drug-gene interactions with the Drug-Gene Interaction Database (DGIdb).
    `,
  });

  async init() {
    /* register fixed-schema tools */
    const { getGeneInteractionsForDrug, getDrugInteractionsForGene } = tools;

    this.server.tool(
      getGeneInteractionsForDrug.name,
      getGeneInteractionsForDrug.description,
      getGeneInteractionsForDrug.inputSchema,
      getGeneInteractionsForDrug.handler,
    );

    this.server.tool(
      getDrugInteractionsForGene.name,
      getDrugInteractionsForGene.description,
      getDrugInteractionsForGene.inputSchema,
      getDrugInteractionsForGene.handler,
    );
  }
}

// -------------------------------------------------------------
// CLOUDFLARE WORKER RUNTIME (SSE only)
// -------------------------------------------------------------
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}


export default {
  async fetch(
    request: Request,
    env: Env,               // keep the typed Env like before
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    console.log(Object.keys(env));

    /* ────────────────────────────────────────────────
       SSE transport (Claude Desktop, Cursor, etc.)
    ─────────────────────────────────────────────────*/
    if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
      // MCP 2025-06-18: client may send its protocol version
      const protocolVersion = request.headers.get("MCP-Protocol-Version");

      // @ts-ignore – serveSSE helper is mixed-in by DgidbMCP
      const response = await DgidbMCP.serveSSE("/sse").fetch(request, env, ctx);

      // Mirror the header back so the client sees what the server supports
      if (protocolVersion && response instanceof Response) {
        const headers = new Headers(response.headers);
        headers.set("MCP-Protocol-Version", protocolVersion);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }

      return response; // unchanged fallback
    }

    return new Response(
      `${API_CONFIG.name} – MCP Server ${API_CONFIG.version}. Use /sse for MCP transport.`,
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  }
};

// Export the class for tests if you like
export { DgidbMCP };