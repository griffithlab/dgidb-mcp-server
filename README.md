# DGIdb MCP Server

This is a Cloudflare Workers-based Model Context Protocol (MCP) server that provides tools for querying the DGIdb (Drug Gene Interaction Database) API. 

DGIdb streamlines the search for druggable therapeutic targets through the aggregation, categorization, and curation of drug and gene data from publications and expert resources. 

## Using With Claude Desktop

Example video taken from CIViC MCP

https://github.com/user-attachments/assets/5890f79a-e2fc-49f6-b5f4-ef191d07872d

Install Node.js (https://nodejs.org/)

Click "LTS" (Recommended for Most Users) — this gives you Node.js and npx
Download and install it like any normal app

Once installed:
On Windows: Open “Command Prompt” or “PowerShell”
On macOS: Open “Terminal”

Then run:
```bash
node -v
npx -v
```

Confirm that both give versions.

## Accessing DGIdb via MCP
Add this configuration to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "lars-dgidb-mcp-server": {
    "command": "npx",
    "args": [
          "mcp-remote",
          "https://dgidb-mcp-server.larscivic.workers.dev/mcp"
        ]
    }
  }
}
```

## Joint Access to DGIdb and CIViC via MCP
Add this configuration to your `claude_desktop_config.json` file:

```json
{
"mcpServers": {
    "lars-civic-mcp-server": {
    "command": "npx",
    "args": [
          "mcp-remote",
          "https://civic-mcp-server-v2.larscivic.workers.dev/mcp"
        ]
      },

    "lars-dgidb-mcp-server": {
    "command": "npx",
    "args": [
          "mcp-remote",
          "https://dgidb-mcp-server.larscivic.workers.dev/mcp"
        ]
      }
  }
}
```

## Usage

Once configured, restart Claude Desktop. The server provides 4 main tools:

1. **`get_drug_info`**: Gets drug info including approval, if used in immunotherapy, and other drug attributes for a list of drugs.
2. **`get_gene_info`**: Gets gene category info for a list of genes.
3. **`get_drug_interactions_for_gene_list`**: Gets drugs that interact with a list of genes.
4. **`get_gene_interactions_for_drug_list`**: Gets genes that interact with a list of drugs.
