#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type JsonObject = Record<string, unknown>;

const baseUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, "");
const apiKey = process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY;

if (!baseUrl) {
  throw new Error("EVOLUTION_API_URL is required");
}

if (!apiKey) {
  throw new Error("EVOLUTION_API_KEY or AUTHENTICATION_API_KEY is required");
}

const apiKeyHeader = apiKey;

const server = new McpServer({
  name: "evolution-api-mcp",
  version: "1.0.0",
});

async function evolutionRequest(method: HttpMethod, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: apiKeyHeader,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown = text;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `Evolution API ${method} ${path} failed with ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  return data;
}

function toolResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function mergeExtra(input: JsonObject, omit: string[] = []) {
  const payload: JsonObject = { ...(input.extra as JsonObject | undefined) };

  for (const [key, value] of Object.entries(input)) {
    if (key !== "extra" && !omit.includes(key) && value !== undefined) {
      payload[key] = value;
    }
  }

  return payload;
}

const instanceShape = {
  instance: z.string().describe("Evolution API instance name"),
};

const extraShape = {
  extra: z.record(z.unknown()).optional().describe("Additional Evolution API payload fields"),
};

server.tool("list_instances", "List all Evolution API instances", {}, async () => {
  return toolResponse(await evolutionRequest("GET", "/instance/fetchInstances"));
});

server.tool(
  "create_instance",
  "Create a new Evolution API instance",
  {
    instanceName: z.string().describe("New instance name"),
    qrcode: z.boolean().optional().describe("Return QR code after creating the instance"),
    integration: z.string().optional().describe("Integration/provider type, if required by your Evolution API"),
    ...extraShape,
  },
  async (input) => toolResponse(await evolutionRequest("POST", "/instance/create", mergeExtra(input))),
);

server.tool("connect_instance", "Connect an instance and return connection/QR data", instanceShape, async ({ instance }) => {
  return toolResponse(await evolutionRequest("GET", `/instance/connect/${encodeURIComponent(instance)}`));
});

server.tool("disconnect_instance", "Logout/disconnect an instance", instanceShape, async ({ instance }) => {
  return toolResponse(await evolutionRequest("DELETE", `/instance/logout/${encodeURIComponent(instance)}`));
});

server.tool(
  "send_text",
  "Send a WhatsApp text message",
  {
    ...instanceShape,
    number: z.string().describe("Recipient phone number, usually country code + number"),
    text: z.string().describe("Text message"),
    delay: z.number().optional(),
    quoted: z.record(z.unknown()).optional(),
    linkPreview: z.boolean().optional(),
    mentionsEveryOne: z.boolean().optional(),
    mentioned: z.array(z.string()).optional(),
    ...extraShape,
  },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendText/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "send_media",
  "Send media such as image, video, document or file URL/base64",
  {
    ...instanceShape,
    number: z.string(),
    mediatype: z.string().describe("image, video, document, audio, etc."),
    media: z.string().describe("Media URL or base64"),
    caption: z.string().optional(),
    fileName: z.string().optional(),
    mimetype: z.string().optional(),
    delay: z.number().optional(),
    ...extraShape,
  },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendMedia/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "send_audio",
  "Send WhatsApp audio from URL or base64",
  {
    ...instanceShape,
    number: z.string(),
    audio: z.string().describe("Audio URL or base64"),
    delay: z.number().optional(),
    ...extraShape,
  },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "send_sticker",
  "Send a WhatsApp sticker from URL or base64",
  { ...instanceShape, number: z.string(), sticker: z.string(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendSticker/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "send_contact",
  "Send contact cards",
  { ...instanceShape, number: z.string(), contact: z.array(z.record(z.unknown())), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendContact/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "send_location",
  "Send a location message",
  {
    ...instanceShape,
    number: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
    ...extraShape,
  },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendLocation/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "send_reaction",
  "React to a WhatsApp message",
  { ...instanceShape, key: z.record(z.unknown()), reaction: z.string(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendReaction/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "send_status",
  "Send WhatsApp status/story",
  { ...instanceShape, type: z.string(), content: z.string(), caption: z.string().optional(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendStatus/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "send_template",
  "Send a WhatsApp Cloud API template message",
  { ...instanceShape, number: z.string(), template: z.record(z.unknown()), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/message/sendTemplate/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "chat_history",
  "Find messages using Evolution API chat filters",
  { ...instanceShape, where: z.record(z.unknown()).optional(), limit: z.number().optional(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/chat/findMessages/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "fetch_messages",
  "Fetch messages from a specific chat/remote JID",
  { ...instanceShape, remoteJid: z.string().optional(), page: z.number().optional(), offset: z.number().optional(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/chat/fetchMessages/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "get_contacts",
  "Find contacts using Evolution API chat filters",
  { ...instanceShape, where: z.record(z.unknown()).optional(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/chat/findContacts/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "get_profile",
  "Fetch WhatsApp profile data for a number",
  { ...instanceShape, number: z.string(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/chat/fetchProfile/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "mark_as_read",
  "Mark messages as read",
  { ...instanceShape, readMessages: z.array(z.record(z.unknown())), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/chat/markMessageAsRead/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "update_presence",
  "Update typing/recording presence for a chat",
  { ...instanceShape, number: z.string(), presence: z.string().describe("available, composing, recording, paused, unavailable"), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/chat/updatePresence/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "create_group",
  "Create a WhatsApp group",
  { ...instanceShape, subject: z.string(), participants: z.array(z.string()), description: z.string().optional(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/group/create/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool("list_groups", "Fetch all groups for an instance", instanceShape, async ({ instance }) => {
  return toolResponse(await evolutionRequest("GET", `/group/fetchAllGroups/${encodeURIComponent(instance)}`));
});

server.tool(
  "update_group",
  "Update group settings or metadata",
  { ...instanceShape, groupJid: z.string(), action: z.string().optional(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/group/updateGroupSettings/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "add_participant",
  "Add participants to a WhatsApp group",
  { ...instanceShape, groupJid: z.string(), participants: z.array(z.string()), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("PUT", `/group/addParticipant/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "remove_participant",
  "Remove participants from a WhatsApp group",
  { ...instanceShape, groupJid: z.string(), participants: z.array(z.string()), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("PUT", `/group/removeParticipant/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool(
  "set_webhook",
  "Set webhook configuration for an instance",
  { ...instanceShape, webhook: z.record(z.unknown()).optional(), url: z.string().optional(), enabled: z.boolean().optional(), events: z.array(z.string()).optional(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/webhook/set/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool("get_webhook", "Get webhook configuration for an instance", instanceShape, async ({ instance }) => {
  return toolResponse(await evolutionRequest("GET", `/webhook/find/${encodeURIComponent(instance)}`));
});

server.tool(
  "set_settings",
  "Set Evolution API instance settings",
  { ...instanceShape, settings: z.record(z.unknown()).optional(), ...extraShape },
  async (input) => {
    const { instance } = input;
    return toolResponse(
      await evolutionRequest("POST", `/settings/set/${encodeURIComponent(instance)}`, mergeExtra(input, ["instance"])),
    );
  },
);

server.tool("get_settings", "Get Evolution API instance settings", instanceShape, async ({ instance }) => {
  return toolResponse(await evolutionRequest("GET", `/settings/find/${encodeURIComponent(instance)}`));
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
