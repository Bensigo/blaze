import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client;
const token = `blaze_ro_${"a".repeat(43)}`;
beforeAll(async () => {
  const transport = new StdioClientTransport({command:process.execPath,args:["--import","tsx","--import","./tests/mcp-fetch-fixture.mjs","mcp/index.ts"],cwd:process.cwd(),env:{PATH:process.env.PATH || "",BLAZE_URL:"http://127.0.0.1:12345",BLAZE_TOKEN:token},stderr:"pipe"});
  client = new Client({name:"test-client",version:"1.0.0"});
  await client.connect(transport);
},30000);
afterAll(async () => { await client?.close(); });
describe("MCP stdio integration", () => {
  it("negotiates, lists only read-only tools, and forwards bounded reports", async () => {
    const {tools} = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(["analytics_report","discovery_report","games_list"]);
    expect(tools.every(t => t.annotations?.readOnlyHint)).toBe(true);
    const result = await client.callTool({name:"analytics_report",arguments:{gameId:"game_1",days:"7"}});
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{type:string;text:string}>;
    expect(JSON.parse(content[0].text)).toEqual({url:"http://127.0.0.1:12345/api/agent/report?report=analytics&gameId=game_1&days=7",method:"GET",authorization:`Bearer ${token}`,redirect:"error"});
    const invalid = await client.callTool({name:"analytics_report",arguments:{gameId:"../secret",days:"7"}});
    expect(invalid.isError).toBe(true);
  },30000);
});
